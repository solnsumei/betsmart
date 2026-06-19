import { NextResponse } from "next/server";
import { db } from "@/db";
import { betSlips, bets, settings } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { selections, stake } = body;

    if (!selections || !Array.isArray(selections) || selections.length === 0) {
      return NextResponse.json({ error: "No selections provided." }, { status: 400 });
    }

    if (!stake || typeof stake !== "number" || stake <= 0) {
      return NextResponse.json({ error: "Invalid stake amount." }, { status: 400 });
    }

    // Fetch system settings for balance and simulation flag
    const config = await db.query.settings.findFirst();
    if (!config) {
      return NextResponse.json({ error: "System settings not configured." }, { status: 500 });
    }

    if (parseFloat(config.accountBalance) < stake) {
      return NextResponse.json(
        { error: `Insufficient balance. Available balance: ₦${parseFloat(config.accountBalance).toLocaleString()}` },
        { status: 400 }
      );
    }

    // Calculate combined total odds
    let totalOdds = 1.0;
    for (const sel of selections) {
      if (!sel.odds || typeof sel.odds !== "number" || sel.odds <= 0) {
        return NextResponse.json({ error: `Invalid odds for match: ${sel.matchId}` }, { status: 400 });
      }
      totalOdds *= sel.odds;
    }
    totalOdds = parseFloat(totalOdds.toFixed(2));

    // Place bet slip and bets in database transaction
    const result = await db.transaction(async (tx) => {
      // 1. Insert Bet Slip
      const [newSlip] = await tx
        .insert(betSlips)
        .values({
          stake: stake.toFixed(2),
          totalOdds: totalOdds.toFixed(2),
          status: "pending",
          isSimulation: config.isSimulation,
        })
        .returning();

      // 2. Insert Bets
      for (const sel of selections) {
        await tx.insert(bets).values({
          betSlipId: newSlip.id,
          matchId: sel.matchId,
          selection: sel.selection,
          odds: sel.odds.toFixed(2),
        });
      }

      // 3. Deduct Stake from Settings Balance
      const updatedBalance = parseFloat((parseFloat(config.accountBalance) - stake).toFixed(2));
      await tx
        .update(settings)
        .set({ accountBalance: updatedBalance.toFixed(2) })
        .where(eq(settings.id, config.id));

      return {
        success: true,
        slipId: newSlip.id,
        newBalance: updatedBalance,
      };
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Place bet slip API error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
