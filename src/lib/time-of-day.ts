/**
 * Clock times for the request form's preferred service window.
 *
 * Free of React imports so the test suite can run the real code (Node strips the
 * types — no build step, and no second copy of these rules to drift).
 *
 * ## Why selects and not `input type="time"`
 *
 * The native time input renders as plain `--:--` segments with a small clock icon, the
 * same problem the date fields had: no calendar/clock popup on Firefox desktop, nothing
 * to style, and the segments are easy to misread. The window is a five-minute grid
 * instead, which is what a service visit actually needs — nobody books 09:07.
 *
 * ## The one invariant
 *
 * The API reads `preferred_start_time` / `preferred_end_time` and, when the end is not
 * strictly after the start, returns NO window at all (`readRequestedWindow`): the request
 * is still submitted, the customer's stated preference is simply dropped. So the end
 * picker only offers times that can legally follow the start, and nothing can be typed
 * into an invalid state.
 */

/** Minute granularity of the window pickers. */
export const TIME_STEP_MINUTES = 5;

/** A time of day on the 24-hour clock. */
export interface ClockTime {
  /** 0-23 */
  hour: number;
  /** 0-59 */
  minute: number;
}

/**
 * Minutes since midnight, or null when the value is not a clock time.
 *
 * Accepts the optional seconds that Postgres appends to a `time` column ("09:00:00") —
 * the same shape `zonedToUtc()` accepts, so a stored window and a picked one read alike.
 */
export function minutesOfDay(value: string | null | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec((value ?? "").trim());
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** `"HH:MM"`, 24-hour — the shape the request body and the database read. */
export function toClockTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** 1-12, for the hour picker. */
export function hour12Of(hour: number): number {
  const wrapped = hour % 12;
  return wrapped === 0 ? 12 : wrapped;
}

/** Which half of the day an hour belongs to. */
export function meridiemOf(hour: number): "AM" | "PM" {
  return hour < 12 ? "AM" : "PM";
}

/** The 24-hour hour for a 12-hour picker value. */
export function hour24Of(hour12: number, meridiem: "AM" | "PM"): number {
  if (meridiem === "AM") return hour12 === 12 ? 0 : hour12;
  return hour12 === 12 ? 12 : hour12 + 12;
}

/** "9:00 AM" — how a chosen time reads back to the customer. */
export function formatClockTime(value: string | null | undefined): string {
  const minutes = minutesOfDay(value);
  if (minutes === null) return "";
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${hour12Of(hour)}:${String(minute).padStart(2, "0")} ${meridiemOf(hour)}`;
}

/**
 * Every selectable time in a day at the step, or — when `after` is given — only those
 * strictly after it. That single filter is what keeps a window end legal.
 */
export function timeOptions(
  after?: string | null,
  step: number = TIME_STEP_MINUTES
): ClockTime[] {
  const floor = minutesOfDay(after);
  const options: ClockTime[] = [];

  for (let minute = 0; minute < 24 * 60; minute += step) {
    if (floor !== null && minute <= floor) continue;
    options.push({ hour: Math.floor(minute / 60), minute: minute % 60 });
  }
  return options;
}

/** Whether `end` is a legal end for a window that starts at `start`. */
export function isAfter(start: string | null | undefined, end: string | null | undefined): boolean {
  const from = minutesOfDay(start);
  const to = minutesOfDay(end);
  return from !== null && to !== null && to > from;
}

/**
 * The options that survive a partial 12-hour selection — the pool a picker draws from.
 *
 * This is what keeps the three selects consistent with each other: the minute list can
 * only contain minutes that exist for the chosen hour and half-day, so every combination
 * a customer can assemble is one that is actually offered.
 */
export function optionsFor(
  options: ClockTime[],
  selection: { hour12?: number; meridiem?: "AM" | "PM" | "" }
): ClockTime[] {
  return options.filter(
    (option) =>
      (!selection.hour12 || hour12Of(option.hour) === selection.hour12) &&
      (!selection.meridiem || meridiemOf(option.hour) === selection.meridiem)
  );
}
