import { db } from "../db";
import { historicalMatches } from "../db/schema";
import { eq, or, and, ilike } from "drizzle-orm";

// Helper for fuzzy team name matching (e.g. "Man Utd" vs "Manchester United FC")
export function matchTeamName(name1: string, name2: string): boolean {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // remove accents
      .replace(/[^a-z0-9]/g, " ") // keep letters and numbers
      .replace(/\b(fc|sc|club|united|city|town|athletic|real|de|cf|athletico|deportivo|ac|as|ca)\b/g, "")
      .replace(/\s+/g, "")
      .trim();

  const c1 = clean(name1);
  const c2 = clean(name2);

  return c1 === c2 || c1.includes(c2) || c2.includes(c1);
}

export async function queryHistoricalStats(homeTeam: string, awayTeam: string) {
  try {
    console.log(`[Database Query] Fetching historical stats for: ${homeTeam} vs ${awayTeam}`);

    // Extract clean keyword (e.g., "Arsenal FC" -> "Arsenal") to pre-filter in SQL
    const getCleanKeyword = (name: string) => {
      const cleaned = name
        .replace(/\b(fc|sc|club|united|city|town|athletic|real|de|cf|athletico|deportivo|ac|as|ca)\b/gi, "")
        .replace(/[^a-zA-Z0-9]/g, " ")
        .trim();
      return cleaned.split(/\s+/)[0] || name;
    };

    const keywordHome = getCleanKeyword(homeTeam);
    const keywordAway = getCleanKeyword(awayTeam);

    console.log(`[Database Query] Pre-filtering in SQL with keywords: "${keywordHome}", "${keywordAway}"`);

    // Fetch only matching rows from DB (extremely fast, avoids full table scan in JS)
    const dbMatches = await db
      .select()
      .from(historicalMatches)
      .where(
        or(
          ilike(historicalMatches.homeTeam, `%${keywordHome}%`),
          ilike(historicalMatches.awayTeam, `%${keywordHome}%`),
          ilike(historicalMatches.homeTeam, `%${keywordAway}%`),
          ilike(historicalMatches.awayTeam, `%${keywordAway}%`)
        )
      );

    console.log(`[Database Query] Retrieved ${dbMatches.length} candidate rows. Running fuzzy matching...`);

    // Filter matches involving homeTeam or awayTeam in memory using the fast subset
    const homeMatches = dbMatches.filter(
      (m) => matchTeamName(m.homeTeam, homeTeam) || matchTeamName(m.awayTeam, homeTeam)
    );
    const awayMatches = dbMatches.filter(
      (m) => matchTeamName(m.homeTeam, awayTeam) || matchTeamName(m.awayTeam, awayTeam)
    );

    // Get last 5 matches for Home Team
    const homeRecent = homeMatches.slice(-5).reverse();
    const homeForm: string[] = [];
    let homeScored = 0;
    let homeConceded = 0;
    let homeShots = 0;
    let homeShotsOnTarget = 0;
    let homeCorners = 0;

    homeRecent.forEach((m) => {
      const isHome = matchTeamName(m.homeTeam, homeTeam);
      const goals = isHome ? m.homeGoals : m.awayGoals;
      const oppGoals = isHome ? m.awayGoals : m.homeGoals;
      
      homeScored += goals;
      homeConceded += oppGoals;
      homeShots += isHome ? (m.homeShots || 0) : (m.awayShots || 0);
      homeShotsOnTarget += isHome ? (m.homeShotsOnTarget || 0) : (m.awayShotsOnTarget || 0);
      homeCorners += isHome ? (m.homeCorners || 0) : (m.awayCorners || 0);

      if (goals > oppGoals) homeForm.push("W");
      else if (goals < oppGoals) homeForm.push("L");
      else homeForm.push("D");
    });

    // Get last 5 matches for Away Team
    const awayRecent = awayMatches.slice(-5).reverse();
    const awayForm: string[] = [];
    let awayScored = 0;
    let awayConceded = 0;
    let awayShots = 0;
    let awayShotsOnTarget = 0;
    let awayCorners = 0;

    awayRecent.forEach((m) => {
      const isAway = matchTeamName(m.awayTeam, awayTeam);
      const goals = isAway ? m.awayGoals : m.homeGoals;
      const oppGoals = isAway ? m.homeGoals : m.awayGoals;

      awayScored += goals;
      awayConceded += oppGoals;
      awayShots += isAway ? (m.awayShots || 0) : (m.homeShots || 0);
      awayShotsOnTarget += isAway ? (m.awayShotsOnTarget || 0) : (m.homeShotsOnTarget || 0);
      awayCorners += isAway ? (m.awayCorners || 0) : (m.homeCorners || 0);

      if (goals > oppGoals) awayForm.push("W");
      else if (goals < oppGoals) awayForm.push("L");
      else awayForm.push("D");
    });

    // H2H
    const h2h = dbMatches.filter(
      (m) =>
        (matchTeamName(m.homeTeam, homeTeam) && matchTeamName(m.awayTeam, awayTeam)) ||
        (matchTeamName(m.homeTeam, awayTeam) && matchTeamName(m.awayTeam, homeTeam))
    );

    const h2hLogs = h2h.slice(-5).map((m) => {
      return `Date: ${m.date.toISOString().split("T")[0]} - ${m.homeTeam} ${m.homeGoals} vs ${m.awayGoals} ${m.awayTeam} (Winner: ${m.result})`;
    });

    if (homeRecent.length === 0 && awayRecent.length === 0) {
      return "No historical match records found in local database. Please trigger CSV sync in settings or query web search for info.";
    }

    return {
      homeTeamStats: {
        name: homeTeam,
        recentForm: homeForm,
        avgGoalsScored: parseFloat((homeScored / Math.max(1, homeRecent.length)).toFixed(2)),
        avgGoalsConceded: parseFloat((homeConceded / Math.max(1, homeRecent.length)).toFixed(2)),
        avgShots: parseFloat((homeShots / Math.max(1, homeRecent.length)).toFixed(2)),
        avgShotsOnTarget: parseFloat((homeShotsOnTarget / Math.max(1, homeRecent.length)).toFixed(2)),
        avgCorners: parseFloat((homeCorners / Math.max(1, homeRecent.length)).toFixed(2)),
      },
      awayTeamStats: {
        name: awayTeam,
        recentForm: awayForm,
        avgGoalsScored: parseFloat((awayScored / Math.max(1, awayRecent.length)).toFixed(2)),
        avgGoalsConceded: parseFloat((awayConceded / Math.max(1, awayRecent.length)).toFixed(2)),
        avgShots: parseFloat((awayShots / Math.max(1, awayRecent.length)).toFixed(2)),
        avgShotsOnTarget: parseFloat((awayShotsOnTarget / Math.max(1, awayRecent.length)).toFixed(2)),
        avgCorners: parseFloat((awayCorners / Math.max(1, awayRecent.length)).toFixed(2)),
      },
      headToHead: h2hLogs.length > 0 ? h2hLogs.join("\n") : "No recent head-to-head encounters found in database.",
    };
  } catch (error: any) {
    console.error("[Database Stats Error]", error);
    return `Failed to query historical stats from local database: ${error.message}`;
  }
}

// Deprecated fallback loader for compatibility if referenced elsewhere
export async function fetchHistoricStats(
  homeTeam: string,
  awayTeam: string,
  apiUrl: string,
  apiKey: string
) {
  return await queryHistoricalStats(homeTeam, awayTeam);
}
