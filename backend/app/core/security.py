"""Password hashing, password policy, and JWT token helpers."""
from __future__ import annotations

import re
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt
from jose import JWTError, jwt

from app.core.config import settings


# ---------------------------------------------------------------- passwords
def hash_password(password: str) -> str:
    # bcrypt has a 72-byte input limit; truncate defensively.
    pw = password.encode("utf-8")[:72]
    return bcrypt.hashpw(pw, bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8")[:72], hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def validate_password_strength(password: str) -> None:
    """Raise ValueError if the password is too weak. Kept simple & explainable."""
    if len(password) < settings.MIN_PASSWORD_LENGTH:
        raise ValueError(
            f"Password must be at least {settings.MIN_PASSWORD_LENGTH} characters."
        )
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        raise ValueError("Password must contain both letters and numbers.")


# ---------------------------------------------------------------- JWT
def _issue(subject: str, role: str, tourist_id: int | None, token_type: str,
          expires_minutes: int) -> tuple[str, str, datetime]:
    """Build and sign a token. Returns (token, jti, expires_at) so the caller
    can persist the jti for revocation without decoding the token back."""
    now = datetime.now(UTC)
    expire = now + timedelta(minutes=expires_minutes)
    jti = secrets.token_urlsafe(16)
    payload: dict[str, Any] = {
        "sub": subject, "role": role, "tid": tourist_id,
        "iat": now, "nbf": now, "exp": expire, "jti": jti, "type": token_type,
    }
    token = jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return token, jti, expire


def create_access_token(subject: str, role: str, tourist_id: int | None = None,
                        expires_minutes: int | None = None) -> str:
    """Short-lived. NOT individually revocable -- it expires quickly enough
    that checking a denylist on every request isn't worth a DB round trip per
    call. Revocation lives on the refresh token instead (see create_refresh_token)."""
    token, _jti, _exp = _issue(
        subject, role, tourist_id, "access",
        expires_minutes or settings.ACCESS_TOKEN_EXPIRE_MINUTES,
    )
    return token


def create_refresh_token(subject: str, role: str,
                         tourist_id: int | None = None) -> tuple[str, str, datetime]:
    """Long-lived. Returns (token, jti, expires_at); the caller stores nothing
    for it to work (it's self-contained like any JWT) but MAY record the jti
    if it later wants to revoke this specific token (logout, rotation)."""
    return _issue(
        subject, role, tourist_id, "refresh",
        settings.REFRESH_TOKEN_EXPIRE_MINUTES,
    )


def _decode(token: str, expected_type: str) -> dict[str, Any] | None:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        return None
    if payload.get("type") != expected_type:
        return None
    return payload


def decode_access_token(token: str) -> dict[str, Any] | None:
    return _decode(token, "access")


def decode_refresh_token(token: str) -> dict[str, Any] | None:
    return _decode(token, "refresh")
