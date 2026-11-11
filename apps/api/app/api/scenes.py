"""Scene manifest, house tour and scene-file routes."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.core.database import get_db
from app.core.storage import AssetNotFound, asset_url, open_scene_asset
from app.models.property import Property
from app.models.room import Room
from app.models.scene import SceneManifest
from app.schemas import PropertyTour, SceneManifestOut, TourRoom

router = APIRouter(tags=["scenes"])


def resolve_manifest(manifest: dict[str, Any]) -> dict[str, Any]:
    """Turn the storage keys the worker saved into URLs the viewer can fetch."""
    resolved = dict(manifest)
    keys = manifest.get("artifactKeys") or {}
    resolved["urls"] = {name: asset_url(key) for name, key in keys.items()}
    return resolved


async def _active_manifest(room_id: UUID, db: AsyncSession) -> SceneManifest | None:
    result = await db.execute(
        select(SceneManifest)
        .where(SceneManifest.room_id == room_id, SceneManifest.is_active == True)  # noqa: E712
        .order_by(SceneManifest.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


@router.get("/scenes/{room_id}/manifest", response_model=SceneManifestOut)
async def get_scene_manifest(room_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get the active (latest) scene manifest for a room."""
    manifest = await _active_manifest(room_id, db)
    if manifest is None:
        raise HTTPException(status_code=404, detail="No 3D scene for this room yet")
    out = SceneManifestOut.model_validate(manifest)
    out.manifest_data = resolve_manifest(manifest.manifest_data)
    return out


@router.get("/properties/{property_id}/tour", response_model=PropertyTour)
async def get_property_tour(property_id: UUID, db: AsyncSession = Depends(get_db)):
    """Every room of a house with its 3D scene (if ready), for the whole-house walkthrough."""
    prop = await db.get(Property, property_id)
    if prop is None or prop.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Property not found")

    rooms = (
        await db.execute(
            select(Room)
            .where(Room.property_id == property_id, Room.deleted_at.is_(None))
            .order_by(Room.created_at.asc())
        )
    ).scalars().all()

    manifests: dict[UUID, SceneManifest] = {}
    if rooms:
        rows = (
            await db.execute(
                select(SceneManifest)
                .where(SceneManifest.room_id.in_([r.id for r in rooms]), SceneManifest.is_active == True)  # noqa: E712
                .order_by(SceneManifest.created_at.asc())
            )
        ).scalars().all()
        for m in rows:  # ascending, so the newest active manifest wins
            manifests[m.room_id] = m

    return PropertyTour(
        property_id=prop.id,
        name=prop.name,
        rooms=[
            TourRoom(
                room_id=r.id,
                name=r.name,
                room_type=r.room_type,
                status=r.status,
                scene=resolve_manifest(manifests[r.id].manifest_data) if r.id in manifests else None,
            )
            for r in rooms
        ],
    )


@router.get("/assets/{key:path}")
async def get_scene_asset(key: str):
    """Stream a generated scene file (splat, collider mesh, panorama, thumbnail) from storage."""
    if not key.startswith("scenes/") or ".." in key:
        raise HTTPException(status_code=404, detail="Not found")
    try:
        chunks, content_type, length = await run_in_threadpool(open_scene_asset, key)
    except AssetNotFound:
        raise HTTPException(status_code=404, detail="Not found") from None

    headers = {"Cache-Control": "public, max-age=31536000, immutable"}
    if length is not None:
        headers["Content-Length"] = str(length)
    return StreamingResponse(chunks, media_type=content_type, headers=headers)
