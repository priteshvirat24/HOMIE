"""Reconstruction job and artifact models."""

import uuid
from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, pg_enum


class JobStatus(StrEnum):
    CREATED = "created"
    VALIDATING_INPUT = "validating_input"
    QUEUED = "queued"
    WAITING_FOR_WORKER = "waiting_for_worker"
    DOWNLOADING_IMAGES = "downloading_images"
    PREPROCESSING = "preprocessing"
    ANALYZING_SCENE = "analyzing_scene"
    GENERATING_WORLD = "generating_world"
    GENERATING_OBJECTS = "generating_objects"
    GENERATING_SFX = "generating_sfx"
    POSTPROCESSING = "postprocessing"
    OPTIMIZING = "optimizing"
    GENERATING_PREVIEW = "generating_preview"
    UPLOADING_ARTIFACTS = "uploading_artifacts"
    READY = "ready"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ArtifactType(StrEnum):
    GAUSSIAN_SPLAT = "gaussian_splat"
    COLLIDER_MESH = "collider_mesh"
    OBJECT_MESH = "object_mesh"
    PANORAMA = "panorama"
    THUMBNAIL = "thumbnail"
    AMBIENT_SFX = "ambient_sfx"
    OBJECT_SFX = "object_sfx"
    SCENE_DESCRIPTION = "scene_description"
    SCENE_MANIFEST = "scene_manifest"


class ReconstructionJob(Base):
    __tablename__ = "reconstruction_jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    capture_session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("capture_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    engine: Mapped[str] = mapped_column(String(50), default="image_blaster", nullable=False)
    status: Mapped[JobStatus] = mapped_column(
        pg_enum(JobStatus, "job_status_enum"), nullable=False, default=JobStatus.CREATED
    )
    progress: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    current_message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_retries: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    worker_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    error_category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    config: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    result_summary: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    capture_session: Mapped["CaptureSession"] = relationship("CaptureSession", back_populates="reconstruction_jobs")  # noqa: F821
    artifacts: Mapped[list["ReconstructionArtifact"]] = relationship(
        "ReconstructionArtifact", back_populates="job", cascade="all, delete-orphan"
    )


class ReconstructionArtifact(Base):
    __tablename__ = "reconstruction_artifacts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reconstruction_jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    artifact_type: Mapped[ArtifactType] = mapped_column(
        pg_enum(ArtifactType, "artifact_type_enum"), nullable=False
    )
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    file_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    quality_level: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)

    # Relationships
    job: Mapped["ReconstructionJob"] = relationship("ReconstructionJob", back_populates="artifacts")
