import { Worker } from "bullmq";
import { db } from "../db";
import { settings, matches, predictions, bets, betSlips, crawlTargets } from "../db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { crawlBet9ja } from "./scraper";
import { fetchHistoricStats, matchTeamName } from "./historical";
import { predictDoubleChance } from "./predictor";
import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";

const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
});

// Helper to get active configuration
async function getSettings() {
  let config = await db.query.settings.findFirst();
  if (!config) {
    // Insert default
    const [inserted] = await db.insert(settings).values({}).returning();
    config = inserted;
  }
  return config;
}

// 1. Odds Scraper Worker
export const oddsWorker = new Worker(
  "odds-crawl",
  async (job) => {
    console.log(`[Worker] Starting odds crawl job ${job.id}...`);
    const config = await getSettings();
    
    // Fetch active crawl targets
    let targets = await db.select().from(crawlTargets).where(eq(crawlTargets.enabled, true));
    
    // Seed with default if empty
    if (targets.length === 0) {
      const defaultUrl = config.crawlingUrl || "https://sports.bet9ja.com";
      console.log(`[Worker] No crawl targets found. Seeding with default: ${defaultUrl}`);
      const [seeded] = await db.insert(crawlTargets).values({
        name: "Bet9ja Default",
        url: defaultUrl,
        enabled: true,
      }).returning();
      targets = [seeded];
    }

    const scrapedMatchesRaw: any[] = [];
    for (const target of targets) {
      console.log(`[Worker] Running scraper on target: ${target.name} (${target.url})...`);
      try {
        const scraped = await crawlBet9ja(target.url);
        scrapedMatchesRaw.push(...scraped);
      } catch (error: any) {
        console.error(`[Worker] Scraper failed on target ${target.url}:`, error.message);
      }
    }

    // De-duplicate matches by ID
    const uniqueMatchesMap = new Map<string, any>();
    for (const m of scrapedMatchesRaw) {
      uniqueMatchesMap.set(m.id, m);
    }
    const scrapedMatches = Array.from(uniqueMatchesMap.values());
    
    console.log(`[Worker] Crawled ${scrapedMatches.length} matches. Syncing with database...`);
    
    for (const m of scrapedMatches) {
      // Trigger prediction job if no prediction exists yet
      const existingPrediction = await db.query.predictions.findFirst({
        where: eq(predictions.matchId, m.id),
      });

      if (!existingPrediction) {
        const { predictionQueue } = await import("./queue");
        await predictionQueue.add(`predict-${m.id}`, {
          match: {
            id: m.id,
            homeTeam: m.homeTeam,
            awayTeam: m.awayTeam,
            league: m.league,
            matchTime: m.matchTime instanceof Date ? m.matchTime.toISOString() : m.matchTime,
          },
          odds: {
            odds1X: m.odds1X,
            odds12: m.odds12,
            oddsX2: m.oddsX2,
          }
        });
        console.log(`[Worker] Queued prediction task for ${m.homeTeam} vs ${m.awayTeam}`);
      }
    }
  },
  { connection: connection as any }
);

// 2. Prediction Engine Worker
export const predictionWorker = new Worker(
  "predictions",
  async (job) => {
    const { match, odds: matchOdds } = job.data;
    console.log(`[Worker] Generating prediction for Match: ${match.homeTeam} vs ${match.awayTeam}...`);
    
    const config = await getSettings();

    try {
      // Call LLM
      const result = await predictDoubleChance(
        match.homeTeam,
        match.awayTeam,
        null,
        config.llmProvider,
        config.ollamaUrl,
        "",
        config.llmModel
      );

      console.log(`[Worker] Match predicted successfully: ${match.homeTeam} vs ${match.awayTeam} ➜ ${result.predictedOutcome} (${result.confidence}). Saving to DB...`);

      // 1. Save match (upsert with odds)
      await db.insert(matches)
        .values({
          id: match.id,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          league: match.league,
          matchTime: new Date(match.matchTime),
          status: "upcoming",
          odds1X: matchOdds.odds1X,
          odds12: matchOdds.odds12,
          oddsX2: matchOdds.oddsX2,
        })
        .onConflictDoUpdate({
          target: matches.id,
          set: {
            matchTime: new Date(match.matchTime),
            odds1X: matchOdds.odds1X,
            odds12: matchOdds.odds12,
            oddsX2: matchOdds.oddsX2,
            updatedAt: new Date(),
          },
        });

      // 3. Save prediction
      await db.insert(predictions).values({
        matchId: match.id,
        predictedOutcome: result.predictedOutcome,
        confidence: result.confidence,
        reasoning: result.reasoning,
      });

      // Check if auto-bet is enabled and attempt to create accumulator
      if (config.autoBetEnabled && result.predictedOutcome !== "NONE") {
        await attemptPlaceAccumulator(config);
      }
    } catch (error: any) {
      console.error(`[Worker] Prediction failed for ${match.homeTeam} vs ${match.awayTeam}, skipping save:`, error.message);
      // We do not rethrow the error, so the job is marked complete and skipped without retrying.
    }
  },
  { connection: connection as any }
);

// Helper to group predictions into accumulator slips and respect daily stake limits
async function attemptPlaceAccumulator(config: any) {
  // 1. Fetch all predictions that meet filters, are not yet associated with any bet, and are upcoming
  const qualifying = await db
    .select({
      prediction: predictions,
      match: matches,
    })
    .from(predictions)
    .innerJoin(matches, eq(predictions.matchId, matches.id))
    .leftJoin(bets, eq(bets.matchId, matches.id))
    .where(
      and(
        eq(matches.status, "upcoming"),
        sql`${bets.id} IS NULL`, // Has not been bet on yet
        sql`${predictions.confidence} >= ${config.minConfidence}`
      )
    );

  // Filter further in JavaScript to ensure odds are in target range
  const filtered = qualifying.filter((q) => {
    let selectionOdds = 0;
    if (q.prediction.predictedOutcome === "1X") selectionOdds = parseFloat(q.match.odds1X || "0");
    if (q.prediction.predictedOutcome === "12") selectionOdds = parseFloat(q.match.odds12 || "0");
    if (q.prediction.predictedOutcome === "X2") selectionOdds = parseFloat(q.match.oddsX2 || "0");
    return selectionOdds >= parseFloat(config.minOdds) && selectionOdds <= parseFloat(config.maxOdds);
  });

  const minSize = config.accumulatorMinSize;
  const maxSize = config.accumulatorMaxSize;

  if (filtered.length >= minSize) {
    // Take up to maxSize matches
    const selectionsToBet = filtered.slice(0, maxSize);

    // Calculate total combined odds
    let totalOdds = 1;
    const items = selectionsToBet.map((s) => {
      let selectionOdds = 1;
      if (s.prediction.predictedOutcome === "1X") selectionOdds = parseFloat(s.match.odds1X || "1");
      if (s.prediction.predictedOutcome === "12") selectionOdds = parseFloat(s.match.odds12 || "1");
      if (s.prediction.predictedOutcome === "X2") selectionOdds = parseFloat(s.match.oddsX2 || "1");

      totalOdds *= selectionOdds;
      return {
        matchId: s.match.id,
        selection: s.prediction.predictedOutcome,
        odds: selectionOdds,
      };
    });

    totalOdds = parseFloat(totalOdds.toFixed(2));

    // Calculate daily limit
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [{ sum }] = await db
      .select({ sum: sql<number>`COALESCE(sum(${betSlips.stake}), 0)` })
      .from(betSlips)
      .where(sql`${betSlips.placedAt} >= ${today}`);

    const maxDailyStake = parseFloat(config.accountBalance) * config.maxDailyStakePercent;

    if (sum + parseFloat(config.stake) > maxDailyStake) {
      console.warn(`[Risk Manager] Cannot place bet slip: Daily limit exceeded. Staked today: ₦${sum}, Limit: ₦${maxDailyStake}`);
      return;
    }

    if (parseFloat(config.accountBalance) < parseFloat(config.stake)) {
      console.warn(`[Risk Manager] Cannot place bet slip: Insufficient balance. Balance: ₦${config.accountBalance}, Stake: ₦${config.stake}`);
      return;
    }

    // Place bet slip
    await db.transaction(async (tx) => {
      const [slip] = await tx
        .insert(betSlips)
        .values({
          stake: config.stake,
          totalOdds: totalOdds.toFixed(2),
          status: "pending",
          isSimulation: config.isSimulation,
        })
        .returning();

      for (const item of items) {
        await tx.insert(bets).values({
          betSlipId: slip.id,
          matchId: item.matchId,
          selection: item.selection,
          odds: item.odds.toFixed(2),
        });
      }

      // Deduct from balance
      await tx
        .update(settings)
        .set({
          accountBalance: sql`${settings.accountBalance} - ${config.stake}`,
        })
        .where(eq(settings.id, config.id));
    });

    console.log(`[Worker] Placed simulation parlay/accumulator bet slip with ${items.length} games. Stake: ₦${config.stake}, Combined Odds: ${totalOdds}`);
  }
}

// 3. Match Result Settle Worker
export const settleWorker = new Worker(
  "settle-results",
  async (job) => {
    console.log("[Worker] Starting match outcome settlement check...");
    const config = await getSettings();
    
    if (!config.historicDataApiKey) {
      console.log("[Worker] Skip settlement: No football API key provided.");
      return;
    }

    // Fetch pending bet slips
    const pendingSlips = await db.query.betSlips.findMany({
      where: eq(betSlips.status, "pending"),
    });

    if (pendingSlips.length === 0) {
      console.log("[Worker] No pending bet slips to settle.");
      return;
    }

    // Identify which leagues we have active matches for
    const activeBets = await db
      .select({
        bet: bets,
        match: matches,
      })
      .from(bets)
      .innerJoin(matches, eq(bets.matchId, matches.id))
      .where(
        sql`${bets.betSlipId} IN (${sql.raw(
          pendingSlips.map((s) => s.id).join(",")
        )})`
      );

    const compCode = "PL"; // Defaulting to Premier League
    const url = `${config.historicDataApiUrl}/competitions/${compCode}/matches?status=FINISHED`;
    
    try {
      console.log(`[Worker] Querying finished matches from ${url}`);
      const res = await fetch(url, {
        headers: { "X-Auth-Token": config.historicDataApiKey },
      });

      if (!res.ok) {
        throw new Error(`Football API returned status: ${res.status}`);
      }

      const data = await res.json();
      const finishedMatches: any[] = data.matches || [];

      // Map API outcomes to database matches
      for (const betItem of activeBets) {
        const matchData = betItem.match;
        if (matchData.status === "completed") continue; // Already resolved

        const matchedApi = finishedMatches.find(
          (m) =>
            matchTeamName(m.homeTeam.name, matchData.homeTeam) &&
            matchTeamName(m.awayTeam.name, matchData.awayTeam)
        );

        if (matchedApi) {
          const homeGoals = matchedApi.score.fullTime.home;
          const awayGoals = matchedApi.score.fullTime.away;
          
          let result = "X";
          if (homeGoals > awayGoals) result = "1";
          if (homeGoals < awayGoals) result = "2";

          let doubleChanceResult = "";
          if (result === "1") doubleChanceResult = "1X,12";
          else if (result === "2") doubleChanceResult = "12,X2";
          else doubleChanceResult = "1X,X2";

          await db
            .update(matches)
            .set({
              status: "completed",
              result,
              doubleChanceResult,
              updatedAt: new Date(),
            })
            .where(eq(matches.id, matchData.id));

          console.log(`[Worker] Settle Match: ${matchData.homeTeam} vs ${matchData.awayTeam} resolved to ${result} (${doubleChanceResult})`);
        }
      }

      // Re-evaluate pending bet slips
      for (const slip of pendingSlips) {
        const slipBets = await db
          .select({
            bet: bets,
            match: matches,
          })
          .from(bets)
          .innerJoin(matches, eq(bets.matchId, matches.id))
          .where(eq(bets.betSlipId, slip.id));

        const allFinished = slipBets.every((b) => b.match.status === "completed");
        
        if (allFinished) {
          let wonSlip = true;
          for (const b of slipBets) {
            const dcResult = b.match.doubleChanceResult || "";
            if (!dcResult.includes(b.bet.selection)) {
              wonSlip = false;
              break;
            }
          }

          const slipStatus = wonSlip ? "won" : "lost";
          const payout = wonSlip ? parseFloat((parseFloat(slip.stake) * parseFloat(slip.totalOdds)).toFixed(2)) : 0;

          await db.transaction(async (tx) => {
            await tx
              .update(betSlips)
              .set({
                status: slipStatus,
                payout: payout.toFixed(2),
              })
              .where(eq(betSlips.id, slip.id));

            if (wonSlip) {
              // Add payout to balance
              await tx
                .update(settings)
                .set({
                  accountBalance: sql`${settings.accountBalance} + ${payout}`,
                })
                .where(eq(settings.id, config.id));
            }
          });

          console.log(`[Worker] Settle Bet Slip #${slip.id}: Marked as ${slipStatus.toUpperCase()}. Payout: ₦${payout}`);
        }
      }
    } catch (err) {
      console.error("[Worker] Settle results request failed:", err);
    }
  },
  { connection: connection as any }
);

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("Shutting down workers...");
  await oddsWorker.close();
  await predictionWorker.close();
  await settleWorker.close();
  await connection.quit();
});
