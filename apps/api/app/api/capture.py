"""Capture session and frame routes — no auth."""

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.capture import CaptureFrame, CaptureSession, CaptureSessionStatus
from app.models.room import Room
from app.schemas import (
    CaptureFrameOut,
    CaptureFrameRegister,
    CaptureSessionCreate,
    CaptureSessionOut,
)

router = APIRouter(prefix="/capture-sessions", tags=["capture"])


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


@router.post("", response_model=CaptureSessionOut, status_code=status.HTTP_201_CREATED)
async def create_capture_session(data: CaptureSessionCreate, db: AsyncSession = Depends(get_db)):
    """Create a new capture session for a room."""
    await _get_room_or_404(data.room_id, db)

    session = CaptureSession(
        room_id=data.room_id,
        status=CaptureSessionStatus.CREATED,
        device_info=data.device_info,
    )
    db.add(session)
    await db.flush()
    return session


@router.get("/{session_id}", response_model=CaptureSessionOut)
async def get_capture_session(session_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get a capture session."""
    return await _get_session_or_404(session_id, db)


@router.patch("/{session_id}/status")
async def update_session_status(
    session_id: UUID,
    new_status: str,
    db: AsyncSession = Depends(get_db),
):
    """Update the status of a capture session."""
    session = await _get_session_or_404(session_id, db)

    try:
        session.status = CaptureSessionStatus(new_status)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid status: {new_status}")

    if new_status == CaptureSessionStatus.UPLOADED:
        session.completed_at = datetime.now(UTC)

    await db.flush()
    return {"id": str(session.id), "status": session.status}


@router.post("/{session_id}/frames", response_model=CaptureFrameOut, status_code=status.HTTP_201_CREATED)
async def register_frame(
    session_id: UUID,
    data: CaptureFrameRegister,
    db: AsyncSession = Depends(get_db),
):
    """Register a captured frame (photo) in the session."""
    session = await _get_session_or_404(session_id, db)

    frame = CaptureFrame(
        session_id=session_id,
        original_filename=data.original_filename,
        content_type=data.content_type,
        file_size_bytes=data.file_size_bytes,
        width=data.width,
        height=data.height,
        quality_score=data.quality_score,
        is_accepted=data.is_accepted,
        rejection_reasons=data.rejection_reasons,
        metadata_json=data.metadata_json,
        checksum=data.checksum,
        captured_at=data.captured_at,
        upload_status="pending",
    )
    db.add(frame)

    # Update session counts
    session.frame_count += 1
    if data.is_accepted is True:
        session.accepted_count += 1
    elif data.is_accepted is False:
        session.rejected_count += 1

    await db.flush()
    return frame


@router.get("/{session_id}/frames", response_model=list[CaptureFrameOut])
async def list_frames(session_id: UUID, db: AsyncSession = Depends(get_db)):
    """List all frames in a capture session."""
    await _get_session_or_404(session_id, db)

    result = await db.execute(
        select(CaptureFrame)
        .where(CaptureFrame.session_id == session_id)
        .order_by(CaptureFrame.created_at.asc())
    )
    return result.scalars().all()


@router.delete("/{session_id}/frames/{frame_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_frame(session_id: UUID, frame_id: UUID, db: AsyncSession = Depends(get_db)):
    """Delete a frame from a capture session."""
    result = await db.execute(
        select(CaptureFrame).where(CaptureFrame.id == frame_id, CaptureFrame.session_id == session_id)
    )
    frame = result.scalar_one_or_none()
    if frame is None:
        raise HTTPException(status_code=404, detail="Frame not found")

    await db.delete(frame)
    await db.flush()


@router.post("/{session_id}/upload-urls")
async def get_upload_urls(session_id: UUID, frame_ids: list[UUID], db: AsyncSession = Depends(get_db)):
    """Get pre-signed S3 upload URLs for frames."""
    await _get_session_or_404(session_id, db)

    # TODO: Generate real S3 signed URLs using boto3
    import uuid as _uuid
    urls = []
    for frame_id in frame_ids:
        key = f"captures/{session_id}/{frame_id}.jpg"
        urls.append({
            "frame_id": str(frame_id),
            "storage_key": key,
            "upload_url": f"http://localhost:9000/homie-images/{key}?mock=true",
        })

    return {"urls": urls}


@router.post("/{session_id}/finalize")
async def finalize_session(session_id: UUID, selected_frame_id: UUID | None = None, db: AsyncSession = Depends(get_db)):
    """Finalize a capture session, marking it ready for reconstruction."""
    session = await _get_session_or_404(session_id, db)

    if session.accepted_count == 0:
        raise HTTPException(status_code=400, detail="No accepted frames — cannot finalize")

    session.status = CaptureSessionStatus.SUBMITTED
    if selected_frame_id:
        session.selected_frame_id = selected_frame_id
    session.completed_at = datetime.now(UTC)

    await db.flush()
    return {"id": str(session.id), "status": session.status, "message": "Session finalized"}
