alter table public.items
  add column if not exists tags text[] not null default '{}';

create index if not exists items_tags_gin_idx
  on public.items using gin (tags);
