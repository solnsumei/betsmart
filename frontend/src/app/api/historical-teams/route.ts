import { NextResponse } from "next/server";
import { db } from "@/db";
import { historicalMatches } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const league = searchParams.get("league")?.trim();

    // Query distinct home teams
    let query = db
      .selectDistinct({ team: historicalMatches.homeTeam })
      .from(historicalMatches);

    // Apply league filter if present
    if (league) {
      query = query.where(eq(historicalMatches.league, league)) as any;
    }

    const homeTeams = await query;

    const uniqueTeams = homeTeams
      .map((t) => t.team)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    return NextResponse.json({
      success: true,
      teams: uniqueTeams,
    });
  } catch (error: any) {
    console.error("[API] Failed to get unique teams:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
