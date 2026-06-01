"""initial schema

Revision ID: 20260530_0001
Revises:
Create Date: 2026-05-30 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "20260530_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("age", sa.Integer(), nullable=False),
        sa.Column("sex", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("age >= 0", name="ck_users_age_non_negative"),
        sa.CheckConstraint("sex in ('female','male','other','not_informed')", name="ck_users_sex"),
    )

    op.create_table(
        "devices",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("device_id", sa.String(length=80), nullable=False, unique=True),
        sa.Column("firmware_version", sa.String(length=80), nullable=True),
        sa.Column("last_status", sa.String(length=40), nullable=True),
        sa.Column("wifi_rssi", sa.Integer(), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "game_sessions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("device_id", sa.String(length=80), nullable=False),
        sa.Column("hand", sa.String(length=10), nullable=False),
        sa.Column("mode", sa.String(length=20), nullable=False),
        sa.Column("duration_seconds", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("scheduled_finish_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["device_id"], ["devices.device_id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.CheckConstraint("duration_seconds > 0", name="ck_game_sessions_duration_positive"),
        sa.CheckConstraint("hand in ('left','right')", name="ck_game_sessions_hand"),
        sa.CheckConstraint("mode in ('buttons','pressure')", name="ck_game_sessions_mode"),
        sa.CheckConstraint("status in ('created','running','finished','cancelled','error')", name="ck_game_sessions_status"),
    )

    op.create_table(
        "telemetry_batches",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("batch_id", sa.String(length=120), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("device_id", sa.String(length=80), nullable=False),
        sa.Column("hand", sa.String(length=10), nullable=False),
        sa.Column("mode", sa.String(length=20), nullable=False),
        sa.Column("strategy", sa.String(length=80), nullable=False),
        sa.Column("sequence_start", sa.BigInteger(), nullable=True),
        sa.Column("sequence_end", sa.BigInteger(), nullable=True),
        sa.Column("created_at_ms", sa.BigInteger(), nullable=True),
        sa.Column("source_topic", sa.String(length=255), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["device_id"], ["devices.device_id"]),
        sa.ForeignKeyConstraint(["session_id"], ["game_sessions.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.CheckConstraint("hand in ('left','right')", name="ck_telemetry_batches_hand"),
        sa.CheckConstraint("mode in ('buttons','pressure')", name="ck_telemetry_batches_mode"),
    )

    op.create_table(
        "batch_performance_metadata",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("batch_id", sa.String(length=36), nullable=False),
        sa.Column("insert_latency_us_avg", sa.Numeric(), nullable=True),
        sa.Column("insert_latency_us_max", sa.Integer(), nullable=True),
        sa.Column("mqtt_publish_latency_us", sa.Integer(), nullable=True),
        sa.Column("free_heap_bytes", sa.Integer(), nullable=True),
        sa.Column("min_free_heap_bytes", sa.Integer(), nullable=True),
        sa.Column("buffer_capacity", sa.Integer(), nullable=True),
        sa.Column("buffer_used", sa.Integer(), nullable=True),
        sa.Column("dropped_samples", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["batch_id"], ["telemetry_batches.id"]),
    )

    op.create_table(
        "button_events",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("batch_id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("device_id", sa.String(length=80), nullable=False),
        sa.Column("hand", sa.String(length=10), nullable=False),
        sa.Column("button_id", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=20), nullable=False),
        sa.Column("timestamp_ms", sa.BigInteger(), nullable=False),
        sa.Column("sequence", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["batch_id"], ["telemetry_batches.id"]),
        sa.ForeignKeyConstraint(["device_id"], ["devices.device_id"]),
        sa.ForeignKeyConstraint(["session_id"], ["game_sessions.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.CheckConstraint("button_id between 1 and 4", name="ck_button_events_button_id"),
        sa.CheckConstraint("event_type in ('pressed','released')", name="ck_button_events_event_type"),
        sa.CheckConstraint("hand in ('left','right')", name="ck_button_events_hand"),
    )

    op.create_table(
        "pressure_readings",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("batch_id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("device_id", sa.String(length=80), nullable=False),
        sa.Column("hand", sa.String(length=10), nullable=False),
        sa.Column("pressure_raw", sa.Integer(), nullable=False),
        sa.Column("pressure_kpa", sa.Numeric(), nullable=True),
        sa.Column("timestamp_ms", sa.BigInteger(), nullable=False),
        sa.Column("sequence", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["batch_id"], ["telemetry_batches.id"]),
        sa.ForeignKeyConstraint(["device_id"], ["devices.device_id"]),
        sa.ForeignKeyConstraint(["session_id"], ["game_sessions.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.CheckConstraint("hand in ('left','right')", name="ck_pressure_readings_hand"),
    )

    op.create_index("ix_game_sessions_user_id", "game_sessions", ["user_id"])
    op.create_index("ix_telemetry_batches_session_id", "telemetry_batches", ["session_id"])
    op.create_index("ix_button_events_session_id", "button_events", ["session_id"])
    op.create_index("ix_pressure_readings_session_id", "pressure_readings", ["session_id"])


def downgrade() -> None:
    op.drop_index("ix_pressure_readings_session_id", table_name="pressure_readings")
    op.drop_index("ix_button_events_session_id", table_name="button_events")
    op.drop_index("ix_telemetry_batches_session_id", table_name="telemetry_batches")
    op.drop_index("ix_game_sessions_user_id", table_name="game_sessions")
    op.drop_table("pressure_readings")
    op.drop_table("button_events")
    op.drop_table("batch_performance_metadata")
    op.drop_table("telemetry_batches")
    op.drop_table("game_sessions")
    op.drop_table("devices")
    op.drop_table("users")
