# BetSmart ⚽🧠
### Double-Chance Predictor & Parlay Automation System

BetSmart is an advanced, automated sports betting analytical platform. It combines a Next.js client-side dashboard with an autonomous Python workflow to scrape double-chance odds, generate double-chance (1X, 12, X2) predictions using Large Language Models (LLMs), build simulated parlay/accumulator bet slips, and settle results via automated API calls or robust multi-query search fallbacks.

---

## 🏛️ System Architecture

```mermaid
graph TD
    A[Bet9ja Scraper / Playwright] -->|Crawl Odds| B(Python worker.py)
    B -->|Query Stats / H2H| C[(PostgreSQL Database)]
    B -->|News Search| D[Tavily Search API]
    B -->|Generate Prediction| E[Local Ollama / Cloud LLM]
    B -->|Place Accumulator| C
    B -->|Publish SSE Event| F[(Redis Event Bus)]
    F -->|Push Updates| G[Next.js SSE Endpoint]
    G -->|Real-time Logs & Toast| H[Next.js Frontend React Page]
    I[Football API / Multi-query Fallback] -->|Settle Scores| B
```

### 1. Python Backend
* **`scheduler.py`**: Executes the odds extraction, prediction, risk manager, and settlement pipelines at regular intervals.
* **`worker.py`**: Contains the core business logic (evaluating odds qualifiers, checking daily stake limits, compiling accumulators, and resolving match scores).
* **`crawler.py`**: A multi-stage crawler that leverages **Robocorp Browser (Playwright)** and **Scrapy** to scrape pre-match double-chance odds.
* **`agent.py`**: Orchestrates LLM Inferences for match predictions (using stats + news context) and handles score extractions via local Ollama models or Cloud LLM APIs.

### 2. Next.js Frontend
* **Real-time SSE Dashboard**: Listens to Redis channels via Server-Sent Events to show instant toast notifications for crawl finishes, bet slip placements, and match settlements.
* **Granular Predictions Log**: Offers searchable, paginated tabs to filter predictions by *Not Placed*, *Placed & Unsettled*, and *Placed & Settled* categories.
* **Manual Slip Builder**: Allows constructing manual parlay bet slips from upcoming predictions, displaying potential payouts and enforcing target accuracy thresholds.
* **System Control Center**: A custom settings section to manage active crawl targets, database CSV imports, and simulation limits.

---

## ✨ Key Features

* **SRL & Zoom Filtering**: Automatically discards Simulated Reality Leagues (`SRL`), Zoom soccer, and virtual matches to protect statistical integrity.
* **LLM Prediction Engine**: Queries historical team head-to-head records and recent news context before generating double-chance predictions (supported by Ollama `qwen` / `granite`, Groq, OpenAI, and Gemini).
* **Automated Accumulators**: Compiles qualifying matches (based on minimum confidence and odds thresholds) into simulated accumulator parlay slips.
* **Reliable Settlement Engine**: Queries the Football-Data API for finished matches. If scores are missing (e.g. niche leagues), it triggers a **robust multi-query fallback** using Tavily + Google search strings, utilizing the LLM to extract final score lines (e.g., `4-4`).
* **Sleek, Premium UI**: Custom dark mode layout using modern components, SVG micro-animations, dynamic toast pop-ups, and native glassmorphism details.

---

## 🛠️ Getting Started

### 1. Requirements
* Node.js (v18+)
* Python (v3.10+)
* Redis Server (running on `localhost:6379`)
* PostgreSQL Database

### 2. Configuration (`.env`)
Create a `.env` file in the root directory:
```env
# Database & Cache
DATABASE_URL=postgres://username:password@localhost:5432/betsmart
REDIS_URL=redis://localhost:6379

# LLM Providers (Ollama, Groq, Gemini, or OpenAI)
LLM_PROVIDER=ollama
LLM_MODEL=granite4.1:3b
OLLAMA_HOST=http://127.0.0.1:11434

# API Keys
TAVILY_API_KEY=your_tavily_key
FOOTBALL_API_TOKEN=your_football_data_token
FOOTBALL_API_URL=https://api.football-data.org/v4/matches
GROQ_API_KEY=your_groq_key
```

### 3. Setup Python Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python scheduler.py
```

### 4. Setup Next.js Frontend
```bash
cd frontend
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the live dashboard.

---

## 📄 License
This project is licensed under the MIT License.
