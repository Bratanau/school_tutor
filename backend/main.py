from __future__ import annotations

import asyncio
import io
import json
import os
import re
import time
import uuid
from typing import Literal

import base64  # ОБЯЗАТЕЛЬНО добавить для ЯндексАРТ!
import boto3   # ОБЯЗАТЕЛЬНО добавить для S3/Yandex Storage!


import os

import asyncpg
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from pypdf import PdfReader

load_dotenv()

MAX_FILE_SIZE = 25 * 1024 * 1024
MAX_SOURCE_CHARS = 12000
MOCK_USER_ID = "00000000-0000-0000-0000-000000000123"
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://scrolled:scrolled@127.0.0.1:5432/scrolled")

# --- Yandex Cloud вместо Gemini ---
YANDEX_API_KEY = os.getenv("YANDEX_API_KEY")            # Api-Key из сервисного аккаунта
YANDEX_FOLDER_ID = os.getenv("YANDEX_FOLDER_ID")        # folder id в Yandex Cloud
YANDEX_MODEL = os.getenv("YANDEX_MODEL", "yandexgpt-lite")  # или yandexgpt, yandexgpt-32k
YANDEX_MODEL_VERSION = os.getenv("YANDEX_MODEL_VERSION", "latest")
YANDEX_ENDPOINT = "https://llm.api.cloud.yandex.net/foundationModels/v1/completion"

YANDEX_RETRY_ATTEMPTS = 3
YANDEX_RETRY_DELAYS = (2, 5)

'''GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
GEMINI_RETRY_ATTEMPTS = 3
GEMINI_RETRY_DELAYS = (2, 5)'''

ENFORCE_BOOK_LIMIT = os.getenv("ENFORCE_BOOK_LIMIT", "false").lower() == "true"
_db_pool: asyncpg.Pool | None = None
REVENUECAT_WEBHOOK_SECRET = os.getenv("REVENUECAT_WEBHOOK_SECRET")

app = FastAPI(title="ScrollEd API", version="0.2.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=False, allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["*"])
@app.middleware("http")
async def request_logger(request: Request, call_next):
    started = time.perf_counter()
    print(f"[HTTP] -> {request.method} {request.url.path}", flush=True)
    try:
        response = await call_next(request)
    except Exception as exc:
        print(f"[HTTP] !! {request.method} {request.url.path}: {exc}", flush=True)
        raise
    elapsed_ms = (time.perf_counter() - started) * 1000
    print(f"[HTTP] <- {response.status_code} {request.method} {request.url.path} {elapsed_ms:.0f}ms", flush=True)
    return response


class ContentCard(BaseModel):
    id: str | None = None
    text: str = Field(min_length=1)
    type: Literal["text", "audio"]
    title: str | None = None
    audioUrl: str | None = None
    imageUrl: str | None = None
    likesCount: int = 0
    isLiked: bool = False
    commentsCount: int = 0


class CommentResponse(BaseModel):
    id: str
    text: str
    createdAt: str
    authorName: str


class CommentCreate(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


class Quiz(BaseModel):
    question: str = Field(min_length=1)
    options: list[str] = Field(min_length=2, max_length=6)
    correctAnswer: int = Field(ge=0)

    @field_validator("correctAnswer")
    @classmethod
    def answer_must_match_options(cls, value: int, info):
        options = info.data.get("options", [])
        if options and value >= len(options):
            raise ValueError("correctAnswer must point to an option")
        return value


class TopicResponse(BaseModel):
    title: str = Field(min_length=1)
    cards: list[ContentCard] = Field(min_length=3, max_length=5)
    quiz: Quiz

class YandexProvider:
    def __init__(self):
        self.api_key = YANDEX_API_KEY
        self.folder_id = YANDEX_FOLDER_ID
        self.headers = {
            "Authorization": f"Api-Key {self.api_key}",
        }
        self.gpt_endpoint = "https://llm.api.cloud.yandex.net/foundationModels/v1/completion"
        self.art_endpoint = "https://llm.api.cloud.yandex.net/foundationModels/v1/imageGenerationAsync"
        self.operations_endpoint = "https://llm.api.cloud.yandex.net/operations"
        self.tts_endpoint = "https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize"

    async def _generate_json(self, source_text: str) -> list[dict]:
        """Возвращает сырые словари карточек из GPT, у которых будет text и imagePrompt."""
        system_prompt = (
            "Ты — ИИ-креатор ленты коротких видео (Reels/TikTok) для учебников. "
            "Ответь СТРОГО массивом JSON-объектов `[{ ... }]`. Для каждой карточки выдай 'text' (содержание факта на русском) "
            "и 'imagePrompt' (короткое детальное описание того, что нарисовать нейросети на фоне — СТРОГО на АНГЛИЙСКОМ языке). "
            "Возвращай 3-4 объекта карточки."
        )
        payload = {
            "modelUri": f"gpt://{self.folder_id}/{YANDEX_MODEL}/latest",
            "completionOptions": {"stream": False, "temperature": 0.4, "maxTokens": 2000},
            "messages": [
                {"role": "system", "text": system_prompt},
                {"role": "user", "text": f"Текст учебника:\n{source_text}"},
            ],
        }
        async with httpx.AsyncClient(timeout=40.0) as client:
            resp = await client.post(self.gpt_endpoint, headers=self.headers, json=payload)
            resp.raise_for_status()
            text = _strip_code_fence(resp.json()["result"]["alternatives"][0]["message"]["text"])
            return json.loads(text)

    async def _generate_image_s3(self, prompt: str) -> str:
        """Связка YandexART + Polling -> загрузка картинки в S3"""
        payload = {
            "modelUri": f"art://{self.folder_id}/yandex-art/latest",
            "generationOptions": {"aspectRatio": {"widthRatio": 9, "heightRatio": 16}},  # Вертикально для телефона
            "messages": [{"text": prompt, "weight": 1}]
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            # 1. Запуск операции YandexART
            start_resp = await client.post(self.art_endpoint, headers=self.headers, json=payload)
            start_resp.raise_for_status()
            operation_id = start_resp.json()["id"]

            # 2. Polling операции, пока done == true
            while True:
                await asyncio.sleep(2)
                op_resp = await client.get(f"{self.operations_endpoint}/{operation_id}", headers=self.headers)
                op_resp.raise_for_status()
                op_data = op_resp.json()
                if op_data.get("done"):
                    base64_str = op_data["response"]["image"]
                    image_bytes = base64.b64decode(base64_str)
                    break
            
            # 3. Отдаем в хранилище (Bucket S3) и возвращаем урл
            return await upload_to_storage(image_bytes, "jpeg")

    async def _generate_tts_s3(self, text: str) -> str:
        """Связка Yandex SpeechKit -> Загрузка аудио в S3"""
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                self.tts_endpoint,
                headers=self.headers,
                data={
                    "text": text,
                    "voice": "filipp",     # Хороший дикторский голос Яндекса
                    "folderId": self.folder_id,
                    "format": "mp3"
                }
            )
            resp.raise_for_status()
            # Бинарный mp3 файл
            return await upload_to_storage(resp.content, "mp3")


def generate_topic_without_ai(source_text: str) -> TopicResponse:
    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", source_text.replace("\n", " ")) if part.strip()]
    sentences = [sentence[:700] for sentence in sentences]
    if not sentences:
        raise ValueError("PDF contains no usable sentences")

    groups = min(4, max(3, len(sentences)))
    chunk_size = max(1, len(sentences) // groups)
    cards: list[ContentCard] = []
    titles = ["Главная мысль", "Важный факт", "Подробнее", "Короткий итог"]
    for index in range(groups):
        start = index * chunk_size
        end = len(sentences) if index == groups - 1 else min(len(sentences), start + chunk_size)
        text = " ".join(sentences[start:end]).strip()
        if text:
            cards.append(ContentCard(type="text", title=titles[index], text=text))

    while len(cards) < 3:
        cards.append(ContentCard(type="text", title=titles[len(cards)], text=sentences[min(len(cards), len(sentences) - 1)]))
    cards = cards[:5]
    answer = cards[0].text
    distractors = [card.text for card in cards[1:3]]
    options = [answer, *distractors]
    while len(options) < 2:
        options.append("В тексте нет такого утверждения")
    return TopicResponse(
        title=(sentences[0][:80].rstrip(".!?") or "Новый учебный материал"),
        cards=cards[:5],
        quiz=Quiz(
            question="Какое утверждение встречается в начале материала?",
            options=options[:3],
            correctAnswer=0,
        ),
    )

async def generate_topic(source_text: str) -> TopicResponse:
    provider = YandexProvider()
    
    # 1. Просим YandexGPT разделить текст и придумать Image-промпты
    raw_cards = await provider._generate_json(source_text)
    
    completed_cards = []
    title = raw_cards[0]["text"][:30] + "..." if raw_cards else "Обучение"
    
    for i, raw_card in enumerate(raw_cards):
        text = raw_card["text"]
        img_prompt = raw_card.get("imagePrompt", f"educational conceptual art, vertical, high resolution")

        # Магия здесь! asyncio.gather генерирует звук И картинку параллельно, экономя огромное количество секунд.
        try:
            image_url, audio_url = await asyncio.gather(
                provider._generate_image_s3(img_prompt),
                provider._generate_tts_s3(text)
            )
        except Exception as exc:
            print(f"[Yandex] AI Generation Failed: {exc}")
            image_url = "https://picsum.photos/400/800" # Заглушка, если генерация упала
            audio_url = "" 
            
        completed_cards.append(ContentCard(
            id=str(uuid.uuid4()),
            type="audio",
            title=f"Урок {i+1}",
            text=text,
            imageUrl=image_url,
            audioUrl=audio_url
        ))

    # Сюда можно так же вернуть Quiz из Prompt №5, я убрал для краткости
    mock_quiz = Quiz(question="Всё понятно?", options=["Да","Нет"], correctAnswer=0)
    
    return TopicResponse(title=title, cards=completed_cards, quiz=mock_quiz)

async def upload_to_storage(file_bytes: bytes, extension: str) -> str:
    # Заглушка, чтобы не требовать реальные доступы в локальном тесте:
    # Для продакшена раскомментируй блок Boto3 ниже!
    
    '''
    s3_client = boto3.client('s3', endpoint_url=S3_ENDPOINT_URL, region_name='ru-central1')
    filename = f"{uuid.uuid4()}.{extension}"
    s3_client.put_object(Bucket=S3_BUCKET, Key=filename, Body=file_bytes, ACL='public-read')
    return f"{S3_ENDPOINT_URL}/{S3_BUCKET}/{filename}"
    '''
    
    # Имитация URL пока мы тестируем без настроенного бакета:
    await asyncio.sleep(0.5) 
    fake_domain = "https://mock-storage.local"
    return f"{fake_domain}/{uuid.uuid4()}.{extension}"


async def ensure_mock_user(connection: asyncpg.Connection) -> None:
    await connection.execute(
        "insert into app_user(id, email, display_name) values($1::uuid, $2, $3) on conflict (id) do nothing",
        MOCK_USER_ID, "mock-user-123@scrolled.local", "ScrollEd Demo User",
    )


async def enforce_book_limit() -> None:
    if not ENFORCE_BOOK_LIMIT:
        return
    global _db_pool
    try:
        if _db_pool is None:
            _db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)
        async with _db_pool.acquire() as connection:
            entitlement = await connection.fetchrow(
                "select plan, max_documents from subscription_entitlements where user_id = $1::uuid",
                MOCK_USER_ID,
            )
            plan = entitlement["plan"] if entitlement else "FREE"
            max_documents = entitlement["max_documents"] if entitlement else 10
            count = await connection.fetchval("select count(*) from document where owner_id = $1::uuid", MOCK_USER_ID)
            if plan == "FREE" and count >= (max_documents or 10):
                raise HTTPException(status_code=403, detail="Достигнут лимит Free-подписки")
    except HTTPException:
        raise
    except (asyncpg.PostgresError, OSError) as exc:
        print(f"[DB] connection_error={exc!r} url={DATABASE_URL}", flush=True)
        raise HTTPException(status_code=503, detail="PostgreSQL недоступен. Запустите Docker или задайте DATABASE_URL.") from exc


async def persist_topic(topic: TopicResponse, filename: str, source_bytes: int) -> None:
    global _db_pool
    if _db_pool is None:
        if not DATABASE_URL:
            raise HTTPException(status_code=503, detail="DATABASE_URL is not configured")
        _db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)

    async with _db_pool.acquire() as connection:
        async with connection.transaction():
            exists = await connection.fetchval("select exists(select 1 from app_user where id = $1::uuid)", MOCK_USER_ID)
            if not exists:
                await connection.execute(
                    "insert into app_user(id, email, display_name) values($1::uuid, $2, $3)",
                    MOCK_USER_ID, "mock-user-123@scrolled.local", "ScrollEd Demo User",
                )
            document_id = await connection.fetchval(
                """insert into document(owner_id, title, source_key, source_type, source_bytes, status)
                   values($1::uuid, $2, $3, 'PDF', $4, 'READY') returning id""",
                MOCK_USER_ID, filename, filename, source_bytes,
            )
            topic_id = await connection.fetchval(
                "insert into topic(document_id, position, title, summary) values($1, 0, $2, $3) returning id",
                document_id, topic.title, topic.cards[0].text,
            )
            for position, card in enumerate(topic.cards):
                await connection.fetchval(
                    """insert into content_card(id, topic_id, position, type, title, body, media_url, audio_script)
                       values($1::uuid, $2, $3, $4::card_type, $5, $6, $7, $8) returning id""",
                    card.id, topic_id, position, "AUDIO" if card.type == "audio" else "SUMMARY",
                    card.title or topic.title, card.text, card.audioUrl,
                    card.text if card.type == "audio" else None,
                )
            quiz_card_id = await connection.fetchval(
                """insert into content_card(topic_id, position, type, title, body)
                   values($1, $2, 'QUIZ', 'Knowledge check', $3) returning id""",
                topic_id, len(topic.cards), topic.quiz.question,
            )
            await connection.execute(
                """insert into quiz_question(card_id, question, options, answer_index, explanation)
                   values($1, $2, $3::jsonb, $4, $5)""",
                quiz_card_id, topic.quiz.question, json.dumps(topic.quiz.options),
                topic.quiz.correctAnswer, "Answer checked against the generated topic.",
            )


@app.post("/cards/{card_id}/toggle-like")
async def toggle_like(card_id: str) -> dict[str, int | bool]:
    try:
        uuid.UUID(card_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid card id") from exc
    global _db_pool
    if _db_pool is None:
        _db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)
    async with _db_pool.acquire() as connection:
        card_exists = await connection.fetchval("select exists(select 1 from content_card where id = $1::uuid)", card_id)
        if not card_exists:
            raise HTTPException(status_code=404, detail="Card not found")
        await ensure_mock_user(connection)
        async with connection.transaction():
            existing = await connection.fetchval("select exists(select 1 from likes where user_id = $1::uuid and content_card_id = $2::uuid)", MOCK_USER_ID, card_id)
            if existing:
                await connection.execute("delete from likes where user_id = $1::uuid and content_card_id = $2::uuid", MOCK_USER_ID, card_id)
                is_liked = False
            else:
                await connection.execute("insert into likes(user_id, content_card_id) values($1::uuid, $2::uuid)", MOCK_USER_ID, card_id)
                is_liked = True
        likes_count = await connection.fetchval("select count(*) from likes where content_card_id = $1::uuid", card_id)
        return {"likesCount": int(likes_count or 0), "isLiked": is_liked}


@app.get("/cards/{card_id}/comments", response_model=list[CommentResponse])
async def list_comments(card_id: str) -> list[CommentResponse]:
    global _db_pool
    if _db_pool is None:
        _db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)
    async with _db_pool.acquire() as connection:
        rows = await connection.fetch("""select c.id, c.text, c.created_at, coalesce(u.display_name, 'ScrollEd user') as author_name from comments c join app_user u on u.id = c.user_id where c.content_card_id = $1::uuid order by c.created_at desc limit 100""", card_id)
        return [CommentResponse(id=str(row["id"]), text=row["text"], createdAt=row["created_at"].isoformat(), authorName=row["author_name"]) for row in rows]


@app.post("/cards/{card_id}/comments", response_model=CommentResponse)
async def create_comment(card_id: str, payload: CommentCreate) -> CommentResponse:
    global _db_pool
    if _db_pool is None:
        _db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)
    async with _db_pool.acquire() as connection:
        card_exists = await connection.fetchval("select exists(select 1 from content_card where id = $1::uuid)", card_id)
        if not card_exists:
            raise HTTPException(status_code=404, detail="Card not found")
        await ensure_mock_user(connection)
        row = await connection.fetchrow("insert into comments(user_id, content_card_id, text) values($1::uuid, $2::uuid, $3) returning id, text, created_at", MOCK_USER_ID, card_id, payload.text.strip())
        return CommentResponse(id=str(row["id"]), text=row["text"], createdAt=row["created_at"].isoformat(), authorName="ScrollEd User")


@app.post("/webhooks/revenuecat")
async def revenuecat_webhook(request: Request) -> dict[str, str]:
    if REVENUECAT_WEBHOOK_SECRET and request.headers.get("Authorization") != f"Bearer {REVENUECAT_WEBHOOK_SECRET}":
        raise HTTPException(status_code=401, detail="Invalid webhook signature")
    payload = await request.json()
    event = payload.get("event", payload)
    user_id = event.get("app_user_id") or event.get("original_app_user_id")
    if event.get("type") not in {"INITIAL_PURCHASE", "RENEWAL", "PRODUCT_CHANGE", "SUBSCRIPTION_EXTENDED"}:
        return {"status": "ignored"}
    if not user_id:
        raise HTTPException(status_code=400, detail="Missing RevenueCat user id")
    try:
        user_uuid = uuid.UUID(user_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="RevenueCat user id must be a UUID") from exc
    global _db_pool
    if _db_pool is None:
        if not DATABASE_URL:
            raise HTTPException(status_code=503, detail="DATABASE_URL is not configured")
        _db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)
    async with _db_pool.acquire() as connection:
        await connection.execute(
            """insert into subscription(user_id, plan, status, provider_customer_id, provider_subscription_id)
               values($1, 'PRO', 'ACTIVE', $2, $3)""",
            user_uuid, event.get("original_app_user_id"), event.get("id"),
        )
    return {"status": "updated"}


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=500, content={"error": "Internal server error"})

def _build_yandex_prompt(source_text: str) -> list[dict]:
    system = (
        "Ты — методист, который превращает учебный текст в короткую "
        "интерактивную ленту карточек и один проверочный вопрос. "
        "Отвечай СТРОГО валидным JSON без markdown и комментариев."
    )
    user = f"""Преобразуй текст учебного материала в короткую учебную ленту.

Верни JSON ровно такой схемы:
{{
  "title": "string",
  "cards": [{{"type": "text", "title": "string", "text": "string"}}],
  "quiz": {{"question": "string", "options": ["string","string","string"], "correctAnswer": 0}}
}}

Требования:
- 3-5 карточек, у каждой type строго "text";
- options ровно 3, correctAnswer — индекс правильного (0..2);
- никакого markdown, только JSON.

Текст материала:
{source_text}
"""
    return [
        {"role": "system", "text": system},
        {"role": "user", "text": user},
    ]

def _strip_code_fence(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z]*\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    # вырезаем первый { ... последний }
    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end != -1 and end > start:
        raw = raw[start : end + 1]
    return raw.strip()

async def generate_topic(source_text: str) -> TopicResponse:
    if not YANDEX_API_KEY or not YANDEX_FOLDER_ID:
        return await asyncio.to_thread(generate_topic_without_ai, source_text)

    payload = {
        "modelUri": f"gpt://{YANDEX_FOLDER_ID}/{YANDEX_MODEL}/{YANDEX_MODEL_VERSION}",
        "completionOptions": {
            "stream": False,
            "temperature": 0.3,
            "maxTokens": 2000,
        },
        "messages": _build_yandex_prompt(source_text),
    }
    headers = {
        "Authorization": f"Api-Key {YANDEX_API_KEY}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        last_exc: Exception | None = None
        for attempt in range(YANDEX_RETRY_ATTEMPTS):
            try:
                response = await client.post(YANDEX_ENDPOINT, headers=headers, json=payload)
                if response.status_code in (429, 500, 502, 503, 504):
                    raise RuntimeError(f"YandexGPT unavailable: {response.status_code} {response.text}")
                response.raise_for_status()
                data = response.json()
                raw_text = data["result"]["alternatives"][0]["message"]["text"]
                if not raw_text:
                    raise ValueError("YandexGPT вернул пустой ответ")
                cleaned = _strip_code_fence(raw_text)
                return TopicResponse.model_validate_json(cleaned)
            except Exception as exc:
                last_exc = exc
                if attempt == YANDEX_RETRY_ATTEMPTS - 1:
                    break
                delay = YANDEX_RETRY_DELAYS[attempt]
                print(
                    f"[YandexGPT] error={exc!r}; retry {attempt + 1}/{YANDEX_RETRY_ATTEMPTS - 1} in {delay}s",
                    flush=True,
                )
                await asyncio.sleep(delay)
        raise last_exc or RuntimeError("YandexGPT request failed")
    
def extract_pdf_text(content: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(content))
        extracted = "\n".join((page.extract_text() or "") for page in reader.pages[:3]).strip()[:MAX_SOURCE_CHARS]
        print(f"[PDF] pages={len(reader.pages)} extracted_chars={len(extracted)}", flush=True)
        return extracted
    except Exception as exc:
        print(f"[PDF] parse_error={exc!r}", flush=True)
        raise HTTPException(status_code=400, detail="Could not parse PDF") from exc


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/process-pdf", response_model=TopicResponse)
async def process_pdf(file: UploadFile = File(...)) -> TopicResponse:
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=415, detail="Only PDF files are supported")
    await enforce_book_limit()
    content = await file.read()
    print(f"[PDF] name={file.filename!r} content_type={file.content_type!r} bytes={len(content)}", flush=True)
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded file is empty")
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="PDF exceeds the 25 MB limit")
    text = extract_pdf_text(content)
    if not text:
        raise HTTPException(status_code=422, detail="PDF contains no extractable text. Use a text PDF or add OCR for scanned PDFs.")
    try:
        topic = await generate_topic(text)
        topic = topic.model_copy(update={"cards": [card.model_copy(update={"id": str(uuid.uuid4())}) for card in topic.cards]})
        await persist_topic(topic, file.filename or "uploaded.pdf", len(content))
        return topic
    except asyncpg.PostgresError as exc:
        raise HTTPException(status_code=503, detail="Database operation failed") from exc
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
