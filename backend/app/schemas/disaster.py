from datetime import datetime

from pydantic import BaseModel


class DisasterAdvisoryOut(BaseModel):
    id: int
    zone_id: int
    hazard_type: str
    severity: str
    message: str
    source: str
    active: bool
    issued_at: datetime
    expires_at: datetime | None

    class Config:
        from_attributes = True
