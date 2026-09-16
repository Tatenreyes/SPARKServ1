-- Run this in the Supabase SQL Editor. Adds a small key/value settings table
-- for the Super Admin panel (maintenance mode toggle + a platform-wide
-- announcement banner). Nothing here touches existing tables.

create table public.system_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id)
);

alter table public.system_settings enable row level security;

create policy "anyone can read settings"
  on public.system_settings for select
  using (true);

create policy "admins manage settings"
  on public.system_settings for all
  using (public.is_admin())
  with check (public.is_admin());

insert into public.system_settings (key, value) values
  ('maintenance_mode', 'false'),
  ('platform_announcement', '');
