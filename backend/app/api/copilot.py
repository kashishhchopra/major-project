"""AI Safety Copilot: control-room and tourist-facing chat endpoints. See
services/copilot.py for the intent router these call into."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import require_admin_or_responder, require_self_or_admin
from app.db.session import get_db
from app.models.tourist import Tourist
from app.models.user import User
from app.schemas.copilot import CopilotAnswer, CopilotQuestion
from app.services import copilot

router = APIRouter(tags=["copilot"])


@router.post("/copilot/ask", response_model=CopilotAnswer)
def ask_operator_copilot(payload: CopilotQuestion, db: Session = Depends(get_db),
                         _: User = Depends(require_admin_or_responder)):
    return copilot.answer_operator_question(db, payload.question)


@router.post("/tourists/{tourist_id}/copilot/ask", response_model=CopilotAnswer)
def ask_tourist_copilot(tourist_id: int, payload: CopilotQuestion, db: Session = Depends(get_db),
                        _: User = Depends(require_self_or_admin)):
    t = db.get(Tourist, tourist_id)
    if not t:
        raise HTTPException(status_code=404, detail="Tourist not found")
    return copilot.answer_tourist_question(db, t, payload.question)
