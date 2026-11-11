"""HOMIE API — Celery client used to enqueue work for the worker.

The API only needs the broker and the task name; it does not import worker code.
The Celery task id is the reconstruction job id, so a job can be revoked by id.
"""

from functools import lru_cache

from celery import Celery

from app.core.config import get_settings

RECONSTRUCTION_TASK = "reconstruction.run"


@lru_cache
def celery_client() -> Celery:
    url = get_settings().redis_url
    return Celery("homie_api", broker=url, backend=url)


def enqueue_reconstruction(job_id: str, image_keys: list[str], engine: str, config: dict) -> None:
    celery_client().send_task(RECONSTRUCTION_TASK, args=[job_id, image_keys, engine, config], task_id=job_id)


def revoke(job_id: str) -> None:
    celery_client().control.revoke(job_id, terminate=True, signal="SIGTERM")
