import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/betsmart";

// For serverless / server environments: share a single pool instance
const pool = new Pool({
  connectionString,
});

export const db = drizzle(pool, { schema });
export { schema };
export type DB = typeof db;
export type Schema = typeof schema;
export { pool };
