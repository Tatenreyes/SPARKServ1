/**
 * Regression tests for the admin payments queue (`/admin/payments`).
 *
 *   npm run test:admin-payments
 *
 * WHY THIS EXISTS. Two independent defects made a submitted payment invisible on the
 * one page whose whole job is to show it, and both are covered here:
 *
 *   1. RENDERING. The route read only through `createServiceRoleClient()`, which reads
 *      no cookies, so Next.js had no dynamic signal and PRERENDERED the page. The
 *      deployed page was a payments list frozen at deploy: a later submission was in
 *      the database but never in the page.
 *   2. ERROR HANDLING. Every query discarded its `error`, so a failed SELECT became
 *      `data ?? []` became "No transactions yet." — a broken query that reads exactly
 *      like an empty queue.
 *
 * (1) is a route-segment fact, so it is asserted structurally against the page source.
 * (2) is a behaviour of `src/lib/payments-queue.ts`, so the guard is imported and
 * exercised for real — the same way `test:auth` and `test:estimates` run the real
 * modules under Node's type stripping, so there is no second copy of the rule to
 * drift. The build is the only thing that can prove the prerender decision, so
 * `npm run build` must still report `ƒ /admin/payments`.
 *
 * NOT covered: the rendered React tree (there is no component runner in this
 * repository — see TESTING.md §4) and a real PostgREST failure.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  PAYMENTS_QUEUE_UNAVAILABLE_BODY,
  PAYMENTS_QUEUE_UNAVAILABLE_TITLE,
  PaymentsQueueUnavailableError,
  requireRows,
} from "../../src/lib/payments-queue.ts";

const ROOT = new URL("../../", import.meta.url);
const source = (path) => readFileSync(new URL(path, ROOT), "utf8");

const PAGE = "src/app/admin/payments/page.tsx";
const BOUNDARY = "src/app/admin/payments/error.tsx";
const CLIENT = "src/components/AdminPaymentsClient.tsx";

const page = source(PAGE);

// ------------------------------------------- 1. never a snapshot frozen at deploy

test("the payments page declares its own dynamic rendering", () => {
  assert.match(
    page,
    /^export const dynamic = "force-dynamic";$/m,
    `${PAGE} must export \`dynamic = "force-dynamic"\`; without it Next.js prerenders ` +
      `the route and a submitted payment never appears`
  );
});

test("the segment config is a top-level export, not nested in the component", () => {
  const config = page.search(/^export const dynamic = "force-dynamic";$/m);
  const component = page.indexOf("export default async function AdminPaymentsPage");

  assert.ok(component !== -1, `${PAGE} must still default-export the page`);
  assert.ok(config !== -1 && config < component, "the segment config must sit above the component");
  // A `dynamic` export inside the function body is not read by Next.js, so the
  // guarantee has to be at module scope.
  assert.doesNotMatch(page.slice(component), /export const dynamic/);
});

// ------------------------------------------- 2. no query result is read unguarded

test("all four queries go through the guard", () => {
  // Count real calls, not the comment above them: `requireRows("` only appears where
  // a query's result is actually handed to the guard.
  const guarded = [...page.matchAll(/requireRows\("/g)].length;
  assert.equal(
    guarded,
    4,
    "payments, customer names, bookings and appliance types must each be guarded by requireRows()"
  );

  for (const label of ["payments", "customer names", "bookings", "appliance types"]) {
    assert.ok(page.includes(`requireRows("${label}"`), `the ${label} query must be guarded`);
  }
});

test("no query result is destructured into a bare `data`", () => {
  // The old shape, `const { data: payments } = await supabase...`, drops `error`
  // entirely — which is how a failure became an empty array.
  assert.doesNotMatch(page, /const\s*\{\s*data\s*:/);
  assert.doesNotMatch(page, /\bdata\s*\?\?\s*\[\]/);
  assert.doesNotMatch(page, /Result\.data\s*\?\?/);
});

// ------------------------------------------- 3. a failure is never an empty queue

test("a failed query throws instead of returning an empty queue", () => {
  assert.throws(
    () =>
      requireRows("payments", null, {
        code: "42501",
        message: "permission denied for table payments",
      }),
    PaymentsQueueUnavailableError,
    "a query error must never be returned as rows"
  );

  // Even when PostgREST hands back `[]` alongside an error, it must not be returned.
  assert.throws(() => requireRows("payments", [], { message: "boom" }));
});

test("a successful query still yields an empty queue when there really are no rows", () => {
  assert.deepEqual(requireRows("payments", [], null), []);
  assert.deepEqual(requireRows("payments", null, null), []);
});

test("the rows of a successful query are returned unchanged", () => {
  const rows = [{ id: "p1" }, { id: "p2" }];
  assert.equal(requireRows("payments", rows, null), rows);
});

test("the raised error names the query and the code, and carries no database text", () => {
  let thrown;
  try {
    requireRows("bookings", null, {
      code: "42P01",
      message: 'relation "bookings" does not exist',
    });
  } catch (err) {
    thrown = err;
  }

  assert.ok(thrown instanceof PaymentsQueueUnavailableError);
  assert.equal(thrown.query, "bookings");
  assert.equal(thrown.code, "42P01");
  assert.match(thrown.message, /bookings/);
  assert.doesNotMatch(
    thrown.message,
    /does not exist/,
    "the message must be fixed text, not an echoed error body"
  );
});

test("a failure with no code still raises, and reports a null code", () => {
  let thrown;
  try {
    requireRows("payments", null, { message: "network" });
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof PaymentsQueueUnavailableError);
  assert.equal(thrown.code, null);
});

// ------------------------------------------- 4. the log is useful, and safe

/** Run `fn` with `console.error` captured, and return every line it wrote. */
function captureLog(fn) {
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  try {
    fn();
  } finally {
    console.error = original;
  }
  return logged;
}

test("the server log names the query and the code", () => {
  const logged = captureLog(() => {
    assert.throws(() =>
      requireRows("payments", null, {
        code: "42501",
        message: "permission denied for table payments",
      })
    );
  });

  assert.equal(logged.length, 1, "exactly one diagnostic line per failure");
  assert.match(logged[0], /\[admin\/payments\]/);
  assert.match(logged[0], /payments/);
  assert.match(logged[0], /42501/);
  assert.match(logged[0], /permission denied/);
});

test("the server log never echoes `details` or `hint`", () => {
  // PostgREST derives both from the statement, so they can carry a predicate value
  // or a row value back: a unique-violation `details` names the key AND its value,
  // and this table holds GCash references.
  const logged = captureLog(() => {
    assert.throws(() =>
      requireRows("payments", null, {
        code: "23505",
        message: "duplicate key value violates unique constraint",
        details: "Key (gcash_reference)=(09171234567) already exists.",
        hint: "GRANT SELECT ON public.payments TO anon;",
      })
    );
  });

  assert.equal(logged.length, 1);
  assert.doesNotMatch(logged[0], /gcash/i);
  assert.doesNotMatch(logged[0], /09171234567/);
  assert.doesNotMatch(logged[0], /GRANT/i);
});

test("no success path writes a log line", () => {
  const logged = captureLog(() => {
    requireRows("payments", [{ id: "p1" }], null);
  });
  assert.deepEqual(logged, []);
});

// ------------------------------------------- 5. the safe error state

test("the route ships its own error boundary", () => {
  const boundary = source(BOUNDARY);
  assert.match(boundary, /^"use client";/m, "a Next.js error boundary must be a client component");
  assert.match(boundary, /reset/, "it must offer a retry");
  assert.match(
    boundary,
    /PAYMENTS_QUEUE_UNAVAILABLE_(TITLE|BODY)/,
    "it must render the shared copy, not its own"
  );
  assert.doesNotMatch(boundary, /No transactions yet\./);
});

test("the safe error state never claims the queue is empty", () => {
  const body = PAYMENTS_QUEUE_UNAVAILABLE_BODY.toLowerCase();
  assert.match(body, /not an empty queue/);
  assert.doesNotMatch(body, /no transactions/);
  assert.ok(PAYMENTS_QUEUE_UNAVAILABLE_TITLE.trim().length > 0);
});

test("a refused decision refreshes the row instead of leaving a stale pending row", () => {
  const client = source(CLIENT);
  const refusal = client.slice(client.indexOf("if (!res.ok)"), client.indexOf("if (json.data)"));

  assert.ok(refusal.length > 0, "the client must still handle a refused decision");
  assert.match(
    refusal,
    /router\.refresh\(\)/,
    "a 409 (the database already decided) must refresh the row, or the page keeps " +
      "offering Confirm for a payment that is already processed"
  );
});

test("the empty state is fed only by the guarded rows, and the client fetches nothing", () => {
  const client = source(CLIENT);
  assert.match(client, /No transactions yet\./, "the empty state lives in the client");
  assert.match(client, /initialPayments/);
  // A second, unguarded data path in the client would reintroduce exactly the
  // silent-empty failure this file exists to prevent.
  assert.doesNotMatch(client, /createServiceRoleClient|createClient\(/);
  assert.doesNotMatch(client, /from\("payments"\)/);
});

