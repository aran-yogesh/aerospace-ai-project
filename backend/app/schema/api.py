"""REST/WebSocket response models. The desktop types in
desktop/src/renderer/src/types/api.ts are generated from this module (`make types`)."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.schema.geometry import ParseError

FileStatus = Literal["uploaded", "parsing", "parsed", "failed"]


class _Model(BaseModel):
    model_config = ConfigDict(
        from_attributes=True, json_schema_serialization_defaults_required=True
    )


class ProjectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class FileInfo(_Model):
    id: UUID
    project_id: UUID
    filename: str
    size_bytes: int
    status: FileStatus
    error: ParseError | None = Field(description="Set when status is failed.")
    parser_version: str | None
    parse_seconds: float | None
    component_count: int | None
    created_at: datetime


class Project(_Model):
    id: UUID
    name: str
    created_at: datetime
    latest_file: FileInfo | None


class ProjectDetail(Project):
    files: list[FileInfo] = Field(description="Newest first.")


class ProjectList(_Model):
    items: list[Project] = Field(description="Newest first.")


class FileStatusEvent(_Model):
    """Pushed on /ws/files/{id} on connect and on every status change."""

    file_id: UUID
    status: FileStatus
    error: ParseError | None
    parse_seconds: float | None
    component_count: int | None


API_MODELS: tuple[type[BaseModel], ...] = (
    Project,
    ProjectDetail,
    ProjectList,
    FileInfo,
    FileStatusEvent,
    ProjectCreate,
)
