-- Prevent self-service role escalation. Role changes must go through the
-- super-admin API, which uses the service role after requireRole().

create or replace function public.prevent_role_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.role is distinct from old.role
    and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
    and not public.is_admin() then
    raise exception 'Only an administrator can change user roles';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_user_role on public.users;
create trigger protect_user_role
  before update on public.users
  for each row execute procedure public.prevent_role_change();

drop policy if exists "users can update their own profile" on public.users;
create policy "users can update their own profile"
  on public.users for update
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());