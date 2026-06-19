import { NextResponse } from "next/server";
import Redis from "ioredis";

export async function POST() {
  try {
    const connectionString = process.env.REDIS_URL || "redis://localhost:6379";
    console.log(`[API Trigger] Publishing trigger_crawl command to Redis at: ${connectionString}`);
    
    const redis = new Redis(connectionString);
    await redis.publish("betsmart:commands", "trigger_crawl");
    redis.disconnect();

    return NextResponse.json({
      success: true,
      message: "Crawling and prediction queue job triggered successfully via Redis channel.",
    });
  } catch (error: any) {
    console.error("Failed to trigger crawl job via Redis:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
