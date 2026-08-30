from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import (
    get_current_user,
    require_admin,
    require_admin_or_responder,
    require_self_or_admin,
)
from app.core.pagination import PageParams
from app.core.time import utc_now
from app.db.session import get_db
from app.models.alert import Alert
from app.models.audit import AuditLog
from app.models.efir import EFIR
from app.models.incident import Incident, IncidentEvent
from app.models.police import PoliceUnit
from app.models.tourist import Tourist
from app.models.user import User
from app.schemas.incident import (
    AlertOut,
    DispatchCandidateOut,
    EFIROut,
    IncidentOut,
    IncidentStatusUpdate,
    PoliceUnitOut,
    SOSRequest,
)
from app.services import audit, dispatch
from app.services.efir import file_efir, generate_efir
from app.services.efir_pdf import render_efir_pdf
from app.services.monitoring import trigger_sos

router = APIRouter(tags=["incidents"])

_NEXT = {"detected": "acknowledged", "acknowledged": "dispatched", "dispatched": "resolved"}


# ---------------- alerts ----------------
@router.get("/alerts", response_model=list[AlertOut])
def list_alerts(limit: int = 100, only_active: bool = False,
                db: Session = Depends(get_db), _: User = Depends(require_admin)):
    q = db.query(Alert)
    if only_active:
        q = q.filter(Alert.acknowledged == False)  # noqa: E712
    return q.order_by(Alert.created_at.desc()).limit(limit).all()


@router.post("/alerts/{alert_id}/ack")
def ack_alert(alert_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    a = db.get(Alert, alert_id)
    if not a:
        raise HTTPException(status_code=404, detail="Alert not found")
    a.acknowledged = True
    db.commit()
    return {"id": alert_id, "acknowledged": True}


# ---------------- SOS ----------------
@router.post("/tourists/{tourist_id}/sos")
def sos(tourist_id: int, payload: SOSRequest, request: Request,
        db: Session = Depends(get_db), user: User = Depends(require_self_or_admin)):
    t = db.get(Tourist, tourist_id)
    if not t:
        raise HTTPException(status_code=404, detail="Tourist not found")
    result = trigger_sos(db, t, payload.lat, payload.lng, payload.message)
    audit.record(db, "sos", actor=user.email, target=t.digital_id,
                 detail=payload.message, request=request)
    return result


# ---------------- incidents ----------------
@router.get("/incidents", response_model=list[IncidentOut])
def list_incidents(response: Response, status: str | None = None,
                   page: PageParams = Depends(), db: Session = Depends(get_db),
                   _: User = Depends(require_admin)):
    q = db.query(Incident)
    if status:
        q = q.filter(Incident.status == status)
    response.headers["X-Total-Count"] = str(q.with_entities(func.count(Incident.id)).scalar())
    return page.apply(q.order_by(Incident.detected_at.desc())).all()


@router.get("/incidents/mine", response_model=list[IncidentOut])
def list_my_incidents(response: Response, page: PageParams = Depends(),
                      db: Session = Depends(get_db),
                      user: User = Depends(require_admin_or_responder)):
    """A responder's own worklist: incidents assigned to the unit they represent.

    Admins hit this too (they can access everything else already) but with no
    `unit_id` they'd see nothing useful -- this route exists for responders.
    """
    q = db.query(Incident).filter(Incident.assigned_unit_id == user.unit_id)
    response.headers["X-Total-Count"] = str(q.with_entities(func.count(Incident.id)).scalar())
    return page.apply(q.order_by(Incident.detected_at.desc())).all()


def _get_incident_or_404(incident_id: int, db: Session) -> Incident:
    inc = db.get(Incident, incident_id)
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")
    return inc


@router.get("/incidents/{incident_id}", response_model=IncidentOut)
def get_incident(incident_id: int, db: Session = Depends(get_db),
                 _: User = Depends(require_admin)):
    return _get_incident_or_404(incident_id, db)


@router.get("/incidents/{incident_id}/dispatch-candidates",
           response_model=list[DispatchCandidateOut])
def dispatch_candidates(incident_id: int, db: Session = Depends(get_db),
                        _: User = Depends(require_admin_or_responder)):
    """Full ranked unit list for an incident -- top pick plus backups."""
    inc = _get_incident_or_404(incident_id, db)
    if inc.lat is None or inc.lng is None:
        return []
    return dispatch.rank_units(db, inc.lat, inc.lng)


def _assert_can_update(inc: Incident, user: User) -> None:
    if user.role == "admin":
        return
    is_assigned_responder = (
        user.role == "responder"
        and user.unit_id is not None
        and inc.assigned_unit_id == user.unit_id
    )
    if is_assigned_responder:
        return
    raise HTTPException(status_code=403, detail="Forbidden")


@router.patch("/incidents/{incident_id}", response_model=IncidentOut)
def update_incident(incident_id: int, payload: IncidentStatusUpdate,
                    db: Session = Depends(get_db),
                    user: User = Depends(require_admin_or_responder)):
    inc = _get_incident_or_404(incident_id, db)
    _assert_can_update(inc, user)
    now = utc_now()
    inc.status = payload.status
    if payload.status == "acknowledged":
        inc.acknowledged_at = now
    elif payload.status == "dispatched":
        inc.dispatched_at = now
    elif payload.status == "resolved":
        inc.resolved_at = now
        if inc.tourist_id:
            t = db.get(Tourist, inc.tourist_id)
            if t and t.status == "sos":
                t.status = "active"
    db.add(IncidentEvent(incident_id=inc.id, status=payload.status, note=payload.note))
    db.commit()
    db.refresh(inc)
    return inc


@router.post("/incidents/{incident_id}/acknowledge", response_model=IncidentOut)
def acknowledge_incident(incident_id: int, db: Session = Depends(get_db),
                         user: User = Depends(require_admin_or_responder)):
    """Human acknowledgement: stops the escalation clock (see services/escalation.py)."""
    inc = _get_incident_or_404(incident_id, db)
    _assert_can_update(inc, user)
    inc.escalation_stage = "acknowledged"
    inc.escalation_deadline = None
    if inc.status == "detected":
        inc.status = "acknowledged"
        inc.acknowledged_at = utc_now()
    db.add(IncidentEvent(incident_id=inc.id, status="acknowledged",
                         note=f"Acknowledged by {user.email}"))
    db.commit()
    db.refresh(inc)
    return inc


@router.get("/incidents/{incident_id}/efir")
def incident_efir(incident_id: int, db: Session = Depends(get_db),
                  _: User = Depends(require_admin)):
    inc = db.get(Incident, incident_id)
    if not inc or not inc.tourist_id:
        raise HTTPException(status_code=404, detail="Incident/tourist not found")
    t = db.get(Tourist, inc.tourist_id)
    return generate_efir(db, t)


@router.post("/tourists/{tourist_id}/mark-missing")
def mark_missing(tourist_id: int, request: Request, db: Session = Depends(get_db),
                 user: User = Depends(require_admin)):
    t = db.get(Tourist, tourist_id)
    if not t:
        raise HTTPException(status_code=404, detail="Tourist not found")
    t.status = "missing"
    audit.record(db, "mark_missing", actor=user.email, target=t.digital_id, request=request)
    inc = Incident(tourist_id=t.id, type="missing_person", severity="critical",
                   status="detected", description=f"{t.full_name} reported missing",
                   lat=t.last_lat, lng=t.last_lng)
    db.add(inc)
    db.flush()
    db.add(IncidentEvent(incident_id=inc.id, status="detected", note="Marked missing"))
    db.flush()

    efir = file_efir(db, inc, t)
    db.commit()
    return {"tourist_id": tourist_id, "status": "missing", "incident_id": inc.id,
            "efir": generate_efir(db, t), "efir_id": efir.id, "fir_number": efir.fir_number}


# ---------------- filed E-FIRs ----------------
@router.get("/efirs", response_model=list[EFIROut])
def list_efirs(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return db.query(EFIR).order_by(EFIR.filed_at.desc()).all()


def _get_efir_or_404(efir_id: int, db: Session) -> EFIR:
    # Looked up by numeric id, not fir_number: the human-readable FIR number
    # contains slashes ("EFIR/2026/00001-4"), which do not round-trip through a
    # URL path segment without percent-encoding gymnastics.
    efir = db.get(EFIR, efir_id)
    if not efir:
        raise HTTPException(status_code=404, detail="EFIR not found")
    return efir


@router.get("/efirs/{efir_id}", response_model=EFIROut)
def get_efir(efir_id: int, db: Session = Depends(get_db),
            _: User = Depends(require_admin)):
    return _get_efir_or_404(efir_id, db)


@router.get("/efirs/{efir_id}/pdf")
def get_efir_pdf(efir_id: int, db: Session = Depends(get_db),
                 _: User = Depends(require_admin)):
    efir = _get_efir_or_404(efir_id, db)
    tourist = db.get(Tourist, efir.tourist_id)
    pdf_bytes = render_efir_pdf(efir, tourist)
    filename = f"{efir.fir_number.replace('/', '-')}.pdf"
    return Response(
        content=pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.post("/efirs/{efir_id}/close", response_model=EFIROut)
def close_efir(efir_id: int, db: Session = Depends(get_db),
               user: User = Depends(require_admin)):
    efir = _get_efir_or_404(efir_id, db)
    if efir.status == "closed":
        raise HTTPException(status_code=400, detail="EFIR already closed")
    efir.status = "closed"
    efir.closed_at = utc_now()
    audit.record(db, "close_efir", actor=user.email, target=efir.fir_number)
    db.commit()
    db.refresh(efir)
    return efir



# ---------------- police units ----------------
@router.get("/police-units", response_model=list[PoliceUnitOut])
def list_units(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return db.query(PoliceUnit).all()


# ---------------- audit log (admin only) ----------------
@router.get("/audit-log")
def audit_log(limit: int = 100, db: Session = Depends(get_db),
              _: User = Depends(require_admin)):
    rows = db.query(AuditLog).order_by(AuditLog.timestamp.desc()).limit(min(limit, 500)).all()
    return [
        {"timestamp": r.timestamp.isoformat(), "actor": r.actor, "action": r.action,
         "target": r.target, "ip": r.ip, "outcome": r.outcome, "detail": r.detail}
        for r in rows
    ]
