import { NextResponse } from "next/server";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    let config = await db.query.settings.findFirst();
    if (!config) {
      const [inserted] = await db.insert(settings).values({}).returning();
      config = inserted;
    }
    return NextResponse.json(config);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id, ...updateData } = body;
    let config = await db.query.settings.findFirst();

    if (!config) {
      const [inserted] = await db.insert(settings).values(updateData).returning();
      return NextResponse.json(inserted);
    } else {
      // Check if cacheTime was updated to clean up existing cache keys
      if (updateData.cacheTime !== undefined && updateData.cacheTime !== config.cacheTime) {
        const oldCacheTimeSec = config.cacheTime * 60;
        const newCacheTimeSec = updateData.cacheTime * 60;

        const connectionString = process.env.REDIS_URL || "redis://localhost:6379";
        const Redis = (await import("ioredis")).default;
        const redis = new Redis(connectionString);

        try {
          const keys = await redis.keys("betsmart:*");
          for (const key of keys) {
            if (key.startsWith("betsmart:match:") || key.startsWith("betsmart:predicted:")) {
              const ttl = await redis.ttl(key);
              if (ttl > 0) {
                const age = oldCacheTimeSec - ttl;
                if (age > newCacheTimeSec) {
                  await redis.del(key);
                }
              }
            }
          }
        } catch (redisErr) {
          console.error("Failed to clean Redis cache on settings update:", redisErr);
        } finally {
          redis.disconnect();
        }
      }

      const [updated] = await db
        .update(settings)
        .set(updateData)
        .where(eq(settings.id, config.id))
        .returning();
      return NextResponse.json(updated);
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
