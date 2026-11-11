"""HOMIE Worker — Celery application configuration.

Run from apps/worker:  celery -A celery_app worker --loglevel=info
"""

import os
from pathlib import Path

from celery import Celery
from dotenv import load_dotenv

# Load .env from the repository root
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

app = Celery("homie_worker", broker=REDIS_URL, backend=REDIS_URL, include=["tasks.reconstruction"])

app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    task_reject_on_worker_lost=False,  # never re-run a half-finished paid generation automatically
    worker_prefetch_multiplier=1,
    result_expires=86400,
    broker_connection_retry_on_startup=True,
    # Redis redelivers unacked tasks after this; it must exceed the longest job (50 min hard limit).
    broker_transport_options={"visibility_timeout": 60 * 60},
)
