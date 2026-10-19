import os
import threading
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


# ---------------------------------------------------------------------------------------
# API test support (used by tests/test_api_*.py). Kept lazy so tests that never touch the
# database (e.g. the golden parser tests run with --no-deps) don't need Postgres.
# ---------------------------------------------------------------------------------------


def _clear_caches() -> None:
    from app.core.config import get_settings
    from app.db import session

    get_settings.cache_clear()
    session.get_engine.cache_clear()
    session.get_sessionmaker.cache_clear()


@pytest.fixture(scope="session")
def api_db() -> Iterator[None]:
    """Point the app at a separate <db>_test database, created and migrated with Alembic
    once per session, so `make test` never touches dev data."""
    from alembic.config import Config
    from sqlalchemy import create_engine, text
    from sqlalchemy.engine import make_url

    from alembic import command

    original = os.environ.get("DATABASE_URL", "")
    if not original:
        pytest.skip("DATABASE_URL not set")
    url = make_url(original)
    test_url = url if url.database.endswith("_test") else url.set(database=f"{url.database}_test")

    admin = create_engine(url, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": test_url.database}
        ).scalar()
        if not exists:
            conn.execute(text(f'CREATE DATABASE "{test_url.database}"'))
    admin.dispose()

    os.environ["DATABASE_URL"] = test_url.render_as_string(hide_password=False)
    _clear_caches()
    command.upgrade(Config(str(Path(__file__).resolve().parents[1] / "alembic.ini")), "head")
    yield
    from app.db.session import get_engine

    get_engine().dispose()
    os.environ["DATABASE_URL"] = original
    _clear_caches()


def truncate_all() -> None:
    from sqlalchemy import text

    from app.db.session import get_engine

    with get_engine().begin() as conn:
        conn.execute(text("TRUNCATE system_graphs, cad_files, projects"))


@pytest.fixture
def api_settings(api_db, tmp_path, monkeypatch):
    """Clean tables, and uploads in a per-test tmp dir. Returns the live Settings object;
    tests may monkeypatch more attributes on it (e.g. max_upload_bytes)."""
    from app.core.config import get_settings

    truncate_all()
    settings = get_settings()
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    monkeypatch.setattr(settings, "uploads_dir", uploads)
    return settings


@pytest.fixture
def api_client(api_settings) -> Iterator[TestClient]:
    """TestClient with the lifespan running (startup recovery, job pool shutdown)."""
    with TestClient(create_app()) as c:
        yield c


@dataclass
class FakeOutput:
    result: Any
    mesh: dict | None
    seconds: float


class FakeParser:
    """Stand-in for app.cad_parser.parse_file. `gate` holds the job in "parsing"."""

    def __init__(self, output: Callable[[Path], FakeOutput]) -> None:
        self.output = output
        self.gate = threading.Event()
        self.gate.set()
        self.calls: list[Path] = []

    def __call__(self, path: Path, *, timeout_s: float = 60, memory_mb: int = 2048) -> FakeOutput:
        self.calls.append(path)
        assert self.gate.wait(10), "test never released the fake parser"
        return self.output(path)


@pytest.fixture
def fake_parser(monkeypatch) -> Callable[[Callable[[Path], FakeOutput]], FakeParser]:
    import app.cad_parser

    def install(output: Callable[[Path], FakeOutput]) -> FakeParser:
        fake = FakeParser(output)
        monkeypatch.setattr(app.cad_parser, "parse_file", fake, raising=False)
        return fake

    return install


def wait_for_status(
    client: TestClient, file_id: str, statuses: set[str], timeout: float = 10
) -> dict:
    deadline = time.monotonic() + timeout
    while True:
        body = client.get(f"/files/{file_id}").json()
        if body["status"] in statuses:
            return body
        if time.monotonic() > deadline:
            raise AssertionError(f"file stayed {body['status']!r}, wanted {statuses}")
        time.sleep(0.02)
