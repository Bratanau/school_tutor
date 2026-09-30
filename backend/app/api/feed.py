from uuid import UUID

from fastapi import APIRouter, HTTPException, Query

from app.core.settings import settings
from app.services.feed_algorithm import FeedAlgorithm, FeedRequest

router = APIRouter(prefix="/api/feed", tags=["feed"])


@router.get("/vertical")
async def vertical_feed(
    exam_id: UUID,
    user_id: UUID | None = None,
    cursor: int = Query(default=0, ge=0),
    limit: int = Query(default=15, ge=1, le=20),
) -> list[dict]:
    try:
        return await FeedAlgorithm().generate_vertical_feed(
            FeedRequest(
                user_id=user_id or UUID(settings.demo_user_id),
                exam_id=exam_id,
                cursor=cursor,
                limit=limit,
            )
        )
    except OSError as exc:
        raise HTTPException(status_code=503, detail="Database unavailable") from exc


@router.get("/horizontal")
async def horizontal_feed(
    topic_id: UUID,
    current_depth_level: int = Query(default=0, ge=0),
    user_id: UUID | None = None,
    limit: int = Query(default=2, ge=1, le=20),
) -> list[dict]:
    try:
        return await FeedAlgorithm().generate_horizontal_deep_dive(
            topic_id=topic_id,
            current_depth_level=current_depth_level,
            user_id=user_id or UUID(settings.demo_user_id),
            limit=limit,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except (RuntimeError, OSError) as exc:
        raise HTTPException(status_code=502, detail=f"Deep-dive generation failed: {exc}") from exc
