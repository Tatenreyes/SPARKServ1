-- Run this in the Supabase SQL Editor. Adds in-app notifications (bell icon,
-- real-time) and stored browser push subscriptions (so notifications can
-- reach a user even when the SPARKServ tab is closed).

create table public.notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

create policy "user views own notifications"
  on public.notifications for select
  using (user_id = auth.uid() or public.is_admin());

create policy "user marks own notifications read"
  on public.notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Inserts always happen server-side via the service-role client (a
-- notification is a system event, not something a user creates directly).
create policy "admin manages notifications"
  on public.notifications for all
  using (public.is_admin())
  with check (public.is_admin());

create index idx_notifications_user on public.notifications(user_id, created_at desc);
create index idx_notifications_unread on public.notifications(user_id) where read = false;

create table public.push_subscriptions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create policy "user manages own push subscriptions"
  on public.push_subscriptions for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

create index idx_push_subscriptions_user on public.push_subscriptions(user_id);
