"""Worker job bookkeeping against the real schema (needs docker-compose Postgres)."""

import json

import pytest

import db


def _row(cur, sql, *args):
    cur.execute(sql, args)
    return cur.fetchone()


@pytest.mark.parametrize(
    "env, expected",
    [
        ({"POSTGRES_USER": "u", "POSTGRES_PASSWORD": "p", "POSTGRES_HOST": "h", "POSTGRES_PORT": "1", "POSTGRES_DB": "d"},
         "postgresql://u:p@h:1/d"),
        ({"POSTGRES_USER": "u", "POSTGRES_PASSWORD": "", "POSTGRES_HOST": "h", "POSTGRES_PORT": "1", "POSTGRES_DB": "d"},
         "postgresql://u@h:1/d"),
    ],
)
def test_database_url_from_parts(monkeypatch, env, expected):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    assert db.database_url() == expected


def test_database_url_override(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://x@y/z")
    assert db.database_url() == "postgresql://x@y/z"


def test_get_job_missing(database):
    assert db.get_job("00000000-0000-0000-0000-00000000dead") is None


def test_get_job_returns_status_and_summary(seed):
    ids = seed(summary={"operation_id": "op-7"})
    job = db.get_job(ids["job"])
    assert job["status"] == "queued"
    assert job["result_summary"] == {"operation_id": "op-7"}


def test_update_progress_sets_values_and_started_at(seed, cur):
    ids = seed()
    db.update_progress(ids["job"], 0.4, "half", "generating_world")
    status, progress, msg, started = _row(
        cur, "SELECT status, progress, current_message, started_at FROM reconstruction_jobs WHERE id=%s", ids["job"])
    assert (status, progress, msg) == ("generating_world", 0.4, "half")
    assert started is not None


@pytest.mark.parametrize("final", ["cancelled", "ready", "failed"])
def test_update_progress_never_overwrites_final_states(seed, cur, final):
    ids = seed(job_status=final)
    db.update_progress(ids["job"], 0.5, "late", "generating_world")
    assert _row(cur, "SELECT status FROM reconstruction_jobs WHERE id=%s", ids["job"])[0] == final


def test_update_progress_truncates_long_messages(seed, cur):
    ids = seed()
    db.update_progress(ids["job"], 0.1, "x" * 900, "preprocessing")
    assert len(_row(cur, "SELECT current_message FROM reconstruction_jobs WHERE id=%s", ids["job"])[0]) == 500


def test_set_summary_value_merges(seed):
    ids = seed(summary={"input_count": 3})
    db.set_summary_value(ids["job"], "operation_id", "op-1")
    db.set_summary_value(ids["job"], "world_id", "w-1")
    assert db.get_job(ids["job"])["result_summary"] == {"input_count": 3, "operation_id": "op-1", "world_id": "w-1"}


def test_mark_failed_records_error_and_fails_room(seed, cur):
    ids = seed()
    db.mark_failed(ids["job"], "auth", "bad key")
    status, cat, msg, failed_at = _row(
        cur, "SELECT status, error_category, error_message, failed_at FROM reconstruction_jobs WHERE id=%s", ids["job"])
    assert (status, cat, msg) == ("failed", "auth", "bad key")
    assert failed_at is not None
    assert _row(cur, "SELECT status FROM rooms WHERE id=%s", ids["room"])[0] == "failed"


def test_mark_failed_keeps_ready_room_ready(seed, cur):
    ids = seed(room_status="ready")
    db.mark_failed(ids["job"], "timeout", "slow")
    assert _row(cur, "SELECT status FROM rooms WHERE id=%s", ids["room"])[0] == "ready"


def test_mark_failed_does_not_touch_cancelled_job(seed, cur):
    ids = seed(job_status="cancelled")
    db.mark_failed(ids["job"], "x", "y")
    assert _row(cur, "SELECT status FROM reconstruction_jobs WHERE id=%s", ids["job"])[0] == "cancelled"


UPLOADED = {
    "splat": {"key": "scenes/j/world.spz", "content_type": "application/octet-stream", "size": 10},
    "collider": {"key": "scenes/j/world-collider.glb", "content_type": "model/gltf-binary", "size": 5},
    "thumbnail": {"key": "scenes/j/thumbnail.webp", "content_type": "image/webp", "size": 3},
}
MANIFEST = {"schemaVersion": 2, "representation": "gaussian_splat", "worldId": "w1", "artifactKeys": {"splat": "k"}}


def test_complete_job_publishes_scene(seed, cur):
    ids = seed()
    assert db.complete_job(ids["job"], "image_blaster", UPLOADED, MANIFEST) is True
    status, progress, completed = _row(
        cur, "SELECT status, progress, completed_at FROM reconstruction_jobs WHERE id=%s", ids["job"])
    assert (status, progress) == ("ready", 1.0)
    assert completed is not None
    room_status, thumb = _row(cur, "SELECT status, thumbnail_key FROM rooms WHERE id=%s", ids["room"])
    assert room_status == "ready"
    assert thumb == "scenes/j/thumbnail.webp"


def test_complete_job_inserts_artifacts_with_enum_types(seed, cur):
    ids = seed()
    db.complete_job(ids["job"], "image_blaster", UPLOADED, MANIFEST)
    cur.execute("SELECT artifact_type::text, quality_level FROM reconstruction_artifacts WHERE job_id=%s ORDER BY 2",
                (ids["job"],))
    assert cur.fetchall() == [("collider_mesh", "collider"), ("gaussian_splat", "splat"), ("thumbnail", "thumbnail")]


def test_complete_job_stores_manifest(seed, cur):
    ids = seed()
    db.complete_job(ids["job"], "image_blaster", UPLOADED, MANIFEST)
    data, active = _row(cur, "SELECT manifest_data, is_active FROM scene_manifests WHERE job_id=%s", ids["job"])
    assert data == MANIFEST
    assert active is True


def test_complete_job_deactivates_previous_scene(seed, cur):
    ids = seed()
    db.complete_job(ids["job"], "image_blaster", UPLOADED, MANIFEST)
    # second job for the same room
    cur.execute(
        "INSERT INTO reconstruction_jobs (id, capture_session_id, engine, status, progress, retry_count, max_retries, "
        "created_at) VALUES (gen_random_uuid(), %s, 'image_blaster', 'queued', 0, 0, 3, NOW()) RETURNING id",
        (ids["session"],),
    )
    job2 = str(cur.fetchone()[0])
    cur.connection.commit()
    db.complete_job(job2, "image_blaster", UPLOADED, {**MANIFEST, "worldId": "w2"})
    cur.execute("SELECT job_id::text FROM scene_manifests WHERE room_id=%s AND is_active", (ids["room"],))
    assert [r[0] for r in cur.fetchall()] == [job2]


def test_complete_job_skips_cancelled(seed, cur):
    ids = seed(job_status="cancelled")
    assert db.complete_job(ids["job"], "image_blaster", UPLOADED, MANIFEST) is False
    assert _row(cur, "SELECT count(*) FROM scene_manifests WHERE job_id=%s", ids["job"])[0] == 0


def test_complete_job_merges_summary(seed):
    ids = seed(summary={"operation_id": "op-1"})
    db.complete_job(ids["job"], "image_blaster", UPLOADED, MANIFEST)
    summary = db.get_job(ids["job"])["result_summary"]
    assert summary["operation_id"] == "op-1"
    assert summary["world_id"] == "w1"
    assert summary["artifacts"] == sorted(UPLOADED)


def test_complete_job_keeps_thumbnail_when_none_uploaded(seed, cur):
    ids = seed()
    cur.execute("UPDATE rooms SET thumbnail_key='old.webp' WHERE id=%s", (ids["room"],))
    cur.connection.commit()
    db.complete_job(ids["job"], "image_blaster", {"splat": UPLOADED["splat"]}, MANIFEST)
    assert _row(cur, "SELECT thumbnail_key FROM rooms WHERE id=%s", ids["room"])[0] == "old.webp"


def test_artifact_type_mapping_covers_every_engine_output():
    assert set(db.ARTIFACT_TYPES) == {"splat", "splat_mobile", "collider", "panorama", "thumbnail"}
    assert json.dumps(db.ARTIFACT_TYPES)  # serialisable
