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


class CentralDashboardOut(BaseModel):
    generated_at: datetime
    stations: list[StationDashboardEntry]
    unassigned_incidents: list[int]
    total_open_incidents: int
