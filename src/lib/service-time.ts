import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Service-timezone helpers.
 *
 * The queue engine evaluates availability windows and "jobs that day" in the
 * platform's service timezone (the `queue_service_timezone` setting, read by
 * public.service_timezone() in SQL). A customer picking "Jan 24, 09:00" must
 * therefore mean 09:00 *in Manila*, not 09:00 wherever their browser happens to
 * be — otherwise the same request would be evaluated differently depending on
 * who submitted it.
 */

const DEFAULT_TIMEZONE = "Asia/Manila";

export async function getServiceTimezone(supabase: SupabaseClient<Database>): Promise<string> {
  const { data } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "queue_service_timezone")
    .maybeSingle();
  const value = String(data?.value ?? "").trim();
  return value || DEFAULT_TIMEZONE;
}

/** Offset (ms) that `timeZone` is ahead of UTC at the given instant. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(instant)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    // Intl can report midnight as "24" in some environments.
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );

  return asUtc - instant.getTime();
}

/**
 * Turns a wall-clock date + time in `timeZone` into the matching UTC instant.
 * Handles the (rare) case where the naive guess lands on the other side of a
 * DST transition by re-checking the offset at the corrected instant.
 */
export function zonedToUtc(date: string, time: string, timeZone: string): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const timeMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!dateMatch || !timeMatch) return null;

  const [, year, month, day] = dateMatch;
  const [, hour, minute, second = "00"] = timeMatch;

  const naive = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
  );
  if (Number.isNaN(naive.getTime())) return null;

  const firstGuess = new Date(naive.getTime() - zoneOffsetMs(naive, timeZone));
  const corrected = new Date(naive.getTime() - zoneOffsetMs(firstGuess, timeZone));
  return corrected;
}

/**
 * Renders a stored requested window for a human, in the service timezone — the
 * same clock the customer typed into and the same one the queue evaluated
 * against. Used on the technician's offer card: accepting a job without knowing
 * when the customer wants it is how appointments get missed.
 *
 * Returns null when no window was captured, so callers can fall back to "no
 * preference stated" rather than printing an empty label.
 */
export function formatRequestedWindow(
  start: string | null | undefined,
  end: string | null | undefined,
  timeZone: string
): string | null {
  if (!start || !end) return null;
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;

  const dateOpts: Intl.DateTimeFormatOptions = { timeZone, weekday: "short", month: "short", day: "numeric" };
  const timeOpts: Intl.DateTimeFormatOptions = { timeZone, hour: "2-digit", minute: "2-digit", hour12: true };
  const sameDay =
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "numeric" }).format(startDate) ===
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "numeric" }).format(endDate);

  const dateLabel = new Intl.DateTimeFormat("en-US", dateOpts).format(startDate);
  const startTime = new Intl.DateTimeFormat("en-US", timeOpts).format(startDate);
  const endTime = new Intl.DateTimeFormat("en-US", timeOpts).format(endDate);

  return sameDay ? `${dateLabel} · ${startTime} – ${endTime}` : `${dateLabel} ${startTime} → ${endTime}`;
}

/**
 * Reads an optional requested window from a request body.
 *
 * Accepts either explicit ISO timestamps (`requested_window_start` /
 * `requested_window_end`) or the wizard's plain date + time inputs
 * (`preferred_date`, `preferred_start_time`, `preferred_end_time`), which are
 * interpreted in the service timezone. A date with no times is NOT treated as a
 * whole-day booking — that would make every existing appointment that day a
 * conflict, which is exactly the behaviour the redesign removes.
 */
export async function readRequestedWindow(
  supabase: SupabaseClient<Database>,
  body: Record<string, unknown>
): Promise<{ start: string | null; end: string | null; durationMinutes: number | null }> {
  const explicitStart = typeof body.requested_window_start === "string" ? body.requested_window_start : null;
  const explicitEnd = typeof body.requested_window_end === "string" ? body.requested_window_end : null;
  const explicitDuration =
    typeof body.requested_duration_minutes === "number" && body.requested_duration_minutes > 0
      ? Math.round(body.requested_duration_minutes)
      : null;

  if (explicitStart && explicitEnd) {
    const start = new Date(explicitStart);
    const end = new Date(explicitEnd);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end > start) {
      return {
        start: start.toISOString(),
        end: end.toISOString(),
        durationMinutes: explicitDuration ?? Math.round((end.getTime() - start.getTime()) / 60_000),
      };
    }
    return { start: null, end: null, durationMinutes: explicitDuration };
  }

  const preferredDate = typeof body.preferred_date === "string" ? body.preferred_date : "";
  const preferredStart = typeof body.preferred_start_time === "string" ? body.preferred_start_time : "";
  const preferredEnd = typeof body.preferred_end_time === "string" ? body.preferred_end_time : "";

  if (!preferredDate || !preferredStart || !preferredEnd) {
    return { start: null, end: null, durationMinutes: explicitDuration };
  }

  const timeZone = await getServiceTimezone(supabase);
  const start = zonedToUtc(preferredDate, preferredStart, timeZone);
  const end = zonedToUtc(preferredDate, preferredEnd, timeZone);

  if (!start || !end || end <= start) {
    return { start: null, end: null, durationMinutes: explicitDuration };
  }

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    durationMinutes: explicitDuration ?? Math.round((end.getTime() - start.getTime()) / 60_000),
  };
}
