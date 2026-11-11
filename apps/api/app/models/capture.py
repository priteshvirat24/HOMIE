"""Capture session and frame models."""

import uuid
from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, pg_enum


class CaptureSessionStatus(StrEnum):
    CREATED = "created"
    PREPARING = "preparing"
    CAPTURING = "capturing"
    PAUSED = "paused"
    REVIEWING = "reviewing"
    READY_FOR_UPLOAD = "ready_for_upload"
    UPLOADING = "uploading"
    UPLOADED = "uploaded"
    SUBMITTED = "submitted"


class CaptureSession(Base):
    __tablename__ = "capture_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[CaptureSessionStatus] = mapped_column(
        pg_enum(CaptureSessionStatus, "capture_session_status_enum"),
        nullable=False,
        default=CaptureSessionStatus.CREATED,
    )
    device_info: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    frame_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    accepted_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    rejected_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    selected_frame_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC), nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    room: Mapped["Room"] = relationship("Room", back_populates="capture_sessions")  # noqa: F821
    frames: Mapped[list["CaptureFrame"]] = relationship("CaptureFrame", back_populates="session", cascade="all, delete-orphan")
    reconstruction_jobs: Mapped[list["ReconstructionJob"]] = relationship(  # noqa: F821
        "ReconstructionJob", back_populates="capture_session", cascade="all, delete-orphan"
    )


class CaptureFrame(Base):
    __tablename__ = "capture_frames"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("capture_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    storage_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    original_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    content_type: Mapped[str] = mapped_column(String(50), default="image/jpeg", nullable=False)
    file_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    quality_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_accepted: Mapped[bool | None] = mapped_column(default=None, nullable=True)
    rejection_reasons: Mapped[list | None] = mapped_column(JSON, nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    upload_status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    checksum: Mapped[str | None] = mapped_column(String(64), nullable=True)
    captured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)

    # Relationships
    session: Mapped["CaptureSession"] = relationship("CaptureSession", back_populates="frames")
