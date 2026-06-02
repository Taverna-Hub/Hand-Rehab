"""allow cancelling benchmark runs

Revision ID: 20260602_0005
Revises: 20260602_0004
Create Date: 2026-06-02 00:00:00.000000
"""

from alembic import op

revision = "20260602_0005"
down_revision = "20260602_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_benchmark_runs_status", "benchmark_runs", type_="check")
    op.create_check_constraint(
        "ck_benchmark_runs_status",
        "benchmark_runs",
        "status in ('running','completed','failed','cancelled')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_benchmark_runs_status", "benchmark_runs", type_="check")
    op.create_check_constraint(
        "ck_benchmark_runs_status",
        "benchmark_runs",
        "status in ('running','completed','failed')",
    )
