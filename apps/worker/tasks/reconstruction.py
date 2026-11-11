"""HOMIE Worker — Celery task that turns a room's photos into a 3D scene."""

import logging
import mimetypes
import os
import shutil
from pathlib import Path
from typing import Any

import boto3
from botocore.config import Config
from celery.exceptions import SoftTimeLimitExceeded

import db
from celery_app import app
from engines import EngineError, JobCancelled, TransientEngineError, get_engine

logger = logging.getLogger(__name__)

WORKSPACE_ROOT = Path(os.getenv("WORKER_WORKSPACE", "/tmp/homie-worker"))
mimetypes.add_type("application/octet-stream", ".spz")
mimetypes.add_type("model/gltf-binary", ".glb")
mimetypes.add_type("image/webp", ".webp")


def _s3():
    return boto3.client(
        "s3",
        endpoint_url=os.getenv("S3_ENDPOINT", "http://localhost:9000"),
        aws_access_key_id=os.getenv("S3_ACCESS_KEY", "minioadmin"),
        aws_secret_access_key=os.getenv("S3_SECRET_KEY", "minioadmin"),
        region_name=os.getenv("S3_REGION", "us-east-1"),
        config=Config(signature_version="s3v4", retries={"max_attempts": 5}),
    )


class _Context:
    """JobContext implementation backed by the jobs table."""

    def __init__(self, job_id: str, summary: dict[str, Any]):
        self.job_id = job_id
        self.summary = summary
        self._last_progress = -1.0

    def progress(self, fraction: float, message: str) -> None:
        fraction = max(0.0, min(fraction, 0.99))
        status = "generating_world" if 0.15 <= fraction < 0.82 else (
            "uploading_artifacts" if fraction >= 0.9 else "downloading_images" if fraction < 0.15 else "postprocessing"
        )
        logger.info("[%s] %3.0f%% %s", self.job_id, fraction * 100, message)
        db.update_progress(self.job_id, fraction, message, status)
        self._last_progress = fraction

    def check_cancelled(self) -> None:
        job = db.get_job(self.job_id)
        if job is None or job["status"] == "cancelled":
            raise JobCancelled()

    def get_state(self, key: str) -> Any:
        return self.summary.get(key)

    def set_state(self, key: str, value: Any) -> None:
        self.summary[key] = value
        db.set_summary_value(self.job_id, key, value)


@app.task(
    bind=True,
    name="reconstruction.run",
    max_retries=3,
    acks_late=True,
    soft_time_limit=45 * 60,
    time_limit=50 * 60,
)
def run_reconstruction(self, job_id: str, image_keys: list[str], engine_name: str = "image_blaster", config=None):
    """Download the room photos, generate a world with the engine, upload the scene files, publish the scene."""
    config = config or {}
    job = db.get_job(job_id)
    if job is None:
        logger.error("Job %s not found — dropping task", job_id)
        return {"job_id": job_id, "success": False, "error": "job not found"}
    if job["status"] in ("cancelled", "ready"):
        logger.info("Job %s is %s — nothing to do", job_id, job["status"])
        return {"job_id": job_id, "success": job["status"] == "ready"}

    workspace = WORKSPACE_ROOT / job_id
    (workspace / "input").mkdir(parents=True, exist_ok=True)
    (workspace / "output").mkdir(parents=True, exist_ok=True)
    ctx = _Context(job_id, job["result_summary"])

    try:
        engine = get_engine(engine_name)
        engine.validate_environment()
        ctx.progress(0.02, "Fetching your photos…")

        s3 = _s3()
        images_bucket = os.getenv("S3_BUCKET_IMAGES", "homie-images")
        local_images: list[Path] = []
        for key in image_keys:
            dest = workspace / "input" / Path(key).name
            if not dest.exists():
                try:
                    s3.download_file(images_bucket, key, str(dest))
                except Exception as e:
                    raise TransientEngineError(f"Could not download photo {key}: {e}") from e
            local_images.append(dest)
        if not local_images:
            raise EngineError("No photos to reconstruct from", "bad_input")

        scene = engine.reconstruct(local_images, workspace / "output", config, ctx)

        ctx.check_cancelled()
        ctx.progress(0.92, "Saving your 3D room…")
        scenes_bucket = os.getenv("S3_BUCKET_SCENES", "homie-scenes")
        uploaded: dict[str, dict[str, Any]] = {}
        for name, path in scene.files.items():
            key = f"scenes/{job_id}/{path.name}"
            content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            s3.upload_file(str(path), scenes_bucket, key, ExtraArgs={"ContentType": content_type})
            uploaded[name] = {"key": key, "content_type": content_type, "size": path.stat().st_size}

        manifest = dict(scene.manifest)
        manifest["artifactKeys"] = {name: info["key"] for name, info in uploaded.items()}
        if not db.complete_job(job_id, engine_name, uploaded, manifest):
            logger.info("Job %s was cancelled before it could be published", job_id)
            return {"job_id": job_id, "success": False, "cancelled": True}

        shutil.rmtree(workspace, ignore_errors=True)
        logger.info("Job %s completed: %s", job_id, sorted(uploaded))
        return {"job_id": job_id, "success": True, "artifacts": sorted(uploaded)}

    except JobCancelled:
        logger.info("Job %s cancelled", job_id)
        shutil.rmtree(workspace, ignore_errors=True)
        return {"job_id": job_id, "success": False, "cancelled": True}

    except TransientEngineError as exc:
        if self.request.retries < self.max_retries:
            delay = 30 * (2 ** self.request.retries)
            logger.warning("Job %s hit a temporary error (%s); retrying in %ss", job_id, exc, delay)
            db.update_progress(job_id, ctx._last_progress if ctx._last_progress > 0 else 0.05,
                               "Temporary problem, retrying shortly…", "queued")
            raise self.retry(exc=exc, countdown=delay)
        db.mark_failed(job_id, "transient_exhausted", str(exc))
        return {"job_id": job_id, "success": False, "error": str(exc)}

    except EngineError as exc:
        logger.error("Job %s failed: %s", job_id, exc)
        db.mark_failed(job_id, exc.category, str(exc))
        return {"job_id": job_id, "success": False, "error": str(exc)}

    except SoftTimeLimitExceeded:
        db.mark_failed(job_id, "timeout", "Reconstruction took too long and was stopped")
        return {"job_id": job_id, "success": False, "error": "timeout"}

    except Exception as exc:  # unexpected bug — record it, don't retry (a retry could pay World Labs twice)
        logger.exception("Job %s crashed", job_id)
        db.mark_failed(job_id, "internal_error", f"{type(exc).__name__}: {exc}")
        return {"job_id": job_id, "success": False, "error": str(exc)}
