import { NextResponse } from "next/server";
import { db } from "@/db";
import { crawlRuns } from "@/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  try {
    const runs = await db
      .select()
      .from(crawlRuns)
      .orderBy(desc(crawlRuns.startedAt))
      .limit(30); // Return last 30 runs

    return NextResponse.json({ success: true, runs });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
