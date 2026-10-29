export interface DailyBucket {
  /** Local calendar date as `YYYY-MM-DD` — the bucket key. */
  date: string;
  /** Short axis label, e.g. "12 Sep". */
  label: string;
  count: number;
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Buckets timestamps into one count per calendar day, oldest first, ending with
 * today.
 *
 * This exists because the super-admin dashboard's trend chart was a hardcoded
 * `values={[30, 44, 39, 56, 48, 63, 72]}` with invented "May 1 … May 28" axis
 * labels — a fabricated chart, placed on the one screen an administrator reads
 * as platform metrics, that no deployment could ever make true. It directly
 * contradicted the rule `design-system/sparkserv/pages/dashboard.md` sets out
 * ("approximation vs. truth is visible in the copy, not hidden in a tooltip").
 *
 * Buckets are built from the *local* calendar so "today" matches what the
 * dashboard's own timestamps say, and every day in the range is emitted even
 * when its count is zero — a gap in the series has to read as "no requests",
 * not as a missing data point.
 *
 * Timestamps that fall outside the range are ignored rather than clamped, so a
 * caller passing a wide fetch does not get its oldest rows folded into day one.
 */
export function bucketDailyCounts(
  timestamps: (string | null | undefined)[],
  days: number,
  now: Date = new Date()
): DailyBucket[] {
  const range = Math.max(1, Math.floor(days));
  const counts = new Map<string, number>();
  const ordered: { key: string; label: string }[] = [];

  for (let offset = range - 1; offset >= 0; offset -= 1) {
    // Constructed from year/month/day parts so the day arithmetic crosses month
    // and year boundaries correctly instead of drifting by a fixed millisecond
    // count (which breaks across DST transitions).
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    const key = localDateKey(day);
    counts.set(key, 0);
    ordered.push({
      key,
      label: day.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    });
  }

  for (const timestamp of timestamps) {
    if (!timestamp) continue;
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) continue;
    const key = localDateKey(parsed);
    if (!counts.has(key)) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return ordered.map((bucket) => ({
    date: bucket.key,
    label: bucket.label,
    count: counts.get(bucket.key) ?? 0,
  }));
}

/**
 * Picks evenly-spaced axis labels from a bucket series so the axis always has the
 * same number of captions as the chart has visual anchors, regardless of how
 * many days were requested.
 */
export function axisLabels(buckets: DailyBucket[], desired = 4): string[] {
  if (buckets.length === 0) return [];
  if (buckets.length <= desired) return buckets.map((bucket) => bucket.label);

  const step = (buckets.length - 1) / (desired - 1);
  return Array.from({ length: desired }, (_, index) => buckets[Math.round(index * step)].label);
}
