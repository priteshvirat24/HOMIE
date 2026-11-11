"""Rooms of a house."""

import uuid

import pytest

from app.models.room import RoomType


def rooms_url(pid):
    return f"/api/v1/properties/{pid}/rooms"


@pytest.mark.parametrize("room_type", [t.value for t in RoomType])
async def test_create_room_every_type(client, house, room_type):
    h = await house()
    r = await client.post(rooms_url(h["id"]), json={"name": "R", "room_type": room_type})
    assert r.status_code == 201
    assert r.json()["room_type"] == room_type
    assert r.json()["status"] == "created"


async def test_create_room_defaults_to_other(client, house):
    h = await house()
    r = await client.post(rooms_url(h["id"]), json={"name": "R"})
    assert r.json()["room_type"] == "other"


async def test_create_room_invalid_type(client, house):
    h = await house()
    r = await client.post(rooms_url(h["id"]), json={"name": "R", "room_type": "dungeon"})
    assert r.status_code == 400


@pytest.mark.parametrize("payload", [{}, {"name": ""}, {"name": "x" * 201}])
async def test_create_room_validation(client, house, payload):
    h = await house()
    assert (await client.post(rooms_url(h["id"]), json=payload)).status_code == 422


async def test_create_room_in_missing_house(client):
    assert (await client.post(rooms_url(uuid.uuid4()), json={"name": "R"})).status_code == 404


async def test_create_room_in_deleted_house(client, house):
    h = await house()
    await client.delete(f"/api/v1/properties/{h['id']}")
    assert (await client.post(rooms_url(h["id"]), json={"name": "R"})).status_code == 404


async def test_list_rooms_only_for_that_house(client, house, room):
    a, b = await house(), await house()
    ra = await room(a["id"], "In A")
    await room(b["id"], "In B")
    listed = (await client.get(rooms_url(a["id"]))).json()
    assert [r["id"] for r in listed] == [ra["id"]]


async def test_list_rooms_missing_house(client):
    assert (await client.get(rooms_url(uuid.uuid4()))).status_code == 404


async def test_get_room(client, room):
    rm = await room(name="Kitchen", room_type="kitchen")
    r = await client.get(f"{rooms_url(rm['property_id'])}/{rm['id']}")
    assert r.status_code == 200
    assert r.json()["name"] == "Kitchen"


async def test_get_room_wrong_house(client, house, room):
    rm = await room()
    other = await house()
    assert (await client.get(f"{rooms_url(other['id'])}/{rm['id']}")).status_code == 404


async def test_update_room_name_and_type(client, room):
    rm = await room()
    r = await client.patch(f"{rooms_url(rm['property_id'])}/{rm['id']}", json={"name": "Den", "room_type": "office"})
    assert r.status_code == 200
    assert (r.json()["name"], r.json()["room_type"]) == ("Den", "office")


async def test_update_room_invalid_type(client, room):
    rm = await room()
    r = await client.patch(f"{rooms_url(rm['property_id'])}/{rm['id']}", json={"room_type": "castle"})
    assert r.status_code == 400


async def test_update_missing_room(client, house):
    h = await house()
    assert (await client.patch(f"{rooms_url(h['id'])}/{uuid.uuid4()}", json={"name": "x"})).status_code == 404


async def test_delete_room(client, room):
    rm = await room()
    url = f"{rooms_url(rm['property_id'])}/{rm['id']}"
    assert (await client.delete(url)).status_code == 204
    assert (await client.get(url)).status_code == 404
    assert (await client.get(rooms_url(rm["property_id"]))).json() == []


async def test_deleted_room_not_counted(client, house, room):
    h = await house()
    rm = await room(h["id"])
    await room(h["id"])
    await client.delete(f"{rooms_url(h['id'])}/{rm['id']}")
    assert (await client.get(f"/api/v1/properties/{h['id']}")).json()["room_count"] == 1
