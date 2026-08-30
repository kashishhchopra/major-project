"""Import all models so SQLAlchemy's metadata registers them."""
from app.models.alert import Alert
from app.models.audit import AuditLog
from app.models.device import Device
from app.models.efir import EFIR
from app.models.incident import Incident, IncidentEvent
from app.models.password_reset import PasswordResetToken
from app.models.police import PoliceUnit
from app.models.revoked_token import RevokedToken
from app.models.tourist import IdBlock, LocationPing, Tourist
from app.models.user import User
from app.models.zone import Zone

__all__ = [
    "User",
    "Tourist",
    "IdBlock",
    "LocationPing",
    "Zone",
    "Incident",
    "IncidentEvent",
    "Alert",
    "PoliceUnit",
    "PasswordResetToken",
    "RevokedToken",
    "AuditLog",
    "Device",
    "EFIR",
]
