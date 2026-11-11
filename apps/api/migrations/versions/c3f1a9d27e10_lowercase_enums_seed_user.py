"""lowercase enum labels + seed default user

The initial schema stored enum *names* (e.g. 'READY') while the API and the
worker speak enum *values* (e.g. 'ready'). Models now use values_callable, so
the database labels are renamed to the lowercase values here.

Also seeds the single default user that owns properties while the app runs
without authentication.

Revision ID: c3f1a9d27e10
Revises: b54ead8826a1
Create Date: 2026-11-11 23:00:00
"""
from typing import Sequence, Union

from alembic import op

revision: str = "c3f1a9d27e10"
down_revision: Union[str, None] = "b54ead8826a1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ENUMS: dict[str, list[str]] = {
    "room_type_enum": [
        "LIVING_ROOM", "BEDROOM", "KITCHEN", "BATHROOM", "DINING_ROOM", "HALLWAY",
        "BALCONY", "OFFICE", "GARAGE", "LAUNDRY", "OTHER",
    ],
    "room_status_enum": [
        "CREATED", "CAPTURING", "CAPTURED", "UPLOADING", "UPLOADED", "PROCESSING", "READY", "FAILED",
    ],
    "capture_session_status_enum": [
        "CREATED", "PREPARING", "CAPTURING", "PAUSED", "REVIEWING", "READY_FOR_UPLOAD",
        "UPLOADING", "UPLOADED", "SUBMITTED",
    ],
    "job_status_enum": [
        "CREATED", "VALIDATING_INPUT", "QUEUED", "WAITING_FOR_WORKER", "DOWNLOADING_IMAGES",
        "PREPROCESSING", "ANALYZING_SCENE", "GENERATING_WORLD", "GENERATING_OBJECTS", "GENERATING_SFX",
        "POSTPROCESSING", "OPTIMIZING", "GENERATING_PREVIEW", "UPLOADING_ARTIFACTS", "READY", "FAILED",
        "CANCELLED",
    ],
    "artifact_type_enum": [
        "GAUSSIAN_SPLAT", "COLLIDER_MESH", "OBJECT_MESH", "PANORAMA", "THUMBNAIL", "AMBIENT_SFX",
        "OBJECT_SFX", "SCENE_DESCRIPTION", "SCENE_MANIFEST",
    ],
}

DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001"


def _rename(enum_name: str, src: str, dst: str) -> None:
    # Idempotent: only rename when the source label still exists.
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                WHERE t.typname = '{enum_name}' AND e.enumlabel = '{src}'
            ) THEN
                ALTER TYPE {enum_name} RENAME VALUE '{src}' TO '{dst}';
            END IF;
        END $$;
        """
    )


def upgrade() -> None:
    for enum_name, labels in ENUMS.items():
        for label in labels:
            _rename(enum_name, label, label.lower())

    op.execute(
        f"""
        INSERT INTO users (id, email, password_hash, display_name, is_active, created_at, updated_at)
        VALUES ('{DEFAULT_USER_ID}', 'local@homie.dev', '!', 'Local user', true, NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(f"DELETE FROM users WHERE id = '{DEFAULT_USER_ID}' AND NOT EXISTS "
               f"(SELECT 1 FROM properties WHERE user_id = '{DEFAULT_USER_ID}')")
    for enum_name, labels in ENUMS.items():
        for label in labels:
            _rename(enum_name, label.lower(), label)
