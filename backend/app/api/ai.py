from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.yandex_provider import YandexProvider

router = APIRouter(prefix="/api/ai", tags=["ai"])


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    card_title: str = ""
    card_body: str = ""


@router.post("/chat")
async def chat(payload: ChatRequest) -> dict[str, str]:
    try:
        answer = await YandexProvider().complete([
            {
                "role": "system",
                "text": "Ты помощник по учебной карточке. Отвечай кратко, понятно и на русском языке.",
            },
            {
                "role": "user",
                "text": f"Карточка: {payload.card_title}\nМатериал: {payload.card_body}\nВопрос: {payload.question}",
            },
        ], max_tokens=700)
        return {"answer": answer.strip()}
    except (OSError, RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
