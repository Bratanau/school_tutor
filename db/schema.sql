-- Feed Stories schema.
-- Idempotent: safe to re-run with `psql -f db/schema.sql`.

create extension if not exists pgcrypto;
create extension if not exists citext;

do $$ begin
  create type subscription_plan as enum ('trial', 'monthly', 'yearly');
exception when duplicate_object then null; end $$;

do $$ begin
  create type subscription_status as enum ('active', 'canceled', 'past_due');
exception when duplicate_object then null; end $$;

do $$ begin
  create type story_status as enum ('draft', 'published');
exception when duplicate_object then null; end $$;

create table if not exists app_user (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists organization (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references app_user(id),
  created_at timestamptz not null default now()
);

create table if not exists organization_member (
  organization_id uuid not null references organization(id) on delete cascade,
  user_id uuid not null references app_user(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists subscription (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id) on delete cascade,
  plan subscription_plan not null,
  status subscription_status not null default 'active',
  current_period_end timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists subscription_org_idx on subscription (organization_id, status);

-- Uploads (PDF/text) that a story can be generated from.
create table if not exists document (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references app_user(id),
  organization_id uuid references organization(id) on delete set null,
  title text not null,
  source_kind text not null check (source_kind in ('pdf', 'text')),
  storage_path text,
  content_text text,
  page_count integer,
  status story_status not null default 'draft',
  created_at timestamptz not null default now()
);

create index if not exists document_owner_idx on document (owner_id, created_at desc);

-- Feed categories. Seeded below; the mobile app filters stories by category.
create table if not exists category (
  id serial primary key,
  title text not null unique,
  emoji text not null default '📚',
  name text,
  slug text not null unique,
  created_at timestamptz not null default now()
);
alter table category add column if not exists title text;
alter table category add column if not exists emoji text not null default '📚';
update category set title = coalesce(title, name) where title is null;
update category set name = coalesce(name, title) where name is null;

-- The core feed entity: one generated "story" (script + YandexART image + TTS audio).
create table if not exists story (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references app_user(id) on delete cascade,
  category_id integer references category(id) on delete set null,
  document_id uuid references document(id) on delete set null,
  title text not null,
  script text not null default '',
  image_prompt text not null default '',
  image_url text,
  audio_url text,
  status story_status not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists story_feed_idx on story (created_at desc) where status = 'published';
create index if not exists story_owner_idx on story (owner_id, created_at desc);
create index if not exists story_category_idx on story (category_id, created_at desc);

-- Horizontal educational slides belonging to one vertical Story.
create table if not exists story_card (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references story(id) on delete cascade,
  position integer not null check (position >= 0),
  title text,
  text text not null,
  image_prompt text not null default '',
  image_url text,
  audio_url text,
  created_at timestamptz not null default now(),
  unique (story_id, position)
);
create index if not exists story_card_story_idx on story_card (story_id, position);

alter table story add column if not exists user_id uuid references app_user(id) on delete cascade;
alter table story add column if not exists text_script text not null default '';
update story set user_id = owner_id where user_id is null;
update story set text_script = script where text_script = '' and script <> '';
create index if not exists story_user_idx on story (user_id, created_at desc);

-- Likes are per user per story, so the feed can render an active heart.
create table if not exists story_like (
  story_id uuid not null references story(id) on delete cascade,
  user_id uuid not null references app_user(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

create index if not exists story_like_story_idx on story_like (story_id);

create table if not exists comment (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references story(id) on delete cascade,
  user_id uuid not null references app_user(id) on delete cascade,
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists comment_story_idx on comment (story_id, created_at);

create table if not exists likes (
  story_id uuid not null references story(id) on delete cascade,
  user_id uuid not null references app_user(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (story_id, user_id)
);
create index if not exists likes_story_idx on likes (story_id);

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references story(id) on delete cascade,
  user_id uuid not null references app_user(id) on delete cascade,
  text text not null check (length(text) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists comments_story_idx on comments (story_id, created_at);

-- Legacy tables from the "lesson" model; dropped so the new feed owns the schema.
drop table if exists user_progress;
drop table if exists quiz_question;
drop table if exists content_card;
drop table if exists topic;

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists story_touch_updated_at on story;
create trigger story_touch_updated_at
before update on story
for each row execute function touch_updated_at();

-- Feed categories shown as chips on the Home screen.
insert into category (title, name, emoji, slug) values
  (chr(1048)||chr(1089)||chr(1090)||chr(1086)||chr(1088)||chr(1080)||chr(1103), chr(1048)||chr(1089)||chr(1090)||chr(1086)||chr(1088)||chr(1080)||chr(1103), chr(127899), 'history'),
  (chr(1060)||chr(1080)||chr(1079)||chr(1080)||chr(1082)||chr(1072), chr(1060)||chr(1080)||chr(1079)||chr(1080)||chr(1082)||chr(1072), chr(9883), 'physics'),
  (chr(1051)||chr(1080)||chr(1090)||chr(1077)||chr(1088)||chr(1072)||chr(1090)||chr(1091)||chr(1088)||chr(1072), chr(1051)||chr(1080)||chr(1090)||chr(1077)||chr(1088)||chr(1072)||chr(1090)||chr(1091)||chr(1088)||chr(1072), chr(128214), 'literature'),
  ('IT', 'IT', chr(128187), 'it')
on conflict (slug) do update set title = excluded.title, name = excluded.name, emoji = excluded.emoji;

-- One demo story so a fresh install renders a non-empty feed.
do $$
declare
  demo_user app_user%rowtype;
  history_id integer;
begin
  select * into demo_user from app_user order by created_at limit 1;
  if not found then
    insert into app_user (email, password_hash)
    values ('demo@feed.local', 'demo-account-no-password-yet')
    returning * into demo_user;
  end if;

  update category set
    title = chr(1048)||chr(1089)||chr(1090)||chr(1086)||chr(1088)||chr(1080)||chr(1103),
    name = chr(1048)||chr(1089)||chr(1090)||chr(1086)||chr(1088)||chr(1080)||chr(1103),
    emoji = chr(127899)
  where slug = 'history';

  update story set
    title = '\\041a\\0430\\043a \\0443\\0447\\0451\\043d\\044b\\0435 \\0441\\043b\\044b\\0448\\0430\\0442 \\0447\\0451\\0440\\043d\\044b\\0435 \\0434\\044b\\0440\\044b',
    script = '\\0427\\0451\\0440\\043d\\0430\\044f \\0434\\044b\\0440\\0430 \\043d\\0435 \\0437\\0432\\0443\\0447\\0438\\0442, \\043d\\043e \\043f\\0440\\043e\\0441\\0442\\0440\\0430\\043d\\0441\\0442\\0432\\043e \\u0432\\0440\\0435\\043c\\0435\\043d\\0438 \\0432\\043e\\043a\\0440\\0443\\0433 \\043d\\0435\\0451 \\0434\\u0440\\u043e\\0436\\u0438\\u0442.',
    text_script = '\\0427\\0451\\0440\\043d\\0430\\044f \\0434\\044b\\0440\\0430 \\043d\\0435 \\0437\\0432\\0443\\0447\\0438\\0442, \\043d\\043e \\043f\\0440\\043e\\0441\\u0442\\0440\\u0430\\043d\\0441\\u0442\\0432\\u043e \\u0432\\0440\\0435\\043c\\0435\\043d\\0438 \\u0432\\u043e\\u043a\\u0440\\0443\\u0433 \\u043d\\u0435\\u0451 \\u0434\\u0440\\u043e\\u0436\\u0438\\u0442.'
  where category_id = history_id;

  insert into story (owner_id, user_id, category_id, title, script, text_script, image_prompt, image_url, status)
  select demo_user.id,
         demo_user.id,
         history_id,
         'Как учёные слышат чёрные дыры',
         'Чёрная дыра не звучит — но пространство-время вокруг неё дрожит. '
           'Детекторы ловят эту рябь как короткий свист, и по нему '
           'восстанавливают массу и расстояние до события.',
         'Чёрная дыра не звучит — но пространство-время вокруг неё дрожит. '
           'Детекторы ловят эту рябь как короткий свист, и по нему '
           'восстанавливают массу и расстояние до события.',
         'abstract cosmic illustration of a black hole bending starlight, dark palette, cinematic light',
         'https://picsum.photos/seed/blackhole/1080/1920',
         'published'
  where not exists (select 1 from story);
end $$;

-- Backwards-compatible entitlement view used by the API to limit uploads.
create or replace view subscription_entitlements as
with active_subscription as (
  select distinct on (m.user_id)
    m.user_id,
    s.plan,
    s.status,
    s.current_period_end
  from subscription s
  join organization_member m on m.organization_id = s.organization_id
  where s.status in ('active', 'past_due')
  order by m.user_id, s.current_period_end desc
),
story_counts as (
  select owner_id, count(*) as story_count
  from story
  group by owner_id
)
select
  u.id as user_id,
  coalesce(a.plan, 'trial') as plan,
  a.status as subscription_status,
  a.current_period_end,
  coalesce(c.story_count, 0) as story_count
from app_user u
left join active_subscription a on a.user_id = u.id
left join story_counts c on c.owner_id = u.id;
