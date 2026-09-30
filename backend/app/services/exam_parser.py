from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import asyncpg

from app.core.database import get_pool
from app.core.users import ensure_user
from app.core.yandex_provider import YandexProvider


SYSTEM_PROMPT = (
    "Ты методист ВУЗа и отвечаешь только на русском языке. Все title и summary должны быть "
    "на русском; английские термины допускай только в круглых скобках после русского термина. "
    "Формулы, обозначения, программный код и названия API не переводи и не изменяй: "
    "сохраняй их в исходном виде внутри строк JSON. На вход подан список вопросов к экзамену. "
    "Разбей список на МАКСИМАЛЬНО гранулированные микро-темы. Строго запрещено "
    "укрупнять, объединять или скрывать разные вопросы в одной общей теме. На каждый "
    "вопрос или билет создай минимум одну, предпочтительно две микро-темы. Если подано "
    "30 вопросов, верни от 30 до 40 топиков. Название должно описывать узкий факт, "
    "правило, механизм или подзадачу конкретного билета. "
    "Верни строгий JSON-массив без markdown, только словари "
    "{\"title\":\"Название микро-темы\",\"summary\":\"Коротко суть\", "
    "\"initial_questions_count\": N}."
)


@dataclass(frozen=True)
class ParsedTopic:
    title: str
    summary: str
    initial_questions_count: int


class ExamParserError(ValueError):
    pass


def _decode_json_array(raw: str) -> list[dict[str, Any]]:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text).strip()

    try:
        decoded = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("[")
        end = text.rfind("]")
        if start < 0 or end <= start:
            raise ExamParserError("YandexGPT returned invalid JSON") from None
        try:
            decoded = json.loads(text[start : end + 1])
        except json.JSONDecodeError as exc:
            raise ExamParserError("YandexGPT returned invalid JSON") from exc

    if not isinstance(decoded, list) or not decoded:
        raise ExamParserError("YandexGPT must return a non-empty JSON array")

    topics: list[dict[str, Any]] = []
    for index, item in enumerate(decoded):
        if not isinstance(item, dict):
            raise ExamParserError(f"Topic {index + 1} is not an object")
        title = str(item.get("title", "")).strip()
        summary = str(item.get("summary", "")).strip()
        count = item.get("initial_questions_count", 0)
        if not title or not summary:
            raise ExamParserError(f"Topic {index + 1} has no title or summary")
        if isinstance(count, bool) or not isinstance(count, int) or count < 0:
            raise ExamParserError(f"Topic {index + 1} has invalid initial_questions_count")
        topics.append(
            {
                "title": title[:300],
                "summary": summary,
                "initial_questions_count": count,
            }
        )
    return topics


class ExamParser:
    def __init__(self, provider: YandexProvider | None = None) -> None:
        self.provider = provider or YandexProvider()

    async def parse_and_persist(
        self,
        *,
        owner_id: UUID,
        name: str,
        question_text: str,
    ) -> UUID:
        if not question_text.strip():
            raise ExamParserError("question_text must not be empty")

        raw = await self.provider.complete(
            [
                {"role": "system", "text": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "text": f"Список вопросов к экзамену:\n{question_text.strip()}",
                },
            ],
            max_tokens=4000,
        )
        topics = _decode_json_array(raw)
        pool = await get_pool()
        async with pool.acquire() as connection:
            async with connection.transaction():
                await ensure_user(connection, owner_id)
                exam_id = await connection.fetchval(
                    """insert into exams(owner_id, name, source_questions)
                       values($1, $2, $3::jsonb) returning id""",
                    owner_id,
                    name.strip()[:200],
                    json.dumps({"text": question_text.strip()}),
                )
                for position, topic in enumerate(topics):
                    await connection.execute(
                        """insert into exam_topics(
                               exam_id, title, description, source_question_ids, position
                           ) values($1, $2, $3, $4::jsonb, $5)""",
                        exam_id,
                        topic["title"],
                        topic["summary"],
                        json.dumps({"initial_questions_count": topic["initial_questions_count"]}),
                        position,
                    )
        return UUID(str(exam_id))


async def parse_exam(
    *,
    owner_id: UUID,
    name: str,
    question_text: str,
    provider: YandexProvider | None = None,
) -> UUID:
    return await ExamParser(provider).parse_and_persist(
        owner_id=owner_id,
        name=name,
        question_text=question_text,
    )
