-- Repair technician registration when the original schema trigger was not deployed.
-- Safe to run against an existing database.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  signup_role public.user_role;
begin
  signup_role := case
    when new.raw_user_meta_data->>'role' in ('customer', 'technician')
      then (new.raw_user_meta_data->>'role')::public.user_role
    else 'customer'::public.user_role
  end;

  insert into public.users (id, name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    signup_role
  )
  on conflict (id) do update
    set name = excluded.name,
        email = excluded.email,
        role = excluded.role;

  if signup_role = 'technician' then
    insert into public.technicians (id)
    values (new.id)
    on conflict (id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Recover Auth accounts created while the trigger was missing.
insert into public.users (id, name, email, role)
select
  au.id,
  coalesce(au.raw_user_meta_data->>'name', split_part(au.email, '@', 1)),
  au.email,
  case
    when au.raw_user_meta_data->>'role' in ('customer', 'technician')
      then (au.raw_user_meta_data->>'role')::public.user_role
    else 'customer'::public.user_role
  end
from auth.users au
where not exists (
  select 1 from public.users u where u.id = au.id
);

-- Correct profiles created as customers before technician metadata handling was fixed.
update public.users u
set role = 'technician'::public.user_role
from auth.users au
where au.id = u.id
  and au.raw_user_meta_data->>'role' = 'technician'
  and u.role = 'customer'::public.user_role;

insert into public.technicians (id)
select u.id
from public.users u
where u.role = 'technician'
on conflict (id) do nothing;
