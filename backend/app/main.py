"""LemmaLab backend entrypoint."""

from fastapi import FastAPI

from app.api import chat, files, projects, sessions
from app.core.errors import install_error_handlers
from app.ws import session as ws_session


def create_app() -> FastAPI:
    app = FastAPI(title="LemmaLab Core", version="0.1.0")
    install_error_handlers(app)

    @app.get("/health", tags=["meta"])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(projects.router)
    app.include_router(files.router)
    app.include_router(sessions.router)
    app.include_router(chat.router)
    app.include_router(ws_session.router)
    return app


app = create_app()
