"""Pydantic schemas for API request/response validation."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


# ============================================================
# Auth Schemas
# ============================================================


class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str | None = Field(None, max_length=100)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class TokenRefresh(BaseModel):
    refresh_token: str


class UserOut(BaseModel):
    id: UUID
    email: str
    display_name: str | None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ============================================================
# Property Schemas
# ============================================================


class PropertyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    address: str | None = None
    notes: str | None = None


class PropertyUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    address: str | None = None
    notes: str | None = None


class PropertyOut(BaseModel):
    id: UUID
    name: str
    address: str | None
    notes: str | None
    room_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ============================================================
# Room Schemas
# ============================================================


class RoomCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    room_type: str = "other"
    notes: str | None = None


class RoomUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    room_type: str | None = None
    notes: str | None = None


class RoomOut(BaseModel):
    id: UUID
    property_id: UUID
    name: str
    room_type: str
    status: str
    notes: str | None
    thumbnail_key: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ============================================================
# Capture Schemas
# ============================================================


class CaptureSessionCreate(BaseModel):
    room_id: UUID
    device_info: dict | None = None


class CaptureSessionOut(BaseModel):
    id: UUID
    room_id: UUID
    status: str
    frame_count: int
    accepted_count: int
    rejected_count: int
    selected_frame_id: UUID | None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None

    model_config = {"from_attributes": True}


class CaptureFrameRegister(BaseModel):
    original_filename: str | None = None
    content_type: str = "image/jpeg"
    file_size_bytes: int | None = None
    width: int | None = None
    height: int | None = None
    quality_score: float | None = None
    is_accepted: bool | None = None
    rejection_reasons: list[str] | None = None
    metadata_json: dict | None = None
    checksum: str | None = None
    captured_at: datetime | None = None


class CaptureFrameOut(BaseModel):
    id: UUID
    session_id: UUID
    storage_key: str | None
    original_filename: str | None
    quality_score: float | None
    is_accepted: bool | None
    rejection_reasons: list | None
    upload_status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class UploadUrlRequest(BaseModel):
    frame_ids: list[UUID]


class UploadUrl(BaseModel):
    frame_id: UUID
    upload_url: str
    storage_key: str


class UploadUrlResponse(BaseModel):
    urls: list[UploadUrl]


# ============================================================
# Reconstruction Schemas
# ============================================================


class ReconstructionJobCreate(BaseModel):
    capture_session_id: UUID
    engine: str = "image_blaster"
    config: dict | None = None


class ReconstructionJobOut(BaseModel):
    id: UUID
    capture_session_id: UUID
    engine: str
    status: str
    progress: float
    current_message: str | None
    retry_count: int
    error_category: str | None
    error_message: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    failed_at: datetime | None

    model_config = {"from_attributes": True}


class ReconstructionArtifactOut(BaseModel):
    id: UUID
    job_id: UUID
    artifact_type: str
    storage_key: str
    content_type: str | None
    file_size_bytes: int | None
    quality_level: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ============================================================
# Scene Schemas
# ============================================================


class SceneManifestOut(BaseModel):
    id: UUID
    room_id: UUID
    schema_version: int
    engine: str
    representation: str
    manifest_data: dict
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ============================================================
# Health
# ============================================================


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str = "0.1.0"
    database: str = "unknown"
    redis: str = "unknown"
    storage: str = "unknown"
