"""allow sessions to finish with real duration

Revision ID: 20260530_0002
Revises: 20260530_0001
Create Date: 2026-05-30 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "20260530_0002"
down_revision = "20260530_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_game_sessions_duration_positive", "game_sessions", type_="check")
    op.alter_column("game_sessions", "duration_seconds", existing_type=sa.Integer(), nullable=True)
    op.create_check_constraint(
        "ck_game_sessions_duration_non_negative",
        "game_sessions",
        "duration_seconds IS NULL OR duration_seconds >= 0",
    )


def downgrade() -> None:
    op.drop_constraint("ck_game_sessions_duration_non_negative", "game_sessions", type_="check")
    op.execute("UPDATE game_sessions SET duration_seconds = 1 WHERE duration_seconds IS NULL")
    op.alter_column("game_sessions", "duration_seconds", existing_type=sa.Integer(), nullable=False)
    op.create_check_constraint("ck_game_sessions_duration_positive", "game_sessions", "duration_seconds > 0")
