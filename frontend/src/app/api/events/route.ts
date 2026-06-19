import { NextRequest, NextResponse } from "next/server";
import Redis from "ioredis";

export async function GET(request: NextRequest) {
  const connectionString = process.env.REDIS_URL || "redis://localhost:6379";
  const redis = new Redis(connectionString);

  const encoder = new TextEncoder();

  const customStream = new ReadableStream({
    async start(controller) {
      try {
        await redis.subscribe("betsmart:events");

        redis.on("message", (channel, message) => {
          if (channel === "betsmart:events") {
            controller.enqueue(encoder.encode(`data: ${message}\n\n`));
          }
        });
      } catch (err) {
        console.error("Redis subscription failed in SSE:", err);
      }

      // Periodic keep-alive ping every 15 seconds to prevent browser/gateway timeout
      const keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, 15000);

      request.signal.addEventListener("abort", () => {
        clearInterval(keepAlive);
        redis.disconnect();
        try {
          controller.close();
        } catch (e) {}
      });
    },
    cancel() {
      redis.disconnect();
    }
  });

  return new NextResponse(customStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}
