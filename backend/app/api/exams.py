from io import BytesIO
from pathlib import Path
from uuid import UUID

import asyncpg
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from pypdf import PdfReader

from app.core.settings import settings
from app.services.exam_parser import ExamParserError, parse_exam

router = APIRouter(prefix="/api/exams", tags=["exams"])

MAX_PDF_BYTES = 25 * 1024 * 1024
MAX_PDF_TEXT_CHARS = 120_000


class ParseExamRequest(BaseModel):
    text: str = Field(min_length=1)
    name: str = Field(min_length=1, max_length=200)
    user_id: UUID | None = None


class ParseExamResponse(BaseModel):
    exam_id: UUID


def extract_pdf_questions(content: bytes) -> str:
    try:
        reader = PdfReader(BytesIO(content))
        text = "\n".join(page.extract_text(extraction_mode="layout") or "" for page in reader.pages).strip()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Could not read text from the PDF") from exc
    if not text:
        raise HTTPException(
            status_code=422,
            detail="PDF contains no extractable text. Use a text PDF or add OCR for a scan.",
        )
    return text[:MAX_PDF_TEXT_CHARS]


async def persist_exam(owner_id: UUID, name: str, question_text: str) -> ParseExamResponse:
    try:
        exam_id = await parse_exam(
            owner_id=owner_id,
            name=name,
            question_text=question_text,
        )
    except ExamParserError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except (asyncpg.PostgresError, OSError) as exc:
        raise HTTPException(
            status_code=503,
            detail="PostgreSQL is unavailable. Start the database and verify DATABASE_URL.",
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=f"YandexGPT request failed: {exc}") from exc
    return ParseExamResponse(exam_id=exam_id)


@router.post("/parse", response_model=ParseExamResponse, status_code=201)
async def parse_exam_questions(request: Request) -> ParseExamResponse:
    content_type = request.headers.get("content-type", "")
    owner_id = UUID(settings.demo_user_id)

    if content_type.startswith("multipart/form-data"):
        form = await request.form()
        selected_name = str(form.get("name") or "").strip()
        question_text = str(form.get("text") or "").strip()
        raw_user_id = form.get("user_id")
        if raw_user_id:
            owner_id = UUID(str(raw_user_id))
        file = form.get("file")
        if file is not None:
            if not hasattr(file, "read") or getattr(file, "content_type", None) not in {"application/pdf", "application/x-pdf"}:
                raise HTTPException(status_code=415, detail="Only PDF files are supported")
            content = await file.read()
            if not content:
                raise HTTPException(status_code=400, detail="The uploaded PDF is empty")
            if len(content) > MAX_PDF_BYTES:
                raise HTTPException(status_code=413, detail="PDF exceeds the 25 MB limit")
            question_text = extract_pdf_questions(content)
            if not selected_name:
                selected_name = Path(file.filename or "exam.pdf").stem
    else:
        payload = ParseExamRequest.model_validate(await request.json())
        selected_name = payload.name
        question_text = payload.text
        owner_id = payload.user_id or owner_id

    if not selected_name:
        raise HTTPException(status_code=422, detail="Exam name is required")
    if not question_text:
        raise HTTPException(status_code=422, detail="Provide text or a PDF file")
    return await persist_exam(owner_id, selected_name[:200], question_text)


@router.post("/parse-pdf", response_model=ParseExamResponse, status_code=201)
async def parse_exam_pdf(
    file: UploadFile = File(...),
    name: str | None = Form(default=None),
    user_id: UUID | None = Form(default=None),
) -> ParseExamResponse:
    if file.content_type not in {"application/pdf", "application/x-pdf"}:
        raise HTTPException(status_code=415, detail="Only PDF files are supported")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded PDF is empty")
    if len(content) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF exceeds the 25 MB limit")

    question_text = extract_pdf_questions(content)
    exam_name = (name or Path(file.filename or "exam.pdf").stem).strip()
    if not exam_name:
        raise HTTPException(status_code=422, detail="Exam name is required")
    return await persist_exam(
        owner_id=user_id or UUID(settings.demo_user_id),
        name=exam_name[:200],
        question_text=question_text,
    )


@router.get("/me")
async def list_my_exams(user_id: UUID | None = None) -> list[dict]:
    from app.core.database import get_pool

    owner_id = user_id or UUID(settings.demo_user_id)
    try:
        pool = await get_pool()
        async with pool.acquire() as connection:
            rows = await connection.fetch(
                """select e.id, e.name, e.created_at, e.updated_at,
                          (select count(*) from exam_topics t where t.exam_id = e.id) as topics_count,
                          (select count(*) from user_knowledge k
                           where k.exam_id = e.id and k.user_id = $1 and k.mastery_score >= 90) as learned_topics
                   from exams e where e.owner_id = $1 order by e.created_at desc""",
                owner_id,
            )
    except (asyncpg.PostgresError, OSError) as exc:
        raise HTTPException(
            status_code=503,
            detail="PostgreSQL is unavailable. Start the database and verify DATABASE_URL.",
        ) from exc
    return [
        {
            "id": str(row["id"]),
            "name": row["name"],
            "topics_count": row["topics_count"],
            "learned_topics": row["learned_topics"],
            "created_at": row["created_at"].isoformat(),
            "updated_at": row["updated_at"].isoformat(),
        }
        for row in rows
    ]


@router.get("/{exam_id}/topics")
async def list_exam_topics(exam_id: UUID, user_id: UUID | None = None) -> list[dict]:
    from app.core.database import get_pool
    pool = await get_pool()
    async with pool.acquire() as connection:
        rows = await connection.fetch(
            """select t.id, t.exam_id, t.title, t.description,
                      coalesce(k.mastery_score, 0)::float as mastery_score,
                      coalesce(k.assessment_completed, false) as assessment_completed
               from exam_topics t left join user_knowledge k
                 on k.topic_id = t.id and k.exam_id = t.exam_id and k.user_id = $2
               where t.exam_id = $1 order by t.position""",
            exam_id, user_id or UUID(settings.demo_user_id),
        )
    return [dict(row) | {"id": str(row["id"]), "exam_id": str(row["exam_id"])} for row in rows]


@router.delete("/{exam_id}", status_code=204)
async def delete_exam(exam_id: UUID, user_id: UUID | None = None) -> None:
    from app.core.database import get_pool
    pool = await get_pool()
    async with pool.acquire() as connection:
        deleted = await connection.execute(
            "delete from exams where id = $1 and owner_id = $2",
            exam_id, user_id or UUID(settings.demo_user_id),
        )
    if deleted == "DELETE 0":
        raise HTTPException(status_code=404, detail="Exam not found")
@router.get("")
async def list_exams(user_id: UUID | None = None) -> list[dict]:
    from app.core.database import get_pool

    owner_id = user_id or UUID(settings.demo_user_id)
    try:
        pool = await get_pool()
        async with pool.acquire() as connection:
            rows = await connection.fetch(
                """select id, name, created_at, updated_at,
                          (select count(*) from exam_topics t where t.exam_id = e.id) as topics_count
                   from exams e where owner_id = $1 order by created_at desc""",
                owner_id,
            )
    except (asyncpg.PostgresError, OSError) as exc:
        raise HTTPException(
            status_code=503,
            detail="PostgreSQL is unavailable. Start the database and verify DATABASE_URL.",
        ) from exc
    return [
        {
            "id": str(row["id"]),
            "name": row["name"],
            "topics_count": row["topics_count"],
            "created_at": row["created_at"].isoformat(),
            "updated_at": row["updated_at"].isoformat(),
        }
        for row in rows
    ]
