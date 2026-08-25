-- Private-by-default usernames and account-to-account household invitations.
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists discoverable boolean not null default true;
create unique index if not exists profiles_username_unique on public.profiles(lower(username)) where username is not null;

alter table public.household_invites alter column email drop not null;
alter table public.household_invites add column if not exists invited_user_id uuid references auth.users(id) on delete cascade;

create or replace function public.search_totehome_people(search_text text)
returns table(user_id uuid, display_name text, username text, avatar_path text)
language sql stable security definer set search_path=public
as $$
  select p.user_id, p.display_name, p.username, p.avatar_path
  from profiles p
  where p.discoverable and p.username is not null and p.user_id <> auth.uid() and length(trim(search_text)) >= 2
    and (p.display_name ilike '%' || trim(search_text) || '%' or p.username ilike '%' || trim(leading '@' from search_text) || '%')
  order by case when lower(p.username)=lower(trim(leading '@' from search_text)) then 0 else 1 end, p.display_name
  limit 20;
$$;

create or replace function public.create_household_invite_for_user(target_household uuid, target_user uuid)
returns uuid language plpgsql security definer set search_path=public
as $$
declare created_token uuid;
begin
  if not exists(select 1 from household_members where household_id=target_household and user_id=auth.uid() and role='owner') then raise exception 'Only an owner can invite members'; end if;
  if exists(select 1 from household_members where household_id=target_household and user_id=target_user) then raise exception 'That person is already a household member'; end if;
  insert into household_invites(household_id, invited_user_id, role) values(target_household, target_user, 'editor') returning token into created_token;
  return created_token;
end;
$$;

create or replace function public.accept_household_invite(invite_token uuid)
returns void language plpgsql security definer set search_path=public
as $$
declare target household_invites%rowtype;
begin
  select * into target from household_invites where token=invite_token and expires_at > now();
  if target.id is null then raise exception 'Invite is invalid or expired'; end if;
  if target.invited_user_id is not null and target.invited_user_id <> auth.uid() then raise exception 'This invitation belongs to a different account'; end if;
  if target.invited_user_id is null and lower(coalesce(target.email,'')) <> lower(coalesce(auth.jwt()->>'email','')) then raise exception 'This invitation was sent to a different email'; end if;
  insert into household_members(household_id,user_id,role) values(target.household_id,auth.uid(),target.role) on conflict do nothing;
  delete from household_invites where id=target.id;
end;
$$;

revoke all on function public.search_totehome_people(text) from public;
grant execute on function public.search_totehome_people(text) to authenticated;
revoke all on function public.create_household_invite_for_user(uuid,uuid) from public;
grant execute on function public.create_household_invite_for_user(uuid,uuid) to authenticated;
