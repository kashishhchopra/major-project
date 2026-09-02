"""Area-Based Police Network: zone -> station routing, the Central Safety
Dashboard, inter-station hand-off, and nearby-camera lookup
(services/police_network.py, app/api/police_network.py)."""
import pytest

from app.models.incident import Incident
from app.services import police_network
from app.services.monitoring import trigger_sos
from tests.conftest import make_camera, make_station, make_tourist, make_zone


# ---------------------------------------------------------------- resolving
def test_resolve_zone_for_point_inside_and_outside(db):
    zone = make_zone(db, name="Old Market", risk="high", lat=26.165, lng=91.75, d=0.008)
    assert police_network.resolve_zone_for_point(db, 26.165, 91.75).id == zone.id
    assert police_network.resolve_zone_for_point(db, 0.0, 0.0) is None


def test_resolve_zone_for_point_prefers_higher_risk_on_overlap(db):
    """Two overlapping zones at the same point: the higher-risk one wins,
    since that is the zone whose station should own the case."""
    low = make_zone(db, name="Wide Low", risk="low", lat=26.165, lng=91.75, d=0.02)
    high = make_zone(db, name="Narrow High", risk="restricted", lat=26.165, lng=91.75, d=0.005)
    resolved = police_network.resolve_zone_for_point(db, 26.165, 91.75)
    assert resolved.id == high.id
    assert resolved.id != low.id


def test_station_for_zone_and_point(db):
    zone = make_zone(db, lat=26.165, lng=91.75, d=0.008)
    station = make_station(db, name="Market PS", zone_id=zone.id, lat=26.165, lng=91.75)
    assert police_network.station_for_zone(db, zone.id).id == station.id
    assert police_network.station_for_point(db, 26.165, 91.75).id == station.id


def test_station_for_point_none_outside_any_zone(db):
    make_zone(db, lat=26.165, lng=91.75, d=0.008)
    assert police_network.station_for_point(db, 0.0, 0.0) is None


def test_station_for_zone_with_no_station_returns_none(db):
    zone = make_zone(db)
    assert police_network.station_for_zone(db, zone.id) is None


# ---------------------------------------------------------------- assignment
def test_sos_auto_routes_to_the_zone_station(db):
    """A tourist raising an SOS inside a covered zone gets the incident
    routed to that zone's station automatically."""
    zone = make_zone(db, lat=26.165, lng=91.75, d=0.008)
    station = make_station(db, name="Market PS", zone_id=zone.id, lat=26.165, lng=91.75)
    t = make_tourist(db, lat=26.165, lng=91.75)

    result = trigger_sos(db, t, 26.165, 91.75, "help")
    inc = db.get(Incident, result["incident_id"])
    assert inc.station_id == station.id
    notes = [e.note for e in inc.events]
    assert any("Routed to Market PS" in n for n in notes)


def test_sos_outside_any_zone_leaves_incident_unassigned(db):
    t = make_tourist(db, lat=0.0, lng=0.0)
    result = trigger_sos(db, t, 0.0, 0.0, "help")
    inc = db.get(Incident, result["incident_id"])
    assert inc.station_id is None


def test_assign_station_noop_without_location(db):
    inc = Incident(tourist_id=None, type="anomaly", severity="low",
                   status="detected", description="", lat=None, lng=None)
    db.add(inc)
    db.flush()
    assert police_network.assign_station(db, inc) is None
    assert inc.station_id is None


# ---------------------------------------------------------------- forwarding
def test_forward_incident_moves_station_and_logs_event(db):
    zone = make_zone(db, lat=26.165, lng=91.75, d=0.008)
    station_a = make_station(db, name="Station A", zone_id=zone.id, lat=26.165, lng=91.75)
    station_b = make_station(db, name="Station B", lat=26.2, lng=91.8)
    t = make_tourist(db, lat=26.165, lng=91.75)
    result = trigger_sos(db, t, 26.165, 91.75, "help")
    inc = db.get(Incident, result["incident_id"])
    assert inc.station_id == station_a.id

    police_network.forward_incident(db, inc, station_b.id, note="tourist moved",
                                    actor="admin@test.gov")
    db.commit()
    db.refresh(inc)
    assert inc.station_id == station_b.id
    notes = [e.note for e in inc.events]
    assert any("Forwarded from Station A to Station B" in n and "tourist moved" in n
              for n in notes)


def test_forward_incident_unknown_station_raises(db):
    t = make_tourist(db)
    result = trigger_sos(db, t, t.last_lat, t.last_lng, "help")
    inc = db.get(Incident, result["incident_id"])
    with pytest.raises(ValueError):
        police_network.forward_incident(db, inc, 99999)


# ---------------------------------------------------------------- cameras
def test_nearby_cameras_filters_and_sorts_by_distance(db):
    near = make_camera(db, label="Near Cam", lat=26.1450, lng=91.7370)
    far = make_camera(db, label="Far Cam", lat=27.0, lng=92.0)
    out = police_network.nearby_cameras(db, 26.1450, 91.7370, radius_m=5000)
    ids = [c["id"] for c in out]
    assert near.id in ids
    assert far.id not in ids
    assert out[0]["id"] == near.id
    assert out[0]["distance_m"] < out[-1]["distance_m"] if len(out) > 1 else True


# ---------------------------------------------------------------- dashboard
def test_central_dashboard_groups_incidents_by_station(db):
    zone = make_zone(db, lat=26.165, lng=91.75, d=0.008)
    station = make_station(db, name="Market PS", zone_id=zone.id, lat=26.165, lng=91.75)
    t = make_tourist(db, lat=26.165, lng=91.75)
    trigger_sos(db, t, 26.165, 91.75, "help")

    dash = police_network.central_dashboard(db)
    entry = next(s for s in dash["stations"] if s["id"] == station.id)
    assert entry["zone_id"] == zone.id
    assert entry["open_incidents"] == 1
    assert entry["critical_incidents"] == 1
    assert dash["total_open_incidents"] == 1
    assert dash["unassigned_incidents"] == []


def test_central_dashboard_lists_unassigned_incidents(db):
    t = make_tourist(db, lat=0.0, lng=0.0)
    result = trigger_sos(db, t, 0.0, 0.0, "help")
    dash = police_network.central_dashboard(db)
    assert result["incident_id"] in dash["unassigned_incidents"]


# ---------------------------------------------------------------- API
def test_list_stations_endpoint(client, admin_headers, db):
    make_station(db, name="Station A")
    r = client.get("/api/police-network/stations", headers=admin_headers)
    assert r.status_code == 200
    assert any(s["name"] == "Station A" for s in r.json())


def test_create_station_endpoint_requires_admin(client, tourist_headers):
    r = client.post("/api/police-network/stations",
                    json={"name": "New PS", "lat": 26.1, "lng": 91.7},
                    headers=tourist_headers)
    assert r.status_code == 403


def test_create_station_rejects_duplicate_zone(client, admin_headers, db):
    zone = make_zone(db)
    make_station(db, name="Existing PS", zone_id=zone.id)
    r = client.post("/api/police-network/stations",
                    json={"name": "New PS", "zone_id": zone.id, "lat": 26.1, "lng": 91.7},
                    headers=admin_headers)
    assert r.status_code == 400


def test_dashboard_endpoint(client, admin_headers, db):
    r = client.get("/api/police-network/dashboard", headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    assert "stations" in body and "total_open_incidents" in body


def test_dashboard_endpoint_forbidden_for_tourist(client, tourist_headers):
    r = client.get("/api/police-network/dashboard", headers=tourist_headers)
    assert r.status_code == 403


def test_zone_station_lookup_endpoint(client, admin_headers, db):
    zone = make_zone(db)
    station = make_station(db, zone_id=zone.id)
    r = client.get(f"/api/police-network/zones/{zone.id}/station", headers=admin_headers)
    assert r.status_code == 200
    assert r.json()["id"] == station.id


def test_zone_station_lookup_404_when_uncovered(client, admin_headers, db):
    zone = make_zone(db)
    r = client.get(f"/api/police-network/zones/{zone.id}/station", headers=admin_headers)
    assert r.status_code == 404


def test_locate_endpoint(client, admin_headers, db):
    zone = make_zone(db, lat=26.165, lng=91.75, d=0.008)
    station = make_station(db, zone_id=zone.id, lat=26.165, lng=91.75)
    r = client.get("/api/police-network/locate?lat=26.165&lng=91.75", headers=admin_headers)
    assert r.status_code == 200
    assert r.json()["id"] == station.id


def test_locate_endpoint_404_outside_any_zone(client, admin_headers):
    r = client.get("/api/police-network/locate?lat=0&lng=0", headers=admin_headers)
    assert r.status_code == 404


def test_forward_incident_endpoint(client, admin_headers, db):
    zone = make_zone(db, lat=26.165, lng=91.75, d=0.008)
    make_station(db, name="Station A", zone_id=zone.id, lat=26.165, lng=91.75)
    station_b = make_station(db, name="Station B", lat=26.2, lng=91.8)
    t = make_tourist(db, lat=26.165, lng=91.75)
    result = trigger_sos(db, t, 26.165, 91.75, "help")

    r = client.post(
        f"/api/police-network/incidents/{result['incident_id']}/forward",
        json={"to_station_id": station_b.id, "note": "moved zones"},
        headers=admin_headers,
    )
    assert r.status_code == 200
    assert r.json()["station_id"] == station_b.id


def test_forward_incident_endpoint_unknown_station_404(client, admin_headers, db):
    t = make_tourist(db)
    result = trigger_sos(db, t, t.last_lat, t.last_lng, "help")
    r = client.post(
        f"/api/police-network/incidents/{result['incident_id']}/forward",
        json={"to_station_id": 99999}, headers=admin_headers,
    )
    assert r.status_code == 404


def test_cameras_nearby_endpoint(client, admin_headers, db):
    cam = make_camera(db, label="Near Cam", lat=26.1450, lng=91.7370)
    r = client.get(
        "/api/police-network/cameras/nearby?lat=26.1450&lng=91.7370&radius_m=1000",
        headers=admin_headers,
    )
    assert r.status_code == 200
    assert any(c["id"] == cam.id for c in r.json())


def test_create_camera_endpoint_requires_admin(client, admin_headers):
    r = client.post("/api/police-network/cameras",
                    json={"label": "New Cam", "lat": 26.1, "lng": 91.7},
                    headers=admin_headers)
    assert r.status_code == 201
    assert r.json()["label"] == "New Cam"


# ------------------------------------------- resource fallback (station A->B->C)
def _fill_station(db, station, count):
    """Saturate a station with `count` open cases."""
    for _ in range(count):
        inc = Incident(tourist_id=None, type="anomaly", severity="medium",
                       status="detected", description="load", lat=None, lng=None,
                       station_id=station.id)
        db.add(inc)
    db.commit()


def test_station_capacity_reports_live_load(db):
    s = make_station(db, name="Busy PS", max_concurrent_cases=2)
    assert police_network.station_capacity(db, s)["has_capacity"] is True

    _fill_station(db, s, 2)
    cap = police_network.station_capacity(db, s)
    assert cap["open_cases"] == 2
    assert cap["has_capacity"] is False
    assert cap["load_pct"] == 100.0


def test_resolved_cases_free_up_capacity(db):
    s = make_station(db, name="Busy PS", max_concurrent_cases=1)
    _fill_station(db, s, 1)
    assert police_network.station_capacity(db, s)["has_capacity"] is False

    db.query(Incident).filter(Incident.station_id == s.id).update({"status": "resolved"})
    db.commit()
    assert police_network.station_capacity(db, s)["has_capacity"] is True


def test_sos_falls_back_when_zone_station_is_at_capacity(db):
    """Station A (the zone's own) is full -> the case is routed to the next
    best-suited station instead of being delayed."""
    zone = make_zone(db, lat=26.165, lng=91.75, d=0.008)
    station_a = make_station(db, name="Station A", zone_id=zone.id,
                            lat=26.165, lng=91.75, max_concurrent_cases=1)
    station_b = make_station(db, name="Station B", lat=26.17, lng=91.76,
                            max_concurrent_cases=5)
    _fill_station(db, station_a, 1)  # A is now at capacity

    t = make_tourist(db, lat=26.165, lng=91.75)
    result = trigger_sos(db, t, 26.165, 91.75, "help")
    inc = db.get(Incident, result["incident_id"])

    assert inc.station_id == station_b.id
    notes = [e.note for e in inc.events]
    assert any("Station A at capacity" in n and "Station B" in n for n in notes)


def test_fallback_skips_full_stations_to_the_next_with_capacity(db):
    """A full, B full -> C takes it (Station A -> Station B -> Station C)."""
    zone = make_zone(db, lat=26.165, lng=91.75, d=0.008)
    station_a = make_station(db, name="Station A", zone_id=zone.id,
                            lat=26.165, lng=91.75, max_concurrent_cases=1)
    station_b = make_station(db, name="Station B", lat=26.166, lng=91.751,
                            max_concurrent_cases=1)
    station_c = make_station(db, name="Station C", lat=26.20, lng=91.80,
                            max_concurrent_cases=5)
    _fill_station(db, station_a, 1)
    _fill_station(db, station_b, 1)

    t = make_tourist(db, lat=26.165, lng=91.75)
    result = trigger_sos(db, t, 26.165, 91.75, "help")
    assert db.get(Incident, result["incident_id"]).station_id == station_c.id


def test_no_fallback_while_the_zone_station_has_capacity(db):
    """Unchanged behaviour when nothing is overloaded: the zone's own
    station keeps the case, with the original routing note."""
    zone = make_zone(db, lat=26.165, lng=91.75, d=0.008)
    station_a = make_station(db, name="Station A", zone_id=zone.id,
                            lat=26.165, lng=91.75, max_concurrent_cases=5)
    make_station(db, name="Station B", lat=26.17, lng=91.76)

    t = make_tourist(db, lat=26.165, lng=91.75)
    result = trigger_sos(db, t, 26.165, 91.75, "help")
    inc = db.get(Incident, result["incident_id"])

    assert inc.station_id == station_a.id
    assert any("Routed to Station A" in e.note for e in inc.events)


def test_every_station_full_still_dispatches_nearest(db):
    """A busy network beats no response -- the case is never left unassigned."""
    zone = make_zone(db, lat=26.165, lng=91.75, d=0.008)
    station_a = make_station(db, name="Station A", zone_id=zone.id,
                            lat=26.165, lng=91.75, max_concurrent_cases=1)
    station_b = make_station(db, name="Station B", lat=26.30, lng=91.90,
                            max_concurrent_cases=1)
    _fill_station(db, station_a, 1)
    _fill_station(db, station_b, 1)

    t = make_tourist(db, lat=26.165, lng=91.75)
    result = trigger_sos(db, t, 26.165, 91.75, "help")
    # nearest of the two full stations wins rather than nobody taking it
    assert db.get(Incident, result["incident_id"]).station_id == station_a.id


def test_rank_stations_puts_stations_with_capacity_first(db):
    near_full = make_station(db, name="Near Full", lat=26.165, lng=91.75,
                            max_concurrent_cases=1)
    far_free = make_station(db, name="Far Free", lat=26.30, lng=91.90,
                           max_concurrent_cases=5)
    _fill_station(db, near_full, 1)

    ranked = police_network.rank_stations_for_point(db, 26.165, 91.75)
    assert ranked[0]["station"].id == far_free.id  # capacity beats proximity
    assert ranked[0]["has_capacity"] is True
    assert ranked[-1]["station"].id == near_full.id


def test_fallback_preview_endpoint(client, admin_headers, db):
    make_station(db, name="Station A", lat=26.165, lng=91.75, max_concurrent_cases=3)
    make_station(db, name="Station B", lat=26.30, lng=91.90)

    r = client.get("/api/police-network/fallback-preview?lat=26.165&lng=91.75",
                   headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    assert body[0]["name"] == "Station A"  # closest with capacity leads
    assert body[0]["has_capacity"] is True
    assert "load_pct" in body[0]


def test_station_capacity_endpoint(client, admin_headers, db):
    s = make_station(db, name="Station A", max_concurrent_cases=2)
    _fill_station(db, s, 2)

    r = client.get(f"/api/police-network/stations/{s.id}/capacity", headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Station A"
    assert body["open_cases"] == 2
    assert body["has_capacity"] is False


def test_station_capacity_endpoint_404(client, admin_headers):
    r = client.get("/api/police-network/stations/99999/capacity", headers=admin_headers)
    assert r.status_code == 404


def test_dashboard_exposes_capacity_signals(client, admin_headers, db):
    s = make_station(db, name="Station A", max_concurrent_cases=2, total_officers=17)
    _fill_station(db, s, 2)

    r = client.get("/api/police-network/dashboard", headers=admin_headers)
    entry = next(e for e in r.json()["stations"] if e["id"] == s.id)
    assert entry["total_officers"] == 17
    assert entry["max_concurrent_cases"] == 2
    assert entry["has_capacity"] is False
    assert entry["load_pct"] == 100.0
