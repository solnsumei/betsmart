import { NextResponse } from "next/server";
import { db } from "@/db";
import { historicalMatches } from "@/db/schema";
import { sql } from "drizzle-orm";

export async function GET() {
  try {
    const status = await db
      .select({
        league: historicalMatches.league,
        count: sql<number>`count(*)::int`,
        minDate: sql<string>`min(${historicalMatches.date})::text`,
        maxDate: sql<string>`max(${historicalMatches.date})::text`,
      })
      .from(historicalMatches)
      .groupBy(historicalMatches.league);

    return NextResponse.json({
      success: true,
      status,
    });
  } catch (error: any) {
    console.error("[API] Failed to get ingestion status:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
