"""Tourist Check-in / Check-out (services/checkin.py, /tourists/{id}/checkins)."""
from datetime import timedelta

from app.core.config import settings
from app.core.time import utc_now
from app.models.alert import Alert
from app.models.incident import Incident
from app.services.checkin import tick_checkins
from tests.conftest import make_tourist


def test_create_and_checkin_on_time(client, tourist_headers, tourist_user):
    tid = tourist_user.tourist_id
    r = client.post(f"/api/tourists/{tid}/checkins", headers=tourist_headers, json={
        "destination_name": "Riverside trek",
        "expected_return_at": (utc_now() + timedelta(hours=3)).isoformat(),
    })
    assert r.status_code == 201
    cid = r.json()["id"]
    assert r.json()["status"] == "planned"

    done = client.post(f"/api/tourists/{tid}/checkins/{cid}/checkin", headers=tourist_headers)
    assert done.status_code == 200
    assert done.json()["status"] == "checked_in"
    assert done.json()["checked_in_at"] is not None


def test_missed_checkin_raises_soft_alert(db):
    t = make_tourist(db)
    from app.models.checkin import CheckIn
    c = CheckIn(tourist_id=t.id, destination_name="Hillside",
               expected_return_at=utc_now() - timedelta(minutes=1))
    db.add(c)
    db.commit()

    result = tick_checkins(db)
    assert c.id in result["missed"]
    db.refresh(c)
    assert c.status == "missed"
    alert = db.query(Alert).filter(Alert.type == "missed_checkin").first()
    assert alert is not None
    assert alert.severity == "medium"


def test_still_missed_after_grace_period_escalates_to_incident(db):
    t = make_tourist(db)
    from app.models.checkin import CheckIn
    c = CheckIn(
        tourist_id=t.id, destination_name="Hillside", status="missed",
        expected_return_at=utc_now() - timedelta(minutes=settings.CHECKIN_GRACE_MINUTES + 5),
    )
    db.add(c)
    db.commit()

    result = tick_checkins(db)
    assert c.id in result["escalated"]
    db.refresh(c)
    assert c.status == "escalated"
    inc = db.query(Incident).filter(Incident.type == "missed_checkin").first()
    assert inc is not None
    assert inc.severity == "high"


def test_tick_checkins_leaves_on_time_checkins_alone(db):
    t = make_tourist(db)
    from app.models.checkin import CheckIn
    c = CheckIn(tourist_id=t.id, destination_name="Market",
               expected_return_at=utc_now() + timedelta(hours=1))
    db.add(c)
    db.commit()

    result = tick_checkins(db)
    assert result == {"missed": [], "escalated": []}
    db.refresh(c)
    assert c.status == "planned"


def test_checkins_forbidden_for_other_tourist(client, tourist_headers, db):
    other = make_tourist(db, name="Not Me")
    r = client.post(f"/api/tourists/{other.id}/checkins", headers=tourist_headers, json={
        "destination_name": "X", "expected_return_at": utc_now().isoformat(),
    })
    assert r.status_code == 403
