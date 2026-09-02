"""Area-Based Police Network: station directory, the Central Safety Dashboard,
inter-station case hand-off, and nearby-camera lookup.

See services/police_network.py for the routing/forwarding logic this thinly
wraps.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin, require_admin_or_responder
from app.db.session import get_db
from app.models.police import Camera, PoliceStation
from app.models.user import User
from app.schemas.incident import IncidentOut
from app.schemas.police_network import (
    CameraCreate,
    CameraOut,
    CentralDashboardOut,
    ForwardIncidentRequest,
    PoliceStationCreate,
    PoliceStationOut,
    StationCapacityOut,
    StationFallbackOut,
)
from app.services import audit, police_network

router = APIRouter(prefix="/police-network", tags=["police-network"])


# ---------------- station directory ----------------
@router.get("/stations", response_model=list[PoliceStationOut])
def list_stations(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.query(PoliceStation).all()


@router.post("/stations", response_model=PoliceStationOut, status_code=201)
def create_station(payload: PoliceStationCreate, db: Session = Depends(get_db),
                   _: User = Depends(require_admin)):
    if payload.zone_id is not None:
        existing = police_network.station_for_zone(db, payload.zone_id)
        if existing is not None:
            raise HTTPException(
                status_code=400,
                detail=f"Zone {payload.zone_id} is already covered by station {existing.id}",
            )
    station = PoliceStation(**payload.model_dump())
    db.add(station)
    db.commit()
    db.refresh(station)
    return station


# ---------------- Central Safety Dashboard ----------------
@router.get("/dashboard", response_model=CentralDashboardOut)
def central_dashboard(db: Session = Depends(get_db),
                      _: User = Depends(require_admin_or_responder)):
    """The shared, interconnected view every station in the network sees:
    each station's zone, its current open cases, and anything not yet
    attributed to any station."""
    return police_network.central_dashboard(db)


# ---------------- zone -> station lookup ----------------
@router.get("/zones/{zone_id}/station", response_model=PoliceStationOut)
def station_for_zone(zone_id: int, db: Session = Depends(get_db),
                     _: User = Depends(get_current_user)):
    station = police_network.station_for_zone(db, zone_id)
    if station is None:
        raise HTTPException(status_code=404, detail="No station covers this zone")
    return station


@router.get("/locate", response_model=PoliceStationOut)
def locate_station(lat: float = Query(...), lng: float = Query(...),
                   db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Which station is responsible for an arbitrary point right now --
    e.g. a tourist's live location, before any incident exists."""
    station = police_network.station_for_point(db, lat, lng)
    if station is None:
        raise HTTPException(status_code=404, detail="No station covers this location")
    return station


# ---------------- resource fallback ----------------
@router.get("/stations/{station_id}/capacity", response_model=StationCapacityOut)
def station_capacity(station_id: int, db: Session = Depends(get_db),
                     _: User = Depends(require_admin_or_responder)):
    """One station's live resource status -- open cases against the number
    it's staffed to run at once. See services/police_network.py."""
    station = db.get(PoliceStation, station_id)
    if station is None:
        raise HTTPException(status_code=404, detail="Station not found")
    return {"name": station.name, **police_network.station_capacity(db, station)}


@router.get("/fallback-preview", response_model=list[StationFallbackOut])
def fallback_preview(lat: float = Query(...), lng: float = Query(...),
                     db: Session = Depends(get_db),
                     _: User = Depends(require_admin_or_responder)):
    """The Police Station Resource Fallback order for a location: every
    station ranked by spare capacity, distance, workload and staffing --
    i.e. exactly who would take an emergency here, and who it would fall
    back to (Station A -> Station B -> Station C) if the first is
    overloaded. See services/police_network.py:rank_stations_for_point."""
    ranked = police_network.rank_stations_for_point(db, lat, lng)
    return [
        {
            "station_id": r["station_id"], "name": r["station"].name,
            "distance_km": r["distance_km"], "open_cases": r["open_cases"],
            "max_concurrent_cases": r["max_concurrent_cases"],
            "total_officers": r["total_officers"], "has_capacity": r["has_capacity"],
            "load_pct": r["load_pct"],
        }
        for r in ranked
    ]


# ---------------- inter-station hand-off ----------------
@router.post("/incidents/{incident_id}/forward", response_model=IncidentOut)
def forward_incident(incident_id: int, payload: ForwardIncidentRequest, request: Request,
                     db: Session = Depends(get_db),
                     user: User = Depends(require_admin_or_responder)):
    """Forward a case from its current station to another one in the
    network, e.g. because the tourist moved into a neighbouring zone."""
    from app.api.incidents import _get_incident_or_404

    inc = _get_incident_or_404(incident_id, db)
    try:
        police_network.forward_incident(
            db, inc, payload.to_station_id, note=payload.note, actor=user.email
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    audit.record(db, "forward_incident", actor=user.email, target=str(incident_id),
                detail=f"to_station={payload.to_station_id}", request=request)
    db.commit()
    db.refresh(inc)
    return inc


# ---------------- CCTV / camera directory ----------------
@router.get("/cameras/nearby", response_model=list[CameraOut])
def cameras_nearby(lat: float = Query(...), lng: float = Query(...),
                   radius_m: float = Query(1000, gt=0, le=20000),
                   db: Session = Depends(get_db),
                   _: User = Depends(require_admin_or_responder)):
    return police_network.nearby_cameras(db, lat, lng, radius_m)


@router.post("/cameras", response_model=CameraOut, status_code=201)
def create_camera(payload: CameraCreate, db: Session = Depends(get_db),
                  _: User = Depends(require_admin)):
    cam = Camera(**payload.model_dump())
    db.add(cam)
    db.commit()
    db.refresh(cam)
    return cam
