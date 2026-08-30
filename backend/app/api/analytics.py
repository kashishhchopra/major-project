"""Dashboard analytics.

Every endpoint here aggregates in SQL. The previous implementation loaded whole
tables with `.all()` and counted in Python, which is O(rows) memory per request
and degrades badly once the ping/alert tables grow.
"""
from fastapi import APIRouter, Depends
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db.session import get_db
from app.models.alert import Alert
from app.models.incident import Incident
from app.models.tourist import Tourist
from app.models.user import User
from app.models.zone import Zone

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/summary")
def summary(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    # One row of tourist aggregates instead of loading every tourist.
    t_stats = db.query(
        func.count(Tourist.id),
        func.sum(case((Tourist.status == "active", 1), else_=0)),
        func.sum(case((Tourist.status == "sos", 1), else_=0)),
        func.sum(case((Tourist.status == "missing", 1), else_=0)),
        func.avg(Tourist.safety_score),
    ).one()
    total_tourists, active, sos_active, missing, avg_score = t_stats

    i_stats = db.query(
        func.count(Incident.id),
        func.sum(case((Incident.status != "resolved", 1), else_=0)),
    ).one()
    total_incidents, open_incidents = i_stats

    # Average response time over resolved incidents only. `response_time_seconds`
    # is a Python property, so it cannot be used in SQL -- compute the delta here.
    resolved_deltas = db.query(Incident.detected_at, Incident.resolved_at).filter(
        Incident.resolved_at.isnot(None)
    ).all()
    avg_response = (
        sum((r - d).total_seconds() for d, r in resolved_deltas) / len(resolved_deltas)
        if resolved_deltas else 0.0
    )

    active_alerts = db.query(func.count(Alert.id)).filter(
        Alert.acknowledged.is_(False)
    ).scalar()

    return {
        "total_tourists": total_tourists or 0,
        "active_tourists": int(active or 0),
        "sos_active": int(sos_active or 0),
        "missing": int(missing or 0),
        "total_incidents": total_incidents or 0,
        "open_incidents": int(open_incidents or 0),
        "active_alerts": active_alerts or 0,
        "avg_safety_score": round(float(avg_score), 1) if avg_score is not None else 0,
        "avg_response_time_seconds": round(avg_response, 1),
        "total_zones": db.query(func.count(Zone.id)).scalar() or 0,
    }


@router.get("/alerts-by-type")
def alerts_by_type(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    rows = (
        db.query(Alert.type, func.count(Alert.id))
        .group_by(Alert.type)
        .order_by(func.count(Alert.id).desc())
        .all()
    )
    return [{"type": t, "count": c} for t, c in rows]


@router.get("/incidents-over-time")
def incidents_over_time(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    # func.date() is understood by both SQLite and PostgreSQL.
    day = func.date(Incident.detected_at)
    rows = db.query(day, func.count(Incident.id)).group_by(day).order_by(day).all()
    return [{"date": str(d), "count": c} for d, c in rows]


@router.get("/zone-risk")
def zone_risk(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """Alert counts per zone via the real foreign key.

    This used to attribute alerts by testing `zone.name in alert.message`, which
    double-counted whenever one zone's name was a substring of another's.
    """
    rows = (
        db.query(
            Zone.id, Zone.name, Zone.risk_level, Zone.crime_index,
            func.count(Alert.id).label("alert_count"),
        )
        .outerjoin(Alert, (Alert.zone_id == Zone.id) & (Alert.type == "geofence"))
        .group_by(Zone.id, Zone.name, Zone.risk_level, Zone.crime_index)
        .order_by(Zone.crime_index.desc())
        .all()
    )
    return [
        {"zone": name, "risk_level": risk, "crime_index": crime, "alert_count": count}
        for _id, name, risk, crime, count in rows
    ]


@router.get("/severity-breakdown")
def severity_breakdown(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    rows = (
        db.query(Incident.severity, func.count(Incident.id))
        .group_by(Incident.severity)
        .all()
    )
    # Stable, meaningful order for the chart rather than DB row order.
    order = {"low": 0, "medium": 1, "high": 2, "critical": 3}
    out = [{"severity": s, "count": c} for s, c in rows]
    return sorted(out, key=lambda r: order.get(r["severity"], 99))
