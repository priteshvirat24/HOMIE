"""Scene manifests, the whole-house tour, and scene file streaming."""

import json
import uuid

import pytest

from app.api.scenes import resolve_manifest
from app.core.config import get_settings
from app.core.storage import asset_url, s3_client


def publish_scene(sync_db, room_id, keys=None, active=True, world="w1"):
    """Insert a manifest the way the worker does."""
    manifest = {
        "schemaVersion": 2, "engine": "image_blaster", "representation": "gaussian_splat", "worldId": world,
        "viewerSettings": {"flipY": True, "groundPlaneOffset": -0.5, "metricScaleFactor": 1.2},
        "artifactKeys": keys or {"splat": f"scenes/{world}/world.spz", "collider": f"scenes/{world}/c.glb"},
    }
    sync_db.execute(
        "INSERT INTO scene_manifests (id, room_id, schema_version, engine, representation, manifest_data, is_active, "
        "created_at) VALUES (gen_random_uuid(), %s, 2, 'image_blaster', 'gaussian_splat', %s, %s, clock_timestamp())",
        (room_id, json.dumps(manifest), active),
    )
    sync_db.execute("UPDATE rooms SET status='ready' WHERE id=%s", (room_id,))
    return manifest


# ---- resolve_manifest (unit) ----

def test_resolve_manifest_maps_keys_to_urls():
    out = resolve_manifest({"artifactKeys": {"splat": "scenes/j/world.spz"}})
    assert out["urls"] == {"splat": "/api/v1/assets/scenes/j/world.spz"}


def test_resolve_manifest_without_keys():
    assert resolve_manifest({"engine": "x"})["urls"] == {}


def test_resolve_manifest_does_not_mutate_input():
    m = {"artifactKeys": {"splat": "k"}}
    resolve_manifest(m)
    assert "urls" not in m


@pytest.mark.parametrize("key, url", [(None, None), ("", None), ("scenes/a.spz", "/api/v1/assets/scenes/a.spz")])
def test_asset_url(key, url):
    assert asset_url(key) == url


# ---- manifest endpoint ----

async def test_manifest_404_when_no_scene(client, room):
    assert (await client.get(f"/api/v1/scenes/{(await room())['id']}/manifest")).status_code == 404


async def test_manifest_returns_resolved_urls(client, room, sync_db):
    rm = await room()
    publish_scene(sync_db, rm["id"])
    r = await client.get(f"/api/v1/scenes/{rm['id']}/manifest")
    assert r.status_code == 200
    data = r.json()["manifest_data"]
    assert data["urls"]["splat"] == "/api/v1/assets/scenes/w1/world.spz"
    assert data["viewerSettings"]["groundPlaneOffset"] == -0.5


async def test_manifest_returns_latest_active(client, room, sync_db):
    rm = await room()
    publish_scene(sync_db, rm["id"], world="old")
    publish_scene(sync_db, rm["id"], world="new")
    assert (await client.get(f"/api/v1/scenes/{rm['id']}/manifest")).json()["manifest_data"]["worldId"] == "new"


async def test_manifest_ignores_inactive(client, room, sync_db):
    rm = await room()
    publish_scene(sync_db, rm["id"], active=False)
    assert (await client.get(f"/api/v1/scenes/{rm['id']}/manifest")).status_code == 404


# ---- tour ----

async def test_tour_lists_rooms_in_creation_order(client, house, room, sync_db):
    h = await house("Tour house")
    a = await room(h["id"], "Hall", "hallway")
    b = await room(h["id"], "Kitchen", "kitchen")
    publish_scene(sync_db, b["id"])
    tour = (await client.get(f"/api/v1/properties/{h['id']}/tour")).json()
    assert tour["name"] == "Tour house"
    assert [r["room_id"] for r in tour["rooms"]] == [a["id"], b["id"]]
    assert tour["rooms"][0]["scene"] is None
    assert tour["rooms"][1]["scene"]["urls"]["splat"].startswith("/api/v1/assets/")
    assert tour["rooms"][1]["status"] == "ready"


async def test_tour_uses_newest_scene_per_room(client, house, room, sync_db):
    h = await house()
    rm = await room(h["id"])
    publish_scene(sync_db, rm["id"], world="v1")
    publish_scene(sync_db, rm["id"], world="v2")
    tour = (await client.get(f"/api/v1/properties/{h['id']}/tour")).json()
    assert tour["rooms"][0]["scene"]["worldId"] == "v2"


async def test_tour_empty_house(client, house):
    h = await house()
    assert (await client.get(f"/api/v1/properties/{h['id']}/tour")).json()["rooms"] == []


async def test_tour_excludes_deleted_rooms(client, house, room):
    h = await house()
    rm = await room(h["id"])
    await client.delete(f"/api/v1/properties/{h['id']}/rooms/{rm['id']}")
    assert (await client.get(f"/api/v1/properties/{h['id']}/tour")).json()["rooms"] == []


async def test_tour_missing_house(client):
    assert (await client.get(f"/api/v1/properties/{uuid.uuid4()}/tour")).status_code == 404


async def test_tour_deleted_house(client, house):
    h = await house()
    await client.delete(f"/api/v1/properties/{h['id']}")
    assert (await client.get(f"/api/v1/properties/{h['id']}/tour")).status_code == 404


# ---- asset streaming ----

@pytest.fixture
def scene_object():
    def _put(key, body=b"SPZDATA", ctype="application/octet-stream"):
        s3_client().put_object(Bucket=get_settings().s3_bucket_scenes, Key=key, Body=body, ContentType=ctype)
        return key

    return _put


async def test_asset_streams_bytes(client, scene_object):
    key = scene_object(f"scenes/{uuid.uuid4()}/world.spz", b"x" * 3000)
    r = await client.get(f"/api/v1/assets/{key}")
    assert r.status_code == 200
    assert r.content == b"x" * 3000
    assert r.headers["content-length"] == "3000"


async def test_asset_content_type_and_cache(client, scene_object):
    key = scene_object(f"scenes/{uuid.uuid4()}/c.glb", b"glTF", "model/gltf-binary")
    r = await client.get(f"/api/v1/assets/{key}")
    assert r.headers["content-type"] == "model/gltf-binary"
    assert "immutable" in r.headers["cache-control"]


async def test_asset_missing(client):
    assert (await client.get(f"/api/v1/assets/scenes/{uuid.uuid4()}/nope.spz")).status_code == 404


@pytest.mark.parametrize("path", ["captures/x/photo.jpg", "other/file", "scenes/../captures/x.jpg", "scenes/a/../../b"])
async def test_asset_only_serves_scene_files(client, path):
    assert (await client.get(f"/api/v1/assets/{path}")).status_code == 404
