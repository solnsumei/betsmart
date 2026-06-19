import { chromium } from "playwright";
import { db } from "../db";
import { matches, predictions } from "../db/schema";
import { eq } from "drizzle-orm";
import { generateText, Output } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { z } from "zod";

interface ScrapedMatch {
  id: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchTime: Date;
  odds1X: number | null;
  odds12: number | null;
  oddsX2: number | null;
}

export async function crawlBet9ja(targetUrl: string): Promise<ScrapedMatch[]> {
  const crawlUrl = targetUrl || "https://sports.bet9ja.com/";

  console.log(`Starting crawl on target: ${crawlUrl}`);

  let browser;
  try {
    // Launch browser in headed mode to bypass anti-bot and cloudflare challenge gates
    browser = await chromium.launch({
      headless: false,
      args: [
        "--disable-http2",
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox"
      ]
    });

    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });

    const page = await context.newPage();

    // Mask the automation property
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
    });

    // Set a reasonable timeout
    await page.goto(crawlUrl, { waitUntil: "load", timeout: 45000 });

    // Wait for the sports table rendering
    await page.waitForTimeout(8000);

    const scraped: ScrapedMatch[] = [];
    let useAi = !crawlUrl.includes("bet9ja.com");

    if (!useAi) {
      // Parse matches using the verified sports.bet9ja.com class names
      const rows = await page.$$(".sports-table .table-f");
      console.log(`[Scraper] Found ${rows.length} live match rows on ${crawlUrl}`);

      if (rows.length > 0) {
        for (const row of rows) {
          try {
            const home = await row.$eval(".sports-table__home", el => el.textContent?.trim());
            const away = await row.$eval(".sports-table__away", el => el.textContent?.trim());

            const oddsCols = await row.$$(".sports-table__odds");
            if (home && away && oddsCols.length >= 2) {
              // Sibling columns: oddsCols[0] = 1X2, oddsCols[1] = Double Chance (1X, 12, X2)
              const dcOddsElements = await oddsCols[1].$$(".sports-table__odds-item");

              if (dcOddsElements.length >= 3) {
                const o1X = parseFloat(await dcOddsElements[0].innerText() || "0");
                const o12 = parseFloat(await dcOddsElements[1].innerText() || "0");
                const oX2 = parseFloat(await dcOddsElements[2].innerText() || "0");

                const league = "Live Matches";
                const dateStr = new Date().toISOString().split("T")[0];
                const matchId = `${league}-${home}-${away}-${dateStr}`.replace(/\s+/g, "_");

                scraped.push({
                  id: matchId,
                  homeTeam: home,
                  awayTeam: away,
                  league,
                  matchTime: new Date(Date.now() + 3600000 * 2), // 2 hours from now
                  odds1X: o1X || null,
                  odds12: o12 || null,
                  oddsX2: oX2 || null,
                });
              }
            }
          } catch (e) {
            // Skip individual row parse errors
          }
        }
      } else {
        console.log(`[Scraper] 0 matches found via CSS selectors on Bet9ja target. Falling back to AI-assisted extraction...`);
        useAi = true;
      }
    }

    if (useAi) {
      console.log(`[Scraper] Using AI-assisted extraction for target: ${crawlUrl}`);

      const allTextBlocks: string[] = [];
      for (const frame of page.frames()) {
        try {
          const text = await frame.evaluate(() => document.body ? document.body.innerText : "");
          if (text) {
            allTextBlocks.push(text);
          }
        } catch (e) {
          // Ignore frame evaluation errors
        }
      }

      const combinedText = allTextBlocks.join("\n");
      const lines = combinedText.split("\n")
        .map(line => line.trim().replace(/\s+/g, " "))
        .filter(line => {
          // Keep lines that have moderate length and contain decimal odds format (e.g. 1.25, 2.8)
          return line.length > 25 && line.length < 500 && /\b\d{1,2}\.\d{1,2}\b/.test(line);
        });

      const uniqueLines = Array.from(new Set(lines));
      const filteredLines = uniqueLines.filter((item, index) => {
        return !uniqueLines.some((other, otherIdx) => otherIdx !== index && other.includes(item));
      });
      const pageText = filteredLines.slice(0, 80).join("\n");

      console.log(`[Scraper] Extracted ${filteredLines.length} match-relevant lines (${pageText.length} characters) of page text from all frames. Fetching LLM settings...`);

      const settingsData = await db.query.settings.findFirst();
      const provider = settingsData?.llmProvider || "ollama";
      const endpointUrl = settingsData?.ollamaUrl || "http://127.0.0.1:11434";
      const modelName = settingsData?.llmModel || "llama3";

      let modelInstance: any;
      if (provider === "groq") {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) throw new Error("GROQ_API_KEY is not defined in your server .env file.");
        const groqProvider = createOpenAI({
          baseURL: "https://api.groq.com/openai/v1",
          apiKey,
        });
        modelInstance = groqProvider(modelName || "llama-3.1-70b-versatile");
      } else if (provider === "gemini") {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error("GEMINI_API_KEY is not defined in your server .env file.");
        process.env.GOOGLE_GENERATIVE_AI_API_KEY = apiKey;
        modelInstance = google(modelName || "gemini-1.5-flash");
      } else if (provider === "openai") {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) throw new Error("OPENAI_API_KEY is not defined in your server .env file.");
        const openaiProvider = createOpenAI({
          apiKey,
        });
        modelInstance = openaiProvider(modelName || "gpt-4o-mini");
      } else {
        const baseOllamaUrl = endpointUrl || "http://127.0.0.1:11434";
        const ollamaProvider = createOpenAI({
          baseURL: `${baseOllamaUrl}/v1`,
          apiKey: "ollama-dummy-key",
        });
        modelInstance = ollamaProvider(modelName || "llama3.1");
      }

      console.log(`[Scraper] Querying ${provider} (${modelName}) to extract match data...`);
      const response = await generateText({
        model: modelInstance,
        output: Output.object({
          schema: z.object({
            matches: z.array(z.object({
              homeTeam: z.string().describe("Name of the home team"),
              awayTeam: z.string().describe("Name of the away team"),
              league: z.string().describe("Name of the league or competition. Default to 'Unknown League' if not clear."),
              odds1X: z.number().nullable().describe("Decimal odds for 1X (home win or draw)"),
              odds12: z.number().nullable().describe("Decimal odds for 12 (home win or away win)"),
              oddsX2: z.number().nullable().describe("Decimal odds for X2 (draw or away win)"),
            }))
          }),
        }),
        prompt: `Extract all football (soccer) matches and their double chance odds (1X, 12, X2) from the following webpage text.
Only extract matches where you can identify the two playing teams and at least one decimal odd.

Webpage Text:
${pageText}`,
      });

      console.log(`[Scraper] AI extracted ${response.output.matches.length} matches.`);

      const dateStr = new Date().toISOString().split("T")[0];
      for (const m of response.output.matches) {
        if (!m.homeTeam || !m.awayTeam) continue;
        const matchId = `${m.league}-${m.homeTeam}-${m.awayTeam}-${dateStr}`.replace(/\s+/g, "_");
        scraped.push({
          id: matchId,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          league: m.league || "Unknown League",
          matchTime: new Date(Date.now() + 3600000 * 2), // 2 hours from now
          odds1X: m.odds1X || null,
          odds12: m.odds12 || null,
          oddsX2: m.oddsX2 || null,
        });
      }
    }

    await browser.close();

    if (scraped.length > 0) {
      console.log(`[Scraper] Successfully crawled ${scraped.length} matches.`);
      return scraped;
    }
  } catch (error: any) {
    console.error("Crawl error: ", error.message || error);
    if (browser) await browser.close();
  }

  console.log("No odds scraped.");
  return [];
}
