/**
 * Compact relative time for dashboard lists — "Just now", "12m ago", "3h ago".
 *
 * Extracted from the super-admin dashboard page so the formatter is one
 * implementation rather than a private helper each dashboard re-invents.
 *
 * Two behaviours the original lacked:
 *
 *  - **Invalid input is named, not rendered as NaN.** `new Date("garbage")`
 *    yields an invalid date and `Math.floor(NaN)` produced the literal string
 *    "NaNd ago" in the activity list. A missing or unparseable timestamp now
 *    says so.
 *  - **A future timestamp clamps to "Just now".** The database clock and the
 *    server clock are not the same clock, so a row written moments ago can
 *    arrive with a timestamp a few seconds ahead — which used to render as a
 *    negative age.
 *
 * `reference` is injectable so the result is deterministic under test instead of
 * depending on the wall clock at call time.
 */
export function timeAgo(iso: string | null | undefined, reference: Date = new Date()): string {
  if (!iso) return "Unknown";

  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "Unknown";

  const diffMs = reference.getTime() - then.getTime();

  // Covers both the sub-minute case and any clock skew producing a future time.
  if (diffMs < 60_000) return "Just now";

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  return `${Math.floor(days / 365)}y ago`;
}
