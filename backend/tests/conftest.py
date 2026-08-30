"""Shared test fixtures.

Every test runs against a fresh in-memory SQLite database. StaticPool keeps the
whole test on one connection, which is required because each new connection to
`:memory:` would otherwise get its own empty database.
"""
from __future__ import annotations

import os
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Pin a deterministic secret before any app module reads settings: the digital-ID
# hash chain is keyed with it, so tests must not depend on a generated dev key.
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-pytest-only-not-a-real-key")
os.environ.setdefault("ENVIRONMENT", "test")

from app.core import ratelimit  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.core.time import utc_now  # noqa: E402
from app.db.session import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.police import PoliceUnit  # noqa: E402
from app.models.tourist import Tourist  # noqa: E402
from app.models.user import User  # noqa: E402
from app.models.zone import Zone  # noqa: E402
from app.services import audit, hashchain  # noqa: E402


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSession()
    # The audit trail deliberately uses its own session; point it at the test
    # engine so assertions can see what it wrote.
    audit.set_session_factory(TestingSession)
    try:
        yield session
    finally:
        audit.reset_session_factory()
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """Rate-limit counters are process-global; isolate every test from the last."""
    ratelimit.reset()
    yield
    ratelimit.reset()


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# ---------------------------------------------------------------- data builders
def make_zone(db, name="Old Market", risk="high", lat=26.165, lng=91.75,
              d=0.008, crime=70.0) -> Zone:
    import json
    z = Zone(
        name=name, risk_level=risk, crime_index=crime, source="manual",
        polygon=json.dumps([[lat - d, lng - d], [lat - d, lng + d],
                            [lat + d, lng + d], [lat + d, lng - d]]),
    )
    db.add(z)
    db.commit()
    db.refresh(z)
    return z


def make_tourist(db, name="Test Tourist", lat=26.1445, lng=91.7362,
                 itinerary=None, doc="XXXX-XXXX-0001") -> Tourist:
    import json
    now = utc_now()
    t = Tourist(
        digital_id=f"STS-TEST{db.query(Tourist).count() + 1:03d}",
        full_name=name, nationality="Indian", document_type="aadhaar",
        document_number=doc, phone="+91-90000-00000",
        itinerary=json.dumps(itinerary if itinerary is not None
                             else [{"name": "Start", "lat": lat, "lng": lng}]),
        emergency_contacts=json.dumps([{"name": "Kin", "phone": "+91-1",
                                        "relation": "family"}]),
        trip_start=now - timedelta(days=1), trip_end=now + timedelta(days=6),
        last_lat=lat, last_lng=lng, last_seen=now, safety_score=90.0,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    hashchain.append_block(db, t, "ID_ISSUED", {"digital_id": t.digital_id})
    db.commit()
    return t


def make_unit(db, name="Unit Alpha", lat=26.145, lng=91.737, available=True):
    u = PoliceUnit(name=name, station=f"{name} PS", phone="100",
                   lat=lat, lng=lng, available=available)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


@pytest.fixture
def admin_user(db):
    u = User(email="admin@test.gov", full_name="Admin",
             hashed_password=hash_password("adminpass1"), role="admin")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


@pytest.fixture
def tourist_user(db):
    t = make_tourist(db, name="Owner Tourist")
    u = User(email="tourist@test.com", full_name="Owner Tourist",
             hashed_password=hash_password("touristpass1"), role="tourist",
             tourist_id=t.id)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _token(client, email, password) -> dict:
    r = client.post("/api/auth/login", data={"username": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def admin_headers(client, admin_user):
    return _token(client, "admin@test.gov", "adminpass1")


@pytest.fixture
def tourist_headers(client, tourist_user):
    return _token(client, "tourist@test.com", "touristpass1")
