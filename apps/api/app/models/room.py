"""Room model."""

import uuid
from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class RoomType(StrEnum):
    LIVING_ROOM = "living_room"
    BEDROOM = "bedroom"
    KITCHEN = "kitchen"
    BATHROOM = "bathroom"
    DINING_ROOM = "dining_room"
    HALLWAY = "hallway"
    BALCONY = "balcony"
    OFFICE = "office"
    GARAGE = "garage"
    LAUNDRY = "laundry"
    OTHER = "other"


class RoomStatus(StrEnum):
    CREATED = "created"
    CAPTURING = "capturing"
    CAPTURED = "captured"
    UPLOADING = "uploading"
    UPLOADED = "uploaded"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class Room(Base):
    __tablename__ = "rooms"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    property_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    room_type: Mapped[RoomType] = mapped_column(Enum(RoomType, name="room_type_enum"), nullable=False, default=RoomType.OTHER)
    status: Mapped[RoomStatus] = mapped_column(Enum(RoomStatus, name="room_status_enum"), nullable=False, default=RoomStatus.CREATED)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    thumbnail_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC), nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    property: Mapped["Property"] = relationship("Property", back_populates="rooms")  # noqa: F821
    capture_sessions: Mapped[list["CaptureSession"]] = relationship(  # noqa: F821
        "CaptureSession", back_populates="room", cascade="all, delete-orphan"
    )
    scene_manifests: Mapped[list["SceneManifest"]] = relationship(  # noqa: F821
        "SceneManifest", back_populates="room", cascade="all, delete-orphan"
    )
