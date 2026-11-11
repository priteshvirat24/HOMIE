"""HOMIE Worker — Image Blaster engine (World Labs Marble).

Python port of image-blaster's world generation helper
(https://github.com/neilsonnn/image-blaster, `.claude/scripts/world/generate-world.mjs`,
MIT License, Copyright (c) 2026 Neilson Koerner-Safrata):

  POST {ENDPOINT}/worlds:generate    (header WLT-Api-Key)  -> long-running operation
  GET  {ENDPOINT}/operations/{id}    until `done`          -> operation.response is the World
  download assets.splats.spz_urls / assets.mesh.collider_mesh_url / assets.imagery.pano_url / thumbnail_url

HOMIE additions:
  * a room photographed from several angles is sent as a `multi-image` prompt
    (World Labs accepts up to 8 images with `reconstruct_images: true`);
  * photos are EXIF-rotated and normalised to identical JPEG dimensions first,
    because multi-image generation rejects mixed sizes;
  * the operation id is persisted on the job so a Celery retry resumes polling
    instead of paying for a second generation.
"""

import base64
import io
import logging
import os
import time
from pathlib import Path
from statistics import median
from typing import Any

import httpx
from PIL import Image, ImageOps

from engines.base import EngineError, JobContext, ReconstructionEngine, SceneFiles, TransientEngineError

try:  # iPhone photos may arrive as HEIC
    from pillow_heif import register_heif_opener

    register_heif_opener()
except ImportError:  # pragma: no cover
    pass

logger = logging.getLogger(__name__)

ENDPOINT = os.getenv("WORLD_LABS_ENDPOINT", "https://api.worldlabs.ai/marble/v1")
DEFAULT_MODEL = os.getenv("WORLD_LABS_MODEL", "marble-1.1")
PLACEHOLDER_KEYS = {"", "your_world_labs_key_here"}
MAX_IMAGES = 8
MAX_LONG_EDGE = 2560
POLL_INTERVAL_S = float(os.getenv("WORLD_LABS_POLL_INTERVAL", "10"))
GENERATION_TIMEOUT_S = float(os.getenv("WORLD_LABS_TIMEOUT", str(30 * 60)))

# Splat resolutions World Labs returns, best first. Phones get the 500k file; desktops the full one.
MOBILE_SPLAT_KEYS = ("500k", "150k", "100k", "full_res")
FULL_SPLAT_KEYS = ("full_res", "500k", "150k", "100k")


def _api_key() -> str:
    return os.getenv("WORLD_LABS_API_KEY", "").strip()


def _raise_for_status(resp: httpx.Response, action: str) -> None:
    if resp.is_success:
        return
    detail = resp.text[:500]
    if resp.status_code in (401, 403):
        raise EngineError(f"World Labs rejected the API key during {action} ({resp.status_code})", "auth")
    if resp.status_code == 402:
        raise EngineError(f"World Labs: not enough credits for {action} (402): {detail}", "billing")
    if resp.status_code == 429 or resp.status_code >= 500:
        raise TransientEngineError(f"World Labs {action} failed ({resp.status_code}): {detail}")
    raise EngineError(f"World Labs {action} failed ({resp.status_code}): {detail}", "provider_error")


def _select_images(images: list[Path]) -> list[Path]:
    """At most MAX_IMAGES photos, spread evenly over what the user took."""
    if len(images) <= MAX_IMAGES:
        return images
    step = (len(images) - 1) / (MAX_IMAGES - 1)
    return [images[round(i * step)] for i in range(MAX_IMAGES)]


def _load_rgb(path: Path) -> Image.Image:
    try:
        with Image.open(path) as im:
            im = ImageOps.exif_transpose(im)
            return im.convert("RGB")
    except Exception as e:
        raise EngineError(f"Could not read image {path.name}: {e}", "bad_input") from e


def _fit(im: Image.Image, size: tuple[int, int]) -> Image.Image:
    return ImageOps.fit(im, size, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))


def normalize_images(paths: list[Path]) -> list[bytes]:
    """EXIF-rotate, centre-crop to one shared aspect ratio and size, encode as JPEG."""
    images = [_load_rgb(p) for p in paths]
    if len(images) == 1:
        im = images[0]
        scale = min(1.0, MAX_LONG_EDGE / max(im.size))
        target = (max(1, round(im.width * scale)), max(1, round(im.height * scale)))
    else:
        aspect = median(im.width / im.height for im in images)
        short_edge = min(min(im.size) for im in images)
        long_edge = min(MAX_LONG_EDGE, round(short_edge * max(aspect, 1 / aspect)))
        target = (long_edge, round(long_edge / aspect)) if aspect >= 1 else (round(long_edge * aspect), long_edge)

    out = []
    for im in images:
        buf = io.BytesIO()
        _fit(im, target).save(buf, format="JPEG", quality=92, optimize=True)
        out.append(buf.getvalue())
    return out


def _content(jpeg: bytes) -> dict[str, Any]:
    return {"source": "data_base64", "data_base64": base64.b64encode(jpeg).decode("ascii"), "extension": "jpg"}


def build_request(jpegs: list[bytes], display_name: str, model: str, text_prompt: str | None) -> dict[str, Any]:
    if len(jpegs) == 1:
        world_prompt: dict[str, Any] = {"type": "image", "image_prompt": _content(jpegs[0])}
    else:
        world_prompt = {
            "type": "multi-image",
            # No azimuths: World Labs lays the views out itself ("auto layout").
            "multi_image_prompt": [{"content": _content(j)} for j in jpegs],
            "reconstruct_images": True,
        }
    if text_prompt:
        world_prompt["text_prompt"] = text_prompt
    return {"display_name": display_name[:64], "model": model, "world_prompt": world_prompt}


def _operation_id(op: dict[str, Any]) -> str:
    op_id = op.get("operation_id") or op.get("id") or op.get("name")
    if not op_id:
        raise EngineError("World Labs operation did not include operation_id", "provider_error")
    return str(op_id).split("/")[-1]


def _operation_progress(op: dict[str, Any]) -> float | None:
    meta = op.get("metadata") or {}
    for key in ("progress", "progress_percent", "percent"):
        value = meta.get(key) if isinstance(meta, dict) else None
        if isinstance(value, (int, float)):
            return value / 100 if value > 1 else float(value)
    return None


class ImageBlasterEngine(ReconstructionEngine):
    @property
    def engine_name(self) -> str:
        return "image_blaster"

    def validate_environment(self) -> None:
        if _api_key() in PLACEHOLDER_KEYS:
            raise EngineError("WORLD_LABS_API_KEY is not set in .env — cannot generate worlds", "config")

    def _client(self) -> httpx.Client:
        return httpx.Client(timeout=httpx.Timeout(60, connect=15), headers={"WLT-Api-Key": _api_key()})

    def reconstruct(self, images: list[Path], workspace: Path, config: dict, ctx: JobContext) -> SceneFiles:
        model = config.get("model") or DEFAULT_MODEL
        with self._client() as client:
            op_id = ctx.get_state("operation_id")
            if op_id:
                ctx.progress(0.2, "Resuming world generation…")
                logger.info("Resuming World Labs operation %s", op_id)
            else:
                selected = _select_images(images)
                ctx.progress(0.1, f"Preparing {len(selected)} photo{'s' if len(selected) > 1 else ''}…")
                jpegs = normalize_images(selected)
                request = build_request(jpegs, config.get("display_name") or "HOMIE room", model, config.get("prompt"))
                ctx.check_cancelled()
                ctx.progress(0.15, "Sending photos to World Labs…")
                try:
                    resp = client.post(f"{ENDPOINT}/worlds:generate", json=request)
                except httpx.RequestError as e:
                    raise TransientEngineError(f"Could not reach World Labs: {e}") from e
                _raise_for_status(resp, "world submission")
                operation = resp.json()
                op_id = _operation_id(operation)
                ctx.set_state("operation_id", op_id)
                ctx.set_state("model", model)
                ctx.set_state("input_images", len(selected))
                logger.info("Submitted World Labs operation %s (%d images)", op_id, len(selected))

            world = self._poll(client, op_id, ctx)
            ctx.set_state("world_id", world.get("world_id") or world.get("id"))
            ctx.progress(0.82, "Downloading 3D scene…")
            return self._download(client, world, workspace, ctx)

    def _poll(self, client: httpx.Client, op_id: str, ctx: JobContext) -> dict[str, Any]:
        started = time.monotonic()
        while True:
            ctx.check_cancelled()
            try:
                resp = client.get(f"{ENDPOINT}/operations/{op_id}")
            except httpx.RequestError as e:
                logger.warning("Poll failed (%s), will retry", e)
                resp = None
            if resp is not None:
                if resp.status_code == 404:
                    raise EngineError(f"World Labs operation {op_id} not found", "provider_error")
                if resp.is_success:
                    op = resp.json()
                    if op.get("error"):
                        err = op["error"]
                        message = err.get("message") if isinstance(err, dict) else str(err)
                        raise EngineError(f"World generation failed: {message or 'unknown error'}", "generation_failed")
                    if op.get("done"):
                        if not op.get("response"):
                            raise EngineError("World Labs finished without a world", "provider_error")
                        return op["response"]
                    reported = _operation_progress(op)
                elif resp.status_code in (401, 403):
                    _raise_for_status(resp, "status check")
                else:
                    reported = None
            else:
                reported = None

            elapsed = time.monotonic() - started
            if elapsed > GENERATION_TIMEOUT_S:
                raise EngineError(f"World generation took longer than {GENERATION_TIMEOUT_S / 60:.0f} minutes", "timeout")
            # World Labs takes ~5 minutes; without a reported value, ease towards 80%.
            estimate = reported if reported is not None else 1 - 0.5 ** (elapsed / 150)
            ctx.progress(0.2 + 0.6 * min(estimate, 0.99), f"Building your 3D room… ({int(elapsed // 60)}m {int(elapsed % 60)}s)")
            time.sleep(POLL_INTERVAL_S)

    def _fetch(self, client: httpx.Client, url: str, dest: Path) -> Path:
        try:
            with httpx.stream("GET", url, timeout=httpx.Timeout(300, connect=15), follow_redirects=True) as resp:
                if resp.status_code >= 500:
                    raise TransientEngineError(f"Download failed ({resp.status_code}) for {dest.name}")
                if not resp.is_success:
                    raise EngineError(f"Download failed ({resp.status_code}) for {dest.name}", "download_failed")
                with dest.open("wb") as fh:
                    for chunk in resp.iter_bytes(1024 * 1024):
                        fh.write(chunk)
        except httpx.RequestError as e:
            raise TransientEngineError(f"Download of {dest.name} failed: {e}") from e
        return dest

    def _download(self, client: httpx.Client, world: dict[str, Any], workspace: Path, ctx: JobContext) -> SceneFiles:
        assets = world.get("assets") or {}
        splats = assets.get("splats") or {}
        spz_urls = {k: v for k, v in (splats.get("spz_urls") or {}).items() if v}
        if not spz_urls:
            raise EngineError("World Labs returned no Gaussian splat", "provider_error")

        wanted: dict[str, str] = {}
        full_key = next((k for k in FULL_SPLAT_KEYS if k in spz_urls), next(iter(spz_urls)))
        mobile_key = next((k for k in MOBILE_SPLAT_KEYS if k in spz_urls), full_key)
        wanted["splat"] = spz_urls[full_key]
        if mobile_key != full_key:
            wanted["splat_mobile"] = spz_urls[mobile_key]
        if (assets.get("mesh") or {}).get("collider_mesh_url"):
            wanted["collider"] = assets["mesh"]["collider_mesh_url"]
        if (assets.get("imagery") or {}).get("pano_url"):
            wanted["panorama"] = assets["imagery"]["pano_url"]
        if assets.get("thumbnail_url"):
            wanted["thumbnail"] = assets["thumbnail_url"]

        names = {
            "splat": "world.spz",
            "splat_mobile": "world-mobile.spz",
            "collider": "world-collider.glb",
            "panorama": "world-pano" + (Path(httpx.URL(wanted.get("panorama", "x.png")).path).suffix or ".png"),
            "thumbnail": "thumbnail" + (Path(httpx.URL(wanted.get("thumbnail", "x.webp")).path).suffix or ".webp"),
        }

        files: dict[str, Path] = {}
        for i, (name, url) in enumerate(wanted.items()):
            ctx.check_cancelled()
            ctx.progress(0.82 + 0.08 * i / len(wanted), f"Downloading {name.replace('_', ' ')}…")
            try:
                files[name] = self._fetch(client, url, workspace / names[name])
            except EngineError:
                if name in ("splat",):
                    raise
                logger.warning("Optional asset %s could not be downloaded", name, exc_info=True)

        semantics = splats.get("semantics_metadata") or {}
        manifest = {
            "schemaVersion": 2,
            "engine": self.engine_name,
            "representation": "gaussian_splat",
            "worldId": world.get("world_id") or world.get("id"),
            "marbleUrl": world.get("world_marble_url"),
            "caption": assets.get("caption") or "",
            "coordinateSystem": "y_up",
            "units": "meters",
            "splatResolutions": {"full": full_key, "mobile": mobile_key},
            "viewerSettings": {
                "metricScaleFactor": semantics.get("metric_scale_factor", 1.0),
                "groundPlaneOffset": semantics.get("ground_plane_offset", 0.0),
                "flipY": semantics.get("flip_y", True),
            },
        }
        return SceneFiles(files=files, manifest=manifest)
