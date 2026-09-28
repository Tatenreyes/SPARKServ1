/**
 * Shared skeleton for the server-rendered dashboards. Each role's
 * `loading.tsx` renders this so navigating between dashboard routes shows
 * structure instead of a blank flash — see
 * `design-system/sparkserv/pages/dashboard.md` ("use skeleton screens").
 *
 * The geometry mirrors the real dashboard (greeting band, stat row, then the
 * asymmetric two-column body) so the swap to live content doesn't reflow.
 */
export default function DashboardSkeleton({
  cards = 4,
  panels = 2,
  hero = true,
}: {
  cards?: number;
  panels?: number;
  /** The four dashboards all open with a hero band; only turn this off for a
   *  view that doesn't have one. */
  hero?: boolean;
}) {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading dashboard">
      {hero && (
        <div className="rounded-card border border-line bg-mist p-6 sm:p-7">
          <div className="h-3 w-32 animate-pulse rounded bg-brand-soft/70" />
          <div className="mt-3 h-7 w-64 animate-pulse rounded-lg bg-brand-soft/70" />
          <div className="mt-3 h-4 w-full max-w-md animate-pulse rounded bg-surface/70" />
          <div className="mt-5 flex gap-8">
            <div className="space-y-1.5">
              <div className="h-5 w-12 animate-pulse rounded bg-brand-soft/70" />
              <div className="h-2.5 w-20 animate-pulse rounded bg-surface/70" />
            </div>
            <div className="space-y-1.5">
              <div className="h-5 w-12 animate-pulse rounded bg-brand-soft/70" />
              <div className="h-2.5 w-24 animate-pulse rounded bg-surface/70" />
            </div>
            <div className="space-y-1.5">
              <div className="h-5 w-12 animate-pulse rounded bg-brand-soft/70" />
              <div className="h-2.5 w-16 animate-pulse rounded bg-surface/70" />
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: cards }).map((_, index) => (
          <div key={index} className="rounded-card border border-line bg-surface p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="h-2.5 w-24 animate-pulse rounded bg-soft" />
                <div className="h-7 w-14 animate-pulse rounded bg-line" />
              </div>
              <div className="h-11 w-11 animate-pulse rounded-xl bg-soft" />
            </div>
            <div className="mt-4 h-3 w-20 animate-pulse rounded bg-soft" />
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        {Array.from({ length: panels }).map((_, index) => (
          <div key={index} className="rounded-card border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div className="h-4 w-40 animate-pulse rounded bg-line" />
              <div className="h-3 w-16 animate-pulse rounded bg-soft" />
            </div>
            <div className="space-y-3 px-5 py-5">
              {Array.from({ length: 4 }).map((__, row) => (
                <div key={row} className="h-10 w-full animate-pulse rounded-xl bg-soft" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
