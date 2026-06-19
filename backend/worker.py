import os
import httpx
import re
import json
import redis
from decimal import Decimal, ROUND_HALF_UP
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List, Optional
from sqlmodel import Session, select, func, text, and_, col

from database import engine, Settings, Matches, Predictions, BetSlips, Bets, CrawlTargets, CrawlRuns
from crawler import crawl_odds
from agent import predict_match, match_team_name

# Initialize Redis Client
redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
redis_client = redis.Redis.from_url(redis_url, decode_responses=True)

def get_settings(session: Session) -> Settings:
    """
    Get active configuration settings, or seed defaults.
    """
    statement = select(Settings)
    config = session.exec(statement).first()
    if not config:
        config = Settings()
        session.add(config)
        session.commit()
        session.refresh(config)
    return config


def run_crawling(session: Session) -> int:
    """
    Scrape matches, cache all to Redis, and queue predictions only for qualifying matches.
    """
    start_time = datetime.now(timezone.utc)
    config = get_settings(session)
    
    # Fetch all enabled crawl targets
    targets_stmt = select(CrawlTargets).where(col(CrawlTargets.enabled) == True)
    targets = session.exec(targets_stmt).all()
    
    crawl_urls = [t.url for t in targets] if targets else [config.crawling_url]
    
    crawled = []
    status = "success"
    error_message = None
    
    try:
        for url in crawl_urls:
            print(f"[Worker Crawl] Executing crawl on target URL: {url}")
            results = crawl_odds(url, provider=config.llm_provider, model_name=config.llm_model)
            crawled.extend(results)
    except Exception as crawl_err:
        print(f"[Worker Crawl] Extraction error: {crawl_err}")
        status = "failed"
        error_message = str(crawl_err)
    
    new_fixtures_count = 0
    if status == "success":
        for m in crawled:

            # Check if match has already started
            match_time = m.get("matchTime")
            if isinstance(match_time, str):
                try:
                    match_time = datetime.fromisoformat(match_time)
                except Exception:
                    pass
            if isinstance(match_time, datetime):
                now = datetime.now(match_time.tzinfo) if match_time.tzinfo else datetime.now()
                if match_time <= now:
                    print(f"[Worker Crawl] Skipping match {m['id']}: Match already started (Match Time: {match_time}, Now: {now}).")
                    continue
                # Limit predictions to matches starting within the next 20 hours
                if match_time > now + timedelta(hours=20):
                    print(f"[Worker Crawl] Skipping match {m['id']}: Match is too far in the future (Match Time: {match_time}, 20h limit: {now + timedelta(hours=20)}).")
                    continue

            # Check if double chance odds are disabled
            odds_list = [m.get("odds1X"), m.get("odds12"), m.get("oddsX2")]
            # Convert values to Decimal if they are numbers and > 0
            decimal_odds = []
            for o in odds_list:
                if o is not None:
                    try:
                        dec_o = Decimal(str(o))
                        if dec_o > Decimal('0'):
                            decimal_odds.append(dec_o)
                    except Exception:
                        pass
            if not decimal_odds:
                print(f"[Worker Crawl] Skipping match {m['id']}: Double chance odds are disabled/missing.")
                continue
            
            # Check if already predicted (Redis cache or Postgres database)
            if redis_client.exists(f"betsmart:predicted:{m['id']}"):
                print(f"[Worker Crawl] Skipping match {m['id']}: Already predicted recently (cached in Redis).")
                continue
                
            pred_stmt = select(Predictions).where(col(Predictions.match_id) == m['id'])
            pred_db = session.exec(pred_stmt).first()
            if pred_db:
                print(f"[Worker Crawl] Skipping match {m['id']}: Already has a prediction in the database.")
                # Sync to Redis cache to avoid querying DB next time (dynamic TTL)
                redis_client.setex(f"betsmart:predicted:{m['id']}", config.cache_time * 60, "1")
                continue
                
            # If valid odds exist, check if at least one option qualifies
            qualifies = False
            for o in decimal_odds:
                if config.min_odds <= o <= config.max_odds:
                    qualifies = True
                    break
            
            if not qualifies:
                print(f"[Worker Crawl] Skipping prediction for match {m['id']}: Odds {decimal_odds} do not qualify within limit [{config.min_odds} - {config.max_odds}].")
                continue
                
            try:
                # Trigger prediction synchronously in worker thread, passing the crawled match data
                prediction_res = run_prediction(m, session)
                if prediction_res:
                    new_fixtures_count += 1
            except json.JSONDecodeError as json_err:
                # Skip the current match being processed for non-fatal/parsing issues
                print(f"[Worker Crawl] Skipping match {m['id']} due to JSON decode error: {json_err}")
            except (ConnectionError, ValueError) as fatal_err:
                # Re-raise fatal connectivity / configuration errors to halt the loop
                print(f"[Worker Crawl] Fatal LLM connectivity or config error: {fatal_err}")
                status = "failed"
                error_message = str(fatal_err)
                break
            except Exception as e:
                # Skip the current match being processed for non-fatal/parsing issues
                print(f"[Worker Crawl] Skipping match {m['id']} due to prediction error: {e}")
                
    end_time = datetime.now(timezone.utc)
    duration = (end_time - start_time).total_seconds()
    
    # Save crawl runs record
    try:
        run_record = CrawlRuns(
            started_at=start_time,
            duration_seconds=round(duration, 2),
            status=status,
            run_metadata={
                "matchesScraped": len(crawled),
                "predictionsCreated": new_fixtures_count,
                "targetsCrawled": crawl_urls,
                "errorMessage": error_message
            }
        )
        session.add(run_record)
        session.commit()
        
        # Publish event for real-time logs updating
        redis_client.publish("betsmart:events", json.dumps({
            "type": "crawl_run_added", 
            "runId": run_record.id,
            "predictionsCreated": new_fixtures_count,
            "matchesScraped": len(crawled)
        }))
    except Exception as db_err:
        print(f"[Worker Crawl] Failed to save crawl run record: {db_err}")
        
    return new_fixtures_count


def run_prediction(match_data_or_id: Any, session: Session) -> Optional[Predictions]:
    """
    Run LLM prediction for a match and record it to the database only if it qualifies (predictedOutcome != 'NONE')
    """
    config = get_settings(session)
    
    # 1. Resolve match data dictionary
    if isinstance(match_data_or_id, str):
        match_id = match_data_or_id
        redis_key = f"betsmart:match:{match_id}"
        match_str = redis_client.get(redis_key)
        
        if match_str:
            m = json.loads(match_str)
            if "matchTime" in m and m["matchTime"]:
                m["matchTime"] = datetime.fromisoformat(m["matchTime"])
        else:
            # Fallback to database if not in Redis
            match_stmt = select(Matches).where(col(Matches.id) == match_id)
            match_db = session.exec(match_stmt).first()
            if not match_db:
                return None
            m = {
                "id": match_db.id,
                "homeTeam": match_db.home_team,
                "awayTeam": match_db.away_team,
                "league": match_db.league,
                "matchTime": match_db.match_time,
                "odds1X": float(match_db.odds_1x) if match_db.odds_1x is not None else None,
                "odds12": float(match_db.odds_12) if match_db.odds_12 is not None else None,
                "oddsX2": float(match_db.odds_x2) if match_db.odds_x2 is not None else None
            }
    else:
        m = match_data_or_id
        match_id = m["id"]

    # 2. Generate prediction using Agno agent
    result = predict_match(
        home_team=str(m["homeTeam"]),
        away_team=str(m["awayTeam"]),
        provider=config.llm_provider,
        model_name=config.llm_model,
        ollama_url=config.ollama_url
    )
    if result is None:
        print(f"[Worker Predict] Discarding match {match_id} due to LLM response/parsing error.")
        return None

    # Mark as predicted in Redis (dynamic TTL) to avoid re-triggering too quickly
    redis_client.setex(f"betsmart:predicted:{match_id}", config.cache_time * 60, result["predictedOutcome"])
    
    # Calculate threshold (discard if more than 10% below min_confidence)
    cutoff = config.min_confidence - 0.10
    
    if result["predictedOutcome"] == "NONE":
        print(f"[Worker Predict] Discarded unqualified match (NONE outcome): {m['homeTeam']} vs {m['awayTeam']}")
        return None
        
    if result["confidence"] < cutoff:
        print(f"[Worker Predict] Discarded match due to low confidence: {m['homeTeam']} vs {m['awayTeam']} (Confidence: {result['confidence']:.2f}, Cutoff: {cutoff:.2f})")
        return None

    # Insert Match record if it doesn't exist
    match_db = session.exec(select(Matches).where(col(Matches.id) == match_id)).first()
    if not match_db:
        def to_decimal_or_none(val):
            if val is None or val == "":
                return None
            try:
                return Decimal(str(val))
            except Exception:
                return None

        match_db = Matches(
            id=match_id,
            home_team=str(m["homeTeam"]),
            away_team=str(m["awayTeam"]),
            league=str(m.get("league", "Unknown League")),
            match_time=str(m["matchTime"]),
            status="upcoming",
            odds_1x=to_decimal_or_none(m.get("odds1X")),
            odds_12=to_decimal_or_none(m.get("odds12")),
            odds_x2=to_decimal_or_none(m.get("oddsX2"))
        )
        session.add(match_db)
    else:
        # Update odds on the existing match record
        def to_decimal_or_none(val):
            if val is None or val == "":
                return None
            try:
                return Decimal(str(val))
            except Exception:
                return None

        match_db.odds_1x = to_decimal_or_none(m.get("odds1X"))
        match_db.odds_12 = to_decimal_or_none(m.get("odds12"))
        match_db.odds_x2 = to_decimal_or_none(m.get("oddsX2"))
        session.add(match_db)
    
    # Insert Prediction record
    prediction = Predictions(
        match_id=match_id,
        predicted_outcome=result["predictedOutcome"],
        confidence=result["confidence"],
        reasoning=result["reasoning"]
    )
    session.add(prediction)
    session.commit()
    session.refresh(prediction)
    
    # Publish event for real-time frontend updates
    try:
        redis_client.publish("betsmart:events", json.dumps({
            "type": "prediction_added", 
            "matchId": match_id,
            "homeTeam": m["homeTeam"],
            "awayTeam": m["awayTeam"]
        }))
    except Exception as pub_err:
        print(f"[Worker Predict] Redis publish error: {pub_err}")
        
    # Attempt auto-bet placement
    if config.auto_bet_enabled:
        attempt_place_accumulator(session)
        
    print(f"[Worker Predict] Saved qualified match and prediction to PostgreSQL: {m['homeTeam']} vs {m['awayTeam']} -> {result['predictedOutcome']} (Confidence: {result['confidence']:.2f})")
    return prediction


def attempt_place_accumulator(session: Session):
    """
    Compile qualifying matches into simulation parlay/accumulator slips
    """
    config = get_settings(session)
    
    # Fetch all predictions for upcoming matches that are not yet associated with any bet slip
    # and have high confidence
    qualifying_query = select(Predictions, Matches).join(
        Matches, col(Predictions.match_id) == col(Matches.id)
    ).where(
        col(Matches.status) == "upcoming",
        col(Predictions.confidence) >= config.min_confidence
    )
    
    results = session.exec(qualifying_query).all()
    
    # Filter matches whose double chance odds are within target range in Python
    filtered = []
    seen_match_ids = set()
    for pred, match in results:
        # Avoid duplicate matches in query results
        if match.id in seen_match_ids:
            continue
            
        # Check if already placed a bet on this match
        bet_stmt = select(Bets).where(col(Bets.match_id) == match.id)
        if session.exec(bet_stmt).first():
            continue
            
        selection_odds = Decimal('0.00')
        if pred.predicted_outcome == "1X":
            selection_odds = match.odds_1x or Decimal('0.00')
        elif pred.predicted_outcome == "12":
            selection_odds = match.odds_12 or Decimal('0.00')
        elif pred.predicted_outcome == "X2":
            selection_odds = match.odds_x2 or Decimal('0.00')
            
        if config.min_odds <= selection_odds <= config.max_odds:
            seen_match_ids.add(match.id)
            filtered.append((match, pred, selection_odds))

    min_size = config.accumulator_min_size
    max_size = config.accumulator_max_size
    
    if len(filtered) >= min_size:
        selections_to_bet = filtered[:max_size]
        
        # Calculate combined odds
        total_odds = Decimal('1.00')
        for match, pred, odds in selections_to_bet:
            total_odds *= odds
        total_odds = total_odds.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        
        # Check daily stake limits
        today = datetime.now(timezone.utc).date()
        today_start = datetime(today.year, today.month, today.day)
        
        # Sum of stakes placed today
        placed_today_query = select(func.coalesce(func.sum(col(BetSlips.stake)), 0)).where(col(BetSlips.placed_at) >= today_start)
        staked_today = session.exec(placed_today_query).one()
        
        max_daily_stake = config.account_balance * Decimal(str(config.max_daily_stake_percent))
        if staked_today + config.stake > max_daily_stake:
            print(f"[Risk Manager] Cannot place bet slip: Daily limit exceeded. Staked today: ₦{staked_today}, Limit: ₦{max_daily_stake}")
            return
            
        if config.account_balance < config.stake:
            print(f"[Risk Manager] Cannot place bet slip: Insufficient balance. Balance: ₦{config.account_balance}, Stake: ₦{config.stake}")
            return
            
        # Place accumulator slip in transaction
        slip = BetSlips(
            stake=config.stake,
            total_odds=total_odds,
            status="pending",
            is_simulation=config.is_simulation
        )
        session.add(slip)
        session.commit()
        session.refresh(slip)
        
        for match, pred, odds in selections_to_bet:
            if slip.id is None:
                continue
                
            bet = Bets(
                bet_slip_id=slip.id,
                match_id=match.id,
                selection=pred.predicted_outcome,
                odds=odds
            )
            session.add(bet)
            
        # Deduct stake from account balance
        config.account_balance -= config.stake
        session.add(config)
        session.commit()
        
        # Publish event for real-time frontend updates
        try:
            redis_client.publish("betsmart:events", json.dumps({"type": "bet_placed", "slipId": slip.id}))
        except Exception as pub_err:
            print(f"[Risk Manager] Redis publish error: {pub_err}")
            
        print(f"[Risk Manager] Placed simulation parlay/accumulator slip #{slip.id} with {len(selections_to_bet)} games. Combined Odds: {total_odds}x, Stake: ₦{config.stake}")


def settle_match_results(session: Session) -> int:
    """
    Query football API for finished match scores and resolve pending bet slips
    """
    config = get_settings(session)
    if not config.historic_data_api_key:
        print("[Worker Settle] Skip settlement: No football API key provided.")
        return 0

    # Get all matches that should be finished (kickoff in the past) and are not marked completed
    # We check matches that started at least 2 hours and 30 minutes ago
    cutoff_time = datetime.now() - timedelta(hours=2, minutes=30)
    past_matches_stmt = select(Matches).where(col(Matches.status) != "completed").where(col(Matches.match_time) <= cutoff_time)
    past_matches = session.exec(past_matches_stmt).all()
    
    if not past_matches:
        print("[Worker Settle] No past matches to settle.")
    
    # Calculate date range from past matches
    min_date = min(m.match_time for m in past_matches).date() if past_matches else datetime.now().date()
    max_date = datetime.now().date()
    date_from = max(min_date, (datetime.now() - timedelta(days=10)).date())
    
    # Query general matches endpoint from football API (no league filter)
    base_url = config.historic_data_api_url
    if base_url.endswith("/matches"):
        base_url = base_url.rsplit("/matches", 1)[0]
        
    url = f"{base_url}/matches?dateFrom={date_from}&dateTo={max_date}"
    headers = {"X-Auth-Token": config.historic_data_api_key}
    
    api_matches = []
    if past_matches:
        try:
            print(f"[Worker Settle] Querying finished matches from {url}")
            response = httpx.get(url, headers=headers, timeout=10)
            if response.status_code == 200:
                api_matches = response.json().get("matches", [])
            else:
                print(f"[Worker Settle] Football API returned status: {response.status_code}. Using fallback search for all matches.")
        except Exception as api_err:
            print(f"[Worker Settle] Football API request failed: {api_err}. Using fallback search for all matches.")
    
    settled_matches_count = 0
    try:
        for match in past_matches:
            # Try to match with finished match from API
            matched_api = None
            for api_m in api_matches:
                if (match_team_name(api_m["homeTeam"]["name"], match.home_team) and 
                    match_team_name(api_m["awayTeam"]["name"], match.away_team)):
                    matched_api = api_m
                    break
                    
            home_goals, away_goals = None, None
            if matched_api and matched_api.get("status") == "FINISHED":
                score = matched_api["score"]["fullTime"]
                home_goals = score.get("home")
                away_goals = score.get("away")
                print(f"[Worker Settle] Resolved via API: {match.home_team} vs {match.away_team} -> {home_goals}:{away_goals}")
            else:
                # Check if kickoff was more than 2.5 hours ago. If so, fallback to Tavily + LLM
                now = datetime.now()
                # Remove timezone if match.match_time is naive
                match_time_naive = match.match_time.replace(tzinfo=None) if match.match_time.tzinfo else match.match_time
                if match_time_naive + timedelta(hours=2, minutes=30) <= now:
                    print(f"[Worker Settle] Match not found in API. Invoking Tavily Web Search fallback for: {match.home_team} vs {match.away_team}...")
                    from agent import search_tavily_score, extract_score_with_llm
                    search_results = search_tavily_score(match.home_team, match.away_team, match_time_naive.strftime('%Y-%m-%d'))
                    
                    score_res = extract_score_with_llm(
                        home_team=match.home_team,
                        away_team=match.away_team,
                        search_results=search_results,
                        provider=config.llm_provider,
                        model_name=config.llm_model,
                        ollama_url=config.ollama_url
                    )
                    if score_res and score_res.get("finished") and score_res.get("homeGoals", 0) >= 0 and score_res.get("awayGoals", 0) >= 0:
                        home_goals = score_res["homeGoals"]
                        away_goals = score_res["awayGoals"]
                        print(f"[Worker Settle] Resolved via Web Search + LLM: {match.home_team} vs {match.away_team} -> {home_goals}:{away_goals}")
            
            if home_goals is not None and away_goals is not None:
                result = "X"
                if home_goals > away_goals:
                    result = "1"
                elif home_goals < away_goals:
                    result = "2"
                    
                double_chance = ""
                if result == "1":
                    double_chance = "1X,12"
                elif result == "2":
                    double_chance = "12,X2"
                else:
                    double_chance = "1X,X2"
                    
                match.status = "completed"
                match.result = result
                match.double_chance_result = double_chance
                match.updated_at = datetime.now(timezone.utc)
                session.add(match)
                session.commit()
                settled_matches_count += 1
                print(f"[Worker Settle] Resolved Match: {match.home_team} vs {match.away_team} -> {result} ({double_chance})")
                
                # Delete prediction from Redis cache
                try:
                    redis_client.delete(f"betsmart:predicted:{match.id}")
                except Exception as redis_err:
                    print(f"[Worker Settle] Redis delete error: {redis_err}")
                
                try:
                    redis_client.publish("betsmart:events", json.dumps({
                        "type": "match_settled", 
                        "matchId": match.id,
                        "homeTeam": match.home_team,
                        "awayTeam": match.away_team,
                        "result": result
                    }))
                except Exception as pub_err:
                    print(f"[Worker Settle] Redis publish error: {pub_err}")
                
        # Re-evaluate all pending bet slips
        pending_slips_stmt = select(BetSlips).where(col(BetSlips.status) == "pending")
        pending_slips = session.exec(pending_slips_stmt).all()
        for slip in pending_slips:
            slip_bets_stmt = select(Bets, Matches).join(Matches, col(Bets.match_id) == col(Matches.id)).where(col(Bets.bet_slip_id) == slip.id)
            slip_bets = session.exec(slip_bets_stmt).all()
            
            # Update individual bet statuses first for completed matches
            for bet, match in slip_bets:
                if match.status == "completed" and bet.status == "pending":
                    dc_res = match.double_chance_result or ""
                    bet.status = "won" if bet.selection in dc_res else "lost"
                    bet.updated_at = datetime.now(timezone.utc)
                    session.add(bet)
            session.commit()
            
            # Re-fetch or check if the whole slip can be settled
            all_finished = all(match.status == "completed" for bet, match in slip_bets)
            if all_finished:
                won_slip = all(bet.status == "won" for bet, match in slip_bets)
                status = "won" if won_slip else "lost"
                payout = (slip.stake * slip.total_odds).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP) if won_slip else Decimal('0.00')
                
                slip.status = status
                slip.payout = payout
                session.add(slip)
                
                if won_slip:
                    config.account_balance += payout
                    session.add(config)
                    
                session.commit()
                print(f"[Worker Settle] Settled Bet Slip #{slip.id}: Marked as {status.upper()}. Payout: ₦{payout}")
                
                try:
                    redis_client.publish("betsmart:events", json.dumps({"type": "slip_settled", "slipId": slip.id}))
                except Exception as pub_err:
                    print(f"[Worker Settle] Redis publish error: {pub_err}")
                
    except Exception as e:
        print(f"[Worker Settle] Settle error: {e}")
        
    return settled_matches_count
