import os
import time
import redis
import threading
from datetime import datetime
from sqlmodel import Session

from database import engine
from worker import run_crawling, settle_match_results, get_settings

# Redis Client Setup
redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
redis_client = redis.Redis.from_url(redis_url, decode_responses=True)

# Lock to prevent concurrent pipeline execution
pipeline_lock = threading.Lock()

def execute_pipeline(trigger_type: str = "periodic"):
    """
    Executes the crawling and match settlement pipeline with concurrency locking.
    """
    if not pipeline_lock.acquire(blocking=False):
        print(f"[Scheduler] Pipeline execution skipped: Another job is currently running.")
        return
    
    try:
        print(f"[Scheduler] Starting pipeline execution (Trigger: {trigger_type}) at {datetime.now().isoformat()}...")
        with Session(engine) as session:
            # 1. Run Crawling
            print(f"[Scheduler] Running crawling job...")
            run_crawling(session)
            
            # 2. Settle Match Results
            print(f"[Scheduler] Running match settlement job...")
            settle_match_results(session)
            
        print(f"[Scheduler] Pipeline execution completed successfully.")
    except Exception as e:
        print(f"[Scheduler] Pipeline execution failed: {e}")
    finally:
        pipeline_lock.release()

def handle_redis_command(message):
    """
    Callback handler for Redis PubSub messages.
    """
    if message["type"] == "message":
        command = message["data"]
        print(f"[Scheduler] Received Redis command: {command}")
        if command == "trigger_crawl":
            threading.Thread(target=execute_pipeline, args=("manual",), daemon=True).start()

def start_redis_listener():
    """
    Subscribes to Redis PubSub channel using a non-blocking background thread.
    """
    pubsub = redis_client.pubsub()
    pubsub.subscribe(**{"betsmart:commands": handle_redis_command})
    print("[Scheduler] Subscribed to Redis PubSub 'betsmart:commands' channel. Listener thread started.")
    # run_in_thread runs in the background using polling (sleep_time=1.0) preventing socket timeouts
    return pubsub.run_in_thread(sleep_time=1.0, daemon=True)

def main():
    print("=========================================================")
    print("      BetSmart Standalone Background Task Scheduler      ")
    print("=========================================================")
    
    # 1. Start Redis PubSub Listener Thread
    pubsub_thread = start_redis_listener()
    
    # Delay initial periodic execution slightly on startup
    print("[Scheduler] Initial delay for startup (10 seconds)...")
    time.sleep(10)
    
    # 2. Main periodic loop with dynamic interval checking
    last_run_time = 0.0
    while True:
        # Load frequency dynamically from database config
        frequency_sec = 1800  # Default to 30 mins
        try:
            with Session(engine) as session:
                config = get_settings(session)
                if config and config.pipeline_frequency:
                    frequency_sec = config.pipeline_frequency * 60
        except Exception as db_err:
            print(f"[Scheduler] Error loading dynamic pipeline frequency: {db_err}")
            
        now = time.time()
        if now - last_run_time >= frequency_sec:
            execute_pipeline(trigger_type="periodic")
            last_run_time = time.time()
            next_run_str = datetime.fromtimestamp(last_run_time + frequency_sec).strftime('%H:%M:%S')
            print(f"[Scheduler] Next periodic execution scheduled in {frequency_sec // 60} minutes (at {next_run_str}).")
            
        time.sleep(5)

if __name__ == "__main__":
    main()
