import os
from pathlib import Path
from pydantic_settings import BaseSettings
from dotenv import load_dotenv

# Locate and load the root .env file
root_dir = Path(__file__).resolve().parent.parent
dotenv_path = root_dir / ".env"
if dotenv_path.exists():
    load_dotenv(dotenv_path)
else:
    load_dotenv()

class AppSettings(BaseSettings):
    database_url: str = os.getenv("DATABASE_URL", "postgresql://postgres:solmei@localhost:5432/betsmart")
    redis_url: str = os.getenv("REDIS_URL", "redis://localhost:6379")
    groq_api_key: str = os.getenv("GROQ_API_KEY", "")
    ollama_host: str = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")
    tavily_api_key: str = os.getenv("TAVILY_API_KEY", "")
    historic_data_api_key: str | None = os.getenv("FOOTBALL_API_TOKEN")
    historic_data_api_url: str = os.getenv("FOOTBALL_API_URL", "https://api.football-data.org/v4/matches")

    def __init__(self, **values):
        super().__init__(**values)
        if self.database_url.startswith("postgres://"):
            self.database_url = self.database_url.replace("postgres://", "postgresql://", 1)

    class Config:
        extra = "ignore"

settings = AppSettings()
