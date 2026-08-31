"""AI Safety Copilot: a chat-style assistant that translates signals the
platform already computes -- SHAP contributions, dispatch ranking, zone risk,
alert counts -- into plain-English sentences.

This is deliberately NOT a call to an external LLM: no API key is assumed to
exist, and answering from real, queried data is more honest for a safety
tool than a free-form generative response could be. It is a small,
extensible intent router (keyword/regex matching -> a handler that queries
the DB and formats a sentence), the same "mock-compatible, real data behind
a narrow interface" shape as services/weather.py. A real deployment could
swap the intent router for an LLM tool-calling loop over the same handlers
without changing any handler's contract.
"""
from __future__ import annotations

import re

from sqlalchemy.orm import Session

from app.models.alert import Alert
from app.models.incident import Incident
from app.models.police import PoliceUnit
from app.models.tourist import Tourist
from app.models.zone import Zone
from app.services import dispatch
from app.services.geo import haversine_m, zones_containing_point
from app.services.safety import band_for, compute_safety_score

_CONTRIBUTION_LABELS = {
    "zone_risk": "entering a higher-risk zone",
    "hour": "the time of day",
    "anomaly_score": "moving faster/differently than their usual pattern",
    "crime_index": "the area's crime index",
    "weather_risk": "current weather conditions",
}


def _find_tourist(db: Session, needle: str) -> Tourist | None:
    needle = needle.strip()
    if needle.isdigit():
        t = db.get(Tourist, int(needle))
        if t:
            return t
    return (
        db.query(Tourist)
        .filter(Tourist.full_name.ilike(f"%{needle}%") | Tourist.digital_id.ilike(f"%{needle}%"))
        .first()
    )


def _explain_sentence(tourist: Tourist, result: dict) -> str:
    contributions = (result["breakdown"].get("explanation") or {}).get("contributions")
    band = result["band"]
    if not contributions:
        return (
            f"{tourist.full_name}'s current safety score is {round(result['score'])} "
            f"({band}). Zone: {result['breakdown']['zone']}, "
            f"crime index {result['breakdown']['crime_index']}."
        )
    # Positive SHAP contribution = pushes score DOWN toward danger. Sorted by
    # magnitude, same "main driver" framing as the roadmap's worked example.
    ranked = sorted(contributions.items(), key=lambda kv: abs(kv[1]), reverse=True)
    parts = []
    for name, value in ranked[:3]:
        if abs(value) < 1:
            continue
        label = _CONTRIBUTION_LABELS.get(name, name)
        # SHAP contributions are on the SAFETY score (higher = safer): a
        # negative contribution pulled the safety score down, i.e. pushed
        # RISK up -- shown here as "+" against risk, matching how an
        # operator reads "what made this worse".
        sign = "+" if value < 0 else "-"
        parts.append(f"{label} ({sign}{abs(round(value))})")
    if not parts:
        return f"{tourist.full_name}'s score ({round(result['score'])}, {band}) is near its baseline -- no single factor dominates."
    driver = ranked[0][0]
    return (
        f"{tourist.full_name}'s risk is {band} (score {round(result['score'])}). "
        f"Main factors: {', '.join(parts)}. "
        f"Primary driver: {_CONTRIBUTION_LABELS.get(driver, driver)}."
    )


def _intent_why_flagged(db: Session, question: str) -> str | None:
    m = re.search(r"(?:why (?:was|is)|explain).*?tourist[s]?\s*#?\s*([\w\-]+)", question, re.I)
    if not m:
        return None
    tourist = _find_tourist(db, m.group(1))
    if not tourist:
        return f"I couldn't find a tourist matching \"{m.group(1)}\"."
    result = compute_safety_score(db, tourist)
    return _explain_sentence(tourist, result)


def _intent_at_risk_list(db: Session, question: str) -> str | None:
    if not re.search(r"(risk|danger|flagged|jumped|dropped).*(tourist|who|which)|which tourist", question, re.I):
        return None
    at_risk = (
        db.query(Tourist)
        .filter(Tourist.safety_score < 50)
        .order_by(Tourist.safety_score.asc())
        .limit(5)
        .all()
    )
    if not at_risk:
        return "No tourists are currently below a safe score -- everyone tracked is at 50+."
    lines = [f"{t.full_name} ({t.digital_id}): {round(t.safety_score)} [{band_for(t.safety_score)}]"
             for t in at_risk]
    return "Tourists currently at elevated risk:\n" + "\n".join(lines)


def _intent_alert_summary(db: Session, question: str) -> str | None:
    if not re.search(r"how many.*alert|alert.*count|active alert", question, re.I):
        return None
    active = db.query(Alert).filter(Alert.acknowledged.is_(False)).count()
    critical = db.query(Alert).filter(
        Alert.acknowledged.is_(False), Alert.severity == "critical"
    ).count()
    return f"There are {active} unacknowledged alerts right now, {critical} of them critical."


def _intent_open_incidents(db: Session, question: str) -> str | None:
    if not re.search(r"open incident|incident.*(open|pending)|how many incident", question, re.I):
        return None
    open_count = db.query(Incident).filter(Incident.status != "resolved").count()
    return f"There are {open_count} open incidents right now."


def _intent_dispatch(db: Session, question: str) -> str | None:
    m = re.search(r"(?:nearest unit|dispatch).*?tourist[s]?\s*#?\s*([\w\-]+)", question, re.I)
    if not m:
        return None
    tourist = _find_tourist(db, m.group(1))
    if not tourist or tourist.last_lat is None:
        return "I don't have a live location for that tourist."
    ranked = dispatch.rank_units(db, tourist.last_lat, tourist.last_lng)
    if not ranked:
        return f"No response units are currently available near {tourist.full_name}."
    top = ranked[0]
    return (
        f"Nearest unit to {tourist.full_name}: {top['name']} ({top['unit_type']}), "
        f"{top['distance_km']} km away, ETA ~{round(top['eta_min'])} min."
    )


def answer_operator_question(db: Session, question: str) -> dict:
    """Control-room side: operational questions about the live situation."""
    for handler in (
        _intent_why_flagged, _intent_dispatch, _intent_at_risk_list,
        _intent_alert_summary, _intent_open_incidents,
    ):
        answer = handler(db, question)
        if answer:
            return {"answer": answer, "handled": True}
    return {
        "answer": (
            "I can answer questions like: \"why was tourist 104 flagged?\", "
            "\"which tourists are at risk?\", \"how many active alerts?\", "
            "\"how many open incidents?\", or \"nearest unit to tourist 104\"."
        ),
        "handled": False,
    }


# ---------------------------------------------------------------- tourist side
def _nearest_help(db: Session, tourist: Tourist, unit_types: list[str]) -> str:
    if tourist.last_lat is None:
        return "I don't have your current location yet -- enable tracking first."
    units = db.query(PoliceUnit).filter(PoliceUnit.available.is_(True)).all()
    candidates = [u for u in units if u.unit_type in unit_types] or units
    if not candidates:
        return "No response units are registered nearby right now."
    nearest = min(candidates, key=lambda u: haversine_m(tourist.last_lat, tourist.last_lng, u.lat, u.lng))
    km = round(haversine_m(tourist.last_lat, tourist.last_lng, nearest.lat, nearest.lng) / 1000, 1)
    return f"Nearest {nearest.unit_type}: {nearest.name} at {nearest.station}, about {km} km away. Call {nearest.phone}."


def _intent_nearest_hospital(db: Session, tourist: Tourist, question: str) -> str | None:
    if not re.search(r"hospital|medical|ambulance|doctor", question, re.I):
        return None
    return _nearest_help(db, tourist, ["ambulance"])


def _intent_nearest_police(db: Session, tourist: Tourist, question: str) -> str | None:
    if not re.search(r"police|station|officer", question, re.I):
        return None
    return _nearest_help(db, tourist, ["police"])


def _intent_area_safe(db: Session, tourist: Tourist, question: str) -> str | None:
    if not re.search(r"safe|danger|risky|area", question, re.I):
        return None
    if tourist.last_lat is None:
        return "I don't have your current location yet -- enable tracking first."
    zones = db.query(Zone).all()
    inside = zones_containing_point(tourist.last_lat, tourist.last_lng, zones)
    band = band_for(tourist.safety_score)
    if not inside:
        return f"You're in an open area with no defined risk zone. Your current safety band is {band}."
    worst = max(inside, key=lambda z: {"low": 0, "medium": 1, "high": 2, "restricted": 3}.get(z.risk_level, 1))
    return (
        f"You're inside \"{worst.name}\" ({worst.risk_level} risk). "
        f"Your current safety band is {band}. "
        + ("Consider moving to a lower-risk area." if worst.risk_level in ("high", "restricted") else "Stay alert but this is generally fine.")
    )


def _intent_advice(db: Session, tourist: Tourist, question: str) -> str | None:
    if not re.search(r"what should i do|advice|help me|guidance", question, re.I):
        return None
    band = band_for(tourist.safety_score)
    advice = {
        "safe": "You're in good shape. Keep tracking on and enjoy your trip.",
        "moderate": "Stay aware of your surroundings, stick to your itinerary, and keep your phone charged.",
        "risky": "Consider moving toward a safer area, let your Trip Guardian know where you are, and avoid isolated spots.",
        "danger": "This is a high-risk situation. Move to a populated area now, and use the SOS button if you feel unsafe.",
    }
    return advice.get(band, "Stay alert and keep tracking enabled.")


def _intent_why_flagged_self(db: Session, tourist: Tourist, question: str) -> str | None:
    if not re.search(r"why (was|is) (i|my risk|my score)|why flagged|why am i", question, re.I):
        return None
    result = compute_safety_score(db, tourist)
    return _explain_sentence(tourist, result)


def answer_tourist_question(db: Session, tourist: Tourist, question: str) -> dict:
    """Tourist side: nearest help, area safety, plain-language guidance."""
    for handler in (
        _intent_nearest_hospital, _intent_nearest_police, _intent_area_safe,
        _intent_why_flagged_self, _intent_advice,
    ):
        answer = handler(db, tourist, question)
        if answer:
            return {"answer": answer, "handled": True}
    return {
        "answer": (
            "I can help with: \"nearest hospital\", \"nearest police station\", "
            "\"is this area safe?\", \"why was I flagged?\", or \"what should I do now?\"."
        ),
        "handled": False,
    }
