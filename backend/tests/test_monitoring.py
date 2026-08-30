"""The core monitoring pipeline: ping -> anomaly/geofence -> alert/incident."""
from datetime import timedelta

import pytest

from app.core.time import utc_now
from app.models.alert import Alert
from app.models.incident import Incident
from app.models.tourist import LocationPing
from app.services.monitoring import process_ping, trigger_sos
from tests.conftest import make_tourist, make_unit, make_zone


def test_ping_is_persisted_and_updates_last_position(db):
    t = make_tourist(db)
    process_ping(db, t, 26.150, 91.740, speed_kmh=4)

    assert db.query(LocationPing).filter_by(tourist_id=t.id).count() == 1
    assert t.last_lat == 26.150 and t.last_lng == 91.740
    assert t.last_seen is not None


def test_entering_high_risk_zone_raises_geofence_alert(db):
    z = make_zone(db, name="Old Market", risk="high", lat=26.165, lng=91.75)
    t = make_tourist(db, itinerary=[{"name": "Stop", "lat": 26.165, "lng": 91.75}])

    result = process_ping(db, t, 26.165, 91.75, speed_kmh=3)

    assert "geofence" in result["alerts_raised"]
    assert "Old Market" in result["in_zones"]
    alert = db.query(Alert).filter_by(type="geofence").one()
    assert alert.zone_id == z.id, "geofence alert must carry the zone FK"


def test_low_risk_zone_does_not_alert(db):
    make_zone(db, name="Safe Zone", risk="low", lat=26.1445, lng=91.7362)
    t = make_tourist(db)
    result = process_ping(db, t, 26.1445, 91.7362, speed_kmh=3)
    assert "geofence" not in result["alerts_raised"]


def test_restricted_zone_produces_critical_severity(db):
    make_zone(db, name="Border", risk="restricted", lat=26.18, lng=91.77)
    t = make_tourist(db, itinerary=[{"name": "Stop", "lat": 26.18, "lng": 91.77}])
    process_ping(db, t, 26.18, 91.77, speed_kmh=3)
    assert db.query(Alert).filter_by(type="geofence").one().severity == "critical"


def test_route_deviation_alert_beyond_threshold(db):
    t = make_tourist(db, itinerary=[{"name": "Plan", "lat": 26.1445, "lng": 91.7362}])
    result = process_ping(db, t, 26.30, 91.95, speed_kmh=10)

    assert "route_deviation" in result["alerts_raised"]
    assert result["route_deviation_m"] > 2000


def test_no_route_deviation_when_on_plan(db):
    t = make_tourist(db, itinerary=[{"name": "Plan", "lat": 26.1445, "lng": 91.7362}])
    result = process_ping(db, t, 26.1446, 91.7363, speed_kmh=4)
    assert "route_deviation" not in result["alerts_raised"]


def test_tourist_with_no_itinerary_never_deviates(db):
    t = make_tourist(db, itinerary=[])
    result = process_ping(db, t, 27.5, 92.5, speed_kmh=10)
    assert "route_deviation" not in result["alerts_raised"]


def test_high_speed_opens_an_anomaly_incident(db):
    t = make_tourist(db, itinerary=[])
    process_ping(db, t, 26.1445, 91.7362, speed_kmh=5)
    result = process_ping(db, t, 26.40, 92.00, speed_kmh=180)

    assert result["anomaly"]["is_anomaly"] is True
    inc = db.query(Incident).filter_by(type="anomaly").first()
    assert inc is not None and inc.severity == "high"


def test_repeated_anomalies_are_deduped_into_one_incident(db):
    """A tourist who stays anomalous across many pings must not flood the feed."""
    t = make_tourist(db, itinerary=[])
    for _ in range(5):
        process_ping(db, t, 26.40, 92.00, speed_kmh=200)

    assert db.query(Incident).filter_by(type="anomaly").count() == 1


def test_dedupe_window_expires(db):
    t = make_tourist(db, itinerary=[])
    process_ping(db, t, 26.40, 92.00, speed_kmh=200)
    inc = db.query(Incident).filter_by(type="anomaly").one()
    # Age the existing incident past the dedupe window.
    inc.detected_at = utc_now() - timedelta(minutes=30)
    db.commit()

    process_ping(db, t, 26.45, 92.10, speed_kmh=210)
    assert db.query(Incident).filter_by(type="anomaly").count() == 2


def test_safety_score_is_written_back_to_the_tourist(db):
    make_zone(db, name="Old Market", risk="high", lat=26.165, lng=91.75)
    t = make_tourist(db, itinerary=[{"name": "Stop", "lat": 26.165, "lng": 91.75}])
    result = process_ping(db, t, 26.165, 91.75, speed_kmh=3)

    assert t.safety_score == result["safety_score"]
    assert 0 <= t.safety_score <= 100
    assert result["band"] in {"safe", "moderate", "risky", "danger"}


# ---------------------------------------------------------------- SOS
def test_sos_dispatches_the_nearest_available_unit(db):
    make_unit(db, name="Far Unit", lat=27.0, lng=92.5)
    near = make_unit(db, name="Near Unit", lat=26.1450, lng=91.7365)
    t = make_tourist(db)

    result = trigger_sos(db, t, 26.1445, 91.7362, "Help")

    assert result["nearest_unit"]["name"] == "Near Unit"
    assert db.get(Incident, result["incident_id"]).assigned_unit_id == near.id


def test_sos_skips_unavailable_units(db):
    make_unit(db, name="Closest But Busy", lat=26.1445, lng=91.7362, available=False)
    make_unit(db, name="Available", lat=26.20, lng=91.80, available=True)
    t = make_tourist(db)

    assert trigger_sos(db, t, 26.1445, 91.7362, "Help")["nearest_unit"]["name"] == "Available"


def test_sos_with_no_units_still_opens_an_incident(db):
    t = make_tourist(db)
    result = trigger_sos(db, t, 26.1445, 91.7362, "Help")

    assert result["nearest_unit"] is None
    assert db.get(Incident, result["incident_id"]).severity == "critical"


def test_sos_marks_tourist_and_notifies_contacts(db):
    make_unit(db)
    t = make_tourist(db)
    result = trigger_sos(db, t, 26.1445, 91.7362, "Help")

    assert t.status == "sos"
    assert result["notified_contacts"][0]["name"] == "Kin"
    assert db.query(Alert).filter_by(type="sos").one().severity == "critical"


def test_sos_actually_dispatches_to_the_notification_channel(db, monkeypatch):
    """The API previously returned `notified_contacts` without sending
    anything -- this pins that a message is actually dispatched per contact."""
    from app.services import notifications

    sent = []
    monkeypatch.setattr(
        notifications, "get_channel",
        lambda: type("C", (), {"send": staticmethod(
            lambda to, subject, body: sent.append({"to": to, "subject": subject, "body": body})
        )})(),
    )

    make_unit(db)
    t = make_tourist(db)
    trigger_sos(db, t, 26.1445, 91.7362, "Help, being followed")

    assert len(sent) == 1
    assert sent[0]["to"] == "+91-1"  # the seeded contact's phone number
    assert "Help, being followed" in sent[0]["body"]
    assert t.full_name in sent[0]["body"]
