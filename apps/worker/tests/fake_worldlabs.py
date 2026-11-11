"""A tiny stand-in for the World Labs Marble API, used by tests and local end-to-end runs.

Speaks the same protocol image-blaster uses:
  POST /marble/v1/worlds:generate   -> {"operation_id": ..., "done": false}
  GET  /marble/v1/operations/{id}    -> not done for `polls_until_done` polls, then done with a World
  GET  /files/<name>                 -> asset bytes referenced by the World

Run standalone:  python tests/fake_worldlabs.py 8765
"""

import json
import sys
import threading
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

ASSETS = {
    "world-full.spz": b"SPZ-FULL" + b"\x00" * 64,
    "world-500k.spz": b"SPZ-500K" + b"\x00" * 32,
    "collider.glb": b"glTF" + b"\x00" * 16,
    "pano.png": b"\x89PNG\r\n\x1a\nfake",
    "thumb.webp": b"RIFF\x00\x00\x00\x00WEBPfake",
}


@dataclass
class FakeState:
    api_key: str = "test-key"
    polls_until_done: int = 1
    fail_generation: str | None = None  # error message to return when done
    submit_status: int = 200
    requests: list[dict[str, Any]] = field(default_factory=list)
    polls: dict[str, int] = field(default_factory=dict)
    include_optional_assets: bool = True


def make_handler(state: FakeState, base_url_ref: list[str]):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):  # silence
            pass

        def _json(self, status: int, body: Any):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _authorized(self) -> bool:
            if self.headers.get("WLT-Api-Key") != state.api_key:
                self._json(401, {"detail": "bad key"})
                return False
            return True

        def do_POST(self):
            if self.path != "/marble/v1/worlds:generate":
                return self._json(404, {"detail": "not found"})
            if not self._authorized():
                return
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            state.requests.append(body)
            if state.submit_status != 200:
                return self._json(state.submit_status, {"detail": "submit failed"})
            op_id = f"op-{len(state.requests)}"
            state.polls[op_id] = 0
            self._json(200, {"operation_id": op_id, "done": False, "metadata": None, "error": None})

        def do_GET(self):
            base = base_url_ref[0]
            if self.path.startswith("/files/"):
                name = self.path.removeprefix("/files/")
                if name not in ASSETS:
                    self.send_response(404)
                    self.end_headers()
                    return
                data = ASSETS[name]
                self.send_response(200)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            if not self.path.startswith("/marble/v1/operations/"):
                return self._json(404, {"detail": "not found"})
            if not self._authorized():
                return
            op_id = self.path.rsplit("/", 1)[-1]
            if op_id not in state.polls:
                return self._json(404, {"detail": "unknown operation"})
            state.polls[op_id] += 1
            if state.polls[op_id] < state.polls_until_done:
                return self._json(200, {"operation_id": op_id, "done": False, "metadata": {"progress": 40}})
            if state.fail_generation:
                return self._json(200, {"operation_id": op_id, "done": True,
                                        "error": {"code": 3, "message": state.fail_generation}})
            assets: dict[str, Any] = {
                "splats": {
                    "spz_urls": {"full_res": f"{base}/files/world-full.spz", "500k": f"{base}/files/world-500k.spz"},
                    "semantics_metadata": {"metric_scale_factor": 1.5, "ground_plane_offset": -0.8, "flip_y": True},
                },
                "caption": "A cosy living room",
            }
            if state.include_optional_assets:
                assets["mesh"] = {"collider_mesh_url": f"{base}/files/collider.glb"}
                assets["imagery"] = {"pano_url": f"{base}/files/pano.png"}
                assets["thumbnail_url"] = f"{base}/files/thumb.webp"
            world = {"world_id": f"world-{op_id}", "display_name": "test", "world_marble_url": "https://marble/x",
                     "assets": assets}
            self._json(200, {"operation_id": op_id, "done": True, "response": world, "error": None})

    return Handler


class FakeWorldLabs:
    def __init__(self, port: int = 0, state: FakeState | None = None):
        self.state = state or FakeState()
        self._base: list[str] = [""]
        self.server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(self.state, self._base))
        self._base[0] = f"http://127.0.0.1:{self.server.server_port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    @property
    def base_url(self) -> str:
        return self._base[0]

    @property
    def endpoint(self) -> str:
        return f"{self.base_url}/marble/v1"

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.server.shutdown()
        self.server.server_close()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    with FakeWorldLabs(port, FakeState(polls_until_done=3)) as fake:
        print(f"fake World Labs at {fake.endpoint} (key: test-key)", flush=True)
        threading.Event().wait()
