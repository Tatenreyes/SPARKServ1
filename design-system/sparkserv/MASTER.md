# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** SPARKServ
**Generated:** 2026-08-26 13:28:28
**Category:** Home Services (Plumber/Electrician)

---

## Global Rules

### Color Palette

| Role | Hex | Tailwind Token |
|------|-----|----------------|
| Primary | `#1255C7` | `brand-500` |
| On Primary | `#FFFFFF` | `white` |
| Secondary | `#397BEE` | `brand-400` |
| On Secondary | `#FFFFFF` | `white` |
| Accent/CTA | `#EA580C` | `accent-500` |
| On Accent/CTA | `#FFFFFF` | `white` |
| Background | `#F5F7FB` | `canvas` |
| Foreground | `#10264A` | `ink` |
| Card | `#FFFFFF` | `white` |
| Card Foreground | `#10264A` | `ink` |
| Muted | `#E9EEF6` | `mist` |
| Muted Foreground | `#475569` | `slate-600` |
| Border | `#BFDBFE` | `brand-200` |
| Success | `#1FAE69` | `signal-500` |
| Destructive | `#E24A4A` | `alert-500` |
| On Destructive | `#FFFFFF` | `white` |
| Ring (focus) | `#1255C7` | `brand-500` |

**Color Notes:** Professional blue + urgent orange. The accent is reserved for the
single most important action on a screen — never for decoration or secondary
buttons, or it stops meaning "do this next."

> ⚠️ This table reflects the shipped `tailwind.config.ts`. Earlier revisions of
> this file listed a different palette (`#1E40AF` primary, `#EFF6FF` background)
> that was never implemented — if you're reading an older copy, trust the code.

### Theming (dark mode)

**Rule: no colour literal ever reaches a component.** Every fill, border, ring
and text colour resolves through a CSS variable in `src/app/globals.css`
(`--spark-*`, stored as RGB channel triplets so Tailwind opacity keeps working)
which `tailwind.config.ts` maps in via `colorTokenValues`. Add a token, never a
hex.

| Class family | Light | Dark | Use for |
|---|---|---|---|
| `canvas` | `#F5F7FB` | `#080D1A` | page background |
| `surface` | `#FFFFFF` | `#11192A` | cards, panels, floating plates |
| `elevated` | `#FFFFFF` | `#182338` | popovers, modals, menus |
| `soft` | `#EDF1F5` | `#0F1B2E` | wells, inset strips, icon discs |
| `line` | `#DFE5EC` | `#24334D` | hairlines, dividers, borders |
| `ink` / `muted` | `#10264A` / `#52637C` | `#E2E8F0` / `#94A3B8` | body / secondary copy |
| `brand-soft` / `brand-ink` | `#EEF5FF` / `#0E429F` | `#152B4F` / `#78A9FF` | tinted chips, brand text |
| `signal` / `warn` / `alert` / `accent` `-soft` + `-ink` | 50-shade fill + 600-shade text | dark fill + bright text | status and validation |

Three traps this system creates. All three shipped once:

1. **Fixed dark surfaces.** `brand-900`, `navy-*`, `spark-500` and
   `.spark-navy-gradient` are identical in both themes, so anything floating on
   them must be fixed too: a white CTA on a navy band is
   `bg-white text-navy-900`, never `bg-surface text-brand-ink`, which becomes a
   dark button with light text in night mode. Same for `SupportBanner` and the
   `bg-white/5` / `bg-white/10` scrims over photographs in `AuthShell` — those
   are white-on-dark surfaces by design, not theme tokens.
2. **Over photographs** use an alpha plate (`bg-surface/60` … `bg-surface/95`
   plus `.hero-copy-scrim`). An opaque token hides the image; a translucent
   `bg-brand-500` cannot hold white copy at 4.5:1.
3. **Same hex ≠ same token.** `spark-50`, `brand-50` and `brand-soft` are all
   `#EEF5FF` in light mode, but only `brand-soft` follows the theme. Pick the
   token, not the hex you can see.

**Pre-paint script.** `src/app/layout.tsx` inlines a script as the *first child
of `<body>`* that reads `localStorage["sparkserv-theme"]`, falls back to
`prefers-color-scheme`, then toggles `dark` on `<html>` and sets `colorScheme`.
In `<head>` the App Router hoists and re-parents the tag; in `<body>` it stays
put and runs before the first paint, which is what removes the white flash.
`<html>` therefore carries `suppressHydrationWarning`.

`STORAGE_KEY` and the `Theme` type live in `src/lib/theme.ts`, **not** in
`ThemeProvider`. A Server Component importing a *value* out of a `"use client"`
module receives the client-reference object, so the interpolation renders
`var key = "[object Object]"` and the stored choice is read back from a junk
key — persisted dark mode silently stops working while the browser still looks
correct.

**The toggle** (`ThemeToggle` → `ThemeProvider`) starts as `null` and touches
`document` only inside an effect, so server HTML, the first client render and
the pre-paint script always agree. The cost is that the icon settles one frame
after hydration, which is cheaper than a hydration mismatch or a wrong SSR icon.

### Typography

- **Heading Font:** Space Grotesk (`--font-display`)
- **Body Font:** Plus Jakarta Sans (`--font-body`)
- **Mono Font:** JetBrains Mono (`--font-mono`)
- **Loaded via:** `next/font/google` in `src/app/layout.tsx` — there is no CSS
  `@import`, so new fonts must be added there, not in `globals.css`.

> **Note:** An earlier revision specified **Playfair Display** as the body font.
> That was a generator artifact and is deliberately not used — a serif body face
> hurts readability in the data-dense dashboards this app is mostly made of.

### Spacing Variables

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` / `0.25rem` | Tight gaps |
| `--space-sm` | `8px` / `0.5rem` | Icon gaps, inline spacing |
| `--space-md` | `16px` / `1rem` | Standard padding |
| `--space-lg` | `24px` / `1.5rem` | Section padding |
| `--space-xl` | `32px` / `2rem` | Large gaps |
| `--space-2xl` | `48px` / `3rem` | Section margins |
| `--space-3xl` | `64px` / `4rem` | Hero padding |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle lift |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Cards, buttons |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Modals, dropdowns |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |

---

## Component Specs

### Buttons

```css
/* Primary Button */
.btn-primary {
  background: #EA580C;
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}

.btn-primary:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: #1E40AF;
  border: 2px solid #1E40AF;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}
```

### Cards

```css
.card {
  background: #EFF6FF;
  border-radius: 12px;
  padding: 24px;
  box-shadow: var(--shadow-md);
  transition: all 200ms ease;
  cursor: pointer;
}

.card:hover {
  box-shadow: var(--shadow-lg);
  transform: translateY(-2px);
}
```

### Dashboard shell (shipped)

All four authenticated workspaces (`customer`, `technician`, `admin`,
`super_admin`) render through one composition: `DashboardShell` =
sticky topbar + sidebar + content column.

| Part | Rule |
|------|------|
| Topbar | 64px, sticky, `bg-white/95` + `backdrop-blur`, hairline bottom border. Holds brand, a role pill (dot + label), notifications and the user menu. |
| Sidebar | 240px (`w-64`), navy `#0B1B33`, **identical for every role**. Role identity is a 6px dot in the topbar, never a recoloured shell — four different sidebar colours made the product read as four different products. |
| Active nav row | `bg-brand-500` (`#1255C7`) pill. Colour changes only; geometry never changes, so navigation can't shift layout. |
| Mobile | The sidebar becomes a slide-over drawer (`fixed`, `translate-x`) with a scrim; state lives in `DashboardShell`, not in the route layouts. |
| Content | `max-w-[1400px]` centred, `px-4 → lg:px-8`. |
| Nav config | `src/lib/navConfig.ts`. It is client-side on purpose: items carry lucide *components*, which can't be serialized from a server layout into a client shell. |

**Gradients.** Permitted on three surfaces and nowhere else:
`.spark-hero-gradient` (the dashboard hero band), `.spark-navy-gradient`
(`SupportBanner` and the landing page's final CTA band), and `.hero-copy-scrim` (the landing hero band — a
legibility device, not decoration, because it holds white body copy over the
photograph at 4.5:1).

### Marketing shell (landing page)

| Part | Rule |
|------|------|
| Navbar | Floats on its own white plate (`rounded-2xl` + hairline border + `0 12px 30px -16px` shadow) inside a translucent `bg-white/85 backdrop-blur-md` sticky header — never edge-to-edge. The mobile menu folds into the same card at `lg:hidden`; nav links switch to `lg:flex` so there is no width band with neither. |
| Navbar brand | Mark + `SPARKServ` wordmark with a `tracking-[0.14em]` caps subtitle on one line each. No rounding or shadow on the mark itself: `Logo.PNG` is opaque white, so a shadow paints a grey square halo behind it. |
| Phone | `xl:` only. Below that the card cannot hold wordmark + five links + phone + two buttons without collision. |
| Hero band | Full-bleed photograph (`.hero-copy-scrim` over it), `min-h-[520px]`, copy in a `max-w-2xl` column. The crop anchor is `object-[62%_62%]`, biased right **and down**, because the subject cluster (technician + washing machine + toolbox) sits in the lower-right of the 1788×592 source — `object-center` visibly clips the toolbox from 1920px up. A second flat `bg-navy-900/55 lg:hidden` scrim is layered on because phones crop the photo to portrait and put the copy directly on the technician. |
| Hero CTA | One primary action: `brand-500` pill, not `accent-500`. On this page the hero button and the nav "Sign Up" are the same intent, so the accent stays reserved for in-app state-changing actions. |
| Trust row | Four items in the inverted variant (`bg-white/15` chip, white label, `white/65` sub) so they survive the photograph. |
| Caption card | "Trusted. Reliable. Professional." is `lg:`-only and `pointer-events-none` — it is a caption, not a control, and must not swallow clicks aimed at the hero copy. |
| Sections | Order is Hero → How it works → Supported appliances → Why SPARKServ → final CTA → `Footer`, with backgrounds alternating `white` / `slate-50` so consecutive bands read as separate surfaces. |
| No testimonials | There is deliberately **no** testimonials band. The three quotes, names, and avatars that used to sit there were invented, and pairing fabricated praise with real customer accounts is a credibility risk. Only add it back with quotes collected from real jobs. |
| Appliance tiles | Icon-led (`lucide` appliance glyphs) and every tile is a `Link` to its real `/services/[slug]` page. The only fan / rice-cooker / air-conditioner assets on disk are ~150×90 screenshots of the marketing cards (label baked into the pixels) plus a 2.5 kB AVIF misnamed `aircon.jpg` — cropped into a 48px circle they read as broken images. Links said "+7 more" against six real service pages, so the tile now says "All services". |
| Values band | Capabilities are written as prose cards, never as fake statistics. A figure-shaped slot needs a figure — earlier revisions put "12,540+ customers" and a "4.9/5" rating there, then over-corrected by rendering the words "Fair Queue" and "Verified" in the number position. |
| How-it-works rail | Five steps, `grid-cols-1 sm:grid-cols-3 lg:grid-cols-5`, with a `lg:`-only hairline rail behind them and `ring-8 ring-slate-50` on each circle so the rail passes behind rather than through. Hidden below `lg`, where the steps wrap and a single line would be meaningless. |
| Final CTA | `.spark-navy-gradient`, not flat `brand-900` — the footer directly beneath it is `brand-900`, and two identical dark plates merged into one. |
| Footer | The shared `<Footer />` component, same as every other marketing page. The landing page was the only page missing it. |

> ⚠️ The hero asset is `public/images/Backgound.jpg` — the filename really is
> misspelled on disk. The previous markup pointed at `/images/Background.jpg`,
> which does not exist, so the photo silently 404-ed and the hero rendered as a
> blank column. If you ever "fix" this typo, fix it in `page.tsx` in the same
> commit.

**Status colours.** One component (`StatusBadge`) maps every status string in
the app onto seven tones (`neutral`, `info`, `brand`, `progress`, `warn`,
`success`, `danger`). Add new statuses to `STATUS_TONES` rather than inventing
local badge styles — the technician dashboard used to carry its own badge map
that had drifted out of sync.

**Cards.** `.spark-card` is a neutral hairline (`slate-200`) with a barely-there
shadow. `.spark-card-interactive` is the variant for a card that is itself a
link. Neither translates on hover.

### Inputs

```css
.input {
  padding: 12px 16px;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 200ms ease;
}

.input:focus {
  border-color: #1E40AF;
  outline: none;
  box-shadow: 0 0 0 3px #1E40AF20;
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  background: white;
  border-radius: 16px;
  padding: 32px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

---

## Style Guidelines

**Style:** Flat Design

**Keywords:** 2D, minimalist, bold colors, no shadows, clean lines, simple shapes, typography-focused, modern, icon-heavy

**Best For:** Web apps, mobile apps, cross-platform, startup MVPs, user-friendly, SaaS, dashboards, corporate

**Key Effects:** Simple hover (color/opacity shift), fast loading, clean transitions (150-200ms ease), minimal icons

> ℹ️ The palette was generated as "flat design / no shadows", but the shipped UI
> uses a deliberate soft-shadow system (`shadow-card`, `shadow-soft` in
> `tailwind.config.ts`) for elevation on cards and modals. Shadows are allowed —
> keep them soft and low-opacity. What's still forbidden: hard drop shadows,
> gradients used as decoration, and layout-shifting hover transforms.

### Page Pattern

**Pattern Name:** Trust & Authority + Conversion

- **Conversion Strategy:** Security badges. Case studies. Transparent pricing. Low-friction form. Provide pause/stop and stop the logo carousel on focus, hover, and reduced motion. Previous/next controls provide the keyboard equivalent; pause offscreen/hidden and render a static logo set under reduced motion.
- **CTA Placement:** Contact Sales / Get Quote (primary) + Nav
- **Section Order:** Hero (mission/credibility) > Proof (logos, certs, stats) > Solution overview > Clear CTA path

---

## Anti-Patterns (Do NOT Use)

- ❌ Hidden contact info
- ❌ No certifications

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
