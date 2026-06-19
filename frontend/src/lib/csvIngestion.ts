import { db } from "../db";
import { historicalMatches } from "../db/schema";
import { eq } from "drizzle-orm";

interface CSVMatchRow {
  league: string;
  date: Date;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  result: string;
  homeShots: number;
  awayShots: number;
  homeShotsOnTarget: number;
  awayShotsOnTarget: number;
  homeCorners: number;
  awayCorners: number;
  homeFouls: number;
  awayFouls: number;
}

const LEAGUE_CODES: Record<string, string> = {
  "Premier League": "E0",
  "Championship": "E1",
  "La Liga": "SP1",
  "Serie A": "I1",
  "Bundesliga": "D1",
  "Ligue 1": "F1",
};

// Parse date format "DD/MM/YY" or "DD/MM/YYYY"
function parseCSVDate(dateStr: string): Date {
  const parts = dateStr.trim().split("/");
  if (parts.length !== 3) return new Date();
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  let year = parseInt(parts[2], 10);
  if (year < 100) {
    year += 2000;
  }
  return new Date(year, month, day);
}

export async function ingestLeagueCSV(leagueName: string, seasonCode: string = "2526", clearExisting: boolean = true) {
  const leagueCode = LEAGUE_CODES[leagueName];
  if (!leagueCode) {
    throw new Error(`Unsupported league for CSV ingest: ${leagueName}`);
  }

  const csvUrl = `https://www.football-data.co.uk/mmz4281/${seasonCode}/${leagueCode}.csv`;
  console.log(`[CSV Ingest] Fetching CSV from: ${csvUrl}`);

  const res = await fetch(csvUrl);
  if (!res.ok) {
    throw new Error(`Failed to download CSV from ${csvUrl}: ${res.statusText}`);
  }

  const csvText = await res.text();
  const lines = csvText.split("\n");
  if (lines.length <= 1) {
    throw new Error(`CSV file from ${csvUrl} is empty or invalid.`);
  }

  // Parse Header
  const headers = lines[0].split(",").map((h) => h.trim());
  const idx = {
    Date: headers.indexOf("Date"),
    HomeTeam: headers.indexOf("HomeTeam"),
    AwayTeam: headers.indexOf("AwayTeam"),
    FTHG: headers.indexOf("FTHG"),
    FTAG: headers.indexOf("FTAG"),
    FTR: headers.indexOf("FTR"),
    HS: headers.indexOf("HS"),
    AS: headers.indexOf("AS"),
    HST: headers.indexOf("HST"),
    AST: headers.indexOf("AST"),
    HC: headers.indexOf("HC"),
    AC: headers.indexOf("AC"),
    HF: headers.indexOf("HF"),
    AF: headers.indexOf("AF"),
  };

  if (idx.Date === -1 || idx.HomeTeam === -1 || idx.AwayTeam === -1) {
    throw new Error("CSV structure missing critical headers (Date, HomeTeam, AwayTeam).");
  }

  const records: CSVMatchRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const row = line.split(",").map((cell) => cell.trim());
    if (row.length < headers.length) continue; // Skip truncated rows

    const homeTeam = row[idx.HomeTeam];
    const awayTeam = row[idx.AwayTeam];
    if (!homeTeam || !awayTeam) continue;

    const date = parseCSVDate(row[idx.Date]);
    const homeGoals = parseInt(row[idx.FTHG], 10);
    const awayGoals = parseInt(row[idx.FTAG], 10);
    const result = row[idx.FTR]; // 'H', 'D', 'A'

    if (isNaN(homeGoals) || isNaN(awayGoals) || !result) continue;

    records.push({
      league: leagueName,
      date,
      homeTeam,
      awayTeam,
      homeGoals,
      awayGoals,
      result,
      homeShots: idx.HS !== -1 ? parseInt(row[idx.HS], 10) || 0 : 0,
      awayShots: idx.AS !== -1 ? parseInt(row[idx.AS], 10) || 0 : 0,
      homeShotsOnTarget: idx.HST !== -1 ? parseInt(row[idx.HST], 10) || 0 : 0,
      awayShotsOnTarget: idx.AST !== -1 ? parseInt(row[idx.AST], 10) || 0 : 0,
      homeCorners: idx.HC !== -1 ? parseInt(row[idx.HC], 10) || 0 : 0,
      awayCorners: idx.AC !== -1 ? parseInt(row[idx.AC], 10) || 0 : 0,
      homeFouls: idx.HF !== -1 ? parseInt(row[idx.HF], 10) || 0 : 0,
      awayFouls: idx.AF !== -1 ? parseInt(row[idx.AF], 10) || 0 : 0,
    });
  }

  console.log(`[CSV Ingest] Parsed ${records.length} matches for ${leagueName} (Season ${seasonCode}). Saving to database...`);

  if (clearExisting) {
    // Clear existing entries for this league to avoid duplicates
    await db.delete(historicalMatches).where(eq(historicalMatches.league, leagueName));
  }

  // Bulk Insert
  if (records.length > 0) {
    // Insert in chunks of 100 to avoid query parameter limit in postgres
    const chunkSize = 100;
    for (let i = 0; i < records.length; i += chunkSize) {
      const chunk = records.slice(i, i + chunkSize);
      await db.insert(historicalMatches).values(chunk);
    }
  }

  console.log(`[CSV Ingest] Ingestion complete for ${leagueName} (Season ${seasonCode}).`);
  return records.length;
}

export async function syncAllActiveLeagues(seasonsOverride?: string[]) {
  const activeLeagues = ["Premier League", "Championship", "La Liga", "Serie A", "Bundesliga", "Ligue 1"];
  
  let seasons = seasonsOverride;
  if (!seasons) {
    try {
      const config = await db.query.settings.findFirst();
      if (config?.seasonsToSync) {
        seasons = config.seasonsToSync.split(",").map(s => s.trim()).filter(Boolean);
      }
    } catch (error: any) {
      console.error("[CSV Ingest] Failed to fetch settings for seasons configuration, using defaults:", error.message);
    }
  }

  // Fallback to default seasons if none configured or fetched
  if (!seasons || seasons.length === 0) {
    seasons = ["2526", "2425", "2324", "2223", "2122", "2021"];
  }

  let totalSaved = 0;

  for (const league of activeLeagues) {
    console.log(`[CSV Ingest] Starting historical sync for league: ${league} (Seasons: ${seasons.join(", ")})...`);
    
    // Clear the league once before importing all seasons to prevent duplication
    try {
      await db.delete(historicalMatches).where(eq(historicalMatches.league, league));
    } catch (e: any) {
      console.error(`[CSV Ingest] Failed to clear ${league} data:`, e.message);
      continue;
    }

    for (const season of seasons) {
      try {
        // Load season data, clearExisting = false to append
        const count = await ingestLeagueCSV(league, season, false);
        totalSaved += count;
      } catch (e: any) {
        console.error(`[CSV Ingest] Failed to ingest ${league} for season ${season}:`, e.message);
      }
    }
  }
  return totalSaved;
}
