-- Preserve items that are temporarily out of their tote.
alter table public.items add column if not exists is_stored boolean not null default true;
