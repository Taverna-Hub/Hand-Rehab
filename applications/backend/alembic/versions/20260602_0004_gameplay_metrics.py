"""add gameplay metrics

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
        "gameplay_metrics",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("hand", sa.String(length=10), nullable=False),
        sa.Column("mode", sa.String(length=20), nullable=False),
        sa.Column("total_stimuli", sa.Integer(), nullable=False),
        sa.Column("hits", sa.Integer(), nullable=False),
        sa.Column("errors", sa.Integer(), nullable=False),
        sa.Column("missed_stimuli", sa.Integer(), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("max_combo", sa.Integer(), nullable=False),
        sa.Column("avg_reaction_ms", sa.Numeric(), nullable=True),
        sa.Column("best_reaction_ms", sa.Integer(), nullable=True),
        sa.Column("worst_reaction_ms", sa.Integer(), nullable=True),
        sa.Column("accuracy_rate", sa.Numeric(), nullable=True),
        sa.Column("error_rate", sa.Numeric(), nullable=True),
        sa.Column("missed_rate", sa.Numeric(), nullable=True),
        sa.Column("precision_by_lane", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["game_sessions.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.UniqueConstraint("session_id", name="uq_gameplay_metrics_session_id"),
        sa.CheckConstraint("total_stimuli >= 0", name="ck_gameplay_metrics_total_stimuli_non_negative"),
        sa.CheckConstraint("hits >= 0", name="ck_gameplay_metrics_hits_non_negative"),
        sa.CheckConstraint("errors >= 0", name="ck_gameplay_metrics_errors_non_negative"),
        sa.CheckConstraint("missed_stimuli >= 0", name="ck_gameplay_metrics_missed_stimuli_non_negative"),
        sa.CheckConstraint("score >= 0", name="ck_gameplay_metrics_score_non_negative"),
        sa.CheckConstraint("max_combo >= 0", name="ck_gameplay_metrics_max_combo_non_negative"),
    )
    op.create_index("ix_gameplay_metrics_session_id", "gameplay_metrics", ["session_id"])
    op.create_index("ix_gameplay_metrics_user_id", "gameplay_metrics", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_gameplay_metrics_user_id", table_name="gameplay_metrics")
    op.drop_index("ix_gameplay_metrics_session_id", table_name="gameplay_metrics")
    op.drop_table("gameplay_metrics")
