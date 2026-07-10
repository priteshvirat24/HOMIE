"""Property management routes — no auth for now."""

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.property import Property
from app.models.room import Room
from app.schemas import PropertyCreate, PropertyOut, PropertyUpdate

router = APIRouter(prefix="/properties", tags=["properties"])

# Default user ID for now (no auth)
DEFAULT_USER_ID = UUID("00000000-0000-0000-0000-000000000001")


@router.post("", response_model=PropertyOut, status_code=status.HTTP_201_CREATED)
async def create_property(data: PropertyCreate, db: AsyncSession = Depends(get_db)):
    """Create a new property."""
    prop = Property(user_id=DEFAULT_USER_ID, name=data.name, address=data.address, notes=data.notes)
    db.add(prop)
    await db.flush()
    return PropertyOut(
        id=prop.id, name=prop.name, address=prop.address, notes=prop.notes,
        room_count=0, created_at=prop.created_at, updated_at=prop.updated_at,
    )


@router.get("", response_model=list[PropertyOut])
async def list_properties(db: AsyncSession = Depends(get_db)):
    """List all properties."""
    room_count_sq = (
        select(Room.property_id, func.count(Room.id).label("room_count"))
        .where(Room.deleted_at.is_(None))
        .group_by(Room.property_id)
        .subquery()
    )

    result = await db.execute(
        select(Property, func.coalesce(room_count_sq.c.room_count, 0).label("room_count"))
        .outerjoin(room_count_sq, Property.id == room_count_sq.c.property_id)
        .where(Property.deleted_at.is_(None))
        .order_by(Property.created_at.desc())
    )

    return [
        PropertyOut(
            id=row.Property.id, name=row.Property.name, address=row.Property.address,
            notes=row.Property.notes, room_count=row.room_count,
            created_at=row.Property.created_at, updated_at=row.Property.updated_at,
        )
        for row in result.all()
    ]


@router.get("/{property_id}", response_model=PropertyOut)
async def get_property(property_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get a specific property."""
    result = await db.execute(
        select(Property).where(Property.id == property_id, Property.deleted_at.is_(None))
    )
    prop = result.scalar_one_or_none()
    if prop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    room_result = await db.execute(
        select(func.count(Room.id)).where(Room.property_id == prop.id, Room.deleted_at.is_(None))
    )
    room_count = room_result.scalar() or 0

    return PropertyOut(
        id=prop.id, name=prop.name, address=prop.address, notes=prop.notes,
        room_count=room_count, created_at=prop.created_at, updated_at=prop.updated_at,
    )


@router.patch("/{property_id}", response_model=PropertyOut)
async def update_property(property_id: UUID, data: PropertyUpdate, db: AsyncSession = Depends(get_db)):
    """Update a property."""
    result = await db.execute(
        select(Property).where(Property.id == property_id, Property.deleted_at.is_(None))
    )
    prop = result.scalar_one_or_none()
    if prop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(prop, field, value)
    await db.flush()

    return PropertyOut(
        id=prop.id, name=prop.name, address=prop.address, notes=prop.notes,
        room_count=0, created_at=prop.created_at, updated_at=prop.updated_at,
    )


@router.delete("/{property_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_property(property_id: UUID, db: AsyncSession = Depends(get_db)):
    """Soft-delete a property."""
    result = await db.execute(
        select(Property).where(Property.id == property_id, Property.deleted_at.is_(None))
    )
    prop = result.scalar_one_or_none()
    if prop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    prop.deleted_at = datetime.now(UTC)
    await db.flush()
