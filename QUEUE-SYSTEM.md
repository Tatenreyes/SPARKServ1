# SPARKServ — Queue System (Model v2)

> **This describes the current model.** The previous behaviour — "remove the
> technician from the queue until the current repair is completed" — is gone and
> must not be reintroduced. A future booking never removes anybody from the queue.

## The five concepts (do not merge them)

| Concept | Question it answers | Where it lives |
| --- | --- | --- |
| **Queue position** | Whose turn is it? | `technician_queue_state.queue_position` |
| **Eligibility** | Is this technician allowed to take this work at all? | `technician_eligibility_failure()` |
| **Availability** | Can they work *this requested window*? | `technician_schedule_conflict()` + `technician_within_availability()` |
| **Schedule / capacity** | What is actually booked, and how much more fits? | `bookings` + `technician_capacity_failure()` |
| **Assignment** | Who actually took it? | `service_requests.assignment_status = 'accepted'` |

The rule, in one sentence:

> Queue position determines **fairness**. Eligibility determines **whether a
> technician can handle the request**. Availability determines **whether they can
> work at the requested time**. Schedule/capacity determines **whether accepting
> creates a conflict or an overload**.

One merged "busy/free" flag is the bug this model exists to remove. A technician
can be `SCHEDULED` (has a future appointment), sit at position `#2`, and still be
the correct person to offer a Wednesday-morning repair to.

### The forbidden inference

```
future_booking_exists  =>  technician_unavailable        -- WRONG, never do this
```

There is no `availability` boolean derived from the existence of a booking
anywhere in this codebase, and no queue membership is removed because of one.

## What is fair, and what is deliberately not

The queue is a strict rotation. It never considers:

- ratings, reviews, popularity;
- experience, seniority, "best technician" scoring;
- completed job count;
- admin preference.

There is no ranking, no recommendation endpoint and no "preferred technician"
pathway. `rating`, `experience_years` and `jobs_completed` exist on `technicians`
for display and reporting; no queue function reads them.

## The flow

```
Customer submits a repair request (requested window recorded)
        ↓
assign_technician_to_request()
        ↓  sync_appliance_queue_memberships(appliance)
for each technician in queue order:
        ↓
   technician_eligibility_failure()   -- approved, active, specialised, in area,
        ↓                               not suspended, no live offer, no clash,
        ↓                               capacity available
   reason is null?  ── no ──►  log_queue_event(SKIPPED_*)  → next candidate
        ↓ yes                                     (position UNCHANGED)
   offer created, offers_expires_at = now() + queue_offer_ttl_minutes
        ↓
Accept / Decline / Expire
        ↓
ACCEPT  → consume_queue_turn(): position → END of that appliance's rotation,
          turn_count +1, request = 'accepted'
DECLINE → reason recorded, queue re-walked for the next candidate
          (turn kept, unless `queue_decline_consumes_turn` = true)
EXPIRE  → expire_stale_offers() logs EXPIRED and re-walks the queue
        ↓
No candidate left → request becomes WAITING_FOR_TECHNICIAN
```

Every step runs inside a Postgres function holding a row lock on the request and
a per-request advisory lock, so two concurrent calls cannot both "win" it.

## Queue membership lifecycle

| Moment | Effect on the rotation |
| --- | --- |
| Specialization added / technician approved | joins that appliance queue at the **end** (`JOINED_QUEUE`) |
| Offer accepted | turn consumed, moves to the **end** (`TURN_CONSUMED`, `MOVED_TO_END`) |
| Offer declined | **no position change** by default (`DECLINED`) |
| Offer expired unanswered | **no position change** (`EXPIRED`) |
| Skipped (clash / capacity / unavailable / outside area / already holding an offer) | **no position change**; the skip applies to that one request |
| Repair completed | **no position change** — the turn was spent at acceptance |
| Customer cancels after acceptance | **no position change** — never a reset to the front |
| Rescheduled (30 Jan → 31 Jan) | **no position change** — only the booking moves |
| Specialization removed / account deactivated | leaves that queue (`REMOVED`); other queues untouched |
| Admin override | moves within the rotation only, reason required (`ADMIN_OVERRIDE`) |

## Statuses

Operational status (`technicians.operational_status`) is **not** availability for
a specific job:

| Status | Meaning |
| --- | --- |
| `AVAILABLE` | no active job, nothing booked right now |
| `ON_JOB` | on site; can still be offered later appointments |
| `SCHEDULED` | has a future appointment; still in the rotation |
| `TEMPORARILY_UNAVAILABLE` | marked unavailable, or on approved time off |
| `OFFLINE` | account inactive |
| `SUSPENDED` | not eligible for offers |

Queue status per membership (technician/admin views): `NEXT_TURN`,
`IN_ROTATION`, `TEMPORARILY_REMOVED`.


## Audit trail (`technician_queue_events`)

Written only by `SECURITY DEFINER` functions, so no client can fabricate history.
Actions include: `JOINED_QUEUE`, `TURN_CONSUMED`, `MOVED_TO_END`,
`POSITION_CHANGED`, `SKIPPED_DUE_TO_SCHEDULE`, `SKIPPED_DUE_TO_CAPACITY`,
`SKIPPED_DUE_TO_UNAVAILABLE`, `SKIPPED_DUE_TO_SERVICE_AREA`,
`SKIPPED_DUE_TO_ACTIVE_OFFER`, `OFFERED`, `ACCEPTED`, `DECLINED`, `EXPIRED`,
`REMOVED`, `REACTIVATED`, `STATUS_CHANGED`, `WAITING_FOR_TECHNICIAN`,
`ADMIN_OVERRIDE`.

Each row carries the technician, appliance type, request, action, `old_position`,
`new_position`, a human-readable `reason`, `actor_id` (null = the system) and a
timestamp. A skip records `old_position = new_position` — that is how "still in
position, but not offered *this* request" is proved.

## Capacity

Time-based first: `technicians.max_daily_hours` (default 8) is compared against
the hours already booked on the requested day **plus** the requested duration.
Also enforced: `max_concurrent_jobs` (default 2) and `max_jobs_per_day`
(default 4). A technician who cannot fit the request is skipped for **that
request only**.

## Settings (`system_settings`, read through `queue_setting*`)

| Key | Default | Meaning |
| --- | --- | --- |
| `queue_offer_ttl_minutes` | `15` | how long an offer stays live before it lapses |
| `queue_decline_consumes_turn` | `false` | whether declining costs the turn |
| `queue_service_timezone` | `Asia/Manila` | timezone used for daily hours/availability |
| `queue_model_version` | `2` | marker asserted by the verification script |

**Decline policy (documented default):** a decline records the reason and passes
the request on *without* consuming the turn. Rationale: the rotation rewards work
taken, not offers refused, and a turn-consuming decline would punish a technician
for being unavailable at one specific time. Flip `queue_decline_consumes_turn` to
`true` to change the policy — the behaviour is implemented and audited either way,
so switching it is a settings change, not a code change.

## Server-side API (RPCs)

| Function | Access | Purpose |
| --- | --- | --- |
| `assign_technician_to_request(uuid)` | `service_role` | walk the queue, create an offer |
| `respond_to_offer(uuid, uuid, text, text)` | `service_role` | accept / decline |
| `expire_stale_offers()` | `service_role` | lapse ignored offers and re-offer |
| `consume_queue_turn(...)` | `service_role` | move a technician to the end (audited) |
| `technician_queue_snapshot(text)` | `authenticated`, `service_role` | full queue per appliance (technicians: queues they belong to; admins: all) |
| `admin_queue_override(text, uuid, text, text)` | `authenticated` (admin-checked), `service_role` | audited manual correction |
| `refresh_technician_operational_status(uuid)` | `service_role` | recompute `operational_status` |
| `technician_eligibility_failure(...)`, `technician_schedule_conflict(...)`, `technician_capacity_failure(...)`, `technician_within_availability(...)` | `service_role` | the checks the queue walk uses |

`assign_technician_to_request`, `respond_to_offer`, `expire_stale_offers`,
`consume_queue_turn` and the eligibility helpers are **revoked** from `anon` and
`authenticated`: a browser can never move itself in the queue. Application code
calls them from server routes with the service-role client
(`src/lib/assignment.ts`).

## Server routes and UI

| Surface | Route / file |
| --- | --- |
| Request intake (records the requested window) | `POST /api/service-requests` |
| Technician accept/decline | `POST /api/service-requests/[id]/offer-response` |
| Expiry sweep + waiting rematch (cron, every 5 min) | `GET /api/cron/assignment-tick` (see `vercel.json`) |
| Booking creation with conflict + capacity checks | `POST /api/bookings` |
| Queue reads (server-rendered) | `src/lib/queue.ts` + `technician_queue_snapshot()` |
| Technician queue page | `/technician/queue` — tabs per appliance, full rotation, `YOU` marker |
| Technician dashboard card | `/technician/dashboard` (`src/components/QueueCard.tsx`) |
| Admin monitor | `/admin/technician-queue` — positions, statuses, next bookings, skips, offer activity, history, audited override |
| Admin override endpoint | `POST /api/admin/queue-override` |
| Technician availability (windows, time off, service areas) | `GET|POST /api/technician-availability` |
| Availability editor screen | `/technician/profile` (`src/components/AvailabilityManager.tsx`) |
| Migration-state gate | `npm run db:check` (`scripts/check-migration-state.mjs`) |

## Who sees what

| Audience | Sees |
| --- | --- |
| Customer | request state only: "Checking technician availability", "Waiting for a technician to respond", "Waiting for an eligible technician", "Technician accepted your request". Never a position, never the list, and no ability to choose or switch technicians. |
| Technician | the whole rotation for each appliance they cover — every technician's name, position, operational status and next booking, with themselves clearly marked. Never phone numbers, addresses, customer data or documents. |
| Admin | all of the above plus current job, offer state, skip reasons, timestamps and the queue history, with a reason-required, fully audited override. |

## Worked example (the acceptance scenario)

Start: `A → B → C`

| Day | Event | Rotation after |
| --- | --- | --- |
| 23 Jan | A accepts a repair booked for 30 Jan | `B → C → A` (A is still a member at #3) |
| 24 Jan | new request; B is next and free | B accepts → `C → A → B` |
| 25 Jan | new request; C is next and free | C accepts → `A → B → C` |
| 26 Jan | new request; A is next, and 26 Jan does not clash with A's 30 Jan booking | A accepts → `B → C → A` |

A therefore legitimately holds both the 26 Jan and the 30 Jan repairs. A request
for 30 Jan 10:00–12:00 skips A for that request only (a real clash) and leaves A's
position untouched.

## Enforcement

`npm run test:queue-sql` proves the model against a real Postgres running
in-process; `npm run verify:queue` proves it against the live project. Both are
described in `TESTING.md`.

## Surfaces removed with this model

Two things had to go because they implemented the opposite of a fair queue:

* **`POST /api/recommend`** (`src/app/api/recommend/route.ts`) — returned every
  approved technician ranked best-match-first, callable by a customer for their
  own request.
* **`rankTechnicians()`** (`src/lib/recommendation.ts`) and the
  `TechnicianWithScore` type — scored on `rating × 20 + experience_years × 4 +
  (1/distance) × 50`, with a boolean `availability` field and an `is_new` boost.
* **`TechnicianCard`** (`src/components/TechnicianCard.tsx`) — the UI for that
  ranking: a rank badge, a "match score" figure, and an `onSelect` handler that
  let a customer pick the technician it ranked for them.

Neither was consumed by any screen (only marketing copy mentioned them), so
removing them breaks no workflow. They are recorded here rather than silently
deleted, so that "why doesn't the app rank technicians?" has an answer: ratings,
experience and distance are never queue inputs, `technician_queue_snapshot()` is
the only thing that answers "who is next", and availability is a per-request
check against schedules and bookings — never a stored boolean on a person.


