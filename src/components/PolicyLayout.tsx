import Footer from "@/components/Footer";

export interface PolicySection {
  title: string;
  body: string;
}

/**
 * Shared shell for every `/policies/*` page.
 *
 * The policy routes were the only marketing-adjacent pages that rendered
 * without the site `Footer` and without any page chrome — they dropped the
 * reader straight onto a bare column of paragraphs with no way back into the
 * product. They now share one layout so a new policy page cannot drift from the
 * others, and the two links in the footer point at real pages instead of both
 * pointing at the customer policy.
 */
export default function PolicyLayout({
  eyebrow,
  title,
  intro,
  updated,
  sections,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  updated: string;
  sections: PolicySection[];
}) {
  return (
    <div className="bg-canvas">
      <header className="border-b border-line bg-soft">
        <div className="spark-section py-12 md:py-16">
          <p className="spark-eyebrow text-brand-ink">{eyebrow}</p>
          <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            {title}
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-muted">{intro}</p>
          <p className="mt-4 text-xs font-medium text-muted">Last updated {updated}</p>
        </div>
      </header>

      <div className="spark-section py-12 md:py-16">
        <div className="mx-auto max-w-3xl">
          <ol className="space-y-4">
            {sections.map((section, index) => (
              <li key={section.title} className="spark-card p-6">
                <div className="flex items-start gap-4">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand-ink ring-1 ring-line">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <h2 className="font-display text-base font-semibold text-ink">{section.title}</h2>
                    <p className="mt-2 text-sm leading-7 text-muted">{section.body}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <Footer />
    </div>
  );
}
