"""HOMIE Worker — Celery task definitions for reconstruction."""

import asyncio
import logging
import os
import uuid
import json
import boto3
from botocore.config import Config
import psycopg2
from pathlib import Path

from celery_app import app
from engines import get_engine

logger = logging.getLogger(__name__)

WORKSPACE_ROOT = Path(os.getenv("WORKER_WORKSPACE", "/tmp/homie-worker"))

def _get_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=os.getenv("S3_ENDPOINT", "http://localhost:9000"),
        aws_access_key_id=os.getenv("S3_ACCESS_KEY", "homie_minio_user"),
        aws_secret_access_key=os.getenv("S3_SECRET_KEY", "homie_minio_pass"),
        region_name=os.getenv("S3_REGION", "us-east-1"),
        config=Config(signature_version="s3v4"),
    )

def _get_db_conn():
    return psycopg2.connect(os.getenv("DATABASE_URL", "postgresql://homie:homie@localhost:5432/homie"))


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
        """Report progress back via Celery task state and Database."""
        self.update_state(
            state="PROGRESS",
            meta={"progress": progress, "message": message, "job_id": job_id},
        )
        logger.info(f"[{progress:.0%}] {message}")
        try:
            with _get_db_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE reconstruction_jobs SET progress = %s, current_message = %s, status = 'running' WHERE id = %s",
                        (progress, message, job_id)
                    )
                conn.commit()
        except Exception as e:
            logger.warning(f"Could not update DB progress: {e}")

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
        s3 = _get_s3_client()
        bucket = os.getenv("S3_BUCKET_IMAGES", "homie-images")
        
        for img_path in image_paths:
            p = Path(img_path)
            if p.exists():
                local_images.append(p)
            else:
                # Download from S3
                local_file = workspace / "input" / p.name
                try:
                    s3.download_file(bucket, img_path, str(local_file))
                    local_images.append(local_file)
                    logger.info(f"Downloaded S3 object {img_path} to {local_file}")
                except Exception as e:
                    logger.warning(f"Failed to download {img_path}: {e}")

        if not local_images:
            raise RuntimeError("No valid input images available after downloading from storage")

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
        bucket_scenes = os.getenv("S3_BUCKET_SCENES", "homie-scenes")
        
        db_artifacts = []
        for art_type, local_path in [
            ("splat", artifacts.splat_path),
            ("collider_mesh", artifacts.collider_mesh_path),
            ("panorama", artifacts.panorama_path),
            ("thumbnail", artifacts.thumbnail_path),
        ]:
            if local_path and local_path.exists():
                s3_key = f"scenes/{job_id}/{local_path.name}"
                s3.upload_file(str(local_path), bucket_scenes, s3_key)
                # Ensure the path in the manifest points to the MinIO URL
                if art_type == "splat":
                    artifacts.manifest["artifacts"]["splat"] = f"http://localhost:9000/{bucket_scenes}/{s3_key}"
                db_artifacts.append((s3_key, art_type, local_path.name, local_path.stat().st_size))

        progress_callback(1.0, "Reconstruction complete!")

        # Update DB: success
        try:
            with _get_db_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE reconstruction_jobs SET status = 'ready', progress = 1.0, current_message = 'Completed' WHERE id = %s",
                        (job_id,)
                    )
                    # Insert artifacts
                    for s3_key, art_type, filename, size in db_artifacts:
                        cur.execute(
                            "INSERT INTO reconstruction_artifacts (id, job_id, artifact_type, storage_key, original_filename, file_size_bytes, created_at, updated_at) "
                            "VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, NOW(), NOW())",
                            (job_id, art_type, s3_key, filename, size)
                        )
                    # Create scene record using manifest
                    cur.execute(
                        "SELECT capture_session_id FROM reconstruction_jobs WHERE id = %s", (job_id,)
                    )
                    row = cur.fetchone()
                    if row:
                        session_id = row[0]
                        cur.execute("SELECT room_id FROM capture_sessions WHERE id = %s", (session_id,))
                        room_row = cur.fetchone()
                        if room_row:
                            room_id = room_row[0]
                            manifest_json = json.dumps(artifacts.manifest)
                            cur.execute(
                                "INSERT INTO scene_manifests (id, room_id, job_id, schema_version, engine, representation, manifest_data, is_active, created_at) "
                                "VALUES (gen_random_uuid(), %s, %s, 1, %s, 'gaussian_splat', %s, true, NOW())",
                                (room_id, job_id, engine_name, manifest_json)
                            )
                            # Update room status
                            cur.execute("UPDATE rooms SET status = 'processed' WHERE id = %s", (room_id,))
                conn.commit()
        except Exception as e:
            logger.error(f"Failed to update database on success: {e}")

        result = {
            "job_id": job_id,
            "success": True,
            "engine": engine_name,
            "manifest": artifacts.manifest,
        }

        logger.info(f"Reconstruction job {job_id} completed successfully")
        return result

    except Exception as exc:
        logger.error(f"Reconstruction job {job_id} failed: {exc}", exc_info=True)

        # Retry on transient errors
        if self.request.retries < self.max_retries:
            logger.info(f"Retrying job {job_id} (attempt {self.request.retries + 1}/{self.max_retries})")
            raise self.retry(exc=exc)

        # Update DB: failed
        try:
            with _get_db_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE reconstruction_jobs SET status = 'failed', error_message = %s WHERE id = %s",
                        (str(exc), job_id)
                    )
                conn.commit()
        except Exception as dbe:
            logger.error(f"Failed to update database on failure: {dbe}")

        return {
            "job_id": job_id,
            "success": False,
            "engine": engine_name,
            "error": str(exc),
        }
    finally:
        logger.removeHandler(file_handler)
        file_handler.close()
