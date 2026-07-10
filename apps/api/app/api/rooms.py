"""Room management routes — no auth for now."""

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.property import Property
from app.models.room import Room, RoomType
from app.schemas import RoomCreate, RoomOut, RoomUpdate

router = APIRouter(prefix="/properties/{property_id}/rooms", tags=["rooms"])


async def _get_property_or_404(property_id: UUID, db: AsyncSession) -> Property:
    """Get property or raise 404."""
    result = await db.execute(
        select(Property).where(Property.id == property_id, Property.deleted_at.is_(None))
    )
    prop = result.scalar_one_or_none()
    if prop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")
    return prop


@router.post("", response_model=RoomOut, status_code=status.HTTP_201_CREATED)
async def create_room(property_id: UUID, data: RoomCreate, db: AsyncSession = Depends(get_db)):
    """Create a new room in a property."""
    await _get_property_or_404(property_id, db)

    try:
        room_type = RoomType(data.room_type)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid room type: {data.room_type}")

    room = Room(property_id=property_id, name=data.name, room_type=room_type, notes=data.notes)
    db.add(room)
    await db.flush()
    return room


@router.get("", response_model=list[RoomOut])
async def list_rooms(property_id: UUID, db: AsyncSession = Depends(get_db)):
    """List all rooms in a property."""
    await _get_property_or_404(property_id, db)

    result = await db.execute(
        select(Room)
        .where(Room.property_id == property_id, Room.deleted_at.is_(None))
        .order_by(Room.created_at.desc())
    )
    return result.scalars().all()


@router.get("/{room_id}", response_model=RoomOut)
async def get_room(property_id: UUID, room_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get a specific room."""
    await _get_property_or_404(property_id, db)

    result = await db.execute(
        select(Room).where(Room.id == room_id, Room.property_id == property_id, Room.deleted_at.is_(None))
    )
    room = result.scalar_one_or_none()
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
    return room


@router.patch("/{room_id}", response_model=RoomOut)
async def update_room(property_id: UUID, room_id: UUID, data: RoomUpdate, db: AsyncSession = Depends(get_db)):
    """Update a room."""
    await _get_property_or_404(property_id, db)

    result = await db.execute(
        select(Room).where(Room.id == room_id, Room.property_id == property_id, Room.deleted_at.is_(None))
    )
    room = result.scalar_one_or_none()
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    update_data = data.model_dump(exclude_unset=True)
    if "room_type" in update_data:
        try:
            update_data["room_type"] = RoomType(update_data["room_type"])
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid room type")

    for field, value in update_data.items():
        setattr(room, field, value)
    await db.flush()
    return room


@router.delete("/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_room(property_id: UUID, room_id: UUID, db: AsyncSession = Depends(get_db)):
    """Soft-delete a room."""
    await _get_property_or_404(property_id, db)

    result = await db.execute(
        select(Room).where(Room.id == room_id, Room.property_id == property_id, Room.deleted_at.is_(None))
    )
    room = result.scalar_one_or_none()
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    room.deleted_at = datetime.now(UTC)
    await db.flush()
