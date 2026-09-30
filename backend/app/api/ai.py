from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.yandex_provider import YandexProvider

router = APIRouter(prefix="/api/ai", tags=["ai"])


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    card_title: str = Field(default="", max_length=300)
    card_body: str = Field(default="", max_length=12000)


@router.post("/chat")
async def chat(payload: ChatRequest) -> dict[str, str]:
    try:
        answer = await YandexProvider().complete([{
            "role": "system",
            "text": "Отвечай по-русски как персональный преподаватель. Учитывай контекст карточки. "
                    f"Заголовок: {payload.card_title}\nТекст: {payload.card_body}\n"
                    f"Вопрос ученика: {payload.question}",
        }], max_tokens=700)
        return {"answer": answer}
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
