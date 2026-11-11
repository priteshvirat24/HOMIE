"""Worker test fixtures.

Unit tests need nothing running. Tests marked `integration` need the docker-compose services
(Postgres on 5433, SeaweedFS S3 on 9000) and build a throwaway database `homie_worker_test`
using the API's Alembic migrations.
"""

import os
import subprocess
import sys
import uuid
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
WORKER = ROOT / "apps" / "worker"
API = ROOT / "apps" / "api"
sys.path.insert(0, str(WORKER))

TEST_ENV = {
    "POSTGRES_HOST": os.getenv("TEST_POSTGRES_HOST", "localhost"),
    "POSTGRES_PORT": os.getenv("TEST_POSTGRES_PORT", "5433"),
    "POSTGRES_USER": os.getenv("TEST_POSTGRES_USER", "homie"),
    "POSTGRES_PASSWORD": os.getenv("TEST_POSTGRES_PASSWORD", "homie_dev_password"),
    "POSTGRES_DB": "homie_worker_test",
    "REDIS_URL": os.getenv("TEST_REDIS_URL", "redis://localhost:6380/15"),
    "S3_ENDPOINT": os.getenv("TEST_S3_ENDPOINT", "http://localhost:9000"),
    "S3_ACCESS_KEY": "test",
    "S3_SECRET_KEY": "test",
    "S3_BUCKET_IMAGES": "homie-worker-test-images",
    "S3_BUCKET_SCENES": "homie-worker-test-scenes",
    "WORLD_LABS_API_KEY": "test-key",
    "WORLD_LABS_POLL_INTERVAL": "0.05",
}
os.environ.update(TEST_ENV)
os.environ.pop("DATABASE_URL", None)


def _admin_conn():
    import psycopg2

    conn = psycopg2.connect(
        host=TEST_ENV["POSTGRES_HOST"], port=TEST_ENV["POSTGRES_PORT"], user=TEST_ENV["POSTGRES_USER"],
        password=TEST_ENV["POSTGRES_PASSWORD"], dbname="postgres", connect_timeout=3,
    )
    conn.autocommit = True
    return conn


@pytest.fixture(scope="session")
def database():
    """Fresh database with the real schema (API migrations)."""
    try:
        conn = _admin_conn()
    except Exception as e:  # pragma: no cover
        pytest.skip(f"Postgres not reachable ({e}); run `docker compose up -d`")
    with conn.cursor() as cur:
        cur.execute("DROP DATABASE IF EXISTS homie_worker_test WITH (FORCE)")
        cur.execute("CREATE DATABASE homie_worker_test")
    conn.close()
    alembic = API / ".venv" / "bin" / "alembic"
    if not alembic.exists():  # pragma: no cover
        pytest.skip("API virtualenv missing (apps/api/.venv) — needed to build the schema")
    env = {**os.environ, **TEST_ENV}
    subprocess.run([str(alembic), "upgrade", "head"], cwd=API, env=env, check=True, capture_output=True)
    yield
    conn = _admin_conn()
    with conn.cursor() as cur:
        cur.execute("DROP DATABASE IF EXISTS homie_worker_test WITH (FORCE)")
    conn.close()


@pytest.fixture
def cur(database):
    import db

    with db.connect() as c:
        yield c


@pytest.fixture
def seed(database):
    """Insert property → room → capture session → job; returns their ids."""
    import db

    def _seed(job_status: str = "queued", room_status: str = "processing", summary: dict | None = None):
        import json

        ids = {k: str(uuid.uuid4()) for k in ("property", "room", "session", "job")}
        with db.connect() as c:
            c.execute(
                "INSERT INTO properties (id, user_id, name, created_at, updated_at) "
                "VALUES (%s, '00000000-0000-0000-0000-000000000001', 'P', NOW(), NOW())",
                (ids["property"],),
            )
            c.execute(
                "INSERT INTO rooms (id, property_id, name, room_type, status, created_at, updated_at) "
                "VALUES (%s, %s, 'Living', 'living_room', %s, NOW(), NOW())",
                (ids["room"], ids["property"], room_status),
            )
            c.execute(
                "INSERT INTO capture_sessions (id, room_id, status, frame_count, accepted_count, rejected_count, "
                "created_at, updated_at) VALUES (%s, %s, 'submitted', 1, 1, 0, NOW(), NOW())",
                (ids["session"], ids["room"]),
            )
            c.execute(
                "INSERT INTO reconstruction_jobs (id, capture_session_id, engine, status, progress, retry_count, "
                "max_retries, result_summary, created_at) VALUES (%s, %s, 'image_blaster', %s, 0, 0, 3, %s, NOW())",
                (ids["job"], ids["session"], job_status, json.dumps(summary or {})),
            )
        return ids

    return _seed


@pytest.fixture(scope="session")
def s3(database):
    import boto3

    client = boto3.client(
        "s3", endpoint_url=TEST_ENV["S3_ENDPOINT"], aws_access_key_id="test", aws_secret_access_key="test",
        region_name="us-east-1",
    )
    try:
        for b in (TEST_ENV["S3_BUCKET_IMAGES"], TEST_ENV["S3_BUCKET_SCENES"]):
            try:
                client.head_bucket(Bucket=b)
            except Exception:
                client.create_bucket(Bucket=b)
    except Exception as e:  # pragma: no cover
        pytest.skip(f"S3 not reachable ({e}); run `docker compose up -d`")
    return client


@pytest.fixture
def fake_wl(monkeypatch):
    from tests.fake_worldlabs import FakeWorldLabs

    import engines.image_blaster as ib

    with FakeWorldLabs() as fake:
        monkeypatch.setattr(ib, "ENDPOINT", fake.endpoint)
        monkeypatch.setattr(ib, "POLL_INTERVAL_S", 0.01)
        yield fake


class RecordingContext:
    """In-memory JobContext for engine tests."""

    def __init__(self, state=None, cancel_after_checks: int | None = None):
        self.state = dict(state or {})
        self.events: list[tuple[float, str]] = []
        self.checks = 0
        self.cancel_after_checks = cancel_after_checks

    def progress(self, fraction, message):
        self.events.append((fraction, message))

    def check_cancelled(self):
        from engines import JobCancelled

        self.checks += 1
        if self.cancel_after_checks is not None and self.checks > self.cancel_after_checks:
            raise JobCancelled()

    def get_state(self, key):
        return self.state.get(key)

    def set_state(self, key, value):
        self.state[key] = value


@pytest.fixture
def ctx():
    return RecordingContext()


@pytest.fixture
def make_image(tmp_path):
    from PIL import Image

    def _make(name="photo.jpg", size=(800, 600), color=(120, 80, 40), fmt=None, exif_orientation=None, mode="RGB"):
        path = tmp_path / name
        im = Image.new(mode, size, color if mode == "RGB" else color + (255,))
        kwargs = {}
        if exif_orientation:
            exif = Image.Exif()
            exif[0x0112] = exif_orientation
            kwargs["exif"] = exif.tobytes()
        im.save(path, format=fmt, **kwargs)
        return path

    return _make
