import { db } from "../db";
import { crawlTargets, settings } from "../db/schema";

async function run() {
  try {
    const targets = await db.select().from(crawlTargets);
    console.log("CRAWL TARGETS:");
    console.log(JSON.stringify(targets, null, 2));

    const config = await db.query.settings.findFirst();
    console.log("SETTINGS:");
    console.log(JSON.stringify(config, null, 2));
  } catch (error) {
    console.error("Database check failed:", error);
  }
  process.exit(0);
}

run();
