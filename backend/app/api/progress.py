from uuid import UUID

import asyncpg
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.settings import settings
from app.services.progress_tracker import ProgressEvent, ProgressTracker

router = APIRouter(prefix="/api/progress", tags=["progress"])


class TrackQuizRequest(BaseModel):
    exam_id: UUID
    topic_id: UUID
    is_correct: bool
    user_id: UUID | None = None
    card_id: UUID | None = None
    is_initial: bool = False


class TrackQuizResponse(BaseModel):
    mastery_score: float


class AssessmentAnswerRequest(BaseModel):
    exam_id: UUID
    topic_id: UUID
    question_index: int = Field(ge=0)
    answer_index: int = Field(ge=0)
    user_id: UUID | None = None


@router.get("/assessment")
async def get_assessment(topic_id: UUID, exam_id: UUID, user_id: UUID | None = None) -> dict:
    try:
        return await ProgressTracker().get_assessment(
            user_id=user_id or UUID(settings.demo_user_id), exam_id=exam_id, topic_id=topic_id
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (asyncpg.PostgresError, OSError, TimeoutError, RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=503 if isinstance(exc, (asyncpg.PostgresError, TimeoutError)) else 502, detail="PostgreSQL is unavailable. Start the database and verify DATABASE_URL." if isinstance(exc, (asyncpg.PostgresError, TimeoutError)) else str(exc)) from exc



@router.post("/assessment-answer")
async def assessment_answer(payload: AssessmentAnswerRequest) -> dict:
    try:
        return await ProgressTracker().complete_assessment(
            user_id=payload.user_id or UUID(settings.demo_user_id),
            exam_id=payload.exam_id,
            topic_id=payload.topic_id,
            question_index=payload.question_index,
            answer_index=payload.answer_index,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (asyncpg.PostgresError, OSError, TimeoutError, RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=503 if isinstance(exc, (asyncpg.PostgresError, TimeoutError)) else 502, detail="PostgreSQL is unavailable. Start the database and verify DATABASE_URL." if isinstance(exc, (asyncpg.PostgresError, TimeoutError)) else str(exc)) from exc



@router.post("/track-quiz", response_model=TrackQuizResponse)
async def track_quiz(payload: TrackQuizRequest) -> TrackQuizResponse:
    try:
        mastery_score = await ProgressTracker().track_quiz(
            ProgressEvent(
                user_id=payload.user_id or UUID(settings.demo_user_id),
                exam_id=payload.exam_id,
                topic_id=payload.topic_id,
                card_id=payload.card_id,
                is_initial=payload.is_initial,
                quiz_correct=payload.is_correct,
            )
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (asyncpg.PostgresError, OSError, TimeoutError) as exc:
        raise HTTPException(status_code=503, detail="PostgreSQL is unavailable. Start the database and verify DATABASE_URL.") from exc
    return TrackQuizResponse(mastery_score=mastery_score)
