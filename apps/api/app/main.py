"""HOMIE API — FastAPI Application (no auth)."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.capture import router as capture_router
from app.api.health import router as health_router
from app.api.properties import router as properties_router
from app.api.reconstruction import router as reconstruction_router
from app.api.rooms import router as rooms_router
from app.api.scenes import router as scenes_router
from app.core.config import get_settings

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🏠 HOMIE API starting...")
    yield
    print("🏠 HOMIE API stopping...")


app = FastAPI(
    title="HOMIE API",
    description="Home Digitization Platform — Room capture and 3D reconstruction",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# All routes — no auth
app.include_router(health_router)
app.include_router(properties_router, prefix="/api/v1")
app.include_router(rooms_router, prefix="/api/v1")
app.include_router(capture_router, prefix="/api/v1")
app.include_router(reconstruction_router, prefix="/api/v1")
app.include_router(scenes_router, prefix="/api/v1")
