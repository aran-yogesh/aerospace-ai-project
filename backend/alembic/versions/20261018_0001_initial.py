"""initial schema: projects, files, sessions, chat_messages

Revision ID: 0001
Revises:
Create Date: 2026-10-18
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _owned_columns() -> list[sa.Column]:
    return [
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "projects",
        *_owned_columns(),
        sa.Column("name", sa.String(200), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_projects"),
    )
    op.create_table(
        "files",
        *_owned_columns(),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("filename", sa.String(500), nullable=False),
        sa.Column("content_type", sa.String(200), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("storage_key", sa.String(1000), nullable=False),
        sa.ForeignKeyConstraint(
            ["project_id"], ["projects.id"], name="fk_files_project_id_projects", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_files"),
    )
    op.create_table(
        "sessions",
        *_owned_columns(),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(200), nullable=True),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name="fk_sessions_project_id_projects",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_sessions"),
    )
    op.create_table(
        "chat_messages",
        *_owned_columns(),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("meta", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["sessions.id"],
            name="fk_chat_messages_session_id_sessions",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_chat_messages"),
    )
    for table in ("projects", "files", "sessions", "chat_messages"):
        op.create_index(f"ix_{table}_user_id", table, ["user_id"])


def downgrade() -> None:
    for table in ("chat_messages", "sessions", "files", "projects"):
        op.drop_index(f"ix_{table}_user_id", table_name=table)
        op.drop_table(table)
