"""split game batches and enforce one active session

Revision ID: 20260530_0003
Revises: 20260530_0002
Create Date: 2026-05-30 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "20260530_0003"
down_revision = "20260530_0002"
branch_labels = None
depends_on = None


def _create_batch_table(table_name: str, check_name: str) -> None:
    op.create_table(
        table_name,
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("batch_id", sa.String(length=120), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("device_id", sa.String(length=80), nullable=False),
        sa.Column("hand", sa.String(length=10), nullable=False),
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
        sa.CheckConstraint("hand in ('left','right')", name=check_name),
    )
    op.create_index(f"ix_{table_name}_session_id", table_name, ["session_id"])


def _create_performance_table(table_name: str, batch_table_name: str) -> None:
    op.create_table(
        table_name,
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
        sa.ForeignKeyConstraint(["batch_id"], [f"{batch_table_name}.id"]),
    )


def _copy_batches(target_table: str, mode: str) -> None:
    op.execute(
        sa.text(
            f"""
            INSERT INTO {target_table} (
                id, batch_id, session_id, user_id, device_id, hand, strategy,
                sequence_start, sequence_end, created_at_ms, source_topic,
                received_at, created_at
            )
            SELECT
                id, batch_id, session_id, user_id, device_id, hand, strategy,
                sequence_start, sequence_end, created_at_ms, source_topic,
                received_at, created_at
            FROM telemetry_batches
            WHERE mode = :mode
            """
        ).bindparams(mode=mode)
    )


def _copy_performance(target_table: str, mode: str) -> None:
    op.execute(
        sa.text(
            f"""
            INSERT INTO {target_table} (
                id, batch_id, insert_latency_us_avg, insert_latency_us_max,
                mqtt_publish_latency_us, free_heap_bytes, min_free_heap_bytes,
                buffer_capacity, buffer_used, dropped_samples, created_at
            )
            SELECT
                perf.id, perf.batch_id, perf.insert_latency_us_avg, perf.insert_latency_us_max,
                perf.mqtt_publish_latency_us, perf.free_heap_bytes, perf.min_free_heap_bytes,
                perf.buffer_capacity, perf.buffer_used, perf.dropped_samples, perf.created_at
            FROM batch_performance_metadata perf
            JOIN telemetry_batches batch ON batch.id = perf.batch_id
            WHERE batch.mode = :mode
            """
        ).bindparams(mode=mode)
    )


def upgrade() -> None:
    _create_batch_table("button_batches", "ck_button_batches_hand")
    _create_batch_table("pressure_batches", "ck_pressure_batches_hand")
    _create_performance_table("button_batch_performance_metadata", "button_batches")
    _create_performance_table("pressure_batch_performance_metadata", "pressure_batches")

    _copy_batches("button_batches", "buttons")
    _copy_batches("pressure_batches", "pressure")
    _copy_performance("button_batch_performance_metadata", "buttons")
    _copy_performance("pressure_batch_performance_metadata", "pressure")

    op.drop_constraint("button_events_batch_id_fkey", "button_events", type_="foreignkey")
    op.create_foreign_key(
        "fk_button_events_batch_id_button_batches",
        "button_events",
        "button_batches",
        ["batch_id"],
        ["id"],
    )
    op.drop_constraint("pressure_readings_batch_id_fkey", "pressure_readings", type_="foreignkey")
    op.create_foreign_key(
        "fk_pressure_readings_batch_id_pressure_batches",
        "pressure_readings",
        "pressure_batches",
        ["batch_id"],
        ["id"],
    )

    op.drop_table("batch_performance_metadata")
    op.drop_index("ix_telemetry_batches_session_id", table_name="telemetry_batches")
    op.drop_table("telemetry_batches")
    op.execute(
        """
        WITH ranked_running AS (
            SELECT
                id,
                ROW_NUMBER() OVER (ORDER BY created_at DESC, started_at DESC, id DESC) AS position
            FROM game_sessions
            WHERE status = 'running'
        )
        UPDATE game_sessions
        SET
            status = 'cancelled',
            finished_at = COALESCE(finished_at, started_at),
            duration_seconds = COALESCE(duration_seconds, 0)
        WHERE id IN (SELECT id FROM ranked_running WHERE position > 1)
        """
    )
    op.create_index(
        "uq_game_sessions_single_running",
        "game_sessions",
        ["status"],
        unique=True,
        postgresql_where=sa.text("status = 'running'"),
        sqlite_where=sa.text("status = 'running'"),
    )


def downgrade() -> None:
    op.drop_index("uq_game_sessions_single_running", table_name="game_sessions")

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
    op.create_index("ix_telemetry_batches_session_id", "telemetry_batches", ["session_id"])
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

    op.execute(
        """
        INSERT INTO telemetry_batches (
            id, batch_id, session_id, user_id, device_id, hand, mode, strategy,
            sequence_start, sequence_end, created_at_ms, source_topic, received_at, created_at
        )
        SELECT
            id, batch_id, session_id, user_id, device_id, hand, 'buttons', strategy,
            sequence_start, sequence_end, created_at_ms, source_topic, received_at, created_at
        FROM button_batches
        """
    )
    op.execute(
        """
        INSERT INTO telemetry_batches (
            id, batch_id, session_id, user_id, device_id, hand, mode, strategy,
            sequence_start, sequence_end, created_at_ms, source_topic, received_at, created_at
        )
        SELECT
            id, batch_id, session_id, user_id, device_id, hand, 'pressure', strategy,
            sequence_start, sequence_end, created_at_ms, source_topic, received_at, created_at
        FROM pressure_batches
        """
    )
    op.execute(
        """
        INSERT INTO batch_performance_metadata (
            id, batch_id, insert_latency_us_avg, insert_latency_us_max,
            mqtt_publish_latency_us, free_heap_bytes, min_free_heap_bytes,
            buffer_capacity, buffer_used, dropped_samples, created_at
        )
        SELECT
            id, batch_id, insert_latency_us_avg, insert_latency_us_max,
            mqtt_publish_latency_us, free_heap_bytes, min_free_heap_bytes,
            buffer_capacity, buffer_used, dropped_samples, created_at
        FROM button_batch_performance_metadata
        """
    )
    op.execute(
        """
        INSERT INTO batch_performance_metadata (
            id, batch_id, insert_latency_us_avg, insert_latency_us_max,
            mqtt_publish_latency_us, free_heap_bytes, min_free_heap_bytes,
            buffer_capacity, buffer_used, dropped_samples, created_at
        )
        SELECT
            id, batch_id, insert_latency_us_avg, insert_latency_us_max,
            mqtt_publish_latency_us, free_heap_bytes, min_free_heap_bytes,
            buffer_capacity, buffer_used, dropped_samples, created_at
        FROM pressure_batch_performance_metadata
        """
    )

    op.drop_constraint("fk_button_events_batch_id_button_batches", "button_events", type_="foreignkey")
    op.create_foreign_key(
        "button_events_batch_id_fkey",
        "button_events",
        "telemetry_batches",
        ["batch_id"],
        ["id"],
    )
    op.drop_constraint("fk_pressure_readings_batch_id_pressure_batches", "pressure_readings", type_="foreignkey")
    op.create_foreign_key(
        "pressure_readings_batch_id_fkey",
        "pressure_readings",
        "telemetry_batches",
        ["batch_id"],
        ["id"],
    )

    op.drop_table("pressure_batch_performance_metadata")
    op.drop_table("button_batch_performance_metadata")
    op.drop_index("ix_pressure_batches_session_id", table_name="pressure_batches")
    op.drop_index("ix_button_batches_session_id", table_name="button_batches")
    op.drop_table("pressure_batches")
    op.drop_table("button_batches")
