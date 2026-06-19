import { generateText, Output } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { queryHistoricalStats } from "./historical";
import { searchWeb } from "./search";

// Define the structured JSON return type
interface PredictionResult {
  predictedOutcome: "1X" | "12" | "X2" | "NONE";
  confidence: number;
  reasoning: string;
}

export async function predictDoubleChance(
  homeTeam: string,
  awayTeam: string,
  statsIgnored: any, // Kept signature compatibility
  provider: string, // 'ollama' | 'groq' | 'gemini' | 'openai'
  endpointUrl: string, // Ollama URL e.g. http://127.0.0.1:11434
  apiKeyIgnored: string,
  modelName: string // e.g. 'llama3.1', 'gemini-1.5-flash', 'gpt-4o'
): Promise<PredictionResult> {
  
  console.log(`[Agent] Gathering match data for analysis: ${homeTeam} vs ${awayTeam}`);

  // 1. Query local database stats
  let statsString = "";
  try {
    const statsResult = await queryHistoricalStats(homeTeam, awayTeam);
    statsString = typeof statsResult === "string" ? statsResult : JSON.stringify(statsResult, null, 2);
  } catch (err: any) {
    statsString = `Failed to query historical stats from local database: ${err.message}`;
  }

  // 2. Query Tavily web search for recent form, matches, and team news
  let searchResult = "";
  try {
    const searchQuery = `${homeTeam} vs ${awayTeam} team news injuries form matches`;
    console.log(`[Agent] Querying Tavily web search for: "${searchQuery}"`);
    searchResult = await searchWeb(searchQuery);
  } catch (err: any) {
    console.warn(`[Agent] Web search failed:`, err.message);
    searchResult = "Web search news unavailable.";
  }

  // 3. Setup model provider instance
  let modelInstance: any;
  try {
    if (provider === "groq") {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) throw new Error("GROQ_API_KEY is not defined in your server .env file.");

      const groqProvider = createOpenAI({
        baseURL: "https://api.groq.com/openai/v1",
        apiKey,
      });
      modelInstance = groqProvider(modelName || "llama-3.3-70b-versatile");

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
      // Default: Ollama
      const baseOllamaUrl = endpointUrl || "http://127.0.0.1:11434";
      const ollamaProvider = createOpenAI({
        baseURL: `${baseOllamaUrl}/v1`,
        apiKey: "ollama-dummy-key",
      });
      modelInstance = ollamaProvider(modelName || "llama3.1");
    }

    // 4. Call LLM for prediction using the aggregated context
    const prompt = `You are a professional football match analyst specializing in double chance betting predictions.
Your goal is to predict the outcome of the upcoming fixture: "${homeTeam}" vs "${awayTeam}".

We have gathered the following historical statistics and web search results for you:

--- LOCAL DATABASE HISTORICAL STATS ---
${statsString}

--- CURRENT WEB SEARCH & TEAM NEWS ---
${searchResult}

---
INSTRUCTIONS:
1. Analyze both the historical stats and search results to write a detailed, analytical reasoning.
2. If there are no historical match records found in the local database, you MUST rely heavily on the current web search results (Tavily search) to find their recent form, matches, and details to make an informed prediction.
3. If the web search results are also insufficient or you are not convinced of a clear outcome, you can output "NONE". Otherwise, select the best double chance outcome ("1X", "12", "X2").
4. Return your prediction in the requested structured format.`;

    let predictionObj: PredictionResult;
    try {
      console.log(`[Agent] Generating structured prediction from data...`);
      const response = await generateText({
        model: modelInstance,
        output: Output.object({
          schema: z.object({
            predictedOutcome: z.enum(["1X", "12", "X2", "NONE"]),
            confidence: z.number().min(0.0).max(1.0).describe("Statistical probability confidence of this prediction"),
            reasoning: z.string().describe("1-2 sentence detailed reason based on stats and team news"),
          }),
        }),
        prompt: prompt,
      });
      predictionObj = response.output;
    } catch (err: any) {
      console.warn(`[Agent] generateObject failed (${err.message}). Falling back to text-based JSON parsing...`);
      if (err.text) {
        console.log(`[Agent] Raw unparsable response from model:\n${err.text}`);
      } else if (err.response?.text) {
        console.log(`[Agent] Raw unparsable response from model:\n${err.response.text}`);
      }

      const textResponse = await generateText({
        model: modelInstance,
        prompt: `${prompt}
        
Provide your response strictly as a JSON object with no markdown formatting and no extra text. Example format:
{
  "predictedOutcome": "1X",
  "confidence": 0.85,
  "reasoning": "Home team has strong local form and web news reports full strength squad."
}`,
      });

      console.log(`[Agent] Raw LLM Text Response:\n${textResponse.text}`);

      const cleanJsonStr = textResponse.text
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      try {
        const parsed = JSON.parse(cleanJsonStr);
        predictionObj = {
          predictedOutcome: ["1X", "12", "X2", "NONE"].includes(parsed.predictedOutcome) ? parsed.predictedOutcome : "NONE",
          confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
          reasoning: parsed.reasoning || "Failed to generate detailed reasoning.",
        };
      } catch (jsonErr: any) {
        console.error(`[Agent] Text fallback JSON parsing failed: ${jsonErr.message}. Raw string: "${cleanJsonStr}"`);
        predictionObj = {
          predictedOutcome: "NONE",
          confidence: 0.0,
          reasoning: "Prediction model failed to generate compliant JSON format.",
        };
      }
    }

    console.log(`[Agent] Prediction finished:`, predictionObj);
    return predictionObj;

  } catch (error: any) {
    console.error("[Agent] Analysis failed:", error.message);
    throw error;
  }
}
