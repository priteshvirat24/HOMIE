# Codebase Audit

> **Document Version:** 1.0  
> **Date:** 2026-07-11  
> **Status:** COMPLETE — Phase 0 Deliverable

---

## 1. Current State

The workspace at `/Users/priteshhome/HOMIE` is **empty** (contains only a blank `txt.txt`). There is no existing project. This is a greenfield implementation.

---

## 2. Image Blaster Codebase Assessment

### 2.1 Project Structure
```
image-blaster/
├── .claude/                    # Claude Code integration
│   ├── agents/                 # Agent definitions (6 agents)
│   ├── hooks/                  # Pre-execution hooks (setup & input validation)
│   ├── rules/                  # Project rules and conventions
│   ├── scripts/                # Core execution scripts
│   │   ├── asset-pipeline/     # 3D generation (Hunyuan, Meshy, image editing)
│   │   ├── fal/                # FAL.ai API client
│   │   ├── image-edit/         # Image editing (isolation, cleanup)
│   │   ├── project/            # Project state management
│   │   ├── sfx/                # Sound effect generation
│   │   └── world/              # World Labs API integration
│   ├── settings.json           # Claude Code settings
│   └── skills/                 # Skill definitions (7 skills)
├── app/                        # React viewer application (Vite + TypeScript)
│   ├── src/
│   │   ├── components/         # UI components (WorldViewer, Sidebar, etc.)
│   │   ├── modules/            # Feature modules
│   │   │   ├── audio/          # Audio management
│   │   │   ├── butterfly/      # Demo scene (butterflies)
│   │   │   ├── camera/         # Camera gestures
│   │   │   ├── character/      # First-person controller
│   │   │   ├── collider/       # Physics collision
│   │   │   ├── environment/    # HDRI environment maps
│   │   │   ├── interaction/    # Pointer/touch interaction
│   │   │   ├── postprocessing/ # Visual effects
│   │   │   ├── scene/          # Object placement & rendering
│   │   │   └── splat/          # Gaussian splat renderer
│   │   ├── store/              # State management (Zustand)
│   │   ├── types/              # TypeScript type definitions
│   │   └── utils/              # Utility functions
│   └── public/                 # Static assets
├── input/                      # User input images
├── worlds/                     # Generated world outputs
├── package.json                # Workspace root (Bun)
└── bun.lock                    # Dependency lock file
```

### 2.2 Frameworks & Technologies
| Category | Technology | Version |
|---|---|---|
| Runtime | Bun / Node.js | Latest |
| Package Manager | Bun | Latest |
| Frontend Framework | React | 19.x |
| 3D Rendering | Three.js via @react-three/fiber | v9.6.0 |
| Physics | Rapier via @react-three/rapier | v2.x |
| Splat Rendering | SparkJS (@sparkjsdev/spark) | v0.5.x |
| Build Tool | Vite | Latest |
| UI Framework | Radix UI Themes | v3.3.0 |
| Styling | Tailwind CSS | v4.x |
| State Management | Zustand | v5.x |
| Icons | Phosphor Icons | v2.x |
| Language | TypeScript | Strict |

### 2.3 Reusable Components for HOMIE

| Component | Reusability | Notes |
|---|---|---|
| `SplatRenderer` | ✅ Copy & adapt | Core Gaussian splat rendering via SparkJS |
| `CharacterController` | ✅ Copy & adapt | First-person physics with WASD + mouse + touch |
| `FlyController` | ✅ Copy & adapt | Free-fly camera mode |
| `WorldCollider` | ✅ Copy & adapt | GLB-based collision mesh loading |
| `GroundPlane` | ✅ Copy & adapt | Ground plane for physics |
| `TouchControls` | ✅ Copy & adapt | Mobile touch joystick |
| `WorldViewer` | ⚠️ Heavy adaptation | Full viewer orchestration, too coupled to IB |
| `generate-world.mjs` | ✅ Wrap in adapter | Core World Labs API integration |
| `generate-single-asset.mjs` | ✅ Wrap in adapter | Core 3D object generation |
| `fal-queue.mjs` | ✅ Use as-is | FAL.ai polling/queue utilities |
| `project-state.mjs` | ⚠️ Reference only | IB-specific project management |

---

## 3. Technical Debt Assessment

Since this is a greenfield project, there is no existing technical debt. However, if we adopt Image Blaster components:

| Issue | Severity | Notes |
|---|---|---|
| Web-only architecture | HIGH | Viewer is web-based; React Native requires adaptation |
| No API layer | HIGH | All scripts assume local filesystem access |
| Claude-coupled orchestration | HIGH | Pipeline requires Claude AI to function |
| No authentication | HIGH | No user/auth concept |
| No database | HIGH | Uses filesystem JSON for state |
| Bun-specific lock file | LOW | Can regenerate with npm |
| Tailwind CSS dependency | LOW | Style system mismatch if we use vanilla CSS |

---

## 4. Missing Infrastructure for HOMIE

| Component | Status | Priority |
|---|---|---|
| Mobile app (React Native/Expo) | NOT EXISTS | P0 |
| Backend API (FastAPI) | NOT EXISTS | P0 |
| Database (PostgreSQL) | NOT EXISTS | P0 |
| Authentication system | NOT EXISTS | P0 |
| Object storage (MinIO/S3) | NOT EXISTS | P0 |
| Job queue (Redis + Celery) | NOT EXISTS | P0 |
| Worker service | NOT EXISTS | P0 |
| Docker Compose | NOT EXISTS | P0 |
| CI/CD | NOT EXISTS | P1 |
| Monitoring | NOT EXISTS | P2 |

---

## 5. Proposed Changes

### What We Will Build (Not Adopt)
1. **New React Native (Expo) mobile app** — camera, capture, upload, viewer
2. **New FastAPI backend** — REST API, auth, property/room management
3. **New PostgreSQL database** — normalized schema
4. **New Redis + Celery worker** — job queue and processing
5. **New MinIO integration** — S3-compatible object storage
6. **Docker Compose** — local development environment

### What We Will Adapt From Image Blaster
1. **World Labs API integration** — Adapt `generate-world.mjs` into Python worker
2. **FAL.ai integration** — Adapt `fal-queue.mjs` polling pattern
3. **Viewer components** — Port SplatRenderer, CharacterController, TouchControls to React Native compatible form
4. **Scene format** — Use the same output structure (SPZ + GLB + JSON)
5. **World type definitions** — Adapt TypeScript types for our schema

### What We Will NOT Use
1. Claude Code orchestration — Replace with our own worker service
2. Claude AI for scene analysis — Use our own vision API integration
3. Bun package manager — Use npm
4. Filesystem-based state — Use PostgreSQL
5. Demo/butterfly scene code — Not relevant

---

## 6. Migration Strategy

**Not applicable** — This is a greenfield project. We will build from scratch and selectively port Image Blaster components where beneficial.
