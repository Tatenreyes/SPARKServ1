# SPARKServ — Roles and Permissions

Four roles live in `public.users.role`: `customer`, `technician`, `admin`,
`super_admin`. Guards are enforced three times over: server-side in the route/page
(`requireRole`, `getCurrentUser`), in the database (RLS + `SECURITY DEFINER`
role checks), and in the UI (navigation and affordances only).

## Queue-related capability matrix

| Capability | Customer | Technician | Admin / super admin |
| --- | --- | --- | --- |
| See their own request's assignment state | ✅ | — | ✅ |
| See the technician queue (positions, names) | ❌ | ✅ own appliances | ✅ all |
| See another technician's position | ❌ | ✅ | ✅ |
| See their own position + "You" marker | — | ✅ | — |
| See next booking / current job per technician | ❌ | ✅ (time only) | ✅ |
| See offer state per technician | ❌ | own offer only | ✅ |
| See queue audit history / skip reasons | ❌ | ❌ | ✅ |
| Accept or decline an offer | ❌ | ✅ own offers | ❌ (use override) |
| Choose or switch a technician | ❌ | ❌ | ❌ |
| Edit queue positions | ❌ | ❌ | ✅ via audited override only |
| Trigger the expiry sweep by hand | ❌ | ❌ | ❌ (cron/`service_role`) |
| Read `technician_queue_events` directly | ❌ | own rows only | ✅ |

## What each role must never see

| Role | Must not see |
| --- | --- |
| Customer | any queue position, any technician list, other customers' data, technician documents |
| Technician | customers' phone numbers/addresses beyond the job they accepted, other technicians' account details, other technicians' documents, admin-only reports |
| Admin | nothing queue-related is out of scope, but every manual change is audited; customer PII access stays within existing `service_requests`/`bookings` policies |

## Database enforcement

- `technician_queue_snapshot(text)` raises for any caller whose role is not
  technician/admin. A customer calling it gets an error, not an empty list — so a
  UI bug cannot silently leak "nobody is available".
- The snapshot filters rows for technicians to appliances they belong to; admins
  bypass that filter.
- `admin_queue_override(...)` re-checks `is_admin()` inside the function.
- `respond_to_offer(...)` refuses when the caller is neither the offered
  technician nor an admin.
- `assign_technician_to_request`, `expire_stale_offers`, `consume_queue_turn` and
  the eligibility helpers are executable by `service_role` only.

## Auditing

Every queue mutation writes `technician_queue_events` with the acting identity in
`actor_id` (null when the system/cron did it) and a reason. Administrative
overrides additionally embed the administrator's name in the reason text, so the
audit row is readable without a join.

## Verifying permissions

```bash
npm run test:queue-sql   # RLS/role assertions in-process
npm run verify:queue     # real JWTs: technician sees the queue, customer is refused
```

`verify:queue` covers: a technician reading the whole rotation, a customer being
refused the snapshot, a technician being unable to update
`technician_queue_state`, a customer being unable to touch it at all, and a
technician being refused `admin_queue_override`.
