"""projects, cad_files, system_graphs

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _owned() -> list[sa.Column]:
    return [
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "projects",
        *_owned(),
        sa.Column("name", sa.String(200), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_projects"),
    )
    op.create_index("ix_projects_user_id", "projects", ["user_id"])

    op.create_table(
        "cad_files",
        *_owned(),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("error", postgresql.JSONB(), nullable=True),
        sa.Column("parser_version", sa.String(32), nullable=True),
        sa.Column("parse_seconds", sa.Float(), nullable=True),
        sa.Column("component_count", sa.Integer(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_cad_files"),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name="fk_cad_files_project_id_projects",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "status IN ('uploaded', 'parsing', 'parsed', 'failed')",
            name="ck_cad_files_status_valid",
        ),
    )
    op.create_index("ix_cad_files_user_id", "cad_files", ["user_id"])
    op.create_index("ix_cad_files_project_id", "cad_files", ["project_id"])
    # Startup recovery scans for rows stuck in "parsing".
    op.create_index("ix_cad_files_status", "cad_files", ["status"])

    op.create_table(
        "system_graphs",
        *_owned(),
        sa.Column("file_id", sa.Uuid(), nullable=False),
        sa.Column("graph", postgresql.JSONB(), nullable=False),
        sa.Column("mesh_key", sa.Text(), nullable=True),
        sa.Column("mesh_bytes", sa.BigInteger(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_system_graphs"),
        sa.ForeignKeyConstraint(
            ["file_id"],
            ["cad_files.id"],
            name="fk_system_graphs_file_id_cad_files",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("file_id", name="uq_system_graphs_file_id"),
    )
    op.create_index("ix_system_graphs_user_id", "system_graphs", ["user_id"])


def downgrade() -> None:
    op.drop_table("system_graphs")
    op.drop_table("cad_files")
    op.drop_table("projects")
