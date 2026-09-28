"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";

type OverrideAction = "move_to_end" | "remove" | "reactivate";

const ACTION_OPTIONS: { value: OverrideAction; label: string; hint: string }[] = [
  {
    value: "move_to_end",
    label: "Move to end of rotation",
    hint: "Consumes a turn on the technician's behalf. Use only to correct a mistake the rotation made.",
  },
  {
    value: "remove",
    label: "Remove from this rotation",
    hint: "For leave, suspension or a specialization change. Does not touch their other queues.",
  },
  {
    value: "reactivate",
    label: "Return to the rotation",
    hint: "Puts the technician back at the end of the queue.",
  },
];

/**
 * The audited administrative override (spec §32, §33).
 *
 * Deliberately two-step — pick an action, write a reason, then confirm — because
 * this is the only way to change the rotation by hand. The reason is required
 * client-side *and* server-side (`admin_queue_override` raises without one), and
 * every override is written to `technician_queue_events` with the administrator's
 * account plus the old and new position. Nothing here can hand a technician work
 * directly: it only moves them within the fair rotation.
 */
export default function QueueOverrideControl({
  applianceType,
  technicianId,
  technicianName,
  position,
  isActive,
}: {
  applianceType: string;
  technicianId: string;
  technicianName: string;
  position: number | null;
  isActive: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<OverrideAction>(isActive ? "move_to_end" : "reactivate");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selected = ACTION_OPTIONS.find((option) => option.value === action)!;

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/queue-override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appliance_type: applianceType,
          technician_id: technicianId,
          action,
          reason,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(payload.error ?? "The override was rejected.");
        return;
      }
      setMessage("Override applied and logged.");
      setReason("");
      setOpen(false);
      setConfirming(false);
      router.refresh();
    } catch {
      setMessage("The override could not be applied.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-ink">
          {technicianName}
          <span className="ml-2 font-normal text-muted/80">
            {position ? `#${position}` : "out of rotation"}
            {isActive ? "" : " · removed"}
          </span>
        </p>
        <button
          onClick={() => {
            setOpen((value) => !value);
            setConfirming(false);
            setMessage(null);
          }}
          className="cursor-pointer rounded-full border border-ink/15 px-3 py-1 text-[11px] font-semibold text-ink/70 transition duration-200 hover:bg-soft"
        >
          {open ? "Cancel" : "Override…"}
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          <select
            value={action}
            onChange={(event) => {
              setAction(event.target.value as OverrideAction);
              setConfirming(false);
            }}
            className="w-full rounded-lg border border-ink/15 px-3 py-1.5 text-xs"
          >
            {ACTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="text-[11px] leading-relaxed text-muted">{selected.hint}</p>

          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason (required — this is audited)"
            className="w-full rounded-lg border border-ink/15 px-3 py-1.5 text-xs"
          />

          {!confirming ? (
            <button
              onClick={() => setConfirming(true)}
              disabled={!reason.trim()}
              className="cursor-pointer rounded-full bg-alert-500 px-3 py-1.5 text-xs font-semibold text-white transition duration-200 hover:bg-alert-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Review override
            </button>
          ) : (
            <div className="rounded-lg border border-line bg-alert-soft px-3 py-2">
              <p className="flex items-start gap-1.5 text-[11px] font-semibold text-alert-ink">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Confirm: {selected.label.toLowerCase()} for {technicianName} in the {applianceType}{" "}
                queue. This is recorded against your account.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={submit}
                  disabled={busy}
                  className="cursor-pointer rounded-full bg-alert-600 px-3 py-1.5 text-xs font-semibold text-white transition duration-200 hover:bg-alert-700 disabled:opacity-50"
                >
                  {busy ? "Applying…" : "Confirm override"}
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  className="cursor-pointer rounded-full border border-ink/15 px-3 py-1.5 text-xs font-medium text-ink/70 transition duration-200 hover:bg-surface"
                >
                  Back
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {message && (
        <p className="mt-2 text-[11px] font-medium text-muted" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
