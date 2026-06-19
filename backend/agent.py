import os
import re
import json
import httpx
import ollama
from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from sqlmodel import Session, select, or_
from dotenv import load_dotenv

from database import engine, HistoricalMatches

load_dotenv()


class PredictionResult(BaseModel):
    predictedOutcome: str = Field(..., description="Double chance predicted outcome: '1X', '12', 'X2', or 'NONE'")
    confidence: float = Field(..., description="Statistical confidence probability of prediction from 0.0 to 1.0")
    reasoning: str = Field(..., description="1-2 sentences of detailed reasoning based on stats and team news")


def match_team_name(name1: str, name2: str) -> bool:
    """
    Fuzzy match helper for team names (matches Man Utd vs Manchester United, protects against collisions)
    """
    def clean(s: str) -> str:
        s = s.lower()
        # Resolve common Manchester abbreviations before cleaning suffixes
        s = re.sub(r"\bman\s*utd\b|\bman\s*united\b|\bmanutd\b", "manchester united", s)
        s = re.sub(r"\bman\s*city\b|\bmancity\b", "manchester city", s)
        
        # Remove common accents
        s = re.sub(r"[àáâãäå]", "a", s)
        s = re.sub(r"[èéêë]", "e", s)
        s = re.sub(r"[ìíîï]", "i", s)
        s = re.sub(r"[òóôõö]", "o", s)
        s = re.sub(r"[ùúûü]", "u", s)
        s = re.sub(r"[ñ]", "n", s)
        # Keep only letters and numbers
        s = re.sub(r"[^a-z0-9]", " ", s)
        
        # Temporarily protect Manchester club names
        s = s.replace("manchester united", "manchester_united")
        s = s.replace("manchester city", "manchester_city")
        
        # Remove suffix/prefix club identifiers
        s = re.sub(r"\b(fc|sc|club|united|utd|city|town|athletic|real|de|cf|athletico|deportivo|ac|as|ca)\b", "", s)
        
        # Restore protected terms
        s = s.replace("manchester_united", "manchesterunited")
        s = s.replace("manchester_city", "manchestercity")
        
        # Remove all whitespace
        s = re.sub(r"\s+", "", s)
        return s.strip()

    c1 = clean(name1)
    c2 = clean(name2)
    
    # Avoid false positive matches between Manchester United and Manchester City
    if (("manchesterunited" in c1 and "manchestercity" in c2) or 
        ("manchestercity" in c1 and "manchesterunited" in c2)):
        return False
        
    # Prevent short substrings (e.g. <= 3 chars) from causing false matches
    if len(c1) <= 3 or len(c2) <= 3:
        return c1 == c2
        
    return c1 == c2 or c1 in c2 or c2 in c1


def query_historical_stats(home_team: str, away_team: str) -> Dict[str, Any]:
    """
    Query database for historical performance of both teams and head-to-head match context.
    """
    print(f"[Agent Stats] Querying database stats for: {home_team} vs {away_team}")
    
    def get_clean_keyword(name: str) -> str:
        cleaned = name.lower()
        if "manchester" in cleaned or "man united" in cleaned or "man city" in cleaned or "man utd" in cleaned:
            return "Man"
            
        cleaned = re.sub(r"\b(fc|sc|club|united|utd|city|town|athletic|real|de|cf|athletico|deportivo|ac|as|ca)\b", "", name, flags=re.IGNORECASE)
        cleaned = re.sub(r"[^a-zA-Z0-9]", " ", cleaned)
        cleaned = cleaned.strip()
        parts = cleaned.split()
        return parts[0] if parts else name

    keyword_home = get_clean_keyword(home_team)
    keyword_away = get_clean_keyword(away_team)

    from sqlmodel import col

    with Session(engine) as session:
        # Pre-filter matches in SQL
        statement = select(HistoricalMatches).where(
            or_(
                col(HistoricalMatches.home_team).ilike(f"%{keyword_home}%"),
                col(HistoricalMatches.away_team).ilike(f"%{keyword_home}%"),
                col(HistoricalMatches.home_team).ilike(f"%{keyword_away}%"),
                col(HistoricalMatches.away_team).ilike(f"%{keyword_away}%")
            )
        )
        candidates = session.exec(statement).all()

    # Filter candidates in memory using fuzzy matching
    home_matches = [m for m in candidates if match_team_name(m.home_team, home_team) or match_team_name(m.away_team, home_team)]
    away_matches = [m for m in candidates if match_team_name(m.home_team, away_team) or match_team_name(m.away_team, away_team)]
    h2h_matches = [m for m in candidates if (match_team_name(m.home_team, home_team) and match_team_name(m.away_team, away_team)) or (match_team_name(m.home_team, away_team) and match_team_name(m.away_team, home_team))]

    # Sort matches by date descending
    home_matches.sort(key=lambda m: m.date, reverse=True)
    away_matches.sort(key=lambda m: m.date, reverse=True)
    h2h_matches.sort(key=lambda m: m.date, reverse=True)

    # Process home team stats
    home_recent = home_matches[:5]
    home_form = []
    home_goals_scored = 0
    home_goals_conceded = 0
    home_shots = 0
    home_shots_target = 0
    home_corners = 0

    for m in home_recent:
        is_home = match_team_name(m.home_team, home_team)
        result_char = "D"
        if m.result == "H":
            result_char = "W" if is_home else "L"
        elif m.result == "A":
            result_char = "L" if is_home else "W"
        home_form.append(result_char)
        
        home_goals_scored += m.home_goals if is_home else m.away_goals
        home_goals_conceded += m.away_goals if is_home else m.home_goals
        home_shots += (m.home_shots or 0) if is_home else (m.away_shots or 0)
        home_shots_target += (m.home_shots_on_target or 0) if is_home else (m.away_shots_on_target or 0)
        home_corners += (m.home_corners or 0) if is_home else (m.away_corners or 0)

    # Process away team stats
    away_recent = away_matches[:5]
    away_form = []
    away_goals_scored = 0
    away_goals_conceded = 0
    away_shots = 0
    away_shots_target = 0
    away_corners = 0

    for m in away_recent:
        is_home = match_team_name(m.home_team, away_team)
        result_char = "D"
        if m.result == "H":
            result_char = "W" if is_home else "L"
        elif m.result == "A":
            result_char = "L" if is_home else "W"
        away_form.append(result_char)
        
        away_goals_scored += m.home_goals if is_home else m.away_goals
        away_goals_conceded += m.away_goals if is_home else m.home_goals
        away_shots += (m.home_shots or 0) if is_home else (m.away_shots or 0)
        away_shots_target += (m.home_shots_on_target or 0) if is_home else (m.away_shots_on_target or 0)
        away_corners += (m.home_corners or 0) if is_home else (m.away_corners or 0)

    # Format head to head
    h2h_logs = []
    for m in h2h_matches[:5]:
        h2h_logs.append(f"{m.date.strftime('%Y-%m-%d')} - {m.home_team} {m.home_goals} : {m.away_goals} {m.away_team} (Result: {m.result})")

    return {
        "homeTeamStats": {
            "name": home_team,
            "recentForm": home_form,
            "avgGoalsScored": round(home_goals_scored / max(1, len(home_recent)), 2),
            "avgGoalsConceded": round(home_goals_conceded / max(1, len(home_recent)), 2),
            "avgShots": round(home_shots / max(1, len(home_recent)), 2),
            "avgShotsOnTarget": round(home_shots_target / max(1, len(home_recent)), 2),
            "avgCorners": round(home_corners / max(1, len(home_recent)), 2)
        },
        "awayTeamStats": {
            "name": away_team,
            "recentForm": away_form,
            "avgGoalsScored": round(away_goals_scored / max(1, len(away_recent)), 2),
            "avgGoalsConceded": round(away_goals_conceded / max(1, len(away_recent)), 2),
            "avgShots": round(away_shots / max(1, len(away_recent)), 2),
            "avgShotsOnTarget": round(away_shots_target / max(1, len(away_recent)), 2),
            "avgCorners": round(away_corners / max(1, len(away_recent)), 2)
        },
        "headToHead": "\n".join(h2h_logs) if h2h_logs else "No recent head-to-head encounters found in database."
    }


def search_tavily(query: str, topic: str = "general", days: Optional[int] = None) -> str:
    """
    Search Tavily API for fresh news / injury info
    """
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        print("[Agent Search] TAVILY_API_KEY missing from environment.")
        return "Web search news unavailable."
    
    try:
        print(f"[Agent Search] Querying Tavily (topic: {topic}): {query}")
        payload: Dict[str, Any] = {
            "api_key": api_key,
            "query": query,
            "topic": topic,
            "search_depth": "basic",
            "include_answer": False
        }
        if topic == "news" and days is not None:
            payload["days"] = days
            
        response = httpx.post(
            "https://api.tavily.com/search",
            json=payload,
            timeout=5
        )
        if response.status_code == 200:
            data = response.json()
            results = data.get("results", [])
            snippets = []
            for r in results[:2]:
                content = r.get("content", "")
                if content and len(content) > 350:
                    content = content[:350] + "..."
                snippets.append(f"Title: {r.get('title')}\nContent: {content}\n---")
            return "\n".join(snippets) if snippets else "No recent web news found."
        else:
            print(f"[Agent Search] Tavily API request failed with status code {response.status_code}: {response.text}")
    except Exception as e:
        print(f"[Agent Search] Tavily search error: {e}")
        
    return "Web search news unavailable."


def search_tavily_score(home_team: str, away_team: str, date_str: str) -> str:
    """
    Search Tavily specifically for a finished match score with more details
    using multiple target search queries combined (including Google Search format).
    """
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        print("[Agent Search] TAVILY_API_KEY missing from environment.")
        return "Web search score unavailable."
        
    queries = [
        f"google match results for {home_team} vs {away_team} {date_str}",
        f"{home_team} vs {away_team} score livescore {date_str}",
        f"{home_team} vs {away_team} result sofascore flashscore {date_str}"
    ]
    
    combined_results = []
    for q in queries:
        try:
            print(f"[Agent Search] Querying Tavily: {q}")
            payload = {
                "api_key": api_key,
                "query": q,
                "topic": "general",
                "search_depth": "basic",
                "include_answer": False
            }
            response = httpx.post(
                "https://api.tavily.com/search",
                json=payload,
                timeout=10
            )
            if response.status_code == 200:
                results = response.json().get("results", [])
                for r in results[:3]:
                    content = r.get("content", "")
                    if content and len(content) > 1000:
                        content = content[:1000] + "..."
                    combined_results.append(f"Title: {r.get('title')}\nContent: {content}\n---")
            else:
                print(f"[Agent Search] Tavily score request failed for '{q}': {response.text}")
        except Exception as e:
            print(f"[Agent Search] Tavily score error for '{q}': {e}")
            
    return "\n".join(combined_results) if combined_results else "Web search score unavailable."


def parse_prediction_response(content_str: str) -> Optional[Dict[str, Any]]:
    """
    Parses the double chance prediction JSON from model content.
    Returns None if JSON parsing fails.
    """
    content_str = content_str.strip()
    
    # Clean markdown code block wraps if present
    if "```" in content_str:
        json_match = re.search(r"\{.*\}", content_str, re.DOTALL)
        if json_match:
            content_str = json_match.group(0)
            
    try:
        parsed_json = json.loads(content_str)
        outcome = parsed_json.get("predictedOutcome", "NONE")
        if outcome not in ["1X", "12", "X2", "NONE"]:
            outcome = "NONE"
        try:
            confidence = float(parsed_json.get("confidence", 0.0))
        except (ValueError, TypeError):
            confidence = 0.0
        reasoning = parsed_json.get("reasoning", "Parsed reasoning.")
        return {
            "predictedOutcome": outcome,
            "confidence": confidence,
            "reasoning": reasoning
        }
    except Exception as parse_err:
        print(f"[Agent Predictor] JSON parse failed: {parse_err}. Discarding response.")
        return None


def predict_match(
    home_team: str,
    away_team: str,
    provider: str = "ollama",
    model_name: str = "qwen3.5:latest",
    ollama_url: str = "http://127.0.0.1:11434"
) -> Dict[str, Any] | None:
    """
    Predict Double Chance outcome using Agno Agent
    """
    print(f"[Agent Predictor] Generating prediction for: {home_team} vs {away_team}")
    
    # 1. Gather stats
    stats = query_historical_stats(home_team, away_team)
    
    # 2. Gather news
    current_date = datetime.now().strftime("%Y-%m-%d")
    search_query = f"{home_team} vs {away_team} football lineups news and form {current_date}"
    news = search_tavily(search_query)
    
    # 3. Connection & Configuration checks
    if provider == "ollama":
        try:
            # Ping Ollama server (timeout 2s) to verify it is running
            httpx.get(ollama_url, timeout=2)
        except Exception as conn_err:
            raise ConnectionError(f"Ollama server is not running or accessible at {ollama_url}: {conn_err}")
    elif provider == "groq" and not os.getenv("GROQ_API_KEY"):
        raise ValueError("GROQ_API_KEY is missing from the environment.")
    elif provider in ("google", "gemini") and not os.getenv("GEMINI_API_KEY") and not os.getenv("GOOGLE_API_KEY"):
        raise ValueError("GEMINI_API_KEY or GOOGLE_API_KEY is missing from the environment.")
    elif provider == "openai" and not os.getenv("OPENAI_API_KEY"):
        raise ValueError("OPENAI_API_KEY is missing from the environment.")
 
    # 3. Setup Agent & Predict
    current_date_str = datetime.now().strftime("%A, %B %d, %Y")
    prompt = f"""
    Predict the outcome of: "{home_team}" vs "{away_team}".
    
    --- HISTORICAL STATS ---
    {stats}
    
    --- WEB NEWS / FORM ---
    {news}
    """
 
    if provider == "ollama":
        system_prompt = (
            "You are a professional football match analyst specializing in double chance betting predictions.\n"
            f"The current date is {current_date_str}. Note that we are in the present year 2026.\n"
            "Analyze the historical stats and news provided, and make a double chance prediction.\n"
            "You MUST respond ONLY with a valid JSON object matching the following structure:\n"
            '{"predictedOutcome": "1X" | "12" | "X2" | "NONE", "confidence": float, "reasoning": "string"}\n'
            "Select '1X' (home win/draw), '12' (home win/away win), 'X2' (draw/away win), or 'NONE' if too risky."
        )
        
        try:
            print(f"[Agent Predictor] Querying Ollama Python Client: {model_name} on {ollama_url}")
            client = ollama.Client(host=ollama_url, timeout=None)
            response = client.chat(
                model=model_name,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ],
                format="json",
                options={
                    "temperature": 0.1,
                    "num_predict": 250
                }
            )
            
            content_str = response.get("message", {}).get("content", "").strip()
            result_dict = parse_prediction_response(content_str)
            print(f"[Agent Predictor] Prediction generated for {home_team} vs {away_team}: {result_dict}")
            return result_dict
        except Exception as e:
            error_msg = str(e)
            if any(indicator in error_msg.lower() for indicator in ["connect", "refused", "timeout"]):
                raise ConnectionError(f"Ollama connection failed: {e}")
            raise e
 
    # Fallback to Agno for cloud APIs (Groq, OpenAI, Gemini)
    if provider == "groq":
        from agno.models.groq import Groq
        model = Groq(id=model_name, api_key=os.getenv("GROQ_API_KEY"))
    elif provider == "google" or provider == "gemini":
        from agno.models.google import Gemini
        model = Gemini(id=model_name or "gemini-1.5-flash")
    else:
        from agno.models.openai import OpenAIChat
        model = OpenAIChat(id=model_name or "gpt-4o-mini")
 
    from agno.agent import Agent
    
    agent = Agent(
        model=model,
        description="You are a professional football match analyst specializing in double chance betting predictions.",
        instructions=[
            f"The current date is {current_date_str}. Note that we are in the present year 2026.",
            "Analyze the historical stats and news to make a double chance prediction.",
            "If no historical records exist, rely heavily on search news.",
            "Select '1X' (home win/draw), '12' (home win/away win), 'X2' (draw/away win), or 'NONE' if too risky.",
            "You MUST respond ONLY with a valid JSON object matching the following structure:",
            '{"predictedOutcome": "1X" | "12" | "X2" | "NONE", "confidence": float, "reasoning": "string"}',
            "Do not include any chat formatting, markdown blocks, or prefix/suffix outside the JSON block."
        ]
    )
 
    try:
        response = agent.run(prompt)
        if response and response.content:
            content_str = response.content.strip()
            result_dict = parse_prediction_response(content_str)
            print(f"[Agent Predictor] Prediction generated for {home_team} vs {away_team}: {result_dict}")
            return result_dict
        else:
            raise ValueError("LLM returned empty or null content.")
    except Exception as e:
        error_msg = str(e)
        if any(indicator in error_msg.lower() for indicator in ["connect", "unauthorized", "api_key", "credentials", "refused", "timeout", "not found"]):
            raise ConnectionError(f"LLM Provider connection or authentication failed: {e}")
        raise e

class ScoreResult(BaseModel):
    homeGoals: int = Field(..., description="Final goals scored by the home team, or -1 if not found")
    awayGoals: int = Field(..., description="Final goals scored by the away team, or -1 if not found")
    finished: bool = Field(..., description="True if the match has completed and has a final score, False otherwise")


def parse_score_response(content_str: str) -> Dict[str, Any]:
    """
    Parses the score JSON, falling back to regex if needed.
    """
    content_str = content_str.strip()
    if "```" in content_str:
        json_match = re.search(r"\{.*\}", content_str, re.DOTALL)
        if json_match:
            content_str = json_match.group(0)
            
    try:
        parsed_json = json.loads(content_str)
        return {
            "homeGoals": int(parsed_json.get("homeGoals", -1)),
            "awayGoals": int(parsed_json.get("awayGoals", -1)),
            "finished": bool(parsed_json.get("finished", False))
        }
    except Exception:
        # Regex fallback
        home_match = re.search(r'"homeGoals"\s*:\s*(-?\d+)', content_str)
        away_match = re.search(r'"awayGoals"\s*:\s*(-?\d+)', content_str)
        finished_match = re.search(r'"finished"\s*:\s*(true|false)', content_str, re.IGNORECASE)
        
        return {
            "homeGoals": int(home_match.group(1)) if home_match else -1,
            "awayGoals": int(away_match.group(1)) if away_match else -1,
            "finished": (finished_match.group(1).lower() == "true") if finished_match else False
        }


def extract_score_with_llm(
    home_team: str,
    away_team: str,
    search_results: str,
    provider: str = "ollama",
    model_name: str = "qwen3.5:latest",
    ollama_url: str = "http://127.0.0.1:11434"
) -> Optional[Dict[str, Any]]:
    """
    Extract the final score of a match from Tavily search results using the LLM
    """
    print(f"[Agent Score Extractor] Extracting score for: {home_team} vs {away_team}")
    
    prompt = f"""
    Find the final full-time score for the soccer match: "{home_team}" vs "{away_team}".
    
    --- WEB SEARCH RESULTS ---
    {search_results}
    """

    print(f"search_results: {search_results}")
    
    current_date_str = datetime.now().strftime("%A, %B %d, %Y")
    system_prompt = (
        "You are an expert football score extractor.\n"
        f"The current date is {current_date_str}. Note that we are in the present year 2026.\n"
        "Analyze the provided web search results and extract the final score of the match.\n"
        "You MUST respond ONLY with a valid JSON object matching the following structure:\n"
        '{"homeGoals": int, "awayGoals": int, "finished": boolean}\n'
        "If the match has not finished or the score is not present in the results, set 'finished' to false and goals to -1."
    )

    if provider == "ollama":
        try:
            client = ollama.Client(host=ollama_url, timeout=None)
            response = client.chat(
                model=model_name,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ],
                format="json",
                options={"temperature": 0.0, "num_predict": 100}
            )
            content_str = response.get("message", {}).get("content", "").strip()
            return parse_score_response(content_str)
        except Exception as e:
            print(f"[Agent Score Extractor] Ollama extraction failed: {e}")
            return None

    # Fallback to Agno for cloud APIs
    if provider == "groq":
        from agno.models.groq import Groq
        model = Groq(id=model_name, api_key=os.getenv("GROQ_API_KEY"))
    elif provider in ("google", "gemini"):
        from agno.models.google import Gemini
        model = Gemini(id=model_name or "gemini-1.5-flash")
    else:
        from agno.models.openai import OpenAIChat
        model = OpenAIChat(id=model_name or "gpt-4o-mini")

    from agno.agent import Agent
    agent = Agent(
        model=model,
        description="You are an expert football score extractor.",
        instructions=[
            f"The current date is {current_date_str}. Note that we are in the present year 2026.",
            "Analyze the search text and extract the final score.",
            "You MUST respond ONLY with a valid JSON object matching the following structure:",
            '{"homeGoals": int, "awayGoals": int, "finished": boolean}'
        ]
    )

    try:
        response = agent.run(prompt)
        if response and response.content:
            return parse_score_response(response.content.strip())
    except Exception as e:
        print(f"[Agent Score Extractor] Agno extraction failed: {e}")
    return None


if __name__ == "__main__":
    # Test agent prediction
    print("Testing Predictor Agent...")
    result = predict_match("Arsenal", "Man United")
    print("Prediction Result:")
    print(result)
