"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, CheckCircle2, Clock, TimerIcon } from "lucide-react";
import type { AssignmentStatus } from "@/types/database";
import { customerAssignmentCopy } from "@/lib/queue";

interface AssignedTechnicianInfo {
  id: string;
  name: string;
}

export default function AssignmentStatusCard({
  status,
  applianceType,
  technician,
  offersExpiresAt,
  qualifiedTechnicianAvailable = null,
  onBackToAppliances,
}: {
  status: AssignmentStatus;
  applianceType: string;
  technician: AssignedTechnicianInfo | null;
  offersExpiresAt?: string | null;
  /**
   * Whether ANY technician covers this appliance, when the caller knows. `false` turns
   * the `waiting` card from "you are in the queue" into "nobody services this yet" —
   * the two look identical otherwise, and only one of them is worth waiting for.
   * `null` (the default) means the caller does not know and the neutral wording is used.
   */
  qualifiedTechnicianAvailable?: boolean | null;
  onBackToAppliances?: () => void;
}) {
  // Customers get states, never positions (spec §13, §31). The wording lives in
  // one place — `customerAssignmentCopy` — so this card, the request page and the
  // tracking view can't drift apart; "matching", "offered" and "waiting" are
  // genuinely different waits and used to look identical.
  if (status === "matching" || status === "offered" || status === "waiting") {
    // "Nobody covers this appliance" is not a queue position, it is a dead end, so it
    // is the one `waiting` variant that gets a warning tone instead of the calm one.
    const nobodyCoversIt = status === "waiting" && qualifiedTechnicianAvailable === false;
    const copy = customerAssignmentCopy(status, { qualifiedTechnicianAvailable });
    const shell = nobodyCoversIt
      ? "rounded-card border border-warn-ink/30 bg-warn-soft p-6"
      : status === "waiting"
        ? "rounded-card border border-spark-400/30 bg-brand-soft p-6"
        : status === "offered"
          ? "rounded-card border border-line bg-brand-soft/60 p-8"
          : "rounded-card border border-ink/8 bg-surface p-8";
    const Icon = nobodyCoversIt ? AlertTriangle : status === "waiting" ? Clock : Loader2;

    return (
      <div className={`flex flex-col items-center gap-3 text-center ${shell}`}>
        <Icon
          className={`h-6 w-6 ${
            status === "matching" || status === "offered"
              ? "animate-spin text-brand-ink"
              : nobodyCoversIt
                ? "text-warn-ink"
                : "text-brand-ink"
          }`}
        />
        <p className="font-medium text-ink">{copy.title}</p>
        <p className="text-sm text-muted">{copy.body}</p>
        <p className="rounded-full bg-surface/70 px-3 py-1 text-[11px] font-semibold capitalize text-muted">
          {applianceType.replace(/_/g, " ")}
        </p>
        {status === "offered" && offersExpiresAt && <OfferCountdown expiresAt={offersExpiresAt} />}
        {status === "waiting" && onBackToAppliances && (
          <button
            onClick={onBackToAppliances}
            className="mt-1 cursor-pointer rounded-full border border-ink/15 px-4 py-2 text-sm font-medium text-ink/70 transition-colors hover:bg-surface"
          >
            Back to appliance selection
          </button>
        )}
      </div>
    );
  }

  // accepted — the only state in which a technician is disclosed, and only the
  // profile fields we publish (`AssignedTechnicianInfo`).
  if (technician) {
    return (
      <div className="rounded-card border border-signal-500/20 bg-signal-soft/40 p-5">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-signal-ink">
          <CheckCircle2 className="h-3.5 w-3.5" /> Technician assigned
        </p>
        <p className="mt-2 font-display text-lg font-semibold text-ink">{technician.name}</p>
        <p className="mt-1 text-sm text-muted">{customerAssignmentCopy("accepted").body}</p>
      </div>
    );
  }

  return null;
}

/**
 * Live countdown to when the current offer lapses. Gives the customer a
 * concrete reason to believe the system is working rather than stalled.
 */
function OfferCountdown({ expiresAt }: { expiresAt: string }) {
  const [remainingMs, setRemainingMs] = useState(
    () => new Date(expiresAt).getTime() - Date.now()
  );

  // Tick once a second so the customer sees progress instead of a static
  // number that looks frozen.
  useEffect(() => {
    setRemainingMs(new Date(expiresAt).getTime() - Date.now());
    const interval = setInterval(() => {
      setRemainingMs(new Date(expiresAt).getTime() - Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  if (remainingMs <= 0) return null;

  const minutes = Math.floor(remainingMs / 60_000);
  const seconds = Math.floor((remainingMs % 60_000) / 1000);
  const label = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

  return (
    <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-xs font-semibold text-brand-ink">
      <TimerIcon className="h-3.5 w-3.5" />
      Re-offering in {label}
    </p>
  );
}
