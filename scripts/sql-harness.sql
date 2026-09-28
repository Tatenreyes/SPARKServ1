-- =========================================================
-- Test fixture: stand-ins for the objects Supabase manages for you.
-- ---------------------------------------------------------
-- supabase/schema.sql is written for a real Supabase project, so it references
-- auth.users (signup trigger), storage.buckets/storage.objects (profile photos)
-- and the anon/authenticated/service_role roles. None of those exist in a bare
-- Postgres, so scripts/test-queue-sql.mjs loads this file first.
--
-- Everything else the queue test loads comes straight from the repo's real
-- migration files, so the queue logic is exercised against the real DDL.
-- =========================================================

create extension if not exists "uuid-ossp";
create schema if not exists auth;
create schema if not exists storage;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end
$roles$;

create table if not exists auth.users (
  id uuid primary key default uuid_generate_v4(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

-- Supabase's auth.uid() reads the JWT claims GUC. The test impersonates callers
-- by setting that same GUC under `set role authenticated`, which is how RLS and
-- the role guards inside the queue RPCs get exercised.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);

create table if not exists storage.objects (
  id uuid primary key default uuid_generate_v4(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid
);

-- Supabase ships this helper (splits a storage object path into folders); the
-- "users can upload their profile photo" policy in schema.sql calls it.
create or replace function storage.foldername(p_name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(coalesce(p_name, ''), '/');
$$;


