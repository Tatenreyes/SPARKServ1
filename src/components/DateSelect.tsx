"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  anyRange,
  futureRange,
  monthPosition,
  parseIsoDate,
  pastRange,
  selectableDayRange,
  startOfToday,
  toIsoDate,
  yearsInRange,
} from "@/lib/appliance-fields";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Three native selects — month, day, year — rather than a calendar grid.
 *
 * A phone shows its own wheel for each, a desktop shows a dropdown, and Firefox
 * gets the same thing as Chrome: `input type="date"` was already here, but it
 * renders as plain text segments whose only affordance is a small icon (and in
 * Firefox there is no popup at all). Native selects are the one control that is
 * a picker everywhere, and they need no popover to position, clip or dismiss.
 *
 * The field styling lives here instead of being passed in: this is a GROUP of
 * three controls, and a single-field class such as the wizard's `FIELD` carries
 * `w-full`, which would make each select claim a whole row of its own.
 *
 * One control serves both date fields, and `direction` decides which side of today
 * it is for — the purchase date (1970 .. today) and the requested service date
 * (today .. a year ahead). The bounds live in the lib, so the two cannot drift apart:
 * the same clamping that stops a purchase date in the future stops a service date in
 * the past.
 */
const SELECT =
  "min-h-[44px] cursor-pointer rounded-xl border border-line bg-surface px-3 py-2 text-base text-ink transition duration-200 hover:border-brand-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:text-sm disabled:cursor-not-allowed disabled:opacity-60";

export interface DateSelectProps {
  /** Prefix for the three control ids, e.g. `appliance-purchase-date`. */
  id: string;
  /** Shown as the group's legend. */
  label: string;
  /** ISO `YYYY-MM-DD`, or "" when nothing has been chosen yet. */
  value: string;
  /** Called with the ISO date once all three parts exist, and with "" on clear. */
  onChange: (value: string) => void;
  /**
   * Which side of today this field is for. `past` (the default) is an appliance's
   * purchase date, `future` is a requested service date, and `any` is a warranty
   * expiry — the one date that may legitimately be either.
   */
  direction?: "past" | "future" | "any";
}

export default function DateSelect({
  id,
  label,
  value,
  onChange,
  direction = "past",
}: DateSelectProps) {
  const parsed = parseIsoDate(value);

  const [month, setMonth] = useState(parsed ? parsed.getMonth() + 1 : 0);
  const [day, setDay] = useState(parsed ? parsed.getDate() : 0);
  const [year, setYear] = useState(parsed ? parsed.getFullYear() : 0);

  /**
   * Re-read the value when the caller changes it underneath us: the edit form
   * hydrates from a stored row, and "Clear" can also come from this component.
   *
   * A partial choice (a month and a day but no year) never reaches `value`, so it
   * lives here and is not wiped by this effect.
   */
  useEffect(() => {
    const next = parseIsoDate(value);
    setMonth(next ? next.getMonth() + 1 : 0);
    setDay(next ? next.getDate() : 0);
    setYear(next ? next.getFullYear() : 0);
  }, [value]);

  // Read once per mount: a range that shifted under the customer mid-form would be worse
  // than one that is a few hours stale.
  const today = useMemo(() => startOfToday(), []);
  const range = useMemo(() => {
    if (direction === "future") return futureRange(today);
    if (direction === "any") return anyRange(today);
    return pastRange(today);
  }, [direction, today]);

  const years = yearsInRange(range, year || null);
  const chosen = Boolean(month && year);
  const position = chosen ? monthPosition(year, month, range) : "inside";
  const bounds = chosen ? selectableDayRange(year, month, range) : null;

  /**
   * The day list. Before a month and a year exist it is a whole month — a partial choice
   * cannot be committed anyway, and an empty Day list would look broken. Once both are
   * known the list is exactly the selectable span, or the stored day alone when the month
   * itself is out of range, so a value from an older row still renders.
   */
  const dayNumbers = !chosen
    ? Array.from({ length: 31 }, (_, index) => index + 1)
    : bounds
      ? Array.from({ length: bounds[1] - bounds[0] + 1 }, (_, index) => bounds[0] + index)
      : day
        ? [day]
        : [];

  function commit(nextMonth: number, nextDay: number, nextYear: number) {
    setMonth(nextMonth);
    setDay(nextDay);
    setYear(nextYear);
    // Still incomplete: report nothing rather than a half-date the payload would
    // have to guess at.
    if (!nextMonth || !nextDay || !nextYear) return;
    onChange(toIsoDate(nextYear, nextMonth, nextDay));
  }

  /**
   * Clamp the day rather than clear it: 31 January followed by "February" should read 28
   * (or 29), not silently empty the field — and in the other direction, a service date
   * cannot keep a day that has already passed this month.
   */
  function clampDay(nextDay: number, nextMonth: number, nextYear: number): number {
    if (!nextDay || !nextMonth || !nextYear) return nextDay;
    const next = selectableDayRange(nextYear, nextMonth, range);
    if (!next) return 0;
    return Math.min(Math.max(nextDay, next[0]), next[1]);
  }

  function chooseMonth(nextMonth: number) {
    commit(nextMonth, clampDay(day, nextMonth, year), year);
  }

  function chooseYear(nextYear: number) {
    commit(month, clampDay(day, month, nextYear), nextYear);
  }

  function clear() {
    setMonth(0);
    setDay(0);
    setYear(0);
    onChange("");
  }

  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 block text-sm font-medium text-ink/80">{label}</legend>
      <div className="flex flex-wrap items-center gap-2">
        <select
          id={`${id}-month`}
          aria-label={`${label} month`}
          value={month || ""}
          onChange={(e) => chooseMonth(Number(e.target.value))}
          className={`${SELECT} flex-1 basis-[8rem]`}
        >
          <option value="">Month</option>
          {MONTHS.map((name, index) => (
            <option
              key={name}
              value={index + 1}
              disabled={year ? monthPosition(year, index + 1, range) !== "inside" : false}
            >
              {name}
            </option>
          ))}
        </select>

        <select
          id={`${id}-day`}
          aria-label={`${label} day`}
          value={day || ""}
          onChange={(e) => commit(month, Number(e.target.value), year)}
          disabled={chosen && !bounds}
          className={`${SELECT} basis-[5.5rem]`}
        >
          <option value="">Day</option>
          {dayNumbers.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>

        <select
          id={`${id}-year`}
          aria-label={`${label} year`}
          value={year || ""}
          onChange={(e) => chooseYear(Number(e.target.value))}
          className={`${SELECT} basis-[6.5rem]`}
        >
          <option value="">Year</option>
          {years.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>

        {value && (
          <button
            type="button"
            onClick={clear}
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-1 rounded-xl px-2 text-xs font-semibold text-muted transition duration-200 hover:text-ink"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Clear
          </button>
        )}
      </div>

      {/* Said out loud rather than shown as an empty Day list, which reads as broken. */}
      {chosen && !bounds && (
        <p className="mt-1 text-[11px] text-muted">
          {position === "before"
            ? "That date is earlier than this field allows — pick a later month."
            : direction === "future"
              ? "That is more than a year ahead — pick a nearer month."
              : "That month hasn't happened yet — pick an earlier one."}
        </p>
      )}
    </fieldset>
  );
}
