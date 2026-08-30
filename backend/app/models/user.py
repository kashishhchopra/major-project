"""Auth user accounts (police/admin operators and tourist logins)."""
from datetime import datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import utc_now
from app.db.session import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String, nullable=False)
    # role: "admin" (police/admin dashboard), "tourist", or "responder" (field
    # unit console)
    role: Mapped[str] = mapped_column(String, default="tourist", nullable=False)
    # link to tourist profile when role == tourist
    tourist_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # link to the police unit this account represents when role == responder
    unit_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=utc_now
    )
