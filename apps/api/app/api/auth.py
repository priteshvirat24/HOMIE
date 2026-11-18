"""Sign in, sign out and "who am I" for the single HOMIE account."""

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from app.core import auth

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(BaseModel):
    username: str
    password: str


class SessionOut(BaseModel):
    username: str | None
    auth_required: bool


def _client(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def current_user(request: Request) -> str | None:
    return auth.read_session(request.cookies.get(auth.COOKIE_NAME)) or auth.read_basic(request.headers.get("authorization"))


@router.get("/me", response_model=SessionOut)
async def me(request: Request):
    """Who is signed in. 401 when sign-in is on and nobody is."""
    if not auth.enabled():
        return SessionOut(username=None, auth_required=False)
    user = current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Sign in to continue")
    return SessionOut(username=user, auth_required=True)


@router.post("/login", response_model=SessionOut)
async def login(data: LoginIn, request: Request, response: Response):
    if not auth.enabled():
        return SessionOut(username=None, auth_required=False)
    client = _client(request)
    if auth.too_many_failures(client):
        raise HTTPException(status_code=429, detail="Too many attempts. Wait a few minutes and try again")
    if not auth.check_credentials(data.username.strip(), data.password):
        auth.record_failure(client)
        raise HTTPException(status_code=401, detail="Wrong username or password")
    auth.clear_failures(client)
    response.set_cookie(
        auth.COOKIE_NAME,
        auth.make_session(data.username.strip()),
        max_age=auth.SESSION_SECONDS,
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
        path="/",
    )
    return SessionOut(username=data.username.strip(), auth_required=True)


@router.post("/logout", status_code=204)
async def logout(response: Response):
    response.delete_cookie(auth.COOKIE_NAME, path="/")
    response.status_code = 204
    return response
