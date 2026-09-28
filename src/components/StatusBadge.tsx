/**
 * Status vocabulary for every entity in the app, mapped onto a small set of
 * tones so the same state can never be two different colours on two screens.
 *
 * `scheduled` was missing here entirely: `ServiceTracking` promotes a request to
 * "Scheduled" once a booking exists, but the badge for that state fell through
 * to anonymous grey. Placeholder/assignment states were missing too.
 */
type Tone = "neutral" | "brand" | "info" | "progress" | "warn" | "success" | "danger";

const TONE_STYLES: Record<Tone, { chip: string; dot: string }> = {
  neutral: { chip: "bg-soft text-muted border border-line", dot: "bg-muted/60" },
  info: { chip: "bg-brand-soft text-brand-ink border border-line", dot: "bg-brand-400" },
  // `bg-brand-ink` is the same #0E429F as `brand-600` in light mode and lifts to
  // brand-300 in dark, where a #0E429F dot disappears into the dark chip.
  brand: { chip: "bg-brand-soft text-brand-ink border border-line", dot: "bg-brand-ink" },
  // `spark-50`/`spark-300` are the same hex values as brand-50/brand-300, but they
  // are fixed — a fixed near-white chip stays a glaring white pill on a dark
  // canvas. Same pixels in light mode, theme-aware in dark.
  progress: { chip: "bg-brand-soft text-brand-ink border border-brand-300", dot: "bg-brand-400" },
  warn: { chip: "bg-warn-soft text-warn-ink border border-line", dot: "bg-amber-500" },
  success: { chip: "bg-signal-soft text-signal-ink border border-line", dot: "bg-signal-500" },
  danger: { chip: "bg-alert-soft text-alert-ink border border-line", dot: "bg-alert-500" },
};

const STATUS_TONES: Record<string, Tone> = {
  // service_requests.status
  open: "info",
  quoted: "warn",
  booked: "brand",
  in_progress: "progress",
  completed: "success",
  cancelled: "danger",
  // bookings.status
  scheduled: "brand",
  pending: "warn",
  confirmed: "brand",
  awaiting_inspection: "warn",
  // estimates.status
  accepted: "success",
  rejected: "danger",
  // assignment_status / technician offers
  matching: "warn",
  offered: "warn",
  waiting: "neutral",
  // payments / support tickets / visits
  pending_verification: "warn",
  resolved: "success",
  closed: "neutral",
  upcoming: "info",
};

export default function StatusBadge({
  status,
  size = "md",
  withDot = false,
}: {
  status: string;
  size?: "sm" | "md";
  withDot?: boolean;
}) {
  const { chip, dot } = TONE_STYLES[STATUS_TONES[status] ?? "neutral"];

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full font-semibold capitalize ${
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"
      } ${chip}`}
    >
      {withDot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />}
      {/* `replace("_", " ")` only swapped the first underscore, so
          `pending_verification` read as "pending verification" but a future
          three-word status would have kept one. */}
      {status.replace(/_/g, " ")}
    </span>
  );
}

