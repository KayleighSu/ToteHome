-- Cloud model for accounts, shared households, locations, totes, and items.
create extension if not exists "pgcrypto";

create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table household_members (
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','editor','viewer')) default 'editor',
  primary key (household_id, user_id)
);
create table locations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  detail text,
  sort_order integer not null default 0
);
create table totes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  location_id uuid references locations(id) on delete set null,
  tote_number integer not null,
  title text not null,
  location_detail text,
  color text,
  image_url text,
  updated_at timestamptz not null default now(),
  unique (household_id, tote_number)
);
create table items (
  id uuid primary key default gen_random_uuid(),
  tote_id uuid not null references totes(id) on delete cascade,
  name text not null,
  quantity text,
  notes text,
  image_url text,
  created_at timestamptz not null default now()
);
create table household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  email text not null,
  role text not null check (role in ('editor','viewer')) default 'editor',
  token uuid not null default gen_random_uuid(),
  expires_at timestamptz not null default now() + interval '7 days'
);

-- Every confirmed account starts with one completely empty household.
create or replace function public.create_first_household()
returns trigger language plpgsql security definer set search_path = public
as $$
declare new_household uuid;
begin
  insert into households (name, created_by) values ('My Household', new.id) returning id into new_household;
  insert into household_members (household_id, user_id, role) values (new_household, new.id, 'owner');
  return new;
end;
$$;
create trigger create_household_after_signup
after insert on auth.users for each row execute procedure public.create_first_household();

alter table households enable row level security;
alter table household_members enable row level security;
alter table locations enable row level security;
alter table totes enable row level security;
alter table items enable row level security;
alter table household_invites enable row level security;

create or replace function is_household_member(target uuid)
returns boolean language sql security definer stable set search_path = public
as $$ select exists(select 1 from household_members where household_id=target and user_id=auth.uid()) $$;
create policy "members read households" on households for select using (is_household_member(id));
create policy "members read membership" on household_members for select using (is_household_member(household_id));
create policy "members manage locations" on locations for all using (is_household_member(household_id)) with check (is_household_member(household_id));
create policy "members manage totes" on totes for all using (is_household_member(household_id)) with check (is_household_member(household_id));
create policy "members manage items" on items for all using (exists(select 1 from totes t where t.id=tote_id and is_household_member(t.household_id))) with check (exists(select 1 from totes t where t.id=tote_id and is_household_member(t.household_id)));
create policy "owners manage invites" on household_invites for all using (exists(select 1 from household_members m where m.household_id=household_invites.household_id and m.user_id=auth.uid() and m.role='owner')) with check (exists(select 1 from household_members m where m.household_id=household_invites.household_id and m.user_id=auth.uid() and m.role='owner'));

create or replace function public.delete_current_user()
returns void language plpgsql security definer set search_path = public, auth
as $$ begin delete from auth.users where id = auth.uid(); end; $$;
revoke all on function public.delete_current_user() from public;
grant execute on function public.delete_current_user() to authenticated;
