import { chromium } from "playwright";

async function run() {
  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    console.log("Navigating...");
    await page.goto("https://web.bet9ja.com/Sport/Default.aspx", { waitUntil: "load", timeout: 60000 });
    
    // Wait for the desktop page frames to load
    await page.waitForTimeout(15000);

    console.log(`Total frames found: ${page.frames().length}`);
    for (let i = 0; i < page.frames().length; i++) {
      const frame = page.frames()[i];
      const name = frame.name();
      const url = frame.url();
      const content = await frame.evaluate(() => {
        return document.body ? document.body.innerText.substring(0, 2000) : "empty body";
      });
      console.log(`\n--- FRAME #${i} Name: "${name}" URL: "${url}" ---`);
      console.log(content.substring(0, 1000));
    }
  } catch (error: any) {
    console.error("Failed:", error.message);
  } finally {
    await browser.close();
  }
}

run();
