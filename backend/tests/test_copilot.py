"""AI Safety Copilot (services/copilot.py, /copilot/ask, /tourists/{id}/copilot/ask)."""
from app.models.alert import Alert
from tests.conftest import make_tourist, make_unit, make_zone


def test_operator_why_flagged_uses_real_score(client, admin_headers, db):
    t = make_tourist(db)
    r = client.post("/api/copilot/ask", headers=admin_headers,
                    json={"question": f"why was tourist {t.id} flagged?"})
    assert r.status_code == 200
    body = r.json()
    assert body["handled"] is True
    assert t.full_name in body["answer"]


def test_operator_why_flagged_unknown_tourist(client, admin_headers):
    r = client.post("/api/copilot/ask", headers=admin_headers,
                    json={"question": "why was tourist 99999 flagged?"})
    assert "couldn't find" in r.json()["answer"]


def test_operator_at_risk_list(client, admin_headers, db):
    make_tourist(db, name="Low Score")
    r = client.post("/api/copilot/ask", headers=admin_headers,
                    json={"question": "which tourists are at risk right now?"})
    assert r.status_code == 200
    assert r.json()["handled"] is True


def test_operator_alert_summary(client, admin_headers, db):
    t = make_tourist(db)
    db.add(Alert(tourist_id=t.id, type="sos", severity="critical", message="x"))
    db.commit()
    r = client.post("/api/copilot/ask", headers=admin_headers,
                    json={"question": "how many active alerts are there?"})
    assert "1" in r.json()["answer"]


def test_operator_dispatch_query(client, admin_headers, db):
    make_unit(db, name="Alpha", lat=26.1450, lng=91.7365)
    t = make_tourist(db, lat=26.1445, lng=91.7362)
    r = client.post("/api/copilot/ask", headers=admin_headers,
                    json={"question": f"nearest unit to tourist {t.id}"})
    assert "Alpha" in r.json()["answer"]


def test_operator_fallback_help_menu(client, admin_headers):
    r = client.post("/api/copilot/ask", headers=admin_headers, json={"question": "banana"})
    assert r.json()["handled"] is False
    assert "I can answer" in r.json()["answer"]


def test_operator_copilot_forbidden_for_tourist(client, tourist_headers):
    r = client.post("/api/copilot/ask", headers=tourist_headers, json={"question": "hi"})
    assert r.status_code == 403


# ---------------------------------------------------------------- tourist side
def test_tourist_nearest_hospital(client, tourist_headers, tourist_user, db):
    # tourist_user's Tourist row defaults to (26.1445, 91.7362) -- see
    # tests/conftest.py:make_tourist().
    make_unit(db, name="City Hospital", unit_type="ambulance", lat=26.145, lng=91.737)
    r = client.post(f"/api/tourists/{tourist_user.tourist_id}/copilot/ask", headers=tourist_headers,
                    json={"question": "where is the nearest hospital?"})
    assert r.status_code == 200
    assert "City Hospital" in r.json()["answer"]


def test_tourist_area_safety(client, tourist_headers, tourist_user, db):
    make_zone(db, risk="restricted", lat=26.1445, lng=91.7362, d=0.01)
    r = client.post(f"/api/tourists/{tourist_user.tourist_id}/copilot/ask", headers=tourist_headers,
                    json={"question": "is this area safe?"})
    assert r.status_code == 200
    assert "restricted" in r.json()["answer"] or "risk" in r.json()["answer"]


def test_tourist_advice(client, tourist_headers, tourist_user):
    r = client.post(f"/api/tourists/{tourist_user.tourist_id}/copilot/ask", headers=tourist_headers,
                    json={"question": "what should I do now?"})
    assert r.status_code == 200
    assert r.json()["handled"] is True


def test_tourist_copilot_forbidden_for_other_tourist(client, tourist_headers, db):
    other = make_tourist(db, name="Not Me")
    r = client.post(f"/api/tourists/{other.id}/copilot/ask", headers=tourist_headers,
                    json={"question": "hi"})
    assert r.status_code == 403
