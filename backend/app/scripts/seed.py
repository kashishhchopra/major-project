"""Seed the database with demo users, tourists, zones, police units, incidents.

Run:  python -m app.scripts.seed
Idempotent-ish: drops & recreates all tables for a clean demo each time.
"""
from __future__ import annotations

import json
import os
from datetime import timedelta

from app.core.security import hash_password
from app.core.time import utc_now
from app.db.session import Base, SessionLocal
from app.models.incident import Incident, IncidentEvent
from app.models.police import PoliceUnit
from app.models.tourist import Tourist
from app.models.user import User
from app.models.zone import Zone
from app.services import hashchain

CENTER = (26.1445, 91.7362)  # Guwahati


def _rect(lat, lng, dlat=0.008, dlng=0.008):
    return [
        [lat - dlat, lng - dlng],
        [lat - dlat, lng + dlng],
        [lat + dlat, lng + dlng],
        [lat + dlat, lng - dlng],
    ]


def _reset_data(db) -> None:
    """Delete all rows, keeping the schema intact.

    This used to drop and recreate every table, which bypassed Alembic: the
    tables came back as whatever the models happened to say, while
    `alembic_version` still claimed the old revision. Deleting rows leaves schema
    ownership with the migrations.
    """
    for table in reversed(Base.metadata.sorted_tables):
        db.execute(table.delete())
    db.commit()


def seed() -> None:
    db = SessionLocal()
    _reset_data(db)
    try:
        # ---- admin / police operator account ----
        db.add(User(
            email="admin@tourism.gov.in", full_name="Control Room Officer",
            hashed_password=hash_password("admin123"), role="admin",
        ))

        # ---- zones (mix of manual + DBSCAN-discovered) ----
        zones = [
            Zone(name="Riverside Restricted Area", risk_level="restricted",
                 polygon=json.dumps(_rect(26.1800, 91.7700)), crime_index=85,
                 description="Border/riverbank — entry prohibited after dusk", source="manual"),
            Zone(name="Old Market High-Risk Zone", risk_level="high",
                 polygon=json.dumps(_rect(26.1650, 91.7500)), crime_index=70,
                 description="Pickpocketing & scam hotspot", source="manual"),
            Zone(name="Hillside Trek Caution Zone", risk_level="medium",
                 polygon=json.dumps(_rect(26.1250, 91.7150, 0.01, 0.01)), crime_index=40,
                 description="Landslide-prone trekking route", source="manual"),
            Zone(name="City Center Safe Zone", risk_level="low",
                 polygon=json.dumps(_rect(26.1445, 91.7362, 0.006, 0.006)), crime_index=15,
                 description="Well-patrolled tourist district", source="manual"),
        ]

        # auto-discovered hot-zones from DBSCAN, if available
        hz_path = os.path.join("ml_models", "hotzones.json")
        if os.path.exists(hz_path):
            with open(hz_path) as f:
                data = json.load(f)
            for c in data.get("clusters", []):
                zones.append(Zone(
                    name=f"Auto Hot-Zone #{c['cluster']} (DBSCAN)",
                    risk_level="high",
                    polygon=json.dumps(c["polygon"]),
                    crime_index=65,
                    description=f"Auto-discovered from {c['size']} historical incidents",
                    source="auto",
                ))
        db.add_all(zones)

        # ---- police units ----
        units = [
            PoliceUnit(name="Unit Alpha", station="City Central PS", phone="100",
                       lat=26.1450, lng=91.7370),
            PoliceUnit(name="Unit Bravo", station="Riverside PS", phone="100",
                       lat=26.1750, lng=91.7650),
            PoliceUnit(name="Unit Charlie", station="Market PS", phone="100",
                       lat=26.1620, lng=91.7480),
            PoliceUnit(name="Unit Delta", station="Hillside Outpost", phone="100",
                       lat=26.1280, lng=91.7180),
        ]
        db.add_all(units)
        db.flush()

        # ---- demo tourists ----
        now = utc_now()
        demo = [
            {
                "full_name": "Aarav Sharma", "doc": "XXXX-XXXX-4521", "phone": "+91-98765-43210",
                "start": (26.1445, 91.7362), "email": "aarav@example.com",
                "itin": [("Kamakhya Temple", 26.1665, 91.7055),
                         ("City Center", 26.1445, 91.7362),
                         ("Umananda Island", 26.1970, 91.7450)],
            },
            {
                "full_name": "Emma Watson", "doc": "P1234567", "phone": "+44-7700-900123",
                "start": (26.1500, 91.7400), "email": "emma@example.com", "nat": "British",
                "doctype": "passport",
                "itin": [("City Center", 26.1445, 91.7362),
                         ("Old Market", 26.1650, 91.7500)],
            },
            {
                "full_name": "Rohan Verma", "doc": "XXXX-XXXX-8890", "phone": "+91-99887-76655",
                "start": (26.1280, 91.7200), "email": "rohan@example.com",
                "itin": [("Hillside Trek Start", 26.1250, 91.7150),
                         ("Viewpoint", 26.1200, 91.7100)],
            },
            {
                "full_name": "Sofia Rossi", "doc": "YA9988776", "phone": "+39-333-1234567",
                "start": (26.1600, 91.7480), "email": "sofia@example.com", "nat": "Italian",
                "doctype": "passport",
                "itin": [("Old Market", 26.1650, 91.7500),
                         ("Riverside Walk", 26.1780, 91.7680)],
            },
            {
                "full_name": "Kenji Tanaka", "doc": "TK5544332", "phone": "+81-90-1234-5678",
                "start": (26.1420, 91.7340), "email": "kenji@example.com", "nat": "Japanese",
                "doctype": "passport",
                "itin": [("City Center", 26.1445, 91.7362),
                         ("Kamakhya Temple", 26.1665, 91.7055)],
            },
        ]

        for i, d in enumerate(demo):
            slat, slng = d["start"]
            t = Tourist(
                digital_id=f"STS-DEMO{i+1:03d}",
                full_name=d["full_name"],
                nationality=d.get("nat", "Indian"),
                document_type=d.get("doctype", "aadhaar"),
                document_number=d["doc"],
                phone=d["phone"],
                itinerary=json.dumps([{"name": n, "lat": la, "lng": ln} for n, la, ln in d["itin"]]),
                emergency_contacts=json.dumps([
                    {"name": "Family Contact", "phone": "+91-90000-00000", "relation": "family"},
                    {"name": "Hotel Desk", "phone": "+91-91111-11111", "relation": "hotel"},
                ]),
                trip_start=now - timedelta(days=1),
                trip_end=now + timedelta(days=6),
                last_lat=slat, last_lng=slng, last_seen=now,
                safety_score=90.0, status="active",
            )
            db.add(t)
            db.flush()
            hashchain.append_block(db, t, "ID_ISSUED", {
                "digital_id": t.digital_id, "name": t.full_name, "document": t.document_number,
            })
            hashchain.append_block(db, t, "CHECKIN", {"location": "Arrival", "lat": slat, "lng": slng})
            # tourist login account
            db.add(User(
                email=d["email"], full_name=d["full_name"],
                hashed_password=hash_password("tourist123"),
                role="tourist", tourist_id=t.id,
            ))

        # ---- a couple of historical resolved incidents (for analytics charts) ----
        t1 = db.query(Tourist).first()
        for days_ago, sev in [(3, "high"), (2, "medium"), (1, "critical")]:
            det = now - timedelta(days=days_ago)
            inc = Incident(
                tourist_id=t1.id, type="anomaly", severity=sev, status="resolved",
                description="Historical resolved incident (seed)",
                lat=t1.last_lat, lng=t1.last_lng,
                detected_at=det, acknowledged_at=det + timedelta(minutes=2),
                dispatched_at=det + timedelta(minutes=5),
                resolved_at=det + timedelta(minutes=20),
            )
            db.add(inc)
            db.flush()
            db.add(IncidentEvent(incident_id=inc.id, status="resolved", note="Closed"))

        db.commit()
        print("Seed complete.")
        print("  Admin login : admin@tourism.gov.in / admin123")
        print("  Tourist login: aarav@example.com / tourist123 (and emma/rohan/sofia/kenji)")
        print(f"  Tourists: {db.query(Tourist).count()}, Zones: {db.query(Zone).count()}, "
              f"Units: {db.query(PoliceUnit).count()}")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
