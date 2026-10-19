"""Phase 1 tables: projects -> cad_files -> system_graphs. All rows carry user_id."""

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, UserOwned

FILE_STATUSES = ("uploaded", "parsing", "parsed", "failed")
TERMINAL_STATUSES = frozenset({"parsed", "failed"})


class Project(UserOwned, Base):
    __tablename__ = "projects"

    name: Mapped[str] = mapped_column(String(200), nullable=False)

    files: Mapped[list["CadFile"]] = relationship(
        back_populates="project",
        order_by="(CadFile.created_at.desc(), CadFile.id.desc())",
        lazy="selectin",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class CadFile(UserOwned, Base):
    __tablename__ = "cad_files"
    __table_args__ = (
        CheckConstraint(
            "status IN ('uploaded', 'parsing', 'parsed', 'failed')", name="status_valid"
        ),
    )

    project_id: Mapped[UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    storage_key: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="uploaded", index=True)
    error: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    parser_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    parse_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    component_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    project: Mapped[Project] = relationship(back_populates="files")


class SystemGraphRow(UserOwned, Base):
    """Parse result. The graph is JSONB (small, queryable later); the mesh is a file on the
    uploads volume (see app.core.storage) because it is megabytes of float arrays that are
    never queried and are served verbatim to the viewer."""

    __tablename__ = "system_graphs"

    file_id: Mapped[UUID] = mapped_column(
        ForeignKey("cad_files.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    graph: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    mesh_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    mesh_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
