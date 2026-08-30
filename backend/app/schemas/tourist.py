from datetime import datetime

from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.security import validate_password_strength

LAT = Field(..., ge=-90, le=90)
LNG = Field(..., ge=-180, le=180)


class Waypoint(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    lat: float = LAT
    lng: float = LNG


class EmergencyContact(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    phone: str = Field(..., min_length=3, max_length=30)
    relation: str = Field("family", max_length=40)


class TouristCreate(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=120)
    nationality: str = Field("Indian", max_length=60)
    document_type: str = Field("aadhaar", max_length=20)
    document_number: str = Field(..., min_length=4, max_length=40)
    phone: str = Field(..., min_length=3, max_length=30)
    itinerary: list[Waypoint] = Field(default_factory=list, max_length=50)
    emergency_contacts: list[EmergencyContact] = Field(default_factory=list, max_length=10)
    trip_start: datetime
    trip_end: datetime
    # optional login creds; if provided a tourist user account is created
    password: str | None = Field(None, max_length=128)
    email: str | None = Field(None, max_length=254)

    @field_validator("document_type")
    @classmethod
    def _doc_type(cls, v: str) -> str:
        if v.lower() not in ("aadhaar", "passport", "voterid", "pan"):
            raise ValueError("document_type must be one of aadhaar, passport, voterid, pan")
        return v.lower()

    @model_validator(mode="after")
    def _checks(self) -> "TouristCreate":
        if self.trip_end <= self.trip_start:
            raise ValueError("trip_end must be after trip_start")
        if (self.email and not self.password) or (self.password and not self.email):
            raise ValueError("Provide both email and password to create a login, or neither.")
        if self.password:
            validate_password_strength(self.password)
        return self


class TouristOut(BaseModel):
    id: int
    digital_id: str
    full_name: str
    nationality: str
    document_type: str
    document_number: str
    phone: str
    itinerary: list[Waypoint]
    emergency_contacts: list[EmergencyContact]
    trip_start: datetime
    trip_end: datetime
    last_lat: float | None
    last_lng: float | None
    last_seen: datetime | None
    safety_score: float
    tracking_enabled: bool
    status: str
    is_valid: bool

    class Config:
        from_attributes = True


class LocationUpdate(BaseModel):
    lat: float = LAT
    lng: float = LNG
    speed_kmh: float = Field(0.0, ge=0, le=1200)


class SafetyScoreOut(BaseModel):
    tourist_id: int
    score: float
    band: str
    breakdown: dict


class IdBlockOut(BaseModel):
    index: int
    timestamp: datetime
    event: str
    data: str
    previous_hash: str
    hash: str

    class Config:
        from_attributes = True
