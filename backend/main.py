from __future__ import annotations


import asyncio
import io
import json
import os
import re
import time
import uuid
from typing import Literal

import asyncpg

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
    text: str = Field(min_length=1)
    type: Literal["text", "audio"]
    title: str | None = None
    audioUrl: str | None = None


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


async def enforce_book_limit() -> None:
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
                    """insert into content_card(topic_id, position, type, title, body, media_url, audio_script)
                       values($1, $2, $3::card_type, $4, $5, $6, $7) returning id""",
                    topic_id, position, "AUDIO" if card.type == "audio" else "SUMMARY",
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
        topic = await asyncio.to_thread(generate_topic_without_ai, text)
        await persist_topic(topic, file.filename or "uploaded.pdf", len(content))
        return topic
    except asyncpg.PostgresError as exc:
        raise HTTPException(status_code=503, detail="Database operation failed") from exc
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
