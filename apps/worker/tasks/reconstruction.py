"""HOMIE Worker — Celery task definitions for reconstruction."""

import asyncio
import logging
import os
import uuid
from pathlib import Path

from celery_app import app
from engines import get_engine

logger = logging.getLogger(__name__)

WORKSPACE_ROOT = Path(os.getenv("WORKER_WORKSPACE", "/tmp/homie-worker"))


def _ensure_workspace(job_id: str) -> Path:
    """Create an isolated workspace for a job."""
    workspace = WORKSPACE_ROOT / job_id
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / "input").mkdir(exist_ok=True)
    (workspace / "output").mkdir(exist_ok=True)
    (workspace / "logs").mkdir(exist_ok=True)
    return workspace


def _run_async(coro):
    """Run an async function from a sync Celery task."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@app.task(bind=True, name="reconstruction.run", max_retries=3, default_retry_delay=60)
def run_reconstruction(self, job_id: str, image_paths: list[str], engine_name: str = "image_blaster", config: dict | None = None):
    """Main reconstruction task.

    Args:
        job_id: Unique job identifier
        image_paths: List of S3 keys or local paths to input images
        engine_name: Which reconstruction engine to use
        config: Optional engine-specific configuration
    """
    config = config or {}
    workspace = _ensure_workspace(job_id)
    log_file = workspace / "logs" / "reconstruction.log"

    file_handler = logging.FileHandler(log_file)
    file_handler.setLevel(logging.DEBUG)
    logger.addHandler(file_handler)

    logger.info(f"Starting reconstruction job {job_id} with engine {engine_name}")

    def progress_callback(progress: float, message: str):
        """Report progress back via Celery task state."""
        self.update_state(
            state="PROGRESS",
            meta={"progress": progress, "message": message, "job_id": job_id},
        )
        logger.info(f"[{progress:.0%}] {message}")

    async def _async_progress(progress: float, message: str):
        progress_callback(progress, message)

    try:
        engine = get_engine(engine_name)

        # Step 1: Validate environment
        progress_callback(0.02, "Validating environment...")
        env_result = _run_async(engine.validate_environment())
        if not env_result.is_valid:
            raise RuntimeError(f"Environment validation failed: {'; '.join(env_result.errors)}")
        for warning in env_result.warnings:
            logger.warning(f"Environment warning: {warning}")

        # Step 2: Resolve image paths (download from S3 if needed)
        progress_callback(0.05, "Preparing input images...")
        local_images = []
        for img_path in image_paths:
            p = Path(img_path)
            if p.exists():
                local_images.append(p)
            else:
                # TODO: Download from S3
                logger.warning(f"Image path not found locally, skipping: {img_path}")

        if not local_images:
            raise RuntimeError("No valid input images available")

        # Step 3: Validate inputs
        input_result = _run_async(engine.validate_inputs(local_images))
        if not input_result.is_valid:
            raise RuntimeError(f"Input validation failed: {'; '.join(input_result.errors)}")

        # Step 4: Prepare inputs
        prepared = _run_async(engine.prepare_inputs(job_id, local_images, config))

        # Step 5: Run reconstruction
        output = _run_async(engine.run_reconstruction(prepared, _async_progress))

        if not output.success:
            raise RuntimeError(f"Reconstruction failed: {'; '.join(output.errors)}")

        # Step 6: Postprocess outputs
        progress_callback(0.9, "Postprocessing and optimizing...")
        artifacts = _run_async(engine.postprocess_outputs(output, workspace / "output"))

        progress_callback(0.95, "Uploading artifacts...")
        # TODO: Upload artifacts to S3 and update database

        progress_callback(1.0, "Reconstruction complete!")

        result = {
            "job_id": job_id,
            "success": True,
            "engine": engine_name,
            "manifest": artifacts.manifest,
            "artifacts": {
                "splat": str(artifacts.splat_path) if artifacts.splat_path else None,
                "collider_mesh": str(artifacts.collider_mesh_path) if artifacts.collider_mesh_path else None,
                "thumbnail": str(artifacts.thumbnail_path) if artifacts.thumbnail_path else None,
            },
        }

        logger.info(f"Reconstruction job {job_id} completed successfully")
        return result

    except Exception as exc:
        logger.error(f"Reconstruction job {job_id} failed: {exc}", exc_info=True)

        # Retry on transient errors
        if self.request.retries < self.max_retries:
            logger.info(f"Retrying job {job_id} (attempt {self.request.retries + 1}/{self.max_retries})")
            raise self.retry(exc=exc)

        return {
            "job_id": job_id,
            "success": False,
            "engine": engine_name,
            "error": str(exc),
        }
    finally:
        logger.removeHandler(file_handler)
        file_handler.close()
