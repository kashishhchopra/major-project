from pydantic import BaseModel, Field


class CopilotQuestion(BaseModel):
    question: str = Field(..., min_length=1, max_length=500)


class CopilotAnswer(BaseModel):
    answer: str
    handled: bool
    # "llm" when the open-ended language model answered; absent when a
    # deterministic intent handler did (see services/copilot.py).
    source: str | None = None
