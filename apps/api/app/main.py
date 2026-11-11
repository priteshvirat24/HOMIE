"""HOMIE API — FastAPI application (no auth)."""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.api.capture import router as capture_router
from app.api.health import router as health_router
from app.api.properties import router as properties_router
from app.api.reconstruction import router as reconstruction_router
from app.api.rooms import router as rooms_router
from app.api.scenes import router as scenes_router
from app.core.config import get_settings
from app.core.storage import ensure_buckets

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("homie")
settings = get_settings()

# apps/viewer (the web app + 3D walkthrough) is built to apps/viewer/dist and served at /viewer/,
# so browsers and the phone's WebView load it from the same host as the API.
VIEWER_DIST = Path(__file__).resolve().parents[2] / "viewer" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        ensure_buckets()
    except Exception as e:  # storage down: the API still starts; /health reports it
        logger.warning("Could not create storage buckets: %s", e)
    if not VIEWER_DIST.exists():
        logger.warning("Viewer not built (%s missing) — run `npm run build:viewer` from the repo root", VIEWER_DIST)
    yield


app = FastAPI(
    title="HOMIE API",
    description="Home Digitization Platform — room capture and 3D reconstruction",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
for router in (properties_router, rooms_router, capture_router, reconstruction_router, scenes_router):
    app.include_router(router, prefix="/api/v1")

if VIEWER_DIST.exists():
    # gzip only the web app bundle (6 MB of JS → ~2 MB); scene files keep their Content-Length for progress bars.
    app.mount("/viewer", GZipMiddleware(StaticFiles(directory=VIEWER_DIST, html=True), minimum_size=1024), name="viewer")


@app.get("/viewer", include_in_schema=False)
async def viewer_root():
    return RedirectResponse("/viewer/")


@app.get("/", include_in_schema=False)
async def web_app():
    """The web app lives at /viewer/ (same bundle as the phone's 3D walkthrough)."""
    return RedirectResponse("/viewer/")
