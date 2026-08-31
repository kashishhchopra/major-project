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

    # Foreign-tourist / visa fields -- required when document_type ==
    # "passport" (see _checks below), otherwise left None.
    visa_type: str | None = Field(None, max_length=40)
    visa_number: str | None = Field(None, max_length=40)
    visa_expiry: datetime | None = None
    passport_expiry: datetime | None = None
    planned_states: list[str] = Field(default_factory=list, max_length=40)

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

        if self.document_type == "passport":
            missing = [f for f in ("visa_type", "visa_expiry") if getattr(self, f) is None]
            if missing:
                raise ValueError(
                    f"Passport registration requires: {', '.join(missing)}"
                )
            # A visa expiring mid-trip is a real safety problem, not just a
            # data-quality nicety -- catch it at registration rather than
            # leaving the tourist to discover it while already travelling.
            if self.visa_expiry < self.trip_end:
                raise ValueError(
                    "visa_expiry must be on or after trip_end -- this visa "
                    "expires before the planned trip does"
                )
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
    preferred_language: str
    data_retention_days: int
    nationality_code: str | None = None
    visa_type: str | None = None
    visa_expiry: datetime | None = None
    passport_expiry: datetime | None = None

    class Config:
        from_attributes = True


class DuressPinSet(BaseModel):
    pin: str = Field(..., min_length=4, max_length=8, pattern=r"^\d+$")


class DuressSOSRequest(BaseModel):
    pin: str = Field(..., min_length=4, max_length=8)
    lat: float = LAT
    lng: float = LNG
    message: str = Field("SOS - emergency assistance required", max_length=500)


class PrivacySettingsUpdate(BaseModel):
    tracking_enabled: bool | None = None
    data_retention_days: int | None = Field(None, ge=1, le=365)
    preferred_language: str | None = Field(None, max_length=10)


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
