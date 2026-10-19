"""LemmaLab backend entrypoint."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import health
from app.core.config import get_settings
from app.core.errors import install_error_handlers
from app.ws import echo


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="LemmaLab Core", version="0.1.0")
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
    app.include_router(echo.router)
    return app


app = create_app()
