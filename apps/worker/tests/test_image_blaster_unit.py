"""Unit tests for the image-blaster engine helpers (no network, no services)."""

import base64
import io

import httpx
import pytest
from PIL import Image

import engines.image_blaster as ib
from engines import EngineError, ImageBlasterEngine, TransientEngineError, get_engine


# ---------- image selection ----------

@pytest.mark.parametrize("count", [1, 2, 5, 8])
def test_select_images_keeps_all_up_to_limit(tmp_path, count):
    paths = [tmp_path / f"{i}.jpg" for i in range(count)]
    assert ib._select_images(paths) == paths


@pytest.mark.parametrize("count", [9, 12, 20, 100])
def test_select_images_caps_at_eight(tmp_path, count):
    paths = [tmp_path / f"{i}.jpg" for i in range(count)]
    selected = ib._select_images(paths)
    assert len(selected) == ib.MAX_IMAGES


@pytest.mark.parametrize("count", [9, 15, 40])
def test_select_images_keeps_first_and_last_and_order(tmp_path, count):
    paths = [tmp_path / f"{i}.jpg" for i in range(count)]
    selected = ib._select_images(paths)
    assert selected[0] == paths[0]
    assert selected[-1] == paths[-1]
    assert selected == sorted(selected, key=paths.index)
    assert len(set(selected)) == len(selected)


# ---------- normalisation ----------

def _decode(jpeg: bytes) -> Image.Image:
    im = Image.open(io.BytesIO(jpeg))
    im.load()
    return im


def test_normalize_single_image_keeps_size_when_small(make_image):
    out = ib.normalize_images([make_image(size=(800, 600))])
    assert len(out) == 1
    assert _decode(out[0]).size == (800, 600)


def test_normalize_single_image_outputs_jpeg(make_image):
    out = ib.normalize_images([make_image(name="p.png", fmt="PNG")])
    assert _decode(out[0]).format == "JPEG"


@pytest.mark.parametrize("size", [(4000, 3000), (3000, 4000), (6000, 1000)])
def test_normalize_single_image_caps_long_edge(make_image, size):
    im = _decode(ib.normalize_images([make_image(size=size)])[0])
    assert max(im.size) <= ib.MAX_LONG_EDGE
    # aspect ratio preserved within rounding
    assert abs(im.width / im.height - size[0] / size[1]) < 0.01


def test_normalize_multi_images_have_identical_dimensions(make_image):
    paths = [make_image("a.jpg", (1600, 1200)), make_image("b.jpg", (1920, 1080)), make_image("c.jpg", (1200, 1600))]
    sizes = {_decode(b).size for b in ib.normalize_images(paths)}
    assert len(sizes) == 1


def test_normalize_multi_uses_median_aspect(make_image):
    paths = [make_image("a.jpg", (1600, 900)), make_image("b.jpg", (1600, 900)), make_image("c.jpg", (900, 1600))]
    w, h = _decode(ib.normalize_images(paths)[0]).size
    assert w > h  # two landscape photos out-vote one portrait


def test_normalize_multi_never_upscales_beyond_smallest_photo(make_image):
    paths = [make_image("a.jpg", (640, 480)), make_image("b.jpg", (4000, 3000))]
    w, h = _decode(ib.normalize_images(paths)[0]).size
    assert min(w, h) <= 480


def test_normalize_applies_exif_rotation(make_image):
    # Orientation 6 = rotate 90° CW on display: a 800x600 landscape becomes portrait
    out = ib.normalize_images([make_image(size=(800, 600), exif_orientation=6)])
    assert _decode(out[0]).size == (600, 800)


def test_normalize_converts_rgba_png(make_image):
    path = make_image(name="alpha.png", fmt="PNG", mode="RGBA")
    assert _decode(ib.normalize_images([path])[0]).mode == "RGB"


def test_normalize_rejects_non_image(tmp_path):
    bad = tmp_path / "notes.jpg"
    bad.write_text("not an image")
    with pytest.raises(EngineError) as e:
        ib.normalize_images([bad])
    assert e.value.category == "bad_input"


# ---------- request body (World Labs schema used by image-blaster) ----------

def test_build_request_single_image_uses_image_prompt():
    req = ib.build_request([b"jpeg"], "Room", "marble-1.1", None)
    assert req["world_prompt"]["type"] == "image"
    content = req["world_prompt"]["image_prompt"]
    assert content["source"] == "data_base64"
    assert base64.b64decode(content["data_base64"]) == b"jpeg"
    assert content["extension"] == "jpg"


def test_build_request_multi_image_uses_auto_layout():
    req = ib.build_request([b"a", b"b", b"c"], "Room", "marble-1.1", None)
    wp = req["world_prompt"]
    assert wp["type"] == "multi-image"
    assert wp["reconstruct_images"] is True
    assert len(wp["multi_image_prompt"]) == 3
    assert all("azimuth" not in item for item in wp["multi_image_prompt"])
    assert [base64.b64decode(i["content"]["data_base64"]) for i in wp["multi_image_prompt"]] == [b"a", b"b", b"c"]


@pytest.mark.parametrize("n", [1, 3])
def test_build_request_includes_text_prompt_when_given(n):
    req = ib.build_request([b"x"] * n, "Room", "marble-1.1", "A bright kitchen")
    assert req["world_prompt"]["text_prompt"] == "A bright kitchen"


def test_build_request_omits_text_prompt_by_default():
    assert "text_prompt" not in ib.build_request([b"x"], "Room", "marble-1.1", None)["world_prompt"]


def test_build_request_truncates_display_name_to_64():
    assert len(ib.build_request([b"x"], "n" * 200, "marble-1.1", None)["display_name"]) == 64


@pytest.mark.parametrize("model", ["marble-1.1", "marble-1.1-plus", "marble-1.0-draft"])
def test_build_request_passes_model(model):
    assert ib.build_request([b"x"], "Room", model, None)["model"] == model


# ---------- operation helpers ----------

@pytest.mark.parametrize(
    "op, expected",
    [
        ({"operation_id": "abc"}, "abc"),
        ({"id": "xyz"}, "xyz"),
        ({"name": "operations/123"}, "123"),
        ({"operation_id": "a/b/c"}, "c"),
        ({"operation_id": 42}, "42"),
    ],
)
def test_operation_id(op, expected):
    assert ib._operation_id(op) == expected


def test_operation_id_missing_raises():
    with pytest.raises(EngineError):
        ib._operation_id({"done": False})


@pytest.mark.parametrize(
    "op, expected",
    [
        ({"metadata": {"progress": 0.5}}, 0.5),
        ({"metadata": {"progress": 40}}, 0.4),
        ({"metadata": {"progress_percent": 75}}, 0.75),
        ({"metadata": {"percent": 1}}, 1.0),
        ({"metadata": {}}, None),
        ({"metadata": None}, None),
        ({}, None),
        ({"metadata": {"progress": "half"}}, None),
    ],
)
def test_operation_progress(op, expected):
    assert ib._operation_progress(op) == expected


# ---------- HTTP error mapping ----------

def _resp(status: int) -> httpx.Response:
    return httpx.Response(status, text="details", request=httpx.Request("GET", "http://x"))


@pytest.mark.parametrize("status, exc, category", [
    (401, EngineError, "auth"),
    (403, EngineError, "auth"),
    (402, EngineError, "billing"),
    (400, EngineError, "provider_error"),
    (422, EngineError, "provider_error"),
    (429, TransientEngineError, None),
    (500, TransientEngineError, None),
    (503, TransientEngineError, None),
])
def test_raise_for_status_maps_errors(status, exc, category):
    with pytest.raises(exc) as e:
        ib._raise_for_status(_resp(status), "submission")
    if category:
        assert e.value.category == category


@pytest.mark.parametrize("status", [200, 201, 202])
def test_raise_for_status_success_is_silent(status):
    ib._raise_for_status(_resp(status), "submission")


# ---------- environment ----------

@pytest.mark.parametrize("key", ["", "your_world_labs_key_here", "   "])
def test_validate_environment_rejects_missing_key(monkeypatch, key):
    monkeypatch.setenv("WORLD_LABS_API_KEY", key)
    with pytest.raises(EngineError) as e:
        ImageBlasterEngine().validate_environment()
    assert e.value.category == "config"


def test_validate_environment_accepts_key(monkeypatch):
    monkeypatch.setenv("WORLD_LABS_API_KEY", "real-looking-key")
    ImageBlasterEngine().validate_environment()


def test_registry_returns_image_blaster():
    assert get_engine("image_blaster").engine_name == "image_blaster"


def test_registry_rejects_unknown_engine():
    with pytest.raises(EngineError) as e:
        get_engine("colmap")
    assert e.value.category == "bad_request"
