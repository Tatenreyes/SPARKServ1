-- Run this migration in the Supabase SQL Editor to add separate name and address fields.

alter table public.users add column if not exists first_name text;
alter table public.users add column if not exists last_name text;
alter table public.users add column if not exists middle_initial text;
alter table public.users add column if not exists address text;
