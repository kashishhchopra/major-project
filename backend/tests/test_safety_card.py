"""Offline Maps & Safety Card (services/safety_card.py, /tourists/{id}/safety-card)."""
from tests.conftest import make_tourist, make_unit


def test_safety_card_includes_emergency_numbers(client, admin_headers, db):
    t = make_tourist(db)
    r = client.get(f"/api/tourists/{t.id}/safety-card", headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["emergency_numbers"]["all_in_one"] == "112"
    assert body["nearest_hospital"] is None
    assert body["nearest_police"] is None


def test_safety_card_finds_nearest_units(client, admin_headers, db):
    t = make_tourist(db, lat=26.1445, lng=91.7362)
    make_unit(db, name="City Hospital", unit_type="ambulance", lat=26.145, lng=91.737)
    make_unit(db, name="Central PS", unit_type="police", lat=26.146, lng=91.738)

    r = client.get(f"/api/tourists/{t.id}/safety-card", headers=admin_headers)
    body = r.json()
    assert body["nearest_hospital"]["name"] == "City Hospital"
    assert body["nearest_police"]["name"] == "Central PS"
    assert body["nearest_hospital"]["distance_km"] >= 0


def test_safety_card_visible_to_self(client, tourist_headers, tourist_user):
    r = client.get(f"/api/tourists/{tourist_user.tourist_id}/safety-card", headers=tourist_headers)
    assert r.status_code == 200


def test_safety_card_forbidden_for_other_tourist(client, tourist_headers, db):
    other = make_tourist(db, name="Not Me")
    r = client.get(f"/api/tourists/{other.id}/safety-card", headers=tourist_headers)
    assert r.status_code == 403
