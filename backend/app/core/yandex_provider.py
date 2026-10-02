
from typing import Any
import json

import httpx

from app.core.settings import settings


class YandexProvider:
    """Small YandexGPT adapter. Prompt-specific generation belongs in services."""

    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        self._client = client

    async def complete(self, messages: list[dict[str, str]], *, max_tokens: int = 4000) -> str:
        if not settings.yandex_api_key or not settings.yandex_folder_id:
            raise RuntimeError("YANDEX_API_KEY and YANDEX_FOLDER_ID are required")

        payload: dict[str, Any] = {
            "modelUri": f"gpt://{settings.yandex_folder_id}/{settings.yandex_model}/{settings.yandex_model_version}",
            "completionOptions": {"stream": False, "temperature": 0.2, "maxTokens": max_tokens},
            "messages": messages,
        }
        headers = {
            "Authorization": f"Api-Key {settings.yandex_api_key}",
            "Content-Type": "application/json",
        }
        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(timeout=60.0)
        try:
            response = await client.post(settings.yandex_endpoint, headers=headers, json=payload)
            response.raise_for_status()
            return response.json()["result"]["alternatives"][0]["message"]["text"]
        finally:
            if owns_client:
                await client.aclose()

    async def generate_initial_assessment(self, topic_title: str, topic_summary: str) -> dict[str, Any]:
        raw = await self.complete([{"role": "system", "text": (
            "Составь 12 коротких диагностических вопросов на русском языке по теме. "
            "Ответь только JSON без markdown: {\"questions\":[{\"question\":\"...\",\"options\":[\"...\"],\"correct_answer\":0}]}. "
            "Каждый вопрос должен проверять базовое понимание, не повторяй варианты. "
            f"Тема: {topic_title}. Описание: {topic_summary}"
        )}], max_tokens=1800)
        text = raw.strip().removeprefix("```json").removesuffix("```").strip()
        data = json.loads(text[text.find("{"):text.rfind("}") + 1])
        if not isinstance(data, dict) or not isinstance(data.get("questions"), list):
            raise ValueError("Invalid initial assessment")
        return {"questions": data["questions"][:12]}


    async def evaluate_initial_assessment(self, topic_title: str, questions: list[dict[str, Any]], answers: list[dict[str, Any]]) -> int:
        raw = await self.complete([{"role": "system", "text": (
            "Оцени результаты диагностического опроса ученика по теме. Определи уровень знаний от 0 до 100. "
            "Верни только JSON без markdown: {\"level\": 0}. Учитывай сложность вопросов и качество ответов. "
            f"Тема: {topic_title}. Вопросы и ответы: {json.dumps(list(zip(questions, answers)), ensure_ascii=False)}"
        )}], max_tokens=120)
        text = raw.strip().removeprefix("```json").removesuffix("```").strip()
        data = json.loads(text[text.find("{"):text.rfind("}") + 1])
        return max(0, min(100, int(data.get("level", 0))))
    async def validate_wikipedia_candidates(
        self, *, card_text: str, candidates: list[dict[str, str]]
    ) -> dict[str, Any]:
        context = "\n".join(f"{index}: {item['description']}" for index, item in enumerate(candidates))
        raw = await self.complete([{"role": "system", "text": (
            "Ты образовательный валидатор. Выбери одну наиболее подходящую реальную картинку "
            "для учебной карточки по описаниям кандидатов. Текст карточки: " + card_text + "\n"
            "Кандидаты:\n" + context + "\nОтветь только JSON: "
            "{\"selected_index\": 0, \"caption\": \"Короткая подпись на русском\"}. "
            "Если ни одна не подходит, selected_index должен быть -1."
        )}], max_tokens=250)
        text = raw.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            start, end = text.find("{"), text.rfind("}")
            if start < 0 or end <= start:
                raise ValueError("Invalid Wikipedia candidates JSON") from None
            data = json.loads(text[start:end + 1])
        index = int(data.get("selected_index", -1))
        return {"selected_index": index, "caption": str(data.get("caption") or "").strip()}

    async def validate_wikipedia_media(
        self, *, card_text: str, wiki_summary: str
    ) -> dict[str, Any]:
        """Approve a Wikipedia image from article context and produce a factual caption."""
        raw = await self.complete(
            [
                {
                    "role": "system",
                    "text": (
                        "Ты - образовательный валидатор. Учебный текст карточки: "
                        f"{card_text}. Из Википедии по этому запросу пришло изображение, "
                        f"его описание: {wiki_summary}. Скажи, подходит ли это изображение "
                        "по смыслу. Ответь только JSON: {\"is_valid\": true, "
                        "\"caption\": \"Короткая подпись к фото на 1 предложение\"}."
                    ),
                }
            ],
            max_tokens=250,
        )
        text = raw.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            start, end = text.find("{"), text.rfind("}")
            if start < 0 or end <= start:
                raise ValueError("YandexGPT returned invalid Wikipedia validation JSON") from None
            data = json.loads(text[start : end + 1])
        if not isinstance(data, dict):
            raise ValueError("YandexGPT Wikipedia validation must be an object")
        return {"is_valid": bool(data.get("is_valid")), "caption": str(data.get("caption") or "").strip()}

    async def _generate_json_deep_dive(self, topic_title: str, topic_summary: str, initial_level: int = 0) -> list[dict[str, Any]]:
        """Generate the next depth level in the response shape expected by FeedAlgorithm."""
        raw = await self.complete(
            [
                {
                    "role": "system",
                    "text": (
                        "Отвечай только на русском языке. Заголовки, объяснения, подписи и вопросы "
                        "всегда пиши по-русски. Английские термины допускай только после русского "
                        "эквивалента в скобках. Формулы, единицы измерения и фрагменты кода "
                        "сохраняй без изменений в строках JSON. "
                        f"Мы изучаем тему {topic_title}. Ученик прошел базовый уровень. "
                        f"Начальный уровень ученика: {initial_level}/100. "
                        "Твоя цель создать идеальные карточки для подготовки. Раздели информацию "
                        "на логические карточки. Сам решай объем текста для каждой карточки: от одного "
                        "важного предложения до большого исчерпывающего абзаца. Текст должен быть "
                        "самодостаточным для изучения. Добавь один Quiz в конце серии. Для каждой "
                        "Для каждой content-карточки верни wiki_search_query на русском и wiki_search_query_en: "
                        "Если тема связана с программированием, добавь короткий исполняемый фрагмент в code_block; иначе code_block=null. Если тема содержит формулы, добавь их в formula в LaTeX; иначе formula=null. "
                        "точное английское название статьи Википедии для поиска реальной картинки, 1-5 слов. "
                        "Верни строгий JSON-массив без markdown: "
                        "[{\"card_type\":\"content\",\"title\":\"...\",\"body\":\"...\","
                        "\"wiki_search_query\":\"...\",\"wiki_search_query_en\":\"...\"},"
                        "{\"card_type\":\"quiz\",\"title\":\"...\",\"body\":\"...\","
                        "\"quiz_payload\":{\"question\":\"...\",\"options\":[\"...\"],"
                        "\"correct_answer\":0}}]."
                    ),
                },
                {"role": "user", "text": f"Краткое описание темы: {topic_summary}"},
            ],
            max_tokens=2500,
        )
        text = raw.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            start, end = text.find("["), text.rfind("]")
            if start < 0 or end <= start:
                raise ValueError("YandexGPT returned invalid deep-dive JSON") from None
            data = json.loads(text[start : end + 1])
        if not isinstance(data, list):
            raise ValueError("YandexGPT deep-dive response must be an array")
        return data
