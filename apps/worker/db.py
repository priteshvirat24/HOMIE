"""HOMIE Worker — job bookkeeping in Postgres.

Uses the same POSTGRES_* settings from .env as the API. Status strings are the
lowercase enum values defined in apps/api/app/models (see migration c3f1a9d27e10).
"""

import json
import os
from contextlib import contextmanager
from typing import Any

import psycopg2
from psycopg2.extras import Json


def database_url() -> str:
    if os.getenv("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    user = os.getenv("POSTGRES_USER", "homie")
    password = os.getenv("POSTGRES_PASSWORD", "")
    auth = f"{user}:{password}" if password else user
    host = os.getenv("POSTGRES_HOST", "localhost")
    port = os.getenv("POSTGRES_PORT", "5432")
    db = os.getenv("POSTGRES_DB", "homie")
    return f"postgresql://{auth}@{host}:{port}/{db}"


@contextmanager
def connect():
    conn = psycopg2.connect(database_url(), connect_timeout=10)
    try:
        with conn:  # commits on success, rolls back on error
            with conn.cursor() as cur:
                yield cur
    finally:
        conn.close()


def get_job(job_id: str) -> dict[str, Any] | None:
    with connect() as cur:
        cur.execute("SELECT status, result_summary, capture_session_id FROM reconstruction_jobs WHERE id = %s", (job_id,))
        row = cur.fetchone()
    if row is None:
        return None
    summary = row[1] if isinstance(row[1], dict) else (json.loads(row[1]) if row[1] else {})
    return {"status": row[0], "result_summary": summary or {}, "capture_session_id": row[2]}


def update_progress(job_id: str, progress: float, message: str, status: str) -> None:
    """Update progress unless the job was cancelled or already finished."""
    with connect() as cur:
        cur.execute(
            """
            UPDATE reconstruction_jobs
               SET progress = %s, current_message = %s, status = %s,
                   started_at = COALESCE(started_at, NOW())
             WHERE id = %s AND status NOT IN ('cancelled', 'ready', 'failed')
            """,
            (progress, message[:500], status, job_id),
        )


def set_summary_value(job_id: str, key: str, value: Any) -> None:
    with connect() as cur:
        cur.execute(
            """
            UPDATE reconstruction_jobs
               SET result_summary = (COALESCE(result_summary::jsonb, '{}'::jsonb) || %s::jsonb)::json
             WHERE id = %s
            """,
            (json.dumps({key: value}), job_id),
        )


def mark_failed(job_id: str, category: str, message: str) -> None:
    with connect() as cur:
        cur.execute(
            """
            UPDATE reconstruction_jobs
               SET status = 'failed', error_category = %s, error_message = %s, failed_at = NOW(),
                   current_message = 'Failed'
             WHERE id = %s AND status <> 'cancelled'
            """,
            (category[:100], message, job_id),
        )
        # The room goes back to "failed" only if it has no earlier working scene.
        cur.execute(
            """
            UPDATE rooms SET status = 'failed', updated_at = NOW()
             WHERE id = (SELECT cs.room_id FROM capture_sessions cs
                           JOIN reconstruction_jobs j ON j.capture_session_id = cs.id WHERE j.id = %s)
               AND status <> 'ready'
            """,
            (job_id,),
        )


ARTIFACT_TYPES = {
    "splat": "gaussian_splat",
    "splat_mobile": "gaussian_splat",
    "collider": "collider_mesh",
    "panorama": "panorama",
    "thumbnail": "thumbnail",
}


def complete_job(job_id: str, engine: str, uploaded: dict[str, dict[str, Any]], manifest: dict[str, Any]) -> bool:
    """Record artifacts, publish the room's new scene, mark the job ready. Returns False if it was cancelled."""
    with connect() as cur:
        cur.execute("SELECT status FROM reconstruction_jobs WHERE id = %s FOR UPDATE", (job_id,))
        row = cur.fetchone()
        if row is None or row[0] == "cancelled":
            return False

        for name, info in uploaded.items():
            cur.execute(
                """
                INSERT INTO reconstruction_artifacts
                    (id, job_id, artifact_type, storage_key, content_type, file_size_bytes, quality_level, created_at)
                VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, NOW())
                """,
                (job_id, ARTIFACT_TYPES[name], info["key"], info["content_type"], info["size"], name),
            )

        cur.execute(
            """
            SELECT cs.room_id FROM reconstruction_jobs j
              JOIN capture_sessions cs ON cs.id = j.capture_session_id
             WHERE j.id = %s
            """,
            (job_id,),
        )
        room_id = cur.fetchone()[0]

        cur.execute("UPDATE scene_manifests SET is_active = false WHERE room_id = %s AND is_active", (room_id,))
        cur.execute(
            """
            INSERT INTO scene_manifests
                (id, room_id, job_id, schema_version, engine, representation, manifest_data, is_active, created_at)
            VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, true, NOW())
            """,
            (room_id, job_id, manifest.get("schemaVersion", 2), engine, manifest.get("representation", "gaussian_splat"),
             Json(manifest)),
        )
        thumb = uploaded.get("thumbnail", {}).get("key")
        cur.execute(
            "UPDATE rooms SET status = 'ready', thumbnail_key = COALESCE(%s, thumbnail_key), updated_at = NOW() "
            "WHERE id = %s",
            (thumb, room_id),
        )
        cur.execute(
            """
            UPDATE reconstruction_jobs
               SET status = 'ready', progress = 1.0, current_message = 'Your 3D room is ready',
                   completed_at = NOW(),
                   result_summary = (COALESCE(result_summary::jsonb, '{}'::jsonb) || %s::jsonb)::json
             WHERE id = %s
            """,
            (json.dumps({"world_id": manifest.get("worldId"), "artifacts": sorted(uploaded)}), job_id),
        )
    return True
