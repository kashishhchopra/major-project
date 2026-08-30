"""Tourist profile, tamper-proof digital ID hash-chain, and location pings."""
from datetime import datetime

from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.crypto import EncryptedString
from app.core.time import utc_now
from app.db.session import Base


class Tourist(Base):
    __tablename__ = "tourists"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    digital_id: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)

    # KYC
    full_name: Mapped[str] = mapped_column(String, nullable=False)
    nationality: Mapped[str] = mapped_column(String, default="Indian")
    document_type: Mapped[str] = mapped_column(String, default="aadhaar")  # aadhaar / passport
    # Encrypted at rest -- see app/core/crypto.py. Reads return plaintext.
    document_number: Mapped[str] = mapped_column(EncryptedString, nullable=False)
    phone: Mapped[str] = mapped_column(String, nullable=False)

    # Trip
    itinerary: Mapped[str] = mapped_column(Text, default="[]")  # JSON list of {name,lat,lng}
    emergency_contacts: Mapped[str] = mapped_column(Text, default="[]")  # JSON list
    trip_start: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    trip_end: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    # Live state
    last_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    safety_score: Mapped[float] = mapped_column(Float, default=100.0)
    tracking_enabled: Mapped[bool] = mapped_column(default=True)
    status: Mapped[str] = mapped_column(String, default="active")  # active / sos / missing

    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=utc_now
    )

    id_blocks: Mapped[list["IdBlock"]] = relationship(
        back_populates="tourist", cascade="all, delete-orphan"
    )

    @property
    def is_valid(self) -> bool:
        """Digital ID validity is tied to trip duration."""
        now = utc_now()
        return self.trip_start <= now <= self.trip_end


class IdBlock(Base):
    """A block in the tamper-proof SHA-256 hash chain for a tourist's ID record."""

    __tablename__ = "id_blocks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tourist_id: Mapped[int] = mapped_column(ForeignKey("tourists.id"), index=True)
    index: Mapped[int] = mapped_column(Integer, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime, default=utc_now
    )
    event: Mapped[str] = mapped_column(String, nullable=False)  # e.g. "ID_ISSUED"
    data: Mapped[str] = mapped_column(Text, default="{}")  # JSON payload
    previous_hash: Mapped[str] = mapped_column(String, nullable=False)
    hash: Mapped[str] = mapped_column(String, nullable=False)
    # The exact timestamp string that went into the hash. `timestamp` is a
    # DateTime column and does not round-trip byte-identically through every
    # backend, so verification would drift; this stores what was actually hashed.
    hashed_at: Mapped[str] = mapped_column(String, default="", nullable=False)

    tourist: Mapped["Tourist"] = relationship(back_populates="id_blocks")


class LocationPing(Base):
    """Historical GPS ping stream used by anomaly detection."""

    __tablename__ = "location_pings"
    # Every single ping looks up that tourist's most recent previous ping to
    # derive distance/time deltas. Without this composite index that query is a
    # table scan filtered by tourist_id, which degrades linearly as pings pile up.
    __table_args__ = (
        Index("ix_location_pings_tourist_timestamp", "tourist_id", "timestamp"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tourist_id: Mapped[int] = mapped_column(ForeignKey("tourists.id"), index=True)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    speed_kmh: Mapped[float] = mapped_column(Float, default=0.0)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime, default=utc_now, index=True
    )
    anomaly_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_anomaly: Mapped[bool] = mapped_column(default=False)
