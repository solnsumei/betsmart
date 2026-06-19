import { Queue } from "bullmq";
import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";

export const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
});

export const oddsQueue = new Queue("odds-crawl", { connection: connection as any });
export const predictionQueue = new Queue("predictions", { connection: connection as any });
export const historicQueue = new Queue("historic-fetch", { connection: connection as any });
export const settleQueue = new Queue("settle-results", { connection: connection as any });

export async function addOddsCrawlJob() {
  await oddsQueue.add("crawl", {}, {
    repeat: { pattern: "0 */2 * * *" }, // Run every 2 hours by default
    jobId: "crawling-repeat",
  });
}

export async function addSettleResultsJob() {
  await settleQueue.add("settle", {}, {
    repeat: { pattern: "0 * * * *" }, // Run every hour
    jobId: "settlement-repeat",
  });
}
