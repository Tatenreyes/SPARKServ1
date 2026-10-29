-- =========================================================
-- Migration: troubleshooting identification + reported outcome
-- ---------------------------------------------------------
-- WHAT THIS ADDS
--   1. `service_requests.issue_id` — the canonical issue the customer
--      identified, as a stable catalogue id from src/lib/appliance-issues.ts
--      (e.g. "not-cooling"). `issue_category` already carries the human label,
--      so a row stays readable without a lookup and historical rows keep working.
--   2. `service_requests.troubleshooting_outcome` — what the customer REPORTED
--      after the optional preliminary checks: 'resolved' | 'unresolved' |
--      'skipped', or NULL when they never reached them.
--
-- WHY BOTH ARE NULLABLE
--   A request is valid without an identified issue: the customer may describe the
--   fault in words the reviewed mappings do not cover, and must still be able to
--   submit and let a technician diagnose it. NULL therefore means "not identified"
--   / "no outcome reported", never "no problem".
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   * No status transitions: a reported outcome is not a repair result and never
--     completes a request, a booking or a visit. `service_requests.status` is
--     untouched by this migration and by the form.
--   * No new table and no duplicate column: `chatbot_resolved` (which already
--     meant "self-service reported this resolved") is kept in step with the
--     outcome by the API, and remains the boolean readers already use.
--   * No RLS change: both columns live on `service_requests`, so the existing
--     policies already apply — a customer sees only their own request, an
--     assigned technician sees theirs, administrators see all.
--
-- Safe to run more than once: every statement is guarded.
-- =========================================================

alter table public.service_requests
  add column if not exists issue_id text,
  add column if not exists troubleshooting_outcome text;

-- `add constraint ... check` is not idempotent, so it is guarded.
do $outer$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'service_requests_troubleshooting_outcome_check'
      and conrelid = 'public.service_requests'::regclass
  ) then
    alter table public.service_requests
      add constraint service_requests_troubleshooting_outcome_check
      check (
        troubleshooting_outcome is null
        or troubleshooting_outcome in ('resolved', 'unresolved', 'skipped')
      );
  end if;
end
$outer$;
