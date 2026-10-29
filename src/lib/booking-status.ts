import type { BookingStatus } from "@/types/database";

/**
 * The statuses in which a booking is still LIVE work — one definition, shared.
 *
 * "Active" is a decision, not a query: a repair that finished physically is not
 * finished as a transaction. It still needs the customer's payment reference and
 * an administrator's verification, so it stays active until the payment is
 * verified rather than dropping out of the monitor.
 *
 * This module exists because that decision had three copies: `/admin/dashboard`
 * (all four statuses), `/admin/job-monitoring` (all four, inline) and
 * `/admin/progress` (only `pending` + `in_progress`). The first two agreed, the
 * third did not, so the same tile label — "Active Jobs" — showed two different
 * numbers on two pages of the same workspace. A status list is exactly the kind
 * of thing that drifts when it is copied, so it lives here once.
 *
 * Deliberately NOT the same question as "does this booking hold a technician
 * slot" — that predicate is `booking_status_holds_slot()` in the database
 * (step 18) and names the same four statuses for a different reason. If either
 * set changes, check the other.
 */
export const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
  "pending",
  "in_progress",
  "awaiting_inspection",
  "awaiting_payment",
];

/** True when a booking is still live work (see {@link ACTIVE_BOOKING_STATUSES}). */
export function isActiveBookingStatus(status: string): boolean {
  return (ACTIVE_BOOKING_STATUSES as string[]).includes(status);
}
