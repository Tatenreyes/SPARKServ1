"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  TIME_STEP_MINUTES,
  formatClockTime,
  hour12Of,
  hour24Of,
  meridiemOf,
  minutesOfDay,
  optionsFor,
  timeOptions,
  toClockTime,
} from "@/lib/time-of-day";

/**
 * Three native selects — hour, minute, AM/PM — for the preferred service window.
 *
 * The same reasoning as `DateSelect`: `input type="time"` is plain `--:--` segments with
 * a small icon, has no popup at all on Firefox desktop, and cannot be styled to match
 * the rest of the form. A five-minute grid is also what a visit needs — nobody books
 * 09:07.
 *
 * `after` is what makes the end of the window legal: the API drops a window whose end is
 * not strictly after its start, silently, so the end picker may only offer times that can
 * follow the start. Every combination a customer can assemble here is therefore one the
 * API will keep.
 */
const SELECT =
  "min-h-[44px] cursor-pointer rounded-xl border border-line bg-surface px-3 py-2 text-base text-ink transition duration-200 hover:border-brand-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:text-sm disabled:cursor-not-allowed disabled:opacity-60";

/** Ascending unique numbers, for option lists derived from the allowed times. */
function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function uniqueValues<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export interface TimeSelectProps {
  /** Prefix for the three control ids, e.g. `preferred-start`. */
  id: string;
  /** Used for the per-control labels, e.g. "Preferred start time hour". */
  label: string;
  /** `"HH:MM"` on the 24-hour clock, or "" when nothing has been chosen. */
  value: string;
  /** Called with the chosen `"HH:MM"`, and with "" on clear. */
  onChange: (value: string) => void;
  /** Only times strictly after this are offered — a window end must follow its start. */
  after?: string;
  disabled?: boolean;
  /** Minutes between choices. Five suits a visit window; fifteen suits working hours. */
  step?: number;
  /**
   * `split` (the default) is three selects — hour, minute, AM/PM — for a window the
   * customer states precisely. `single` is one select of ready-made times, for a dense
   * row such as the availability grid, where three selects per boundary would not fit.
   */
  variant?: "split" | "single";
  /** Field styling, so a compact caller can match the controls beside it. */
  className?: string;
}

export default function TimeSelect({
  id,
  label,
  value,
  onChange,
  after,
  disabled = false,
  step = TIME_STEP_MINUTES,
  variant = "split",
  className = SELECT,
}: TimeSelectProps) {
  const parsed = minutesOfDay(value);

  // `0` and `-1` mean "not chosen yet": a 12-hour clock never shows 0, and -1 is not a
  // minute (0 is — on the hour).
  const [hour12, setHour12] = useState(parsed === null ? 0 : hour12Of(Math.floor(parsed / 60)));
  const [minute, setMinute] = useState(parsed === null ? -1 : parsed % 60);
  const [meridiem, setMeridiem] = useState<"AM" | "PM" | "">(
    parsed === null ? "" : meridiemOf(Math.floor(parsed / 60))
  );

  /**
   * Re-read the value when the caller changes it: the wizard clears the end when the
   * start moves past it, and "Clear" can come from this component too.
   */
  useEffect(() => {
    const next = minutesOfDay(value);
    if (next === null) {
      setHour12(0);
      setMinute(-1);
      setMeridiem("");
      return;
    }
    const hour = Math.floor(next / 60);
    setHour12(hour12Of(hour));
    setMinute(next % 60);
    setMeridiem(meridiemOf(hour));
  }, [value]);

  const valid = useMemo(() => timeOptions(after, step), [after, step]);

  /**
   * The single-select list, plus the current value when it sits off the grid — a window
   * stored at 09:07 (or a shift that predates the step) must still be visible, or the
   * control would silently rewrite it.
   */
  const singleOptions = useMemo(() => {
    const floor = minutesOfDay(after);
    const current = minutesOfDay(value);
    const times = valid.map((option) => toClockTime(option.hour, option.minute));
    if (current === null || (floor !== null && current <= floor)) return times;
    const asText = toClockTime(Math.floor(current / 60), current % 60);
    if (times.includes(asText)) return times;
    return [...times, asText].sort((a, b) => Number(minutesOfDay(a)) - Number(minutesOfDay(b)));
  }, [valid, after, value]);

  const chosen = Boolean(hour12) && minute >= 0 && Boolean(meridiem);

  const hourChoices = uniqueNumbers(valid.map((option) => hour12Of(option.hour)));
  const meridiemChoices = uniqueValues(
    optionsFor(valid, { hour12 }).map((option) => meridiemOf(option.hour))
  );
  const minuteChoices = uniqueNumbers(
    optionsFor(valid, { hour12, meridiem }).map((option) => option.minute)
  );

  /**
   * The compact variant: one select of ready-made times.
   *
   * It exists because the availability grid puts a start and an end in one row beside a
   * weekday select and an Add button — six selects there would not fit, and three per
   * boundary would wrap the row into a column.
   */
  if (variant === "single") {
    return (
      <div className="min-w-0">
        <select
          id={id}
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={className}
        >
          <option value="">Select time</option>
          {singleOptions.map((option) => (
            <option key={option} value={option}>
              {formatClockTime(option)}
            </option>
          ))}
        </select>

        {/* Said out loud rather than shown as an empty list, which reads as broken. */}
        {!disabled && valid.length === 0 && (
          <p className="mt-1 text-[11px] text-ink/55">
            No time left in the day after that start — pick an earlier one.
          </p>
        )}
      </div>
    );
  }

  function commit(nextHour12: number, nextMinute: number, nextMeridiem: "AM" | "PM" | "") {
    // Clamp the minute into what the new hour allows, so a chosen 09:00 cannot survive a
    // switch to a block whose earliest minute is later.
    const allowed = uniqueNumbers(
      optionsFor(valid, { hour12: nextHour12, meridiem: nextMeridiem }).map((o) => o.minute)
    );
    const nextAllowedMinute =
      nextMinute < 0 ? -1 : allowed.includes(nextMinute) ? nextMinute : (allowed[0] ?? -1);

    setHour12(nextHour12);
    setMinute(nextAllowedMinute);
    setMeridiem(nextMeridiem);

    // Still incomplete: report nothing rather than a half-time the payload would guess at.
    if (!nextHour12 || nextAllowedMinute < 0 || !nextMeridiem) return;

    const candidate = toClockTime(hour24Of(nextHour12, nextMeridiem), nextAllowedMinute);
    if (!valid.some((option) => toClockTime(option.hour, option.minute) === candidate)) {
      return;
    }
    onChange(candidate);
  }

  function clear() {
    setHour12(0);
    setMinute(-1);
    setMeridiem("");
    onChange("");
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <select
          id={`${id}-hour`}
          aria-label={`${label} hour`}
          value={hour12 || ""}
          onChange={(e) => commit(Number(e.target.value), minute, meridiem)}
          disabled={disabled}
          className={`${SELECT} flex-1 basis-[5rem]`}
        >
          <option value="">Hour</option>
          {hourChoices.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>

        <select
          id={`${id}-minute`}
          aria-label={`${label} minutes`}
          value={minute >= 0 ? minute : ""}
          onChange={(e) => commit(hour12, Number(e.target.value), meridiem)}
          disabled={disabled || minuteChoices.length === 0}
          className={`${SELECT} basis-[4.75rem]`}
        >
          <option value="">Min</option>
          {minuteChoices.map((option) => (
            <option key={option} value={option}>
              {String(option).padStart(2, "0")}
            </option>
          ))}
        </select>

        <select
          id={`${id}-meridiem`}
          aria-label={`${label} AM or PM`}
          value={meridiem}
          onChange={(e) => commit(hour12, minute, e.target.value as "AM" | "PM" | "")}
          disabled={disabled}
          className={`${SELECT} basis-[5.5rem]`}
        >
          <option value="">AM/PM</option>
          {meridiemChoices.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>

        {chosen && !disabled && (
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

      {/* Said out loud rather than shown as three empty lists, which read as broken. */}
      {!disabled && valid.length === 0 && (
        <p className="mt-1 text-[11px] text-muted">
          No time left in the day after that start — pick an earlier one.
        </p>
      )}
    </div>
  );
}
