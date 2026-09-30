alter table user_knowledge add column if not exists assessment_completed boolean not null default false;
alter table user_knowledge add column if not exists initial_level integer not null default 0;
alter table cards add column if not exists code_block text;
