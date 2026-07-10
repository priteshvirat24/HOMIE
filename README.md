# HOMIE — Home Digitization Platform

A mobile application that lets users capture photographs of rooms and generate navigable 3D environments using AI-powered reconstruction.

## Architecture

- **Mobile App** — React Native + Expo (TypeScript)
- **Backend API** — Python + FastAPI
- **Worker** — Python + Celery (Image Blaster integration)
- **Viewer** — Vite + React + Three.js (WebGL 3D viewer)
- **Database** — PostgreSQL
- **Queue** — Redis + Celery
- **Storage** — MinIO (dev) / S3 (prod)

## Quick Start

```bash
# 1. Copy environment file
cp .env.example .env

# 2. Start infrastructure
docker compose up -d postgres redis minio

# 3. Run database migrations
cd apps/api && alembic upgrade head

# 4. Start backend API
cd apps/api && uvicorn app.main:app --reload

# 5. Start worker
cd apps/worker && celery -A tasks worker --loglevel=info

# 6. Start mobile app
cd apps/mobile && npx expo start

# 7. Start viewer (optional, for development)
cd apps/viewer && npm run dev
```

## Project Structure

```
HOMIE/
├── apps/
│   ├── mobile/          # React Native Expo app
│   ├── api/             # FastAPI backend
│   ├── worker/          # Celery reconstruction worker
│   └── viewer/          # Three.js 3D viewer web app
├── packages/
│   └── shared-types/    # Shared TypeScript types
├── infrastructure/
│   └── docker/          # Dockerfiles
├── docs/                # Documentation
└── tests/               # Integration & E2E tests
```

## Documentation

- [Repository Analysis](docs/reconstruction-repository-analysis.md)
- [Codebase Audit](docs/codebase-audit.md)
- [System Architecture](docs/architecture/initial-system-architecture.md)
- [Technical Risk Register](docs/technical-risk-register.md)
