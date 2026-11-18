"""Single-account sign-in for HOMIE.

One username and password come from settings (APP_USERNAME / APP_PASSWORD). When APP_PASSWORD is empty,
sign-in is off and everything is open, which is how the test suite and a plain local setup run.

A successful sign-in sets an HttpOnly cookie holding `username|expiry` signed with HMAC-SHA256. The signing
key mixes in the password, so changing the password signs everyone out. Scripts and the phone app can send
HTTP Basic credentials instead of the cookie.
"""

import base64
import binascii
import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque

from app.core.config import get_settings

COOKIE_NAME = "homie_session"
SESSION_SECONDS = 30 * 24 * 3600

# Failed sign-ins per client: after MAX_FAILURES within FAILURE_WINDOW_S, further attempts get 429.
MAX_FAILURES = 5
FAILURE_WINDOW_S = 300

_process_secret = secrets.token_bytes(32)
_failures: dict[str, deque[float]] = defaultdict(deque)


def enabled() -> bool:
    return bool(get_settings().app_password)


def _key() -> bytes:
    s = get_settings()
    base = s.session_secret.encode() if s.session_secret else _process_secret
    return hashlib.sha256(base + b"|" + s.app_username.encode() + b"|" + s.app_password.encode()).digest()


def check_credentials(username: str, password: str) -> bool:
    s = get_settings()
    # compare both, always, so timing doesn't reveal which one was wrong
    user_ok = hmac.compare_digest(username.encode(), s.app_username.encode())
    pass_ok = hmac.compare_digest(password.encode(), s.app_password.encode())
    return user_ok and pass_ok and bool(s.app_password)


def make_session(username: str, now: float | None = None) -> str:
    expires = int((now if now is not None else time.time()) + SESSION_SECONDS)
    body = base64.urlsafe_b64encode(f"{username}|{expires}".encode()).decode().rstrip("=")
    sig = hmac.new(_key(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def read_session(token: str | None, now: float | None = None) -> str | None:
    """Return the signed-in username, or None for a missing, forged, stale or expired token."""
    if not token or "." not in token:
        return None
    body, sig = token.rsplit(".", 1)
    expected = hmac.new(_key(), body.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        username, expires = base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)).decode().rsplit("|", 1)
        if int(expires) < (now if now is not None else time.time()):
            return None
    except (ValueError, binascii.Error, UnicodeDecodeError):
        return None
    if not hmac.compare_digest(username.encode(), get_settings().app_username.encode()):
        return None
    return username


def read_basic(header: str | None) -> str | None:
    """Username from a valid `Authorization: Basic …` header."""
    if not header or not header.lower().startswith("basic "):
        return None
    try:
        username, _, password = base64.b64decode(header[6:].strip()).decode().partition(":")
    except (ValueError, binascii.Error, UnicodeDecodeError):
        return None
    return username if check_credentials(username, password) else None


def too_many_failures(client: str, now: float | None = None) -> bool:
    now = now if now is not None else time.monotonic()
    q = _failures[client]
    while q and now - q[0] > FAILURE_WINDOW_S:
        q.popleft()
    return len(q) >= MAX_FAILURES


def record_failure(client: str, now: float | None = None) -> None:
    _failures[client].append(now if now is not None else time.monotonic())


def clear_failures(client: str | None = None) -> None:
    if client is None:
        _failures.clear()
    else:
        _failures.pop(client, None)
