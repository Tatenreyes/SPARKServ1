import Image from "next/image";

export type HeroStat = { label: string; value: string | number };

/**
 * The greeting band at the top of a dashboard.
 *
 * Gradient use here is deliberate and scoped: this band and `SupportBanner` are
 * the only two surfaces `design-system/sparkserv/MASTER.md` allows it on.
 *
 * `image` is optional and off for the customer workspace on purpose — the
 * appliance files in `/public/images` are category-card screenshots with white
 * boxes and baked-in label text, so building a collage from them would put
 * duplicated labels and stray rectangles behind the greeting.
 */
export default function DashboardHero({
  eyebrow,
  title,
  subtitle,
  stats,
  actions,
  image,
  imageAlt = "",
  priority = false,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  stats?: HeroStat[];
  actions?: React.ReactNode;
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
          {/* Legibility scrim, not decoration: it holds the greeting text at
              4.5:1 contrast over the photograph. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 bg-gradient-to-r from-[#DFEBFF] via-[#DFEBFF]/85 to-transparent"
          />
        </>
      ) : (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-24 -z-10 h-72 w-72 rounded-full bg-white/50 blur-3xl"
        />
      )}

      <div className="relative p-6 sm:p-7">
        <div className="min-w-0 max-w-2xl">
          {eyebrow && <p className="spark-eyebrow text-brand-ink">{eyebrow}</p>}
          <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-ink sm:text-[28px]">
            {title}
          </h1>
          {subtitle && <p className="mt-2 text-sm leading-relaxed text-muted">{subtitle}</p>}

          {stats?.length ? (
            <dl className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-3">
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
              floating over it is a contrast lottery. */}
          {actions && <div className="mt-6 flex flex-wrap items-center gap-3">{actions}</div>}
        </div>
      </div>
    </section>
  );
}
