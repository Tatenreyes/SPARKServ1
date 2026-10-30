"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  isFutureMonth,
  lastSelectableDay,
  parseIsoDate,
  purchaseYears,
  toIsoDate,
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
 * PAST DATES ONLY (`maxDate` defaults to today). It is not a general date picker:
 * the wizard's preferred service date is in the FUTURE and keeps its native input,
 * which is the one thing that control does well.
 */
const SELECT =
  "min-h-[44px] cursor-pointer rounded-xl border border-line bg-surface px-3 py-2 text-base text-ink transition duration-200 hover:border-brand-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:text-sm";

export interface DateSelectProps {
  /** Prefix for the three control ids, e.g. `appliance-purchase-date`. */
  id: string;
  /** Shown as the group's legend. */
  label: string;
  /** ISO `YYYY-MM-DD`, or "" when nothing has been chosen yet. */
  value: string;
  /** Called with the ISO date once all three parts exist, and with "" on clear. */
  onChange: (value: string) => void;
  /** The latest selectable day. Defaults to today. */
  maxDate?: Date;
}

export default function DateSelect({
  id,
  label,
  value,
  onChange,
  maxDate,
}: DateSelectProps) {
  const latest = maxDate ?? new Date();
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

  const years = purchaseYears(latest, year || null);
  const dayLimit = month && year ? lastSelectableDay(year, month, latest) : 31;

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
   * Clamp the day rather than clear it: 31 January followed by "February" should
   * read 28 (or 29), not silently empty the field.
   */
  function chooseMonth(nextMonth: number) {
    const limit = nextMonth && year ? lastSelectableDay(year, nextMonth, latest) : 31;
    commit(nextMonth, day && day > limit ? limit : day, year);
  }

  function chooseYear(nextYear: number) {
    const limit = month && nextYear ? lastSelectableDay(nextYear, month, latest) : 31;
    commit(month, day && day > limit ? limit : day, nextYear);
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
              disabled={year ? isFutureMonth(year, index + 1, latest) : false}
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
          disabled={dayLimit === 0}
          className={`${SELECT} basis-[5.5rem] disabled:cursor-not-allowed disabled:opacity-60`}
        >
          <option value="">Day</option>
          {Array.from({ length: dayLimit }, (_, index) => index + 1).map((option) => (
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
      {dayLimit === 0 && (
        <p className="mt-1 text-[11px] text-muted">
          That month hasn&apos;t happened yet — pick an earlier one.
        </p>
      )}
    </fieldset>
  );
}
