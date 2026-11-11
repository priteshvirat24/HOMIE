"""The Celery task end to end: Postgres + S3 (docker-compose) + fake World Labs. Runs the task eagerly."""

import io
import uuid

import pytest
from celery.exceptions import Retry
from PIL import Image

import db
from tasks.reconstruction import run_reconstruction


@pytest.fixture
def photos(s3):
    """Upload n photos to the images bucket and return their keys."""
    import os

    def _upload(n=1):
        keys = []
        for i in range(n):
            buf = io.BytesIO()
            Image.new("RGB", (640, 480), (40 * i % 255, 90, 160)).save(buf, "JPEG")
            key = f"captures/{uuid.uuid4()}/{i}.jpg"
            s3.put_object(Bucket=os.environ["S3_BUCKET_IMAGES"], Key=key, Body=buf.getvalue())
            keys.append(key)
        return keys

    return _upload


@pytest.fixture(autouse=True)
def workspace(tmp_path, monkeypatch):
    import tasks.reconstruction as t

    monkeypatch.setattr(t, "WORKSPACE_ROOT", tmp_path / "ws")
    return tmp_path / "ws"


def run(job_id, keys, engine="image_blaster", config=None):
    return run_reconstruction.apply(args=[job_id, keys, engine, config or {}], throw=True).get()


def test_success_publishes_scene_and_uploads_files(seed, photos, fake_wl, s3, cur):
    import os

    ids = seed()
    result = run(ids["job"], photos(1))
    assert result["success"] is True
    assert db.get_job(ids["job"])["status"] == "ready"
    listed = s3.list_objects_v2(Bucket=os.environ["S3_BUCKET_SCENES"], Prefix=f"scenes/{ids['job']}/")
    names = sorted(o["Key"].rsplit("/", 1)[-1] for o in listed.get("Contents", []))
    assert names == ["thumbnail.webp", "world-collider.glb", "world-mobile.spz", "world-pano.png", "world.spz"]


def test_success_manifest_has_artifact_keys(seed, photos, fake_wl, cur):
    ids = seed()
    run(ids["job"], photos(2))
    cur.execute("SELECT manifest_data FROM scene_manifests WHERE job_id=%s", (ids["job"],))
    keys = cur.fetchone()[0]["artifactKeys"]
    assert keys["splat"] == f"scenes/{ids['job']}/world.spz"
    assert set(keys) == {"splat", "splat_mobile", "collider", "panorama", "thumbnail"}


def test_success_cleans_workspace(seed, photos, fake_wl, workspace):
    ids = seed()
    run(ids["job"], photos(1))
    assert not (workspace / ids["job"]).exists()


def test_multi_photo_job_sends_multi_image(seed, photos, fake_wl):
    ids = seed()
    run(ids["job"], photos(3))
    assert fake_wl.state.requests[0]["world_prompt"]["type"] == "multi-image"


def test_missing_job_is_dropped(database, fake_wl):
    result = run(str(uuid.uuid4()), ["captures/x/1.jpg"])
    assert result == {"job_id": result["job_id"], "success": False, "error": "job not found"}
    assert fake_wl.state.requests == []


@pytest.mark.parametrize("status, success", [("cancelled", False), ("ready", True)])
def test_finished_jobs_are_not_rerun(seed, photos, fake_wl, status, success):
    ids = seed(job_status=status)
    assert run(ids["job"], photos(1))["success"] is success
    assert fake_wl.state.requests == []


def test_missing_api_key_fails_without_calling_world_labs(seed, photos, fake_wl, monkeypatch):
    monkeypatch.setenv("WORLD_LABS_API_KEY", "")
    ids = seed()
    result = run(ids["job"], photos(1))
    assert result["success"] is False
    job = db.get_job(ids["job"])
    assert job["status"] == "failed"
    assert fake_wl.state.requests == []


def test_unknown_engine_fails(seed, photos, fake_wl, cur):
    ids = seed()
    run(ids["job"], photos(1), engine="nerfstudio")
    cur.execute("SELECT status, error_category FROM reconstruction_jobs WHERE id=%s", (ids["job"],))
    assert cur.fetchone() == ("failed", "bad_request")


def test_generation_failure_marks_job_and_room_failed(seed, photos, fake_wl, cur):
    fake_wl.state.fail_generation = "unsupported image"
    ids = seed()
    run(ids["job"], photos(1))
    cur.execute("SELECT status, error_category FROM reconstruction_jobs WHERE id=%s", (ids["job"],))
    assert cur.fetchone() == ("failed", "generation_failed")
    cur.execute("SELECT status FROM rooms WHERE id=%s", (ids["room"],))
    assert cur.fetchone()[0] == "failed"


def test_missing_photo_in_storage_is_retried(seed, fake_wl):
    ids = seed()
    with pytest.raises(Retry):
        run(ids["job"], ["captures/does-not-exist/1.jpg"])


def test_transient_world_labs_error_is_retried(seed, photos, fake_wl):
    fake_wl.state.submit_status = 503
    ids = seed()
    with pytest.raises(Retry):
        run(ids["job"], photos(1))
    assert db.get_job(ids["job"])["status"] == "queued"


def test_resume_uses_saved_operation(seed, photos, fake_wl):
    first = seed()
    run(first["job"], photos(1))  # creates op-1 on the fake
    second = seed(summary={"operation_id": "op-1"})
    run(second["job"], photos(1))
    assert len(fake_wl.state.requests) == 1
    assert db.get_job(second["job"])["status"] == "ready"


def test_operation_id_persisted_on_job(seed, photos, fake_wl):
    ids = seed()
    run(ids["job"], photos(1))
    summary = db.get_job(ids["job"])["result_summary"]
    assert summary["operation_id"] == "op-1"
    assert summary["world_id"] == "world-op-1"
