"""Single-account sign-in: the session cookie, Basic credentials, the gate on /api/, and lockout."""

import base64
import time

import pytest

from app.core import auth
from app.core.config import get_settings

ME = "/api/v1/auth/me"
LOGIN = "/api/v1/auth/login"
LOGOUT = "/api/v1/auth/logout"
PROPS = "/api/v1/properties"


@pytest.fixture
def signin_on(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "app_username", "admin")
    monkeypatch.setattr(s, "app_password", "12345")
    monkeypatch.setattr(s, "session_secret", "test-secret")
    auth.clear_failures()
    yield s
    auth.clear_failures()


def basic(user, password):
    return {"Authorization": "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()}


async def sign_in(client, user="admin", password="12345"):
    return await client.post(LOGIN, json={"username": user, "password": password})


# ---------- sign-in off ----------

async def test_off_by_default_everything_is_open(client):
    assert (await client.get(PROPS)).status_code == 200
    assert (await client.get(ME)).json() == {"username": None, "auth_required": False}


async def test_off_login_is_a_no_op(client):
    r = await sign_in(client, "x", "y")
    assert r.status_code == 200
    assert r.json()["auth_required"] is False
    assert auth.COOKIE_NAME not in r.cookies


# ---------- the gate ----------

@pytest.mark.parametrize("path", [PROPS, "/api/v1/reconstruction-jobs?room_id=00000000-0000-0000-0000-000000000000",
                                  "/api/v1/assets/scenes/x/world.spz", "/api/v1/scenes/00000000-0000-0000-0000-000000000000/manifest"])
async def test_api_needs_sign_in(client, signin_on, path):
    r = await client.get(path)
    assert r.status_code == 401
    assert r.json() == {"detail": "Sign in to continue"}


async def test_writes_need_sign_in_too(client, signin_on):
    assert (await client.post(PROPS, json={"name": "x"})).status_code == 401


async def test_me_is_401_when_signed_out(client, signin_on):
    assert (await client.get(ME)).status_code == 401


@pytest.mark.parametrize("path", ["/health", "/viewer", "/"])
async def test_public_paths_stay_open(client, signin_on, path):
    assert (await client.get(path)).status_code in (200, 307)


async def test_preflight_is_not_blocked(client, signin_on):
    r = await client.options(PROPS, headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"})
    assert r.status_code == 200


# ---------- signing in ----------

async def test_login_sets_an_http_only_cookie(client, signin_on):
    r = await sign_in(client)
    assert r.status_code == 200
    assert r.json() == {"username": "admin", "auth_required": True}
    cookie = r.headers["set-cookie"]
    assert cookie.startswith(f"{auth.COOKIE_NAME}=")
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie
    assert "Path=/" in cookie
    assert f"Max-Age={auth.SESSION_SECONDS}" in cookie


async def test_cookie_opens_the_api(client, signin_on):
    await sign_in(client)
    assert (await client.get(PROPS)).status_code == 200
    assert (await client.get(ME)).json() == {"username": "admin", "auth_required": True}


async def test_username_is_trimmed(client, signin_on):
    assert (await sign_in(client, "  admin ")).status_code == 200


@pytest.mark.parametrize("user, password", [("admin", "1234"), ("admin", "123456"), ("Admin", "12345"),
                                            ("root", "12345"), ("", ""), ("admin", "")])
async def test_wrong_credentials_are_rejected(client, signin_on, user, password):
    r = await sign_in(client, user, password)
    assert r.status_code == 401
    assert r.json()["detail"] == "Wrong username or password"
    assert auth.COOKIE_NAME not in r.cookies


async def test_logout_clears_the_cookie(client, signin_on):
    await sign_in(client)
    r = await client.post(LOGOUT)
    assert r.status_code == 204
    assert f'{auth.COOKIE_NAME}=""' in r.headers["set-cookie"] or "Max-Age=0" in r.headers["set-cookie"]
    assert (await client.get(PROPS)).status_code == 401


async def test_forged_cookie_is_rejected(client, signin_on):
    good = auth.make_session("admin")
    body, sig = good.rsplit(".", 1)
    client.cookies.set(auth.COOKIE_NAME, f"{body}.{'0' * len(sig)}")
    assert (await client.get(PROPS)).status_code == 401


async def test_changing_the_password_signs_everyone_out(client, signin_on, monkeypatch):
    await sign_in(client)
    monkeypatch.setattr(signin_on, "app_password", "new-pass")
    assert (await client.get(PROPS)).status_code == 401


# ---------- Basic credentials (phone app, scripts) ----------

async def test_basic_credentials_open_the_api(client, signin_on):
    assert (await client.get(PROPS, headers=basic("admin", "12345"))).status_code == 200


@pytest.mark.parametrize("header", [basic("admin", "nope"), {"Authorization": "Basic !!!"},
                                    {"Authorization": "Bearer abc"}, {"Authorization": "Basic " + base64.b64encode(b"admin").decode()}])
async def test_bad_basic_credentials_are_rejected(client, signin_on, header):
    assert (await client.get(PROPS, headers=header)).status_code == 401


# ---------- lockout ----------

async def test_too_many_failures_lock_out_for_a_while(client, signin_on):
    for _ in range(auth.MAX_FAILURES):
        assert (await sign_in(client, password="bad")).status_code == 401
    r = await sign_in(client)  # right password, but locked
    assert r.status_code == 429
    assert "Too many attempts" in r.json()["detail"]


async def test_success_resets_the_failure_count(client, signin_on):
    for _ in range(auth.MAX_FAILURES - 1):
        await sign_in(client, password="bad")
    assert (await sign_in(client)).status_code == 200
    for _ in range(auth.MAX_FAILURES - 1):
        await sign_in(client, password="bad")
    assert (await sign_in(client)).status_code == 200


# ---------- token helpers ----------

def test_session_round_trip(signin_on):
    assert auth.read_session(auth.make_session("admin")) == "admin"


def test_session_expires(signin_on):
    old = auth.make_session("admin", now=time.time() - auth.SESSION_SECONDS - 10)
    assert auth.read_session(old) is None


def test_session_for_another_username_is_rejected(signin_on):
    assert auth.read_session(auth.make_session("mallory")) is None


@pytest.mark.parametrize("token", [None, "", "nodot", ".", "abc.def", "!!!.123", auth.COOKIE_NAME])
def test_garbage_tokens_are_rejected(signin_on, token):
    assert auth.read_session(token) is None


def test_failures_expire_after_the_window(signin_on):
    for i in range(auth.MAX_FAILURES):
        auth.record_failure("1.2.3.4", now=100.0 + i)
    assert auth.too_many_failures("1.2.3.4", now=110.0)
    assert not auth.too_many_failures("1.2.3.4", now=100.0 + auth.FAILURE_WINDOW_S + auth.MAX_FAILURES + 1)


def test_failures_are_per_client(signin_on):
    for _ in range(auth.MAX_FAILURES):
        auth.record_failure("a")
    assert auth.too_many_failures("a")
    assert not auth.too_many_failures("b")


def test_check_credentials_needs_a_password_configured(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "app_password", "")
    assert auth.check_credentials("admin", "") is False
