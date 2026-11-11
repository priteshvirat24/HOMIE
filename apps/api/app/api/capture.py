"""Capture session and photo upload routes — no auth."""

import hashlib
from datetime import UTC, datetime
from pathlib import PurePath
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.core.database import get_db
from app.core.storage import put_image
from app.models.capture import CaptureFrame, CaptureSession, CaptureSessionStatus
from app.models.room import Room, RoomStatus
from app.schemas import CaptureFrameOut, CaptureSessionCreate, CaptureSessionOut

router = APIRouter(prefix="/capture-sessions", tags=["capture"])

MAX_PHOTO_BYTES = 25 * 1024 * 1024
MAX_PHOTOS_PER_SESSION = 8  # World Labs multi-image accepts at most 8 images
ALLOWED_TYPES = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
}


async def _get_room_or_404(room_id: UUID, db: AsyncSession) -> Room:
    result = await db.execute(select(Room).where(Room.id == room_id, Room.deleted_at.is_(None)))
    room = result.scalar_one_or_none()
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
    return room


async def _get_session_or_404(session_id: UUID, db: AsyncSession) -> CaptureSession:
    result = await db.execute(select(CaptureSession).where(CaptureSession.id == session_id))
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Capture session not found")
    return session


def _extension(upload: UploadFile) -> str:
    content_type = (upload.content_type or "").lower()
    if content_type in ALLOWED_TYPES:
        return ALLOWED_TYPES[content_type]
    suffix = PurePath(upload.filename or "").suffix.lower().lstrip(".")
    if suffix in {"jpg", "jpeg", "png", "webp", "heic", "heif"}:
        return "jpg" if suffix == "jpeg" else suffix
    raise HTTPException(status_code=415, detail=f"Unsupported image type: {upload.content_type or upload.filename}")


@router.post("", response_model=CaptureSessionOut, status_code=status.HTTP_201_CREATED)
async def create_capture_session(data: CaptureSessionCreate, db: AsyncSession = Depends(get_db)):
    """Create a new capture session for a room."""
    room = await _get_room_or_404(data.room_id, db)

    session = CaptureSession(
        room_id=data.room_id,
        status=CaptureSessionStatus.CAPTURING,
        device_info=data.device_info,
    )
    db.add(session)
    if room.status != RoomStatus.READY:
        room.status = RoomStatus.CAPTURING
    await db.flush()
    return session


@router.get("/{session_id}", response_model=CaptureSessionOut)
async def get_capture_session(session_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get a capture session."""
    return await _get_session_or_404(session_id, db)


@router.post("/{session_id}/photos", response_model=CaptureFrameOut, status_code=status.HTTP_201_CREATED)
async def upload_photo(session_id: UUID, file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    """Upload one room photo (multipart field `file`). Stored in object storage and registered as a frame."""
    session = await _get_session_or_404(session_id, db)
    if session.status == CaptureSessionStatus.SUBMITTED:
        raise HTTPException(status_code=409, detail="Session already submitted for reconstruction")
    if session.accepted_count >= MAX_PHOTOS_PER_SESSION:
        raise HTTPException(status_code=400, detail=f"A room can use at most {MAX_PHOTOS_PER_SESSION} photos")

    ext = _extension(file)
    data = await file.read(MAX_PHOTO_BYTES + 1)
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="Photo is larger than 25 MB")
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    frame_id = uuid4()
    key = f"captures/{session_id}/{frame_id}.{ext}"
    content_type = file.content_type if (file.content_type or "").startswith("image/") else f"image/{ext}"
    await run_in_threadpool(put_image, key, data, content_type)

    frame = CaptureFrame(
        id=frame_id,
        session_id=session_id,
        storage_key=key,
        original_filename=file.filename,
        content_type=content_type,
        file_size_bytes=len(data),
        is_accepted=True,
        checksum=hashlib.sha256(data).hexdigest(),
        captured_at=datetime.now(UTC),
        upload_status="uploaded",
    )
    db.add(frame)
    session.frame_count += 1
    session.accepted_count += 1
    await db.flush()
    return frame


@router.get("/{session_id}/frames", response_model=list[CaptureFrameOut])
async def list_frames(session_id: UUID, db: AsyncSession = Depends(get_db)):
    """List all frames in a capture session."""
    await _get_session_or_404(session_id, db)
    result = await db.execute(
        select(CaptureFrame).where(CaptureFrame.session_id == session_id).order_by(CaptureFrame.created_at.asc())
    )
    return result.scalars().all()


@router.delete("/{session_id}/frames/{frame_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_frame(session_id: UUID, frame_id: UUID, db: AsyncSession = Depends(get_db)):
    """Remove a photo from a capture session (the stored object is left for cleanup)."""
    session = await _get_session_or_404(session_id, db)
    result = await db.execute(
        select(CaptureFrame).where(CaptureFrame.id == frame_id, CaptureFrame.session_id == session_id)
    )
    frame = result.scalar_one_or_none()
    if frame is None:
        raise HTTPException(status_code=404, detail="Frame not found")

    session.frame_count = max(0, session.frame_count - 1)
    if frame.is_accepted:
        session.accepted_count = max(0, session.accepted_count - 1)
    await db.delete(frame)
    await db.flush()


@router.post("/{session_id}/finalize")
async def finalize_session(
    session_id: UUID, selected_frame_id: UUID | None = None, db: AsyncSession = Depends(get_db)
):
    """Mark a capture session ready for reconstruction.

    With `selected_frame_id`, only that photo is used; otherwise every uploaded photo is used.
    """
    session = await _get_session_or_404(session_id, db)
    if session.accepted_count == 0:
        raise HTTPException(status_code=400, detail="No photos uploaded — cannot finalize")

    session.status = CaptureSessionStatus.SUBMITTED
    session.selected_frame_id = selected_frame_id
    session.completed_at = datetime.now(UTC)
    await db.flush()
    return {"id": str(session.id), "status": session.status, "message": "Session finalized"}
