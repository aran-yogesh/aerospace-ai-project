from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import load_owned
from app.core import storage
from app.core.errors import AppError
from app.core.users import current_user_id
from app.db.models import CadFile, SystemGraphRow
from app.db.session import get_db
from app.schema import api
from app.schema.geometry import SystemGraph

router = APIRouter(prefix="/files", tags=["files"])

Db = Annotated[Session, Depends(get_db)]
UserId = Annotated[UUID, Depends(current_user_id)]


def _parsed_graph(db: Session, file_id: str, user_id: UUID) -> SystemGraphRow:
    row = load_owned(db, CadFile, file_id, user_id)
    if row.status != "parsed":
        raise AppError("not_parsed", f"File status is {row.status!r}.", status_code=409)
    graph = db.scalar(select(SystemGraphRow).where(SystemGraphRow.file_id == row.id))
    if graph is None:
        raise AppError("not_parsed", "Parse result is missing.", status_code=409)
    return graph


@router.get("/{file_id}", response_model=api.FileInfo)
def get_file(file_id: str, db: Db, user_id: UserId) -> api.FileInfo:
    return api.FileInfo.model_validate(load_owned(db, CadFile, file_id, user_id))


@router.get(
    "/{file_id}/graph",
    response_model=SystemGraph,
    responses={409: {"description": "not_parsed"}},
)
def get_graph(file_id: str, db: Db, user_id: UserId) -> JSONResponse:
    # Stored already validated and JSON-dumped; return as-is.
    return JSONResponse(_parsed_graph(db, file_id, user_id).graph)


@router.get("/{file_id}/mesh", responses={409: {"description": "not_parsed"}})
def get_mesh(file_id: str, db: Db, user_id: UserId) -> FileResponse:
    """three-cad-viewer Shapes dict (tessellated arrays only), served from the volume."""
    graph = _parsed_graph(db, file_id, user_id)
    path = storage.resolve(graph.mesh_key) if graph.mesh_key else None
    if path is None or not path.is_file():
        raise AppError("mesh_unavailable", "No mesh was produced for this file.", 404)
    return FileResponse(path, media_type="application/json")
