import dotenv from "dotenv";
dotenv.config();

import { oddsWorker, predictionWorker, settleWorker } from "./lib/worker";
import { addOddsCrawlJob, addSettleResultsJob } from "./lib/queue";

console.log("==================================================");
console.log("   BETSMART BACKGROUND WORKER SYSTEM INITIATED    ");
console.log("==================================================");
console.log(`Connecting to Redis: ${process.env.REDIS_URL || "redis://127.0.0.1:6379"}`);
console.log(`Database connected successfully.`);

// Register recurring jobs
Promise.all([
  addOddsCrawlJob().then(() => console.log("Registered recurring Bet9ja odds crawler (Every 2 hours).")),
  addSettleResultsJob().then(() => console.log("Registered recurring match outcome settler (Every 1 hour).")),
]).catch((err) => {
  console.error("Failed to register recurring worker jobs:", err);
});

console.log("Worker status: Listening for odds-crawl, predictions, and settle tasks...");
console.log(`Initialized queue workers: ${[oddsWorker, predictionWorker, settleWorker].map(w => w.name).join(", ")}`);

// Register error/failed event listeners for detailed logging
oddsWorker.on("failed", (job, err) => {
  console.error(`[Worker] Odds Crawl Job ${job?.id} failed:`, err.message || err);
});
oddsWorker.on("error", (err) => {
  console.error("[Worker] Odds Crawl Worker critical error:", err);
});

predictionWorker.on("failed", (job, err) => {
  console.error(`[Worker] Prediction Job ${job?.id} failed:`, err.message || err);
});
predictionWorker.on("error", (err) => {
  console.error("[Worker] Prediction Worker critical error:", err);
});

settleWorker.on("failed", (job, err) => {
  console.error(`[Worker] Settle Job ${job?.id} failed:`, err.message || err);
});
settleWorker.on("error", (err) => {
  console.error("[Worker] Settle Worker critical error:", err);
});

console.log("Press Ctrl+C to terminate workers.");
