"""/files router (stub)."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends

from app.api.deps import get_user_id
from app.core.errors import NotImplementedYet

router = APIRouter(prefix="/files", tags=["files"])


@router.get("")
async def list_files(user_id: Annotated[UUID, Depends(get_user_id)]) -> dict[str, list[Any]]:
    return {"items": []}


@router.post("", status_code=201)
async def create_files(user_id: Annotated[UUID, Depends(get_user_id)]) -> None:
    raise NotImplementedYet()
