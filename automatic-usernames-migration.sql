-- Generate usernames for everyone except the app owner's account.
create or replace function public.assign_totehome_username()
returns trigger language plpgsql set search_path=public
as $$
declare base text; candidate text;
begin
  if new.username is not null or lower(new.email) = 'kayleigh.su@gmail.com' then return new; end if;
  base := lower(regexp_replace(coalesce(nullif(new.display_name,''), split_part(new.email,'@',1), 'toteuser'), '[^a-zA-Z0-9]+', '_', 'g'));
  base := trim(both '_' from left(base,18));
  if length(base) < 3 then base := 'toteuser'; end if;
  loop
    candidate := base || '_' || lpad(floor(random()*10000)::text,4,'0');
    exit when not exists(select 1 from profiles where lower(username)=lower(candidate));
  end loop;
  new.username := candidate;
  return new;
end;
$$;

drop trigger if exists assign_totehome_username_before_save on public.profiles;
create trigger assign_totehome_username_before_save before insert or update on public.profiles
for each row execute function public.assign_totehome_username();

update public.profiles set username=null
where username is null and lower(email) <> 'kayleigh.su@gmail.com';
