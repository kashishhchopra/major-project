"""Incident lifecycle records and their event timeline."""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.time import utc_now
from app.db.session import Base


class Incident(Base):
    __tablename__ = "incidents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tourist_id: Mapped[int | None] = mapped_column(ForeignKey("tourists.id"), index=True)
    # type: sos / anomaly / geofence / missing_person
    type: Mapped[str] = mapped_column(String, nullable=False)
    severity: Mapped[str] = mapped_column(String, default="medium")
    # lifecycle: detected -> acknowledged -> dispatched -> resolved
    status: Mapped[str] = mapped_column(String, default="detected")
    description: Mapped[str] = mapped_column(Text, default="")
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    assigned_unit_id: Mapped[int | None] = mapped_column(
        ForeignKey("police_units.id"), nullable=True
    )
    # escalation_stage: control_room -> emergency_contact -> responder_dispatch
    # -> acknowledged. Advanced by app/services/escalation.py:tick_escalations()
    # whenever `escalation_deadline` passes without a human acknowledgement.
    escalation_stage: Mapped[str] = mapped_column(String, default="control_room")
    escalation_deadline: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Silent/Duress SOS: raised without any visible confirmation on the
    # tourist's screen (shake gesture, rapid trigger, or duress PIN). The
    # control room still sees it exactly like any other SOS -- this only
    # flags *how* it was raised, for the responder's situational awareness.
    silent: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")

    detected_at: Mapped[datetime] = mapped_column(
        DateTime, default=utc_now
    )
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    events: Mapped[list["IncidentEvent"]] = relationship(
        back_populates="incident", cascade="all, delete-orphan"
    )

    @property
    def response_time_seconds(self) -> float | None:
        if self.resolved_at:
            return (self.resolved_at - self.detected_at).total_seconds()
        return None


class IncidentEvent(Base):
    __tablename__ = "incident_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    incident_id: Mapped[int] = mapped_column(ForeignKey("incidents.id"), index=True)
    status: Mapped[str] = mapped_column(String, nullable=False)
    note: Mapped[str] = mapped_column(Text, default="")
    timestamp: Mapped[datetime] = mapped_column(
        DateTime, default=utc_now
    )

    incident: Mapped["Incident"] = relationship(back_populates="events")
