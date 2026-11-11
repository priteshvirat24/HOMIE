"""Reconstruction job routes — no auth."""

import logging
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.core.database import get_db
from app.core.queue import enqueue_reconstruction, revoke
from app.models.capture import CaptureFrame, CaptureSession
from app.models.reconstruction import JobStatus, ReconstructionArtifact, ReconstructionJob
from app.models.room import Room, RoomStatus
from app.schemas import ReconstructionArtifactOut, ReconstructionJobCreate, ReconstructionJobOut

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/reconstruction-jobs", tags=["reconstruction"])

TERMINAL = (JobStatus.READY, JobStatus.FAILED, JobStatus.CANCELLED)
SUPPORTED_ENGINES = {"image_blaster"}


async def _get_job_or_404(job_id: UUID, db: AsyncSession) -> ReconstructionJob:
    result = await db.execute(select(ReconstructionJob).where(ReconstructionJob.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


async def _image_keys(session: CaptureSession, db: AsyncSession) -> list[str]:
    """Storage keys of the photos this session should reconstruct from."""
    query = select(CaptureFrame).where(
        CaptureFrame.session_id == session.id,
        CaptureFrame.is_accepted == True,  # noqa: E712
        CaptureFrame.storage_key.is_not(None),
    )
    if session.selected_frame_id:
        query = query.where(CaptureFrame.id == session.selected_frame_id)
    result = await db.execute(query.order_by(CaptureFrame.created_at.asc()))
    return [f.storage_key for f in result.scalars().all() if f.storage_key]


async def _set_room_status(session: CaptureSession, new_status: RoomStatus, db: AsyncSession) -> None:
    room = await db.get(Room, session.room_id)
    # A room that already has a scene stays "ready" while a re-capture is processing.
    if room is not None and not (room.status == RoomStatus.READY and new_status != RoomStatus.READY):
        room.status = new_status


async def _enqueue(job: ReconstructionJob, keys: list[str], db: AsyncSession) -> None:
    """Commit the job first so the worker can see it, then hand it to Celery."""
    job.status = JobStatus.QUEUED
    job.current_message = "Waiting for a worker…"
    await db.commit()
    try:
        await run_in_threadpool(enqueue_reconstruction, str(job.id), keys, job.engine, job.config or {})
    except Exception as e:  # broker down
        logger.exception("Could not enqueue job %s", job.id)
        job.status = JobStatus.FAILED
        job.error_category = "queue_unavailable"
        job.error_message = f"Could not reach the job queue (Redis): {e}"
        job.failed_at = datetime.now(UTC)
        await db.commit()
        raise HTTPException(status_code=503, detail="Job queue unavailable — is Redis running?") from e


@router.post("", response_model=ReconstructionJobOut, status_code=status.HTTP_201_CREATED)
async def create_job(data: ReconstructionJobCreate, db: AsyncSession = Depends(get_db)):
    """Create and enqueue a reconstruction job for a finalized capture session."""
    if data.engine not in SUPPORTED_ENGINES:
        raise HTTPException(status_code=400, detail=f"Unknown engine '{data.engine}'")

    session = await db.get(CaptureSession, data.capture_session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Capture session not found")

    keys = await _image_keys(session, db)
    if not keys:
        raise HTTPException(status_code=400, detail="No uploaded photos found for this capture session")

    job = ReconstructionJob(
        capture_session_id=session.id,
        engine=data.engine,
        status=JobStatus.CREATED,
        config=data.config or {},
        result_summary={"input_count": len(keys)},
    )
    db.add(job)
    await _set_room_status(session, RoomStatus.PROCESSING, db)
    await db.flush()
    await _enqueue(job, keys, db)
    return job


@router.get("", response_model=list[ReconstructionJobOut])
async def list_jobs(room_id: UUID, limit: int = 5, db: AsyncSession = Depends(get_db)):
    """Most recent reconstruction jobs for a room (newest first)."""
    result = await db.execute(
        select(ReconstructionJob)
        .join(CaptureSession, CaptureSession.id == ReconstructionJob.capture_session_id)
        .where(CaptureSession.room_id == room_id)
        .order_by(ReconstructionJob.created_at.desc())
        .limit(max(1, min(limit, 50)))
    )
    return result.scalars().all()


@router.get("/{job_id}", response_model=ReconstructionJobOut)
async def get_job(job_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get reconstruction job status."""
    return await _get_job_or_404(job_id, db)


@router.get("/{job_id}/artifacts", response_model=list[ReconstructionArtifactOut])
async def list_artifacts(job_id: UUID, db: AsyncSession = Depends(get_db)):
    """List all artifacts for a reconstruction job."""
    result = await db.execute(
        select(ReconstructionArtifact)
        .where(ReconstructionArtifact.job_id == job_id)
        .order_by(ReconstructionArtifact.created_at.asc())
    )
    return result.scalars().all()


@router.post("/{job_id}/retry", response_model=ReconstructionJobOut)
async def retry_job(job_id: UUID, db: AsyncSession = Depends(get_db)):
    """Retry a failed or cancelled job with the same photos (starts a new World Labs generation)."""
    job = await _get_job_or_404(job_id, db)
    if job.status not in (JobStatus.FAILED, JobStatus.CANCELLED):
        raise HTTPException(status_code=400, detail=f"Cannot retry job in status: {job.status}")

    session = await db.get(CaptureSession, job.capture_session_id)
    keys = await _image_keys(session, db) if session else []
    if not keys:
        raise HTTPException(status_code=400, detail="The photos for this job no longer exist")

    job.retry_count += 1
    job.progress = 0.0
    job.error_message = None
    job.error_category = None
    job.failed_at = None
    job.completed_at = None
    job.result_summary = {"input_count": len(keys)}  # drop the old World Labs operation
    await _set_room_status(session, RoomStatus.PROCESSING, db)
    await _enqueue(job, keys, db)
    return job


@router.post("/{job_id}/cancel", response_model=ReconstructionJobOut)
async def cancel_job(job_id: UUID, db: AsyncSession = Depends(get_db)):
    """Cancel a queued or running job and stop its worker task."""
    job = await _get_job_or_404(job_id, db)
    if job.status in TERMINAL:
        raise HTTPException(status_code=400, detail=f"Cannot cancel job in status: {job.status}")

    job.status = JobStatus.CANCELLED
    job.current_message = "Cancelled"
    session = await db.get(CaptureSession, job.capture_session_id)
    if session:
        await _set_room_status(session, RoomStatus.CAPTURED, db)
    await db.commit()
    try:
        await run_in_threadpool(revoke, str(job.id))
    except Exception:
        logger.warning("Could not revoke Celery task for job %s", job.id, exc_info=True)
    return job


@router.get("/{job_id}/progress")
async def get_job_progress(job_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get job progress (polled by the mobile app)."""
    job = await _get_job_or_404(job_id, db)
    return {
        "id": str(job.id),
        "status": job.status,
        "progress": job.progress,
        "message": job.current_message,
        "current_message": job.current_message,
        "retry_count": job.retry_count,
        "error_message": job.error_message,
    }
