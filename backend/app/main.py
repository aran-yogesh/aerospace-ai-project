"""LemmaLab backend entrypoint."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from app.api import files, health, parse_jobs, projects
from app.core.config import get_settings
from app.core.errors import install_error_handlers
from app.ws import echo
from app.ws import files as ws_files

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    try:
        await run_in_threadpool(parse_jobs.recover_interrupted)
    except Exception:
        # The app must still start (and /health report degraded) when the DB is down.
        logger.warning("Startup parse-job recovery failed", exc_info=True)
    yield
    parse_jobs.shutdown()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="LemmaLab Core", version="0.1.0", lifespan=lifespan)
    install_error_handlers(app)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=None
        if settings.app_env == "production"
        else settings.cors_dev_origin_regex,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["*"],
    )
    app.include_router(health.router)
    app.include_router(projects.router)
    app.include_router(files.router)
    app.include_router(echo.router)
    app.include_router(ws_files.router)
    return app


app = create_app()
