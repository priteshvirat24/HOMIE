"""HOMIE API — S3 / MinIO object storage helpers.

The phone never talks to MinIO directly: photos are uploaded through the API and
scene files are streamed back through the API. That way the only address the
phone needs is the API's (EXPO_PUBLIC_API_URL).
"""

from collections.abc import Iterator
from functools import lru_cache

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.core.config import get_settings

ASSET_ROUTE_PREFIX = "/api/v1/assets/"


@lru_cache
def s3_client():
    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
        config=Config(signature_version="s3v4", retries={"max_attempts": 3}),
    )


def ensure_buckets() -> None:
    """Create the image and scene buckets if they don't exist yet."""
    settings = get_settings()
    client = s3_client()
    for bucket in (settings.s3_bucket_images, settings.s3_bucket_scenes):
        try:
            client.head_bucket(Bucket=bucket)
        except ClientError:
            client.create_bucket(Bucket=bucket)


def put_image(key: str, data: bytes, content_type: str) -> None:
    s3_client().put_object(Bucket=get_settings().s3_bucket_images, Key=key, Body=data, ContentType=content_type)


class AssetNotFound(Exception):
    pass


def open_scene_asset(key: str) -> tuple[Iterator[bytes], str, int | None]:
    """Open an object in the scenes bucket for streaming. Returns (chunks, content_type, length)."""
    try:
        obj = s3_client().get_object(Bucket=get_settings().s3_bucket_scenes, Key=key)
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") in ("NoSuchKey", "404"):
            raise AssetNotFound(key) from e
        raise
    body = obj["Body"]
    return body.iter_chunks(chunk_size=1024 * 1024), obj.get("ContentType") or "application/octet-stream", obj.get(
        "ContentLength"
    )


def asset_url(key: str | None) -> str | None:
    """Relative URL the viewer uses to fetch a scene file through the API."""
    if not key:
        return None
    return f"{ASSET_ROUTE_PREFIX}{key}"


def check_storage() -> str:
    try:
        s3_client().head_bucket(Bucket=get_settings().s3_bucket_scenes)
        return "ok"
    except Exception as e:  # noqa: BLE001 — health check reports any failure
        return f"error: {type(e).__name__}"
