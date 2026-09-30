
-- ScrollEd exam pivot schema.
-- Apply after db/schema.sql. Idempotent and intentionally independent from legacy story tables.

create table if not exists exams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references app_user(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 200),
  source_questions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists exams_owner_created_idx
  on exams (owner_id, created_at desc);

create table if not exists exam_topics (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references exams(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 300),
  description text not null default '',
  source_question_ids jsonb not null default '[]'::jsonb,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  unique (exam_id, title),
  unique (exam_id, position)
);

create index if not exists exam_topics_exam_position_idx
  on exam_topics (exam_id, position);

create table if not exists user_knowledge (
  user_id uuid not null references app_user(id) on delete cascade,
  exam_id uuid not null references exams(id) on delete cascade,
  topic_id uuid not null references exam_topics(id) on delete cascade,
  mastery_score numeric(5, 2) not null default 0
    check (mastery_score >= 0 and mastery_score <= 100),
  exposure_seconds integer not null default 0 check (exposure_seconds >= 0),
  last_seen_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, exam_id, topic_id),
  check (topic_id is not null)
);

create index if not exists user_knowledge_adaptive_idx
  on user_knowledge (user_id, exam_id, mastery_score asc, updated_at asc);

create table if not exists cards (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references exam_topics(id) on delete cascade,
  depth_level integer not null default 0 check (depth_level >= 0),
  position integer not null default 0 check (position >= 0),
  card_type text not null default 'content'
    check (card_type in ('content', 'quiz')),
  title text not null default '',
  body text not null,
  quiz_payload jsonb,
  generated_by text not null default 'yandexgpt',
  created_at timestamptz not null default now(),
  unique (topic_id, depth_level, position)
);

create index if not exists cards_topic_depth_position_idx
  on cards (topic_id, depth_level, position);

create table if not exists quiz_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id) on delete cascade,
  exam_id uuid not null references exams(id) on delete cascade,
  topic_id uuid not null references exam_topics(id) on delete cascade,
  card_id uuid references cards(id) on delete set null,
  is_correct boolean not null,
  response_time_ms integer check (response_time_ms is null or response_time_ms >= 0),
  answered_at timestamptz not null default now()
);

create index if not exists quiz_results_knowledge_idx
  on quiz_results (user_id, exam_id, topic_id, answered_at desc);

create or replace function touch_exam_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists exams_touch_updated_at on exams;
create trigger exams_touch_updated_at
before update on exams
for each row execute function touch_exam_updated_at();

drop trigger if exists user_knowledge_touch_updated_at on user_knowledge;
create trigger user_knowledge_touch_updated_at
before update on user_knowledge
for each row execute function touch_exam_updated_at();
