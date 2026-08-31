"""Disaster & Weather Alert Feeds (services/disaster.py)."""
from app.models.alert import Alert
from app.models.disaster import DisasterAdvisory
from app.services.disaster import (
    _daily_seed,
    simulate_advisories,
    tick_disaster_feed,
)
from tests.conftest import make_tourist, make_zone


def test_daily_seed_is_deterministic():
    assert _daily_seed(1, "flood") == _daily_seed(1, "flood")


def test_simulate_advisories_only_for_hazard_prone_zones(db):
    low = make_zone(db, name="Calm Park", risk="low")
    restricted = make_zone(db, name="Danger Zone", risk="restricted", lat=27.0, lng=92.0)
    candidates = simulate_advisories([low, restricted])
    assert all(c["zone_id"] != low.id for c in candidates)


def test_tick_disaster_feed_creates_and_notifies(db, monkeypatch):
    zone = make_zone(db, name="Flood Prone", risk="restricted", lat=26.165, lng=91.75, d=0.02)
    t = make_tourist(db, lat=26.165, lng=91.75)  # inside the zone

    # Force a deterministic "always fires" seed so this test isn't at the
    # mercy of the daily hash landing on the wrong bucket.
    monkeypatch.setattr("app.services.disaster._daily_seed", lambda zone_id, hazard: 0)

    result = tick_disaster_feed(db)
    assert result["created"]
    advisory = db.get(DisasterAdvisory, result["created"][0])
    assert advisory.zone_id == zone.id
    assert advisory.active is True

    alert = db.query(Alert).filter(Alert.type == "disaster", Alert.tourist_id == t.id).first()
    assert alert is not None


def test_tick_disaster_feed_expires_no_longer_indicated(db, monkeypatch):
    zone = make_zone(db, name="Was Flood Prone", risk="restricted", lat=26.165, lng=91.75, d=0.02)
    db.add(DisasterAdvisory(zone_id=zone.id, hazard_type="flood", severity="critical",
                            message="old", active=True))
    db.commit()

    # Nothing simulates as active now.
    monkeypatch.setattr("app.services.disaster.simulate_advisories", lambda zones: [])
    result = tick_disaster_feed(db)
    assert result["expired"]


def test_active_advisories_for_tourist(db):
    from app.services.disaster import active_advisories_for_tourist
    zone = make_zone(db, name="Hazard Zone", risk="restricted", lat=26.165, lng=91.75, d=0.02)
    db.add(DisasterAdvisory(zone_id=zone.id, hazard_type="earthquake", severity="high",
                            message="shake", active=True))
    db.commit()
    t = make_tourist(db, lat=26.165, lng=91.75)

    advisories = active_advisories_for_tourist(db, t)
    assert len(advisories) == 1
    assert advisories[0].hazard_type == "earthquake"


# ---------------------------------------------------------------- endpoints
def test_list_disasters_endpoint(client, admin_headers, db):
    zone = make_zone(db)
    db.add(DisasterAdvisory(zone_id=zone.id, hazard_type="storm", severity="medium",
                            message="wind", active=True))
    db.commit()
    r = client.get("/api/disasters", headers=admin_headers)
    assert r.status_code == 200
    assert len(r.json()) == 1


def test_list_disasters_forbidden_for_tourist(client, tourist_headers):
    r = client.get("/api/disasters", headers=tourist_headers)
    assert r.status_code == 403


def test_tourist_disasters_endpoint(client, tourist_headers, tourist_user, db):
    zone = make_zone(db, lat=26.1445, lng=91.7362, d=0.02)
    db.add(DisasterAdvisory(zone_id=zone.id, hazard_type="flood", severity="high",
                            message="rising water", active=True))
    db.commit()
    r = client.get(f"/api/tourists/{tourist_user.tourist_id}/disasters", headers=tourist_headers)
    assert r.status_code == 200
    assert len(r.json()) == 1
