from decimal import Decimal
from sqlalchemy.orm import declared_attr
from dotenv.variables import Literal
import os
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from sqlmodel import SQLModel, Field, create_engine, Session, Relationship
from sqlalchemy import Column, Numeric
from sqlalchemy.dialects.postgresql import JSONB
from dotenv import load_dotenv

load_dotenv()

# Database connection engine
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:solmei@localhost:5432/betsmart")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
engine = create_engine(DATABASE_URL)


class Settings(SQLModel, table=True):
    __tablename__ = "settings"  # type: ignore

    id: Optional[int] = Field(default=None, primary_key=True)
    crawling_url: str = Field(default="https://web.bet9ja.com")
    historic_data_api_url: str = Field(default="https://api.football-data.org/v4")
    historic_data_api_key: str = Field(default="")
    min_odds: Decimal = Field(default=Decimal("1.15"), sa_column=Column(Numeric(10, 2)))
    max_odds: Decimal = Field(default=Decimal("1.50"), sa_column=Column(Numeric(10, 2)))
    min_confidence: float = Field(default=0.70)
    stake: Decimal = Field(default=Decimal("1000.0"), sa_column=Column(Numeric(10, 2)))
    ollama_url: str = Field(default="http://127.0.0.1:11434")
    llm_provider: str = Field(default="groq" if os.getenv("GROQ_API_KEY") else "ollama")
    llm_model: str = Field(default="llama-3.3-70b-versatile" if os.getenv("GROQ_API_KEY") else "qwen3.5:latest")
    is_simulation: bool = Field(default=True)
    auto_bet_enabled: bool = Field(default=False)
    accumulator_min_size: int = Field(default=2)
    accumulator_max_size: int = Field(default=5)
    target_accuracy: float = Field(default=0.90)
    account_balance: Decimal = Field(default=Decimal("50000.0"), sa_column=Column(Numeric(10, 2)))
    max_daily_stake_percent: float = Field(default=0.10)
    seasons_to_sync: str = Field(default="2526,2425,2324,2223,2122,2021")
    cache_time: int = Field(default=120)
    pipeline_frequency: int = Field(default=30)


class Matches(SQLModel, table=True):
    __tablename__ = "matches"  # type: ignore

    id: str = Field(primary_key=True)
    home_team: str
    away_team: str
    league: str
    match_time: datetime
    status: str = Field(default="upcoming")
    result: Optional[str] = Field(default=None)
    double_chance_result: Optional[str] = Field(default=None)
    odds_1x: Optional[Decimal] = Field(default=None, sa_column=Column(Numeric(10, 2), nullable=True))
    odds_12: Optional[Decimal] = Field(default=None, sa_column=Column(Numeric(10, 2), nullable=True))
    odds_x2: Optional[Decimal] = Field(default=None, sa_column=Column(Numeric(10, 2), nullable=True))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Predictions(SQLModel, table=True):
    __tablename__ = "predictions"  # type: ignore

    id: Optional[int] = Field(default=None, primary_key=True)
    match_id: str = Field(foreign_key="matches.id")
    predicted_outcome: str
    confidence: float
    reasoning: str
    predicted_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class BetSlips(SQLModel, table=True):
    __tablename__ = "bet_slips"  # type: ignore

    id: Optional[int] = Field(default=None, primary_key=True)
    status: str = Field(default="pending")
    stake: Decimal = Field(sa_column=Column(Numeric(10, 2)))
    total_odds: Decimal = Field(sa_column=Column(Numeric(10, 2)))
    placed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    payout: Optional[Decimal] = Field(default=None, sa_column=Column(Numeric(10, 2), nullable=True))
    is_simulation: bool = Field(default=True)


class Bets(SQLModel, table=True):
    __tablename__ = "bets"  # type: ignore

    id: Optional[int] = Field(default=None, primary_key=True)
    bet_slip_id: int = Field(foreign_key="bet_slips.id")
    match_id: str = Field(foreign_key="matches.id")
    selection: str
    odds: Decimal = Field(sa_column=Column(Numeric(10, 2)))
    status: str = Field(default="pending")
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    placed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class HistoricalMatches(SQLModel, table=True):
    __tablename__ = "historical_matches"  # type: ignore

    id: Optional[int] = Field(default=None, primary_key=True)
    league: str
    date: datetime
    home_team: str
    away_team: str
    home_goals: int
    away_goals: int
    result: str
    home_shots: Optional[int] = Field(default=None)
    away_shots: Optional[int] = Field(default=None)
    home_shots_on_target: Optional[int] = Field(default=None)
    away_shots_on_target: Optional[int] = Field(default=None)
    home_corners: Optional[int] = Field(default=None)
    away_corners: Optional[int] = Field(default=None)
    home_fouls: Optional[int] = Field(default=None)
    away_fouls: Optional[int] = Field(default=None)


class CrawlTargets(SQLModel, table=True):
    __tablename__ = "crawl_targets"  # type: ignore

    id: Optional[int] = Field(default=None, primary_key=True)
    url: str
    name: str
    enabled: bool = Field(default=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class CrawlRuns(SQLModel, table=True):
    __tablename__ = "crawl_runs"  # type: ignore

    id: Optional[int] = Field(default=None, primary_key=True)
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    duration_seconds: float
    status: str
    run_metadata: Dict[str, Any] = Field(default_factory=dict, sa_column=Column("run_metadata", JSONB))


def get_db_session():
    with Session(engine) as session:
        yield session
