"""Disaster & Weather Alert Feeds: area-level hazard advisories (flood,
landslide, earthquake, storm) scoped to a zone, distinct from the per-tourist
weather risk factor in services/weather.py. See services/disaster.py.
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import utc_now
from app.db.session import Base


class DisasterAdvisory(Base):
    __tablename__ = "disaster_advisories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    zone_id: Mapped[int] = mapped_column(ForeignKey("zones.id"), index=True)
    # hazard_type: flood / landslide / earthquake / storm
    hazard_type: Mapped[str] = mapped_column(String, nullable=False)
    severity: Mapped[str] = mapped_column(String, default="medium")  # low/medium/high/critical
    message: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(String, default="simulated")  # simulated / real feed name
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    issued_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # CAP <identifier> for a real-feed advisory (see services/cap.py) -- lets
    # tick_disaster_feed dedupe across ticks by the provider's own id rather
    # than only (zone_id, hazard_type), which the simulator still uses.
    external_id: Mapped[str | None] = mapped_column(String, nullable=True)
    # CAP <areaDesc>, the human-readable area the provider described --
    # kept alongside the zone_id match for transparency about what the
    # source actually said vs. which local zone we mapped it onto.
    area_desc: Mapped[str | None] = mapped_column(String, nullable=True)
