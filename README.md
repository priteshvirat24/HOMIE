# HOMIE — walk through your home in 3D

Photograph a room (1 photo, or up to 8 from different angles) and HOMIE turns it into a 3D space you can
walk through on your phone or in a browser. Do it for every room and walk through the whole house.

3D generation uses the World Labs Marble pipeline from
[image-blaster](https://github.com/neilsonnn/image-blaster) (MIT): the worker calls
`worlds:generate`, polls the operation, and downloads the Gaussian splat (`.spz`), collider mesh,
panorama and thumbnail. The viewer renders the splat with Spark and walks on the collider with Rapier,
adapted from image-blaster's viewer.

## Apps

| Path | What it is |
|---|---|
| `apps/api` | FastAPI: houses, rooms, photo upload, jobs, scene manifests, house tours, scene file streaming. Also serves the web app at `/viewer/`. |
| `apps/worker` | Celery worker: photos → World Labs → scene files in S3 → publishes the room's scene. |
| `apps/viewer` | Vite + React. **Web app** at `/viewer/` (houses, rooms, drag-and-drop photos, build progress) and the **3D walkthrough** (`/viewer/?property=…&room=…`) the phone opens in a WebView. |
| `apps/mobile` | Expo app: capture rooms with the camera, follow the build, walk through rooms or the whole house. |

Infrastructure (docker-compose): Postgres (port 5433), Redis (6380), SeaweedFS S3 (9000). MinIO no longer
publishes Docker images, so SeaweedFS's S3 gateway is used for local storage.

## Setup

```bash
cp .env.example .env            # then set WORLD_LABS_API_KEY
docker compose up -d
```

`.env` must point at the docker ports: `POSTGRES_PORT=5433`, `POSTGRES_PASSWORD=homie_dev_password`,
`REDIS_URL=redis://localhost:6380/0`, `S3_ENDPOINT=http://localhost:9000`.

```bash
# API (Python 3.12)
cd apps/api && uv venv -p 3.12 .venv && uv pip install -p .venv -e '.[dev]'
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000

# Worker
cd apps/worker && uv venv -p 3.12 .venv && uv pip install -p .venv -e '.[dev]'
.venv/bin/celery -A celery_app worker --loglevel=info --concurrency=2

# Web app + 3D viewer (served by the API at http://localhost:8000/)
npm install && npm run build:viewer      # or `npm run dev:viewer` for hot reload on :5173

# Phone app
cd apps/mobile && npm install --legacy-peer-deps && npx expo start
```

On a real phone, set `EXPO_PUBLIC_API_URL` to your computer's LAN address (e.g. `http://192.168.1.20:8000`).
Photos upload through the API and scene files stream back through it, so the phone only needs that one address.

Each room build costs World Labs credits and takes about 5 minutes. A Celery retry resumes the same
World Labs operation instead of paying for a second one; the “Try again” button starts a new generation.

## Tests (375)

The API and worker suites use the docker-compose services; they create and drop their own databases
(`homie_api_test`, `homie_worker_test`) and buckets. World Labs is replaced by a local fake server
(`apps/worker/tests/fake_worldlabs.py`), so tests never spend credits.

```bash
cd apps/api && .venv/bin/python -m pytest          # 159 tests
cd apps/worker && .venv/bin/python -m pytest       # 120 tests
npm run test:viewer                                # 81 tests (web app + viewer)
cd apps/mobile && npm test                         # 17 tests (API client)
```

Run a whole build locally without World Labs: start `python tests/fake_worldlabs.py 8765` in `apps/worker`, then run
the worker with `WORLD_LABS_API_KEY=test-key WORLD_LABS_ENDPOINT=http://127.0.0.1:8765/marble/v1`.

## Docs

- [Repository analysis](docs/reconstruction-repository-analysis.md)
- [System architecture](docs/architecture/initial-system-architecture.md)
- [Technical risk register](docs/technical-risk-register.md)
