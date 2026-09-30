-- Wikipedia media is stored by URL; no image bytes are persisted in PostgreSQL or object storage.
alter table cards add column if not exists media_caption text;
