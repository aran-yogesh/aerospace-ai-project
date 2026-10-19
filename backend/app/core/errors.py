"""Structured JSON errors: every error response is {"error": <code>, "detail": ...}."""

import logging
from http import HTTPStatus
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)


class AppError(Exception):
    """Raise from anywhere in the app to return a structured error."""

    def __init__(self, code: str, detail: Any = None, status_code: int = 400) -> None:
        super().__init__(code)
        self.code = code
        self.detail = detail
        self.status_code = status_code


class NotImplementedYet(AppError):
    def __init__(self, detail: str = "This endpoint is a stub.") -> None:
        super().__init__("not_implemented", detail, status_code=501)


def error_body(code: str, detail: Any = None) -> dict[str, Any]:
    return {"error": code, "detail": detail}


def _status_code_slug(status_code: int) -> str:
    try:
        return HTTPStatus(status_code).phrase.lower().replace(" ", "_").replace("-", "_")
    except ValueError:
        return "error"


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(error_body(exc.code, exc.detail), status_code=exc.status_code)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(
            error_body(_status_code_slug(exc.status_code), exc.detail),
            status_code=exc.status_code,
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        detail = [
            {"loc": list(err["loc"]), "msg": err["msg"], "type": err["type"]}
            for err in exc.errors()
        ]
        return JSONResponse(error_body("validation_error", detail), status_code=422)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error", exc_info=exc)
        return JSONResponse(
            error_body("internal_error", "An unexpected error occurred."), status_code=500
        )
