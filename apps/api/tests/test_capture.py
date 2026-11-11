"""Capture sessions and photo upload (photos go through the API into S3)."""

import hashlib
import uuid

import pytest

from app.core.config import get_settings
from app.core.storage import s3_client

from .conftest import jpeg_bytes

S = "/api/v1/capture-sessions"


async def new_session(client, room_id):
    r = await client.post(S, json={"room_id": room_id})
    assert r.status_code == 201, r.text
    return r.json()


async def upload(client, sid, data=None, name="p.jpg", ctype="image/jpeg"):
    return await client.post(f"{S}/{sid}/photos", files={"file": (name, data if data is not None else jpeg_bytes(), ctype)})


async def test_create_session(client, room):
    rm = await room()
    s = await new_session(client, rm["id"])
    assert s["room_id"] == rm["id"]
    assert s["status"] == "capturing"
    assert (s["frame_count"], s["accepted_count"]) == (0, 0)


async def test_create_session_marks_room_capturing(client, room):
    rm = await room()
    await new_session(client, rm["id"])
    got = (await client.get(f"/api/v1/properties/{rm['property_id']}/rooms/{rm['id']}")).json()
    assert got["status"] == "capturing"


async def test_create_session_missing_room(client):
    assert (await client.post(S, json={"room_id": str(uuid.uuid4())})).status_code == 404


async def test_get_session(client, room):
    s = await new_session(client, (await room())["id"])
    assert (await client.get(f"{S}/{s['id']}")).json()["id"] == s["id"]


async def test_get_missing_session(client):
    assert (await client.get(f"{S}/{uuid.uuid4()}")).status_code == 404


async def test_upload_photo_stores_object(client, room):
    s = await new_session(client, (await room())["id"])
    data = jpeg_bytes()
    r = await upload(client, s["id"], data)
    assert r.status_code == 201
    frame = r.json()
    assert frame["upload_status"] == "uploaded"
    assert frame["storage_key"] == f"captures/{s['id']}/{frame['id']}.jpg"
    obj = s3_client().get_object(Bucket=get_settings().s3_bucket_images, Key=frame["storage_key"])
    assert obj["Body"].read() == data


async def test_upload_records_checksum_and_size(client, room, sync_db):
    s = await new_session(client, (await room())["id"])
    data = jpeg_bytes((100, 80))
    frame = (await upload(client, s["id"], data)).json()
    sync_db.execute("SELECT checksum, file_size_bytes FROM capture_frames WHERE id=%s", (frame["id"],))
    assert sync_db.fetchone() == (hashlib.sha256(data).hexdigest(), len(data))


async def test_upload_increments_counts(client, room):
    s = await new_session(client, (await room())["id"])
    await upload(client, s["id"])
    await upload(client, s["id"])
    got = (await client.get(f"{S}/{s['id']}")).json()
    assert (got["frame_count"], got["accepted_count"]) == (2, 2)


@pytest.mark.parametrize("ctype, ext", [
    ("image/jpeg", "jpg"), ("image/png", "png"), ("image/webp", "webp"), ("image/heic", "heic"), ("image/heif", "heif"),
])
async def test_upload_accepted_types(client, room, ctype, ext):
    s = await new_session(client, (await room())["id"])
    r = await upload(client, s["id"], b"bytes", name=f"x.{ext}", ctype=ctype)
    assert r.status_code == 201
    assert r.json()["storage_key"].endswith(f".{ext}")


@pytest.mark.parametrize("name", ["photo.JPEG", "photo.jpeg", "IMG_1.PNG"])
async def test_upload_type_from_extension_when_content_type_generic(client, room, name):
    s = await new_session(client, (await room())["id"])
    assert (await upload(client, s["id"], b"x", name=name, ctype="application/octet-stream")).status_code == 201


@pytest.mark.parametrize("name, ctype", [("a.gif", "image/gif"), ("a.txt", "text/plain"), ("a.pdf", "application/pdf")])
async def test_upload_rejects_unsupported(client, room, name, ctype):
    s = await new_session(client, (await room())["id"])
    assert (await upload(client, s["id"], b"x", name=name, ctype=ctype)).status_code == 415


async def test_upload_rejects_empty(client, room):
    s = await new_session(client, (await room())["id"])
    assert (await upload(client, s["id"], b"")).status_code == 400


async def test_upload_rejects_too_large(client, room, monkeypatch):
    import app.api.capture as cap

    monkeypatch.setattr(cap, "MAX_PHOTO_BYTES", 100)
    s = await new_session(client, (await room())["id"])
    assert (await upload(client, s["id"], b"x" * 101)).status_code == 413


async def test_upload_limit_eight_photos(client, room):
    s = await new_session(client, (await room())["id"])
    for _ in range(8):
        assert (await upload(client, s["id"], b"x")).status_code == 201
    assert (await upload(client, s["id"], b"x")).status_code == 400


async def test_upload_missing_file_field(client, room):
    s = await new_session(client, (await room())["id"])
    assert (await client.post(f"{S}/{s['id']}/photos")).status_code == 422


async def test_upload_to_missing_session(client):
    assert (await upload(client, uuid.uuid4())).status_code == 404


async def test_upload_after_submit_is_rejected(client, session_with_photos):
    _, sid = await session_with_photos(1, finalize=True)
    assert (await upload(client, sid)).status_code == 409


async def test_list_frames_in_order(client, room):
    s = await new_session(client, (await room())["id"])
    a = (await upload(client, s["id"], name="a.jpg")).json()
    b = (await upload(client, s["id"], name="b.jpg")).json()
    assert [f["id"] for f in (await client.get(f"{S}/{s['id']}/frames")).json()] == [a["id"], b["id"]]


async def test_list_frames_missing_session(client):
    assert (await client.get(f"{S}/{uuid.uuid4()}/frames")).status_code == 404


async def test_delete_frame_updates_counts(client, room):
    s = await new_session(client, (await room())["id"])
    f = (await upload(client, s["id"])).json()
    await upload(client, s["id"])
    assert (await client.delete(f"{S}/{s['id']}/frames/{f['id']}")).status_code == 204
    got = (await client.get(f"{S}/{s['id']}")).json()
    assert (got["frame_count"], got["accepted_count"]) == (1, 1)


async def test_delete_frame_frees_a_slot(client, room):
    s = await new_session(client, (await room())["id"])
    frames = [(await upload(client, s["id"], b"x")).json() for _ in range(8)]
    await client.delete(f"{S}/{s['id']}/frames/{frames[0]['id']}")
    assert (await upload(client, s["id"], b"x")).status_code == 201


async def test_delete_missing_frame(client, room):
    s = await new_session(client, (await room())["id"])
    assert (await client.delete(f"{S}/{s['id']}/frames/{uuid.uuid4()}")).status_code == 404


async def test_finalize(client, session_with_photos):
    _, sid = await session_with_photos(2, finalize=False)
    r = await client.post(f"{S}/{sid}/finalize")
    assert r.status_code == 200
    assert r.json()["status"] == "submitted"
    assert (await client.get(f"{S}/{sid}")).json()["completed_at"] is not None


async def test_finalize_without_photos(client, room):
    s = await new_session(client, (await room())["id"])
    assert (await client.post(f"{S}/{s['id']}/finalize")).status_code == 400


async def test_finalize_with_selected_frame(client, room):
    s = await new_session(client, (await room())["id"])
    f = (await upload(client, s["id"])).json()
    await upload(client, s["id"])
    await client.post(f"{S}/{s['id']}/finalize", params={"selected_frame_id": f["id"]})
    assert (await client.get(f"{S}/{s['id']}")).json()["selected_frame_id"] == f["id"]


async def test_finalize_missing_session(client):
    assert (await client.post(f"{S}/{uuid.uuid4()}/finalize")).status_code == 404
