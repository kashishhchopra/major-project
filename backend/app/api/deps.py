"""Shared FastAPI dependencies: current user resolution & role guards."""
from fastapi import Depends, Header, HTTPException, Path, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_token, verify_password
from app.db.session import get_db
from app.models.device import Device
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

_CREDS_EXC = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


def _user_from_token(token: str, db: Session) -> User:
    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        raise _CREDS_EXC
    user = db.query(User).filter(User.email == payload["sub"]).first()
    if user is None:
        raise _CREDS_EXC
    return user


def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    return _user_from_token(token, db)


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin/police access required")
    return user


def require_responder(user: User = Depends(get_current_user)) -> User:
    if user.role != "responder":
        raise HTTPException(status_code=403, detail="Responder access required")
    return user


def require_admin_or_responder(user: User = Depends(get_current_user)) -> User:
    if user.role not in ("admin", "responder"):
        raise HTTPException(status_code=403, detail="Admin or responder access required")
    return user


def require_self_or_admin(
    tourist_id: int = Path(...), user: User = Depends(get_current_user)
) -> User:
    """Allow admins, or a tourist acting only on their own record."""
    if user.role == "admin":
        return user
    if user.role == "tourist" and user.tourist_id == tourist_id:
        return user
    raise HTTPException(status_code=403, detail="Forbidden")


def require_self_admin_or_responder(
    tourist_id: int = Path(...), user: User = Depends(get_current_user)
) -> User:
    """Admins and responders (e.g. scanning a Digital Safety Passport in the
    field) see any tourist; a tourist may only act on their own record."""
    if user.role in ("admin", "responder"):
        return user
    if user.role == "tourist" and user.tourist_id == tourist_id:
        return user
    raise HTTPException(status_code=403, detail="Forbidden")


def authenticate_ws_token(token: str | None, db: Session) -> User | None:
    """Validate a token passed as a WebSocket query param. Returns None if invalid."""
    if not token:
        return None
    try:
        return _user_from_token(token, db)
    except HTTPException:
        return None


def authenticate_device(
    x_device_key: str = Header(..., alias="X-Device-Key"),
    device_id: str = Path(...),
    db: Session = Depends(get_db),
) -> Device:
    """Authenticate an IoT band by its per-device API key.

    A wearable cannot hold a user login session, so it authenticates with its
    own long-lived credential (hashed with the same bcrypt path as a user
    password) instead of a JWT.
    """
    device = db.query(Device).filter(Device.device_id == device_id).first()
    if device is None or not device.active or not verify_password(x_device_key, device.hashed_key):
        raise HTTPException(status_code=401, detail="Invalid device credentials")
    return device
