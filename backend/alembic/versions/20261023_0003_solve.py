"""solve_setups, datasets, solve_runs

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
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


def _file_fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["file_id"], ["cad_files.id"], name=f"fk_{table}_file_id_cad_files", ondelete="CASCADE"
    )


def upgrade() -> None:
    op.create_table(
        "solve_setups",
        *_owned(),
        sa.Column("file_id", sa.Uuid(), nullable=False),
        sa.Column("fluid", postgresql.JSONB(), nullable=False),
        sa.Column("material_key", sa.String(64), nullable=False),
        sa.Column("k_overrides", postgresql.JSONB(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_solve_setups"),
        _file_fk("solve_setups"),
        sa.UniqueConstraint("file_id", name="uq_solve_setups_file_id"),
    )
    op.create_index("ix_solve_setups_user_id", "solve_setups", ["user_id"])

    op.create_table(
        "datasets",
        *_owned(),
        sa.Column("file_id", sa.Uuid(), nullable=False),
        sa.Column("graph_hash", sa.String(64), nullable=False),
        sa.Column("setup", postgresql.JSONB(), nullable=False),
        sa.Column("resolved_k", postgresql.JSONB(), nullable=False),
        sa.Column("segments", postgresql.JSONB(), nullable=False),
        sa.Column("fluid_props", postgresql.JSONB(), nullable=False),
        sa.Column("roughness", postgresql.JSONB(), nullable=False),
        sa.Column("constants_versions", postgresql.JSONB(), nullable=False),
        sa.Column("solver_version", sa.String(32), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_datasets"),
        _file_fk("datasets"),
    )
    op.create_index("ix_datasets_user_id", "datasets", ["user_id"])
    op.create_index("ix_datasets_file_id", "datasets", ["file_id"])
    op.create_index("ix_datasets_content_hash", "datasets", ["content_hash"])

    op.create_table(
        "solve_runs",
        *_owned(),
        sa.Column("dataset_id", sa.Uuid(), nullable=False),
        sa.Column("mode", sa.String(8), nullable=False),
        sa.Column("input_value", sa.Float(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("result", postgresql.JSONB(), nullable=False),
        sa.Column("runtime_ms", sa.Float(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_solve_runs"),
        sa.ForeignKeyConstraint(
            ["dataset_id"],
            ["datasets.id"],
            name="fk_solve_runs_dataset_id_datasets",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint("mode IN ('dp', 'flow')", name="ck_solve_runs_mode_valid"),
        sa.CheckConstraint(
            "status IN ('complete', 'incomplete')", name="ck_solve_runs_status_valid"
        ),
    )
    op.create_index("ix_solve_runs_user_id", "solve_runs", ["user_id"])
    op.create_index("ix_solve_runs_dataset_id", "solve_runs", ["dataset_id"])


def downgrade() -> None:
    op.drop_table("solve_runs")
    op.drop_table("datasets")
    op.drop_table("solve_setups")
