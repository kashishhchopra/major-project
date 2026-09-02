"""Application configuration — fully environment-driven, safe defaults for dev.

Nothing security-sensitive is hardcoded. In production (ENVIRONMENT=production)
the app refuses to start unless a strong SECRET_KEY is provided.
"""
from __future__ import annotations

import secrets
import warnings
from pathlib import Path

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    # ---- environment ----
    ENVIRONMENT: str = "development"  # development | production
    PROJECT_NAME: str = "Smart Tourist Safety Monitoring & Incident Response System"
    API_V1_PREFIX: str = "/api"

    # ---- database ----
    # SQLite for dev; set DATABASE_URL=postgresql+psycopg://user:pass@host/db in prod
    DATABASE_URL: str = "sqlite:///./tourist_safety.db"
    DB_POOL_SIZE: int = 20
    DB_POOL_MAX_OVERFLOW: int = 20

    # ---- auth / JWT ----
    # Leave empty to auto-generate an ephemeral key in dev (tokens reset on restart).
    SECRET_KEY: str = ""
    # Where a generated dev key is cached so it survives restarts (dev only).
    DEV_SECRET_FILE: str = ".dev_secret"
    ALGORITHM: str = "HS256"
    # Short-lived on purpose: the refresh token (below) is what's actually
    # revocable, so access tokens should expire quickly rather than need
    # per-request denylist checks.
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days

    # ---- refresh-token cookie ----
    # The refresh token is set as an httpOnly cookie so it's never readable
    # by JS (unlike the access token, which the frontend keeps in memory) --
    # closes the XSS-exfiltration path on the one token that's actually
    # long-lived. Secure should be True behind HTTPS (i.e. always in prod);
    # False here only so plain-HTTP local dev still works.
    REFRESH_COOKIE_NAME: str = "refresh_token"
    REFRESH_COOKIE_PATH: str = "/api/auth"
    REFRESH_COOKIE_SECURE: bool = False
    REFRESH_COOKIE_SAMESITE: str = "strict"

    # ---- password policy ----
    MIN_PASSWORD_LENGTH: int = 8

    # ---- rate limiting (per client IP) ----
    RATE_LIMIT_ENABLED: bool = True
    LOGIN_RATE_LIMIT: int = 10          # attempts
    LOGIN_RATE_WINDOW_SECONDS: int = 300
    GLOBAL_RATE_LIMIT: int = 240        # requests
    GLOBAL_RATE_WINDOW_SECONDS: int = 60
    REGISTRATION_RATE_LIMIT: int = 5    # public digital-ID registrations
    REGISTRATION_RATE_WINDOW_SECONDS: int = 3600

    # ---- request hardening ----
    MAX_REQUEST_BODY_BYTES: int = 1_000_000  # 1 MB

    # ---- ML ----
    ML_MODELS_DIR: str = "ml_models"

    # ---- notifications ----
    # "console" logs instead of sending (default -- no external service
    # needed). See app/services/notifications.py for the extension point.
    NOTIFICATION_CHANNEL: str = "console"
    PASSWORD_RESET_TOKEN_EXPIRE_MINUTES: int = 30

    # ---- weather (safety-score input) ----
    # Empty = use the deterministic mock (no network needed, works offline).
    # Set to a real OpenWeatherMap API key (free tier) to use live conditions.
    OPENWEATHER_API_KEY: str = ""
    OPENWEATHER_TIMEOUT_SECONDS: float = 3.0
    WEATHER_CACHE_TTL_SECONDS: int = 600

    # ---- dispatch / escalation ----
    # Assumed average travel speed for a responding unit, used only to turn a
    # distance into a rough ETA estimate for the dispatch-ranking UI -- not a
    # claim about real traffic conditions.
    DISPATCH_ASSUMED_SPEED_KMH: float = 30.0
    # How often the background escalation job re-checks open incidents.
    ESCALATION_TICK_SECONDS: int = 30
    # How long an incident sits at each escalation stage before auto-advancing
    # to the next one if nobody has acknowledged it.
    ESCALATION_STAGE_TIMEOUT_SECONDS: int = 120

    # ---- check-in / check-out ----
    # How often the background job re-checks planned check-ins.
    CHECKIN_TICK_SECONDS: int = 30
    # Grace period after a missed check-in deadline before it escalates from
    # an alert to an incident -- "well before an SOS is ever pressed."
    CHECKIN_GRACE_MINUTES: int = 30

    # ---- privacy & consent ----
    # How often the background job purges location history past its
    # retention window (see services/privacy.py).
    RETENTION_PURGE_TICK_SECONDS: int = 3600
    # How often expired revoked-token rows are purged (see api/auth.py).
    TOKEN_PURGE_TICK_SECONDS: int = 3600

    # ---- scheduler / cross-worker job locking ----
    # False disables the scheduler entirely (e.g. a worker that should never
    # run background ticks). True is the default for a single-worker deploy;
    # with WEB_CONCURRENCY > 1 the job lock (app/core/joblock.py) still
    # prevents duplicate execution even though every worker has this True.
    SCHEDULER_ENABLED: bool = True
    JOB_LOCK_TTL_SECONDS: int = 120

    # ---- disaster & weather alert feeds ----
    # How often the background job refreshes area-level hazard advisories.
    DISASTER_TICK_SECONDS: int = 120
    # Name of a real disaster-advisory provider, if one is ever wired up.
    # Empty (the default) means the deterministic simulator runs -- no
    # external API/key is assumed to exist for this project. See
    # services/disaster.py.
    DISASTER_FEED_PROVIDER: str = ""
    # A CAP 1.2 feed URL to poll when DISASTER_FEED_PROVIDER is set. No
    # default is assumed live/stable -- NDMA SACHET's public feed is served
    # by a JS SPA with no documented XML/JSON endpoint discoverable without
    # provider cooperation (see services/cap.py's module docstring). Point
    # this at whatever CAP 1.2 source is actually available to you.
    DISASTER_FEED_URL: str = ""

    # ---- live-feed fallback ladder (see services/feeds.py) ----
    # False = snapshot-only, no network calls at all -- the demo-venue kill
    # switch (e.g. a hackathon hall with no reliable internet).
    FEEDS_ENABLED: bool = True
    FEED_CACHE_DIR: str = "feed_cache"
    FEED_TIMEOUT_SECONDS: int = 600

    # ---- external hash-chain anchoring ----
    # How often the background job anchors the chain's current root hash.
    ANCHOR_TICK_SECONDS: int = 1800
    # Where anchors are published. "local" (the default) appends to a local,
    # append-only JSON ledger file standing in for an external timestamping
    # service -- see services/anchoring.py for why, and how to point this at
    # a real one.
    ANCHOR_TARGET: str = "local"
    # Where the "external" ledger file lives -- stands in for a real public
    # timestamping service. A real deployment would point this integration
    # at an actual external store instead; see services/anchoring.py.
    ANCHOR_LEDGER_PATH: str = "anchor_ledger.jsonl"

    # ---- domain thresholds ----
    ROUTE_DEVIATION_THRESHOLD_M: float = 2000.0
    ANOMALY_INCIDENT_DEDUPE_MINUTES: int = 5
    # Digital Tourist Safety ID: a trip within this many hours of its end
    # shows as "expiring_soon" rather than "active" -- see services/tourist_id.py.
    ID_EXPIRING_SOON_HOURS: float = 24.0
    # How far ahead (minutes) each ping's trajectory is projected to check for
    # an imminent high-risk/restricted zone crossing.
    TRAJECTORY_HORIZON_MIN: float = 15.0
    # Lateral offset (metres) applied to a candidate route's midpoint waypoint
    # when perturbing the direct origin->destination line (see routing.py).
    ROUTE_CANDIDATE_OFFSET_M: float = 250.0
    # Distance (metres) between risk-sampling points along a candidate route.
    ROUTE_SAMPLE_INTERVAL_M: float = 100.0

    # ---- map defaults (surfaced to the frontend via /api/config) ----
    MAP_CENTER_LAT: float = 26.1445
    MAP_CENTER_LNG: float = 91.7362
    MAP_DEFAULT_ZOOM: int = 13

    # ---- CORS / hosts (comma-separated in env) ----
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"
    ALLOWED_HOSTS: str = "*"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def allowed_hosts_list(self) -> list[str]:
        return [h.strip() for h in self.ALLOWED_HOSTS.split(",") if h.strip()]

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT.lower() == "production"

    @field_validator("ENVIRONMENT")
    @classmethod
    def _valid_env(cls, v: str) -> str:
        if v.lower() not in ("development", "production", "test"):
            raise ValueError("ENVIRONMENT must be development, production or test")
        return v.lower()

    @model_validator(mode="after")
    def _finalize_secret(self) -> Settings:
        if not self.SECRET_KEY:
            if self.is_production:
                raise RuntimeError(
                    "SECRET_KEY must be set in production. Generate one with: "
                    "python -c \"import secrets; print(secrets.token_urlsafe(48))\""
                )
            # Dev convenience: generate a key once and persist it to a
            # gitignored file. It must be STABLE across restarts because the
            # digital-ID hash chain is keyed with it (see services/hashchain.py)
            # -- a fresh key each boot would invalidate every existing chain.
            key_file = Path(self.DEV_SECRET_FILE)
            if key_file.exists():
                self.SECRET_KEY = key_file.read_text(encoding="utf-8").strip()
            else:
                self.SECRET_KEY = secrets.token_urlsafe(48)
                try:
                    key_file.write_text(self.SECRET_KEY, encoding="utf-8")
                except OSError:
                    warnings.warn(
                        "Could not persist the dev SECRET_KEY; hash chains and "
                        "tokens will reset on restart.",
                        stacklevel=2,
                    )
        elif len(self.SECRET_KEY) < 32 and self.is_production:
            raise RuntimeError("SECRET_KEY is too short for production (need >= 32 chars).")

        if self.is_production and "*" in self.allowed_hosts_list:
            warnings.warn("ALLOWED_HOSTS='*' in production is insecure — set explicit hosts.",
                          stacklevel=2)
        return self


settings = Settings()
