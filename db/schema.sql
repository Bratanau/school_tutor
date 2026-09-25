create extension if not exists pgcrypto;

create type subscription_plan as enum ('FREE', 'PRO', 'ENTERPRISE');
create type subscription_status as enum ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED');
create type document_status as enum ('UPLOADED', 'PROCESSING', 'READY', 'FAILED');
create type card_type as enum ('SUMMARY', 'FACT', 'AUDIO', 'VIDEO', 'QUIZ');

create table app_user (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text,
  created_at timestamptz not null default now()
);

create table organization (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references app_user(id),
  created_at timestamptz not null default now()
);

create table organization_member (
  organization_id uuid not null references organization(id) on delete cascade,
  user_id uuid not null references app_user(id) on delete cascade,
  role text not null check (role in ('OWNER', 'ADMIN', 'MEMBER')),
  primary key (organization_id, user_id)
);

create table subscription (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app_user(id) on delete cascade,
  organization_id uuid references organization(id) on delete cascade,
  plan subscription_plan not null default 'FREE',
  status subscription_status not null default 'ACTIVE',
  provider_customer_id text,
  provider_subscription_id text,
  trial_ends_at timestamptz,
  current_period_ends_at timestamptz,
  created_at timestamptz not null default now(),
  check ((user_id is not null) <> (organization_id is not null))
);

create table document (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references app_user(id) on delete cascade,
  organization_id uuid references organization(id) on delete cascade,
  title text not null,
  source_key text not null,
  source_type text not null check (source_type in ('PDF', 'TXT')),
  source_bytes bigint not null default 0,
  page_count integer,
  status document_status not null default 'UPLOADED',
  error_message text,
  created_at timestamptz not null default now()
);

create table topic (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references document(id) on delete cascade,
  position integer not null,
  title text not null,
  summary text not null,
  unique (document_id, position)
);

create table content_card (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references topic(id) on delete cascade,
  position integer not null,
  type card_type not null,
  title text not null,
  body text,
  media_url text,
  audio_script text,
  unique (topic_id, position)
);

create table quiz_question (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null unique references content_card(id) on delete cascade,
  question text not null,
  options jsonb not null,
  answer_index integer not null check (answer_index >= 0),
  explanation text not null
);

create table user_progress (
  user_id uuid not null references app_user(id) on delete cascade,
  topic_id uuid not null references topic(id) on delete cascade,
  card_position integer not null default 0,
  completed_at timestamptz,
  primary key (user_id, topic_id)
);

-- The API checks this relation in a transaction before upload. The document
-- count is evaluated separately with count(*) for the authenticated user.
create view subscription_entitlements as
select
  u.id as user_id,
  coalesce(active.plan, 'FREE'::subscription_plan) as plan,
  case when coalesce(active.plan, 'FREE'::subscription_plan) = 'FREE' then 10 else null end as max_documents,
  case when coalesce(active.plan, 'FREE'::subscription_plan) = 'FREE' then 20000 else null end as max_source_chars,
  coalesce(active.plan, 'FREE'::subscription_plan) <> 'FREE' as ads_disabled,
  active.trial_ends_at,
  active.current_period_ends_at
from app_user u
left join lateral (
  select s.plan, s.trial_ends_at, s.current_period_ends_at
  from subscription s
  where s.user_id = u.id and s.status in ('TRIALING', 'ACTIVE')
  order by s.created_at desc
  limit 1
) active on true;
