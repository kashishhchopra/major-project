"""Mock police units for SOS dispatch."""
from sqlalchemy import Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class PoliceUnit(Base):
    __tablename__ = "police_units"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    station: Mapped[str] = mapped_column(String, nullable=False)
    phone: Mapped[str] = mapped_column(String, default="100")
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    available: Mapped[bool] = mapped_column(default=True)
