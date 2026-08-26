create table if not exists public.suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default 'ToteHome user',
  username text,
  message text not null check(length(message) between 3 and 3000),
  status text not null default 'new' check(status in ('new','reviewed','done')),
  created_at timestamptz not null default now()
);

alter table public.suggestions enable row level security;
drop policy if exists "users submit suggestions" on public.suggestions;
create policy "users submit suggestions" on public.suggestions for insert to authenticated with check(user_id=auth.uid());
drop policy if exists "app owner reads suggestions" on public.suggestions;
create policy "app owner reads suggestions" on public.suggestions for select to authenticated using(lower(coalesce(auth.jwt()->>'email',''))='kayleigh.su@gmail.com');
drop policy if exists "app owner updates suggestions" on public.suggestions;
create policy "app owner updates suggestions" on public.suggestions for update to authenticated using(lower(coalesce(auth.jwt()->>'email',''))='kayleigh.su@gmail.com');
