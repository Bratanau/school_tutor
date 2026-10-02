from __future__ import annotations

import json

import httpx

from dataclasses import dataclass
from typing import Any
from uuid import UUID
from urllib.parse import quote

from app.core.database import get_pool
from app.core.yandex_provider import YandexProvider
from app.services.wikipedia_service import search_wikipedia_image, search_wikipedia_images


@dataclass(frozen=True)
class FeedRequest:
    user_id: UUID
    exam_id: UUID
    topic_id: UUID | None = None
    cursor: int = 0
    limit: int = 15


DEEP_DIVE_SYSTEM_PROMPT = (
    "Твоя цель создать идеальные карточки для подготовки. Раздели информацию на логические "
    "карточки. Сам решай объем текста для каждой карточки: от одного важного предложения "
    "до большого исчерпывающего абзаца. Текст должен быть самодостаточным для изучения. "
    "Для каждой content-карточки верни wiki_search_query: точный заголовок статьи русской "
    "Википедии длиной 1-3 слова. Верни строгий JSON."
)


def _json_value(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def _wiki_proxy_url(image_url: str) -> str:
    return f"/api/wiki-image?url={quote(image_url, safe='')}"


class FeedAlgorithm:
    def __init__(self, provider: YandexProvider | None = None) -> None:
        self.provider = provider or YandexProvider()

    async def generate_vertical_feed(self, request: FeedRequest) -> list[dict[str, Any]]:
        pool = await get_pool()
        limit = min(max(request.limit, 1), 15)
        async with pool.acquire() as connection:
            rows = await connection.fetch(
                """select t.id, t.exam_id, t.title, t.description,
                          coalesce(k.mastery_score, 0)::float as mastery_score,
                          coalesce(k.exposure_seconds, 0) as exposure_seconds
                   from exam_topics t
                   left join user_knowledge k
                     on k.topic_id = t.id
                    and k.exam_id = t.exam_id
                    and k.user_id = $2
                   where t.exam_id = $1
                   order by coalesce(k.mastery_score, 0) asc, random()
                   limit $3""",
                request.exam_id,
                request.user_id,
                limit,
            )

        topics = [
            {
                "id": str(row["id"]),
                "exam_id": str(row["exam_id"]),
                "title": row["title"],
                "summary": row["description"],
                "mastery_score": float(row["mastery_score"]),
                "exposure_seconds": row["exposure_seconds"],
                "feed_type": "topic",
            }
            for row in rows
        ]
        return topics

    async def _hydrate_existing_cards(self, connection: Any, rows: list[Any]) -> list[dict[str, Any]]:
        responses = []
        for row in rows:
            if row["card_type"] == "content" and not row["media_url"]:
                try:
                    candidates = await search_wikipedia_images(row["title"])
                    if candidates:
                        choice = await self.provider.validate_wikipedia_candidates(
                            card_text=row["body"], candidates=candidates
                        )
                        index = choice["selected_index"]
                        if 0 <= index < len(candidates) and choice["caption"]:
                            await connection.execute(
                                "update cards set media_url = $1, media_caption = $2 where id = $3",
                                _wiki_proxy_url(candidates[index]["image_url"]), choice["caption"], row["id"],
                            )
                            row = dict(row)
                            row["media_url"] = _wiki_proxy_url(candidates[index]["image_url"])
                            row["media_caption"] = choice["caption"]
                    else:
                        wiki_media = await search_wikipedia_image(row["title"])
                        if wiki_media:
                            validation = await self.provider.validate_wikipedia_media(
                                card_text=row["body"], wiki_summary=wiki_media["wiki_summary"]
                            )
                            if validation["is_valid"] and validation["caption"]:
                                await connection.execute(
                                    "update cards set media_url = $1, media_caption = $2 where id = $3",
                                    _wiki_proxy_url(wiki_media["image_url"]), validation["caption"], row["id"],
                                )
                                row = dict(row)
                                row["media_url"] = _wiki_proxy_url(wiki_media["image_url"])
                                row["media_caption"] = validation["caption"]
                except (OSError, RuntimeError, ValueError, httpx.HTTPError):
                    pass
            responses.append(self._card_response(row))
        return responses

    async def generate_horizontal_deep_dive(
        self,
        *,
        topic_id: UUID,
        current_depth_level: int,
        user_id: UUID | None = None,
        limit: int = 2,
    ) -> list[dict[str, Any]]:
        if current_depth_level < 0:
            raise ValueError("current_depth_level must be non-negative")
        target_depth = current_depth_level + 1
        pool = await get_pool()
        async with pool.acquire() as connection:
            rows = await connection.fetch(
                """select id, topic_id, depth_level, position, card_type,
                          title, body, quiz_payload, media_url, media_caption, code_block, formula, generated_by
                   from cards
                   where topic_id = $1 and depth_level = $2
                   order by position
                   limit $3""",
                topic_id,
                target_depth,
                min(max(limit, 1), 20),
            )
            if rows:
                return await self._hydrate_existing_cards(connection, rows)
            knowledge = await connection.fetchrow(
                "select assessment_completed, initial_level, assessment_questions, assessment_answers, assessment_total from user_knowledge where user_id = $1 and exam_id = (select exam_id from exam_topics where id = $2) and topic_id = $2",
                user_id, topic_id,
            ) if user_id else None
            initial_level = int(knowledge["initial_level"]) if knowledge else 0
            topic = await connection.fetchrow(
                "select id, title, description, exam_id from exam_topics where id = $1",
                topic_id,
            )
            if not topic:
                raise LookupError("Topic not found")

        generated = await self.provider._generate_json_deep_dive(
            topic["title"], topic["description"], initial_level
        )
        if not isinstance(generated, list) or not generated:
            raise ValueError("YandexGPT returned invalid deep-dive cards")

        cards: list[dict[str, Any]] = []
        for item in generated:
            if not isinstance(item, dict):
                continue
            card_type = "quiz" if item.get("card_type") == "quiz" else "content"
            title = str(item.get("title", "")).strip()
            body = str(item.get("body", "")).strip()
            if title and body:
                cards.append(
                    {
                        "card_type": card_type,
                        "title": title[:300],
                        "body": body,
                        "quiz_payload": item.get("quiz_payload") if card_type == "quiz" else None,
                        "wiki_search_query": str(item.get("wiki_search_query", "")).strip(),
                        "wiki_search_query_en": str(item.get("wiki_search_query_en", "")).strip(),
                        "code_block": str(item.get("code_block") or "").strip() or None,
                        "formula": str(item.get("formula") or "").strip() or None,
                        "media_url": None,
                        "media_caption": None,
                    }
                )
        for card in cards:
            if card["card_type"] != "content" or not card["wiki_search_query"]:
                continue
            try:
                candidates = await search_wikipedia_images(card["wiki_search_query_en"] or card["wiki_search_query"])
                if candidates:
                    choice = await self.provider.validate_wikipedia_candidates(
                        card_text=card["body"], candidates=candidates
                    )
                    index = choice["selected_index"]
                    if 0 <= index < len(candidates) and choice["caption"]:
                        card["media_url"] = _wiki_proxy_url(candidates[index]["image_url"])
                        card["media_caption"] = choice["caption"]
                else:
                    wiki_media = await search_wikipedia_image(card["wiki_search_query"])
                    if wiki_media:
                        validation = await self.provider.validate_wikipedia_media(
                            card_text=card["body"], wiki_summary=wiki_media["wiki_summary"]
                        )
                        if validation["is_valid"] and validation["caption"]:
                            card["media_url"] = _wiki_proxy_url(wiki_media["image_url"])
                            card["media_caption"] = validation["caption"]
            except (OSError, RuntimeError, ValueError, httpx.HTTPError):
                continue
        if not cards:
            raise ValueError("YandexGPT returned no usable deep-dive cards")
        if not any(card["card_type"] == "quiz" for card in cards):
            raise ValueError("YandexGPT deep-dive response must contain a quiz card")
        card_limit = min(max(limit, 1), 20)
        if not any(card["card_type"] == "quiz" for card in cards[:card_limit]):
            quiz = next(card for card in cards if card["card_type"] == "quiz")
            cards = cards[: max(card_limit - 1, 0)] + [quiz]
        else:
            cards = cards[:card_limit]

        async with pool.acquire() as connection:
            async with connection.transaction():
                # The unique constraint makes concurrent misses converge on one depth level.
                for position, card in enumerate(cards):
                    await connection.execute(
                        """insert into cards(
                               topic_id, depth_level, position, card_type,
                               title, body, quiz_payload, media_url, media_caption, code_block, formula, generated_by
             ) values($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, 'yandexgpt')
                           on conflict (topic_id, depth_level, position) do nothing""",
                        topic_id,
                        target_depth,
                        position,
                        card["card_type"],
                        card["title"],
                        card["body"],
                        json.dumps(card["quiz_payload"]) if card["quiz_payload"] is not None else None,
                        card["media_url"],
                        card["media_caption"],
                        card["code_block"],
                        card["formula"],
                    )
                rows = await connection.fetch(
                    """select id, topic_id, depth_level, position, card_type,
                              title, body, quiz_payload, media_url, media_caption, code_block, formula, generated_by
                       from cards
                       where topic_id = $1 and depth_level = $2
                       order by position limit $3""",
                    topic_id,
                    target_depth,
                    min(max(limit, 1), 20),
                )
        return [self._card_response(row) for row in rows]

    @staticmethod
    def _card_response(row: Any) -> dict[str, Any]:
        return {
            "id": str(row["id"]),
            "topic_id": str(row["topic_id"]),
            "depth_level": row["depth_level"],
            "position": row["position"],
            "card_type": row["card_type"],
            "title": row["title"],
            "body": row["body"],
            "quiz_payload": _json_value(row["quiz_payload"]),
            "media_url": row["media_url"],
            "media_caption": row["media_caption"],
            "code_block": row["code_block"],
            "formula": row["formula"],
        }

    async def vertical(self, request: FeedRequest) -> list[dict[str, Any]]:
        return await self.generate_vertical_feed(request)

    async def horizontal(self, request: FeedRequest) -> list[dict[str, Any]]:
        if request.topic_id is None:
            raise ValueError("topic_id is required for horizontal feed")
        return await self.generate_horizontal_deep_dive(
            topic_id=request.topic_id,
            current_depth_level=request.cursor,
            user_id=request.user_id,
            limit=request.limit,
        )
