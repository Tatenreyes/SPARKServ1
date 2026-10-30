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
 * The last selectable day of a month, so a purchase date is never in the future:
 * the appliance cannot have been bought tomorrow.
 *
 * Returns 0 for a month that has not started yet — a year is capped at the current
 * one, but March is still selectable in February, and that month must offer no days
 * at all rather than a full set of dates that have not happened.
 */
export function lastSelectableDay(year: number, month: number, maxDate: Date): number {
  const maxYear = maxDate.getFullYear();
  const maxMonth = maxDate.getMonth() + 1;

  if (year > maxYear) return 0;
  if (year === maxYear) {
    if (month > maxMonth) return 0;
    if (month === maxMonth) {
      return Math.min(daysInMonth(year, month), maxDate.getDate());
    }
  }
  return daysInMonth(year, month);
}

/** Whether a month can be picked at all: later months of the current year cannot. */
export function isFutureMonth(year: number, month: number, maxDate: Date): boolean {
  return lastSelectableDay(year, month, maxDate) === 0;
}

/**
 * Selectable purchase years, newest first.
 *
 * `include` keeps a stored value visible even when it falls outside the range —
 * a clock that moved, or a row edited before this rule existed.
 */
export function purchaseYears(maxDate: Date, include?: number | null): number[] {
  const years: number[] = [];
  for (let year = maxDate.getFullYear(); year >= MIN_PURCHASE_YEAR; year--) {
    years.push(year);
  }
  if (include && !years.includes(include)) years.unshift(include);
  return years;
}
