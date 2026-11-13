"""Live job progress over Server-Sent Events (GET /reconstruction-jobs/{id}/events)."""

import asyncio
import json
import uuid

import pytest

import app.api.reconstruction as rec

J = "/api/v1/reconstruction-jobs"


@pytest.fixture(autouse=True)
def fast_stream(monkeypatch):
    monkeypatch.setattr(rec, "EVENT_POLL_S", 0.02)
    monkeypatch.setattr(rec, "EVENT_HEARTBEAT_S", 0.05)
    monkeypatch.setattr(rec, "EVENT_MAX_S", 5)


def parse(body: str) -> list[tuple[str, object]]:
    """Return (event, data) pairs; comments come back as ("comment", text)."""
    out = []
    for block in body.split("\n\n"):
        if not block.strip():
            continue
        event, data = "message", None
        for line in block.split("\n"):
            if line.startswith(":"):
                out.append(("comment", line[1:].strip()))
            elif line.startswith("event: "):
                event = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
            elif line.startswith("retry: "):
                out.append(("retry", int(line[7:])))
        if data is not None:
            out.append((event, data))
    return out


async def new_job(client, session_with_photos):
    _, sid = await session_with_photos(1)
    return (await client.post(J, json={"capture_session_id": sid})).json()


def jobs(events):
    return [d for e, d in events if e == "job"]


async def test_missing_job_is_404(client):
    assert (await client.get(f"{J}/{uuid.uuid4()}/events")).status_code == 404


@pytest.mark.parametrize("final", ["ready", "failed", "cancelled"])
async def test_finished_job_sends_one_event_and_closes(client, session_with_photos, sync_db, final):
    job = await new_job(client, session_with_photos)
    sync_db.execute("UPDATE reconstruction_jobs SET status=%s WHERE id=%s", (final, job["id"]))
    r = await client.get(f"{J}/{job['id']}/events")
    assert r.status_code == 200
    sent = jobs(parse(r.text))
    assert [j["status"] for j in sent] == [final]
    assert sent[0]["id"] == job["id"]


async def test_headers_are_for_streaming(client, session_with_photos, sync_db):
    job = await new_job(client, session_with_photos)
    sync_db.execute("UPDATE reconstruction_jobs SET status='ready' WHERE id=%s", (job["id"],))
    r = await client.get(f"{J}/{job['id']}/events")
    assert r.headers["content-type"].startswith("text/event-stream")
    assert r.headers["cache-control"] == "no-cache"
    assert r.headers["x-accel-buffering"] == "no"
    assert "content-encoding" not in r.headers


async def test_stream_starts_with_retry_hint(client, session_with_photos, sync_db):
    job = await new_job(client, session_with_photos)
    sync_db.execute("UPDATE reconstruction_jobs SET status='ready' WHERE id=%s", (job["id"],))
    events = parse((await client.get(f"{J}/{job['id']}/events")).text)
    assert events[0] == ("retry", 3000)


async def test_event_matches_job_schema(client, session_with_photos, sync_db):
    job = await new_job(client, session_with_photos)
    sync_db.execute("UPDATE reconstruction_jobs SET status='failed', error_message='no credits', "
                    "error_category='billing' WHERE id=%s", (job["id"],))
    sent = jobs(parse((await client.get(f"{J}/{job['id']}/events")).text))[0]
    rest = (await client.get(f"{J}/{job['id']}")).json()
    assert sent == rest


async def test_streams_each_change_until_done(client, session_with_photos, sync_db):
    job = await new_job(client, session_with_photos)
    steps = [("preprocessing", 0.1, "Preparing photos"), ("generating_world", 0.5, "Building the 3D world"),
             ("ready", 1.0, "Done")]

    async def worker():
        for st, p, msg in steps:
            await asyncio.sleep(0.15)
            sync_db.execute("UPDATE reconstruction_jobs SET status=%s, progress=%s, current_message=%s WHERE id=%s",
                            (st, p, msg, job["id"]))

    task = asyncio.create_task(worker())
    r = await client.get(f"{J}/{job['id']}/events")
    await task
    sent = jobs(parse(r.text))
    assert [j["status"] for j in sent] == ["queued", "preprocessing", "generating_world", "ready"]
    assert [j["progress"] for j in sent] == [0.0, 0.1, 0.5, 1.0]
    assert sent[2]["current_message"] == "Building the 3D world"


async def test_unchanged_job_is_not_resent_but_kept_alive(client, session_with_photos, sync_db):
    job = await new_job(client, session_with_photos)

    async def finish_later():
        await asyncio.sleep(0.3)
        sync_db.execute("UPDATE reconstruction_jobs SET status='ready' WHERE id=%s", (job["id"],))

    task = asyncio.create_task(finish_later())
    events = parse((await client.get(f"{J}/{job['id']}/events")).text)
    await task
    assert [j["status"] for j in jobs(events)] == ["queued", "ready"]
    assert ("comment", "keep-alive") in events


async def test_stream_stops_after_max_duration(client, session_with_photos, monkeypatch):
    monkeypatch.setattr(rec, "EVENT_MAX_S", 0.1)
    job = await new_job(client, session_with_photos)
    sent = jobs(parse((await client.get(f"{J}/{job['id']}/events")).text))
    assert [j["status"] for j in sent] == ["queued"]


async def test_deleted_job_sends_gone(client, session_with_photos, sync_db):
    job = await new_job(client, session_with_photos)

    async def delete_later():
        await asyncio.sleep(0.1)
        sync_db.execute("DELETE FROM reconstruction_jobs WHERE id=%s", (job["id"],))

    task = asyncio.create_task(delete_later())
    events = parse((await client.get(f"{J}/{job['id']}/events")).text)
    await task
    assert events[-1] == ("gone", {})
