/**
 * The loading contract for the admin payments queue (`/admin/payments`).
 *
 * WHY THIS EXISTS. This is the one queue an administrator has to be able to trust:
 * a payment that is in `public.payments` but absent from the page is money nobody
 * verifies. Two independent defects produced exactly that symptom, and this module
 * closes the second one:
 *
 *   1. RENDERING. The page reads only through `createServiceRoleClient()`, which
 *      reads no cookies, so Next.js had no dynamic signal there and PRERENDERED the
 *      route at build time. The deployed page was a payments list frozen at deploy,
 *      so a later submission was in the database but never in the page. That is
 *      fixed by `dynamic = "force-dynamic"` on the page itself.
 *   2. ERROR HANDLING. Every query discarded its `error`, so a failed SELECT became
 *      `data: null`, became `data ?? []`, became "No transactions yet." — an
 *      administrator reading that cannot tell a broken query from an empty queue.
 *      `requireRows()` raises instead, and the route's own `error.tsx` renders the
 *      safe state.
 *
 * WHAT IS LOGGED, AND WHAT IS NOT. The query's name plus PostgREST's `code` and
 * `message` — the two fields that identify a failure. `details` and `hint` are
 * deliberately NOT logged: they are derived from the statement and can echo
 * predicate values and row contents back (a unique-violation `details` names the
 * key *and its value*), and this page handles GCash references and customer ids.
 * No row is ever logged, and no reference, token or credential is ever logged.
 */

/** PostgREST's failure shape. `PostgrestError` satisfies it structurally. */
export interface QueryFailure {
  message: string;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
}

/**
 * Raised when one of the payments-queue queries fails.
 *
 * It carries the query's name and the database's error code, so a log line and a
 * thrown error can be correlated, and nothing else: the message is fixed text, so
 * an error boundary can render it without echoing anything from the database.
 */
export class PaymentsQueueUnavailableError extends Error {
  /** Which query failed, e.g. `"payments"` or `"bookings"`. */
  readonly query: string;
  /** PostgREST's code, e.g. `"42501"` for a privilege refusal. `null` when absent. */
  readonly code: string | null;

  constructor(query: string, failure: QueryFailure) {
    super(`${query} could not be loaded, so the payments queue is unknown.`);
    this.name = "PaymentsQueueUnavailableError";
    this.query = query;
    this.code = failure.code ?? null;
  }
}

/** Heading for the safe error state. Fixed text — never an echoed error body. */
export const PAYMENTS_QUEUE_UNAVAILABLE_TITLE = "Payments queue could not be loaded";

/**
 * Body for the safe error state.
 *
 * It asserts the opposite of the empty state on purpose. An administrator who sees
 * this must not conclude that there is nothing to verify, because that is precisely
 * the mistake the swallowed error used to cause. The "No transactions yet." copy in
 * `AdminPaymentsClient` may only ever follow a SUCCESSFUL query.
 */
export const PAYMENTS_QUEUE_UNAVAILABLE_BODY =
  "Nothing is shown and no payment has been changed. This is a loading failure, not an empty queue — there may still be references waiting to be verified. Try again, and if it keeps failing check the server logs.";

/**
 * Turn one query result into rows, or fail loudly.
 *
 * `data ?? []` is only safe when the query SUCCEEDED. PostgREST returns `null` data
 * alongside a non-null `error` for every failure, so collapsing the two into `[]` is
 * exactly how a broken query comes to look like an empty queue — and on this page
 * that mistake means an unverified payment nobody looks at.
 */
export function requireRows<T>(
  query: string,
  data: T[] | null,
  failure: QueryFailure | null
): T[] {
  if (failure) {
    console.error(
      `[admin/payments] ${query} query failed (code ${failure.code ?? "unknown"}): ${failure.message}`
    );
    throw new PaymentsQueueUnavailableError(query, failure);
  }

  return data ?? [];
}
