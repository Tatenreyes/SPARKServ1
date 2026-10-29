import type { OperationalStatus, TechnicianQueueSnapshotRow } from "@/types/database";

/**
 * Client-safe queue vocabulary and view helpers.
 *
 * Everything here is presentation only: the authoritative queue decision
 * (position, eligibility, availability, capacity) is made in Postgres — see
 * `src/lib/assignment.ts` and QUEUE-SYSTEM.md. Nothing in this file may be used
 * to decide who gets work.
 */

/**
 * Canonical appliance slug. Mirrors public.normalize_appliance_type() in
 * supabase/migration_queue_redesign.sql, so a client that compares a request's
 * `appliance_type` with a technician's `specializations` ("Air Conditioner" vs
 * "aircon") gets the same answer the queue engine does.
 */
const APPLIANCE_ALIASES: Record<string, string> = {
  refrigerator: "refrigerator",
  fridge: "refrigerator",
  aircon: "aircon",
  air_conditioner: "aircon",
  air_conditioning: "aircon",
  "air conditioner": "aircon",
  ac: "aircon",
  washing_machine: "washing_machine",
  "washing machine": "washing_machine",
  washer: "washing_machine",
  clothes_dryer: "clothes_dryer",
  "clothes dryer": "clothes_dryer",
  dryer: "clothes_dryer",
  tv: "tv",
  television: "tv",
  electric_fan: "electric_fan",
  "electric fan": "electric_fan",
  fan: "electric_fan",
  microwave: "microwave",
  microwave_oven: "microwave",
  "microwave oven": "microwave",
  rice_cooker: "rice_cooker",
  "rice cooker": "rice_cooker",
  electric_stove: "electric_stove",
  "electric stove": "electric_stove",
  stove: "electric_stove",
  induction_cooker: "induction_cooker",
  "induction cooker": "induction_cooker",
  water_dispenser: "water_dispenser",
  "water dispenser": "water_dispenser",
  electric_kettle: "electric_kettle",
  "electric kettle": "electric_kettle",
  kettle: "electric_kettle",
  vacuum_cleaner: "vacuum_cleaner",
  "vacuum cleaner": "vacuum_cleaner",
  vacuum: "vacuum_cleaner",
  water_heater: "water_heater",
  "water heater": "water_heater",
  heater: "water_heater",
};

export function normalizeApplianceType(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  return APPLIANCE_ALIASES[trimmed] ?? trimmed.replace(/[\s-]+/g, "_");
}

export function applianceTypesMatch(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const left = normalizeApplianceType(a);
  const right = normalizeApplianceType(b);
  return Boolean(left && right && left === right);
}

/** Human label for an appliance slug ("washing_machine" -> "Washing machine"). */
export function applianceLabel(applianceType: string): string {
  const words = applianceType.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Operational status is NOT availability for a specific job: SCHEDULED means
 * "has a future appointment", and says nothing about whether they could take a
 * different slot. See QUEUE-SYSTEM.md.
 */
export const OPERATIONAL_STATUS_META: Record<
  OperationalStatus,
  { label: string; tone: "success" | "warn" | "info" | "neutral" | "danger"; hint: string }
> = {
  AVAILABLE: {
    label: "Available",
    tone: "success",
    hint: "No active job and nothing booked right now.",
  },
  ON_JOB: {
    label: "On job",
    tone: "info",
    hint: "Currently on site; they can still be offered later appointments.",
  },
  SCHEDULED: {
    label: "Scheduled",
    tone: "warn",
    hint: "Has a future appointment. Still in the queue — only a real clash skips them.",
  },
  TEMPORARILY_UNAVAILABLE: {
    label: "Unavailable",
    tone: "neutral",
    hint: "Marked unavailable, or on approved time off.",
  },
  OFFLINE: {
    label: "Offline",
    tone: "neutral",
    hint: "Account is inactive.",
  },
  SUSPENDED: {
    label: "Suspended",
    tone: "danger",
    hint: "Not eligible for offers.",
  },
};

export function operationalStatusMeta(status: OperationalStatus | string) {
  return (
    OPERATIONAL_STATUS_META[status as OperationalStatus] ?? {
      label: String(status).replace(/_/g, " "),
      tone: "neutral" as const,
      hint: "",
    }
  );
}

/** "Today, 3:00 PM" / "Jan 30, 9:00 AM" / "—" */
export function formatQueueTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfDate = new Date(date);
  startOfDate.setHours(0, 0, 0, 0);

  const dayDiff = Math.round((startOfDate.getTime() - startOfToday.getTime()) / 86_400_000);
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (dayDiff === 0) return `Today, ${time}`;
  if (dayDiff === 1) return `Tomorrow, ${time}`;
  return `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${time}`;
}

/** One row of the queue table, as the technician/admin screens render it. */
export type QueueEntry = {
  technicianId: string;
  name: string;
  /** Queue rank within the appliance queue (#1 = next turn). Null when removed. */
  position: number | null;
  operationalStatus: OperationalStatus;
  statusLabel: string;
  isSelf: boolean;
  isMemberActive: boolean;
  isNextInQueue: boolean;
  queueStatus: TechnicianQueueSnapshotRow["queue_status"];
  nextBookingAt: string | null;
  currentJobUntil: string | null;
  activeOfferRequestId: string | null;
  offersExpiresAt: string | null;
};

export type ApplianceQueue = {
  applianceType: string;
  label: string;
  entries: QueueEntry[];
  /** The signed-in technician's rank in this queue, if they are in it. */
  myPosition: number | null;
  myStatus: OperationalStatus | null;
  myEntry: QueueEntry | null;
  /** The rank that will be offered the next compatible request. */
  nextTurnPosition: number | null;
  activeTechnicianCount: number;
};

/**
 * Groups snapshot rows into per-appliance queues, ordered exactly as the engine
 * orders them (position ascending, removed members last).
 */
export function buildApplianceQueues(rows: TechnicianQueueSnapshotRow[]): ApplianceQueue[] {
  const byType = new Map<string, TechnicianQueueSnapshotRow[]>();

  for (const row of rows) {
    const list = byType.get(row.appliance_type) ?? [];
    list.push(row);
    byType.set(row.appliance_type, list);
  }

  return Array.from(byType.entries())
    .map(([applianceType, group]) => {
      const entries: QueueEntry[] = [...group]
        .sort((a, b) => {
          if (a.is_member_active !== b.is_member_active) return a.is_member_active ? -1 : 1;
          return (
            (a.queue_position ?? Number.MAX_SAFE_INTEGER) -
            (b.queue_position ?? Number.MAX_SAFE_INTEGER)
          );
        })
        .map((row) => ({
          technicianId: row.technician_id,
          name: row.technician_name,
          position: row.queue_position,
          operationalStatus: row.operational_status,
          statusLabel: operationalStatusMeta(row.operational_status).label,
          isSelf: row.is_self,
          isMemberActive: row.is_member_active,
          isNextInQueue: row.is_next_in_queue,
          queueStatus: row.queue_status,
          nextBookingAt: row.next_booking_at,
          currentJobUntil: row.current_job_until,
          activeOfferRequestId: row.active_offer_request_id,
          offersExpiresAt: row.offers_expires_at,
        }));

      const active = entries.filter((entry) => entry.isMemberActive);
      const mine = entries.find((entry) => entry.isSelf) ?? null;

      return {
        applianceType,
        label: applianceLabel(applianceType),
        entries,
        myPosition: mine?.isMemberActive ? mine.position : null,
        myStatus: mine?.operationalStatus ?? null,
        myEntry: mine,
        nextTurnPosition: active.length ? (active[0].position ?? 1) : null,
        activeTechnicianCount: active.length,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The sentence a technician should read instead of "you're next in line, so
 * you're getting the next job" — position is fairness, not a job guarantee.
 */
export function myQueueStanding(queue: ApplianceQueue): string {
  if (queue.myPosition === null) {
    return "You are not part of this rotation right now. Add the appliance to your specializations to join it.";
  }
  if (queue.myPosition === 1) {
    return "Your turn is next when you are eligible and available for a matching request — you can still be skipped if the requested time clashes with your schedule or exceeds your workload.";
  }
  if (queue.myPosition === 2) {
    return "Your turn is approaching: you move up when the technician ahead of you accepts a request.";
  }
  return "You keep this position until you accept a request — accepting consumes your turn and moves you to the end of the rotation.";
}

/**
 * What the caller knows about coverage for the request's appliance type.
 *
 * `false` means the database has CONFIRMED that no technician currently qualifies
 * (`appliance_has_qualified_technician()`); `true` means at least one does; absent or
 * `null` means the caller does not know and must not guess.
 */
export interface AssignmentCoverage {
  qualifiedTechnicianAvailable?: boolean | null;
}

/** Customer-facing wording for an assignment state. Never exposes the queue. */
export function customerAssignmentCopy(
  assignmentStatus: string,
  coverage?: AssignmentCoverage
) {
  switch (assignmentStatus) {
    case "matching":
      return {
        title: "Checking technician availability",
        body: "We are looking for a qualified technician who can cover the time you asked for.",
      };
    case "offered":
      return {
        title: "Waiting for a technician to respond",
        body: "A qualified technician is reviewing your request. If they do not respond in time we pass it to the next one automatically.",
      };
    case "waiting": {
      // "Nobody covers this appliance yet" and "everybody is busy right now" are
      // different promises, and only one of them is worth waiting for. The caller
      // knows which one it is only when the API asked the database, so the wording
      // branches on that answer and never guesses.
      if (coverage?.qualifiedTechnicianAvailable === false) {
        return {
          title: "No technician covers this appliance yet",
          body: "Your request is saved, but no approved technician services this appliance type at the moment, so it cannot be matched yet. Please contact support — we will tell you as soon as somebody can take it. There is nothing to wait for on this page.",
        };
      }

      // Deliberately does NOT claim a cause. This state is reached TWO ways: every
      // qualified technician is booked or at capacity for the slot, OR no approved
      // technician covers the appliance type at all. A technician who is not approved
      // never enters the rotation — `technician_eligibility_failure()` answers
      // `not_available` for them, and `not_in_queue` when they have no ACTIVE row in
      // `technician_queue_state` — so a request for an appliance nobody approved
      // covers sits here for ever. When the caller does not know which case this is,
      // "every qualified technician is booked" is a false reassurance.
      return {
        title: "Waiting for an eligible technician",
        body: "We have not matched a qualified technician to this request yet. It stays in line, and we will match you as soon as one becomes available for this appliance and the time you asked for — so you can leave this page. If it is urgent, contact support and we will follow it up.",
      };
    }
    case "accepted":
      return {
        title: "Technician accepted your request",
        body: "Your technician will send an estimate next, and you will pick the final appointment time.",
      };
    default:
      return { title: "Request received", body: "We will keep you posted here." };
  }
}
