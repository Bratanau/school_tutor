import json
from dataclasses import dataclass
from uuid import UUID

from app.core.database import get_pool
from app.core.users import ensure_user
from app.core.yandex_provider import YandexProvider


@dataclass(frozen=True)
class ProgressEvent:
    user_id: UUID
    exam_id: UUID
    topic_id: UUID
    card_id: UUID | None = None
    is_initial: bool = False
    seconds_viewed: int = 0
    quiz_correct: bool | None = None


class ProgressTracker:
    """Persists quiz outcomes and adjusts topic mastery atomically."""

    async def track_quiz(self, event: ProgressEvent) -> float:
        if event.quiz_correct is None:
            raise ValueError("quiz_correct is required")

        delta = 25 if event.quiz_correct else -15
        initial_score = 75 if event.quiz_correct else 25
        pool = await get_pool()
        async with pool.acquire() as connection:
            async with connection.transaction():
                await ensure_user(connection, event.user_id)
                topic_exists = await connection.fetchval(
                    """select exists(
                           select 1 from exam_topics
                           where id = $1 and exam_id = $2
                       )""",
                    event.topic_id,
                    event.exam_id,
                )
                if not topic_exists:
                    raise LookupError("Topic not found for this exam")

                score = await connection.fetchval(
                    """insert into user_knowledge(
                           user_id, exam_id, topic_id, mastery_score,
                           assessment_completed, initial_level, last_seen_at, updated_at
                       ) values($1, $2, $3, $4, $5, $6, now(), now())
                       on conflict (user_id, exam_id, topic_id) do update
                       set mastery_score = case when $5 then $6 else greatest(
                               0, least(100, user_knowledge.mastery_score + $7::numeric)
                           ) end,
                           assessment_completed = case when $5 then true else user_knowledge.assessment_completed end,
                           initial_level = case when $5 then $6 else user_knowledge.initial_level end,
                           last_seen_at = now(),
                           updated_at = now()
                       returning mastery_score""",
                    event.user_id,
                    event.exam_id,
                    event.topic_id,
                    initial_score if event.is_initial else 0,
                    event.is_initial,
                    initial_score if event.is_initial else 0,
                    delta,
                )
                await connection.execute(
                    """insert into quiz_results(
                           user_id, exam_id, topic_id, card_id, is_correct
                       ) values($1, $2, $3, $4, $5)""",
                    event.user_id,
                    event.exam_id,
                    event.topic_id,
                    event.card_id,
                    event.quiz_correct,
                )
        return float(score)

    async def get_assessment(self, *, user_id: UUID, exam_id: UUID, topic_id: UUID) -> dict[str, object]:
        pool = await get_pool()
        async with pool.acquire() as connection:
            topic = await connection.fetchrow("select id, exam_id, title, description from exam_topics where id=$1 and exam_id=$2", topic_id, exam_id)
            if not topic:
                raise LookupError("Topic not found")
            row = await connection.fetchrow("select assessment_questions, assessment_answers, assessment_total, assessment_completed from user_knowledge where user_id=$1 and exam_id=$2 and topic_id=$3", user_id, exam_id, topic_id)
            if row and row["assessment_questions"]:
                questions = row["assessment_questions"]
            else:
                assessment = await YandexProvider().generate_initial_assessment(topic["title"], topic["description"])
                questions = assessment.get("questions", [])
                await connection.execute("""insert into user_knowledge(user_id, exam_id, topic_id, assessment_questions, assessment_answers, assessment_total, updated_at) values($1,$2,$3,$4::jsonb,'[]'::jsonb,$5,now()) on conflict (user_id,exam_id,topic_id) do update set assessment_questions=$4::jsonb, assessment_answers='[]'::jsonb, assessment_total=$5, assessment_completed=false, updated_at=now()""", user_id, exam_id, topic_id, json.dumps(questions, ensure_ascii=False), len(questions))
            return {"topic_id": str(topic_id), "title": topic["title"], "questions": questions, "completed": bool(row and row["assessment_completed"])}

    async def complete_assessment(self, *, user_id: UUID, exam_id: UUID, topic_id: UUID, question_index: int, answer_index: int) -> dict[str, object]:
        pool = await get_pool()
        async with pool.acquire() as connection:
            row = await connection.fetchrow(
                """select k.assessment_questions, k.assessment_answers, k.assessment_total, t.title
                   from user_knowledge k join exam_topics t on t.id = k.topic_id
                   where k.user_id=$1 and k.exam_id=$2 and k.topic_id=$3""",
                user_id, exam_id, topic_id,
            )
            if not row or not row["assessment_questions"]:
                raise LookupError("Assessment session not found")
            questions = row["assessment_questions"]
            answers = row["assessment_answers"] or []
            if isinstance(questions, str): questions = json.loads(questions)
            if isinstance(answers, str): answers = json.loads(answers)
            answers = [item for item in answers if item.get("question_index") != question_index]
            answers.append({"question_index": question_index, "answer_index": answer_index})
            total = int(row["assessment_total"] or len(questions))
            if len(answers) < total:
                await connection.execute("update user_knowledge set assessment_answers=$4::jsonb, updated_at=now() where user_id=$1 and exam_id=$2 and topic_id=$3", user_id, exam_id, topic_id, json.dumps(answers))
                return {"completed": False, "answered": len(answers), "total": total}
            level = await YandexProvider().evaluate_initial_assessment(row["title"], questions, answers)
            await connection.execute("""update user_knowledge set assessment_answers=$4::jsonb, assessment_completed=true, initial_level=$5, mastery_score=$5, updated_at=now() where user_id=$1 and exam_id=$2 and topic_id=$3""", user_id, exam_id, topic_id, json.dumps(answers), level)
            return {"completed": True, "answered": total, "total": total, "level": level}
    async def track(self, event: ProgressEvent) -> None:
        if event.quiz_correct is not None:
            await self.track_quiz(event)
