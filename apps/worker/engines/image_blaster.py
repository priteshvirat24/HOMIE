"""HOMIE Worker — Image Blaster reconstruction engine.

Uses World Labs Marble API to generate 3D environments from a single image.
Uses FAL.ai (Hunyuan 3D) for object mesh generation.
"""

import os
from pathlib import Path

import httpx

from engines.base import (
    MobileArtifacts,
    PreparedInputs,
    ProgressCallback,
    ReconstructionEngine,
    ReconstructionOutput,
    ValidationResult,
)

WORLD_LABS_ENDPOINT = "https://api.worldlabs.ai/marble/v1"
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".avif", ".heic", ".heif"}
MAX_IMAGE_SIZE_MB = 20


class ImageBlasterEngine(ReconstructionEngine):
    """Image Blaster engine using World Labs Marble + FAL.ai APIs.

    Pipeline:
    1. Validate API keys (World Labs, FAL)
    2. Validate input image (format, size)
    3. Prepare inputs (select best image, optionally analyze scene)
    4. Call World Labs Marble API to generate world (splat, collider, panorama)
    5. Optionally call FAL.ai for object mesh generation
    6. Download all artifacts
    7. Generate scene manifest
    """

    @property
    def engine_name(self) -> str:
        return "image_blaster"

    async def validate_environment(self) -> ValidationResult:
        """Check that World Labs and FAL API keys are configured."""
        errors = []
        warnings = []

        world_labs_key = os.getenv("WORLD_LABS_API_KEY", "")
        fal_key = os.getenv("FAL_KEY", "")

        if not world_labs_key or world_labs_key == "your_world_labs_key_here":
            errors.append("WORLD_LABS_API_KEY is not configured")

        if not fal_key or fal_key == "your_fal_key_here":
            warnings.append("FAL_KEY is not configured — object mesh generation will be skipped")

        # Test World Labs API connectivity
        if world_labs_key and world_labs_key != "your_world_labs_key_here":
            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    resp = await client.get(
                        f"{WORLD_LABS_ENDPOINT}/worlds",
                        headers={"Authorization": f"Bearer {world_labs_key}"},
                    )
                    if resp.status_code == 401:
                        errors.append("World Labs API key is invalid")
                    elif resp.status_code >= 500:
                        warnings.append("World Labs API may be experiencing issues")
            except httpx.RequestError as e:
                warnings.append(f"Could not reach World Labs API: {e}")

        return ValidationResult(is_valid=len(errors) == 0, errors=errors, warnings=warnings)

    async def validate_inputs(self, images: list[Path]) -> ValidationResult:
        """Validate that at least one image exists and is the right format."""
        errors = []
        warnings = []

        if not images:
            errors.append("No input images provided")
            return ValidationResult(is_valid=False, errors=errors)

        valid_images = []
        for img in images:
            if not img.exists():
                errors.append(f"Image not found: {img}")
                continue

            ext = img.suffix.lower()
            if ext not in SUPPORTED_EXTENSIONS:
                errors.append(f"Unsupported image format: {ext} (file: {img.name})")
                continue

            size_mb = img.stat().st_size / (1024 * 1024)
            if size_mb > MAX_IMAGE_SIZE_MB:
                errors.append(f"Image too large: {size_mb:.1f}MB > {MAX_IMAGE_SIZE_MB}MB (file: {img.name})")
                continue

            valid_images.append(img)

        if not valid_images:
            errors.append("No valid images found")

        if len(valid_images) > 1:
            warnings.append(f"Multiple images provided ({len(valid_images)}). The best image will be selected.")

        return ValidationResult(is_valid=len(errors) == 0, errors=errors, warnings=warnings)

    async def prepare_inputs(self, job_id: str, images: list[Path], config: dict) -> PreparedInputs:
        """Select the best image and prepare for reconstruction."""
        # For now, select the first/largest image
        best_image = max(images, key=lambda p: p.stat().st_size)

        return PreparedInputs(
            job_id=job_id,
            image_path=best_image,
            prompt=config.get("prompt"),
            config=config,
        )

    async def run_reconstruction(
        self, inputs: PreparedInputs, progress_callback: ProgressCallback
    ) -> ReconstructionOutput:
        """Call World Labs Marble API to generate 3D world."""
        world_labs_key = os.getenv("WORLD_LABS_API_KEY", "")

        if not world_labs_key or world_labs_key == "your_world_labs_key_here":
            return ReconstructionOutput(
                job_id=inputs.job_id,
                success=False,
                errors=["WORLD_LABS_API_KEY is not configured — cannot run reconstruction"],
            )

        await progress_callback(0.05, "Uploading image to World Labs...")

        try:
            async with httpx.AsyncClient(timeout=300) as client:
                # Step 1: Create world generation request
                with open(inputs.image_path, "rb") as f:
                    image_data = f.read()

                import base64
                image_b64 = base64.b64encode(image_data).decode("utf-8")
                content_type = "image/jpeg"
                if inputs.image_path.suffix.lower() == ".png":
                    content_type = "image/png"
                elif inputs.image_path.suffix.lower() == ".webp":
                    content_type = "image/webp"

                create_payload = {
                    "image": f"data:{content_type};base64,{image_b64}",
                    "model": "marble-1.1",
                }
                if inputs.prompt:
                    create_payload["prompt"] = inputs.prompt

                await progress_callback(0.1, "Submitting to World Labs Marble...")

                resp = await client.post(
                    f"{WORLD_LABS_ENDPOINT}/worlds",
                    json=create_payload,
                    headers={
                        "Authorization": f"Bearer {world_labs_key}",
                        "Content-Type": "application/json",
                    },
                )

                if resp.status_code not in (200, 201, 202):
                    return ReconstructionOutput(
                        job_id=inputs.job_id,
                        success=False,
                        errors=[f"World Labs API error: {resp.status_code} — {resp.text[:500]}"],
                    )

                world_data = resp.json()
                world_id = world_data.get("world_id") or world_data.get("id")

                if not world_id:
                    return ReconstructionOutput(
                        job_id=inputs.job_id,
                        success=False,
                        errors=["World Labs API did not return a world ID"],
                    )

                await progress_callback(0.2, "World generation in progress...")

                # Step 2: Poll for completion
                import asyncio
                max_polls = 120  # 10 minutes max
                poll_interval = 5

                for i in range(max_polls):
                    await asyncio.sleep(poll_interval)

                    status_resp = await client.get(
                        f"{WORLD_LABS_ENDPOINT}/worlds/{world_id}",
                        headers={"Authorization": f"Bearer {world_labs_key}"},
                    )

                    if status_resp.status_code != 200:
                        continue

                    status_data = status_resp.json()
                    world_status = status_data.get("status", "").lower()

                    # Update progress
                    progress = min(0.2 + (i / max_polls) * 0.6, 0.8)
                    await progress_callback(progress, f"Generating 3D world... ({world_status})")

                    if world_status in ("completed", "succeeded", "ready"):
                        await progress_callback(0.85, "World generation complete! Collecting artifacts...")

                        return ReconstructionOutput(
                            job_id=inputs.job_id,
                            success=True,
                            artifacts={"world": status_data},
                            metadata={
                                "world_id": world_id,
                                "engine": "image_blaster",
                                "model": "marble-1.1",
                            },
                        )

                    if world_status in ("failed", "error"):
                        return ReconstructionOutput(
                            job_id=inputs.job_id,
                            success=False,
                            errors=[f"World generation failed: {status_data.get('error', 'unknown')}"],
                        )

                return ReconstructionOutput(
                    job_id=inputs.job_id,
                    success=False,
                    errors=["World generation timed out after 10 minutes"],
                )

        except httpx.RequestError as e:
            return ReconstructionOutput(
                job_id=inputs.job_id,
                success=False,
                errors=[f"Network error communicating with World Labs: {e}"],
            )
        except Exception as e:
            return ReconstructionOutput(
                job_id=inputs.job_id,
                success=False,
                errors=[f"Unexpected error during reconstruction: {e}"],
            )

    async def postprocess_outputs(self, output: ReconstructionOutput, workspace: Path) -> MobileArtifacts:
        """Download and organize World Labs artifacts."""
        artifacts = MobileArtifacts()

        if not output.success or "world" not in output.artifacts:
            return artifacts

        world_data = output.artifacts["world"]
        assets = world_data.get("assets", {})

        async with httpx.AsyncClient(timeout=120) as client:
            # Download Gaussian splat (SPZ)
            spz_urls = assets.get("splats", {}).get("spz_urls", {})
            # Prefer 500k quality for mobile
            splat_url = spz_urls.get("500k") or spz_urls.get("full_res") or spz_urls.get("150k") or spz_urls.get("100k")

            if splat_url:
                splat_path = workspace / "world.spz"
                resp = await client.get(splat_url)
                if resp.status_code == 200:
                    splat_path.write_bytes(resp.content)
                    artifacts.splat_path = splat_path

            # Download collider mesh (GLB)
            collider_url = assets.get("mesh", {}).get("collider_mesh_url")
            if collider_url:
                mesh_path = workspace / "world-collider.glb"
                resp = await client.get(collider_url)
                if resp.status_code == 200:
                    mesh_path.write_bytes(resp.content)
                    artifacts.collider_mesh_path = mesh_path

            # Download panorama
            pano_url = assets.get("imagery", {}).get("pano_url")
            if pano_url:
                pano_path = workspace / "world-pano.png"
                resp = await client.get(pano_url)
                if resp.status_code == 200:
                    pano_path.write_bytes(resp.content)
                    artifacts.panorama_path = pano_path

            # Download thumbnail
            thumb_url = assets.get("thumbnail_url")
            if thumb_url:
                thumb_path = workspace / "thumbnail.webp"
                resp = await client.get(thumb_url)
                if resp.status_code == 200:
                    thumb_path.write_bytes(resp.content)
                    artifacts.thumbnail_path = thumb_path

        # Build scene manifest
        semantics = assets.get("splats", {}).get("semantics_metadata", {})
        artifacts.manifest = {
            "schemaVersion": 1,
            "sceneId": output.metadata.get("world_id", ""),
            "engine": "image_blaster",
            "representation": "gaussian_splat",
            "coordinateSystem": "y_up",
            "units": "meters",
            "artifacts": {
                "splat": str(artifacts.splat_path) if artifacts.splat_path else None,
                "colliderMesh": str(artifacts.collider_mesh_path) if artifacts.collider_mesh_path else None,
                "panorama": str(artifacts.panorama_path) if artifacts.panorama_path else None,
                "thumbnail": str(artifacts.thumbnail_path) if artifacts.thumbnail_path else None,
            },
            "viewerSettings": {
                "metricScaleFactor": semantics.get("metric_scale_factor", 1.0),
                "groundPlaneOffset": semantics.get("ground_plane_offset", 0.0),
                "flipY": semantics.get("flip_y", True),
            },
            "caption": assets.get("caption", ""),
        }

        return artifacts

    async def cleanup(self, job_id: str, workspace: Path) -> None:
        """Clean up temporary workspace files."""
        import shutil
        if workspace.exists():
            shutil.rmtree(workspace, ignore_errors=True)
