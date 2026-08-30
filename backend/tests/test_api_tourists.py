"""Tourist registration, serialization, and input validation."""
from datetime import timedelta

import pytest

from app.core.time import utc_now
from app.models.user import User


def _payload(**over):
    now = utc_now()
    base = {
        "full_name": "New Tourist",
        "nationality": "Indian",
        "document_type": "aadhaar",
        "document_number": "XXXX-XXXX-9999",
        "phone": "+91-90000-11111",
        "itinerary": [{"name": "Stop", "lat": 26.14, "lng": 91.73}],
        "emergency_contacts": [{"name": "Kin", "phone": "+91-1", "relation": "family"}],
        "trip_start": now.isoformat(),
        "trip_end": (now + timedelta(days=5)).isoformat(),
    }
    base.update(over)
    return base


def test_registration_mints_a_digital_id(client):
    r = client.post("/api/tourists", json=_payload())
    assert r.status_code == 201
    body = r.json()
    assert body["digital_id"].startswith("STS-")
    assert body["is_valid"] is True


def test_registration_response_has_no_orm_internals(client):
    body = client.post("/api/tourists", json=_payload()).json()
    assert "_sa_instance_state" not in body


def test_registration_seeds_the_hash_chain(client, admin_headers):
    tid = client.post("/api/tourists", json=_payload()).json()["id"]
    chain = client.get(f"/api/tourists/{tid}/chain", headers=admin_headers).json()
    assert len(chain) == 1 and chain[0]["event"] == "ID_ISSUED"
    assert client.get(f"/api/tourists/{tid}/chain/verify",
                      headers=admin_headers).json()["valid"] is True


def test_registration_with_credentials_creates_a_login(client, db):
    r = client.post("/api/tourists", json=_payload(
        email="new@test.com", password="strongpass1"))
    assert r.status_code == 201
    user = db.query(User).filter_by(email="new@test.com").one()
    assert user.role == "tourist" and user.tourist_id == r.json()["id"]


def test_duplicate_email_rejected(client):
    client.post("/api/tourists", json=_payload(email="dup@test.com",
                                               password="strongpass1"))
    r = client.post("/api/tourists", json=_payload(email="dup@test.com",
                                                   password="strongpass1"))
    assert r.status_code == 400


# ---------------------------------------------------------------- validation
def test_trip_end_before_start_rejected(client):
    now = utc_now()
    r = client.post("/api/tourists", json=_payload(
        trip_start=now.isoformat(), trip_end=(now - timedelta(days=1)).isoformat()))
    assert r.status_code == 422


def test_weak_password_rejected(client):
    r = client.post("/api/tourists", json=_payload(email="w@test.com", password="weak"))
    assert r.status_code == 422


def test_email_without_password_rejected(client):
    assert client.post("/api/tourists",
                       json=_payload(email="x@test.com")).status_code == 422


@pytest.mark.parametrize("bad_doc", ["driverslicense", "ration_card", ""])
def test_invalid_document_type_rejected(client, bad_doc):
    assert client.post("/api/tourists",
                       json=_payload(document_type=bad_doc)).status_code == 422


@pytest.mark.parametrize("lat,lng", [(91.0, 91.7), (26.1, 181.0), (-91.0, 0.0)])
def test_out_of_range_waypoint_rejected(client, lat, lng):
    r = client.post("/api/tourists",
                    json=_payload(itinerary=[{"name": "Bad", "lat": lat, "lng": lng}]))
    assert r.status_code == 422


def test_registration_is_rate_limited(client):
    from app.core.config import settings
    for _ in range(settings.REGISTRATION_RATE_LIMIT):
        client.post("/api/tourists", json=_payload())
    assert client.post("/api/tourists", json=_payload()).status_code == 429


# ---------------------------------------------------------------- location input
@pytest.mark.parametrize("body", [
    {"lat": 200.0, "lng": 91.7, "speed_kmh": 5},
    {"lat": 26.1, "lng": 400.0, "speed_kmh": 5},
    {"lat": 26.1, "lng": 91.7, "speed_kmh": -5},
    {"lat": 26.1, "lng": 91.7, "speed_kmh": 5000},
])
def test_invalid_location_payload_rejected(client, admin_headers, tourist_user, body):
    r = client.post(f"/api/tourists/{tourist_user.tourist_id}/location",
                    json=body, headers=admin_headers)
    assert r.status_code == 422


def test_qr_code_is_returned_as_data_uri(client, tourist_user, admin_headers):
    r = client.get(f"/api/tourists/{tourist_user.tourist_id}/qr", headers=admin_headers)
    assert r.status_code == 200
    assert r.json()["qr_png_base64"].startswith("data:image/png;base64,")


def test_missing_tourist_returns_404(client, admin_headers):
    assert client.get("/api/tourists/9999", headers=admin_headers).status_code == 404
