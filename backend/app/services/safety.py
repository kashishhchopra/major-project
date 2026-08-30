"""Compute a tourist's dynamic 0-100 safety score with an explainable breakdown."""

from sqlalchemy.orm import Session

from app.core.time import local_hour_for
from app.models.tourist import Tourist
from app.models.zone import Zone
from app.services import explain, ml_service, weather
from app.services.geo import zones_containing_point

_RISK_WEIGHT = {"low": 20.0, "medium": 50.0, "high": 80.0, "restricted": 100.0}


def band_for(score: float) -> str:
    if score >= 75:
        return "safe"
    if score >= 50:
        return "moderate"
    if score >= 25:
        return "risky"
    return "danger"


def compute_safety_score(
    db: Session, tourist: Tourist, anomaly_score: float = 0.1
) -> dict:
    """Returns {score, band, breakdown}. Uses the RandomForest model when available."""
    lat = tourist.last_lat if tourist.last_lat is not None else 0.0
    lng = tourist.last_lng if tourist.last_lng is not None else 0.0

    zones = db.query(Zone).all()
    inside = zones_containing_point(lat, lng, zones) if (lat or lng) else []
    if inside:
        worst = max(inside, key=lambda z: _RISK_WEIGHT.get(z.risk_level, 50))
        zone_risk = _RISK_WEIGHT.get(worst.risk_level, 50)
        crime_index = worst.crime_index
        zone_name = worst.name
    else:
        zone_risk, crime_index, zone_name = 15.0, 20.0, "open area"

    hour = local_hour_for(lat, lng)
    weather_risk = weather.get_weather_risk(lat, lng)

    feats = ml_service.safety_features(zone_risk, hour, anomaly_score, crime_index, weather_risk)
    score = ml_service.predict_safety_score(feats)

    breakdown = {
        "zone": zone_name,
        "zone_risk": zone_risk,
        "crime_index": crime_index,
        "hour": hour,
        "night_penalty": hour >= 22 or hour <= 5,
        "anomaly_score": round(anomaly_score, 3),
        "weather_risk": weather_risk,
        # Per-feature SHAP contributions for THIS prediction -- None when only
        # the rule-based fallback is active, since that's already an explicit
        # formula with nothing to decompose.
        "explanation": explain.explain_safety_score(feats),
    }
    return {"score": score, "band": band_for(score), "breakdown": breakdown}
