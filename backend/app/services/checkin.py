"""Tourist Check-in / Check-out: a missed check-in is treated as a soft
distress signal, well before an SOS is ever pressed.

`tick_checkins` mirrors app/services/escalation.py's tick pattern: plain,
synchronous, DB-session-in/out, callable directly in tests and wrapped by a
periodic APScheduler job for the real background tick (see app/main.py).

Lifecycle: planned -> checked_in (on time, the happy path)
           planned -> missed (deadline passed, no check-in yet -- an alert
                               is raised, this is the "gentle" first stage)
           missed  -> escalated (a grace period *also* passed -- an incident
                               is opened, same severity band as other soft
                               distress signals like a route deviation)
"""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logging import get_logger
from app.core.time import utc_now
from app.models.checkin import CheckIn
from app.models.tourist import Tourist
from app.services.monitoring import _create_alert, _open_incident

logger = get_logger(__name__)


def tick_checkins(db: Session) -> dict[str, list[int]]:
    now = utc_now()
    newly_missed: list[int] = []
    newly_escalated: list[int] = []

    overdue = (
        db.query(CheckIn)
        .filter(CheckIn.status == "planned", CheckIn.expected_return_at <= now)
        .all()
    )
    for c in overdue:
        c.status = "missed"
        tourist = db.get(Tourist, c.tourist_id)
        if tourist:
            _create_alert(
                db, tourist.id, "missed_checkin", "medium",
                f"{tourist.full_name} missed their expected check-in for "
                f"\"{c.destination_name}\"",
                c.dest_lat, c.dest_lng,
            )
        newly_missed.append(c.id)
        logger.warning("checkin_missed", checkin_id=c.id, tourist_id=c.tourist_id)

    grace_cutoff = now - timedelta(minutes=settings.CHECKIN_GRACE_MINUTES)
    still_missed = (
        db.query(CheckIn)
        .filter(CheckIn.status == "missed", CheckIn.expected_return_at <= grace_cutoff)
        .all()
    )
    for c in still_missed:
        c.status = "escalated"
        tourist = db.get(Tourist, c.tourist_id)
        if tourist:
            _open_incident(
                db, tourist, "missed_checkin", "high",
                f"{tourist.full_name} has not checked in for \"{c.destination_name}\" "
                f"since {settings.CHECKIN_GRACE_MINUTES} minutes past the expected return time",
                c.dest_lat, c.dest_lng,
            )
        newly_escalated.append(c.id)
        logger.warning("checkin_escalated", checkin_id=c.id, tourist_id=c.tourist_id)

    if newly_missed or newly_escalated:
        db.commit()
    return {"missed": newly_missed, "escalated": newly_escalated}
