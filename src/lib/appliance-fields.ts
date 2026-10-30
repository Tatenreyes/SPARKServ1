/**
 * The appliance fields a customer types: model number, serial number, and the
 * date they bought the unit.
 *
 * Kept free of React, Next and icon imports so the test suite can import this
 * module directly — `scripts/tests/appliance-fields.test.mjs` runs the REAL code
 * (Node strips the types, so there is no build step and no second copy of these
 * rules to drift).
 *
 * ## Why the caps live here and not in the database
 *
 * `appliances.model_number` and `.serial_number` are unbounded `text` columns, and
 * both screens write to them straight through the RLS client, so nothing between
 * the keyboard and the row bounded them: a paste of a whole document was stored,
 * and every screen that renders the appliance had to cope with it. A check
 * constraint is the only real enforcement, but that needs a migration while the
 * columns stay free text for anything writing around this module — so these are
 * applied in the field (`maxLength`) and again on the way into the payload
 * (`cleanCode`).
 */

/** Longest accepted model number. Real ones run 15-25 characters ("WF45R6100AP/A2"). */
export const MAX_MODEL_NUMBER_LENGTH = 50;

/** Longest accepted serial number. Rating labels rarely exceed 25 characters. */
export const MAX_SERIAL_NUMBER_LENGTH = 50;

/**
 * Everything an identifier may contain: letters, digits, and the three characters
 * that actually appear on a rating label - whitespace, hyphen and slash
 * ("WF45R6100AP/A2", "RT-32K"). Anything else is dropped as it is typed, so a pasted
 * sentence cannot become an appliance identifier.
 *
 * The slash and hyphen are deliberate: they are not "letters or numbers", but a
 * strictly alphanumeric filter would reject real Samsung and LG labels.
 */
const NON_CODE_CHARACTERS = /[^A-Za-z0-9\s/-]/g;

/** Strip the characters that cannot be part of an identifier. */
function stripCodeCharacters(value: string): string {
  return value.replace(NON_CODE_CHARACTERS, "");
}

/**
 * Strip and cap on every keystroke, so what is on screen is already what will be
 * stored: a comma or a full stop from a pasted sentence never even appears.
 */
export function sanitiseCodeInput(value: string, max: number): string {
  return stripCodeCharacters(value).slice(0, max);
}

/** Earliest selectable purchase year. */
export const MIN_PURCHASE_YEAR = 1970;

/** How close to the cap the counter starts showing, in characters. */
export const COUNTER_VISIBLE_WITHIN = 10;

/**
 * Strip anything that is not a letter, digit, space, hyphen or slash, collapse runs
 * of whitespace, trim, and cap to `max`.
 *
 * Applied on the way into the payload as well as in the field, so a row that
 * already exceeds the cap is repaired the first time it is edited.
 */
export function cleanCode(value: string, max: number): string {
  // Trimmed again after the slice: cutting mid-value can land on the space the
  // collapse just normalised, and "RT32 " is not a model number.
  const collapsed = stripCodeCharacters(value).replace(/\s+/g, " ").trim();
  return collapsed.slice(0, max).trim();
}

/** Whether the length counter should be shown for this value. */
export function showsCounter(value: string, max: number): boolean {
  return value.length >= max - COUNTER_VISIBLE_WITHIN;
}

/** Days in a month. `month` is 1-based, and leap years are included. */
export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(year, month, 0).getDate();
}

/** ISO `YYYY-MM-DD` for a calendar date. */
export function toIsoDate(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Parse `YYYY-MM-DD` as a LOCAL calendar date, or null if it is not one.
 *
 * `new Date("2019-03-12")` is parsed as UTC midnight, so anywhere west of UTC it
 * renders as 11 March. A purchase date has no time and no zone — it is the
 * calendar date the customer picked — so it must be read the same way everywhere.
 */
export function parseIsoDate(value: string | null | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value ?? "").trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  // 2023-02-30 would otherwise roll silently forward into 2 March.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/** A stored purchase date as the customer reads it back: "12 Mar 2019". */
export function formatIsoDate(value: string | null | undefined): string {
  const date = parseIsoDate(value);
  if (!date) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * A date field's selectable range, inclusive at both ends.
 *
 * ONE rule for both date fields: an appliance's purchase date is "1970 .. today" and a
 * requested service date is "today .. a year ahead", so the same clamping that stops a
 * purchase date in the future stops a service date in the past.
 */
export interface DateRange {
  min: Date;
  max: Date;
}

/** A calendar day with no time, so comparing two bounds never depends on the clock. */
export function atMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Today, at midnight. */
export function startOfToday(now: Date = new Date()): Date {
  return atMidnight(now);
}

/** An appliance's purchase date: 1970 up to today. Nothing is bought tomorrow. */
export function pastRange(today: Date): DateRange {
  return { min: new Date(MIN_PURCHASE_YEAR, 0, 1), max: atMidnight(today) };
}

/** A requested service date: today up to a year ahead. Nothing is booked in the past. */
export function futureRange(today: Date): DateRange {
  const from = atMidnight(today);
  return {
    min: from,
    max: new Date(from.getFullYear() + 1, from.getMonth(), from.getDate()),
  };
}

/** How far ahead a warranty expiry date may be set. */
export const MAX_WARRANTY_YEARS = 10;

/**
 * A warranty expiry: 1970 up to ten years ahead.
 *
 * The one field that legitimately sits on both sides of today — a warranty may already
 * have run out, which is exactly why the customer is being asked. The ceiling is only
 * there to stop a typo like 2206.
 */
export function anyRange(today: Date): DateRange {
  const from = atMidnight(today);
  return {
    min: new Date(MIN_PURCHASE_YEAR, 0, 1),
    max: new Date(from.getFullYear() + MAX_WARRANTY_YEARS, from.getMonth(), from.getDate()),
  };
}

/** Where a month sits relative to a range. */
export type MonthPosition = "before" | "inside" | "after";

export function monthPosition(year: number, month: number, range: DateRange): MonthPosition {
  const first = new Date(year, month - 1, 1).getTime();
  const last = new Date(year, month, 0).getTime();
  if (last < atMidnight(range.min).getTime()) return "before";
  if (first > atMidnight(range.max).getTime()) return "after";
  return "inside";
}

/**
 * The selectable day numbers inside one month, as `[first, last]`, or null when the
 * whole month falls outside the range.
 *
 * Both ends are clamped, which is what keeps the current month from offering days that
 * have not happened (a purchase) or days that are already gone (a service call).
 */
export function selectableDayRange(
  year: number,
  month: number,
  range: DateRange
): [number, number] | null {
  if (monthPosition(year, month, range) !== "inside") return null;

  const monthDays = daysInMonth(year, month);
  const min = atMidnight(range.min);
  const max = atMidnight(range.max);
  const from = new Date(year, month - 1, 1).getTime() < min.getTime() ? min.getDate() : 1;
  const to = new Date(year, month, 0).getTime() > max.getTime() ? max.getDate() : monthDays;
  return [from, to];
}

/**
 * The years a range spans, newest first, plus a stored value that falls outside it — a
 * clock that moved, or a row written before this rule existed. Dropping that year would
 * silently rewrite the date the next time the row was edited.
 */
export function yearsInRange(range: DateRange, include?: number | null): number[] {
  const years: number[] = [];
  const last = atMidnight(range.max).getFullYear();
  const first = atMidnight(range.min).getFullYear();
  for (let year = last; year >= first; year--) {
    years.push(year);
  }
  if (include && !years.includes(include)) years.unshift(include);
  return years;
}
