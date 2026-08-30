"""Analytics aggregation. These moved from Python loops into SQL, and zone
attribution moved from substring-matching messages onto a real foreign key."""
from app.services.monitoring import process_ping, trigger_sos
from tests.conftest import make_tourist, make_unit, make_zone


def test_summary_on_empty_database(client, admin_headers):
    body = client.get("/api/analytics/summary", headers=admin_headers).json()
    assert body["total_tourists"] == 0
    assert body["avg_safety_score"] == 0
    assert body["avg_response_time_seconds"] == 0


def test_summary_counts_statuses(client, admin_headers, db):
    make_unit(db)
    make_tourist(db, name="Safe One")
    t2 = make_tourist(db, name="In Trouble")
    trigger_sos(db, t2, 26.1445, 91.7362, "help")

    body = client.get("/api/analytics/summary", headers=admin_headers).json()
    assert body["total_tourists"] == 2
    assert body["sos_active"] == 1
    assert body["open_incidents"] == 1
    assert 0 <= body["avg_safety_score"] <= 100


def test_zone_risk_uses_the_foreign_key_not_message_text(client, admin_headers, db):
    """Two zones where one name contains the other: substring matching would
    have credited the alert to both."""
    make_zone(db, name="Market", risk="high", lat=26.165, lng=91.75, d=0.004)
    make_zone(db, name="Old Market", risk="high", lat=27.50, lng=92.50, d=0.004)
    t = make_tourist(db, itinerary=[{"name": "Stop", "lat": 26.165, "lng": 91.75}])
    process_ping(db, t, 26.165, 91.75, speed_kmh=3)

    rows = {r["zone"]: r["alert_count"]
            for r in client.get("/api/analytics/zone-risk", headers=admin_headers).json()}
    assert rows["Market"] == 1
    assert rows["Old Market"] == 0, "alert was misattributed to the other zone"


def test_alerts_by_type(client, admin_headers, db):
    make_unit(db)
    t = make_tourist(db)
    trigger_sos(db, t, 26.1445, 91.7362, "help")
    rows = {r["type"]: r["count"]
            for r in client.get("/api/analytics/alerts-by-type",
                                headers=admin_headers).json()}
    assert rows["sos"] == 1


def test_severity_breakdown_is_ordered(client, admin_headers, db):
    make_unit(db)
    trigger_sos(db, make_tourist(db), 26.1445, 91.7362, "help")
    rows = client.get("/api/analytics/severity-breakdown", headers=admin_headers).json()
    order = ["low", "medium", "high", "critical"]
    seen = [r["severity"] for r in rows]
    assert seen == sorted(seen, key=order.index)


def test_incidents_over_time_groups_by_day(client, admin_headers, db):
    make_unit(db)
    trigger_sos(db, make_tourist(db), 26.1445, 91.7362, "help")
    rows = client.get("/api/analytics/incidents-over-time",
                      headers=admin_headers).json()
    assert len(rows) == 1 and rows[0]["count"] == 1


def test_analytics_requires_admin(client, tourist_headers):
    for ep in ["summary", "alerts-by-type", "incidents-over-time",
               "zone-risk", "severity-breakdown"]:
        assert client.get(f"/api/analytics/{ep}",
                          headers=tourist_headers).status_code == 403
