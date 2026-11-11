"""Engine flow against a fake World Labs server (same protocol as image-blaster's generate-world.mjs)."""

import pytest

import engines.image_blaster as ib
from engines import EngineError, ImageBlasterEngine, JobCancelled, TransientEngineError

from .conftest import RecordingContext


@pytest.fixture
def engine():
    return ImageBlasterEngine()


@pytest.fixture
def out(tmp_path):
    d = tmp_path / "out"
    d.mkdir()
    return d


def test_single_photo_generates_world_and_downloads_assets(engine, fake_wl, make_image, out, ctx):
    scene = engine.reconstruct([make_image()], out, {}, ctx)
    assert set(scene.files) == {"splat", "splat_mobile", "collider", "panorama", "thumbnail"}
    assert scene.files["splat"].read_bytes().startswith(b"SPZ-FULL")
    assert scene.files["splat_mobile"].read_bytes().startswith(b"SPZ-500K")
    assert fake_wl.state.requests[0]["world_prompt"]["type"] == "image"


def test_multiple_photos_use_multi_image_prompt(engine, fake_wl, make_image, out, ctx):
    photos = [make_image(f"{i}.jpg", (900 + i * 10, 700)) for i in range(4)]
    engine.reconstruct(photos, out, {}, ctx)
    wp = fake_wl.state.requests[0]["world_prompt"]
    assert wp["type"] == "multi-image"
    assert len(wp["multi_image_prompt"]) == 4


def test_more_than_eight_photos_are_trimmed(engine, fake_wl, make_image, out, ctx):
    photos = [make_image(f"{i}.jpg") for i in range(11)]
    engine.reconstruct(photos, out, {}, ctx)
    assert len(fake_wl.state.requests[0]["world_prompt"]["multi_image_prompt"]) == 8
    assert ctx.state["input_images"] == 8


def test_sends_api_key_header(engine, fake_wl, make_image, out, ctx, monkeypatch):
    monkeypatch.setenv("WORLD_LABS_API_KEY", "wrong")
    with pytest.raises(EngineError) as e:
        engine.reconstruct([make_image()], out, {}, ctx)
    assert e.value.category == "auth"


def test_operation_id_is_saved_for_resume(engine, fake_wl, make_image, out, ctx):
    engine.reconstruct([make_image()], out, {}, ctx)
    assert ctx.state["operation_id"] == "op-1"
    assert ctx.state["world_id"] == "world-op-1"
    assert ctx.state["model"] == ib.DEFAULT_MODEL


def test_resume_polls_existing_operation_without_resubmitting(engine, fake_wl, make_image, out, ctx):
    engine.reconstruct([make_image()], out, {}, ctx)  # creates op-1
    resumed = RecordingContext(state={"operation_id": "op-1"})
    engine.reconstruct([make_image()], out, {}, resumed)
    assert len(fake_wl.state.requests) == 1


def test_manifest_carries_viewer_settings(engine, fake_wl, make_image, out, ctx):
    m = engine.reconstruct([make_image()], out, {}, ctx).manifest
    assert m["viewerSettings"] == {"metricScaleFactor": 1.5, "groundPlaneOffset": -0.8, "flipY": True}
    assert m["representation"] == "gaussian_splat"
    assert m["engine"] == "image_blaster"
    assert m["caption"] == "A cosy living room"
    assert m["splatResolutions"] == {"full": "full_res", "mobile": "500k"}


def test_polls_until_done(engine, fake_wl, make_image, out, ctx):
    fake_wl.state.polls_until_done = 4
    engine.reconstruct([make_image()], out, {}, ctx)
    assert fake_wl.state.polls["op-1"] == 4


def test_progress_is_monotonic_and_bounded(engine, fake_wl, make_image, out, ctx):
    fake_wl.state.polls_until_done = 3
    engine.reconstruct([make_image()], out, {}, ctx)
    values = [p for p, _ in ctx.events]
    assert all(0 <= v < 1 for v in values)
    assert values == sorted(values)


def test_generation_failure_is_permanent(engine, fake_wl, make_image, out, ctx):
    fake_wl.state.fail_generation = "content policy"
    with pytest.raises(EngineError) as e:
        engine.reconstruct([make_image()], out, {}, ctx)
    assert e.value.category == "generation_failed"
    assert "content policy" in str(e.value)


@pytest.mark.parametrize("status, exc", [(500, TransientEngineError), (503, TransientEngineError),
                                         (429, TransientEngineError), (402, EngineError), (400, EngineError)])
def test_submission_errors(engine, fake_wl, make_image, out, ctx, status, exc):
    fake_wl.state.submit_status = status
    with pytest.raises(exc):
        engine.reconstruct([make_image()], out, {}, ctx)


def test_unknown_operation_on_resume_is_permanent(engine, fake_wl, make_image, out):
    with pytest.raises(EngineError):
        engine.reconstruct([make_image()], out, {}, RecordingContext(state={"operation_id": "op-999"}))


def test_cancel_during_polling_stops(engine, fake_wl, make_image, out):
    fake_wl.state.polls_until_done = 50
    with pytest.raises(JobCancelled):
        engine.reconstruct([make_image()], out, {}, RecordingContext(cancel_after_checks=3))
    assert fake_wl.state.polls["op-1"] < 50


def test_cancel_before_submit_sends_nothing(engine, fake_wl, make_image, out):
    with pytest.raises(JobCancelled):
        engine.reconstruct([make_image()], out, {}, RecordingContext(cancel_after_checks=0))
    assert fake_wl.state.requests == []


def test_timeout(engine, fake_wl, make_image, out, ctx, monkeypatch):
    fake_wl.state.polls_until_done = 10_000
    monkeypatch.setattr(ib, "GENERATION_TIMEOUT_S", 0.05)
    with pytest.raises(EngineError) as e:
        engine.reconstruct([make_image()], out, {}, ctx)
    assert e.value.category == "timeout"


def test_optional_assets_may_be_missing(engine, fake_wl, make_image, out, ctx):
    fake_wl.state.include_optional_assets = False
    scene = engine.reconstruct([make_image()], out, {}, ctx)
    assert set(scene.files) == {"splat", "splat_mobile"}


def test_custom_model_and_prompt_are_sent(engine, fake_wl, make_image, out, ctx):
    engine.reconstruct([make_image()], out, {"model": "marble-1.1-plus", "prompt": "cosy"}, ctx)
    req = fake_wl.state.requests[0]
    assert req["model"] == "marble-1.1-plus"
    assert req["world_prompt"]["text_prompt"] == "cosy"


def test_unreachable_api_is_transient(engine, make_image, out, ctx, monkeypatch):
    monkeypatch.setattr(ib, "ENDPOINT", "http://127.0.0.1:9/marble/v1")
    with pytest.raises(TransientEngineError):
        engine.reconstruct([make_image()], out, {}, ctx)
