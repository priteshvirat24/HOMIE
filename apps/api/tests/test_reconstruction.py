"""Reconstruction jobs: create/enqueue, status, retry, cancel. The queue is a recorder (no worker runs)."""

import uuid

import pytest

J = "/api/v1/reconstruction-jobs"


async def create_job(client, sid, **extra):
    return await client.post(J, json={"capture_session_id": sid, **extra})


async def room_status(client, rm):
    return (await client.get(f"/api/v1/properties/{rm['property_id']}/rooms/{rm['id']}")).json()["status"]


async def test_create_job_enqueues(client, queue, session_with_photos):
    _, sid = await session_with_photos(2)
    r = await create_job(client, sid)
    assert r.status_code == 201
    job = r.json()
    assert job["status"] == "queued"
    assert job["engine"] == "image_blaster"
    assert len(queue.enqueued) == 1
    job_id, keys, engine, config = queue.enqueued[0]
    assert job_id == job["id"]
    assert len(keys) == 2 and all(k.startswith(f"captures/{sid}/") for k in keys)
    assert (engine, config) == ("image_blaster", {})


async def test_create_job_sets_room_processing(client, session_with_photos):
    rm, sid = await session_with_photos(1)
    await create_job(client, sid)
    assert await room_status(client, rm) == "processing"


async def test_create_job_keeps_ready_room_ready(client, session_with_photos, sync_db):
    rm, sid = await session_with_photos(1)
    sync_db.execute("UPDATE rooms SET status='ready' WHERE id=%s", (rm["id"],))
    await create_job(client, sid)
    assert await room_status(client, rm) == "ready"


async def test_create_job_passes_config(client, queue, session_with_photos):
    _, sid = await session_with_photos(1)
    await create_job(client, sid, config={"prompt": "cosy"})
    assert queue.enqueued[0][3] == {"prompt": "cosy"}


async def test_create_job_uses_only_selected_frame(client, queue, session_with_photos):
    _, sid = await session_with_photos(3, finalize=False)
    frames = (await client.get(f"/api/v1/capture-sessions/{sid}/frames")).json()
    await client.post(f"/api/v1/capture-sessions/{sid}/finalize", params={"selected_frame_id": frames[1]["id"]})
    await create_job(client, sid)
    assert queue.enqueued[0][1] == [frames[1]["storage_key"]]


async def test_create_job_unknown_engine(client, session_with_photos):
    _, sid = await session_with_photos(1)
    assert (await create_job(client, sid, engine="nerf")).status_code == 400


async def test_create_job_missing_session(client):
    assert (await create_job(client, str(uuid.uuid4()))).status_code == 404


async def test_create_job_without_photos(client, room):
    rm = await room()
    s = (await client.post("/api/v1/capture-sessions", json={"room_id": rm["id"]})).json()
    assert (await create_job(client, s["id"])).status_code == 400


async def test_create_job_queue_down_returns_503_and_fails_job(client, queue, session_with_photos):
    queue.fail_enqueue = True
    rm, sid = await session_with_photos(1)
    r = await create_job(client, sid)
    assert r.status_code == 503
    jobs = (await client.get(J, params={"room_id": rm["id"]})).json()
    assert jobs[0]["status"] == "failed"
    assert jobs[0]["error_category"] == "queue_unavailable"


async def test_get_job(client, session_with_photos):
    _, sid = await session_with_photos(1)
    job = (await create_job(client, sid)).json()
    got = (await client.get(f"{J}/{job['id']}")).json()
    assert got["id"] == job["id"]
    assert got["progress"] == 0.0


async def test_get_missing_job(client):
    assert (await client.get(f"{J}/{uuid.uuid4()}")).status_code == 404


async def test_progress_endpoint(client, session_with_photos, sync_db):
    _, sid = await session_with_photos(1)
    job = (await create_job(client, sid)).json()
    sync_db.execute("UPDATE reconstruction_jobs SET progress=0.5, current_message='halfway', "
                    "status='generating_world' WHERE id=%s", (job["id"],))
    p = (await client.get(f"{J}/{job['id']}/progress")).json()
    assert (p["status"], p["progress"], p["message"], p["current_message"]) == (
        "generating_world", 0.5, "halfway", "halfway")


async def test_progress_missing_job(client):
    assert (await client.get(f"{J}/{uuid.uuid4()}/progress")).status_code == 404


async def test_list_jobs_for_room_newest_first(client, session_with_photos, room):
    rm = await room()
    _, s1 = await session_with_photos(1, room_obj=rm)
    first = (await create_job(client, s1)).json()
    _, s2 = await session_with_photos(1, room_obj=rm)
    second = (await create_job(client, s2)).json()
    listed = (await client.get(J, params={"room_id": rm["id"]})).json()
    assert [j["id"] for j in listed] == [second["id"], first["id"]]


async def test_list_jobs_limit(client, session_with_photos, room):
    rm = await room()
    for _ in range(3):
        _, sid = await session_with_photos(1, room_obj=rm)
        await create_job(client, sid)
    assert len((await client.get(J, params={"room_id": rm["id"], "limit": 1})).json()) == 1


async def test_list_jobs_requires_room(client):
    assert (await client.get(J)).status_code == 422


async def test_list_jobs_empty_room(client, room):
    assert (await client.get(J, params={"room_id": (await room())["id"]})).json() == []


async def test_artifacts_empty_before_completion(client, session_with_photos):
    _, sid = await session_with_photos(1)
    job = (await create_job(client, sid)).json()
    assert (await client.get(f"{J}/{job['id']}/artifacts")).json() == []


async def test_artifacts_listed(client, session_with_photos, sync_db):
    _, sid = await session_with_photos(1)
    job = (await create_job(client, sid)).json()
    sync_db.execute(
        "INSERT INTO reconstruction_artifacts (id, job_id, artifact_type, storage_key, created_at) "
        "VALUES (gen_random_uuid(), %s, 'gaussian_splat', 'scenes/x/world.spz', NOW())", (job["id"],))
    arts = (await client.get(f"{J}/{job['id']}/artifacts")).json()
    assert [(a["artifact_type"], a["storage_key"]) for a in arts] == [("gaussian_splat", "scenes/x/world.spz")]


# ---- cancel ----

async def test_cancel_queued_job(client, queue, session_with_photos):
    rm, sid = await session_with_photos(1)
    job = (await create_job(client, sid)).json()
    r = await client.post(f"{J}/{job['id']}/cancel")
    assert r.status_code == 200
    assert r.json()["status"] == "cancelled"
    assert queue.revoked == [job["id"]]
    assert await room_status(client, rm) == "captured"


@pytest.mark.parametrize("status", ["ready", "failed", "cancelled"])
async def test_cannot_cancel_finished_job(client, session_with_photos, sync_db, status):
    _, sid = await session_with_photos(1)
    job = (await create_job(client, sid)).json()
    sync_db.execute("UPDATE reconstruction_jobs SET status=%s WHERE id=%s", (status, job["id"]))
    assert (await client.post(f"{J}/{job['id']}/cancel")).status_code == 400


@pytest.mark.parametrize("status", ["queued", "downloading_images", "generating_world", "uploading_artifacts"])
async def test_can_cancel_running_states(client, session_with_photos, sync_db, status):
    _, sid = await session_with_photos(1)
    job = (await create_job(client, sid)).json()
    sync_db.execute("UPDATE reconstruction_jobs SET status=%s WHERE id=%s", (status, job["id"]))
    assert (await client.post(f"{J}/{job['id']}/cancel")).status_code == 200


async def test_cancel_missing_job(client):
    assert (await client.post(f"{J}/{uuid.uuid4()}/cancel")).status_code == 404


async def test_cancel_survives_revoke_failure(client, queue, session_with_photos, monkeypatch):
    import app.api.reconstruction as rec

    def boom(_):
        raise ConnectionError("redis down")

    monkeypatch.setattr(rec, "revoke", boom)
    _, sid = await session_with_photos(1)
    job = (await create_job(client, sid)).json()
    assert (await client.post(f"{J}/{job['id']}/cancel")).json()["status"] == "cancelled"


# ---- retry ----

@pytest.mark.parametrize("status", ["failed", "cancelled"])
async def test_retry_requeues_with_same_photos(client, queue, session_with_photos, sync_db, status):
    _, sid = await session_with_photos(2)
    job = (await create_job(client, sid)).json()
    sync_db.execute("UPDATE reconstruction_jobs SET status=%s, error_message='boom', progress=0.6, "
                    "result_summary='{\"operation_id\": \"op-1\"}' WHERE id=%s", (status, job["id"]))
    r = await client.post(f"{J}/{job['id']}/retry")
    assert r.status_code == 200
    body = r.json()
    assert (body["status"], body["retry_count"], body["error_message"], body["progress"]) == ("queued", 1, None, 0.0)
    assert len(queue.enqueued) == 2
    assert queue.enqueued[1][1] == queue.enqueued[0][1]  # same photo keys, not an empty list
    sync_db.execute("SELECT result_summary FROM reconstruction_jobs WHERE id=%s", (job["id"],))
    assert "operation_id" not in sync_db.fetchone()[0]  # a retry starts a fresh generation


@pytest.mark.parametrize("status", ["queued", "generating_world", "ready"])
async def test_cannot_retry_active_or_ready_job(client, session_with_photos, sync_db, status):
    _, sid = await session_with_photos(1)
    job = (await create_job(client, sid)).json()
    sync_db.execute("UPDATE reconstruction_jobs SET status=%s WHERE id=%s", (status, job["id"]))
    assert (await client.post(f"{J}/{job['id']}/retry")).status_code == 400


async def test_retry_sets_room_processing(client, session_with_photos, sync_db):
    rm, sid = await session_with_photos(1)
    job = (await create_job(client, sid)).json()
    sync_db.execute("UPDATE reconstruction_jobs SET status='failed' WHERE id=%s", (job["id"],))
    sync_db.execute("UPDATE rooms SET status='failed' WHERE id=%s", (rm["id"],))
    await client.post(f"{J}/{job['id']}/retry")
    assert await room_status(client, rm) == "processing"


async def test_retry_missing_job(client):
    assert (await client.post(f"{J}/{uuid.uuid4()}/retry")).status_code == 404


async def test_retry_when_photos_deleted(client, session_with_photos, sync_db):
    _, sid = await session_with_photos(1)
    job = (await create_job(client, sid)).json()
    sync_db.execute("UPDATE reconstruction_jobs SET status='failed' WHERE id=%s", (job["id"],))
    sync_db.execute("DELETE FROM capture_frames WHERE session_id=%s", (sid,))
    assert (await client.post(f"{J}/{job['id']}/retry")).status_code == 400
