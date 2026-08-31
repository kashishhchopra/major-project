from pydantic import BaseModel, Field


class CopilotQuestion(BaseModel):
    question: str = Field(..., min_length=1, max_length=500)


class CopilotAnswer(BaseModel):
    answer: str
    handled: bool
