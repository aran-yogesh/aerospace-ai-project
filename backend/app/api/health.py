import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.db import session

logger = logging.getLogger(__name__)
router = APIRouter(tags=["meta"])


@router.get("/health")
def health() -> JSONResponse:
    """Liveness plus a real database round trip. 503 when the database is down."""
    try:
        session.ping()
    except Exception:
        logger.warning("Database ping failed", exc_info=True)
        return JSONResponse({"status": "degraded", "db": "down"}, status_code=503)
    return JSONResponse({"status": "ok", "db": "ok"})
