"""Area-Based Police Network: zone -> station routing, inter-station hand-off,
and the aggregated view that stands in for a "Central Safety Dashboard".

The model: the map is divided into safety `Zone`s (already used for risk
scoring); each zone is assigned to exactly one `PoliceStation`. An SOS/
incident opened inside a zone is auto-routed to that zone's station. Every
station can see the whole network's live incidents through
`central_dashboard`, and can hand a case to a peer station via
`forward_incident` -- e.g. because the tourist moved into another zone, or
the incident is actually closer to a neighbouring station.

    tourist location -> zone -> station  (assign_station)
                                   |
                          central dashboard (central_dashboard)
                                   |
                    station <-> station  (forward_incident)

Police Station Resource Fallback System
----------------------------------------
`assign_station` doesn't just hand every case to its zone's station
unconditionally -- it first checks that station's real-time capacity
(open-case load against `PoliceStation.max_concurrent_cases`). If the zone's
own station is at/over capacity, it automatically falls back to the next
best-suited station network-wide, ranked by distance, current workload, and
staffing (`rank_stations_for_point`) -- Station A -> Station B -> Station C
-- so an emergency is never delayed just because the nearest station is
overloaded. Every fallback hop is logged on the incident.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.time import utc_now
from app.models.incident import Incident, IncidentEvent
from app.models.police import Camera, PoliceStation
from app.models.zone import Zone
from app.services import geo


def resolve_zone_for_point(db: Session, lat: float, lng: float) -> Zone | None:
    """Which zone (if any) a point falls inside. If more than one zone
    overlaps at that point, the highest-risk zone wins -- that is the one
    whose station should own the case."""
    zones = db.query(Zone).all()
    matches = geo.zones_containing_point(lat, lng, zones)
    if not matches:
        return None
    _RANK = {"restricted": 3, "high": 2, "medium": 1, "low": 0}
    return max(matches, key=lambda z: _RANK.get(z.risk_level, 0))


def station_for_zone(db: Session, zone_id: int) -> PoliceStation | None:
    return db.query(PoliceStation).filter(PoliceStation.zone_id == zone_id).first()


def station_for_point(db: Session, lat: float, lng: float) -> PoliceStation | None:
    """The station responsible for wherever (lat, lng) currently is."""
    zone = resolve_zone_for_point(db, lat, lng)
    if zone is None:
        return None
    return station_for_zone(db, zone.id)


def _station_workload(db: Session, station_id: int) -> int:
    """Open (non-resolved) cases currently assigned to a station -- the
    live half of its capacity check."""
    return (
        db.query(Incident)
        .filter(Incident.station_id == station_id, Incident.status != "resolved")
        .count()
    )


def station_capacity(db: Session, station: PoliceStation) -> dict:
    """A station's real-time resource status: how many cases it's carrying
    against how many it's staffed to run at once."""
    open_cases = _station_workload(db, station.id)
    max_cases = station.max_concurrent_cases
    return {
        "station_id": station.id,
        "open_cases": open_cases,
        "max_concurrent_cases": max_cases,
        "total_officers": station.total_officers,
        "has_capacity": open_cases < max_cases,
        "load_pct": round(100 * open_cases / max_cases, 1) if max_cases else 100.0,
    }


def rank_stations_for_point(db: Session, lat: float, lng: float) -> list[dict]:
    """Every station in the network, ranked for how well-suited each is to
    respond to (lat, lng) right now: stations with spare capacity first,
    then closest, then least loaded, then best-staffed -- the fallback
    order Station A -> Station B -> Station C follows this list."""
    ranked = []
    for s in db.query(PoliceStation).all():
        cap = station_capacity(db, s)
        ranked.append({
            "station": s,
            "distance_km": round(geo.haversine_m(lat, lng, s.lat, s.lng) / 1000, 2),
            **cap,
        })
    ranked.sort(key=lambda r: (not r["has_capacity"], r["distance_km"], r["load_pct"], -r["total_officers"]))
    return ranked


def assign_station(db: Session, incident: Incident) -> PoliceStation | None:
    """Route a freshly-opened incident to the station responsible for its
    zone, logging the hand-off. No-op (returns None) if the incident has no
    location or falls outside every zone -- it stays with the control room.

    Resource-aware: if that zone's own station is at/over capacity, walks
    the network-wide ranking (`rank_stations_for_point`) for the next
    best-suited station with room to take the case -- see this module's
    "Police Station Resource Fallback System" docstring. If literally every
    station in the network is at capacity, the case still goes to the
    nearest one rather than sit unassigned -- a busy network beats no
    response.
    """
    if incident.lat is None or incident.lng is None:
        return None
    zone = resolve_zone_for_point(db, incident.lat, incident.lng)
    if zone is None:
        return None
    primary = station_for_zone(db, zone.id)
    if primary is None:
        return None

    ranked = rank_stations_for_point(db, incident.lat, incident.lng)
    primary_entry = next((r for r in ranked if r["station"].id == primary.id), None)

    if primary_entry is not None and primary_entry["has_capacity"]:
        chosen = primary_entry
    else:
        with_capacity = [r for r in ranked if r["has_capacity"]]
        # Every station full: still dispatch -- to the nearest one -- rather
        # than leave the incident unassigned.
        chosen = with_capacity[0] if with_capacity else ranked[0]

    station = chosen["station"]
    incident.station_id = station.id

    if station.id == primary.id:
        note = f"Routed to {station.name} (area-based police network)"
    else:
        note = (
            f"{primary.name} at capacity ({primary_entry['open_cases']}/"
            f"{primary_entry['max_concurrent_cases']} cases) -- resource fallback "
            f"routed to {station.name} ({chosen['distance_km']} km, "
            f"{chosen['open_cases']}/{chosen['max_concurrent_cases']} cases, "
            f"{chosen['total_officers']} officers)"
        )
    db.add(IncidentEvent(incident_id=incident.id, status="station_assigned", note=note))
    return station


def forward_incident(
    db: Session, incident: Incident, to_station_id: int, note: str = "", actor: str = ""
) -> PoliceStation:
    """Hand an incident from its current station to another one in the
    network -- e.g. the tourist crossed into a neighbouring zone, or the
    receiving station is simply better placed to respond."""
    to_station = db.get(PoliceStation, to_station_id)
    if to_station is None:
        raise ValueError(f"No such station: {to_station_id}")

    from_station = db.get(PoliceStation, incident.station_id) if incident.station_id else None
    from_name = from_station.name if from_station else "control room"
    incident.station_id = to_station.id
    detail = f"Forwarded from {from_name} to {to_station.name}"
    if note:
        detail += f": {note}"
    if actor:
        detail += f" (by {actor})"
    db.add(IncidentEvent(incident_id=incident.id, status="forwarded", note=detail))
    return to_station


def nearby_cameras(db: Session, lat: float, lng: float, radius_m: float = 1000) -> list[dict]:
    """Cameras within `radius_m` metres of a point, nearest first -- "nearby
    CCTV/camera information" for a responder looking at an incident."""
    cams = db.query(Camera).all()
    out = []
    for c in cams:
        dist = geo.haversine_m(lat, lng, c.lat, c.lng)
        if dist <= radius_m:
            out.append({
                "id": c.id, "label": c.label, "zone_id": c.zone_id,
                "lat": c.lat, "lng": c.lng, "status": c.status,
                "distance_m": round(dist, 1),
            })
    out.sort(key=lambda c: c["distance_m"])
    return out


def central_dashboard(db: Session) -> dict:
    """The interconnected network's shared view: every station, the zone it
    covers, and its current open-case load -- the "Central Safety Dashboard"
    every station in the network sees."""
    stations = db.query(PoliceStation).all()
    zones_by_id = {z.id: z for z in db.query(Zone).all()}
    open_incidents = (
        db.query(Incident).filter(Incident.status != "resolved").all()
    )
    by_station: dict[int, list[Incident]] = {}
    unassigned: list[Incident] = []
    for inc in open_incidents:
        if inc.station_id is not None:
            by_station.setdefault(inc.station_id, []).append(inc)
        else:
            unassigned.append(inc)

    stations_out = []
    for s in stations:
        zone = zones_by_id.get(s.zone_id) if s.zone_id else None
        cases = by_station.get(s.id, [])
        max_cases = s.max_concurrent_cases
        stations_out.append({
            "id": s.id, "name": s.name, "phone": s.phone,
            "contact_officer": s.contact_officer, "lat": s.lat, "lng": s.lng,
            "zone_id": s.zone_id, "zone_name": zone.name if zone else None,
            "open_incidents": len(cases),
            "critical_incidents": sum(1 for i in cases if i.severity == "critical"),
            "incident_ids": [i.id for i in cases],
            # Resource-fallback signals (see rank_stations_for_point): a
            # station at capacity is one an incoming case gets routed around.
            "total_officers": s.total_officers,
            "max_concurrent_cases": max_cases,
            "has_capacity": len(cases) < max_cases,
            "load_pct": round(100 * len(cases) / max_cases, 1) if max_cases else 100.0,
        })

    return {
        "generated_at": utc_now(),
        "stations": stations_out,
        "unassigned_incidents": [i.id for i in unassigned],
        "total_open_incidents": len(open_incidents),
    }
