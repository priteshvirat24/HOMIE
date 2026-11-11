"""Health check route — reports whether the database, Redis and storage are reachable."""

import redis.asyncio as aioredis
from fastapi import APIRouter
from sqlalchemy import text
from starlette.concurrency import run_in_threadpool

from app.core.config import get_settings
from app.core.database import async_session_factory
from app.core.storage import check_storage
from app.schemas import HealthResponse

router = APIRouter(tags=["health"])


async def _check_db() -> str:
    try:
        async with async_session_factory() as session:
            await session.execute(text("SELECT 1"))
        return "ok"
    except Exception as e:  # noqa: BLE001
        return f"error: {type(e).__name__}"


async def _check_redis() -> str:
    client = aioredis.from_url(get_settings().redis_url, socket_connect_timeout=2)
    try:
        await client.ping()
        return "ok"
    except Exception as e:  # noqa: BLE001
        return f"error: {type(e).__name__}"
    finally:
        await client.aclose()


@router.get("/health", response_model=HealthResponse)
async def health_check():
    database = await _check_db()
    redis_status = await _check_redis()
    storage = await run_in_threadpool(check_storage)
    ok = all(s == "ok" for s in (database, redis_status, storage))
    return HealthResponse(
        status="ok" if ok else "degraded",
        version="0.2.0",
        database=database,
        redis=redis_status,
        storage=storage,
    )
