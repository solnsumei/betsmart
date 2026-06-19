export async function searchWeb(query: string): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.log("[Search] Web search skipped: TAVILY_API_KEY not configured in .env file.");
    return "Web search skipped. TAVILY_API_KEY is not set in your server .env file.";
  }

  try {
    console.log(`[Search] Querying Tavily: "${query}"`);
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        max_results: 5,
      }),
    });

    if (!res.ok) {
      throw new Error(`Tavily search request failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const results = data.results || [];

    if (results.length === 0) {
      return "Web search returned no results.";
    }

    const formatted = results
      .map((r: any, idx: number) => {
        return `[Result ${idx + 1}] Title: ${r.title}\nSource URL: ${r.url}\nSummary: ${r.content}`;
      })
      .join("\n\n");

    return formatted;
  } catch (error: any) {
    console.error("[Search] Tavily API query error:", error.message);
    return `Web search error: ${error.message}`;
  }
}
