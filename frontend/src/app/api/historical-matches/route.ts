import { NextResponse } from "next/server";
import { db } from "@/db";
import { historicalMatches } from "@/db/schema";
import { eq, or, and, sql, desc, ilike } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const teamA = searchParams.get("teamA")?.trim();
    const teamB = searchParams.get("teamB")?.trim();
    const league = searchParams.get("league")?.trim();
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const offset = (page - 1) * limit;

    // 1. Double Opponent Comparison (H2H)
    if (teamA && teamB) {
      // Find matches between these two teams
      // We look for matches where (Home=A AND Away=B) OR (Home=B AND Away=A)
      // Since team names can be typed in slightly different casing, we use case-insensitive eq or ilike
      const h2hMatches = await db
        .select()
        .from(historicalMatches)
        .where(
          or(
            and(
              ilike(historicalMatches.homeTeam, teamA),
              ilike(historicalMatches.awayTeam, teamB)
            ),
            and(
              ilike(historicalMatches.homeTeam, teamB),
              ilike(historicalMatches.awayTeam, teamA)
            )
          )
        )
        .orderBy(desc(historicalMatches.date));

      let totalGames = h2hMatches.length;
      let teamAWins = 0;
      let teamBWins = 0;
      let draws = 0;
      let teamAGoals = 0;
      let teamBGoals = 0;

      for (const m of h2hMatches) {
        const isHomeA = m.homeTeam.toLowerCase() === teamA.toLowerCase();
        if (m.result === "H") {
          if (isHomeA) {
            teamAWins++;
          } else {
            teamBWins++;
          }
        } else if (m.result === "A") {
          if (isHomeA) {
            teamBWins++;
          } else {
            teamAWins++;
          }
        } else {
          draws++;
        }

        if (isHomeA) {
          teamAGoals += m.homeGoals;
          teamBGoals += m.awayGoals;
        } else {
          teamAGoals += m.awayGoals;
          teamBGoals += m.homeGoals;
        }
      }

      // Fetch recent form (last 10 matches) for Team A
      const teamAAll = await db
        .select()
        .from(historicalMatches)
        .where(or(ilike(historicalMatches.homeTeam, teamA), ilike(historicalMatches.awayTeam, teamA)))
        .orderBy(desc(historicalMatches.date))
        .limit(10);

      // Fetch recent form (last 10 matches) for Team B
      const teamBAll = await db
        .select()
        .from(historicalMatches)
        .where(or(ilike(historicalMatches.homeTeam, teamB), ilike(historicalMatches.awayTeam, teamB)))
        .orderBy(desc(historicalMatches.date))
        .limit(10);

      // Map form (W, D, L) from Team A's perspective
      const teamAForm = teamAAll.map(m => {
        const isHome = m.homeTeam.toLowerCase() === teamA.toLowerCase();
        if (m.result === "D") return "D";
        if (m.result === "H") return isHome ? "W" : "L";
        return isHome ? "L" : "W";
      });

      const teamBForm = teamBAll.map(m => {
        const isHome = m.homeTeam.toLowerCase() === teamB.toLowerCase();
        if (m.result === "D") return "D";
        if (m.result === "H") return isHome ? "W" : "L";
        return isHome ? "L" : "W";
      });

      return NextResponse.json({
        type: "h2h",
        teamA,
        teamB,
        stats: {
          totalGames,
          teamAWins,
          teamBWins,
          draws,
          teamAGoals,
          teamBGoals,
        },
        h2hMatches,
        teamAForm: {
          recentMatches: teamAAll,
          form: teamAForm,
        },
        teamBForm: {
          recentMatches: teamBAll,
          form: teamBForm,
        }
      });
    }

    // 2. Single Team / General Match Search
    let conditions = [];
    if (teamA) {
      conditions.push(or(
        ilike(historicalMatches.homeTeam, `%${teamA}%`),
        ilike(historicalMatches.awayTeam, `%${teamA}%`)
      ));
    }
    if (league) {
      conditions.push(eq(historicalMatches.league, league));
    }

    const whereClause = conditions.length > 0 ? (conditions.length === 1 ? conditions[0] : and(...conditions)) : undefined;

    // Get total count
    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(historicalMatches)
      .where(whereClause);
    const totalCount = countResult?.count || 0;

    // Get paginated matches
    const matchesList = await db
      .select()
      .from(historicalMatches)
      .where(whereClause)
      .orderBy(desc(historicalMatches.date))
      .limit(limit)
      .offset(offset);

    // If a single team is queried, calculate overall stats from their full history
    let teamStats = null;
    if (teamA) {
      const allTeamMatches = await db
        .select()
        .from(historicalMatches)
        .where(or(ilike(historicalMatches.homeTeam, teamA), ilike(historicalMatches.awayTeam, teamA)));

      let wins = 0;
      let draws = 0;
      let losses = 0;
      let goalsScored = 0;
      let goalsConceded = 0;

      for (const m of allTeamMatches) {
        const isHome = m.homeTeam.toLowerCase() === teamA.toLowerCase();
        const score = isHome ? [m.homeGoals, m.awayGoals] : [m.awayGoals, m.homeGoals];
        goalsScored += score[0];
        goalsConceded += score[1];

        if (m.result === "D") {
          draws++;
        } else if (m.result === "H") {
          if (isHome) wins++; else losses++;
        } else {
          if (isHome) losses++; else wins++;
        }
      }

      teamStats = {
        total: allTeamMatches.length,
        wins,
        draws,
        losses,
        goalsScored,
        goalsConceded,
      };
    }

    return NextResponse.json({
      type: "list",
      teamA,
      matches: matchesList,
      pagination: {
        total: totalCount,
        page,
        limit,
        pages: Math.ceil(totalCount / limit),
      },
      teamStats,
    });
  } catch (error: any) {
    console.error("[API] Failed to fetch historical matches:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
