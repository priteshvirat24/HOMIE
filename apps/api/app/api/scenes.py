"""Scene manifest routes."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.scene import SceneManifest
from app.schemas import SceneManifestOut

router = APIRouter(prefix="/scenes", tags=["scenes"])


@router.get("/{room_id}/manifest", response_model=SceneManifestOut)
async def get_scene_manifest(room_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get the active scene manifest for a room."""
    result = await db.execute(
        select(SceneManifest)
        .where(SceneManifest.room_id == room_id, SceneManifest.is_active == True)  # noqa: E712
        .order_by(SceneManifest.created_at.desc())
    )
    manifest = result.scalar_one_or_none()
    if manifest is None:
        raise HTTPException(status_code=404, detail="No scene manifest found for this room")
    return manifest
