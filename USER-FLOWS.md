# SPARKServ — User Flows

Every flow below reflects the current queue model. The queue rules themselves
live in `QUEUE-SYSTEM.md`; this file is about what each person actually does and
sees.

---

## Customer

### 1. Submit a repair

```
Dashboard → Request repair
  → pick appliance (existing `appliances` row, or add one)
  → describe the issue (+ photos)
  → service type: on_site | home_service | pickup
  → optionally pick a preferred date AND start/end time
  → submit  →  POST /api/service-requests
```

The customer never browses, searches, sorts or picks a technician, and no screen
offers a "choose your technician" or "best rated" control. There is no API for
it either — `GET /api/service-requests` returns only the caller's own requests
for a customer, and the queue tables are not readable by the `customer` role at
all (RLS).

#### Identifying the problem (step 2 of the form)

```
appliance chosen  →  ONLY that appliance's issue list loads
                     (no troubleshooting is shown yet)
describe the problem in English / Tagalog / Bisaya / mixed
  → deterministic match against reviewed synonyms (src/lib/issue-matching.ts)
      · one clear match   → "The problem may be: Not cooling. Is this correct?"
      · several matches   → the customer picks from the list (never guessed)
      · no match          → pick from the list, or continue without troubleshooting
  → confirmed / selected  →  that issue's preliminary checks appear INLINE
  → optional outcome: "Yes, it worked" | "No, the problem remains" | "Skip"
```

Rules this flow holds to:

* **Selecting an appliance shows no guidance.** The old side-panel card rendered
  steps as soon as an appliance was picked; guidance now needs an *identified*
  issue — chosen by the customer, or a detected match they confirmed.
* **A detected match is only a suggestion.** Nothing is shown, and nothing is
  stored, until the customer confirms it.
* **The description is never rewritten** and never turned into a diagnosis.
* **Nothing here blocks the request.** An unidentified issue, a skipped guide or
  an unresolved problem all submit normally; the technician diagnoses on site.
* **An outcome is the customer's report**, not a verified repair: it never
  completes a request, a booking or a visit, and the customer can still ask for
  professional service after reporting that it worked.

**The preferred time is a window, not a day.** `readRequestedWindow()`
(`src/lib/service-time.ts`) accepts either explicit
`requested_window_start` / `requested_window_end` ISO timestamps or the wizard's
`preferred_date` + `preferred_start_time` + `preferred_end_time`, converted from
the **service timezone** (`queue_service_timezone`, `Asia/Manila`) to UTC. So
"Jan 24, 09:00–11:00" means 09:00 in the service timezone regardless of where
the browser is.

A date with **no** times is deliberately not expanded to a whole day — treating
"any time on Jan 24" as "all of Jan 24" would make every existing appointment
that day look like a conflict, which is the exact bug this redesign removed.
With no window, only eligibility and the concurrent-workload limit are checked,
and the precise slot is agreed at booking time.

The wizard therefore refuses a half-entered window ("start but no end") rather
than silently discarding it, and it labels the state honestly on both sides: the
technician's offer card reads "Wants Sun, Jan 24 · 09:00 AM – 11:00 AM (PH time)"
or "No time preference stated — agree a slot", and the customer's own request
page echoes back what was recorded. Both use `formatRequestedWindow()` so the
customer, the technician and the queue all read the same clock.

### 2. What they see while waiting

| `assignment_status` | Title shown | Body shown |
| --- | --- | --- |
| `matching` | Checking technician availability | We are looking for a qualified technician who can cover the time you asked for. |
| `offered` | Waiting for a technician to respond | A qualified technician is reviewing your request. If they do not respond in time we pass it to the next one automatically. (+ live "Re-offering in 4m 12s" countdown) |
| `waiting` | Waiting for an eligible technician | Every qualified technician is booked or at capacity for that slot. Your request stays in line — we will match you as soon as someone becomes available, so you can leave this page. |
| `accepted` | Technician accepted your request | Your technician will send an estimate next, and you will pick the final appointment time. |

Copy comes from `customerAssignmentCopy()` in `src/lib/queue.ts`, used by
`AssignmentStatusCard`, the request page and `ServiceTracking`, so the three
surfaces cannot drift apart. The `offered` countdown is driven by
`offers_expires_at` — visible proof that an ignored offer does not strand a
request.

`waiting` is the honest state: eligible technicians exist, but nobody is free
for *that* window. It is not a dead end — the cron sweep re-runs matching for
`waiting` requests, so it resolves itself when a schedule opens up.

### 3. After acceptance

The technician is disclosed only once `assignment_status = 'accepted'`, and only
the published profile fields (name, avatar, bio) — never phone numbers,
addresses or queue data. The existing repair workflow then continues, with one
clarification: **approving an estimate and confirming a booking are two separate
steps.**

| Step | What it means | What it does NOT do |
| --- | --- | --- |
| Estimate submitted | the technician proposed an itemized cost | no appointment, no payment |
| **Estimate approved** | the customer accepted that exact version | does not book, does not pay, does not move the queue |
| Booking confirmed | the customer picked an available slot and the server accepted it | does not re-approve or change the estimate |
| Repair → inspection | the work itself | — |
| Inspection confirmed | the customer attests the appliance works (written note) | opens the payment step; does not complete the repair, does not approve an estimate |
| Payment verified | an administrator confirmed the GCash reference | does not approve an estimate |
| **Completed** | the verified payment closing the repair | the only path to completion |

So: estimate → customer **approves** (or asks for a revision, or declines) →
customer **confirms** a time (schedule conflict and capacity re-checked) → repair
→ `awaiting_inspection` → the **customer confirms the appliance works** (a written
note, which is what the archived history keeps) → `awaiting_payment` → the customer
submits the GCash reference → an **administrator verifies it** → `completed`.

**Confirming a time is one all-or-nothing step.** The customer picks a slot and the
server either takes it completely or not at all — there is no state in between where
an appointment half-exists. What that means in practice:

* the slot is checked against that technician's **working hours, time off, existing
  appointments and capacity** at the moment it is taken, not a moment earlier. Two
  customers clicking the same hour on the same technician cannot both succeed; the
  second is told the time clashes and is offered another;
* an hour is an hour: a job that ends at 12:00 and one that starts at 12:00 do not
  conflict, but a 10:00–12:00 job blocks an 11:00 start;
* **one repair has one live appointment.** Pressing the button twice — a double
  click, or a retry after a slow response — leaves a single booking, and the second
  attempt is told the request already has one rather than quietly creating another;
* the refusal is explained in the queue's own words ("…already has an appointment
  in that window", "…outside the technician's working hours", "…has no capacity left
  for that time"), so the customer knows what to change. A clash is never reported as
  a server error;
* nothing else moves: no queue position, no estimate change, no second charge.

The last step is the only way a repair completes. The customer's confirmation opens
the payment step; it does not close the repair, and neither the customer nor the
technician can mark it complete. Only an administrator's verification does — made on
`/admin/payments`, where each reference shows the repair it belongs to and the row
reports the outcome (*"Payment verified — the repair is now Completed."*). The same
transaction records the service history, closes the request and frees the
technician's slot, and the customer is notified.

If an administrator **rejects** the reference instead, the customer sees the reason on
this page and the payment form re-opens, so the same repair can be paid for again with
a correct reference. A rejection does not cancel the appointment, release the
technician's slot or close the repair — the work is still owed and still at the payment
step — and there is no refund or penalty involved.

A customer may **cancel their own booking while it is still `pending`** (before the
technician starts) — the slot is released and the booking stays in the record. The
request itself returns to "ready to book", so the same repair can be booked again at
another time with the estimate they already approved and the technician who accepted
it: nothing is duplicated, no queue turn is spent, and the technician's "current
load" goes back down by exactly one. Once the repair is under way,
cancellation goes through support or an administrator. There are no cancellation
fees and no automatic penalties.

A revised estimate is a new version: the old one keeps its amounts and its
approval record, and the new total needs its own approval before any additional
chargeable work starts.

Cancelling or rescheduling after acceptance does **not** hand the technician a
fresh queue turn; the turn was consumed at acceptance. Neither does approving,
declining or revising an estimate — a decision touches the estimate row and
nothing else.

### 3a. The service location (map pin) travels with the request

In step 4 of the wizard the customer types their address **and** confirms a point
on an OpenStreetMap map: tap to drop a pin, drag to correct it, or press
"Use my location" for a single, permission-gated device lookup (there is no
continuous tracking, and a denied prompt leaves the address field and the map
fully usable). Only a *confirmed* pin is submitted; a pin that was placed and
left unconfirmed blocks the submit with an explicit message rather than being
silently dropped. The request summary shows both the written address and the
confirmed coordinates, and the customer's own request page re-renders the saved
pin when they reopen it.

The location follows the same disclosure rule as the technician's identity:

| State | What a technician sees |
| --- | --- |
| offered (not yet accepted) | appliance, problem, photos, requested window — **no address, no pin** |
| accepted | the address, the map with the customer's pin, and a "Get directions" button |
| not assigned at all | nothing: the row is not readable through the API, PostgREST or Realtime |

"Get directions" opens Google Maps in a new tab with
`https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=<lat>,<lng>`,
falling back to the URL-encoded written address when no pin was saved. Google
calculates the route; SPARKServ does not, and no Google Maps API key is involved.

---

## Technician

Navigation (`src/lib/navConfig.ts`): Dashboard · Pending Assignments · My Jobs ·
**Queue / Schedule** · Messages · Profile & Availability.

### 1. An offer arrives

Notification (`technician_offer`) → Pending Assignments
(`/technician/estimate-requests`) → `OfferResponseControl` → Accept, or Decline
with an optional reason → `POST /api/service-requests/:id/offer-response` → the
`respond_to_offer()` RPC.

A technician only ever sees requests the queue actually offered them:
`GET /api/service-requests` filters to `assigned_technician_id = me` for the
`technician` role. They cannot claim work that was not offered, and only the
technician an offer is currently addressed to can respond to it.

* **Accept** — the assignment is confirmed and the technician's turn is consumed
  exactly once: they move to the end of *that appliance's* rotation. The request
  row is locked for the transaction, so a second technician cannot also win it.
* **Decline** — the reason is recorded, the request passes to the next eligible
  technician in the same transaction, and (default policy
  `queue_decline_consumes_turn = false`) the decliner keeps their position.
* **Ignore** — nothing happens until the offer expires. The sweep records
  `EXPIRED` and re-offers to the next candidate. An unanswered offer never
  removes anyone from the queue.

### 2. Queue / Schedule (`/technician/queue`)

Tabs: "All my queues", then one per appliance type the technician is
specialised in. Each queue card shows position, technician, status and next
booking:

```
Washing Machine Queue                  Your queue position: #2
#1  Technician A   Available     Jan 30, 9:00 AM
#2  You            Available     Jan 25, 2:00 PM    ← highlighted
#3  Technician C   On Job        Today, 3:00 PM
#4  Technician D   Unavailable   —
```

* **The whole rotation is listed**, not just the signed-in technician — the
  single biggest fix in this redesign.
* The technician's own row is marked `YOU` and highlighted; the header states
  their position.
* Operational status is a schedule fact (`AVAILABLE`, `ON_JOB`, `SCHEDULED`,
  `TEMPORARILY_UNAVAILABLE`, `OFFLINE`, `SUSPENDED`) and never changes anyone's
  position.
* A technician in three appliance queues sees three independent positions, and
  the page says so out loud.
* Next booking is a date/time only — no customer name, address or phone number
  appears in anyone else's row.
* The wording is *"your turn is next when you are eligible and available for a
  matching request"*. It never promises the next job, because being first in
  line does not entitle anyone to work they are not free for.

Data comes from `technician_queue_snapshot(appliance_type)` — one read, executed
server-side in `src/lib/queue.ts`, never assembled in the browser from the
technician's own rows.

### 3. Availability and capacity

The queue's schedule inputs are three real tables: weekly working-hours windows
(`technician_availability` — `weekday`, `start_time`, `end_time`, `is_active`),
time off (`technician_time_off` — `starts_at`, `ends_at`) and service areas
(`technician_service_areas`). Those, plus real rows in `bookings`, are what the
queue evaluates per request. A technician with a Jan 30 appointment is still
offered Jan 24 work — the old behaviour of vanishing until a repair finished is
gone.

The technician edits all three on **Profile & Availability**
(`/technician/profile` → `AvailabilityManager`), which reads and writes
`/api/technician-availability`. That screen states the empty case explicitly,
because a blank schedule reads as "switched off" to a human but means the exact
opposite to the queue:

> No windows set → *"You have none set, so you currently count as available at
> any time."*
> No areas set → *"you currently cover everywhere you are qualified for."*

Getting that backwards is the one mistake this design can make that would
quietly starve a technician of work, so the UI says it rather than leaving it to
be inferred.

Time-off and window times are entered in the **service timezone** and converted
with the same `zonedToUtc()` helper the customer wizard uses, so a technician's
"09:00" and a customer's "09:00" are the same instant. A technician sitting in a
different timezone cannot accidentally declare availability in the wrong one.

Workload limits (`max_daily_hours`, `max_concurrent_jobs`, `max_jobs_per_day`,
all on the `technicians` row) are checked against the *requested window*: a
4-hour gap accepts a 3-hour job and refuses a 6-hour one.

If the availability tables are missing — i.e. `migration_queue_redesign.sql` has
not been applied — the API answers `503` naming the migration instead of a
generic 500, so the symptom points at the cause.

### 4. Completing work

Job completion updates the booking and the repair workflow only. It does **not**
touch the queue: the technician already went to the back when they accepted, so
a completion trigger would rotate them twice.

---

## Admin

### Verifying and rejecting payments (`/admin/payments`)

Each row shows the reference, the amount, the customer and the repair it belongs to,
with two actions while the reference is still `pending_verification`:

* **Confirm** verifies it. That is the only way a repair is completed: one
  transaction closes the booking, archives the service history, closes the request
  and frees the technician's slot, and the customer is notified.
* **Reject** refuses it, and **requires a written reason**. The control is
  deliberately two-step — write the reason, review what the customer will read, then
  confirm — because the reason is customer-facing text, is recorded against the
  administrator's account, and is the only explanation the customer gets. The reason
  is required in the form, by the API and by the database function, so an unexplained
  rejection cannot happen at any layer.

A rejection is not a refund and not a cancellation. It moves the payment row to
`rejected`, records who refused it, when and why — and **nothing else**. The repair
stays exactly where it was (normally at the payment step, still owed), the technician's
load does not change, no service history is written and no request is re-opened. The
customer is notified with the reason and can submit a new reference against the same
repair. A decision is final: once a reference is verified or rejected it cannot be
decided again, and the customer's next reference is a new row.

### Queue monitoring (`/admin/technician-queue`)

* Pick an appliance queue; see the full rotation with position, technician,
  operational status, current job and next booking.
* Filter by status (available / on job / scheduled / unavailable / all).
* **Why was this technician skipped?** — per request, from
  `technician_queue_events`: `SKIPPED_DUE_TO_SCHEDULE`,
  `SKIPPED_DUE_TO_CAPACITY`, `INELIGIBLE`, each with the reason text the SQL
  produced and the timestamps. This is the question the old system could not
  answer.
* Offer activity: who was offered what, when, whether they accepted, declined
  (with reason) or let it expire.
* Queue history: position changes with `old_position` / `new_position`.

### Override

Admins may add, remove, reactivate or reorder a membership through
`POST /api/admin/queue-override`. It is deliberately awkward on purpose:

* a **reason is mandatory** — the RPC refuses without one;
* it records the acting admin's id, the reason and both positions in
  `technician_queue_events` as `ADMIN_OVERRIDE`;
* positions are renumbered 1..N afterwards, so an override cannot leave gaps.

Overrides are for repairs (a technician wrongly suspended, a queue that never
got seeded), not for steering work to favourites: ratings and experience are
never inputs anywhere, and every override is permanently attributable.

### Handling a stuck request

A request in `waiting` means nobody was eligible-and-available for the requested
window. The right fixes are: let the sweep re-match it automatically, edit the
technician's availability, widen a service area, or (rarely) have the customer
change the requested time. Admins do **not** hand-assign a technician from the
queue screen — that bypasses eligibility, capacity and the audit trail.

---

## System (no human in the loop)

Every 5 minutes `vercel.json` calls `/api/cron/assignment-tick`:

1. `expire_stale_offers()` — offers past `offers_expires_at` become `EXPIRED`
   (audited, technician stays in the queue) and the request re-enters matching;
2. `waiting` requests are re-walked, so a cancelled appointment frees someone up
   without anyone touching the request;
3. `refresh_technician_operational_status()` recomputes each technician's
   `operational_status` from real bookings, time off and account state — status
   is derived, never entered by hand.

Membership sync runs from triggers: a technician who is verified and active and
lists an appliance specialisation is added to that appliance's queue
(`JOINED_QUEUE`, at the end); removing the specialisation deactivates that one
membership (`REMOVED`) and renumbers the rest. `SUSPENDED` is a status, not a
deletion — a suspended technician keeps the membership row and is refused at
eligibility time, which is why reinstating them does not restart their position.

---

## Edge cases worth knowing

| Situation | Behaviour |
| --- | --- |
| Technician has a Jan 30 booking, request is for Jan 24 | Offered normally. A booking on another day is not a conflict. |
| Request Jan 25 10:00–12:00, technician booked Jan 25 09:00–11:00 | Skipped **for this request**; reason logged; position unchanged; next candidate tried. |
| Everyone eligible is booked for that window | `waiting`. No offer exists, nothing rotates, and the sweep retries. |
| Technician ignores the offer | `EXPIRED` after `queue_offer_ttl_minutes`, queue re-walked, position unchanged. |
| Technician declines | Reason recorded; next candidate tried; position kept unless `queue_decline_consumes_turn` is turned on. |
| Customer cancels after acceptance | Cancellation audited. The technician stays wherever the accepted turn put them — no fresh turn, no front-of-queue jump. |
| Repair rescheduled Jan 30 → Jan 31 | Schedule updated only; queue untouched. |
| Repair completed | Workflow advanced. Queue untouched (already rotated at acceptance). |
| Technician specialises in three appliances | Three memberships, three independent positions, three rotations. |
| Two technicians answer the same offer at once | Row lock + one-live-offer index: exactly one acceptance; the other is refused. |
| A client tries to write `queue_position` | `EXECUTE` revoked for `authenticated`/`anon` on every mutating function, and direct `UPDATE` is blocked by RLS (writes are admin-only). |


