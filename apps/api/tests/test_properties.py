"""Houses (properties)."""

import uuid

import pytest

BASE = "/api/v1/properties"


async def test_create_property(client):
    r = await client.post(BASE, json={"name": "Lake cottage", "address": "1 Shore Rd"})
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "Lake cottage"
    assert body["address"] == "1 Shore Rd"
    assert body["room_count"] == 0
    uuid.UUID(body["id"])


async def test_create_property_without_address(client):
    r = await client.post(BASE, json={"name": "Flat"})
    assert r.status_code == 201
    assert r.json()["address"] is None


@pytest.mark.parametrize("payload", [{}, {"name": ""}, {"name": "x" * 201}, {"name": None}, {"address": "only"}])
async def test_create_property_validation(client, payload):
    assert (await client.post(BASE, json=payload)).status_code == 422


async def test_list_includes_created(client, house):
    h = await house("Listed house")
    ids = [p["id"] for p in (await client.get(BASE)).json()]
    assert h["id"] in ids


async def test_list_newest_first(client, house):
    a = await house("first")
    b = await house("second")
    ids = [p["id"] for p in (await client.get(BASE)).json()]
    assert ids.index(b["id"]) < ids.index(a["id"])


async def test_list_counts_rooms(client, house, room):
    h = await house()
    await room(h["id"], "A")
    await room(h["id"], "B")
    listed = next(p for p in (await client.get(BASE)).json() if p["id"] == h["id"])
    assert listed["room_count"] == 2


async def test_get_property(client, house):
    h = await house("Get me")
    r = await client.get(f"{BASE}/{h['id']}")
    assert r.status_code == 200
    assert r.json()["name"] == "Get me"


async def test_get_property_counts_rooms(client, house, room):
    h = await house()
    await room(h["id"])
    assert (await client.get(f"{BASE}/{h['id']}")).json()["room_count"] == 1


async def test_get_missing_property(client):
    assert (await client.get(f"{BASE}/{uuid.uuid4()}")).status_code == 404


async def test_get_invalid_uuid(client):
    assert (await client.get(f"{BASE}/not-a-uuid")).status_code == 422


async def test_update_property(client, house):
    h = await house()
    r = await client.patch(f"{BASE}/{h['id']}", json={"name": "Renamed", "notes": "n"})
    assert r.status_code == 200
    assert r.json()["name"] == "Renamed"
    assert r.json()["notes"] == "n"


async def test_update_only_given_fields(client, house):
    h = await house("Keep", address="Addr")
    await client.patch(f"{BASE}/{h['id']}", json={"notes": "x"})
    got = (await client.get(f"{BASE}/{h['id']}")).json()
    assert (got["name"], got["address"]) == ("Keep", "Addr")


async def test_update_missing_property(client):
    assert (await client.patch(f"{BASE}/{uuid.uuid4()}", json={"name": "x"})).status_code == 404


async def test_delete_property_soft_deletes(client, house):
    h = await house()
    assert (await client.delete(f"{BASE}/{h['id']}")).status_code == 204
    assert (await client.get(f"{BASE}/{h['id']}")).status_code == 404
    assert h["id"] not in [p["id"] for p in (await client.get(BASE)).json()]


async def test_delete_twice_is_404(client, house):
    h = await house()
    await client.delete(f"{BASE}/{h['id']}")
    assert (await client.delete(f"{BASE}/{h['id']}")).status_code == 404
