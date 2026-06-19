import { NextResponse } from "next/server";
import { syncAllActiveLeagues } from "@/lib/csvIngestion";

export async function POST(request: Request) {
  try {
    console.log("[API] Starting historical CSV synchronization...");
    let seasons: string[] | undefined = undefined;
    try {
      const body = await request.json();
      if (body && Array.isArray(body.seasons)) {
        seasons = body.seasons;
      }
    } catch {
      // Request might not have a body, ignore
    }

    const count = await syncAllActiveLeagues(seasons);
    return NextResponse.json({
      success: true,
      message: `Successfully synchronized ${count} historical match records from football-data.co.uk.`,
      count,
    });
  } catch (error: any) {
    console.error("[API] CSV Synchronization failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
