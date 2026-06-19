import IORedis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const redis = new IORedis(redisUrl);

async function clearQueueKeys(queueName: string) {
  const pattern = `bull:${queueName}:*`;
  let cursor = "0";
  let deletedCount = 0;
  
  console.log(`Scanning for keys matching pattern: ${pattern}...`);
  
  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
    cursor = nextCursor;
    
    if (keys.length > 0) {
      await redis.del(...keys);
      deletedCount += keys.length;
    }
  } while (cursor !== "0");
  
  console.log(`Deleted ${deletedCount} keys for queue: ${queueName}`);
}

async function run() {
  try {
    console.log(`Connecting to Redis at ${redisUrl}...`);
    await clearQueueKeys("odds-crawl");
    await clearQueueKeys("predictions");
    await clearQueueKeys("settle-results");
    console.log("Safe queue clearing completed successfully.");
  } catch (err: any) {
    console.error("Queue clearing failed:", err.message);
  } finally {
    await redis.quit();
  }
  process.exit(0);
}

run();
