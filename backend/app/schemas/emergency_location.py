"""Schemas for SOS live-location sharing (app/api/emergency.py)."""
from datetime import datetime

from pydantic import BaseModel, Field


class EmergencyLocationUpdate(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    accuracy_m: float | None = Field(None, ge=0)
    speed_kmh: float | None = Field(None, ge=0)
    heading_deg: float | None = Field(None, ge=0, lt=360)


class EmergencyLocationPingOut(BaseModel):
    lat: float
    lng: float
    accuracy_m: float | None
    speed_kmh: float | None
    heading_deg: float | None
    timestamp: datetime
    anomaly_flag: bool
    demo: bool

    class Config:
        from_attributes = True


class EmergencyTrackOut(BaseModel):
    """Everything the police live map needs for one active emergency."""
    incident_id: int
    tourist_id: int
    tourist_name: str
    digital_id: str
    incident_type: str
    severity: str
    status: str
    live_tracking_active: bool
    station_id: int | None
    station_name: str | None
    # live | stale | offline | no_data -- see services/emergency_location.py
    location_status: str
    seconds_since_update: float | None
    latest: EmergencyLocationPingOut | None
    trail: list[EmergencyLocationPingOut]
