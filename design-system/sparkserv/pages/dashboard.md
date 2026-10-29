# Dashboard Page Overrides

> **PROJECT:** SPARKServ
> **Generated:** 2026-08-26 13:28:28
> **Page Type:** Dashboard / Data View

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## Page-Specific Rules

### Layout Overrides

- **Max Width:** 1400px or full-width
- **Grid:** 12-column grid for data flexibility

### Spacing Overrides

- **Content Density:** High — optimize for information display

### Typography Overrides

- No overrides — use Master typography

### Color Overrides

- No overrides — use Master colors

### Component Overrides

- Avoid: Leave UI frozen with no feedback
- Avoid: Make dragging the only way to reorder resize or select

---

## Page-Specific Components

The dashboard family is built from these shared pieces — reuse them rather than
composing one-off panels:

| Component | Role |
|-----------|------|
| `DashboardShell` | Sticky topbar + collapsible sidebar + `max-w-[1800px]` content column. Route layouts only pass a `role`. Owns the desktop rail's collapsed state (persisted) and the mobile drawer. |
| `DashboardTopbar` | Brand, role pill, notification bell, user menu, desktop sidebar-collapse toggle. |
| `PlatformAnnouncementTicker` | The platform-wide announcement, scrolled right-to-left in a 32px strip inside the topbar. Fed by `usePlatformAnnouncement` (`GET /api/settings`), dismissible for the session, and absent entirely when `platform_announcement` is blank. |
| `Sidebar` | Navy rail; icons, badges, collapsible groups, icon-only collapsed state with tooltips, mobile drawer. |
| `DashboardHero` | Greeting band: eyebrow, title, subtitle, stat row, actions. Optional right-side photograph. |
| `DashboardStatCard` / `DashboardPanel` | The only card primitives. `DashboardPanel` owns the header (icon, eyebrow, title, description, action) and takes `bodyClassName` for the body. |
| `ServiceTracking` | Per-request progress strip, derived from real rows (see below). |
| `ScheduleTimeline` | Time-rail of a technician's day; first item is emphasised as "next up". |
| `QueueCard` | Rotation queue with the signed-in technician's row highlighted. |
| `SupportBanner` | Filled navy support/help band. |
| `NotificationsPanel`, `RecentRepairTable`, `QuickActions` | Right/left column content. |
| `StatusBadge` | The single status vocabulary. |
| `DashboardSkeleton` | `loading.tsx` skeleton mirroring the dashboard geometry. |

### Data honesty rules

- **Partial timestamps are the correct output.** `ServiceTracking` shows a
  timestamp only for steps the schema can actually date
  (`created_at`, `estimates.created_at`, `bookings.scheduled_at`,
  `bookings.updated_at`). Steps without a real time show none. Do **not** fill
  these in with an approximation: customers read this strip to judge how long
  they've been waiting, so a plausible-looking invented time is worse than a
  blank. Exact per-step times need a `service_request_status_history` table,
  written on every status change.
- **Queue ETAs are labelled estimates.** `QueueCard` converts queue position to
  a wait using `AVERAGE_JOB_MINUTES` (15) because no per-job duration is stored,
  and says so in the UI.
- **Approximation vs. truth is visible in the copy**, not hidden in a tooltip.

### Responsive notes

- The 7-step horizontal tracking rail only renders from `md` up; a vertical rail
  replaces it on phones where seven labels can't fit legibly.
- The topbar is 64px, or 96px while a platform announcement is showing. Anything
  with a sticky offset below it — the sidebar rail, the request wizard's summary
  rail — is written against both heights rather than against 64px alone.
- `DashboardPanel` headers wrap, so a panel action never squeezes the title.
- Tables scroll inside their panel (`overflow-x-auto`) and never widen the page;
  the content column carries `min-w-0` for this reason.
- Designed against 375 / 768 / 1024 / 1440. The two places worth re-checking by
  eye when you change them: the horizontal→vertical tracking switch at `md`, and
  the sidebar drawer (scrim + no body scroll while open).

---

## Recommendations

- Effects: Hover tooltips, chart zoom on click, row highlighting on hover, smooth filter animations, data loading spinners
- Animation: Use skeleton screens or spinners
- Accessibility: Add buttons menus or tap-to-move controls and retain keyboard operation
