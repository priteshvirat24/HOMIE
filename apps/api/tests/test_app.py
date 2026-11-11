"""App wiring: health, web app routes, settings, schema, queue client."""

import pytest

from app.core.config import Settings
from app.core.database import pg_enum
from app.models.reconstruction import JobStatus


async def test_health_all_ok(client):
    body = (await client.get("/health")).json()
    assert body == {"status": "ok", "version": "0.2.0", "database": "ok", "redis": "ok", "storage": "ok"}


async def test_health_degraded_when_redis_down(client, monkeypatch):
    import app.api.health as health
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "redis_url", "redis://127.0.0.1:1/0")
    body = (await client.get("/health")).json()
    assert body["status"] == "degraded"
    assert body["redis"].startswith("error")
    assert health  # module imported


async def test_root_redirects_to_web_app(client):
    r = await client.get("/", follow_redirects=False)
    assert r.status_code == 307
    assert r.headers["location"] == "/viewer/"


async def test_viewer_without_slash_redirects(client):
    r = await client.get("/viewer", follow_redirects=False)
    assert r.status_code in (307, 308)


async def test_web_app_is_served_when_built(client, app):
    from app.main import VIEWER_DIST

    if not VIEWER_DIST.exists():
        pytest.skip("viewer not built")
    r = await client.get("/viewer/")
    assert r.status_code == 200
    assert "<div id=\"root\">" in r.text


async def test_openapi_lists_core_routes(client):
    paths = (await client.get("/openapi.json")).json()["paths"]
    for p in [
        "/api/v1/properties",
        "/api/v1/properties/{property_id}/rooms",
        "/api/v1/capture-sessions/{session_id}/photos",
        "/api/v1/reconstruction-jobs",
        "/api/v1/properties/{property_id}/tour",
        "/api/v1/assets/{key}",
    ]:
        assert p in paths, p


async def test_no_auth_routes_left(client):
    paths = (await client.get("/openapi.json")).json()["paths"]
    assert not any(p.startswith("/api/v1/auth") for p in paths)


@pytest.mark.parametrize(
    "password, expected",
    [("secret", "postgresql+psycopg2://u:secret@h:1/d"), ("", "postgresql+psycopg2://u@h:1/d")],
)
def test_sync_database_url(password, expected):
    s = Settings(_env_file=None, postgres_user="u", postgres_password=password, postgres_host="h", postgres_port=1,
                 postgres_db="d")
    assert s.database_url_sync == expected
    assert s.database_url.startswith("postgresql+asyncpg://")


@pytest.mark.parametrize("raw, expected", [
    ("a,b", ["a", "b"]), (" a , b ,", ["a", "b"]), ("", []), ("http://x:1", ["http://x:1"]),
])
def test_cors_origins_parsing(raw, expected):
    assert Settings(_env_file=None, api_cors_origins=raw).cors_origins == expected


def test_pg_enum_stores_lowercase_values():
    assert pg_enum(JobStatus, "job_status_enum").enums == [s.value for s in JobStatus]


def test_db_enum_labels_are_lowercase(sync_db):
    sync_db.execute("SELECT DISTINCT enumlabel FROM pg_enum")
    labels = [r[0] for r in sync_db.fetchall()]
    assert labels and all(lbl == lbl.lower() for lbl in labels)


def test_default_user_seeded(sync_db):
    sync_db.execute("SELECT email FROM users WHERE id='00000000-0000-0000-0000-000000000001'")
    assert sync_db.fetchone() == ("local@homie.dev",)


def test_queue_uses_job_id_as_task_id(monkeypatch):
    import app.core.queue as q

    sent = {}

    class FakeCelery:
        def send_task(self, name, args, task_id):
            sent.update(name=name, args=args, task_id=task_id)

    monkeypatch.setattr(q, "celery_client", lambda: FakeCelery())
    q.enqueue_reconstruction("job-1", ["k"], "image_blaster", {"a": 1})
    assert sent == {"name": "reconstruction.run", "args": ["job-1", ["k"], "image_blaster", {"a": 1}], "task_id": "job-1"}


async def test_web_app_bundle_is_gzipped(client):
    from app.main import VIEWER_DIST

    if not VIEWER_DIST.exists():
        pytest.skip("viewer not built")
    js = next((VIEWER_DIST / "assets").glob("*.js")).name
    r = await client.get(f"/viewer/assets/{js}", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert r.headers.get("content-encoding") == "gzip"


async def test_scene_assets_are_not_gzipped(client):
    import uuid

    from app.core.config import get_settings
    from app.core.storage import s3_client

    key = f"scenes/{uuid.uuid4()}/world.spz"
    s3_client().put_object(Bucket=get_settings().s3_bucket_scenes, Key=key, Body=b"x" * 5000)
    r = await client.get(f"/api/v1/assets/{key}", headers={"Accept-Encoding": "gzip"})
    assert "content-encoding" not in r.headers
    assert r.headers["content-length"] == "5000"
