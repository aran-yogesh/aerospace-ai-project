"""Shared request dependencies."""

from typing import Annotated
from uuid import UUID

from fastapi import Header

from app.core.errors import AppError


async def get_user_id(x_user_id: Annotated[str | None, Header()] = None) -> UUID:
    """Placeholder identity. Real auth replaces this; every query must still scope by user_id."""
    if x_user_id is None:
        raise AppError("unauthenticated", "Missing X-User-Id header.", status_code=401)
    try:
        return UUID(x_user_id)
    except ValueError as exc:
        raise AppError("unauthenticated", "X-User-Id must be a UUID.", status_code=401) from exc
