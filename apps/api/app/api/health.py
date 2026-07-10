"""Health check route."""

from fastapi import APIRouter

from app.schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    # TODO: Add actual database and Redis connectivity checks
    return HealthResponse(
        status="ok",
        version="0.1.0",
        database="unchecked",
        redis="unchecked",
        storage="unchecked",
    )
