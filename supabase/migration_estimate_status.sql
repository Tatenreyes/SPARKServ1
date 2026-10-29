-- =========================================================
-- Migration: estimate status vocabulary (STEP 1 of 2)
-- ---------------------------------------------------------
-- Adds the three states the estimate workflow needs on top of the existing
-- `pending | accepted | rejected`:
--
--   draft              the technician is still preparing it. The customer must
--                      not see it, and the technician may edit it in place
--                      (nothing the customer saw is overwritten).
--   revision_requested the customer asked for a change; the technician owes a
--                      revised version.
--   superseded         a newer version replaced this one. The row keeps its
--                      amounts, scope, timestamps and any approval record.
--
-- `pending` keeps its meaning (awaiting the customer's decision), `accepted` is
-- the approval and `rejected` the decline — no existing value is renamed or
-- removed, so every current query, badge and reader keeps working.
--
-- WHY THIS IS A SEPARATE FILE
--   PostgreSQL refuses to *use* an enum value in the same transaction that adds
--   it ("unsafe use of new value"). The workflow migration creates index
--   predicates and policy checks that reference these values, so the values must
--   be committed first. Apply this file, then migration_estimate_workflow.sql.
--
-- Safe to run more than once (`add value if not exists`).
-- =========================================================

alter type public.estimate_status add value if not exists 'draft';
alter type public.estimate_status add value if not exists 'revision_requested';
alter type public.estimate_status add value if not exists 'superseded';
