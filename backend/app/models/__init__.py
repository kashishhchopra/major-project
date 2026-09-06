"""Import all models so SQLAlchemy's metadata registers them."""
from app.models.alert import Alert
from app.models.anchor import ChainAnchor
from app.models.audit import AuditLog
from app.models.checkin import CheckIn
from app.models.device import Device
from app.models.disaster import DisasterAdvisory
from app.models.efir import EFIR
from app.models.guardian import TripGuardian
from app.models.incident import Incident, IncidentEvent
from app.models.itinerary import ItineraryDocument
from app.models.job_lock import JobLock
from app.models.password_reset import PasswordResetToken
from app.models.place import PointOfInterest
from app.models.police import Camera, PoliceStation, PoliceUnit
from app.models.revoked_token import RevokedToken
from app.models.tourist import IdBlock, LocationPing, Tourist
from app.models.tourist_id import TouristIdScan, TouristIdToken
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
    "PoliceStation",
    "Camera",
    "PasswordResetToken",
    "RevokedToken",
    "AuditLog",
    "Device",
    "EFIR",
    "TripGuardian",
    "CheckIn",
    "DisasterAdvisory",
    "ChainAnchor",
    "TouristIdToken",
    "TouristIdScan",
    "JobLock",
    "ItineraryDocument",
    "PointOfInterest",
]
