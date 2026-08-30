"""Geo-fenced risk zones defined as polygons."""
from sqlalchemy import Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class Zone(Base):
    __tablename__ = "zones"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    # risk_level: low / medium / high / restricted
    risk_level: Mapped[str] = mapped_column(String, default="medium")
    # polygon: JSON list of [lat, lng] vertices
    polygon: Mapped[str] = mapped_column(Text, nullable=False)
    # mock crime index 0-100 used by the safety-score model
    crime_index: Mapped[float] = mapped_column(Float, default=30.0)
    description: Mapped[str] = mapped_column(Text, default="")
    # auto = discovered by DBSCAN clustering, manual = defined by admin
    source: Mapped[str] = mapped_column(String, default="manual")
