"""add benchmark runs and results

Revision ID: 20260602_0004
Revises: 20260530_0003
Create Date: 2026-06-02 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "20260602_0004"
down_revision = "20260530_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "benchmark_runs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("device_id", sa.String(length=80), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("sample_counts", sa.Text(), nullable=False),
        sa.Column("strategies", sa.Text(), nullable=False),
        sa.Column("iterations", sa.Integer(), nullable=False),
        sa.Column("operation", sa.String(length=40), nullable=False),
        sa.Column("expected_results", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_status", sa.String(length=40), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["device_id"], ["devices.device_id"]),
        sa.CheckConstraint("iterations > 0", name="ck_benchmark_runs_iterations_positive"),
        sa.CheckConstraint("expected_results > 0", name="ck_benchmark_runs_expected_results_positive"),
        sa.CheckConstraint("status in ('running','completed','failed','cancelled')", name="ck_benchmark_runs_status"),
    )

    op.create_table(
        "benchmark_results",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("device_id", sa.String(length=80), nullable=False),
        sa.Column("strategy", sa.String(length=80), nullable=False),
        sa.Column("sample_count", sa.Integer(), nullable=False),
        sa.Column("iterations", sa.Integer(), nullable=False),
        sa.Column("operation", sa.String(length=40), nullable=False),
        sa.Column("duration_total_us", sa.BigInteger(), nullable=False),
        sa.Column("latency_us_avg", sa.Numeric(), nullable=False),
        sa.Column("latency_us_max", sa.Integer(), nullable=False),
        sa.Column("free_heap_before_bytes", sa.Integer(), nullable=True),
        sa.Column("free_heap_after_bytes", sa.Integer(), nullable=True),
        sa.Column("min_free_heap_bytes", sa.Integer(), nullable=True),
        sa.Column("dropped_samples", sa.Integer(), nullable=False),
        sa.Column("timestamp_ms", sa.BigInteger(), nullable=True),
        sa.Column("source_topic", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["device_id"], ["devices.device_id"]),
        sa.ForeignKeyConstraint(["run_id"], ["benchmark_runs.id"]),
        sa.UniqueConstraint(
            "run_id",
            "strategy",
            "sample_count",
            "operation",
            name="uq_benchmark_results_run_strategy_n_operation",
        ),
        sa.CheckConstraint("sample_count > 0", name="ck_benchmark_results_sample_count_positive"),
        sa.CheckConstraint("iterations > 0", name="ck_benchmark_results_iterations_positive"),
        sa.CheckConstraint(
            "strategy in ('ring_buffer','inefficient_shift_buffer')",
            name="ck_benchmark_results_strategy",
        ),
    )
    op.create_index("ix_benchmark_results_run_id", "benchmark_results", ["run_id"])


def downgrade() -> None:
    op.drop_index("ix_benchmark_results_run_id", table_name="benchmark_results")
    op.drop_table("benchmark_results")
    op.drop_table("benchmark_runs")
