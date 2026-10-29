# SPARKServ

A web-based appliance repair management system connecting **customers**,
**technicians**, **admins**, and a **super admin** on one platform — with a
rule-based troubleshooting chatbot and a fair, rotation-based technician queue
that assigns work without ranking anyone.

Built with **Next.js 14 (App Router, TypeScript)**, **Supabase**
(Postgres + Auth + Realtime), and **Tailwind CSS**. Deploy-ready for **Vercel**.

---

## 1. Project structure

```
sparkserv/
├── src/
│   ├── app/
│   │   ├── (auth)/login, register        # public auth pages
│   │   ├── (auth)/forgot-password,
│   │   │   update-password               # password recovery (see section 3)
│   │   ├── auth/callback                 # recovery link → server-side session
│   │   ├── customer/                     # customer dashboard, requests, bookings
│   │   ├── technician/                   # technician dashboard, jobs
│   │   ├── admin/                        # technician approval, overview
│   │   ├── superadmin/                   # full role management
│   │   ├── api/                          # all backend route handlers
│   │   ├── layout.tsx / page.tsx         # root layout + landing page
│   │   └── globals.css
│   ├── components/                       # reusable UI (forms, cards, chat, etc.)
│   ├── lib/
│   │   ├── supabase/ (client.ts, server.ts, middleware.ts)
│   │   ├── queue.ts / assignment.ts / service-time.ts   # queue reads, RPC wrappers, time windows
│   │   ├── chatbot-rules.ts              # rule-based troubleshooting
│   │   └── auth.ts                       # server-side role guards
│   ├── hooks/                            # useUser, useRealtimeMessages
│   ├── types/                            # database + shared app types
│   └── middleware.ts                     # role-based route protection
├── supabase/
│   └── schema.sql                        # full DB schema + RLS policies
├── .env.example
└── package.json
```

---

## 2. Local setup

### Prerequisites
- Node.js 18.18+ (20 LTS recommended)
- A free [Supabase](https://supabase.com) account
- Git + a GitHub account

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Copy the env template and fill in your Supabase keys (see section 3)
cp .env.example .env.local

# 3. Run the dev server
npm run dev
```

Visit `http://localhost:3000`.

---

## 3. Supabase setup

1. Go to [supabase.com](https://supabase.com) → **New project**. Pick a name,
   password, and region (Singapore is closest for PH-based projects).
2. Once the project is provisioned, open **SQL Editor → New query**, paste
   the entire contents of `supabase/schema.sql`, and click **Run**. This
   creates every table, enum, index, the `handle_new_user` signup trigger,
   and all Row Level Security policies in one go.
3. Go to **Project Settings → API** and copy:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (keep this secret —
     never prefix it with `NEXT_PUBLIC_`, never commit it)
4. Paste these into `.env.local`.
5. (Optional but recommended) Under **Authentication → Providers → Email**,
   turn off "Confirm email" while developing locally so you can log in
   immediately after signing up. Turn it back on before going live.
6. **Realtime** is enabled by default for the `messages` table via the
   schema above — no extra step needed for the in-app chat to work live.

### Password reset (forgot password)

`/forgot-password` → `/auth/callback` → `/update-password`. The request form calls
`supabase.auth.resetPasswordForEmail(email, { redirectTo })`; the emailed link comes
back to `/auth/callback`, which performs the PKCE exchange on the server, writes the
session, and only then redirects to the password form. No password is ever handled by
the app's own code or database — `auth.users` stays owned by Supabase Auth, and the
update is `supabase.auth.updateUser({ password })` against the session that the link
created.

**Dashboard changes this feature needs.** None of them are applied by the code, so
check them before testing:

| Where | What | Value |
| --- | --- | --- |
| Authentication → URL Configuration → **Site URL** | canonical app URL | `https://<your-domain>` |
| Authentication → URL Configuration → **Redirect URLs** | every origin a reset can be requested from, each ending in `/auth/callback` | `http://localhost:3000/auth/callback`, `https://<your-domain>/auth/callback`, plus `https://*-<team>.vercel.app/auth/callback` if preview deployments are used |
| Authentication → Emails → **Reset Password** | the template | default `{{ .ConfirmationURL }}` — see below |
| Authentication → Providers → **Email** | must stay enabled (registration already uses it) | enabled |
| Authentication → Providers → Email → **Password requirements** | keep in step with `MIN_PASSWORD_LENGTH` | minimum 6 |

Why the allow-list matters: Supabase refuses a `redirect_to` that is not listed and
falls back to the **Site URL**, so an unlisted origin turns the emailed link into a dead
end. The app builds the redirect from `window.location.origin`, so each origin needs
exactly one entry — the `/auth/callback` URL — and nothing else.

The reset email can be configured two ways, and `/auth/callback` handles both:

1. **Default template** (`{{ .ConfirmationURL }}`) — Supabase verifies the token on its
   own domain and redirects to `/auth/callback?code=…`; the route exchanges that code
   for a session (`exchangeCodeForSession`). Nothing to change.
2. **Template linking straight at the app** — point the link at
   `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/update-password`
   and the route verifies it with `verifyOtp({ type: "recovery", token_hash })`. Only
   `type=recovery` is accepted, so a signup or email-change token can never be spent on
   a password reset.

Two operational notes:

* **Email rate limits.** The built-in Supabase sender is heavily throttled (a few
  messages per hour, project-wide) and answers `429`. The form reports that as
  "Too many reset emails have been requested recently" instead of a generic failure.
  Configure **Project Settings → Auth → SMTP** before relying on this in production.
* **No migration.** There is no schema change, no profile column and no RPC: the
  recovery flow only uses Supabase Auth endpoints.

Recovery authorization is bound to the session the link created, not to "anybody
logged in". `/auth/callback` mints an httpOnly `sparkserv-recovery` cookie whose
value is a signed payload naming the recovery **user id** and the **session id**
of that exchange (`src/lib/auth/recovery-marker.ts`, signed with a key derived
from `SUPABASE_SERVICE_ROLE_KEY` — already required server-side; if it is absent
the callback issues no marker and the flow refuses rather than falling back to an
unsigned cookie). `/update-password` renders the form only when that marker
matches the user the auth server reports *and* the session id of the session it
just validated, and only until the payload's 15-minute expiry.

The consequences are the point of the design:

* signing out and signing back in normally gets a new session id, so the marker
  stops matching even while the cookie is still in the jar;
* a different account signing in in the same browser matches neither the user id
  nor the session id;
* a visitor who merely knows the `/update-password` URL holds nothing, because
  the marker cannot be minted without the server's signing key;
* after a successful change the form `DELETE`s the marker
  (`/api/auth/recovery`) and ends the recovery session, so the authorization is
  both cleared and already unusable.

Anything else — no marker, no session, an expired payload, a forged, unsigned,
truncated or tampered value — shows the "This link can't be used" panel instead.

Two notes for operators: the marker is signed with a key derived from
`SUPABASE_SERVICE_ROLE_KEY`, so if that variable is missing from the deployment
every recovery link ends on "This link can't be used" rather than being accepted
without a signature; and the binding uses the `session_id` claim of the access
token Supabase issues, which every current project includes (if a project ever
stopped issuing it, recovery would fail closed the same way — the manual pass in
`TESTING.md` §4 catches it immediately).

### Upgrading an existing database

`supabase/schema.sql` is the canonical single-file install — a fresh project
only ever needs that one file. If your database was created from an *earlier*
`schema.sql`, apply the migration files instead, **in this order**:

```
1. migration_fix_technician_signup.sql
2. migration_appliances_tickets.sql
3. migration_visits_payments.sql
4. migration_system_settings.sql
5. migration_profile_photos.sql
6. migration_profile_name_address.sql
7. migration_security_hardening.sql
8. migration_notifications.sql
9. migration_technician_queue.sql
10. migration_appliance_centric_flow.sql   # guarded — skips if already applied
11. migration_sync_live_schema.sql         # appliance-centric columns; MUST precede 13
12. migration_flow_hardening.sql           # offer expiry, integrity indexes
13. migration_queue_redesign.sql           # queue model v2 — REQUIRES 11 and 12
```

Every file is written to be safe to re-run. Two ordering constraints are real,
not stylistic:

* **11 → 12 → 13.** `migration_queue_redesign.sql` opens with a preflight block
  that inspects `information_schema` and raises an explicit exception naming the
  prerequisites if `service_requests.problem_description` or
  `service_requests.offers_expires_at` are missing. It refuses to half-apply
  rather than failing partway with a confusing `42703`.
* **13 last.** It is the one that reinterprets queue behaviour; running it
  against an unprepared schema gets the exception above.

**Then check what the database actually has — don't infer it:**

```bash
npm run db:check     # read-only; reports every migration as applied or pending
```

This is worth running before anything else when the app misbehaves. A missing
column reaches the browser as a blanket HTTP 500 with the real Postgres error
only in the server log, so "500 on the request form" and "forgot migration 11"
look identical from the outside. `db:check` prints the difference, and exits
non-zero when anything is pending. It detects functions from PostgREST's OpenAPI
document rather than calling them, because probing `expire_stale_offers()` by
invocation would lapse real offers.

After applying migrations, **reload the Postgres schema cache** in the dashboard
(Settings → API → Reload schema) so PostgREST exposes the new columns and RPCs.

> ⚠️ Do **not** re-run `migration_appliance_centric_flow.sql` on a current
> database. It is guarded now, but its job was to rebuild `service_requests`
> on an older schema — a full re-run on current data is both unnecessary and
> destructive.

Also set `CRON_SECRET` in your environment (see `.env.example`). Without it,
`/api/cron/assignment-tick` refuses to run in production, and ignored job
offers will never lapse.

### Creating your first admin / super admin
There's no UI for this by design (nobody should be able to self-promote).
After registering a normal account through `/register`, open **Table Editor
→ users** in the Supabase dashboard and manually change that row's `role`
to `admin` or `super_admin`. From then on, that user can manage roles for
everyone else from `/superadmin/dashboard`.

### Seeding a technician for testing
Register an account choosing "Technician" — this creates a row in both
`users` and `technicians` automatically via the signup trigger. It starts
`approved = false`, so log in as an admin, visit `/admin/technicians`, and
approve it. Then give them a **service area** and at least one
**specialisation** — membership in a queue comes from
`technicians.specializations`, so a technician whose array does not contain the
request's appliance type is never in that queue and will never be offered that
kind of job. Add working-hours rows in `technician_availability` if you want
them offerable for requests that carry a time window.

---

## 4. The assignment engine

Every technician who is verified, active and specialised in an appliance type
belongs to **one rotation queue per appliance type**. Position is a stored
membership position that advances only when a technician **accepts** work: they
go to the end of that appliance's queue, and everyone else moves up one.
Customers **never browse, rank or pick a technician** — the system works down the
rotation and offers the job to the first member who is actually eligible and
free for the requested time.

The queue is membership and order (fairness). A technician's schedule and
workload are a separate per-request decision (availability), evaluated at match
time — and because the preferred time is a real window, a technician with a
booking on Jan 30 is still offered Jan 24 work instead of disappearing until the
first repair finishes.

Assignment therefore never weights by rating, experience or distance — a
technician with zero reviews gets the same shot as a five-star veteran, in turn.

All of it runs inside Postgres (`SECURITY DEFINER` RPCs), so two technicians
answering the same offer cannot both win:

| RPC | What it does |
|---|---|
| `technician_queue_snapshot(appliance_type)` | the rotation + operational status + next bookings — the only queue read |
| `assign_technician_to_request(id)` | walks the queue in position order, creates one offer, logs every skip and why |
| `respond_to_offer(id, accept, reason)` | accept rotates exactly once; decline passes to the next candidate |
| `expire_stale_offers()` | lapses ignored offers and re-walks the queue |
| `admin_queue_override(...)` | reason-required, audited admin corrections |
| `refresh_technician_operational_status()` | derives status from real bookings |

Client code cannot write queue positions: `EXECUTE` is revoked for
`authenticated`/`anon` on every mutating function, and RLS blocks direct writes.

Tunables live in `system_settings` (no redeploys), editable through
`GET|PATCH /api/settings` by an admin or super admin:

| Key | Default | Meaning |
|---|---|---|
| `queue_offer_ttl_minutes` | `15` | How long a technician has to answer before the offer lapses and the queue moves on |
| `queue_decline_consumes_turn` | `false` | Whether declining costs queue position. Off — the rotation rewards work taken, not offers declined |
| `queue_service_timezone` | `Asia/Manila` | How a preferred date/time is turned into a UTC window |
| `queue_model_version` | `2.0` | Marker so a half-migrated database is recognisable |

Capacity is not a global switch: each technician row carries
`max_daily_hours`, `max_concurrent_jobs` (default 2) and `max_jobs_per_day`, and
those are what the per-request capacity check reads.

**Offer expiry is what keeps requests from stalling.** An ignored offer would
otherwise sit in `offered` forever with the customer waiting and nobody else
ever getting a shot at the job. `/api/cron/assignment-tick`, scheduled every
5 minutes via `vercel.json` and protected by `CRON_SECRET`, runs
`expire_stale_offers()`, re-walks `waiting` requests and refreshes operational
status. It is also invoked right after a technician accepts or declines, so the
common path does not wait for the next tick.

---

## 5. Deployment (Vercel)

1. Push this project to GitHub (see section 6 below).
2. Go to [vercel.com](https://vercel.com) → **Add New → Project** → import
   the GitHub repo.
3. Vercel auto-detects Next.js — leave the build settings as default.
4. Under **Environment Variables**, add the same three keys from
   `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Click **Deploy**. Vercel will give you a `*.vercel.app` URL.
6. Back in Supabase, go to **Authentication → URL Configuration** and add
   your Vercel URL to **Site URL** and **Redirect URLs** so auth emails
   and redirects work in production.

---

## 6. Pushing to GitHub

```bash
git init
git add .
git commit -m "Initial SPARKServ scaffold"
git branch -M main
git remote add origin https://github.com/<your-username>/sparkserv.git
git push -u origin main
```

`.env.local` is already excluded via `.gitignore` — double check it never
gets committed, since it holds your Supabase keys.

---

## 7. What's implemented vs. simplified

This is a realistic but capstone-scoped build. Implemented end-to-end:
auth + role routing, password recovery (forgot password — see section 3), service
request submission, rule-based chatbot, technician scoring/ranking, estimates,
booking, status tracking (Pending → In Progress → Completed), realtime
messaging, admin technician approval, and super-admin role management.

Deliberately simplified / left as extension points:
- **Payments**: no payment gateway is wired in. If you add one, keep in
  mind that only the **customer** should ever submit a payment
  reference/proof — never the technician — since the customer carries the
  burden of proof for a paid transaction.
- **Image uploads** (e.g. appliance photos, proof-of-repair) aren't
  included — Supabase Storage would be the natural place to add this.
- **Notifications** (email/SMS/push) aren't wired in — Supabase has
  built-in email triggers you could extend, or a service like Resend. The
  password-reset email in §3 is Supabase Auth's own sender, not a
  notification pipeline.
- **Ratings** have a table + RLS policy ready in the schema, but no UI form
  yet — a natural next page to add on the customer booking-detail view
  once a booking's status is `completed`.
