"""Mock police units, area stations, and CCTV assets for SOS dispatch and
the area-based police network (see services/police_network.py)."""
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import utc_now
from app.db.session import Base


class PoliceUnit(Base):
    __tablename__ = "police_units"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    station: Mapped[str] = mapped_column(String, nullable=False)
    phone: Mapped[str] = mapped_column(String, default="100")
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    available: Mapped[bool] = mapped_column(default=True)
    # unit_type: police / ambulance / rescue
    unit_type: Mapped[str] = mapped_column(String, default="police")


class PoliceStation(Base):
    """A local police station responsible for one safety zone.

    Every `Zone` is assigned to exactly one station (`zone_id`, unique). An
    SOS raised inside that zone is routed to this station -- see
    `services/police_network.py:assign_station`. Stations are otherwise all
    peers of each other: any one can hand a case to any other via
    `forward_incident`, which is what makes this a *network* rather than a
    fixed hierarchy.
    """
    __tablename__ = "police_stations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    zone_id: Mapped[int | None] = mapped_column(
        ForeignKey("zones.id"), unique=True, nullable=True
    )
    phone: Mapped[str] = mapped_column(String, default="100")
    contact_officer: Mapped[str] = mapped_column(String, default="")
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)


class Camera(Base):
    """Mock CCTV/camera asset positioned inside a zone.

    Purely a directory entry (no video feed) -- lets a responder see what
    camera coverage exists near an incident. See
    `services/police_network.py:nearby_cameras`.
    """
    __tablename__ = "cameras"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    label: Mapped[str] = mapped_column(String, nullable=False)
    zone_id: Mapped[int | None] = mapped_column(ForeignKey("zones.id"), nullable=True)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    # status: active / offline
    status: Mapped[str] = mapped_column(String, default="active")
    installed_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
