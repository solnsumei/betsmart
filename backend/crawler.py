import os
import re
import sys
import json
import subprocess
import tempfile
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
from robocorp import browser
from dotenv import load_dotenv

# Load env variables
load_dotenv()

class ScrapedMatch(BaseModel):
    homeTeam: str = Field(..., description="Name of the home team")
    awayTeam: str = Field(..., description="Name of the away team")
    league: str = Field("Unknown League", description="Name of the league or competition")
    odds1X: Optional[float] = Field(None, description="Decimal odds for 1X (home win or draw)")
    odds12: Optional[float] = Field(None, description="Decimal odds for 12 (home win or away win)")
    oddsX2: Optional[float] = Field(None, description="Decimal odds for X2 (draw or away win)")
    matchTime: Optional[str] = Field(None, description="Date/Time of the match (e.g. '18/06 15:00' or '2026-06-18 15:00')")

class ScrapedMatchesList(BaseModel):
    matches: List[ScrapedMatch]


def should_skip_match(home: str, away: str, league: str) -> bool:
    """
    Check if a match should be skipped because it is a non-soccer sport,
    a Zoom match, a virtual match, or a Simulated Reality League (SRL) match.
    """
    if not home or not away:
        return True
        
    league_lower = (league or "").lower()
    home_lower = home.lower()
    away_lower = away.lower()
    
    # 1. Skip non-soccer sports
    other_sports = ["tennis", "basketball", "baseball", "volleyball", "handball", "hockey", "snooker", "rugby", "cricket", "darts", "futsal", "squash"]
    if any(sport in league_lower for sport in other_sports):
        return True
        
    # 2. Skip Zoom and Virtual matches
    is_zoom_or_virtual = (
        "zoom" in league_lower or "zoom" in home_lower or "zoom" in away_lower or
        "virtual" in league_lower or "virtual" in home_lower or "virtual" in away_lower or
        "simulated" in league_lower or "simulated" in home_lower or "simulated" in away_lower or
        "zwc" in home_lower or "zwc" in away_lower or
        "zed" in home_lower or "zed" in away_lower or
        home.startswith("Z ") or away.startswith("Z ") or
        home.startswith("Z.") or away.startswith("Z.") or
        re.match(r'^Z[A-Z\d]*\.', home) or re.match(r'^Z[A-Z\d]*\.', away)
    )
    if is_zoom_or_virtual:
        return True
        
    # 3. Skip Simulated Reality League (SRL) matches
    srl_pattern = r'\b(srl)\b'
    if (re.search(srl_pattern, home_lower) or 
        re.search(srl_pattern, away_lower) or
        home_lower.strip().endswith("srl") or
        away_lower.strip().endswith("srl")):
        return True
        
    return False



def parse_match_time(time_str: str) -> Optional[datetime]:
    """
    Parse bet/match date and time string to datetime object.
    Supported formats: '18/06 15:00', '15:00', '2026-06-18 15:00', 'Tomorrow 15:00', 'Friday 15:00', etc.
    """
    if not time_str:
        return None
        
    time_str = time_str.strip()
    now = datetime.now()
    
    # 1. Preprocess relative keywords
    time_str_lower = time_str.lower()
    if "tomorrow" in time_str_lower:
        tomorrow_date = (now + timedelta(days=1)).strftime("%Y-%m-%d")
        time_str = re.sub(r"\btomorrow\b", tomorrow_date, time_str, flags=re.IGNORECASE)
    elif "today" in time_str_lower:
        today_date = now.strftime("%Y-%m-%d")
        time_str = re.sub(r"\btoday\b", today_date, time_str, flags=re.IGNORECASE)

    # 2. Parse using dateutil parser
    from dateutil import parser
    try:
        parsed_dt = parser.parse(time_str, default=now, dayfirst=True)
        # If the format was just HH:MM (without date info) and the result is in the past,
        # it refers to tomorrow.
        if re.match(r"^\d{1,2}:\d{2}$", time_str.strip()):
            if parsed_dt < now:
                parsed_dt += timedelta(days=1)
        return parsed_dt
    except Exception:
        return None
class ChronologicalDateTracker:
    """
    Stateful helper to parse match dates chronologically.
    If a time goes backwards compared to the previous match in the list,
    it assumes we crossed over to the next day.
    """
    def __init__(self):
        self.current_date = datetime.now().date()
        self.last_match_time = None

    def process_time(self, time_str: str) -> Optional[datetime]:
        if not time_str:
            return None
            
        time_str = time_str.strip()
        time_str_lower = time_str.lower()
        
        # Explicit date indicators
        date_indicators = ["/", "tomorrow", "today", "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
                           "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
                           "mon", "tue", "wed", "thu", "fri", "sat", "sun"]
        if any(indicator in time_str_lower for indicator in date_indicators):
            parsed_dt = parse_match_time(time_str)
            if parsed_dt:
                self.current_date = parsed_dt.date()
                self.last_match_time = parsed_dt
                return parsed_dt
            return None
            
        # Parse simple HH:MM time
        time_match = re.search(r"(\d{1,2}):(\d{2})", time_str)
        if time_match:
            try:
                hour, minute = map(int, time_match.groups())
                candidate_time = datetime(self.current_date.year, self.current_date.month, self.current_date.day, hour, minute)
                
                # If candidate time goes backwards compared to the last match, we've crossed into the next day
                if self.last_match_time is not None and candidate_time < self.last_match_time:
                    self.current_date += timedelta(days=1)
                    candidate_time = datetime(self.current_date.year, self.current_date.month, self.current_date.day, hour, minute)
                    
                self.last_match_time = candidate_time
                return candidate_time
            except ValueError:
                pass
                
        return None



def extract_with_ai(page_text: str, provider: str = "groq", model_name: str = "llama-3.3-70b-versatile") -> List[Dict[str, Any]]:
    """
    Use Agno to extract matches from raw webpage text (resilient to small local models via few-shot prompts)
    """
    print(f"[Scraper] Using Agno AI extraction with provider={provider}, model={model_name}...")
    
    from agno.agent import Agent
    
    # Select correct Agno Model class based on provider
    if provider == "groq":
        from agno.models.groq import Groq
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise ValueError("GROQ_API_KEY is not defined in the environment.")
        model = Groq(id=model_name, api_key=api_key)
    elif provider == "google" or provider == "gemini":
        from agno.models.google import Gemini
        model = Gemini(id=model_name or "gemini-1.5-flash")
    elif provider == "openai":
        from agno.models.openai import OpenAIChat
        model = OpenAIChat(id=model_name or "gpt-4o-mini")
    else:
        from agno.models.ollama import Ollama
        model = Ollama(id=model_name or "llama3")

    current_date = datetime.now().strftime("%Y-%m-%d")

    few_shot_prompt = f"""
    You are a high-fidelity sports data extractor. The current date is {current_date}.
    Your task is to extract all upcoming soccer matches, their scheduled times, and double-chance odds (1X, 12, X2) from raw web page text.

    --- PROMPT INSTRUCTIONS ---
    - Identify match matchups (e.g. Home Team vs Away Team).
    - Parse match date/kickoff time.
    - Extract decimal odds corresponding to 1X, 12, and X2.
    - Return a valid JSON matching this schema:
      {{"matches": [{{"homeTeam": "string", "awayTeam": "string", "league": "string", "odds1X": float, "odds12": float, "oddsX2": float, "matchTime": "string"}}]}}

    --- FEW-SHOT EXAMPLE ---
    If raw text is:
    "
    Premier League
    Today 19:45
    Arsenal
    vs
    Chelsea
    1X 1.36
    12 1.25
    X2 2.10
    "
    Your output MUST be:
    {{
      "matches": [
        {{
          "homeTeam": "Arsenal",
          "awayTeam": "Chelsea",
          "league": "Premier League",
          "odds1X": 1.36,
          "odds12": 1.25,
          "oddsX2": 2.10,
          "matchTime": "{current_date} 19:45"
        }}
      ]
    }}
    """

    agent = Agent(
        model=model,
        description="Extract football match details and double chance odds from webpage text.",
        instructions=[
            few_shot_prompt,
            "Only return matches that contain two valid teams and at least one double chance odd.",
            "Do not output markdown code blocks or explanatory text. Output only the JSON object."
        ]
    )
    
    try:
        response = agent.run(f"Webpage Text:\n{page_text}")
        content_str = response.content if hasattr(response, "content") else str(response)
        
        # Clean markdown code blocks
        if content_str is None:
            return []
        
        if "```" in content_str:
            json_match = re.search(r"\{.*\}", content_str, re.DOTALL)
            if json_match:
                content_str = json_match.group(0)
                
        data = json.loads(content_str.strip())
        return data.get("matches", [])
    except Exception as parse_err:
        print(f"[Scraper] Failed to parse LLM structured extraction output: {parse_err}. Returning empty list.")
        return []


def run_robocorp_browser(
    crawl_url: str,
    headless: bool = True,
    provider: str = "groq",
    model_name: str = "llama-3.3-70b-versatile"
) -> List[Dict[str, Any]]:
    """
    Attempt to scrape double chance odds using Robocorp Browser.
    """
    print(f"[Scraper] Running Robocorp Browser (headless={headless}) on: {crawl_url}")
    
    # Configure Robocorp Browser
    browser.configure(
        screenshot="only-on-failure",
        headless=headless,
    )
    browser.configure_context(
        user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        viewport={"width": 1280, "height": 1080}
    )
    
    scraped_matches = []
    try:
        browser.goto(crawl_url)
        page = browser.page()
        page.wait_for_timeout(8000)
        
        # Scroll page incrementally to load lazy-rendered match rows
        print("[Scraper] Scrolling page to trigger lazy loaded items...")
        for _ in range(6):
            page.evaluate("window.scrollBy(0, 1000)")
            page.wait_for_timeout(600)
        # Scroll back to the top just in case
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(500)
        
        # Check if this is Bet9ja to apply selectors
        if "bet9ja.com" in crawl_url:
            print("[Scraper] Applying Bet9ja CSS selector extraction...")
            tracker = ChronologicalDateTracker()
            
            # Attempt to switch the market dropdown to Double Chance (DC) across all sections
            print("[Scraper] Switching market columns to Double Chance using robocorp-browser...")
            option_ids = [
                'home_highlights_sport-1_markets_dropoption-S_DC',
                'home_upcoming_sport-1_soccer_markets_dropoption-S_DC',
                'home_live_sport-3000001_soccer_markets_dropoption-LIVES_DC'
            ]
            for opt_id in option_ids:
                try:
                    container = page.locator(".dropdown", has=page.locator(f"#{opt_id}"))
                    if container.count() > 0:
                        trigger = container.locator(".dropdown__toggle, .dropdown__button")
                        if trigger.is_visible():
                            current_text = trigger.inner_text().strip()
                            if "Double Chance" not in current_text and "DC" not in current_text:
                                print(f"[Scraper] Clicking trigger for dropdown with option {opt_id}...")
                                trigger.click()
                                page.wait_for_timeout(1000)
                                option = page.locator(f"#{opt_id}")
                                if option.is_visible():
                                    print(f"[Scraper] Selecting Double Chance option {opt_id}...")
                                    option.click()
                                    page.wait_for_timeout(5000)
                except Exception as e:
                    print(f"[Scraper] Error switching dropdown for {opt_id}: {e}")

            extracted_rows = []
            for frame in page.frames:
                try:
                    rows_in_frame = frame.evaluate("""() => {
                        const results = [];
                        const sportsTables = document.querySelectorAll('.sports-table');
                        
                        for (const table of sportsTables) {
                            // Find the date header for this sports-table by looking at preceding siblings
                            let dateHeader = "";
                            let prev = table.previousElementSibling;
                            while (prev) {
                                if (prev.classList.contains('sports-head') || prev.className.includes('sports-head')) {
                                    const dateEl = prev.querySelector('.sports-head__date, [class*="date"]');
                                    if (dateEl) {
                                        dateHeader = dateEl.innerText.trim();
                                    }
                                    break;
                                }
                                prev = prev.previousElementSibling;
                            }
                            
                            // Find league name from accordion title or header
                            let leagueName = "";
                            let parentAcc = table.closest('.accordion-item, .accordion, [class*="accordion"]');
                            if (parentAcc) {
                                const titleEl = parentAcc.querySelector('.accordion-title, .accordion-head, [class*="title"], [class*="header"]');
                                if (titleEl) {
                                    leagueName = titleEl.innerText.trim();
                                }
                            }
                            
                            // Find all match rows (.table-f) inside this sports-table
                            const rows = table.querySelectorAll('.table-f');
                            for (const row of rows) {
                                const homeEl = row.querySelector('.sports-table__home, [class*="home"]');
                                const awayEl = row.querySelector('.sports-table__away, [class*="away"]');
                                if (!homeEl || !awayEl) continue;
                                
                                const home = homeEl.innerText.trim();
                                const away = awayEl.innerText.trim();
                                
                                // Extract kickoff time
                                let timeStr = "";
                                const timeEl = row.querySelector('.sports-table__time, [class*="time"]');
                                if (timeEl) {
                                    timeStr = timeEl.innerText.trim();
                                } else {
                                    const match = row.innerText.match(/\\b\\d{2}:\\d{2}\\b/);
                                    if (match) {
                                        timeStr = match[0];
                                    }
                                }
                                
                                // Extract odds columns
                                const oddsCols = row.querySelectorAll('.sports-table__odds');
                                let o1X = null, o12 = null, oX2 = null;
                                if (oddsCols.length >= 2) {
                                    const dcItems = oddsCols[1].querySelectorAll('.sports-table__odds-item');
                                    if (dcItems.length >= 3) {
                                        o1X = parseFloat(dcItems[0].innerText.trim()) || null;
                                        o12 = parseFloat(dcItems[1].innerText.trim()) || null;
                                        oX2 = parseFloat(dcItems[2].innerText.trim()) || null;
                                    }
                                }
                                
                                // Fallback for odds
                                if (!o1X && !o12 && !oX2) {
                                    const oddsElements = row.querySelectorAll('.sports-table__odds-item, [class*="odds-item"], td, li, [class*="odds"]');
                                    const decimalOdds = [];
                                    for (const el of oddsElements) {
                                        if (el.children.length > 1) continue;
                                        const t = el.innerText ? el.innerText.trim() : "";
                                        const val = parseFloat(t);
                                        if (!isNaN(val) && val > 1.0 && val < 100.0 && t.includes('.')) {
                                            decimalOdds.push(val);
                                        }
                                    }
                                    if (decimalOdds.length >= 6) {
                                        o1X = decimalOdds[3];
                                        o12 = decimalOdds[4];
                                        oX2 = decimalOdds[5];
                                    } else if (decimalOdds.length >= 3) {
                                        o1X = decimalOdds[0];
                                        o12 = decimalOdds[1];
                                        oX2 = decimalOdds[2];
                                    }
                                }
                                
                                results.push({
                                    home: home,
                                    away: away,
                                    odds1X: o1X,
                                    odds12: o12,
                                    oddsX2: oX2,
                                    timeStr: timeStr,
                                    dateHeader: dateHeader,
                                    leagueName: leagueName
                                });
                            }
                        }
                        return results;
                    }""")
                    if rows_in_frame:
                        print(f"[Scraper] Found {len(rows_in_frame)} rows in frame URL: {frame.url}")
                        extracted_rows.extend(rows_in_frame)
                except Exception as frame_err:
                    pass

            seen_fixtures = set()
            print(f"[Scraper] Extracted {len(extracted_rows)} total rows across all frames. Parsing dates...")
            for r in extracted_rows:
                try:
                    home = r["home"]
                    away = r["away"]
                    o1X = r["odds1X"]
                    o12 = r["odds12"]
                    oX2 = r["oddsX2"]
                    time_str = r["timeStr"]
                    date_header = r["dateHeader"]
                    
                    if not home or not away:
                        continue
                        
                    fixture_key = (home.lower().strip(), away.lower().strip())
                    if fixture_key in seen_fixtures:
                        print(f"[Scraper] Discarding duplicate fixture: {home} vs {away}")
                        continue
                    seen_fixtures.add(fixture_key)
                        
                    # Filter out non-soccer sports, Zoom, Virtual and SRL matches
                    league = r.get("leagueName") or "Live Matches"
                    if should_skip_match(home, away, league):
                        print(f"[Scraper] Discarding non-soccer, Zoom, Virtual or SRL match: {league} -> {home} vs {away}")
                        continue

                    # Skip if double chance odds are disabled
                    if (o1X is None or o1X <= 0) and (o12 is None or o12 <= 0) and (oX2 is None or oX2 <= 0):
                        continue
                        
                    # Formulate composite time string: "date_header time_str"
                    composite_time = ""
                    if date_header:
                        composite_time = f"{date_header} {time_str}".strip()
                    else:
                        composite_time = time_str
                        
                    parsed_match_time = tracker.process_time(composite_time)
                    if not parsed_match_time:
                        print(f"[Scraper] Discarding {home} vs {away}: Malformed or missing kickoff time.")
                        continue
                        
                    # Discard if match already started
                    if parsed_match_time <= datetime.now():
                        print(f"[Scraper] Discarding {home} vs {away}: Match already started at {parsed_match_time}.")
                        continue
                        
                    date_str = parsed_match_time.strftime("%Y-%m-%d")
                    match_id = re.sub(r"\s+", "_", f"{league}-{home}-{away}-{date_str}")
                    
                    scraped_matches.append({
                        "id": match_id,
                        "homeTeam": home,
                        "awayTeam": away,
                        "league": league,
                        "matchTime": parsed_match_time,
                        "odds1X": o1X if o1X and o1X > 0 else None,
                        "odds12": o12 if o12 and o12 > 0 else None,
                        "oddsX2": oX2 if oX2 and oX2 > 0 else None
                    })
                except Exception as row_err:
                    print(f"[Scraper] Error parsing Bet9ja row: {row_err}")
        else:
            print(f"[Scraper] Non-Bet9ja URL detected: {crawl_url}. Extracting page text for LLM parsing...")
            page_text = page.evaluate("document.body.innerText")
            
            # Clean and filter text for AI consumption (preserve vertical layout)
            lines = [line.strip() for line in page_text.split("\n")]
            filtered_lines = []
            for line in lines:
                line_clean = re.sub(r"\s+", " ", line).strip()
                # Skip empty lines or headers/footers/scripts that are too long
                if line_clean and len(line_clean) < 300:
                    filtered_lines.append(line_clean)
                    
            cleaned_page_text = "\n".join(filtered_lines[:300])
            
            if cleaned_page_text:
                ai_extracted = extract_with_ai(cleaned_page_text, provider=provider, model_name=model_name)
                tracker = ChronologicalDateTracker()
                seen_fixtures = set()
                for m in ai_extracted:
                    home = m.get("homeTeam")
                    away = m.get("awayTeam")
                    league = m.get("league", "Unknown League")
                    if not home or not away:
                        continue
                    if should_skip_match(home, away, league):
                        print(f"[Scraper] Discarding non-soccer, Zoom, Virtual or SRL match (AI): {league} -> {home} vs {away}")
                        continue
                        
                    fixture_key = (home.lower().strip(), away.lower().strip())
                    if fixture_key in seen_fixtures:
                        print(f"[Scraper] Discarding duplicate AI fixture: {home} vs {away}")
                        continue
                    seen_fixtures.add(fixture_key)
                    
                    o1X = m.get("odds1X")
                    o12 = m.get("odds12")
                    oX2 = m.get("oddsX2")
                    if (o1X is None or o1X <= 0) and (o12 is None or o12 <= 0) and (oX2 is None or oX2 <= 0):
                        print(f"[Scraper] Discarding AI match {m.get('homeTeam')} vs {m.get('awayTeam')}: Double chance disabled.")
                        continue
                        
                    parsed_match_time = tracker.process_time(m.get("matchTime") or "")
                    if not parsed_match_time:
                        print(f"[Scraper] Discarding AI match {m.get('homeTeam')} vs {m.get('awayTeam')}: Malformed or missing kickoff time.")
                        continue
                        
                    if parsed_match_time <= datetime.now():
                        print(f"[Scraper] Discarding AI match {m.get('homeTeam')} vs {m.get('awayTeam')}: Match already started at {parsed_match_time}.")
                        continue
                        
                    date_str = parsed_match_time.strftime("%Y-%m-%d")
                    match_id = re.sub(r"\s+", "_", f"{m.get('league', 'Unknown League')}-{m.get('homeTeam')}-{m.get('awayTeam')}-{date_str}")
                    
                    scraped_matches.append({
                        "id": match_id,
                        "homeTeam": m.get("homeTeam"),
                        "awayTeam": m.get("awayTeam"),
                        "league": m.get("league", "Unknown League"),
                        "matchTime": parsed_match_time,
                        "odds1X": o1X if o1X and o1X > 0 else None,
                        "odds12": o12 if o12 and o12 > 0 else None,
                        "oddsX2": oX2 if oX2 and oX2 > 0 else None
                    })
            
    except Exception as e:
        print(f"[Scraper] Robocorp Browser failed (headless={headless}): {e}")
    finally:
        try:
            print("[Scraper] Closing Robocorp Browser context...")
            browser.context().close()
        except Exception as close_err:
            print(f"[Scraper] Error closing browser context: {close_err}")
        
    return scraped_matches


def crawl_odds(target_url: str, provider: str = "groq", model_name: str = "llama-3.3-70b-versatile") -> List[Dict[str, Any]]:
    """
    Scraping pipeline:
    1. Check if running inside an active asyncio loop or a non-main thread (e.g. from FastAPI background task/scheduler).
       If so, spawn this script as a subprocess to prevent Playwright sync / asyncio / greenlet conflicts.
    2. Try Headed Robocorp Browser.
    3. If browser fails/returns 0 matches, run Scrapy fallback spider in subprocess, clean text, and extract via Agno AI.
    """
    import threading
    is_main_thread = (threading.current_thread() is threading.main_thread())
    try:
        import asyncio
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if not is_main_thread or loop is not None:
        print("[Scraper] Active event loop or background thread detected. Running crawler in a subprocess to avoid Playwright sync/greenlet conflicts...")
        try:
            temp_dir = tempfile.gettempdir()
            output_json_path = os.path.join(temp_dir, f"crawl_output_{int(datetime.now().timestamp())}.json")
            
            current_script = os.path.abspath(__file__)
            # Run the subprocess allowing stdout/stderr to stream to console in real-time
            subprocess.run([
                sys.executable,
                current_script,
                target_url,
                provider,
                model_name,
                output_json_path
            ], check=True)
            
            if os.path.exists(output_json_path):
                with open(output_json_path, "r", encoding="utf-8") as f:
                    parsed_data = json.load(f)
                
                # Convert matchTime strings back to datetime objects
                for m in parsed_data:
                    if "matchTime" in m and m["matchTime"]:
                        m["matchTime"] = datetime.fromisoformat(m["matchTime"])
                
                try:
                    os.remove(output_json_path)
                except OSError:
                    pass
                return parsed_data
            else:
                print(f"[Scraper Subprocess] Subprocess finished but output JSON file was not found.")
        except Exception as e:
            print(f"[Scraper Subprocess] Subprocess execution failed: {e}")
        return []

    crawl_url = target_url or "https://web.bet9ja.com/"
    
    # Try Headed Robocorp Browser
    scraped = run_robocorp_browser(crawl_url, headless=False, provider=provider, model_name=model_name)
    if len(scraped) > 0:
        print(f"[Scraper] Successfully extracted {len(scraped)} matches in headed mode.")
        return scraped
        
    # Run Scrapy Fallback + Agno AI
    print("[Scraper] Robocorp Browser returned 0 matches. Falling back to Scrapy + Agno AI pipeline...")
    temp_dir = tempfile.gettempdir()
    output_filepath = os.path.join(temp_dir, f"scrapy_{int(datetime.now().timestamp())}.txt")
    
    # Path to scrapy_spider.py
    spider_path = os.path.join(os.path.dirname(__file__), "scrapy_spider.py")
    
    try:
        subprocess.run([
            sys.executable,
            spider_path,
            crawl_url,
            output_filepath
        ], capture_output=True, check=True)
        
        if os.path.exists(output_filepath):
            with open(output_filepath, "r", encoding="utf-8") as f:
                raw_text = f.read()
            
            # Clean and filter text for AI consumption (preserve vertical layout)
            lines = [line.strip() for line in raw_text.split("\n")]
            filtered_lines = []
            for line in lines:
                line_clean = re.sub(r"\s+", " ", line).strip()
                # Skip empty lines or headers/footers/scripts that are too long
                if line_clean and len(line_clean) < 300:
                    filtered_lines.append(line_clean)
                    
            page_text = "\n".join(filtered_lines[:300])
            
            if page_text:
                ai_extracted = extract_with_ai(page_text, provider=provider, model_name=model_name)
                tracker = ChronologicalDateTracker()
                seen_fixtures = set()
                for m in ai_extracted:
                    home = m.get("homeTeam")
                    away = m.get("awayTeam")
                    league = m.get("league", "Unknown League")
                    if not home or not away:
                        continue
                    if should_skip_match(home, away, league):
                        print(f"[Scraper] Discarding non-soccer, Zoom, Virtual or SRL match (Scrapy AI): {league} -> {home} vs {away}")
                        continue
                        
                    fixture_key = (home.lower().strip(), away.lower().strip())
                    if fixture_key in seen_fixtures:
                        print(f"[Scraper] Discarding duplicate AI match: {home} vs {away}")
                        continue
                    seen_fixtures.add(fixture_key)
                    
                    # Discard if double chance odds are disabled
                    o1X = m.get("odds1X")
                    o12 = m.get("odds12")
                    oX2 = m.get("oddsX2")
                    if (o1X is None or o1X <= 0) and (o12 is None or o12 <= 0) and (oX2 is None or oX2 <= 0):
                        print(f"[Scraper] Discarding AI match {m.get('homeTeam')} vs {m.get('awayTeam')}: Double chance disabled.")
                        continue
                        
                    parsed_match_time = tracker.process_time(m.get("matchTime") or "")
                    if not parsed_match_time:
                        print(f"[Scraper] Discarding AI match {m.get('homeTeam')} vs {m.get('awayTeam')}: Malformed or missing kickoff time.")
                        continue
                        
                    # Discard if match already started
                    if parsed_match_time <= datetime.now():
                        print(f"[Scraper] Discarding AI match {m.get('homeTeam')} vs {m.get('awayTeam')}: Match already started at {parsed_match_time}.")
                        continue
                        
                    date_str = parsed_match_time.strftime("%Y-%m-%d")
                    match_id = re.sub(r"\s+", "_", f"{m.get('league')}-{m.get('homeTeam')}-{m.get('awayTeam')}-{date_str}")
                    scraped.append({
                        "id": match_id,
                        "homeTeam": m.get("homeTeam"),
                        "awayTeam": m.get("awayTeam"),
                        "league": m.get("league", "Unknown League"),
                        "matchTime": parsed_match_time,
                        "odds1X": o1X if o1X and o1X > 0 else None,
                        "odds12": o12 if o12 and o12 > 0 else None,
                        "oddsX2": oX2 if oX2 and oX2 > 0 else None
                    })
            
            # Cleanup temp file
            try:
                os.remove(output_filepath)
            except OSError:
                pass
                
    except Exception as e:
        print(f"[Scraper] Scrapy fallback pipeline failed: {e}")
        
    return scraped

if __name__ == "__main__":
    if len(sys.argv) > 1:
        target = sys.argv[1]
        prov = sys.argv[2] if len(sys.argv) > 2 else "groq"
        model = sys.argv[3] if len(sys.argv) > 3 else "llama-3.3-70b-versatile"
        output_file = sys.argv[4] if len(sys.argv) > 4 else None
        
        # Run crawler
        results = crawl_odds(target, provider=prov, model_name=model)
        
        # Serialize matches (convert datetime objects to ISO format string)
        serialized_results = []
        for match in results:
            m_copy = match.copy()
            if isinstance(m_copy.get("matchTime"), datetime):
                m_copy["matchTime"] = m_copy["matchTime"].isoformat()
            serialized_results.append(m_copy)
            
        if output_file:
            with open(output_file, "w", encoding="utf-8") as f:
                json.dump(serialized_results, f)
        else:
            print(json.dumps(serialized_results))
    else:
        print("Testing crawler with multi-stage pipeline...")
        results = crawl_odds("https://sports.bet9ja.com/")
        print(f"Final Crawled Matches Count: {len(results)}")
        for idx, match in enumerate(results[:5]):
            print(f"{idx+1}. {match['homeTeam']} vs {match['awayTeam']} | 1X: {match['odds1X']} | 12: {match['odds12']} | X2: {match['oddsX2']}")
