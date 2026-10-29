import Image from "next/image";

export type HeroStat = { label: string; value: string | number };


export default function DashboardHero({
  eyebrow,
  title,
  subtitle,
  stats,
  actions,
  illustration,
  image,
  imageAlt = "",
  priority = false,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  stats?: HeroStat[];
  actions?: React.ReactNode;
  illustration?: React.ReactNode;
  image?: string;
  imageAlt?: string;
  priority?: boolean;
}) {
  return (
    <section className="spark-hero-gradient relative isolate overflow-hidden rounded-card border border-line">
      {image ? (
        <>
          <Image
            src={image}
            alt={imageAlt}
            fill
            priority={priority}
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="hero-art -z-10 object-cover object-right"
          />
          {/* Legibility scrim, not decoration: it holds the greeting text at 4.5:1
              contrast over the photograph.

              It MUST be built from tokens. This used to be a fixed
              `from-[#DFEBFF]` pale-blue wash while the copy itself used
              `text-ink` / `text-muted`; those invert with the theme, so in dark
              mode the band went near-black, the copy went near-white, and the
              fixed pale plate left light text on a light background — the whole
              greeting, subtitle and stat row disappeared. The photo is
              arbitrary, so the plate has to be the thing that adapts. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 bg-gradient-to-r from-surface via-surface/95 to-transparent"
          />
        </>
      ) : (
        // Decorative glow on the photo-less band. `dark:` on purpose: a 45% white
        // blob that reads as a soft highlight on the pale light band is a
        // blown-out blob on the navy dark one, so the dark value is 5%.
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-24 -z-10 h-72 w-72 rounded-full bg-white/45 blur-3xl dark:bg-white/[0.05]"
        />
      )}

      {illustration && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-3 z-0 hidden w-64 items-end justify-center lg:flex xl:right-8"
        >
          {illustration}
        </div>
      )}

      <div className="relative z-10 p-5 sm:p-7">
        <div className={`min-w-0 ${illustration ? "max-w-2xl lg:max-w-[65%]" : "max-w-2xl"}`}>
          {eyebrow && <p className="spark-eyebrow text-brand-ink">{eyebrow}</p>}
          <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-ink sm:text-[28px]">
            {title}
          </h1>
          {subtitle && <p className="mt-2 text-sm leading-relaxed text-muted">{subtitle}</p>}

          {/* The stat list is desktop-only. On a phone the same figures are
              rendered immediately below the hero as a 2x2 tile grid, and printing
              them twice costs most of a screenful before the first thing the
              person can act on appears. From `sm` up the hero is wide enough that
              the inline numbers are context rather than repetition. */}
          {stats?.length ? (
            <dl className="mt-5 hidden flex-wrap items-center gap-x-8 gap-y-3 sm:flex">
              {stats.map((stat) => (
                <div key={stat.label}>
                  <dd className="font-display text-lg font-bold leading-tight text-ink">
                    {stat.value}
                  </dd>
                  <dt className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                    {stat.label}
                  </dt>
                </div>
              ))}
            </dl>
          ) : null}

          {/* Actions sit under the copy rather than in a right-hand column: the
              technician hero carries a photograph on the right, and a CTA
              floating over it is a contrast lottery.

              On a phone they stack full width — a hero is the first thing on the
              page, so its buttons are the primary entry point, and two buttons
              sharing a 360px line leaves each one too narrow to label properly.
              At `sm` they return to the inline row. */}
          {actions && (
            <div className="mt-5 flex flex-col gap-2.5 sm:mt-6 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3 [&>*]:w-full sm:[&>*]:w-auto">
              {actions}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
