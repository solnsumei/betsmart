CREATE TABLE "bet_slips" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"stake" double precision NOT NULL,
	"total_odds" double precision NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payout" double precision,
	"is_simulation" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bets" (
	"id" serial PRIMARY KEY NOT NULL,
	"bet_slip_id" integer NOT NULL,
	"match_id" text NOT NULL,
	"selection" text NOT NULL,
	"odds" double precision NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crawl_targets" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "historical_matches" (
	"id" serial PRIMARY KEY NOT NULL,
	"league" text NOT NULL,
	"date" timestamp NOT NULL,
	"home_team" text NOT NULL,
	"away_team" text NOT NULL,
	"home_goals" integer NOT NULL,
	"away_goals" integer NOT NULL,
	"result" text NOT NULL,
	"home_shots" integer,
	"away_shots" integer,
	"home_shots_on_target" integer,
	"away_shots_on_target" integer,
	"home_corners" integer,
	"away_corners" integer,
	"home_fouls" integer,
	"away_fouls" integer
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" text PRIMARY KEY NOT NULL,
	"home_team" text NOT NULL,
	"away_team" text NOT NULL,
	"league" text NOT NULL,
	"match_time" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'upcoming' NOT NULL,
	"result" text,
	"double_chance_result" text,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "odds" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" text NOT NULL,
	"odds_1x" double precision,
	"odds_12" double precision,
	"odds_x2" double precision,
	"crawled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "predictions" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" text NOT NULL,
	"predicted_outcome" text NOT NULL,
	"confidence" double precision NOT NULL,
	"reasoning" text NOT NULL,
	"predicted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"crawling_url" text DEFAULT 'https://web.bet9ja.com' NOT NULL,
	"historic_data_api_url" text DEFAULT 'https://api.football-data.org/v4' NOT NULL,
	"historic_data_api_key" text DEFAULT '' NOT NULL,
	"min_odds" double precision DEFAULT 1.15 NOT NULL,
	"max_odds" double precision DEFAULT 1.5 NOT NULL,
	"min_confidence" double precision DEFAULT 0.7 NOT NULL,
	"stake" double precision DEFAULT 1000 NOT NULL,
	"ollama_url" text DEFAULT 'http://127.0.0.1:11434' NOT NULL,
	"llm_provider" text DEFAULT 'ollama' NOT NULL,
	"llm_model" text DEFAULT 'llama3' NOT NULL,
	"is_simulation" boolean DEFAULT true NOT NULL,
	"auto_bet_enabled" boolean DEFAULT false NOT NULL,
	"accumulator_min_size" integer DEFAULT 2 NOT NULL,
	"accumulator_max_size" integer DEFAULT 5 NOT NULL,
	"target_accuracy" double precision DEFAULT 0.9 NOT NULL,
	"account_balance" double precision DEFAULT 50000 NOT NULL,
	"max_daily_stake_percent" double precision DEFAULT 0.1 NOT NULL,
	"seasons_to_sync" text DEFAULT '2526,2425,2324,2223,2122,2021' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_bet_slip_id_bet_slips_id_fk" FOREIGN KEY ("bet_slip_id") REFERENCES "public"."bet_slips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odds" ADD CONSTRAINT "odds_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;