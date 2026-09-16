# SPARKServ

A web-based appliance repair management system connecting **customers**,
**technicians**, **admins**, and a **super admin** on one platform — with a
rule-based troubleshooting chatbot and a configurable technician
recommendation engine.

Built with **Next.js 14 (App Router, TypeScript)**, **Supabase**
(Postgres + Auth + Realtime), and **Tailwind CSS**. Deploy-ready for **Vercel**.

---

## 1. Project structure

```
sparkserv/
├── src/
│   ├── app/
│   │   ├── (auth)/login, register        # public auth pages
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
│   │   ├── recommendation.ts             # scoring engine — see section 4
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
approve it. You'll likely also want to set `latitude`/`longitude` on that
technician's `users` row and some `specializations` on their `technicians`
row directly in the Table Editor so the recommendation engine has real
distance and specialization data to score against.

---

## 4. The recommendation engine

Lives in `src/lib/recommendation.ts`. The formula:

```
Score = (Weight_rating × rating)
      + (Weight_experience × min(experience, cap))
      + (Weight_availability × isAvailable)
      + (Weight_distance × (1 / distance_km))
      + NewTechBoost (flat, if is_new)
      + StarvationBoost (scales down as active_job_load rises)
```

All weights are named constants in `RECOMMENDATION_WEIGHTS` at the top of
that file — change the numbers, not the logic, to retune matching. It's
called from `POST /api/recommend`, which pulls every **approved**
technician, filters to specialization matches when available (falling back
to the full pool if nobody matches exactly), scores each one, and returns
them sorted best-first with a full score breakdown for transparency.

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
auth + role routing, service request submission, rule-based chatbot,
technician scoring/ranking, estimates, booking, status tracking
(Pending → In Progress → Completed), realtime messaging, admin technician
approval, and super-admin role management.

Deliberately simplified / left as extension points:
- **Payments**: no payment gateway is wired in. If you add one, keep in
  mind that only the **customer** should ever submit a payment
  reference/proof — never the technician — since the customer carries the
  burden of proof for a paid transaction.
- **Image uploads** (e.g. appliance photos, proof-of-repair) aren't
  included — Supabase Storage would be the natural place to add this.
- **Notifications** (email/SMS/push) aren't wired in — Supabase has
  built-in email triggers you could extend, or a service like Resend.
- **Ratings** have a table + RLS policy ready in the schema, but no UI form
  yet — a natural next page to add on the customer booking-detail view
  once a booking's status is `completed`.
