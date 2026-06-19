import { NextResponse } from "next/server";
import { db } from "@/db";
import { bets, predictions, matches, betSlips } from "@/db/schema";
import { desc, eq, and } from "drizzle-orm";

export async function GET() {
  try {
    const allSlips = await db.select().from(betSlips).orderBy(desc(betSlips.placedAt));
    const allPredictions = await db.query.predictions.findMany({
      orderBy: [desc(predictions.predictedAt)],
    });

    const allMatches = await db.select().from(matches);
    const allBets = await db.select().from(bets);

    const matchMap = new Map(allMatches.map((m) => [m.id, m]));
    
    // Group bets by their slip ID
    const betsBySlipMap = new Map<number, any[]>();
    allBets.forEach((b) => {
      const match = matchMap.get(b.matchId);
      const item = {
        id: b.id,
        homeTeam: match?.homeTeam || "Unknown Team",
        awayTeam: match?.awayTeam || "Unknown Team",
        league: match?.league || "Unknown League",
        matchTime: match?.matchTime || new Date(),
        kickoffTime: match?.matchTime || new Date(),
        selection: b.selection,
        odds: b.odds,
        status: b.status,
        updatedAt: b.updatedAt,
      };

      const existing = betsBySlipMap.get(b.betSlipId) || [];
      existing.push(item);
      betsBySlipMap.set(b.betSlipId, existing);
    });

    const totalBetsCount = allSlips.length;
    const settledSlips = allSlips.filter((s) => s.status !== "pending");
    const pendingSlips = allSlips.filter((s) => s.status === "pending");
    const winsCount = settledSlips.filter((s) => s.status === "won").length;
    const lossesCount = settledSlips.filter((s) => s.status === "lost").length;

    const winRate = settledSlips.length > 0 ? parseFloat(((winsCount / settledSlips.length) * 100).toFixed(1)) : 0;

    let totalStaked = 0;
    let totalReturned = 0;
    settledSlips.forEach((s) => {
      totalStaked += s.stake;
      totalReturned += s.status === "won" ? s.payout || 0 : 0;
    });

    const netProfit = parseFloat((totalReturned - totalStaked).toFixed(2));
    const roi = totalStaked > 0 ? parseFloat(((netProfit / totalStaked) * 100).toFixed(1)) : 0;

    const sortedSettled = [...settledSlips].sort((a, b) => a.placedAt.getTime() - b.placedAt.getTime());
    let cumulative = 0;
    const chartData = sortedSettled.map((s) => {
      const profit = s.status === "won" ? (s.payout || 0) - s.stake : -s.stake;
      cumulative += profit;
      return {
        date: s.placedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        profit: parseFloat(cumulative.toFixed(2)),
      };
    });

    if (chartData.length === 0) {
      chartData.push({ date: "Start", profit: 0 });
    }

    const placedMatchIds = new Set(allBets.map((b) => b.matchId));

    const mappedPredictions = allPredictions.map((p) => {
      const match = matchMap.get(p.matchId);
      return {
        id: p.id,
        matchId: p.matchId,
        homeTeam: match?.homeTeam || "Unknown Team",
        awayTeam: match?.awayTeam || "Unknown Team",
        league: match?.league || "Unknown League",
        matchTime: match?.matchTime || new Date(),
        predictedOutcome: p.predictedOutcome,
        confidence: p.confidence,
        reasoning: p.reasoning,
        odds1X: match?.odds1X || null,
        odds12: match?.odds12 || null,
        oddsX2: match?.oddsX2 || null,
        predictedAt: p.predictedAt,
        status: match?.status || "upcoming",
        hasBet: placedMatchIds.has(p.matchId),
        result: match?.result || null,
        doubleChanceResult: match?.doubleChanceResult || null,
      };
    });
    
    const filteredPredictions = mappedPredictions.filter((p) => {
      const isElapsed = new Date(p.matchTime).getTime() <= Date.now();
      if (isElapsed && !p.hasBet) {
        return false;
      }
      return true;
    });
    
    // Sort predictions in descending order of kickoff time
    filteredPredictions.sort((a, b) => new Date(b.matchTime).getTime() - new Date(a.matchTime).getTime());

    const mappedPendingBets = pendingSlips.map((s) => {
      return {
        id: s.id,
        stake: s.stake,
        totalOdds: s.totalOdds,
        placedAt: s.placedAt,
        selections: betsBySlipMap.get(s.id) || [],
      };
    });

    const mappedPastBets = settledSlips.map((s) => {
      const payoutVal = s.payout || 0;
      return {
        id: s.id,
        stake: s.stake,
        totalOdds: s.totalOdds,
        status: s.status,
        placedAt: s.placedAt,
        profit: s.status === "won" ? parseFloat((payoutVal - s.stake).toFixed(2)) : -s.stake,
        selections: betsBySlipMap.get(s.id) || [],
      };
    });

    return NextResponse.json({
      summary: {
        totalBets: totalBetsCount,
        wins: winsCount,
        losses: lossesCount,
        winRate,
        netProfit,
        roi,
      },
      chartData,
      pendingBets: mappedPendingBets,
      pastBets: mappedPastBets,
      predictions: filteredPredictions,
    });
  } catch (error: any) {
    console.error("Dashboard endpoint error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
