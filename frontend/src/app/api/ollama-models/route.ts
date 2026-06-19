import { NextResponse } from "next/server";
import { db } from "@/db";

export async function GET() {
  try {
    const config = await db.query.settings.findFirst();
    const ollamaUrl = config?.ollamaUrl || "http://127.0.0.1:11434";

    const targetUrl = `${ollamaUrl}/api/tags`;
    console.log(`[API] Fetching Ollama models from: ${targetUrl}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3-second timeout

    const res = await fetch(targetUrl, {
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Ollama returned status: ${res.status}`);
    }

    const data = await res.json();
    const modelNames = (data.models || []).map((m: any) => m.name);

    return NextResponse.json({ models: modelNames });
  } catch (error: any) {
    console.warn("[API] Ollama connection failed or timed out:", error.message);
    return NextResponse.json({ models: [], error: true, message: error.message });
  }
}
