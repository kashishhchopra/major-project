"""Real-time alerts pushed to tourists and the dashboard."""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import utc_now
from app.db.session import Base


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tourist_id: Mapped[int | None] = mapped_column(ForeignKey("tourists.id"), index=True)
    # type: geofence / anomaly / sos / route_deviation / inactivity
    type: Mapped[str] = mapped_column(String, nullable=False)
    # Set for geofence alerts. Analytics previously attributed alerts to zones by
    # substring-matching the message text, which broke on overlapping zone names.
    zone_id: Mapped[int | None] = mapped_column(
        ForeignKey("zones.id"), nullable=True, index=True
    )
    severity: Mapped[str] = mapped_column(String, default="medium")  # low/medium/high/critical
    message: Mapped[str] = mapped_column(Text, nullable=False)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    acknowledged: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=utc_now, index=True
    )
