# Image Blaster Repository Analysis

> **Document Version:** 1.0  
> **Date:** 2026-07-11  
> **Status:** COMPLETE — Phase 0 Deliverable  
> **Repository:** https://github.com/neilsonnn/image-blaster  
> **License:** MIT  

---

## 1. What the Repository Actually Does

Image Blaster is **NOT** a traditional photogrammetry, SfM, or multi-view reconstruction pipeline. It is fundamentally different from what the prompt's architecture assumed.

### Actual Architecture

Image Blaster is a **Claude Code skillset** (a set of `.claude/skills/` and `.claude/scripts/`) that orchestrates **third-party cloud AI APIs** to generate 3D environments from a **single input image**. It is NOT a self-contained reconstruction engine.

### Pipeline Summary

```
Single Input Image
    ↓
[Claude AI Agent - image-blast-uncover]
    → Analyzes image, identifies objects, writes scene description JSON
    ↓
[Claude AI Agent - image-blast-world]
    → Calls World Labs Marble API (cloud) with image + prompt
    → Receives: Gaussian Splat (.spz), Collider Mesh (.glb), Panorama, Thumbnail
    ↓
[Claude AI Agent - image-blast-3d]
    → For each detected object, calls image editing API to isolate object
    → Calls Hunyuan 3D (via FAL.ai cloud) to generate 3D mesh (.glb, .obj)
    ↓
[Claude AI Agent - image-blast-sfx]
    → Calls ElevenLabs SFX API to generate ambient + object sounds
    ↓
[React/Three.js Viewer App]
    → Renders Gaussian Splat (SparkJS), GLB models (Three.js), Physics (Rapier)
    → First-person character controller with collision
```

### Key Distinction

| What was assumed | What Image Blaster actually does |
|---|---|
| Multi-view photogrammetry | Single-image AI generation |
| Local GPU reconstruction | Cloud API calls (World Labs, FAL, ElevenLabs) |
| Camera pose estimation | No camera poses needed |
| Dense point cloud / mesh from photos | AI-hallucinated 3D environment from 1 image |
| Self-contained processing | Requires Claude Code as orchestration agent |
| Python-based pipeline | Node.js/Bun scripts orchestrated by Claude |

---

## 2. Required Input

- **A single image** placed in the `input/` directory
- Supported formats: `.avif`, `.gif`, `.heic`, `.heif`, `.jpeg`, `.jpg`, `.png`, `.webp`
- The image is analyzed by Claude's vision capabilities to extract scene descriptions

---

## 3. Expected Number of Images

**ONE (1) image per world/environment.**

This is not multi-view reconstruction. The entire 3D environment is AI-generated (hallucinated) from a single photograph using World Labs' Marble model.

---

## 4. Whether Image Ordering Matters

**No.** Only one image is used. If multiple images exist in `source/`, the highest-indexed image is used.

---

## 5. Whether EXIF Metadata is Required

**No.** No EXIF data is read or used anywhere in the pipeline.

---

## 6. Whether Camera Intrinsics are Required

**No.** The pipeline does not use camera intrinsics.

---

## 7. Whether Camera Poses are Required

**No.** There is no concept of camera poses in this system.

---

## 8. Whether the Repository Estimates Camera Poses Itself

**No.** This is not a multi-view reconstruction system. It does not perform Structure from Motion (SfM), SLAM, or any form of camera pose estimation.

---

## 9. Required Image Overlap

**Not applicable.** Single-image input. No concept of overlap.

---

## 10. Recommended Capture Strategy

For our HOMIE application, the "capture strategy" must be reconceived:

**Option A (Using Image Blaster as-is):** Take a single representative photograph of each room. The AI will generate/hallucinate the 3D environment from this one photo.

**Option B (Future multi-view integration):** Image Blaster does NOT support multi-view. If true photogrammetric reconstruction from multiple photos is desired, a completely different reconstruction engine (COLMAP, Nerfstudio, 3D Gaussian Splatting toolkits) would be needed.

---

## 11. Supported Image Resolutions

No explicit resolution requirements found in the codebase. World Labs Marble API likely has its own limits (typically 1024x1024 to 4096x4096 for generative models). The codebase does not resize or validate resolution.

---

## 12. GPU Requirements

**None for the user/worker.** All GPU-intensive work happens on:
- **World Labs cloud** (Marble model) — world generation
- **FAL.ai cloud** (Hunyuan 3D) — object mesh generation  
- **ElevenLabs cloud** — SFX generation

The local machine only needs:
- Node.js/Bun runtime
- Claude Code CLI
- Network connectivity

---

## 13. VRAM Requirements

**None locally.** All inference is cloud-based.

---

## 14. Average Processing Time

From the README: **< 5 minutes** for a complete world (environment + objects + SFX).

Based on code inspection:
- World generation (World Labs API): ~60-120 seconds (polling with exponential backoff)
- Object 3D generation (Hunyuan via FAL): ~30-90 seconds per object  
- SFX generation: ~10-30 seconds
- Total depends on number of objects detected

---

## 15. Output Format

### Per-World Output Structure
```
worlds/<world-slug>/
  project.json          # Project metadata
  scene.json            # Editor placement state (object positions, rotations)
  image.json            # Merged scene description from analysis
  source/
    0-<slug>.<ext>      # Original/source images
    <image>.json        # Per-image analysis JSON
  output/
    world/
      N-world.json      # World Labs API response metadata
      N-world.glb       # Collider mesh from World Labs
      N-world.spz       # Gaussian splat (multiple quality levels)
      N-world-pano.png  # Panoramic image
      N-world-thumbnail.webp
    sfx/
      ambient-loop.mp3
    <object-slug>/
      object.json       # Object metadata & intent
      N-<object>.glb    # 3D mesh (Hunyuan/Meshy)
      N-<object>.obj    # Alternative mesh format
      sfx/              # Per-object sound effects
```

### Key Output Files
| File | Format | Source | Purpose |
|---|---|---|---|
| `*.spz` | Gaussian Splat (Niantic SPZ) | World Labs Marble API | Static environment rendering |
| `*.glb` (world) | glTF Binary | World Labs Marble API | Collision mesh for physics |
| `*.glb` (objects) | glTF Binary | Hunyuan 3D / Meshy via FAL | Dynamic object meshes |
| `*.obj` | Wavefront OBJ | Hunyuan 3D / Meshy | Alternative mesh format |
| `*.mp3` / `*.wav` | Audio | ElevenLabs | Sound effects |
| `scene.json` | JSON | Local editor | Object placement state |

---

## 16. Output Size

- Gaussian splats: Multiple quality levels (100k, 150k, 500k, full_res) — likely 5-50MB per quality level
- Collider mesh (.glb): Typically 1-10MB
- Object meshes (.glb): ~1-5MB each (50k face count default, configurable up to 1.5M)
- Panorama image: ~2-10MB
- Total per world: ~20-100MB depending on quality and object count

---

## 17. Whether Output Can Be Rendered on Mobile

### YES — with important caveats:

**Gaussian Splats (.spz):**
- The app uses `@sparkjsdev/spark` (SparkJS) for rendering splats
- SparkJS uses WebGL and should work on mobile browsers
- However, `.spz` format support on React Native requires investigation
- The existing viewer is a **web app** (React + Three.js), not a native mobile app

**GLB Meshes:**
- Standard glTF format, widely supported on mobile
- Can be rendered with Three.js, Babylon.js, or native renderers

**Physics (Rapier):**
- Uses `@react-three/rapier` for character physics
- This works in web contexts; React Native compatibility needs verification

---

## 18. Whether Conversion or Optimization is Required

**For web-based mobile rendering:** The outputs are already web-compatible (SPZ splats + GLB meshes).

**For native React Native rendering:**
- SPZ Gaussian Splat format needs a compatible renderer (SparkJS or equivalent)
- GLB files may need optimization (Draco compression, texture downsampling) for mobile VRAM
- Quality level selection exists (100k, 150k, 500k, full_res splats) — use lower quality for mobile

---

## 19. Whether the Repository Exposes a CLI

**No traditional CLI.** The repository is designed to be used through **Claude Code** (Anthropic's AI coding agent). The workflow is:

1. Run `claude` CLI
2. Chat with Claude, providing API keys and image
3. Claude orchestrates the pipeline using skills and scripts

The scripts (`.claude/scripts/`) can theoretically be called directly via `node`, but they're designed to be invoked by Claude with specific arguments.

**Key scripts that could be called programmatically:**
- `node .claude/scripts/world/generate-world.mjs` — Generates world via World Labs API
- `node .claude/scripts/asset-pipeline/generate-single-asset.mjs` — Generates 3D object
- `node .claude/scripts/sfx/fal-elevenlabs-sfx.mjs` — Generates SFX
- `node .claude/scripts/project/project-state.mjs` — Manages project state

---

## 20. Whether the Repository Can Run as a Worker Service

**Not as-is.** The repository requires:
1. Claude Code as the orchestration layer
2. Interactive human confirmation at each step (by default)
3. API keys for World Labs and FAL.ai

**However,** the individual scripts are Node.js modules that CAN be called programmatically. A worker service could:
1. Call `generate-world.mjs` directly with proper arguments
2. Call `generate-single-asset.mjs` for each object
3. Skip Claude orchestration entirely
4. But would need to replicate the image analysis (scene description) that Claude does

---

## 21. License Restrictions

**MIT License** — Very permissive. Can be used commercially, modified, distributed.

However, the **external services** have their own terms:
- **World Labs Marble API** — Commercial API with usage-based pricing
- **FAL.ai** — Commercial API platform  
- **ElevenLabs** — Commercial API for SFX
- **Hunyuan 3D** — Tencent model, specific license terms apply

---

## 22. Major Technical Risks

> [!CAUTION]
> ### CRITICAL: Architecture Mismatch
> The user's prompt assumes a multi-view photogrammetric reconstruction pipeline. Image Blaster is fundamentally a **single-image AI generation** tool. The entire capture strategy (guided multi-photo capture, overlap detection, coverage estimation) needs to be reconsidered.

### Risk Register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **Architecture mismatch** — IB generates from 1 image, not multi-view reconstruction | CRITICAL | Redesign capture flow for single best-photo or hybrid approach |
| 2 | **Cloud API dependency** — All processing requires World Labs + FAL.ai accounts and API keys | HIGH | Abstract APIs, implement cost tracking, consider alternatives |
| 3 | **API costs at scale** — Every room generation incurs API charges | HIGH | Implement usage quotas, cost estimation, user billing |
| 4 | **No structured progress API** — World Labs uses polling, no webhooks | MEDIUM | Implement polling adapter with progress estimation |
| 5 | **Claude dependency for analysis** — Scene description requires AI vision analysis | HIGH | Can use our own vision API (GPT-4V, Gemini) for scene analysis |
| 6 | **SPZ splat format** — Relatively niche format, mobile rendering uncertain | MEDIUM | Test SparkJS on mobile; fallback to mesh-only rendering |
| 7 | **Quality unpredictability** — AI-generated environments may not match actual room | HIGH | Set user expectations, allow regeneration, quality preview |
| 8 | **No offline capability** — Everything requires cloud APIs | MEDIUM | Cache results, support offline viewing of generated scenes |
| 9 | **Rate limits** — Cloud APIs have rate limits and quotas | MEDIUM | Implement queue management and retry logic |
| 10 | **Bun dependency** — Package manager is Bun, not npm | LOW | Can use npm/node; scripts are standard ES modules |

---

## 23. Missing Capabilities

1. **Multi-view reconstruction** — Not supported. Would need COLMAP, Nerfstudio, or similar.
2. **Photogrammetric accuracy** — Generated environments are AI hallucinations, not accurate representations.
3. **Programmatic API** — No REST/gRPC API. Only CLI scripts designed for Claude.
4. **Progress callbacks** — World Labs uses polling only.
5. **Batch processing** — Each world is processed individually.
6. **Scene merging** — No concept of combining multiple rooms.
7. **Geometry accuracy** — Collider mesh is AI-generated, may not match real room geometry.

---

## 24. Required Supporting Technologies

| Technology | Purpose | Required For |
|---|---|---|
| **Node.js / Bun** | Script runtime | Running generation scripts |
| **World Labs API Key** | Cloud API access | Environment generation (Marble model) |
| **FAL.ai API Key** | Cloud API access | 3D object generation (Hunyuan 3D) |
| **ElevenLabs API Key** | Cloud API access | Sound effect generation |
| **Three.js + React Three Fiber** | 3D rendering | Viewer application |
| **SparkJS (@sparkjsdev/spark)** | Gaussian splat rendering | SPZ file rendering |
| **Rapier Physics** | Physics engine | Character collision and movement |
| **Vision AI (Claude/GPT-4V/Gemini)** | Image analysis | Scene description extraction |

---

## Appendix A: Technology Classification

| Technique | Supported? |
|---|---|
| Structure from Motion | ❌ No |
| Camera pose estimation | ❌ No |
| Sparse reconstruction | ❌ No |
| Dense reconstruction | ❌ No |
| Photogrammetry | ❌ No |
| Multi-View Stereo | ❌ No |
| Neural Radiance Fields | ❌ No |
| 3D Gaussian Splatting | ⚠️ Consumes (renders) splats, does not generate them locally |
| Mesh generation | ⚠️ Via cloud APIs only (World Labs, Hunyuan) |
| Textured mesh generation | ⚠️ Via cloud APIs only (Hunyuan with PBR) |
| Point-cloud reconstruction | ❌ No |
| Depth estimation | ❌ No |
| Novel-view synthesis | ✅ Yes — World Labs Marble generates novel views |
| Scene completion | ✅ Yes — World Labs fills in unobserved areas |
| Object reconstruction | ⚠️ AI generation from reference image, not true reconstruction |
| Room reconstruction | ⚠️ AI generation from single image, not photogrammetric |

---

## Appendix B: Existing Viewer Architecture (Reusable Components)

The `app/` directory contains a complete Three.js-based viewer that is highly relevant:

| Component | File | Reusability |
|---|---|---|
| `SplatRenderer` | `app/src/modules/splat/SplatRenderer.tsx` | HIGH — Renders .spz files using SparkJS |
| `CharacterController` | `app/src/modules/character/CharacterController.tsx` | HIGH — First-person physics controller |
| `FlyController` | `app/src/modules/character/FlyController.tsx` | HIGH — Free-fly camera mode |
| `WorldCollider` | `app/src/modules/collider/WorldCollider.tsx` | HIGH — Loads .glb for physics collision |
| `GroundPlane` | `app/src/modules/collider/GroundPlane.tsx` | HIGH — Ground plane collision |
| `WorldViewer` | `app/src/components/WorldViewer.tsx` | HIGH — Complete viewer orchestration |
| `TouchControls` | `app/src/components/TouchControls.tsx` | HIGH — Mobile touch input |
| `ObjectGrid` | `app/src/modules/scene/ObjectGrid.tsx` | MEDIUM — Object placement in scene |
| `PostProcessing` | `app/src/modules/postprocessing/PostProcessing.tsx` | MEDIUM — Visual effects |
| `AudioManager` | `app/src/modules/audio/AudioManager.tsx` | LOW — Sound playback |

### Viewer Tech Stack
- React + TypeScript + Vite
- Three.js via `@react-three/fiber`
- Physics via `@react-three/rapier` (Rapier WASM)
- Splats via `@sparkjsdev/spark`
- UI via `@radix-ui/themes`
- Icons via `@phosphor-icons/react`
- Styling via Tailwind CSS
