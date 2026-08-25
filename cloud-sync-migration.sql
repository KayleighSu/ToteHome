-- Shared households, invitations, and private photo storage.

create unique index if not exists locations_household_name_unique
on locations (household_id, lower(name));

insert into storage.buckets (id, name, public)
values ('tote-photos', 'tote-photos', false)
on conflict (id) do update set public = false;

create policy "household members read tote photos"
on storage.objects for select to authenticated
using (
  bucket_id = 'tote-photos'
  and exists (
    select 1 from household_members m
    where m.household_id::text = (storage.foldername(name))[1]
      and m.user_id = auth.uid()
  )
);

create policy "members upload their tote photos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'tote-photos'
  and (storage.foldername(name))[2] = auth.uid()::text
  and exists (
    select 1 from household_members m
    where m.household_id::text = (storage.foldername(name))[1]
      and m.user_id = auth.uid()
  )
);

create policy "uploaders update their tote photos"
on storage.objects for update to authenticated
using (bucket_id = 'tote-photos' and (storage.foldername(name))[2] = auth.uid()::text)
with check (bucket_id = 'tote-photos' and (storage.foldername(name))[2] = auth.uid()::text);

create policy "uploaders delete their tote photos"
on storage.objects for delete to authenticated
using (bucket_id = 'tote-photos' and (storage.foldername(name))[2] = auth.uid()::text);

create or replace function public.create_household(household_name text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare created_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if length(trim(household_name)) < 1 then raise exception 'Household name required'; end if;
  insert into households(name, created_by) values(trim(household_name), auth.uid()) returning id into created_id;
  insert into household_members(household_id, user_id, role) values(created_id, auth.uid(), 'owner');
  return created_id;
end;
$$;
revoke all on function public.create_household(text) from public;
grant execute on function public.create_household(text) to authenticated;

create or replace function public.create_household_invite(target_household uuid, target_email text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare created_token uuid;
begin
  if not exists(select 1 from household_members where household_id=target_household and user_id=auth.uid() and role='owner') then raise exception 'Only an owner can invite members'; end if;
  insert into household_invites(household_id, email, role) values(target_household, lower(trim(target_email)), 'editor') returning token into created_token;
  return created_token;
end;
$$;
revoke all on function public.create_household_invite(uuid,text) from public;
grant execute on function public.create_household_invite(uuid,text) to authenticated;

create or replace function public.accept_household_invite(invite_token uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare target household_invites%rowtype;
begin
  select * into target from household_invites where token=invite_token and expires_at > now();
  if target.id is null then raise exception 'Invite is invalid or expired'; end if;
  if lower(target.email) <> lower(coalesce(auth.jwt()->>'email','')) then raise exception 'This invitation was sent to a different email'; end if;
  insert into household_members(household_id,user_id,role) values(target.household_id,auth.uid(),target.role) on conflict do nothing;
  delete from household_invites where id=target.id;
end;
$$;
revoke all on function public.accept_household_invite(uuid) from public;
grant execute on function public.accept_household_invite(uuid) to authenticated;
