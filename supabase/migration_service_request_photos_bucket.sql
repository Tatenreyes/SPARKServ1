-- ============================================================================
-- Repair-request photo evidence bucket
-- ============================================================================
--
-- Why this is needed
-- ------------------
-- "Request a Repair" collects photos of the appliance, the model label and the
-- fault. The wizard used to store `URL.createObjectURL(file)` values, which are
-- `blob:` URLs scoped to the browser tab that created them. They were written to
-- `service_requests.photos` and were dead as soon as the page was closed, so no
-- technician has ever been able to open the evidence a customer submitted.
--
-- `/api/service-requests/photos` now uploads to this bucket with the service
-- role and stores the resulting public URL instead.
--
-- How to apply
-- ------------
-- Supabase SQL Editor, one statement batch. Written to be idempotent, so
-- re-running it is harmless.
--
-- Note on access: the bucket is PUBLIC read, PRIVATE write. Public read is what
-- makes the stored URL renderable in an <img> for a technician who is not the
-- uploader. Nothing can be written to it from the browser — uploads go through
-- the Next route, which authenticates the caller with `getCurrentUser()` and then
-- writes with the service-role key. No storage RLS policy is therefore needed
-- for writes, and none is granted to `anon` or `authenticated`.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'service-request-photos',
  'service-request-photos',
  true,
  10485760, -- 10 MB, matching the API route's own limit
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Verify: this must return one row.
select id, public, file_size_limit
from storage.buckets
where id = 'service-request-photos';
