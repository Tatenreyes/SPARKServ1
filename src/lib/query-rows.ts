/**
 * The loading contract for the admin listing pages.
 *
 * WHY THIS EXISTS. `data ?? []` is only safe when the query SUCCEEDED. PostgREST
 * returns `null` data alongside a non-null `error` for every failure, so
 * collapsing the two into `[]` turns a broken read into an empty list — an
 * administrator cannot tell "nothing is wrong" from "we could not read it".
 * `/admin/payments` was fixed for exactly this (`src/lib/payments-queue.ts`, which
 * keeps its own copy of the guard because its error copy and log prefix are
 * route-specific); `/admin/bookings`, `/admin/job-monitoring` and
 * `/admin/progress` still discarded their errors and rendered "No bookings yet."
 *
 * WHAT IS LOGGED, AND WHAT IS NOT. The query's name plus PostgREST's `code` and
 * `message` — the two fields that identify a failure. `details` and `hint` are
 * deliberately NOT logged: they are derived from the statement and can echo
 * predicate values and row contents back.
 */
export interface QueryFailure {
  message: string;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
}

/**
 * Raised when a listing query fails.
 *
 * It carries the query's name and the database's error code, and nothing else:
 * the message is fixed text, so an error boundary can render it without echoing
 * anything from the database.
 */
export class QueryUnavailableError extends Error {
  /** Which query failed, e.g. `"bookings"` or `"customer names"`. */
  readonly query: string;
  /** PostgREST's code, e.g. `"42501"` for a privilege refusal. `null` when absent. */
  readonly code: string | null;

  constructor(query: string, failure: QueryFailure) {
    super(`${query} could not be loaded.`);
    this.name = "QueryUnavailableError";
    this.query = query;
    this.code = failure.code ?? null;
  }
}

/**
 * Turn one query result into rows, or fail loudly.
 *
 * Pass `data` for a row query, or `null` when only the `error` and a separate
 * `count` are of interest — the guard's job is to refuse a failure either way.
 */
export function requireRows<T>(
  query: string,
  data: T[] | null,
  failure: QueryFailure | null
): T[] {
  if (failure) {
    console.error(
      `[admin] ${query} query failed (code ${failure.code ?? "unknown"}): ${failure.message}`
    );
    throw new QueryUnavailableError(query, failure);
  }

  return data ?? [];
}
