"""Runtime settings. Everything comes from the environment; nothing is hardcoded."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: Literal["local", "test", "staging", "production"] = "local"
    database_url: str = ""
    llm_provider: str = "none"
    llm_api_key: SecretStr | None = None
    data_dir: Path = Path(__file__).resolve().parents[3] / "data"


@lru_cache
def get_settings() -> Settings:
    return Settings()
