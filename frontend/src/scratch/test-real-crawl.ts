import { crawlBet9ja } from "../lib/scraper";

async function run() {
  const url = "https://web.bet9ja.com/Sport/Default.aspx";
  console.log(`Starting diagnostic crawl for url: ${url}`);
  try {
    const results = await crawlBet9ja(url);
    console.log("CRAWL RESULT MATCHES:");
    console.log(JSON.stringify(results, null, 2));
  } catch (error) {
    console.error("Crawl function crashed:", error);
  }
  process.exit(0);
}

run();
