from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api import parse_jobs
from app.api.deps import load_owned
from app.api.uploads import receive_step_upload
from app.core import storage
from app.core.config import get_settings
from app.core.users import current_user_id
from app.db.models import CadFile, Project
from app.db.session import get_db, get_sessionmaker
from app.schema import api

router = APIRouter(prefix="/projects", tags=["projects"])

Db = Annotated[Session, Depends(get_db)]
UserId = Annotated[UUID, Depends(current_user_id)]


def _project(row: Project) -> api.Project:
    files = [api.FileInfo.model_validate(f) for f in row.files]
    return api.Project(
        id=row.id, name=row.name, created_at=row.created_at, latest_file=files[0] if files else None
    )


def _detail(row: Project) -> api.ProjectDetail:
    base = _project(row)
    return api.ProjectDetail(
        **base.model_dump(exclude={"latest_file"}),
        latest_file=base.latest_file,
        files=[api.FileInfo.model_validate(f) for f in row.files],
    )


@router.post("", status_code=201, response_model=api.Project)
def create_project(body: api.ProjectCreate, db: Db, user_id: UserId) -> api.Project:
    row = Project(user_id=user_id, name=body.name)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _project(row)


@router.get("", response_model=api.ProjectList)
def list_projects(db: Db, user_id: UserId) -> api.ProjectList:
    rows = db.scalars(
        select(Project)
        .where(Project.user_id == user_id)
        .order_by(Project.created_at.desc(), Project.id.desc())
    ).all()
    return api.ProjectList(items=[_project(r) for r in rows])


@router.get("/{project_id}", response_model=api.ProjectDetail)
def get_project(project_id: str, db: Db, user_id: UserId) -> api.ProjectDetail:
    return _detail(load_owned(db, Project, project_id, user_id))


def _owned_project_id(project_id: str, user_id: UUID) -> UUID:
    with get_sessionmaker()() as db:
        return load_owned(db, Project, project_id, user_id).id


def _insert_file(row: CadFile) -> api.FileInfo:
    with get_sessionmaker()() as db:
        db.add(row)
        db.commit()
        db.refresh(row)
        return api.FileInfo.model_validate(row)


@router.post("/{project_id}/files", status_code=202, response_model=api.FileInfo)
async def upload_file(project_id: str, request: Request, user_id: UserId) -> api.FileInfo:
    """Stream a STEP upload to the uploads volume, record it, and start its parse job.

    Async so the body can be streamed; DB calls run in the threadpool.
    """
    pid = await run_in_threadpool(_owned_project_id, project_id, user_id)

    file_id = uuid4()
    key = storage.step_key(user_id, file_id)
    dest = storage.resolve(key)
    upload = await receive_step_upload(request, dest, get_settings().max_upload_bytes)

    row = CadFile(
        id=file_id,
        user_id=user_id,
        project_id=pid,
        filename=upload.filename,
        size_bytes=upload.size_bytes,
        storage_key=key,
        status="uploaded",
    )
    try:
        info = await run_in_threadpool(_insert_file, row)
    except Exception:
        dest.unlink(missing_ok=True)
        raise
    parse_jobs.submit(file_id)
    return info
