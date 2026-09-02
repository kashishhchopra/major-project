"""Translation service abstraction, backed by Google Cloud Translation when
`settings.GOOGLE_TRANSLATE_API_KEY` is set, and a small built-in emergency
phrasebook when it isn't -- same shape as services/maps.py and
services/weather.py: one narrow interface, a real backend when a key
exists, a deterministic and clearly-labelled fallback when it doesn't.

The phrasebook only ever covers a fixed, curated set of safety-critical
phrases (not arbitrary free text) -- translating open-ended text without a
real NMT backend would mean fabricating a translation, which this project's
own rules explicitly forbid. Free text with no key configured is returned
unmodified, `demo: True`, with a note saying so.
"""
from __future__ import annotations

import logging

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

SUPPORTED_LANGUAGES = {
    "en": "English", "hi": "Hindi", "fr": "French", "de": "German",
    "es": "Spanish", "ja": "Japanese", "zh": "Chinese", "ko": "Korean",
    "ar": "Arabic",
}

# Curated safety-critical phrases, keyed by a stable phrase id -- real,
# reviewed translations (not machine-generated at request time), used only
# when no live translation API is configured. Extend this table rather than
# ever guessing a translation for an unlisted phrase.
_PHRASEBOOK: dict[str, dict[str, str]] = {
    "need_doctor": {
        "en": "I need a doctor. I am injured.",
        "hi": "मुझे डॉक्टर चाहिए। मैं घायल हूँ।",
        "fr": "J'ai besoin d'un médecin. Je suis blessé(e).",
        "de": "Ich brauche einen Arzt. Ich bin verletzt.",
        "es": "Necesito un médico. Estoy herido/a.",
        "ja": "医者が必要です。怪我をしています。",
        "zh": "我需要医生。我受伤了。",
        "ko": "의사가 필요해요. 다쳤어요.",
        "ar": "أحتاج إلى طبيب. أنا مصاب.",
    },
    "call_police": {
        "en": "Please call the police.",
        "hi": "कृपया पुलिस को बुलाएँ।",
        "fr": "Veuillez appeler la police.",
        "de": "Bitte rufen Sie die Polizei.",
        "es": "Por favor llame a la policía.",
        "ja": "警察を呼んでください。",
        "zh": "请报警。",
        "ko": "경찰을 불러주세요.",
        "ar": "من فضلك اتصل بالشرطة.",
    },
    "lost": {
        "en": "I am lost. Can you help me?",
        "hi": "मैं रास्ता भटक गया/गई हूँ। क्या आप मेरी मदद कर सकते हैं?",
        "fr": "Je suis perdu(e). Pouvez-vous m'aider ?",
        "de": "Ich habe mich verirrt. Können Sie mir helfen?",
        "es": "Estoy perdido/a. ¿Puede ayudarme?",
        "ja": "道に迷いました。手伝ってもらえますか。",
        "zh": "我迷路了。你能帮帮我吗？",
        "ko": "길을 잃었어요. 도와주시겠어요?",
        "ar": "أنا تائه. هل يمكنك مساعدتي؟",
    },
    "need_hospital": {
        "en": "Where is the nearest hospital?",
        "hi": "सबसे नज़दीकी अस्पताल कहाँ है?",
        "fr": "Où est l'hôpital le plus proche ?",
        "de": "Wo ist das nächste Krankenhaus?",
        "es": "¿Dónde está el hospital más cercano?",
        "ja": "一番近い病院はどこですか。",
        "zh": "最近的医院在哪里？",
        "ko": "가장 가까운 병원이 어디예요?",
        "ar": "أين أقرب مستشفى؟",
    },
    "thank_you": {
        "en": "Thank you for your help.",
        "hi": "आपकी मदद के लिए धन्यवाद।",
        "fr": "Merci pour votre aide.",
        "de": "Danke für Ihre Hilfe.",
        "es": "Gracias por su ayuda.",
        "ja": "助けてくれてありがとうございます。",
        "zh": "谢谢你的帮助。",
        "ko": "도와주셔서 감사합니다.",
        "ar": "شكرا لمساعدتك.",
    },
}


def list_phrase_ids() -> list[str]:
    return sorted(_PHRASEBOOK.keys())


def translate_phrase(phrase_id: str, target_lang: str) -> dict:
    """Translate a known safety-critical phrase into `target_lang`. Always
    succeeds for a listed phrase/language pair (real, reviewed text) --
    this is the path emergency UI should use, since it never depends on a
    live API being reachable."""
    entry = _PHRASEBOOK.get(phrase_id)
    if entry is None:
        return {"text": None, "demo": True, "error": f"Unknown phrase: {phrase_id}"}
    text = entry.get(target_lang, entry["en"])
    return {"text": text, "demo": False, "phrase_id": phrase_id, "lang": target_lang}


def translate_text(text: str, target_lang: str, source_lang: str | None = None) -> dict:
    """Translate arbitrary free text. Real (Google Cloud Translation) when a
    key is configured; with no key, the text is returned unmodified and
    clearly marked `demo: True` -- fabricating a translation would be worse
    than admitting the capability isn't available."""
    if settings.GOOGLE_TRANSLATE_API_KEY:
        try:
            resp = httpx.post(
                "https://translation.googleapis.com/language/translate/v2",
                params={"key": settings.GOOGLE_TRANSLATE_API_KEY},
                json={
                    "q": text, "target": target_lang,
                    **({"source": source_lang} if source_lang else {}),
                },
                timeout=5.0,
            )
            resp.raise_for_status()
            data = resp.json()
            translation = data["data"]["translations"][0]
            return {
                "text": translation["translatedText"], "demo": False,
                "detected_source_lang": translation.get("detectedSourceLanguage"),
            }
        except (httpx.HTTPError, KeyError, IndexError, ValueError) as e:
            logger.warning("Translation API request failed, falling back: %s", e)

    return {
        "text": text, "demo": True,
        "note": "Live translation is unavailable in demo mode; showing the original text.",
    }
