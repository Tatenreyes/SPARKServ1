"use client";

import { showsCounter } from "@/lib/appliance-fields";

/**
 * "34/40", shown only once a field is nearly full.
 *
 * A bare `maxLength` stops the typing with no explanation, which reads as a bug
 * rather than a limit. The counter appears for the last few characters — exactly
 * when it matters — and stays out of the way the rest of the time.
 */
export default function FieldCounter({ value, max }: { value: string; max: number }) {
  if (!showsCounter(value, max)) return null;

  const atLimit = value.length >= max;
  return (
    <p
      className={`mt-1 text-right text-[11px] ${atLimit ? "text-warn-ink" : "text-muted"}`}
      aria-live="polite"
    >
      {value.length}/{max}
    </p>
  );
}
