from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, utc_now, uuid_str


class User(TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("age >= 0", name="ck_users_age_non_negative"),
        CheckConstraint("sex in ('female','male','other','not_informed')", name="ck_users_sex"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    age: Mapped[int] = mapped_column(Integer, nullable=False)
    sex: Mapped[str] = mapped_column(String(20), nullable=False)

    sessions: Mapped[list["GameSession"]] = relationship(back_populates="user")


class Device(TimestampMixin, Base):
    __tablename__ = "devices"
    __table_args__ = (UniqueConstraint("device_id", name="uq_devices_device_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    device_id: Mapped[str] = mapped_column(String(80), nullable=False)
    firmware_version: Mapped[str | None] = mapped_column(String(80), nullable=True)
    last_status: Mapped[str | None] = mapped_column(String(40), nullable=True)
    wifi_rssi: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    sessions: Mapped[list["GameSession"]] = relationship(back_populates="device")


class GameSession(TimestampMixin, Base):
    __tablename__ = "game_sessions"
    __table_args__ = (
        Index(
            "uq_game_sessions_single_running",
            "status",
            unique=True,
            postgresql_where=text("status = 'running'"),
            sqlite_where=text("status = 'running'"),
        ),
        CheckConstraint(
            "duration_seconds IS NULL OR duration_seconds >= 0",
            name="ck_game_sessions_duration_non_negative",
        ),
        CheckConstraint("hand in ('left','right')", name="ck_game_sessions_hand"),
        CheckConstraint("mode in ('buttons','pressure')", name="ck_game_sessions_mode"),
        CheckConstraint("status in ('created','running','finished','cancelled','error')", name="ck_game_sessions_status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.device_id"), nullable=False)
    hand: Mapped[str] = mapped_column(String(10), nullable=False)
    mode: Mapped[str] = mapped_column(String(20), nullable=False)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="created", nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    scheduled_finish_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    user: Mapped[User] = relationship(back_populates="sessions")
    device: Mapped[Device] = relationship(back_populates="sessions")
    button_batches: Mapped[list["ButtonBatch"]] = relationship(back_populates="session")
    pressure_batches: Mapped[list["PressureBatch"]] = relationship(back_populates="session")
    gameplay_metrics: Mapped["GameplayMetrics | None"] = relationship(back_populates="session")


class GameplayMetrics(TimestampMixin, Base):
    __tablename__ = "gameplay_metrics"
    __table_args__ = (
        UniqueConstraint("session_id", name="uq_gameplay_metrics_session_id"),
        CheckConstraint("total_stimuli >= 0", name="ck_gameplay_metrics_total_stimuli_non_negative"),
        CheckConstraint("hits >= 0", name="ck_gameplay_metrics_hits_non_negative"),
        CheckConstraint("errors >= 0", name="ck_gameplay_metrics_errors_non_negative"),
        CheckConstraint("missed_stimuli >= 0", name="ck_gameplay_metrics_missed_stimuli_non_negative"),
        CheckConstraint("score >= 0", name="ck_gameplay_metrics_score_non_negative"),
        CheckConstraint("max_combo >= 0", name="ck_gameplay_metrics_max_combo_non_negative"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    session_id: Mapped[str] = mapped_column(ForeignKey("game_sessions.id"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    hand: Mapped[str] = mapped_column(String(10), nullable=False)
    mode: Mapped[str] = mapped_column(String(20), nullable=False)
    total_stimuli: Mapped[int] = mapped_column(Integer, nullable=False)
    hits: Mapped[int] = mapped_column(Integer, nullable=False)
    errors: Mapped[int] = mapped_column(Integer, nullable=False)
    missed_stimuli: Mapped[int] = mapped_column(Integer, nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    max_combo: Mapped[int] = mapped_column(Integer, nullable=False)
    avg_reaction_ms: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    best_reaction_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    worst_reaction_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    accuracy_rate: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    error_rate: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    missed_rate: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    precision_by_lane: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    session: Mapped[GameSession] = relationship(back_populates="gameplay_metrics")


class ButtonBatch(Base):
    __tablename__ = "button_batches"
    __table_args__ = (
        CheckConstraint("hand in ('left','right')", name="ck_button_batches_hand"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    batch_id: Mapped[str] = mapped_column(String(120), nullable=False)
    session_id: Mapped[str] = mapped_column(ForeignKey("game_sessions.id"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.device_id"), nullable=False)
    hand: Mapped[str] = mapped_column(String(10), nullable=False)
    strategy: Mapped[str] = mapped_column(String(80), nullable=False)
    sequence_start: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    sequence_end: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    source_topic: Mapped[str | None] = mapped_column(String(255), nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    session: Mapped[GameSession] = relationship(back_populates="button_batches")
    performance: Mapped["ButtonBatchPerformanceMetadata | None"] = relationship(back_populates="batch")
    events: Mapped[list["ButtonEvent"]] = relationship(back_populates="batch")


class PressureBatch(Base):
    __tablename__ = "pressure_batches"
    __table_args__ = (
        CheckConstraint("hand in ('left','right')", name="ck_pressure_batches_hand"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    batch_id: Mapped[str] = mapped_column(String(120), nullable=False)
    session_id: Mapped[str] = mapped_column(ForeignKey("game_sessions.id"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.device_id"), nullable=False)
    hand: Mapped[str] = mapped_column(String(10), nullable=False)
    strategy: Mapped[str] = mapped_column(String(80), nullable=False)
    sequence_start: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    sequence_end: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    source_topic: Mapped[str | None] = mapped_column(String(255), nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    session: Mapped[GameSession] = relationship(back_populates="pressure_batches")
    performance: Mapped["PressureBatchPerformanceMetadata | None"] = relationship(back_populates="batch")
    readings: Mapped[list["PressureReading"]] = relationship(back_populates="batch")


class ButtonBatchPerformanceMetadata(Base):
    __tablename__ = "button_batch_performance_metadata"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    batch_id: Mapped[str] = mapped_column(ForeignKey("button_batches.id"), nullable=False)
    insert_latency_us_avg: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    insert_latency_us_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mqtt_publish_latency_us: Mapped[int | None] = mapped_column(Integer, nullable=True)
    free_heap_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    min_free_heap_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    buffer_capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    buffer_used: Mapped[int | None] = mapped_column(Integer, nullable=True)
    dropped_samples: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    batch: Mapped[ButtonBatch] = relationship(back_populates="performance")


class PressureBatchPerformanceMetadata(Base):
    __tablename__ = "pressure_batch_performance_metadata"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    batch_id: Mapped[str] = mapped_column(ForeignKey("pressure_batches.id"), nullable=False)
    insert_latency_us_avg: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    insert_latency_us_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mqtt_publish_latency_us: Mapped[int | None] = mapped_column(Integer, nullable=True)
    free_heap_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    min_free_heap_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    buffer_capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    buffer_used: Mapped[int | None] = mapped_column(Integer, nullable=True)
    dropped_samples: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    batch: Mapped[PressureBatch] = relationship(back_populates="performance")


class ButtonEvent(Base):
    __tablename__ = "button_events"
    __table_args__ = (
        CheckConstraint("button_id between 1 and 4", name="ck_button_events_button_id"),
        CheckConstraint("event_type in ('pressed','released')", name="ck_button_events_event_type"),
        CheckConstraint("hand in ('left','right')", name="ck_button_events_hand"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    batch_id: Mapped[str] = mapped_column(ForeignKey("button_batches.id"), nullable=False)
    session_id: Mapped[str] = mapped_column(ForeignKey("game_sessions.id"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.device_id"), nullable=False)
    hand: Mapped[str] = mapped_column(String(10), nullable=False)
    button_id: Mapped[int] = mapped_column(Integer, nullable=False)
    event_type: Mapped[str] = mapped_column(String(20), nullable=False)
    timestamp_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sequence: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    batch: Mapped[ButtonBatch] = relationship(back_populates="events")


class PressureReading(Base):
    __tablename__ = "pressure_readings"
    __table_args__ = (CheckConstraint("hand in ('left','right')", name="ck_pressure_readings_hand"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    batch_id: Mapped[str] = mapped_column(ForeignKey("pressure_batches.id"), nullable=False)
    session_id: Mapped[str] = mapped_column(ForeignKey("game_sessions.id"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.device_id"), nullable=False)
    hand: Mapped[str] = mapped_column(String(10), nullable=False)
    pressure_raw: Mapped[int] = mapped_column(Integer, nullable=False)
    pressure_kpa: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    timestamp_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sequence: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    batch: Mapped[PressureBatch] = relationship(back_populates="readings")
