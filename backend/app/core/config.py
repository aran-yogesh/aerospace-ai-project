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
    # Renderer origins allowed to call the API: the Vite dev server, and "null" for the
    # packaged app, which loads from file://.
    cors_origins: list[str] = ["http://localhost:5173", "null"]
    # Outside production, also accept any localhost port (Vite moves off 5173 when it's busy).
    cors_dev_origin_regex: str = r"^http://(localhost|127\.0\.0\.1):\d+$"
    data_dir: Path = Path(__file__).resolve().parents[3] / "data"
    evals_dir: Path = Path(__file__).resolve().parents[3] / "evals"
    # Uploaded CAD files live in a Docker named volume, never in the repo.
    uploads_dir: Path = Path("/uploads")
    max_upload_bytes: int = 50 * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
