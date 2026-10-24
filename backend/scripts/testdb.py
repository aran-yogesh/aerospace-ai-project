"""Throwaway databases for tests, so pytest and Playwright never write to the dev database.

Usage (inside the lemma-core container):
    python -m scripts.testdb create <suffix>   # drop if present, create, migrate; prints URL
    python -m scripts.testdb drop <suffix>
"""

import os
import sys
from pathlib import Path

from sqlalchemy import URL, create_engine, text
from sqlalchemy.engine import make_url


def _urls(suffix: str) -> tuple[URL, URL]:
    base = make_url(os.environ["DATABASE_URL"])
    name = base.database.removesuffix(f"_{suffix}")
    return base.set(database=name), base.set(database=f"{name}_{suffix}")


def _admin(base: URL):
    return create_engine(base.set(database="postgres"), isolation_level="AUTOCOMMIT")


def drop(suffix: str) -> None:
    base, url = _urls(suffix)
    engine = _admin(base)
    with engine.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{url.database}" WITH (FORCE)'))
    engine.dispose()


def create(suffix: str) -> str:
    """Fresh, migrated database; returns its URL (with password) for DATABASE_URL."""
    from alembic.config import Config

    from alembic import command

    drop(suffix)
    base, url = _urls(suffix)
    engine = _admin(base)
    with engine.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{url.database}"'))
    engine.dispose()
    rendered = url.render_as_string(hide_password=False)
    previous = os.environ["DATABASE_URL"]
    os.environ["DATABASE_URL"] = rendered
    try:
        from app.core.config import get_settings

        get_settings.cache_clear()
        cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
        command.upgrade(cfg, "head")
    finally:
        os.environ["DATABASE_URL"] = previous
        get_settings.cache_clear()
    return rendered


if __name__ == "__main__":
    action, suffix = sys.argv[1], sys.argv[2]
    if action == "create":
        print(create(suffix))
    elif action == "drop":
        drop(suffix)
    else:
        sys.exit(f"unknown action {action!r}")
