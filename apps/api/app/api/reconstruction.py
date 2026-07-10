"""Reconstruction job routes — no auth."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.capture import CaptureSession
from app.models.reconstruction import JobStatus, ReconstructionArtifact, ReconstructionJob
from app.schemas import ReconstructionArtifactOut, ReconstructionJobCreate, ReconstructionJobOut

router = APIRouter(prefix="/reconstruction-jobs", tags=["reconstruction"])


@router.post("", response_model=ReconstructionJobOut, status_code=status.HTTP_201_CREATED)
async def create_job(data: ReconstructionJobCreate, db: AsyncSession = Depends(get_db)):
    """Create and enqueue a reconstruction job."""
    # Verify capture session exists
    result = await db.execute(select(CaptureSession).where(CaptureSession.id == data.capture_session_id))
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Capture session not found")

    job = ReconstructionJob(
        capture_session_id=data.capture_session_id,
        engine=data.engine,
        status=JobStatus.CREATED,
        config=data.config,
    )
    db.add(job)
    await db.flush()

    # Enqueue Celery task (non-blocking)
    try:
        from celery_app import app as celery_app  # type: ignore
        celery_app.send_task(
            "reconstruction.run",
            args=[str(job.id), [], data.engine, data.config or {}],
        )
        job.status = JobStatus.QUEUED
        await db.flush()
    except Exception as e:
        # Log but don't fail — job can be queued manually later
        print(f"Warning: Could not enqueue Celery task: {e}")

    return job


@router.get("/{job_id}", response_model=ReconstructionJobOut)
async def get_job(job_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get reconstruction job status."""
    result = await db.execute(select(ReconstructionJob).where(ReconstructionJob.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


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
    """Retry a failed reconstruction job."""
    result = await db.execute(select(ReconstructionJob).where(ReconstructionJob.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status not in (JobStatus.FAILED, JobStatus.CANCELLED):
        raise HTTPException(status_code=400, detail=f"Cannot retry job in status: {job.status}")

    job.status = JobStatus.QUEUED
    job.retry_count += 1
    job.error_message = None
    job.error_category = None
    await db.flush()

    # Re-enqueue
    try:
        from celery_app import app as celery_app  # type: ignore
        celery_app.send_task(
            "reconstruction.run",
            args=[str(job.id), [], job.engine, job.config or {}],
        )
    except Exception as e:
        print(f"Warning: Could not re-enqueue Celery task: {e}")

    return job


@router.post("/{job_id}/cancel", response_model=ReconstructionJobOut)
async def cancel_job(job_id: UUID, db: AsyncSession = Depends(get_db)):
    """Cancel a queued or running reconstruction job."""
    result = await db.execute(select(ReconstructionJob).where(ReconstructionJob.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status in (JobStatus.READY, JobStatus.FAILED, JobStatus.CANCELLED):
        raise HTTPException(status_code=400, detail=f"Cannot cancel job in status: {job.status}")

    job.status = JobStatus.CANCELLED
    await db.flush()
    return job


@router.get("/{job_id}/progress")
async def get_job_progress(job_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get job progress (for polling fallback)."""
    result = await db.execute(select(ReconstructionJob).where(ReconstructionJob.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    return {
        "id": str(job.id),
        "status": job.status,
        "progress": job.progress,
        "message": job.current_message,
        "retry_count": job.retry_count,
        "error_message": job.error_message,
    }
