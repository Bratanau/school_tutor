-- Run after db/schema.sql against the active database.
-- All non-ASCII values are built with chr() so psql client encoding cannot corrupt them.

update category set title = chr(1048)||chr(1089)||chr(1090)||chr(1086)||chr(1088)||chr(1080)||chr(1103), name = chr(1048)||chr(1089)||chr(1090)||chr(1086)||chr(1088)||chr(1080)||chr(1103), emoji = chr(127899) where slug = 'history';
update category set title = chr(1060)||chr(1080)||chr(1079)||chr(1080)||chr(1082)||chr(1072), name = chr(1060)||chr(1080)||chr(1079)||chr(1080)||chr(1082)||chr(1072), emoji = chr(9883) where slug = 'physics';
update category set title = chr(1051)||chr(1080)||chr(1090)||chr(1077)||chr(1088)||chr(1072)||chr(1090)||chr(1091)||chr(1088)||chr(1072), name = chr(1051)||chr(1080)||chr(1090)||chr(1077)||chr(1088)||chr(1072)||chr(1090)||chr(1091)||chr(1088)||chr(1072), emoji = chr(128214) where slug = 'literature';
update category set title = 'IT', name = 'IT', emoji = chr(128187) where slug = 'it';

update story set
  title = chr(1050)||chr(1072)||chr(1082)||' '||chr(1091)||chr(1095)||chr(1105)||chr(1085)||chr(1099)||chr(1077)||' '||chr(1089)||chr(1083)||chr(1099)||chr(1096)||chr(1072)||chr(1090)||' '||chr(1095)||chr(1105)||chr(1088)||chr(1085)||chr(1099)||chr(1077)||' '||chr(1076)||chr(1099)||chr(1088)||chr(1099),
  image_url = 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?auto=format&fit=crop&w=1080&q=85'
where category_id = (select id from category where slug = 'history');

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
