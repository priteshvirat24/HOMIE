"""API test fixtures.

Uses the docker-compose services: Postgres (5433) with a throwaway database `homie_api_test`
built by the real Alembic migrations, and the S3 server (9000) with test buckets.
The Celery queue is replaced by a recorder so no worker (and no World Labs call) is involved.
"""

import io
import os
import subprocess
from pathlib import Path

import pytest

API = Path(__file__).resolve().parents[1]

TEST_ENV = {
    "POSTGRES_HOST": os.getenv("TEST_POSTGRES_HOST", "localhost"),
    "POSTGRES_PORT": os.getenv("TEST_POSTGRES_PORT", "5433"),
    "POSTGRES_USER": os.getenv("TEST_POSTGRES_USER", "homie"),
    "POSTGRES_PASSWORD": os.getenv("TEST_POSTGRES_PASSWORD", "homie_dev_password"),
    "POSTGRES_DB": "homie_api_test",
    "REDIS_URL": os.getenv("TEST_REDIS_URL", "redis://localhost:6380/15"),
    "S3_ENDPOINT": os.getenv("TEST_S3_ENDPOINT", "http://localhost:9000"),
    "S3_ACCESS_KEY": "test",
    "S3_SECRET_KEY": "test",
    "S3_BUCKET_IMAGES": "homie-api-test-images",
    "S3_BUCKET_SCENES": "homie-api-test-scenes",
}
os.environ.update(TEST_ENV)


def _admin():
    import psycopg2

    conn = psycopg2.connect(
        host=TEST_ENV["POSTGRES_HOST"], port=TEST_ENV["POSTGRES_PORT"], user=TEST_ENV["POSTGRES_USER"],
        password=TEST_ENV["POSTGRES_PASSWORD"], dbname="postgres", connect_timeout=3,
    )
    conn.autocommit = True
    return conn


def pytest_sessionstart(session):
    try:
        conn = _admin()
    except Exception as e:  # pragma: no cover
        raise pytest.UsageError(f"Postgres not reachable on {TEST_ENV['POSTGRES_PORT']} ({e}); run `docker compose up -d`")
    with conn.cursor() as cur:
        cur.execute("DROP DATABASE IF EXISTS homie_api_test WITH (FORCE)")
        cur.execute("CREATE DATABASE homie_api_test")
    conn.close()
    subprocess.run([str(API / ".venv" / "bin" / "alembic"), "upgrade", "head"], cwd=API,
                   env={**os.environ, **TEST_ENV}, check=True, capture_output=True)


def pytest_sessionfinish(session, exitstatus):
    try:
        conn = _admin()
        with conn.cursor() as cur:
            cur.execute("DROP DATABASE IF EXISTS homie_api_test WITH (FORCE)")
        conn.close()
    except Exception:  # pragma: no cover
        pass


class QueueRecorder:
    def __init__(self):
        self.enqueued: list[tuple] = []
        self.revoked: list[str] = []
        self.fail_enqueue = False

    def enqueue(self, job_id, keys, engine, config):
        if self.fail_enqueue:
            raise ConnectionError("redis down")
        self.enqueued.append((job_id, keys, engine, config))

    def revoke(self, job_id):
        self.revoked.append(job_id)


@pytest.fixture
def queue(monkeypatch):
    import app.api.reconstruction as rec

    q = QueueRecorder()
    monkeypatch.setattr(rec, "enqueue_reconstruction", q.enqueue)
    monkeypatch.setattr(rec, "revoke", q.revoke)
    return q


@pytest.fixture(scope="session")
def app():
    from app.core.storage import ensure_buckets
    from app.main import app as fastapi_app

    ensure_buckets()
    return fastapi_app


@pytest.fixture
async def client(app, queue):
    import httpx

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


def jpeg_bytes(size=(64, 48), color=(10, 120, 200)) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "JPEG")
    return buf.getvalue()


@pytest.fixture
def house(client):
    async def _make(name="Test house", address=None):
        r = await client.post("/api/v1/properties", json={"name": name, "address": address})
        assert r.status_code == 201, r.text
        return r.json()

    return _make


@pytest.fixture
def room(client, house):
    async def _make(property_id=None, name="Living", room_type="living_room"):
        pid = property_id or (await house())["id"]
        r = await client.post(f"/api/v1/properties/{pid}/rooms", json={"name": name, "room_type": room_type})
        assert r.status_code == 201, r.text
        return r.json()

    return _make


@pytest.fixture
def session_with_photos(client, room):
    """A room with a capture session holding n uploaded photos; returns (room, session_id)."""

    async def _make(n=1, finalize=True, room_obj=None):
        rm = room_obj or await room()
        s = (await client.post("/api/v1/capture-sessions", json={"room_id": rm["id"]})).json()
        for i in range(n):
            r = await client.post(
                f"/api/v1/capture-sessions/{s['id']}/photos",
                files={"file": (f"p{i}.jpg", jpeg_bytes(), "image/jpeg")},
            )
            assert r.status_code == 201, r.text
        if finalize:
            assert (await client.post(f"/api/v1/capture-sessions/{s['id']}/finalize")).status_code == 200
        return rm, s["id"]

    return _make


@pytest.fixture
def sync_db():
    """psycopg2 cursor on the test database for arranging state the API can't create (e.g. worker output)."""
    import psycopg2

    conn = psycopg2.connect(
        host=TEST_ENV["POSTGRES_HOST"], port=TEST_ENV["POSTGRES_PORT"], user=TEST_ENV["POSTGRES_USER"],
        password=TEST_ENV["POSTGRES_PASSWORD"], dbname="homie_api_test",
    )
    conn.autocommit = True
    cur = conn.cursor()
    yield cur
    cur.close()
    conn.close()
