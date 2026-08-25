-- Run once on the existing ToteHome Supabase project.
-- A user can delete only their own authenticated account.

alter table households drop constraint if exists households_created_by_fkey;
alter table households
  add constraint households_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete cascade;

create or replace function public.delete_current_user()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_current_user() from public;
grant execute on function public.delete_current_user() to authenticated;
