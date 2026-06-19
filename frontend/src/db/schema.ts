import { pgTable, serial, text, real, timestamp, boolean, doublePrecision, integer, jsonb } from "drizzle-orm/pg-core";

export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  crawlingUrl: text("crawling_url").notNull().default("https://web.bet9ja.com"),
  historicDataApiUrl: text("historic_data_api_url").notNull().default("https://api.football-data.org/v4"),
  historicDataApiKey: text("historic_data_api_key").notNull().default(""),
  minOdds: doublePrecision("min_odds").notNull().default(1.15),
  maxOdds: doublePrecision("max_odds").notNull().default(1.50),
  minConfidence: doublePrecision("min_confidence").notNull().default(0.70),
  stake: doublePrecision("stake").notNull().default(1000.0),
  ollamaUrl: text("ollama_url").notNull().default("http://127.0.0.1:11434"),
  llmProvider: text("llm_provider").notNull().default("ollama"), // 'ollama' or 'groq'
  llmModel: text("llm_model").notNull().default("llama3"),
  isSimulation: boolean("is_simulation").notNull().default(true),
  autoBetEnabled: boolean("auto_bet_enabled").notNull().default(false),
  accumulatorMinSize: integer("accumulator_min_size").notNull().default(2),
  accumulatorMaxSize: integer("accumulator_max_size").notNull().default(5),
  targetAccuracy: doublePrecision("target_accuracy").notNull().default(0.90),
  accountBalance: doublePrecision("account_balance").notNull().default(50000.0),
  maxDailyStakePercent: doublePrecision("max_daily_stake_percent").notNull().default(0.10),
  seasonsToSync: text("seasons_to_sync").notNull().default("2526,2425,2324,2223,2122,2021"),
  cacheTime: integer("cache_time").notNull().default(120), // in minutes
  pipelineFrequency: integer("pipeline_frequency").notNull().default(30), // in minutes
});

export const matches = pgTable("matches", {
  id: text("id").primaryKey(), // Custom ID e.g., 'Premier League-Arsenal-Chelsea-2026-06-17'
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  league: text("league").notNull(),
  matchTime: timestamp("match_time", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("upcoming"), // 'upcoming', 'completed', 'cancelled'
  result: text("result"), // '1', 'X', '2'
  doubleChanceResult: text("double_chance_result"), // '1X', '12', 'X2'
  odds1X: doublePrecision("odds_1x"),
  odds12: doublePrecision("odds_12"),
  oddsX2: doublePrecision("odds_x2"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const predictions = pgTable("predictions", {
  id: serial("id").primaryKey(),
  matchId: text("match_id").references(() => matches.id, { onDelete: "cascade" }).notNull(),
  predictedOutcome: text("predicted_outcome").notNull(), // '1X', '12', 'X2', 'NONE'
  confidence: doublePrecision("confidence").notNull(), // 0.0 to 1.0
  reasoning: text("reasoning").notNull(),
  predictedAt: timestamp("predicted_at", { withTimezone: true }).defaultNow().notNull(),
});

export const betSlips = pgTable("bet_slips", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("pending"), // 'pending', 'won', 'lost'
  stake: doublePrecision("stake").notNull(),
  totalOdds: doublePrecision("total_odds").notNull(),
  placedAt: timestamp("placed_at", { withTimezone: true }).defaultNow().notNull(),
  payout: doublePrecision("payout"),
  isSimulation: boolean("is_simulation").notNull().default(true),
});

export const bets = pgTable("bets", {
  id: serial("id").primaryKey(),
  betSlipId: integer("bet_slip_id").references(() => betSlips.id, { onDelete: "cascade" }).notNull(),
  matchId: text("match_id").references(() => matches.id, { onDelete: "cascade" }).notNull(),
  selection: text("selection").notNull(), // '1X', '12', 'X2'
  odds: doublePrecision("odds").notNull(),
  status: text("status").notNull().default("pending"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  placedAt: timestamp("placed_at", { withTimezone: true }).defaultNow().notNull(),
});

export const historicalMatches = pgTable("historical_matches", {
  id: serial("id").primaryKey(),
  league: text("league").notNull(),
  date: timestamp("date").notNull(),
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  homeGoals: integer("home_goals").notNull(),
  awayGoals: integer("away_goals").notNull(),
  result: text("result").notNull(), // 'H', 'D', 'A'
  homeShots: integer("home_shots"),
  awayShots: integer("away_shots"),
  homeShotsOnTarget: integer("home_shots_on_target"),
  awayShotsOnTarget: integer("away_shots_on_target"),
  homeCorners: integer("home_corners"),
  awayCorners: integer("away_corners"),
  homeFouls: integer("home_fouls"),
  awayFouls: integer("away_fouls"),
});

export const crawlTargets = pgTable("crawl_targets", {
  id: serial("id").primaryKey(),
  url: text("url").notNull(),
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const crawlRuns = pgTable("crawl_runs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  durationSeconds: doublePrecision("duration_seconds").notNull(),
  status: text("status").notNull(), // 'success', 'failed'
  runMetadata: jsonb("run_metadata").default({}), // flexible stats: { matchesFound: number, matchesSkipped: number, targetsCrawled: string[] }
});
