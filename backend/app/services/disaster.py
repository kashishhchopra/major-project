"""Disaster & Weather Alert Feeds: area-level hazard advisories (flood,
landslide, earthquake, storm), distinct from the per-tourist weather-risk
factor in services/weather.py.

Same "mock-compatible interface, graceful fallback" shape as weather.py: a
real feed would live behind `_fetch_real_feed()` (gated on a configured
provider/key), and everything else -- persistence, zone matching, tourist
notification -- is unchanged whether the advisory came from a real source or
the deterministic simulator. No public disaster-advisory API is assumed
available here, so the simulator is what actually runs; it is seeded per
zone+day so results are stable within a day (not random noise on every
tick) while still varying zone to zone.
"""
from __future__ import annotations

import hashlib
from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logging import get_logger
from app.core.time import utc_now
from app.models.disaster import DisasterAdvisory
from app.models.tourist import Tourist
from app.models.zone import Zone
from app.services.geo import zones_containing_point

logger = get_logger(__name__)

_HAZARDS_BY_RISK = {
    "restricted": ["flood", "landslide", "earthquake"],
    "high": ["landslide", "storm", "flood"],
    "medium": ["storm"],
    "low": [],
}
_SEVERITY_FOR_ZONE_RISK = {"restricted": "critical", "high": "high", "medium": "medium", "low": "low"}

_MESSAGES = {
    "flood": "Flash flood advisory in effect. Avoid riverbanks and low-lying areas.",
    "landslide": "Landslide risk elevated after recent rainfall. Avoid steep/unstable slopes.",
    "earthquake": "Regional seismic activity advisory. Know your nearest open ground.",
    "storm": "Severe storm warning. Seek sturdy shelter and avoid open areas.",
}


def _daily_seed(zone_id: int, hazard: str) -> int:
    """Deterministic per (zone, hazard, day) seed -- stable through a day's
    demo, changes tomorrow, never random noise on every tick."""
    key = f"{zone_id}:{hazard}:{utc_now().date().isoformat()}"
    return int(hashlib.sha256(key.encode()).hexdigest()[:8], 16)


def _fetch_real_feed() -> None:
    """Placeholder for a real provider integration (e.g. a national disaster
    management API). Not implemented -- no such provider/key is assumed
    configured for this project; see module docstring."""
    return None


def simulate_advisories(zones: list[Zone]) -> list[dict]:
    """One candidate advisory per (zone, plausible hazard for that zone's
    risk level) that "fires" today, deterministically."""
    out = []
    for zone in zones:
        for hazard in _HAZARDS_BY_RISK.get(zone.risk_level, []):
            # ~1-in-4 chance per hazard per zone per day -- infrequent enough
            # that a demo doesn't drown in advisories, frequent enough that
            # one reliably fires within a session.
            if _daily_seed(zone.id, hazard) % 4 != 0:
                continue
            out.append({
                "zone_id": zone.id,
                "hazard_type": hazard,
                "severity": _SEVERITY_FOR_ZONE_RISK.get(zone.risk_level, "medium"),
                "message": _MESSAGES[hazard],
                "source": "simulated",
            })
    return out


def tick_disaster_feed(db: Session) -> dict[str, list[int]]:
    """Refresh advisories: expire ones no longer indicated, create new ones,
    and alert every tourist currently inside a newly-active advisory's zone.
    Runs on the same scheduler as check-ins/escalation (see app/main.py).
    """
    from app.services.monitoring import _create_alert  # local import: avoid a top-level cycle

    if settings.DISASTER_FEED_PROVIDER:
        _fetch_real_feed()  # no-op placeholder; falls through to the simulator below

    zones = db.query(Zone).all()
    candidates = simulate_advisories(zones)
    candidate_keys = {(c["zone_id"], c["hazard_type"]) for c in candidates}

    active = db.query(DisasterAdvisory).filter(DisasterAdvisory.active.is_(True)).all()
    active_keys = {(a.zone_id, a.hazard_type) for a in active}

    expired: list[int] = []
    for a in active:
        if (a.zone_id, a.hazard_type) not in candidate_keys:
            a.active = False
            expired.append(a.id)

    created: list[int] = []
    tourists = db.query(Tourist).filter(
        Tourist.last_lat.isnot(None), Tourist.last_lng.isnot(None),
    ).all()
    for c in candidates:
        if (c["zone_id"], c["hazard_type"]) in active_keys:
            continue  # already active, nothing to do
        advisory = DisasterAdvisory(
            zone_id=c["zone_id"], hazard_type=c["hazard_type"], severity=c["severity"],
            message=c["message"], source=c["source"],
            expires_at=utc_now() + timedelta(hours=6),
        )
        db.add(advisory)
        db.flush()
        created.append(advisory.id)

        zone = next(z for z in zones if z.id == c["zone_id"])
        affected = [t for t in tourists if zones_containing_point(t.last_lat, t.last_lng, [zone])]
        for t in affected:
            _create_alert(
                db, t.id, "disaster", c["severity"],
                f"⚠ {c['hazard_type'].title()} advisory for {zone.name}: {c['message']}",
                t.last_lat, t.last_lng, zone_id=zone.id,
            )
        logger.warning("disaster_advisory_issued", zone_id=zone.id, hazard=c["hazard_type"],
                       tourists_notified=len(affected))

    if created or expired:
        db.commit()
    return {"created": created, "expired": expired}


def active_advisories_for_tourist(db: Session, tourist: Tourist) -> list[DisasterAdvisory]:
    if tourist.last_lat is None:
        return []
    zones = db.query(Zone).all()
    inside = zones_containing_point(tourist.last_lat, tourist.last_lng, zones)
    zone_ids = [z.id for z in inside]
    if not zone_ids:
        return []
    return (
        db.query(DisasterAdvisory)
        .filter(DisasterAdvisory.zone_id.in_(zone_ids), DisasterAdvisory.active.is_(True))
        .all()
    )
