-- Run once in the Supabase SQL editor for functional member and profile settings.
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  email text not null default '',
  avatar_path text,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create or replace function public.share_household_with(target uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from household_members mine join household_members theirs on mine.household_id=theirs.household_id where mine.user_id=auth.uid() and theirs.user_id=target) $$;

drop policy if exists "users read household profiles" on public.profiles;
create policy "users read household profiles" on public.profiles for select using (user_id=auth.uid() or share_household_with(user_id));
drop policy if exists "users manage own profile" on public.profiles;
create policy "users manage own profile" on public.profiles for all using (user_id=auth.uid()) with check (user_id=auth.uid());

insert into storage.buckets(id,name,public) values('profile-photos','profile-photos',false) on conflict(id) do nothing;
drop policy if exists "users read shared profile photos" on storage.objects;
create policy "users read shared profile photos" on storage.objects for select using (bucket_id='profile-photos' and (auth.uid()::text=(storage.foldername(name))[1] or share_household_with(((storage.foldername(name))[1])::uuid)));
drop policy if exists "users upload own profile photos" on storage.objects;
create policy "users upload own profile photos" on storage.objects for insert with check (bucket_id='profile-photos' and auth.uid()::text=(storage.foldername(name))[1]);
drop policy if exists "users update own profile photos" on storage.objects;
create policy "users update own profile photos" on storage.objects for update using (bucket_id='profile-photos' and auth.uid()::text=(storage.foldername(name))[1]);
drop policy if exists "users delete own profile photos" on storage.objects;
create policy "users delete own profile photos" on storage.objects for delete using (bucket_id='profile-photos' and auth.uid()::text=(storage.foldername(name))[1]);

create or replace function public.list_household_members(target_household uuid)
returns table(user_id uuid, display_name text, email text, role text, avatar_path text)
language sql stable security definer set search_path=public
as $$
  select hm.user_id, coalesce(p.display_name,''), coalesce(p.email,''), hm.role, p.avatar_path
  from household_members hm left join profiles p on p.user_id=hm.user_id
  where hm.household_id=target_household and is_household_member(target_household)
  order by hm.role desc, p.display_name, p.email;
$$;

grant execute on function public.list_household_members(uuid) to authenticated;
