"""Core pipeline: ingest a location ping -> anomaly + geofence checks ->
alerts, incidents, safety-score refresh, and WebSocket broadcast."""
import json
from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logging import get_logger
from app.core.time import utc_now
from app.models.alert import Alert
from app.models.incident import Incident, IncidentEvent
from app.models.tourist import LocationPing, Tourist
from app.models.zone import Zone
from app.services import ml_service, notifications
from app.services.geo import (
    haversine_m,
    min_distance_to_route,
    zones_containing_point,
)
from app.services.safety import compute_safety_score
from app.services.trajectory import predict_trajectory, predicts_crosses_zone
from app.websocket.manager import broadcast_sync, notify_tourist_sync

logger = get_logger(__name__)

_RISK_SEVERITY = {"low": "low", "medium": "medium", "high": "high", "restricted": "critical"}


def _create_alert(db: Session, tourist_id, atype, severity, message, lat, lng,
                  zone_id: int | None = None) -> Alert:
    alert = Alert(
        tourist_id=tourist_id, type=atype, severity=severity,
        message=message, lat=lat, lng=lng, zone_id=zone_id,
    )
    db.add(alert)
    db.flush()
    payload = {
        "event": "alert",
        "id": alert.id,
        "tourist_id": tourist_id,
        "zone_id": zone_id,
        "type": atype,
        "severity": severity,
        "message": message,
        "lat": lat, "lng": lng,
        "created_at": alert.created_at.isoformat(),
    }
    broadcast_sync(payload)  # admin control-room feed: every tourist's alerts
    notify_tourist_sync(tourist_id, payload)  # the tourist's own device: only theirs
    return alert


def _open_incident(db: Session, tourist: Tourist, itype, severity, description, lat, lng) -> Incident:
    inc = Incident(
        tourist_id=tourist.id, type=itype, severity=severity,
        status="detected", description=description, lat=lat, lng=lng,
    )
    db.add(inc)
    db.flush()
    db.add(IncidentEvent(incident_id=inc.id, status="detected", note=description))
    db.flush()
    broadcast_sync({
        "event": "incident",
        "id": inc.id,
        "tourist_id": tourist.id,
        "type": itype,
        "severity": severity,
        "status": "detected",
        "lat": lat, "lng": lng,
    })
    return inc


def process_ping(db: Session, tourist: Tourist, lat: float, lng: float,
                 speed_kmh: float = 0.0) -> dict:
    """Process one GPS ping. Returns a summary dict for the caller/API."""
    now = utc_now()

    # distance/time from previous ping
    prev = (
        db.query(LocationPing)
        .filter(LocationPing.tourist_id == tourist.id)
        .order_by(LocationPing.timestamp.desc())
        .first()
    )
    if prev:
        dist_prev = haversine_m(prev.lat, prev.lng, lat, lng)
        dt = max((now - prev.timestamp).total_seconds(), 1.0)
    else:
        dist_prev, dt = 0.0, 1.0

    itinerary = json.loads(tourist.itinerary or "[]")
    dist_route = min_distance_to_route(lat, lng, itinerary)

    # ---- anomaly detection (IsolationForest) ----
    feats = ml_service.anomaly_features(speed_kmh, dist_prev, dt, dist_route)
    anomaly = ml_service.score_anomaly(feats)
    logger.info(
        "anomaly_scored", tourist_id=tourist.id, features=feats,
        is_anomaly=anomaly["is_anomaly"], score=anomaly["score"],
    )

    ping = LocationPing(
        tourist_id=tourist.id, lat=lat, lng=lng, speed_kmh=speed_kmh,
        timestamp=now, anomaly_score=anomaly["score"], is_anomaly=anomaly["is_anomaly"],
    )
    db.add(ping)

    tourist.last_lat, tourist.last_lng, tourist.last_seen = lat, lng, now

    alerts_raised = []

    if anomaly["is_anomaly"]:
        reason = "unusual movement pattern"
        if speed_kmh > 120:
            reason = f"abnormal speed {speed_kmh:.0f} km/h (possible vehicle abduction)"
        elif dt / 60.0 > 45:
            reason = f"prolonged inactivity {dt/60:.0f} min"
        elif dist_prev > 5000:
            reason = f"sudden location jump {dist_prev/1000:.1f} km"
        _create_alert(db, tourist.id, "anomaly", "high",
                      f"Anomaly detected: {reason}", lat, lng)
        alerts_raised.append("anomaly")
        # De-dupe: only open a new incident if there isn't already an unresolved
        # anomaly incident for this tourist in the last 5 minutes (avoids flooding
        # the incident feed when the tourist stays anomalous across many pings).
        recent = (
            db.query(Incident)
            .filter(
                Incident.tourist_id == tourist.id,
                Incident.type == "anomaly",
                Incident.status != "resolved",
                Incident.detected_at
                >= now - timedelta(minutes=settings.ANOMALY_INCIDENT_DEDUPE_MINUTES),
            )
            .first()
        )
        if not recent:
            _open_incident(db, tourist, "anomaly", "high",
                           f"AI anomaly: {reason}", lat, lng)

    # ---- route deviation ----
    if itinerary and dist_route > settings.ROUTE_DEVIATION_THRESHOLD_M:
        _create_alert(db, tourist.id, "route_deviation", "medium",
                      f"Route deviation: {dist_route/1000:.1f} km from planned itinerary",
                      lat, lng)
        alerts_raised.append("route_deviation")

    # ---- geofence ----
    zones = db.query(Zone).all()
    inside = zones_containing_point(lat, lng, zones)
    risky = [z for z in inside if z.risk_level in ("high", "restricted")]
    for z in risky:
        sev = _RISK_SEVERITY.get(z.risk_level, "medium")
        _create_alert(db, tourist.id, "geofence", sev,
                      f"Entered {z.risk_level} risk zone: {z.name}", lat, lng,
                      zone_id=z.id)
        alerts_raised.append("geofence")

    # ---- predicted geofence (trajectory forecast) ----
    # Preventive only: no incident dedup logic, just a heads-up alert before
    # the tourist actually reaches a high-risk/restricted zone.
    recent_pings = (
        db.query(LocationPing)
        .filter(LocationPing.tourist_id == tourist.id)
        .order_by(LocationPing.timestamp.desc())
        .limit(5)
        .all()
    )
    recent_pings = list(reversed(recent_pings))  # oldest-first for predict_trajectory
    predicted = predict_trajectory(recent_pings, settings.TRAJECTORY_HORIZON_MIN)
    crossing = predicts_crosses_zone(predicted, zones) if predicted else None
    if crossing:
        pz = crossing["zone"]
        sev = _RISK_SEVERITY.get(pz.risk_level, "medium")
        _create_alert(
            db, tourist.id, "predicted_geofence", sev,
            f"Predicted to enter {pz.risk_level} risk zone '{pz.name}' "
            f"in ~{crossing['eta_min']:.0f} min",
            lat, lng, zone_id=pz.id,
        )
        alerts_raised.append("predicted_geofence")

    # ---- safety score refresh ----
    ss = compute_safety_score(db, tourist, anomaly_score=anomaly["score"])
    tourist.safety_score = ss["score"]

    db.commit()
    broadcast_sync({
        "event": "location",
        "tourist_id": tourist.id,
        "digital_id": tourist.digital_id,
        "lat": lat, "lng": lng,
        "safety_score": ss["score"],
        "status": tourist.status,
    })

    return {
        "tourist_id": tourist.id,
        "anomaly": anomaly,
        "route_deviation_m": round(dist_route, 1),
        "in_zones": [z.name for z in inside],
        "alerts_raised": alerts_raised,
        "safety_score": ss["score"],
        "band": ss["band"],
    }


# Simple resting-heart-rate bounds. A real deployment would baseline per
# tourist (age, fitness); flat bounds are the same "explainable rule" spirit as
# the anomaly-detector's fallback path, and keep the demo self-contained.
_HR_LOW_BPM, _HR_HIGH_BPM = 40, 160


def process_device_telemetry(
    db: Session, tourist: Tourist, lat: float, lng: float, speed_kmh: float,
    heart_rate_bpm: float | None, sos_pressed: bool, fall_detected: bool,
) -> dict:
    """IoT-band telemetry: the same location pipeline as a phone ping, plus
    device-only signals a phone doesn't have (heart rate, a fall accelerometer
    trip, a physical SOS button)."""
    result = process_ping(db, tourist, lat, lng, speed_kmh)
    alerts_raised = result["alerts_raised"]

    if fall_detected:
        _create_alert(db, tourist.id, "fall_detected", "critical",
                      "Fall detected by wearable device", lat, lng)
        _open_incident(db, tourist, "fall_detected", "critical",
                       f"Possible fall detected by {tourist.full_name}'s band", lat, lng)
        alerts_raised.append("fall_detected")

    if heart_rate_bpm is not None and not (_HR_LOW_BPM <= heart_rate_bpm <= _HR_HIGH_BPM):
        _create_alert(db, tourist.id, "health_anomaly", "high",
                      f"Abnormal heart rate: {heart_rate_bpm:.0f} bpm", lat, lng)
        alerts_raised.append("health_anomaly")

    db.commit()

    if sos_pressed:
        result["sos"] = trigger_sos(db, tourist, lat, lng,
                                    "SOS button pressed on wearable device")

    return result


def trigger_sos(db: Session, tourist: Tourist, lat: float, lng: float, message: str) -> dict:
    """One-tap SOS: mark tourist, find nearest available police unit, open critical incident."""
    from app.models.police import PoliceUnit

    logger.warning("sos_triggered", tourist_id=tourist.id, lat=lat, lng=lng)
    tourist.status = "sos"
    tourist.last_lat, tourist.last_lng = lat, lng
    tourist.last_seen = utc_now()

    units = db.query(PoliceUnit).filter(PoliceUnit.available == True).all()  # noqa: E712
    nearest = min(units, key=lambda u: haversine_m(lat, lng, u.lat, u.lng), default=None)

    inc = _open_incident(db, tourist, "sos", "critical",
                         f"SOS triggered by {tourist.full_name}: {message}", lat, lng)
    if nearest:
        inc.assigned_unit_id = nearest.id
        inc.status = "dispatched"
        inc.dispatched_at = utc_now()
        db.add(IncidentEvent(incident_id=inc.id, status="dispatched",
                             note=f"Auto-dispatched to {nearest.name} ({nearest.station})"))

    _create_alert(db, tourist.id, "sos", "critical",
                  f"🚨 SOS from {tourist.full_name}", lat, lng)

    contacts = json.loads(tourist.emergency_contacts or "[]")
    for contact in contacts:
        notifications.get_channel().send(
            to=contact.get("phone", ""),
            subject=f"SOS alert from {tourist.full_name}",
            body=(
                f"{tourist.full_name} has triggered an SOS. Last known location: "
                f"{lat:.5f}, {lng:.5f}. Message: {message}"
            ),
        )
    db.commit()

    return {
        "incident_id": inc.id,
        "nearest_unit": {
            "name": nearest.name, "station": nearest.station,
            "phone": nearest.phone, "lat": nearest.lat, "lng": nearest.lng,
            "distance_km": round(haversine_m(lat, lng, nearest.lat, nearest.lng) / 1000, 2),
        } if nearest else None,
        "notified_contacts": contacts,
    }
