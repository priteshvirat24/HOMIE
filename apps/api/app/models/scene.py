"""Scene manifest model."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class SceneManifest(Base):
    __tablename__ = "scene_manifests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reconstruction_jobs.id", ondelete="SET NULL"), nullable=True
    )
    schema_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    engine: Mapped[str] = mapped_column(String(50), nullable=False)
    representation: Mapped[str] = mapped_column(String(50), nullable=False)
    manifest_data: Mapped[dict] = mapped_column(JSON, nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)

    # Relationships
    room: Mapped["Room"] = relationship("Room", back_populates="scene_manifests")  # noqa: F821
