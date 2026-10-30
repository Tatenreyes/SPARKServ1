"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Clock, MapPin, Plus, Trash2 } from "lucide-react";
import TimeSelect from "@/components/TimeSelect";
import { zonedToUtc } from "@/lib/service-time";
import { formatClockTime, isAfter } from "@/lib/time-of-day";
import type {
  TechnicianAvailabilityRow,
  TechnicianServiceAreaRow,
  TechnicianTimeOffRow,
} from "@/types/database";

/**
 * AvailabilityManager — a technician's own scheduling inputs.
 *
 * These are the three tables the queue reads when it asks "can this technician
 * actually work the window the customer asked for?":
 *
 *   technician_availability   weekly working-hours windows
 *   technician_time_off       concrete absences (a day, an afternoon, a week)
 *   technician_service_areas  which areas they cover
 *
 * The single most important thing this screen does is state the empty case
 * clearly. The SQL treats "no windows configured" and "no areas configured" as
 * NO RESTRICTION, not as "unavailable" — so an empty list means "you are
 * offered everything", which is the opposite of what a blank schedule usually
 * implies. Saying so on screen is the difference between a technician
 * understanding their setup and quietly believing they are switched off.
 *
 * Times are entered in the SERVICE timezone (`queue_service_timezone`,
 * Asia/Manila), not the browser's, and `zonedToUtc()` converts them — the same
 * helper the request wizard uses, so a technician's "09:00" and a customer's
 * "09:00" mean the same instant.
 */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * The compact field style of this screen's rows.
 *
 * The window pickers match the weekday select beside them rather than the taller control
 * used in the customer form: this is a dense scheduling row, and one control standing a
 * head above its neighbours reads as a mistake.
 */
const FIELD_COMPACT = "rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink";

function prettyDateTime(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

export default function AvailabilityManager({ serviceTimeZone }: { serviceTimeZone: string }) {
  const [windows, setWindows] = useState<TechnicianAvailabilityRow[]>([]);
  const [timeOff, setTimeOff] = useState<TechnicianTimeOffRow[]>([]);
  const [areas, setAreas] = useState<TechnicianServiceAreaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Window form
  const [weekday, setWeekday] = useState("1");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");

  // Time off form
  const [offStart, setOffStart] = useState("");
  const [offEnd, setOffEnd] = useState("");
  const [offReason, setOffReason] = useState("");

  // Service area form
  const [area, setArea] = useState("");
  const [areaAppliance, setAreaAppliance] = useState("");

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const res = await fetch("/api/technician-availability");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not load your availability");
      setWindows(json.data.windows ?? []);
      setTimeOff(json.data.time_off ?? []);
      setAreas(json.data.service_areas ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your availability");
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(true);
  }, [load]);

  async function act(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/technician-availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "That change was not saved");
      // Refresh WITHOUT the spinner: re-entering the loading state would rip
      // the form out from under the technician mid-edit on every add.
      await load(false);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "That change was not saved");
      return false;
    } finally {
      setBusy(false);
    }
  }


  async function addWindow() {
    if (endTime <= startTime) {
      setError("The window must end after it starts.");
      return;
    }
    const saved = await act({
      action: "add_window",
      weekday: Number(weekday),
      start_time: startTime,
      end_time: endTime,
    });
    if (saved) setNotice(`Added ${WEEKDAYS[Number(weekday)]} ${formatClockTime(startTime)}–${formatClockTime(endTime)}.`);
  }

  async function addTimeOff() {
    // `datetime-local` gives wall-clock text with no zone. Interpret it in the
    // service timezone so "Monday 9am" means 9am where the work happens, not
    // 9am wherever this browser happens to be sitting.
    const [sd, st] = offStart.split("T");
    const [ed, et] = offEnd.split("T");
    if (!sd || !st || !ed || !et) {
      setError("Pick both a start and an end for the time off.");
      return;
    }
    const startUtc = zonedToUtc(sd, st, serviceTimeZone);
    const endUtc = zonedToUtc(ed, et, serviceTimeZone);
    if (!startUtc || !endUtc || endUtc <= startUtc) {
      setError("The time off must end after it starts.");
      return;
    }

    const saved = await act({
      action: "add_time_off",
      starts_at: startUtc.toISOString(),
      ends_at: endUtc.toISOString(),
      reason: offReason,
    });
    if (saved) {
      setNotice(`Time off added for ${prettyDateTime(startUtc.toISOString(), serviceTimeZone)}.`);
      setOffStart("");
      setOffEnd("");
      setOffReason("");
    }
  }

  async function addArea() {
    if (!area.trim()) {
      setError("Enter an area name.");
      return;
    }
    const saved = await act({
      action: "add_area",
      area: area.trim(),
      appliance_type: areaAppliance.trim() || undefined,
    });
    if (saved) {
      setNotice(`Now covering ${area.trim()}.`);
      setArea("");
      setAreaAppliance("");
    }
  }

  async function remove(kind: "window" | "time_off" | "area", id: string) {
    const action =
      kind === "window" ? "remove_window" : kind === "time_off" ? "remove_time_off" : "remove_area";
    await act({ action, id });
  }

  if (loading) {
    return (
      <div className="rounded-card border border-ink/8 bg-surface p-4 shadow-card">
        <p className="text-sm text-ink/50">Loading your availability…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-card border border-alert-500/30 bg-alert-soft p-3 text-sm text-alert-ink">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-card border border-signal-500/30 bg-signal-soft p-3 text-sm text-signal-ink">
          {notice}
        </p>
      )}

      <section className="rounded-card border border-ink/8 bg-surface p-4 shadow-card">
        <header className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-ink/40" />
          <h2 className="font-display text-lg font-semibold text-ink">Weekly working hours</h2>
        </header>
        <p className="mt-1 text-xs text-ink/55">
          You are only offered jobs that fit inside these windows. All times are {serviceTimeZone}.
          {windows.length === 0
            ? " You have none set, so you currently count as available at any time."
            : " Requests outside them are passed to someone else — you keep your place in the queue."}
        </p>

        {windows.length > 0 && (
          <ul className="mt-3 divide-y divide-ink/8">
            {windows.map((w) => (
              <li key={w.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-ink">
                  <span className="font-medium">{WEEKDAYS[w.weekday] ?? `Day ${w.weekday}`}</span>{" "}
                  <span className="text-ink/65">
                    {formatClockTime(w.start_time)} – {formatClockTime(w.end_time)}
                  </span>
                </span>
                <button
                  onClick={() => remove("window", w.id)}
                  disabled={busy}
                  aria-label={`Remove ${WEEKDAYS[w.weekday]} window`}
                  className="rounded-full p-1.5 text-ink/40 hover:bg-alert-soft hover:text-alert-ink disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <select
            value={weekday}
            onChange={(e) => setWeekday(e.target.value)}
            aria-label="Weekday"
            className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm"
          >
            {WEEKDAYS.map((day, index) => (
              <option key={day} value={index}>
                {day}
              </option>
            ))}
          </select>
          {/* Two pickers rather than native time inputs, and the end only offers times that
              follow the start — `addWindow()` refuses a window that ends before it starts,
              and the API answers 400 for anything that is not HH:MM. */}
          <TimeSelect
            id="window-start"
            label="Window start"
            value={startTime}
            onChange={(value) => {
              setStartTime(value);
              if (endTime && !isAfter(value, endTime)) setEndTime("");
            }}
            step={15}
            variant="single"
            className={FIELD_COMPACT}
          />
          <TimeSelect
            id="window-end"
            label="Window end"
            value={endTime}
            onChange={setEndTime}
            after={startTime}
            step={15}
            variant="single"
            className={FIELD_COMPACT}
          />
          <button
            onClick={addWindow}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add window
          </button>
        </div>
      </section>

      <section className="rounded-card border border-ink/8 bg-surface p-4 shadow-card">
        <header className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-ink/40" />
          <h2 className="font-display text-lg font-semibold text-ink">Time off</h2>
        </header>
        <p className="mt-1 text-xs text-ink/55">
          Block out a specific period — a day, an afternoon, a week. Requests overlapping it go
          to someone else. Entered in {serviceTimeZone}. Past entries drop off this list on their own.
        </p>

        {timeOff.length === 0 ? (
          <p className="mt-3 text-sm text-ink/50">Nothing booked off.</p>
        ) : (
          <ul className="mt-3 divide-y divide-ink/8">
            {timeOff.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-ink">
                  <span className="font-medium">
                    {prettyDateTime(t.starts_at, serviceTimeZone)}
                  </span>{" "}
                  <span className="text-ink/65">→ {prettyDateTime(t.ends_at, serviceTimeZone)}</span>
                  {t.reason && <span className="text-ink/45"> · {t.reason}</span>}
                </span>
                <button
                  onClick={() => remove("time_off", t.id)}
                  disabled={busy}
                  aria-label="Remove time off"
                  className="rounded-full p-1.5 text-ink/40 hover:bg-alert-soft hover:text-alert-ink disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs text-ink/55">
            From
            <input
              type="datetime-local"
              value={offStart}
              onChange={(e) => setOffStart(e.target.value)}
              className="mt-1 block rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink"
            />
          </label>
          <label className="text-xs text-ink/55">
            To
            <input
              type="datetime-local"
              value={offEnd}
              onChange={(e) => setOffEnd(e.target.value)}
              className="mt-1 block rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink"
            />
          </label>
          <input
            value={offReason}
            onChange={(e) => setOffReason(e.target.value)}
            placeholder="Reason (optional)"
            className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm"
          />
          <button
            onClick={addTimeOff}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add time off
          </button>
        </div>
      </section>

      <section className="rounded-card border border-ink/8 bg-surface p-4 shadow-card">
        <header className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-ink/40" />
          <h2 className="font-display text-lg font-semibold text-ink">Service areas</h2>
        </header>
        <p className="mt-1 text-xs text-ink/55">
          Where you are willing to travel. Leave this empty and you cover everywhere you are
          qualified for. The match is on the area name inside the job&apos;s address, so use the
          place name your customers use — &quot;Quezon City&quot;, not &quot;QC&quot;.
        </p>

        {areas.length === 0 ? (
          <p className="mt-3 text-sm text-ink/50">
            No areas set — you currently cover everywhere you are qualified for.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-ink/8">
            {areas.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-ink">
                  <span className="font-medium">{a.area}</span>
                  <span className="text-ink/45">
                    {a.appliance_type ? ` · ${a.appliance_type.replace(/_/g, " ")} only` : " · all appliance types"}
                  </span>
                </span>
                <button
                  onClick={() => remove("area", a.id)}
                  disabled={busy}
                  aria-label={`Remove ${a.area}`}
                  className="rounded-full p-1.5 text-ink/40 hover:bg-alert-soft hover:text-alert-ink disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <input
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="Area, e.g. Quezon City"
            className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm"
          />
          <input
            value={areaAppliance}
            onChange={(e) => setAreaAppliance(e.target.value)}
            placeholder="Appliance type (optional), e.g. aircon"
            className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm"
          />
          <button
            onClick={addArea}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add area
          </button>
        </div>
      </section>
    </div>
  );
}

