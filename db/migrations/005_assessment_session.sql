alter table user_knowledge add column if not exists assessment_questions jsonb;
alter table user_knowledge add column if not exists assessment_answers jsonb not null default '[]'::jsonb;
alter table user_knowledge add column if not exists assessment_total integer not null default 0;
