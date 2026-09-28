# SPARKServ — Architecture

SPARKServ is a Next.js 14 App Router application on Supabase (Postgres + Auth +
Storage + RLS). The queue redesign did not change that shape; it changed **where
the queue decision lives**, and that is the most important thing on this page.

## Layering

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. Postgres (Supabase)                                           │
│    The ONLY place that decides who gets work.                    │
│    • queue tables + audit trail      (migration_queue_redesign)  │
│    • assign / respond / expire / eligibility / capacity functions│
│    • row lock + advisory lock per request                        │
│    • RLS: clients may read the queue, never write it             │
└───────────────▲──────────────────────────────────────────────────┘
                │ typed RPC wrappers; service-role for mutations
┌───────────────┴──────────────────────────────────────────────────┐
│ 2. Server logic                                                  │
│    src/lib/assignment.ts   — RPC wrappers (assign, respond,      │
│                              expire, conflict check, status)     │
│    src/lib/queue.ts        — client-safe vocabulary + view model │
│    src/lib/service-time.ts — timezone/duration helpers           │
│    src/app/api/**          — route handlers (auth, validation)   │
└───────────────▲──────────────────────────────────────────────────┘
                │ server components read; server routes mutate
┌───────────────┴──────────────────────────────────────────────────┐
│ 3. UI                                                            │
│    Server components: dashboard, /technician/queue,              │
│                       /admin/technician-queue, request pages     │
│    Client components: offer accept/decline, override control,    │
│                       wizard steps, countdowns                   │
└──────────────────────────────────────────────────────────────────┘
```

### Rule 1 — the queue is never computed in React

`src/lib/queue.ts` contains no ordering logic. It groups the rows returned by
`technician_queue_snapshot()`, labels them and formats times. The UI therefore
cannot disagree with the assignment engine: both read the same rows in the same
order.

The previous implementation broke this rule. The technician dashboard read
`technician_queue_state` with the service-role key, sorted it by
`last_assigned_at`, and derived a position from the technician's first
specialization. Two sources of truth, one of them wrong — and it only described a
single appliance, which is why a technician saw a queue containing only
themselves.

### Rule 2 — clients cannot mutate the queue

`assign_technician_to_request`, `respond_to_offer`, `expire_stale_offers` and
`consume_queue_turn` are revoked from `anon` and `authenticated`. The only write
path from a browser is a server route that authenticates the caller and then calls
the mutation with the service-role client. `admin_queue_override` is the single
exception: it requires a written reason and writes an audit row naming the acting
administrator.

`technician_queue_events` has no client insert path at all, so history cannot be
fabricated.

### Rule 3 — the service-role key never reaches the browser

`createServiceRoleClient()` lives in `src/lib/supabase/server.ts` and is imported
only by server modules. Client components receive plain data as props.

## Module map

| Concern | File |
| --- | --- |
| Queue rules, membership, audit | `supabase/migration_queue_redesign.sql` |
| Engine wrappers (server) | `src/lib/assignment.ts` |
| Queue view model (shared, presentation only) | `src/lib/queue.ts` |
| Queue UI | `src/components/QueueCard.tsx`, `src/app/technician/queue/page.tsx` |
| Admin monitor + audited override | `src/app/admin/technician-queue/page.tsx`, `src/components/QueueOverrideControl.tsx` |
| Customer-facing state copy | `src/lib/queue.ts` (`customerAssignmentCopy`), `src/components/AssignmentStatusCard.tsx` |
| Request intake | `src/app/api/service-requests/route.ts` |
| Offer response | `src/app/api/service-requests/[id]/offer-response/route.ts` |
| Scheduled sweep | `src/app/api/cron/assignment-tick/route.ts` + `vercel.json` |
| Availability settings | `src/app/api/technician-availability/route.ts`, `src/components/ProfileForm.tsx` |
| Booking creation / conflict handling | `src/app/api/bookings/route.ts` |
| Navigation | `src/lib/navConfig.ts` |

## Flows

### A request arrives

```
POST /api/service-requests
  → validate, persist the request including requested_window_start/end
  → assignTechnician()      [service role → assign_technician_to_request]
  → notify the offered technician
  → response carries assignment_status ('offered' | 'waiting')
```

### A technician responds

```
POST /api/service-requests/:id/offer-response
  → requireRole(technician) + ownership check on the offer
  → respondToOffer()        [service role → respond_to_offer]
      accept  → turn consumed; position moves to the end of that appliance queue
      decline → reason recorded; queue re-walked; next candidate offered
  → refreshOperationalStatus(), notify as needed
```

### The clock keeps things moving

```
GET /api/cron/assignment-tick   (Vercel cron, every 5 minutes — vercel.json)
  → expireStaleOffers()     [service role → expire_stale_offers]
      lapse offers past their TTL, log EXPIRED, re-offer
  → rematchWaitingRequests()
  → notify affected technicians
```

`CRON_SECRET` must be set in the deployment environment or the route refuses to
run in production — see `TESTING.md`.

### A booking is made

```
POST /api/bookings
  → hasScheduleConflict(technician, start, end) → 409 instead of a hidden clash
  → capacity check
  → insert the booking (scheduled_at + duration_minutes)
```

Booking creation moves no queue positions: the turn was already consumed at
acceptance, which is the difference from the old model.

## Observability

| Question | Where to look |
| --- | --- |
| Why did this technician get the offer? | `technician_queue_events` (`OFFERED`) |
| Why was this technician skipped? | `technician_queue_events` (`SKIPPED_*`, with reason and unchanged position) |
| Where is everyone in the rotation? | `/admin/technician-queue` or `technician_queue_snapshot()` |
| Who changed the rotation by hand? | `technician_queue_events` (`ADMIN_OVERRIDE`, with `actor_id` and reason) |

## Testing the architecture

`npm run test:queue-sql` (in-process Postgres, schema + migrations, full
scenario) and `npm run verify:queue` (live project, real JWTs, real RLS). See
`TESTING.md`.

## Deliberate non-goals

- **No technician ranking, recommendation or "best match".** Ratings and
  experience are display data; the rotation is the only selection mechanism.
- **No customer-side technician selection.** A customer cannot pick or switch a
  technician, and never sees the queue.
- **No client-side queue state.** Not in React, not in local storage, not in a
  reducer.

