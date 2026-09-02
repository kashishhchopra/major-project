"""Schemas for the area-based police network endpoints (app/api/police_network.py)."""
from datetime import datetime

from pydantic import BaseModel, Field


class PoliceStationOut(BaseModel):
    id: int
    name: str
    zone_id: int | None
    phone: str
    contact_officer: str
    lat: float
    lng: float

    class Config:
        from_attributes = True


class PoliceStationCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    zone_id: int | None = None
    phone: str = "100"
    contact_officer: str = ""
    lat: float
    lng: float


class CameraOut(BaseModel):
    id: int
    label: str
    zone_id: int | None
    lat: float
    lng: float
    status: str
    distance_m: float | None = None

    class Config:
        from_attributes = True


class CameraCreate(BaseModel):
    label: str = Field(..., min_length=1, max_length=200)
    zone_id: int | None = None
    lat: float
    lng: float
    status: str = "active"


class ForwardIncidentRequest(BaseModel):
    to_station_id: int
    note: str = Field("", max_length=1000)


class StationDashboardEntry(BaseModel):
    id: int
    name: str
    phone: str
    contact_officer: str
    lat: float
    lng: float
    zone_id: int | None
    zone_name: str | None
    open_incidents: int
    critical_incidents: int
    incident_ids: list[int]
    total_officers: int
    max_concurrent_cases: int
    has_capacity: bool
    load_pct: float


class CentralDashboardOut(BaseModel):
    generated_at: datetime
    stations: list[StationDashboardEntry]
    unassigned_incidents: list[int]
    total_open_incidents: int


class StationCapacityOut(BaseModel):
    """Live resource status for one station -- Police Station Resource
    Fallback System (services/police_network.py)."""
    station_id: int
    name: str
    open_cases: int
    max_concurrent_cases: int
    total_officers: int
    has_capacity: bool
    load_pct: float


class StationFallbackOut(BaseModel):
    """One entry in the ranked fallback order for a location."""
    station_id: int
    name: str
    distance_km: float
    open_cases: int
    max_concurrent_cases: int
    total_officers: int
    has_capacity: bool
    load_pct: float
