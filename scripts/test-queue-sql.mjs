/**
 * SPARKServ queue integration test.
 *
 * Loads the real schema + migration files into an in-process Postgres (PGlite,
 * WASM) and then runs the queue-fairness scenario from the redesign spec
 * (sections 8-11, 15, 17-28, 32-33, 36, 38) against it, asserting every
 * expectation.
 *
 *   npm run test:queue-sql
 *
 * Why this exists: the queue redesign is ~1900 lines of PL/pgSQL with row
 * locks, an advisory lock, triggers and interval/capacity maths. Reading it is
 * not evidence that it runs. This harness is repeatable, offline and cannot
 * touch the live project. The companion `scripts/verify-queue-fairness.mjs`
 * proves the same scenario against the real Supabase project.
 *
 * Caveat: PGlite is Postgres compiled to WASM with `auth.uid()`/roles stubbed
 * (see scripts/sql-harness.sql). A green run means the SQL and the fairness
 * rules are sound — not that production is verified.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";

const repo = process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(repo, p), "utf8");

const db = new PGlite({ extensions: { uuid_ossp } });

let failures = 0;
const results = [];


function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n        ${detail}`}`);
}

async function exec(label, sql) {
  try {
    await db.exec(sql);
    console.log(`  loaded ${label}`);
  } catch (err) {
    console.log(`  FAILED loading ${label}: ${err.message}`);
    throw err;
  }
}

async function query(sql, params) {
  const res = await db.query(sql, params);
  return res.rows;
}

/** Impersonate a signed-in user the way PostgREST does. */
async function asUser(userId, role, fn) {
  await db.exec(`set role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role;");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

async function queueOrder(applianceType = "refrigerator") {
  const rows = await query(
    `select qs.queue_position, qs.technician_id, u.name, qs.is_active
       from public.technician_queue_state qs
       join public.users u on u.id = qs.technician_id
      where qs.appliance_type = $1
      order by qs.queue_position`,
    [applianceType]
  );
  return rows;
}

const orderNames = (rows) => rows.filter((r) => r.is_active).map((r) => r.name).join(" -> ");
const positions = (rows) => JSON.stringify(rows.map((r) => [r.technician_id, r.queue_position]));

/**
 * supabase/schema.sql uses public.is_admin() in its very first policy (the
 * appliances policy) but only defines it ~180 lines later, so the file is not a
 * standalone fresh install — it assumes the helper functions already exist from
 * an earlier release (its own comment at the helper block says as much).
 *
 * Rather than paste those definitions here (two sources of truth that drift),
 * the real block is extracted from schema.sql and executed before the first
 * policy that needs it. Only current_role()/is_admin() are extracted: the third
 * helper (technician_linked_to_request) queries tables that do not exist yet,
 * and SQL function bodies are resolved at CREATE time.
 */
function extractHelperFunctions(sql) {
  const start = sql.indexOf("create or replace function public.current_role()");
  const end = sql.indexOf("-- Helper: does the calling technician have a link", start);
  if (start === -1 || end === -1) {
    throw new Error("could not locate the current_role()/is_admin() block in supabase/schema.sql");
  }
  return sql.slice(start, end);
}

/** First policy in schema.sql — everything before it is enums/tables/indexes. */
function firstPolicyIndex(sql) {
  const index = sql.indexOf('create policy "customer manages own appliances"');
  if (index === -1) throw new Error("could not locate the first policy in supabase/schema.sql");
  return index;
}

const schemaSql = read("supabase/schema.sql");
const firstPolicy = firstPolicyIndex(schemaSql);

console.log("== 1. Loading schema and migrations ==");
await exec("scripts/sql-harness.sql (Supabase stubs)", read("scripts/sql-harness.sql"));
await exec("supabase/schema.sql (extensions, enums, tables, indexes)", schemaSql.slice(0, firstPolicy));
await exec("supabase/schema.sql helper functions (pre-created)", extractHelperFunctions(schemaSql));
await exec("supabase/schema.sql (policies onward)", schemaSql.slice(firstPolicy));
// NOTE: supabase/migration_technician_queue.sql is deliberately NOT loaded — it
// is the historical, standalone version of the queue tables that schema.sql now
// contains inline, so running both would collide ("technician_queue_state
// already exists"). A fresh install (this harness) and the live upgrade path
// (that migration, then migration_queue_redesign.sql) must both end in the same
// shape, which is exactly what migration_queue_redesign.sql's guards guarantee.
await exec("supabase/migration_sync_live_schema.sql", read("supabase/migration_sync_live_schema.sql"));
await exec("supabase/migration_flow_hardening.sql", read("supabase/migration_flow_hardening.sql"));
await exec("supabase/migration_queue_redesign.sql", read("supabase/migration_queue_redesign.sql"));
// Service location: coordinate constraints, the tightened technician SELECT
// policy and technician_pending_offers().
await exec("supabase/migration_service_location.sql", read("supabase/migration_service_location.sql"));
// Troubleshooting: the identified issue and the customer-reported outcome.
await exec("supabase/migration_troubleshooting.sql", read("supabase/migration_troubleshooting.sql"));
// Offer lifecycle: cancellation releases a live offer, a closed request can
// never be accepted or re-offered, and a lapsed offer cannot freeze the rotation.
await exec("supabase/migration_offer_lifecycle.sql", read("supabase/migration_offer_lifecycle.sql"));
// Estimate workflow, in the two steps the live project needs: the status
// vocabulary FIRST (PostgreSQL refuses to use an enum value in the same
// transaction that adds it — exactly the trap a single combined file would hit),
// then the workflow that references those values.
await exec("supabase/migration_estimate_status.sql", read("supabase/migration_estimate_status.sql"));
await exec("supabase/migration_estimate_workflow.sql", read("supabase/migration_estimate_workflow.sql"));
// Batch 1 (RLS workflow enforcement). The enum value must be committed before the
// file that uses it in a policy predicate, exactly as the estimate pair does.
await exec("supabase/migration_booking_payment_status.sql", read("supabase/migration_booking_payment_status.sql"));
await exec("supabase/migration_rls_workflow_enforcement.sql", read("supabase/migration_rls_workflow_enforcement.sql"));
// Batch 2: the atomic booking path, one live booking per request, and the
// no-overlap guard. Loaded after Batch 1 because it drops the INSERT policies that
// Batch 1 tightened and replaces the direct-insert path entirely.
await exec("supabase/migration_atomic_booking.sql", read("supabase/migration_atomic_booking.sql"));
// Batch 3: payment rejection becomes a database decision (reject_payment), with
// its own metadata columns, a decision trigger and the recreated submission
// policy. Loaded after Batch 1 because it extends the payment rules that file
// installed.
await exec("supabase/migration_reject_payment.sql", read("supabase/migration_reject_payment.sql"));
// Step 17: the booking eligibility invariant. Loaded last because it replaces
// `technician_eligibility_failure()` (created by migration_queue_redesign.sql) and
// `create_booking_atomic()` (created by Batch 2), and because the migration registry
// gives it the highest order.
await exec("supabase/migration_booking_eligibility.sql", read("supabase/migration_booking_eligibility.sql"));
// Re-running must be a no-op (idempotence).
await exec("supabase/migration_queue_redesign.sql (2nd run)", read("supabase/migration_queue_redesign.sql"));
await exec("supabase/migration_service_location.sql (2nd run)", read("supabase/migration_service_location.sql"));
await exec("supabase/migration_troubleshooting.sql (2nd run)", read("supabase/migration_troubleshooting.sql"));
await exec("supabase/migration_offer_lifecycle.sql (2nd run)", read("supabase/migration_offer_lifecycle.sql"));
await exec("supabase/migration_estimate_status.sql (2nd run)", read("supabase/migration_estimate_status.sql"));
await exec("supabase/migration_estimate_workflow.sql (2nd run)", read("supabase/migration_estimate_workflow.sql"));
// Batch 1 re-run: the enforcement file must be idempotent (policies dropped before
// they are recreated, functions replaced), and the enum add is `if not exists`.
await exec("supabase/migration_booking_payment_status.sql (2nd run)", read("supabase/migration_booking_payment_status.sql"));
await exec("supabase/migration_rls_workflow_enforcement.sql (2nd run)", read("supabase/migration_rls_workflow_enforcement.sql"));
await exec("supabase/migration_atomic_booking.sql (2nd run)", read("supabase/migration_atomic_booking.sql"));
// Batch 3 re-run: the columns are `if not exists`, the constraint and the policy
// are dropped before they are recreated, and both functions are replaced.
await exec("supabase/migration_reject_payment.sql (2nd run)", read("supabase/migration_reject_payment.sql"));
// Step 17 re-run: create-or-replace plus an idempotent permission block.
await exec("supabase/migration_booking_eligibility.sql (2nd run)", read("supabase/migration_booking_eligibility.sql"));
// Step 18 re-run: both functions are create-or-replace, the trigger is dropped before
// it is created, and the permission block only revokes and grants.
await exec("supabase/migration_cancel_release.sql (2nd run)", read("supabase/migration_cancel_release.sql"));

// Supabase grants table privileges to `authenticated` by default and relies on
// RLS to decide which ROWS are visible; a bare Postgres grants nothing. Without
// this stub, the location-privacy assertions in group 16 would fail with
// "permission denied for table" — which proves nothing about RLS — instead of
// demonstrating that zero rows are visible. Only the privilege production
// always has is added here.
await exec("Supabase default privilege stub (select on service_requests)", `
  grant usage on schema public to anon, authenticated, service_role;
  grant select on public.service_requests to authenticated;
  grant all on public.service_requests to service_role;
  -- Same reasoning for estimates: Supabase grants table privileges to
  -- authenticated and lets RLS decide the ROWS. Without this the estimate
  -- privacy assertions would fail with "permission denied for table" — which
  -- proves nothing about RLS — instead of showing that zero rows are visible.
  grant select, insert, update on public.estimates to authenticated;
  grant all on public.estimates to service_role;
  grant all on public.bookings to authenticated, service_role;
  -- Batch 1 exercises payments and the service_requests UPDATE policy as a real
  -- customer. Without these the assertions would fail with 42501 "permission
  -- denied for table" — which proves nothing about RLS — instead of showing that
  -- the policy refused the write.
  -- Supabase's default privileges grant ALL on a new public table to anon,
  -- authenticated and service_role (RLS decides the ROWS for the first two, and
  -- service_role is created BYPASSRLS). ALL includes TRUNCATE, REFERENCES and
  -- TRIGGER, which are separate table privileges from INSERT/UPDATE/DELETE.
  --
  -- This stub runs AFTER the migrations, so granting ALL here would undo the revoke
  -- the migration performs - and a privilege test would then pass without that revoke
  -- ever having been exercised. The real migration file is loaded once more
  -- immediately after this stub, so those assertions test the statement itself.
  grant all on public.payments to anon, authenticated, service_role;
  grant update on public.service_requests to authenticated;
`);

// The third load of Batch 3 re-applies its revoke over the Supabase-style grant above.
// That is the order a real project ends up in: the default privileges fire at
// CREATE TABLE time, before the migration runs.
await exec(
  "supabase/migration_reject_payment.sql (3rd run, after the Supabase grant stub)",
  read("supabase/migration_reject_payment.sql")
);



console.log("\n== 2. Fixtures: technicians A, B, C + a customer ==");

/**
 * Users are provisioned the way Supabase does it: insert into auth.users and
 * let schema.sql's handle_new_user() trigger create the public.users (and
 * technicians) row, then adjust the profile. Inserting public.users directly
 * collides with the trigger's row — which is itself a useful thing to know the
 * harness reproduces faithfully.
 */
async function provisionUser({ email, name, role, location = null }) {
  const authUser = (
    await query("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [
      email,
      JSON.stringify({ name, role }),
    ])
  )[0];
  await query("update public.users set name = $2, role = $3, is_active = true, location = $4 where id = $1", [
    authUser.id,
    name,
    role,
    location,
  ]);
  return authUser.id;
}

const tech = {};
const names = { A: "Technician A", B: "Technician B", C: "Technician C" };
for (const key of Object.keys(names)) {
  const id = await provisionUser({
    email: `${key.toLowerCase()}-queue-test@example.com`,
    name: names[key],
    role: "technician",
    location: "Makati",
  });
  // handle_new_user() already created the technicians row; fill it in.
  // specializations is a real text[] column: pass a JS array, not a JSON string
  // (Postgres rejects `'["Refrigerator"]'::text[]`).
  await query(
    "update public.technicians set specializations = $2, approved = true, approved_at = now() where id = $1",
    [id, ["Refrigerator"]]
  );
  tech[key] = id;
}

const customerId = await provisionUser({
  email: "customer-queue-test@example.com",
  name: "Queue Test Customer",
  role: "customer",
  location: "Makati",
});


const initialQueue = await queueOrder();
check("queue membership auto-created for all three technicians", initialQueue.length === 3, JSON.stringify(initialQueue));
check(
  "initial queue order is A -> B -> C",
  orderNames(initialQueue) === "Technician A -> Technician B -> Technician C",
  orderNames(initialQueue)
);

console.log("\n== 3. Fairness rotation (spec §22) ==");

async function createRequest(startIso, endIso, label, applianceType = "refrigerator") {
  const rows = await query(
    `insert into public.service_requests
       (customer_id, appliance_type, problem_description, status, assignment_status,
        location, requested_window_start, requested_window_end)
     values ($1,$5,$2,'open','matching','Makati',$3,$4)
     returning id`,
    [customerId, label, startIso, endIso, applianceType]
  );
  return rows[0].id;
}

async function assign(requestId) {
  const rows = await query("select public.assign_technician_to_request($1) as result", [requestId]);
  return rows[0].result;
}

async function respond(requestId, technicianId, action, reason = null) {
  const rows = await query("select public.respond_to_offer($1,$2,$3,$4) as result", [
    requestId,
    technicianId,
    action,
    reason,
  ]);
  return rows[0].result;
}

// Jan 30 request: A is first and accepts -> B -> C -> A
const jan30 = await createRequest("2030-01-30T01:00:00Z", "2030-01-30T03:00:00Z", "Refrigerator not cooling");
const jan30Offer = await assign(jan30);
check("Jan 30 request is offered to Technician A", jan30Offer.assigned_technician_id === tech.A, JSON.stringify(jan30Offer));

const jan30Accepted = await respond(jan30, tech.A, "accept");
check("Technician A accepts the Jan 30 request", jan30Accepted.outcome === "accepted", JSON.stringify(jan30Accepted));

let rows = await queueOrder();
check("after A accepts: B -> C -> A", orderNames(rows) === "Technician B -> Technician C -> Technician A", orderNames(rows));
check("A is still IN the queue (a future booking does not remove him)", rows.some((r) => r.technician_id === tech.A), orderNames(rows));
check("A's position moved to the end (#3)", rows.find((r) => r.technician_id === tech.A)?.queue_position === 3, JSON.stringify(rows));

// Jan 24 request: B is first and accepts -> C -> A -> B
const jan24 = await createRequest("2030-01-24T01:00:00Z", "2030-01-24T03:00:00Z", "Refrigerator making noise");
const jan24Offer = await assign(jan24);
check("Jan 24 request is offered to Technician B (A is #3 now)", jan24Offer.assigned_technician_id === tech.B, JSON.stringify(jan24Offer));
await respond(jan24, tech.B, "accept");
rows = await queueOrder();
check("after B accepts: C -> A -> B", orderNames(rows) === "Technician C -> Technician A -> Technician B", orderNames(rows));

// Jan 25 request: C accepts -> A -> B -> C
const jan25 = await createRequest("2030-01-25T01:00:00Z", "2030-01-25T03:00:00Z", "Refrigerator leaking");
const jan25Offer = await assign(jan25);
check("Jan 25 request is offered to Technician C", jan25Offer.assigned_technician_id === tech.C, JSON.stringify(jan25Offer));
await respond(jan25, tech.C, "accept");
rows = await queueOrder();
check("after C accepts: A -> B -> C", orderNames(rows) === "Technician A -> Technician B -> Technician C", orderNames(rows));

// Jan 26 request: A is first and free that day even though Jan 30 is booked.
const jan26 = await createRequest("2030-01-26T01:00:00Z", "2030-01-26T03:00:00Z", "Refrigerator iced up");
const jan26Offer = await assign(jan26);
check(
  "Jan 26 request reaches Technician A while he still has the Jan 30 booking (spec §24)",
  jan26Offer.assigned_technician_id === tech.A,
  JSON.stringify(jan26Offer)
);
await respond(jan26, tech.A, "accept");
rows = await queueOrder();
check("after A accepts: B -> C -> A", orderNames(rows) === "Technician B -> Technician C -> Technician A", orderNames(rows));

// Give A a real appointment on Jan 30 (the fact that this booking exists must
// not stop him from being offered other work).
await query(
  `insert into public.bookings (service_request_id, customer_id, technician_id, scheduled_at, status, duration_minutes)
   values ($1,$2,$3,'2030-01-30T01:00:00Z','pending',120)`,
  [jan30, customerId, tech.A]
);

console.log("\n== 4. Schedule conflict skips for one request only (spec §8, §9, §23) ==");

// An administrator re-balances the rotation so A is #1 again (audited override).
const adminId = await provisionUser({
  email: "admin-queue-test@example.com",
  name: "Queue Test Admin",
  role: "admin",
});


for (const key of ["B", "C"]) {
  await asUser(adminId, "authenticated", () =>
    query("select public.admin_queue_override('refrigerator', $1, 'move_to_end', 'test setup: rebalance')", [tech[key]])
  );
}
rows = await queueOrder();
check("admin override rebalances the queue to A -> B -> C", orderNames(rows) === "Technician A -> Technician B -> Technician C", orderNames(rows));

// A is booked 08:00-10:00 Manila on Jan 27 (= 00:00-02:00Z).
const jan27 = await createRequest("2030-01-27T02:00:00Z", "2030-01-27T04:00:00Z", "Seed job for A on Jan 27");
await query(
  `insert into public.bookings (service_request_id, customer_id, technician_id, scheduled_at, status, duration_minutes)
   values ($1,$2,$3,'2030-01-27T00:00:00Z','pending',120)`,
  [jan27, customerId, tech.A]
);

const beforeConflict = await queueOrder();
// 01:00-03:00Z genuinely overlaps A's 00:00-02:00Z booking (a window that merely
// *touches* it would not be a conflict, and should not be treated as one).
const overlapping = await createRequest("2030-01-27T01:00:00Z", "2030-01-27T03:00:00Z", "Overlaps A's booking");
const overlappingOffer = await assign(overlapping);
const afterConflict = await queueOrder();
check(
  "A is skipped for the overlapping request and B gets the offer",
  overlappingOffer.assigned_technician_id === tech.B,
  JSON.stringify(overlappingOffer)
);
check("A keeps his queue position (#1) after being skipped", positions(beforeConflict) === positions(afterConflict), `${positions(beforeConflict)} vs ${positions(afterConflict)}`);

const scheduleSkips = await query(
  `select technician_id, reason from public.technician_queue_events
    where repair_request_id = $1 and action = 'SKIPPED_DUE_TO_SCHEDULE'`,
  [overlapping]
);
check(
  "the skip is audited for A only, with a schedule reason",
  scheduleSkips.length === 1 && scheduleSkips[0].technician_id === tech.A,
  JSON.stringify(scheduleSkips)
);

// Same day, non-overlapping window: A must still be offered it.
const laterThatDay = await createRequest("2030-01-27T06:00:00Z", "2030-01-27T08:00:00Z", "Later the same day");
const laterOffer = await assign(laterThatDay);
check(
  "a non-overlapping window the same day still reaches A (no whole-day lockout)",
  laterOffer.assigned_technician_id === tech.A,
  JSON.stringify(laterOffer)
);

// Declining does not consume A's turn (default policy) -> A stays #1, and B is
// skipped because they are already holding a live offer for the other request.
const decline = await respond(laterThatDay, tech.A, "decline", "Already booked that morning");
check("A's decline does not consume his queue turn", decline.decline_consumed_turn === false, JSON.stringify(decline));
rows = await queueOrder();
check("A remains #1 after declining", rows[0]?.technician_id === tech.A, orderNames(rows));
check(
  "skips and declines changed nobody's queue position",
  JSON.stringify(rows.map((r) => r.technician_id)) === JSON.stringify([tech.A, tech.B, tech.C]),
  orderNames(rows)
);


const holdingOfferSkips = await query(
  `select technician_id from public.technician_queue_events
    where repair_request_id = $1 and action = 'SKIPPED_DUE_TO_ACTIVE_OFFER'`,
  [laterThatDay]
);
check(
  "B is skipped only because they hold another live offer, not removed from the queue",
  holdingOfferSkips.length >= 1 && holdingOfferSkips.some((r) => r.technician_id === tech.B),
  JSON.stringify(holdingOfferSkips)
);

const laterState = await query(
  "select assignment_status, assigned_technician_id from public.service_requests where id = $1",
  [laterThatDay]
);
check(
  "the declined request moves on to the next free technician (C)",
  laterState[0].assignment_status === "offered" && laterState[0].assigned_technician_id === tech.C,
  JSON.stringify(laterState)
);

// B declines the overlapping request. A is skipped again (still conflicted) and
// C is skipped only because C already holds a live offer — so the request WAITS
// instead of being forced onto someone who cannot take it.
const bDecline = await respond(overlapping, tech.B, "decline", "On another job");
check("B's decline re-runs the queue walk", bDecline.outcome === "declined", JSON.stringify(bDecline));

const overlappingState = await query(
  "select assignment_status, assigned_technician_id from public.service_requests where id = $1",
  [overlapping]
);
check(
  "with nobody free the request becomes WAITING_FOR_TECHNICIAN (never lost)",
  overlappingState[0].assignment_status === "waiting" && !overlappingState[0].assigned_technician_id,
  JSON.stringify(overlappingState)
);

const cHolding = await query(
  `select 1 from public.technician_queue_events
    where repair_request_id = $1 and action = 'SKIPPED_DUE_TO_ACTIVE_OFFER' and technician_id = $2`,
  [overlapping, tech.C]
);
check("C is skipped only because of the one-live-offer rule", cHolding.length === 1, JSON.stringify(cHolding));

// C accepts the other request, which frees them up; re-running assignment (what
// the cron sweep does) then places the waiting request.
await respond(laterThatDay, tech.C, "accept");
const rematch = await assign(overlapping);
check(
  "a waiting request is re-matched as soon as a technician frees up",
  rematch.assigned_technician_id === tech.C,
  JSON.stringify(rematch)
);


console.log("\n== 5. Multiple appliance queues stay independent (spec §25) ==");
await query("update public.technicians set specializations = $2 where id = $1", [
  tech.A,
  ["Refrigerator", "Washing Machine"],
]);
const fridgeQueue = await queueOrder("refrigerator");
const washerQueue = await queueOrder("washing_machine");
const airconQueue = await queueOrder("aircon");
check("A joins the washing machine queue as its own membership", washerQueue.length === 1 && washerQueue[0].technician_id === tech.A, JSON.stringify(washerQueue));
check("A keeps an independent refrigerator position", fridgeQueue.length === 3, JSON.stringify(fridgeQueue));
check("A is not eligible for a queue he does not specialize in (aircon)", airconQueue.length === 0, JSON.stringify(airconQueue));

const washerPositions = await query(
  "select appliance_type, queue_position from public.technician_queue_state where technician_id = $1 order by appliance_type",
  [tech.A]
);
check("the same technician holds different positions per appliance queue", washerPositions.length === 2, JSON.stringify(washerPositions));

console.log("\n== 6. Full queue visibility for technicians (spec §11, §26) ==");
const snapshotAsC = await asUser(tech.C, "authenticated", () =>
  query("select * from public.technician_queue_snapshot('refrigerator')")
);
check("a technician sees the WHOLE refrigerator queue, not just themselves", snapshotAsC.length === 3, `rows=${snapshotAsC.length}`);
check(
  "exactly one row is flagged as self",
  snapshotAsC.filter((r) => r.is_self).length === 1 && snapshotAsC.find((r) => r.is_self).technician_id === tech.C,
  JSON.stringify(snapshotAsC.map((r) => [r.technician_name, r.is_self]))
);
check(
  "the snapshot exposes only safe fields (no phone, address or email)",
  !("phone" in snapshotAsC[0]) && !("address" in snapshotAsC[0]) && !("email" in snapshotAsC[0]),
  Object.keys(snapshotAsC[0]).join(",")
);
check(
  "each row carries a position, an operational status and the next booking",
  snapshotAsC.every((r) => typeof r.queue_position === "number" && Boolean(r.operational_status)),
  JSON.stringify(snapshotAsC[0])
);

const allQueuesAsA = await asUser(tech.A, "authenticated", () =>
  query("select distinct appliance_type from public.technician_queue_snapshot(null)")
);
check(
  "'All my queues' returns only the queues the technician belongs to",
  allQueuesAsA.length === 2 && allQueuesAsA.every((r) => ["refrigerator", "washing_machine"].includes(r.appliance_type)),
  JSON.stringify(allQueuesAsA)
);

let customerBlocked = false;
try {
  await asUser(customerId, "authenticated", () => query("select * from public.technician_queue_snapshot(null)"));
} catch (err) {
  customerBlocked = /only technicians and administrators/.test(err.message);
}
check("a customer calling the queue snapshot is refused", customerBlocked);

// A caller with no JWT at all (a raw service-role/PostgREST call) must also be
// refused: `null not in (...)` evaluates to NULL, which is not true, so this
// guard has to test for NULL explicitly or it silently passes.
let nullRoleBlocked = false;
try {
  await query("select * from public.technician_queue_snapshot('refrigerator')");
} catch (err) {
  nullRoleBlocked = /only technicians and administrators/.test(err.message);
}
check("a caller with no JWT is refused", nullRoleBlocked);

const customerQueueRows = await asUser(customerId, "authenticated", () =>
  query("select technician_id from public.technician_queue_state limit 5")
);
check("RLS hides queue membership rows from customers", customerQueueRows.length === 0, JSON.stringify(customerQueueRows));

const techQueueRows = await asUser(tech.B, "authenticated", () =>
  query("select distinct technician_id from public.technician_queue_state")
);
check("RLS lets a technician read the whole queue table (used to be self only)", techQueueRows.length >= 3, `rows=${techQueueRows.length}`);

// A technician must not be able to move themselves. Either the statement is
// rejected outright (no UPDATE grant) or RLS filters every row — both are a
// pass; silently changing a position is a fail.
let techCannotWrite = false;
try {
  const updated = await asUser(tech.B, "authenticated", () =>
    query("update public.technician_queue_state set queue_position = 1 where technician_id = $1 returning queue_position", [
      tech.B,
    ])
  );
  techCannotWrite = updated.length === 0;
} catch (err) {
  techCannotWrite = /permission denied|row-level security/i.test(err.message);
}
check("a technician cannot write their own queue position", techCannotWrite);

let customerCannotOverride = false;
try {
  await asUser(customerId, "authenticated", () =>
    query("select public.admin_queue_override('refrigerator', $1, 'move_to_end', 'nope')", [tech.C])
  );
} catch (err) {
  customerCannotOverride = /administrator access required|permission denied/.test(err.message);
}
check("a customer cannot call the admin override", customerCannotOverride);

let customerCannotAssign = false;
try {
  await asUser(customerId, "authenticated", () => query("select public.assign_technician_to_request($1)", [jan27]));
} catch (err) {
  customerCannotAssign = /permission denied/.test(err.message);
}
check("a customer cannot run the assignment engine directly", customerCannotAssign);

console.log("\n== 7. Capacity protection, time based (spec §17) ==");
await query("update public.technicians set max_daily_hours = 4 where id = $1", [tech.A]);
const washerDay = await createRequest("2030-01-28T05:00:00Z", "2030-01-28T07:00:00Z", "Two more hours on A's 4h day");
await query("update public.service_requests set appliance_type = 'washing_machine' where id = $1", [washerDay]);
// 3 hours of work are already booked that day (13:00-16:00 Manila = 05:00-08:00Z
// start 01:00Z, 180 min) — deliberately NOT overlapping the requested window, so
// the skip can only come from the hours limit, not from a schedule conflict.
await query(
  `insert into public.bookings (service_request_id, customer_id, technician_id, scheduled_at, status, duration_minutes)
   values ($1,$2,$3,'2030-01-28T01:00:00Z','pending',180)`,
  [washerDay, customerId, tech.A]
);

const washerOffer = await assign(washerDay);
const capacitySkip = await query(
  `select reason from public.technician_queue_events
    where repair_request_id = $1 and action = 'SKIPPED_DUE_TO_CAPACITY' and technician_id = $2`,
  [washerDay, tech.A]
);
check(
  "a 2h job is refused when only 1h of the daily limit is left",
  capacitySkip.length === 1 && /maximum working hours per day/.test(capacitySkip[0].reason),
  JSON.stringify(capacitySkip)
);
check("the over-capacity request waits rather than disappearing", washerOffer.assignment_status === "waiting", JSON.stringify(washerOffer));
const washerAfterCapacity = await queueOrder("washing_machine");
check(
  "a capacity skip does not remove the technician from the queue",
  washerAfterCapacity.length === 1 && washerAfterCapacity[0].is_active === true,
  JSON.stringify(washerAfterCapacity)
);

console.log("\n== 8. Offer expiry keeps the technician in the queue (spec §10) ==");
const expiring = await createRequest("2030-02-01T03:00:00Z", "2030-02-01T05:00:00Z", "Offer that will lapse");
await query("update public.service_requests set appliance_type = 'washing_machine' where id = $1", [expiring]);
const expiringOffer = await assign(expiring);
check("the offer goes to the only washing machine technician", expiringOffer.assigned_technician_id === tech.A, JSON.stringify(expiringOffer));
await query("update public.service_requests set offers_expires_at = now() - interval '1 minute' where id = $1", [expiring]);

const expiry = await query("select public.expire_stale_offers() as result");
check("the lapsed offer is swept up", expiry[0].result.count === 1, JSON.stringify(expiry[0].result));

const expiryEvents = await query(
  "select action, reason from public.technician_queue_events where repair_request_id = $1 and action = 'EXPIRED'",
  [expiring]
);
check("an EXPIRED audit event is recorded", expiryEvents.length === 1, JSON.stringify(expiryEvents));

const washerAfterExpiry = await queueOrder("washing_machine");
check(
  "the technician who let the offer lapse is still in the queue",
  washerAfterExpiry.length === 1 && washerAfterExpiry[0].is_active === true,
  JSON.stringify(washerAfterExpiry)
);
const expiredRequestState = await query(
  "select assignment_status from public.service_requests where id = $1",
  [expiring]
);
check(
  "the request is not stranded: it falls back to waiting for the next eligible technician",
  expiredRequestState[0].assignment_status === "waiting",
  JSON.stringify(expiredRequestState)
);

console.log("\n== 9. Concurrency: one job, one accepting technician (spec §28) ==");
const raceWindow = ["2030-02-05T01:00:00Z", "2030-02-05T03:00:00Z"];
const raceRequest = await createRequest(raceWindow[0], raceWindow[1], "Race for acceptance");
const raceOffer = await assign(raceRequest);
const [first, second] = await Promise.all([
  query("select public.respond_to_offer($1,$2,'accept') as result", [raceRequest, raceOffer.assigned_technician_id]),
  query("select public.respond_to_offer($1,$2,'accept') as result", [raceRequest, raceOffer.assigned_technician_id]),
]);
const outcomes = [first[0].result.outcome, second[0].result.outcome].sort();
check("exactly one accept wins; the other is told the offer is gone", JSON.stringify(outcomes) === '["accepted","not_offered"]', JSON.stringify(outcomes));

const turnEvents = await query(
  "select count(*)::int as n from public.technician_queue_events where repair_request_id = $1 and action = 'TURN_CONSUMED'",
  [raceRequest]
);
check("the queue turn is consumed exactly once", turnEvents[0].n === 1, JSON.stringify(turnEvents));

const [, parallelTwo] = await Promise.all([
  assign(await createRequest("2030-02-06T01:00:00Z", "2030-02-06T03:00:00Z", "Parallel request 1")),
  assign(await createRequest("2030-02-06T05:00:00Z", "2030-02-06T07:00:00Z", "Parallel request 2")),
]);
const parallelOne = await query(
  "select assigned_technician_id from public.service_requests where problem_description = 'Parallel request 1'"
);
check(
  "two parallel requests are never offered to the same technician",
  parallelOne[0].assigned_technician_id !== parallelTwo.assigned_technician_id,
  JSON.stringify([parallelOne[0], parallelTwo])
);

const uniqueIndex = await query(
  "select indexname from pg_indexes where schemaname = 'public' and indexname = 'uniq_active_offer_per_technician'"
);
check("the one-live-offer-per-technician index exists (DB-level race guard)", uniqueIndex.length === 1, JSON.stringify(uniqueIndex));

console.log("\n== 10. Audit trail + no duplicates (spec §27, §33, §36) ==");
const duplicateRows = await query(
  `select technician_id, appliance_type, count(*)::int as n
     from public.technician_queue_state group by 1,2 having count(*) > 1`
);
check("no duplicate queue memberships exist", duplicateRows.length === 0, JSON.stringify(duplicateRows));

const multipleOffers = await query(
  `select assigned_technician_id, count(*)::int as n from public.service_requests
    where assignment_status = 'offered' and assigned_technician_id is not null
    group by 1 having count(*) > 1`
);
check("no technician holds two live offers", multipleOffers.length === 0, JSON.stringify(multipleOffers));

const eventKinds = await query("select distinct action from public.technician_queue_events order by action");
check("the queue history records the documented actions", eventKinds.length >= 5, JSON.stringify(eventKinds.map((e) => e.action)));

const positionAudit = await query(
  `select action, old_position, new_position, reason from public.technician_queue_events
    where old_position is distinct from new_position and action in ('MOVED_TO_END', 'TURN_CONSUMED')
    order by created_at limit 3`
);
check(
  "position changes are audited with old and new positions",
  positionAudit.length >= 1 && positionAudit.every((e) => e.new_position > e.old_position),
  JSON.stringify(positionAudit)
);

console.log("\n== 11. Completing a job does not re-rotate the queue (spec §20) ==");
const beforeCompletion = await queueOrder();
// The Jan 30 appointment created in group 3 IS this job. Completing a repair means
// transitioning its existing booking — and since Batch 2 a request cannot hold a
// second live booking anyway (uniq_active_booking_per_request), which is why this
// fixture used to insert a duplicate.
const completedBooking = (
  await query(
    "select id from public.bookings where service_request_id = $1 and status <> 'cancelled' order by created_at limit 1",
    [jan30]
  )
)[0];
check(
  "the Jan 30 booking from group 3 is still live and is the one being completed",
  Boolean(completedBooking?.id),
  JSON.stringify(completedBooking)
);
await query("update public.bookings set status = 'in_progress' where id = $1", [completedBooking.id]);
await query("update public.bookings set status = 'completed' where id = $1", [completedBooking.id]);
const afterCompletion = await queueOrder();
check(
  "completion leaves every queue position exactly as it was",
  positions(beforeCompletion) === positions(afterCompletion),
  `${orderNames(beforeCompletion)} vs ${orderNames(afterCompletion)}`
);

console.log("\n== 12. Operational status is separate from queue membership (spec §15) ==");
const statuses = await asUser(tech.B, "authenticated", () =>
  query(
    `select r.technician_name, r.operational_status, r.queue_position, r.is_member_active
       from public.technician_queue_snapshot('refrigerator') r order by r.queue_position`
  )
);
check(
  "statuses come from the documented vocabulary",
  statuses.every((s) =>
    ["AVAILABLE", "ON_JOB", "SCHEDULED", "TEMPORARILY_UNAVAILABLE", "OFFLINE", "SUSPENDED"].includes(s.operational_status)
  ),
  JSON.stringify(statuses.map((s) => s.operational_status))
);
check(
  "every technician in the queue is reported with a position and status",
  statuses.length === 3 && statuses.every((s) => typeof s.queue_position === "number" && Boolean(s.operational_status)),
  JSON.stringify(statuses)
);

console.log("\n== 13. Admin override needs a reason and is audited (spec §32, §33) ==");
let overrideNeedsReason = false;
try {
  await asUser(adminId, "authenticated", () =>
    query("select public.admin_queue_override('refrigerator', $1, 'move_to_end', '')", [tech.C])
  );
} catch (err) {
  overrideNeedsReason = /reason is required/.test(err.message);
}
check("an override without a reason is rejected", overrideNeedsReason);

const override = await asUser(adminId, "authenticated", () =>
  query(
    "select public.admin_queue_override('refrigerator', $1, 'move_to_end', 'Rebalancing after a cancellation') as result",
    [tech.C]
  )
);
check("an override with a reason succeeds", override[0].result.ok === true, JSON.stringify(override[0].result));

const overrideAudit = await query(
  "select actor_id, reason from public.technician_queue_events where action = 'ADMIN_OVERRIDE' order by created_at desc limit 1"
);
check(
  "the override is audited with actor and reason",
  overrideAudit[0].actor_id === adminId && /Rebalancing/.test(overrideAudit[0].reason),
  JSON.stringify(overrideAudit)
);

console.log("\n== 14. Cancelling or rescheduling never grants a new turn (spec §18, §19) ==");
const beforeChanges = await queueOrder();
await query("update public.bookings set scheduled_at = '2030-03-01T01:00:00Z' where id = $1", [completedBooking.id]);
const afterReschedule = await queueOrder();
check(
  "rescheduling an appointment does not change queue positions",
  positions(beforeChanges) === positions(afterReschedule),
  `${orderNames(beforeChanges)} vs ${orderNames(afterReschedule)}`
);

await query("update public.bookings set status = 'cancelled' where service_request_id = $1", [jan27]);
const afterCancellation = await queueOrder();
check(
  "cancelling an appointment does not send the technician back to the front",
  positions(afterReschedule) === positions(afterCancellation),
  `${orderNames(afterReschedule)} vs ${orderNames(afterCancellation)}`
);

console.log("\n== 15. Ratings and experience never influence the rotation (spec §1) ==");
const ratingProof = await query(
  `select count(*)::int as n from information_schema.columns
    where table_schema = 'public' and table_name = 'technician_queue_state'
      and column_name in ('rating', 'experience', 'score', 'jobs_completed')`
);
check("queue membership stores no rating/experience/score columns", ratingProof[0].n === 0, JSON.stringify(ratingProof));

const firstBefore = (await queueOrder())[0];
await query("update public.technicians set rating = 5, experience_years = 20, jobs_completed = 500 where id = $1", [tech.C]);
const firstAfterBoost = (await queueOrder())[0];
await query("update public.technicians set rating = 0, experience_years = 0, jobs_completed = 0 where id = $1", [tech.C]);
const firstAfterReset = (await queueOrder())[0];
check(
  "changing rating/experience moves nobody in the queue",
  firstBefore.technician_id === firstAfterBoost.technician_id &&
    firstBefore.technician_id === firstAfterReset.technician_id,
  `${firstBefore.name} / ${firstAfterBoost.name} / ${firstAfterReset.name}`
);

console.log("\n== 16. Service location: validated in the database, visible only to the ASSIGNED technician ==");

// A request that carries a confirmed map pin (the shape the wizard submits).
// Deliberately NO requested time window: this group is about who may read the
// service location, not about availability matching, and a null window lets the
// rotation engine consider every technician.
const locRequest = (
  await query(
    `insert into public.service_requests
       (customer_id, appliance_type, problem_description, status, assignment_status,
        location, latitude, longitude)
     values ($1,'refrigerator','Refrigerator not cooling','open','matching',
             '12 Mabini St, Barangay 1, Cagayan de Oro',$2,$3)
     returning id`,
    [customerId, 8.4822, 124.6472]
  )
)[0].id;

// --- Coordinate validation, enforced by the DATABASE -------------------------
let latitudeRejected = false;
try {
  await query("update public.service_requests set latitude = 91 where id = $1", [locRequest]);
} catch (err) {
  latitudeRejected = /latitude_range_check/.test(err.message);
}
check("the database rejects a latitude outside -90..90", latitudeRejected);

let longitudeRejected = false;
try {
  await query("update public.service_requests set longitude = -181 where id = $1", [locRequest]);
} catch (err) {
  longitudeRejected = /longitude_range_check/.test(err.message);
}
check("the database rejects a longitude outside -180..180", longitudeRejected);

let unpairedRejected = false;
try {
  await query("update public.service_requests set latitude = null where id = $1", [locRequest]);
} catch (err) {
  unpairedRejected = /coordinates_paired_check/.test(err.message);
}
check("the database rejects a latitude with no longitude", unpairedRejected);

const storedCoordinates = await query(
  "select latitude, longitude from public.service_requests where id = $1",
  [locRequest]
);
check(
  "the coordinates the customer confirmed are stored unchanged",
  Number(storedCoordinates[0].latitude) === 8.4822 &&
    Number(storedCoordinates[0].longitude) === 124.6472,
  JSON.stringify(storedCoordinates[0])
);

// --- Assignment through the real rotation engine -----------------------------
// A technician may hold only ONE active offer at a time (uniq_active_offer_per_technician),
// and the earlier groups leave offers outstanding. Release them first so this
// request can genuinely be offered by the engine.
await query(
  `update public.service_requests
      set assigned_technician_id = null, assignment_status = 'matching', offers_expires_at = null
    where assignment_status = 'offered'`
);

const locAssignment = await assign(locRequest);
if (locAssignment.outcome !== "offered") {
  // Every candidate was skipped for capacity, so the engine correctly answers
  // "waiting". This group tests RLS, not the rotation (groups 3-8 own that), so
  // the offer is placed directly rather than skipped.
  await query(
    `update public.service_requests
        set assigned_technician_id = $2, assignment_status = 'offered',
            offers_expires_at = now() + interval '15 minutes'
      where id = $1`,
    [locRequest, tech.A]
  );
}

const assignedTech = (
  await query("select assigned_technician_id from public.service_requests where id = $1", [locRequest])
)[0].assigned_technician_id;
const otherTech = Object.values(tech).find((id) => id !== assignedTech);

// --- Before acceptance: an OFFERED technician must not see the location ------
const offeredReadsRow = await asUser(assignedTech, "authenticated", () =>
  query("select count(*)::int as n from public.service_requests where id = $1", [locRequest])
);
check(
  "an OFFERED (not yet accepted) technician cannot read the request row at all",
  offeredReadsRow[0].n === 0,
  JSON.stringify(offeredReadsRow)
);

const offeredReadsCoordinates = await asUser(assignedTech, "authenticated", () =>
  query("select latitude, longitude, location from public.service_requests where id = $1", [locRequest])
);
check(
  "an offered technician cannot read the coordinates or the address",
  offeredReadsCoordinates.length === 0,
  JSON.stringify(offeredReadsCoordinates)
);

const pendingOffers = await asUser(assignedTech, "authenticated", () =>
  query("select * from public.technician_pending_offers()")
);
check(
  "the offer screen still receives the offer through technician_pending_offers()",
  pendingOffers.length === 1 && pendingOffers[0].id === locRequest,
  JSON.stringify(pendingOffers.map((o) => o.id))
);
check(
  "that offer payload carries NO address, latitude, longitude or customer id",
  !("location" in pendingOffers[0]) &&
    !("latitude" in pendingOffers[0]) &&
    !("longitude" in pendingOffers[0]) &&
    !("customer_id" in pendingOffers[0]),
  Object.keys(pendingOffers[0]).join(",")
);

let customerOfferBlocked = false;
try {
  await asUser(customerId, "authenticated", () => query("select * from public.technician_pending_offers()"));
} catch (err) {
  customerOfferBlocked = /only technicians/.test(err.message);
}
check("a customer calling technician_pending_offers() is refused", customerOfferBlocked);

// --- The customer always sees their own request ------------------------------
const customerReadsOwn = await asUser(customerId, "authenticated", () =>
  query("select location, latitude, longitude from public.service_requests where id = $1", [locRequest])
);
check(
  "the owning customer can read back their own address and pin",
  customerReadsOwn.length === 1 && Number(customerReadsOwn[0].latitude) === 8.4822,
  JSON.stringify(customerReadsOwn)
);

// --- After acceptance: the ASSIGNED technician can see it, nobody else -------
const locAccepted = await respond(locRequest, assignedTech, "accept");
check(
  "the offered technician accepts the request",
  locAccepted.outcome === "accepted",
  JSON.stringify(locAccepted)
);

const assignedReadsLocation = await asUser(assignedTech, "authenticated", () =>
  query("select location, latitude, longitude from public.service_requests where id = $1", [locRequest])
);
check(
  "after acceptance the assigned technician CAN read the address and pin",
  assignedReadsLocation.length === 1 &&
    Number(assignedReadsLocation[0].latitude) === 8.4822 &&
    /Cagayan de Oro/.test(assignedReadsLocation[0].location),
  JSON.stringify(assignedReadsLocation)
);

const otherReadsLocation = await asUser(otherTech, "authenticated", () =>
  query("select count(*)::int as n from public.service_requests where id = $1", [locRequest])
);
check(
  "a technician who was not assigned still cannot read it",
  otherReadsLocation[0].n === 0,
  JSON.stringify(otherReadsLocation)
);

const offersAfterAccept = await asUser(assignedTech, "authenticated", () =>
  query("select * from public.technician_pending_offers()")
);
check(
  "an accepted request is no longer listed as a pending offer",
  offersAfterAccept.length === 0,
  JSON.stringify(offersAfterAccept.map((o) => o.id))
);

console.log("\n== 17. Troubleshooting: identified issue + reported outcome ==");

// A request the customer could identify: the canonical issue id and what they
// reported after the optional preliminary checks.
const identified = (
  await query(
    `insert into public.service_requests
       (customer_id, appliance_type, problem_description, status, assignment_status,
        issue_category, issue_id, troubleshooting_outcome)
     values ($1,'refrigerator','Hindi lumalamig ang ref','open','matching',
             'Not cooling','not-cooling','resolved')
     returning id`,
    [customerId]
  )
)[0].id;

const stored = await query(
  "select issue_category, issue_id, troubleshooting_outcome from public.service_requests where id = $1",
  [identified]
);
check(
  "an identified issue and the reported outcome are stored",
  stored[0].issue_id === "not-cooling" &&
    stored[0].issue_category === "Not cooling" &&
    stored[0].troubleshooting_outcome === "resolved",
  JSON.stringify(stored[0])
);

// A reported outcome is the customer's own report, never a repair result.
const statusAfterOutcome = await query(
  "select status from public.service_requests where id = $1",
  [identified]
);
check(
  "reporting 'it worked' does not change the request status",
  statusAfterOutcome[0].status === "open",
  JSON.stringify(statusAfterOutcome[0])
);

// Not identifying an issue must never block a request.
const unidentified = (
  await query(
    `insert into public.service_requests
       (customer_id, appliance_type, problem_description, status, assignment_status,
        issue_category, issue_id, troubleshooting_outcome)
     values ($1,'refrigerator','ang ref kay morag guba ang motor','open','matching',
             null,null,null)
     returning id`,
    [customerId]
  )
)[0].id;
const unidentifiedStored = await query(
  "select issue_id, troubleshooting_outcome from public.service_requests where id = $1",
  [unidentified]
);
check(
  "a request with no identified issue is valid",
  unidentifiedStored[0].issue_id === null && unidentifiedStored[0].troubleshooting_outcome === null,
  JSON.stringify(unidentifiedStored[0])
);

// The vocabulary is enforced by the database, not only by the API.
let badOutcomeRejected = false;
try {
  await query("update public.service_requests set troubleshooting_outcome = 'probably' where id = $1", [
    identified,
  ]);
} catch (err) {
  badOutcomeRejected = /troubleshooting_outcome_check/.test(err.message);
}
check("the database rejects an outcome outside the vocabulary", badOutcomeRejected);

let skippedAccepted = true;
try {
  await query("update public.service_requests set troubleshooting_outcome = 'skipped' where id = $1", [
    identified,
  ]);
} catch {
  skippedAccepted = false;
}
check("'skipped' is accepted — skipping never blocks anything", skippedAccepted);

console.log("\n== 18. Cancelled requests and lapsed offers cannot jam or be accepted ==");

// Start from a known state: earlier groups leave offers outstanding.
await query(
  `update public.service_requests
      set assigned_technician_id = null, assignment_status = 'matching', offers_expires_at = null
    where assignment_status = 'offered'`
);

// --- (a) Cancelling a request releases its live offer immediately -------------
const cancelTarget = await createRequest("2030-03-01T01:00:00Z", "2030-03-01T03:00:00Z", "Will be cancelled");
const cancelOffer = await assign(cancelTarget);
check("the request is offered before it is cancelled", cancelOffer.outcome === "offered", JSON.stringify(cancelOffer));

await query("update public.service_requests set status = 'cancelled' where id = $1", [cancelTarget]);
const afterCancel = await query(
  "select status, assignment_status, assigned_technician_id, offers_expires_at from public.service_requests where id = $1",
  [cancelTarget]
);
check(
  "cancelling releases the live offer immediately (no waiting for the TTL)",
  afterCancel[0].assignment_status === "matching" &&
    afterCancel[0].assigned_technician_id === null &&
    afterCancel[0].offers_expires_at === null,
  JSON.stringify(afterCancel[0])
);

const cancelHistory = await query(
  "select status, reason from public.technician_offer_history where service_request_id = $1 and technician_id = $2",
  [cancelTarget, cancelOffer.assigned_technician_id]
);
check(
  "the released offer is recorded as rejected in the history",
  cancelHistory.length === 1 && cancelHistory[0].status === "rejected",
  JSON.stringify(cancelHistory)
);

const cancelEvents = await query(
  "select action, reason from public.technician_queue_events where repair_request_id = $1 and action = 'EXPIRED'",
  [cancelTarget]
);
check(
  "the release is audited as EXPIRED with the cancellation as the reason",
  cancelEvents.length === 1 && /cancelled/i.test(cancelEvents[0].reason),
  JSON.stringify(cancelEvents)
);

// --- (b) Accepting an offer on a cancelled request is refused -----------------
// Defence in depth: force a live offer back onto the cancelled request, as a
// database without the new trigger (or a direct SQL edit) could leave behind.
await query(
  `update public.service_requests
      set assignment_status = 'offered', assigned_technician_id = $2,
          offers_expires_at = now() + interval '15 minutes'
    where id = $1`,
  [cancelTarget, cancelOffer.assigned_technician_id]
);

const acceptCancelled = await respond(cancelTarget, cancelOffer.assigned_technician_id, "accept");
check(
  "accepting an offer on a cancelled request is refused",
  acceptCancelled.outcome === "cancelled",
  JSON.stringify(acceptCancelled)
);

const afterRefusedAccept = await query(
  "select status, assignment_status, assigned_technician_id from public.service_requests where id = $1",
  [cancelTarget]
);
check(
  "the refused offer is released, not left dangling",
  afterRefusedAccept[0].assignment_status === "matching" &&
    afterRefusedAccept[0].assigned_technician_id === null &&
    afterRefusedAccept[0].status === "cancelled",
  JSON.stringify(afterRefusedAccept[0])
);

// --- (c) A cancelled request is never offered again --------------------------
const reassignCancelled = await assign(cancelTarget);
check(
  "a cancelled request is never offered to anybody again",
  reassignCancelled.outcome === "unchanged" && reassignCancelled.reason === "request_closed",
  JSON.stringify(reassignCancelled)
);

// --- (d) A lapsed offer cannot freeze the rotation ---------------------------
// The exact failure this guards against: a technician holds an offer nobody
// answered, and the scheduled sweep has not run.
const staleOld = await createRequest("2030-03-02T01:00:00Z", "2030-03-02T03:00:00Z", "Ignored offer");
const staleOffer = await assign(staleOld);
check("an offer exists to go stale", staleOffer.outcome === "offered", JSON.stringify(staleOffer));

await query("update public.service_requests set offers_expires_at = now() - interval '1 minute' where id = $1", [staleOld]);

const freshRequest = await createRequest("2030-03-02T05:00:00Z", "2030-03-02T07:00:00Z", "New request while an offer is stale");
const freshAssign = await assign(freshRequest);
check(
  "a lapsed offer no longer blocks the rotation (no holding_offer deadlock)",
  freshAssign.outcome === "offered",
  JSON.stringify(freshAssign)
);

const staleAfter = await query(
  "select assignment_status, assigned_technician_id, offers_expires_at from public.service_requests where id = $1",
  [staleOld]
);
check(
  "the dead offer is released and its request becomes waiting, so the sweep re-matches it",
  staleAfter[0].assignment_status === "waiting" &&
    staleAfter[0].assigned_technician_id === null &&
    staleAfter[0].offers_expires_at === null,
  JSON.stringify(staleAfter[0])
);

const staleEvents = await query(
  "select action from public.technician_queue_events where repair_request_id = $1 and action = 'EXPIRED'",
  [staleOld]
);
check("the pre-walk release is audited", staleEvents.length === 1, JSON.stringify(staleEvents));

// The safety net must not touch a live offer.
const liveOfferState = await query(
  "select assignment_status, offers_expires_at from public.service_requests where id = $1",
  [freshRequest]
);
check(
  "a still-live offer is left alone by the safety net",
  liveOfferState[0].assignment_status === "offered" && liveOfferState[0].offers_expires_at !== null,
  JSON.stringify(liveOfferState[0])
);


console.log("\n== 19. Estimate workflow: itemized, versioned, explicitly approved ==");

/**
 * Group 19 drives the estimate state machine through the two functions the API
 * routes call (service_role only in production; superuser here, which is the
 * harness's stand-in for it). Every assertion below is a rule the workflow
 * depends on: the total is derived server-side, a revision never overwrites the
 * version the customer reviewed, approval is explicit and single-shot, a
 * superseded approval authorises nothing, and no decision touches the queue, the
 * assignment or a booking.
 */

// A second customer, to prove one customer cannot decide another's estimate.
const otherCustomerId = await provisionUser({
  email: "customer-other-estimate@example.com",
  name: "Other Customer",
  role: "customer",
  location: "Makati",
});

async function submitEstimate(requestId, technicianId, fields = {}, submit = true) {
  const rows = await query(
    `select public.submit_estimate($1,$2,$3,$4,$5,$6,$7,$8,$9) as result`,
    [
      requestId,
      technicianId,
      fields.scope ?? "Replace the thermostat and test the unit",
      fields.labor ?? 500,
      fields.parts ?? 0,
      fields.other ?? 0,
      fields.otherDescription ?? null,
      fields.notes ?? "Assumes the compressor is serviceable",
      submit,
    ]
  );
  return rows[0].result;
}

async function decide(estimateId, actorId, decision, reason = null) {
  const rows = await query("select public.decide_estimate($1,$2,$3,$4) as result", [
    estimateId,
    actorId,
    decision,
    reason,
  ]);
  return rows[0].result;
}

// --- A request this technician is actually assigned to -------------------------
const estRequest = await createRequest(
  "2031-03-03T01:00:00Z",
  "2031-03-03T03:00:00Z",
  "Refrigerator leaking"
);
const estOffer = await assign(estRequest);
const estTech = estOffer.assigned_technician_id;
await respond(estRequest, estTech, "accept");

const queueBefore = await query(
  "select queue_position, turn_count from public.technician_queue_state where technician_id = $1",
  [estTech]
);
const eventsBefore = await query("select count(*)::int as n from public.technician_queue_events");

// --- (a) A draft is saved, invisible to the customer, and burns no version -----
const draft = await submitEstimate(
  estRequest,
  estTech,
  {
    scope: "Diagnose and replace the door gasket",
    labor: 450,
    parts: 250,
    other: 100,
    otherDescription: "Transport",
    notes: "Gasket ordered on approval",
  },
  false
);
check(
  "a technician can save a DRAFT for a request they are assigned to",
  draft.outcome === "draft_saved" && draft.status === "draft" && draft.version === 1,
  JSON.stringify(draft)
);
check(
  "the total is derived from the itemized lines (450 + 250 + 100)",
  Number(draft.total) === 800,
  JSON.stringify(draft)
);

const customerSeesDraft = await asUser(customerId, "authenticated", () =>
  query("select count(*)::int as n from public.estimates where service_request_id = $1", [
    estRequest,
  ])
);
check(
  "the customer CANNOT see the technician's draft",
  customerSeesDraft[0].n === 0,
  JSON.stringify(customerSeesDraft)
);

const techSeesDraft = await asUser(estTech, "authenticated", () =>
  query("select count(*)::int as n from public.estimates where service_request_id = $1", [
    estRequest,
  ])
);
check(
  "the technician who owns the draft can still see it",
  techSeesDraft[0].n === 1,
  JSON.stringify(techSeesDraft)
);


// --- (b) Submitting that draft edits it in place: no version is wasted ---------
const submitted = await submitEstimate(
  estRequest,
  estTech,
  {
    scope: "Diagnose and replace the door gasket",
    labor: 450,
    parts: 250,
    other: 100,
    otherDescription: "Transport",
    notes: "Gasket ordered on approval",
  },
  true
);
const v1 = (await query("select * from public.estimates where id = $1", [draft.estimate_id]))[0];
check(
  "submitting a draft keeps it as version 1 and sends it for a decision",
  submitted.outcome === "submitted" &&
    submitted.estimate_id === draft.estimate_id &&
    v1.version === 1 &&
    v1.status === "pending" &&
    v1.submitted_at !== null,
  JSON.stringify({ submitted, status: v1.status })
);
check(
  "the stored total equals the itemized sum, and the request moves to 'quoted'",
  Number(v1.estimated_cost) === 800 &&
    (await query("select status from public.service_requests where id = $1", [estRequest]))[0]
      .status === "quoted",
  JSON.stringify(v1.estimated_cost)
);

// --- (c) The money rules are enforced by the database, not the browser ---------
async function expectError(fn) {
  try {
    await fn();
    return null;
  } catch (err) {
    return err.message;
  }
}

const mismatch = await expectError(() =>
  query("update public.estimates set estimated_cost = 999 where id = $1", [v1.id])
);
check(
  "a stored total that disagrees with the itemized lines is rejected",
  /estimates_amounts_check/.test(mismatch ?? ""),
  mismatch ?? "no error"
);

const negative = await expectError(() => submitEstimate(estRequest, estTech, { labor: -1 }));
check("a negative cost is rejected", /negative/.test(negative ?? ""), negative ?? "no error");

const undescribed = await expectError(() =>
  submitEstimate(estRequest, estTech, { other: 200, otherDescription: "  " })
);
check(
  "an additional charge without a description is rejected",
  /needs a description/.test(undescribed ?? ""),
  undescribed ?? "no error"
);

const zeroTotal = await expectError(() =>
  submitEstimate(estRequest, estTech, { labor: 0, parts: 0, other: 0 })
);
check("a zero total is rejected", /greater than zero/.test(zeroTotal ?? ""), zeroTotal ?? "no error");

// --- (d) Only the assigned technician may quote a request ---------------------
const otherTechId = Object.values(tech).find((id) => id !== estTech);
const notAssigned = await submitEstimate(estRequest, otherTechId, { labor: 100 });
check(
  "a technician who is not assigned to the request cannot quote it",
  notAssigned.outcome === "not_assigned",
  JSON.stringify(notAssigned)
);


// --- (e) The customer approves the EXACT version, once -------------------------
const customerSeesSent = await asUser(customerId, "authenticated", () =>
  query("select count(*)::int as n from public.estimates where service_request_id = $1", [
    estRequest,
  ])
);
check(
  "the customer can read the version sent to them",
  customerSeesSent[0].n === 1,
  JSON.stringify(customerSeesSent)
);

const strangerSeesIt = await asUser(otherCustomerId, "authenticated", () =>
  query("select count(*)::int as n from public.estimates where service_request_id = $1", [
    estRequest,
  ])
);
check(
  "another customer cannot read an estimate for a request that is not theirs",
  strangerSeesIt[0].n === 0,
  JSON.stringify(strangerSeesIt)
);

const strangerDecides = await expectError(() => decide(v1.id, otherCustomerId, "approve"));
check(
  "another customer cannot decide someone else's estimate",
  /not allowed to decide/.test(strangerDecides ?? ""),
  strangerDecides ?? "no error"
);

const techDecides = await expectError(() => decide(v1.id, estTech, "approve"));
check(
  "the technician cannot approve their own estimate",
  /not allowed to decide/.test(techDecides ?? ""),
  techDecides ?? "no error"
);

// A technician updating the row directly is stopped by RLS, not just by the UI.
const selfApprove = await (async () => {
  try {
    return await asUser(estTech, "authenticated", () =>
      query("update public.estimates set status = 'accepted' where id = $1 returning id", [v1.id])
    );
  } catch (err) {
    return err.message;
  }
})();
check(
  "RLS stops a technician from setting an estimate to 'accepted' from the client",
  Array.isArray(selfApprove)
    ? selfApprove.length === 0
    : /row-level security/.test(String(selfApprove)),
  JSON.stringify(selfApprove)
);

const approval = await decide(v1.id, customerId, "approve");
const approvedRow = (await query("select * from public.estimates where id = $1", [v1.id]))[0];
check(
  "the customer's approval is recorded with who decided and when",
  approval.outcome === "approve" &&
    approvedRow.status === "accepted" &&
    approvedRow.approved_at !== null &&
    approvedRow.decided_by === customerId &&
    approvedRow.decided_at !== null,
  JSON.stringify(approval)
);

const secondApproval = await decide(v1.id, customerId, "approve");
check(
  "deciding the same version twice is a no-op (no duplicate decision, no duplicate notification)",
  secondApproval.outcome === "not_pending",
  JSON.stringify(secondApproval)
);

// --- (f) Approval alone changes nothing else ----------------------------------
const bookingsAfterApproval = await query(
  "select count(*)::int as n from public.bookings where service_request_id = $1",
  [estRequest]
);
const requestAfterApproval = await query(
  "select status, assigned_technician_id, assignment_status from public.service_requests where id = $1",
  [estRequest]
);
const queueAfter = await query(
  "select queue_position, turn_count from public.technician_queue_state where technician_id = $1",
  [estTech]
);
const eventsAfter = await query("select count(*)::int as n from public.technician_queue_events");
check(
  "approving does not create a booking",
  bookingsAfterApproval[0].n === 0,
  JSON.stringify(bookingsAfterApproval)
);
check(
  "approving does not re-assign, re-offer or restart the request",
  requestAfterApproval[0].status === "quoted" &&
    requestAfterApproval[0].assigned_technician_id === estTech &&
    requestAfterApproval[0].assignment_status === "accepted",
  JSON.stringify(requestAfterApproval[0])
);
check(
  "approving does not move the technician's queue position or burn a turn",
  queueAfter[0].queue_position === queueBefore[0].queue_position &&
    queueAfter[0].turn_count === queueBefore[0].turn_count,
  JSON.stringify({ before: queueBefore[0], after: queueAfter[0] })
);
check(
  "approving writes no queue event",
  eventsAfter[0].n === eventsBefore[0].n,
  JSON.stringify({ before: eventsBefore[0].n, after: eventsAfter[0].n })
);


// --- (g) Additional chargeable work: a revision is a NEW version --------------
const revised = await submitEstimate(
  estRequest,
  estTech,
  {
    scope: "Found a burnt compressor relay — replace it as well",
    labor: 450,
    parts: 250,
    other: 900,
    otherDescription: "Compressor relay and labour",
    notes: "Extra part found on inspection",
  },
  true
);
const v2 = (await query("select * from public.estimates where id = $1", [revised.estimate_id]))[0];
const v1AfterRevision = (await query("select * from public.estimates where id = $1", [v1.id]))[0];
check(
  "a revised estimate is a NEW version that supersedes the old one",
  revised.outcome === "revised" &&
    v2.version === 2 &&
    v2.supersedes_id === v1.id &&
    v1AfterRevision.status === "superseded" &&
    v1AfterRevision.superseded_by === v2.id,
  JSON.stringify({ revised, version: v2.version, supersedes: v2.supersedes_id })
);
check(
  "the previous version keeps its amounts, scope and timestamps",
  Number(v1AfterRevision.labor_cost) === 450 &&
    Number(v1AfterRevision.parts_cost) === 250 &&
    Number(v1AfterRevision.other_cost) === 100 &&
    v1AfterRevision.scope === "Diagnose and replace the door gasket" &&
    v1AfterRevision.submitted_at !== null,
  JSON.stringify(v1AfterRevision)
);
check(
  "the superseded version still carries its approval record",
  v1AfterRevision.approved_at !== null && v1AfterRevision.decided_by === customerId,
  JSON.stringify({ approved_at: v1AfterRevision.approved_at })
);
check(
  "the revised version needs its OWN approval (the old one does not carry over)",
  v2.status === "pending" && v2.approved_at === null,
  JSON.stringify({ status: v2.status, approved_at: v2.approved_at })
);

// The superseded approval cannot be booked, and neither can the unapproved v2.
const bookSuperseded = await expectError(() =>
  query(
    `insert into public.bookings (service_request_id, estimate_id, customer_id, technician_id, scheduled_at)
     values ($1,$2,$3,$4,now() + interval '2 days')`,
    [estRequest, v1.id, customerId, estTech]
  )
);
check(
  "a booking cannot be built on a superseded approval",
  /currently approved estimate/.test(bookSuperseded ?? ""),
  bookSuperseded ?? "no error"
);

const bookUnapproved = await expectError(() =>
  query(
    `insert into public.bookings (service_request_id, estimate_id, customer_id, technician_id, scheduled_at)
     values ($1,$2,$3,$4,now() + interval '2 days')`,
    [estRequest, v2.id, customerId, estTech]
  )
);
check(
  "a booking cannot be built on an estimate that is still awaiting a decision",
  /currently approved estimate/.test(bookUnapproved ?? ""),
  bookUnapproved ?? "no error"
);

// --- (h) Asking for a revision records the reason -----------------------------
const revisionReason = "The relay seems too expensive — can you check the part price?";
const revisionAsk = await decide(v2.id, customerId, "request_revision", revisionReason);
const v2AfterAsk = (await query("select * from public.estimates where id = $1", [v2.id]))[0];
check(
  "the customer's reason for a revision is recorded",
  revisionAsk.outcome === "request_revision" &&
    v2AfterAsk.status === "revision_requested" &&
    v2AfterAsk.revision_reason === revisionReason &&
    v2AfterAsk.revision_requested_at !== null &&
    v2AfterAsk.decided_by === customerId,
  JSON.stringify({ revisionAsk, status: v2AfterAsk.status })
);

// --- (i) Declining is recorded, and creates no booking ------------------------
const declineRequest = await createRequest(
  "2031-04-04T01:00:00Z",
  "2031-04-04T03:00:00Z",
  "Washing machine not spinning"
);
const declineOffer = await assign(declineRequest);
const declineTech = declineOffer.assigned_technician_id;
await respond(declineRequest, declineTech, "accept");
const declineEstimate = await submitEstimate(declineRequest, declineTech, { labor: 1200, parts: 0 });
const declined = await decide(
  declineEstimate.estimate_id,
  customerId,
  "decline",
  "Too expensive right now"
);
const declinedRow = (
  await query("select * from public.estimates where id = $1", [declineEstimate.estimate_id])
)[0];
check(
  "a declined estimate records the decision and the note",
  declined.outcome === "decline" &&
    declinedRow.status === "rejected" &&
    declinedRow.decision_note === "Too expensive right now" &&
    declinedRow.decided_at !== null &&
    declinedRow.approved_at === null,
  JSON.stringify(declined)
);
check(
  "declining creates no booking",
  (await query("select count(*)::int as n from public.bookings where service_request_id = $1", [
    declineRequest,
  ]))[0].n === 0
);
const bookDeclined = await expectError(() =>
  query(
    `insert into public.bookings (service_request_id, estimate_id, customer_id, technician_id, scheduled_at)
     values ($1,$2,$3,$4,now() + interval '2 days')`,
    [declineRequest, declineEstimate.estimate_id, customerId, declineTech]
  )
);
check(
  "a booking cannot be built on a declined estimate",
  /currently approved estimate/.test(bookDeclined ?? ""),
  bookDeclined ?? "no error"
);
const declineRequestAfter = await query(
  "select status, assignment_status from public.service_requests where id = $1",
  [declineRequest]
);
check(
  "a declined estimate leaves the request and its assignment intact",
  declineRequestAfter[0].assignment_status === "accepted",
  JSON.stringify(declineRequestAfter[0])
);


// --- (j) An unanswered estimate stays unanswered ------------------------------
const waitingRequest = await createRequest(
  "2031-05-05T01:00:00Z",
  "2031-05-05T03:00:00Z",
  "Aircon not cooling"
);
const waitingOffer = await assign(waitingRequest);
const waitingTech = waitingOffer.assigned_technician_id;
await respond(waitingRequest, waitingTech, "accept");
const waitingEstimate = await submitEstimate(waitingRequest, waitingTech, { labor: 800, parts: 1500 });
// The cron sweep runs: nothing in it may approve or decline an estimate.
await query("select public.expire_stale_offers()");
const stillWaiting = (
  await query("select status, approved_at from public.estimates where id = $1", [
    waitingEstimate.estimate_id,
  ])
)[0];
check(
  "an unanswered estimate is never auto-approved (no expiry policy is invented here)",
  stillWaiting.status === "pending" && stillWaiting.approved_at === null,
  JSON.stringify(stillWaiting)
);

// --- (k) One live version, one approval, per request --------------------------
const secondLive = await expectError(() =>
  query(
    `insert into public.estimates (service_request_id, technician_id, estimated_cost, status, labor_cost)
     values ($1,$2,100,'pending',100)`,
    [waitingRequest, waitingTech]
  )
);
check(
  "a second live version for the same request is refused",
  /uniq_live_estimate_per_request/.test(secondLive ?? ""),
  secondLive ?? "no error"
);

// The request must actually HAVE a current approval for this to mean anything:
// approve the waiting estimate first, then try to add a second one.
await decide(waitingEstimate.estimate_id, customerId, "approve");

const secondApproved = await expectError(() =>
  query(
    `insert into public.estimates (service_request_id, technician_id, estimated_cost, status, labor_cost)
     values ($1,$2,100,'accepted',100)`,
    [waitingRequest, waitingTech]
  )
);
check(
  "a second approved version for the same request is refused",
  /uniq_approved_estimate_per_request/.test(secondApproved ?? ""),
  secondApproved ?? "no error"
);

// --- (l) Estimate statuses are not booking statuses ---------------------------
const crossVocabulary = await expectError(() =>
  query(
    `insert into public.bookings (service_request_id, customer_id, technician_id, scheduled_at, status)
     values ($1,$2,$3,now() + interval '3 days','accepted')`,
    [estRequest, customerId, estTech]
  )
);
check(
  "an estimate status ('accepted') is not a booking status — the vocabularies stay separate",
  /invalid input value for enum booking_status/.test(crossVocabulary ?? ""),
  crossVocabulary ?? "no error"
);

// --- (m) A booking that names no estimate is still allowed --------------------
// Administrative/legacy scheduling is a different concern from the estimate
// workflow; the guard is deliberately scoped to bookings that reference one.
const noEstimateBooking = await (async () => {
  try {
    await query(
      `insert into public.bookings (service_request_id, customer_id, technician_id, scheduled_at)
       values ($1,$2,$3,now() + interval '4 days') returning id`,
      [estRequest, customerId, estTech]
    );
    return true;
  } catch (err) {
    return err.message;
  }
})();
check(
  "a booking with no estimate is unaffected by the approved-estimate guard",
  noEstimateBooking === true,
  JSON.stringify(noEstimateBooking)
);

console.log("\n== 20. Workflow enforcement in the database, not just the API (Batch 1) ==");
// Every assertion here is made as the REAL role with a real JWT claim, so it is RLS
// and the BEFORE UPDATE triggers being tested — not the route handlers. The audit's
// finding was that the API was stricter than the database; these are the checks that
// make the database the boundary.

// The `adminId` (group 4) and `otherCustomerId` (group 19) fixtures are reused here:
// an administrator to verify a payment, and a second customer to prove one customer
// can neither see nor pay for another's booking.

/** Run a statement as a signed-in user and return the error message, or null. */
async function refusedBy(userId, role, sql, params) {
  return asUser(userId, role, async () => {
    try {
      await query(sql, params);
      return null;
    } catch (err) {
      return err.message;
    }
  });
}

/**
 * Book through the ONE atomic entry point, exactly as POST /api/bookings does with
 * its service-role client. Since Batch 2 a direct insert is no longer a legitimate
 * path (the INSERT policies are gone), so every "the customer books" step in this
 * suite goes through here.
 */
async function bookViaRpc(requestId, estimateId, scheduledAt, options = {}) {
  const {
    actor = customerId,
    durationMinutes = 120,
    notes = null,
  } = options;
  const rows = await query(
    "select public.create_booking_atomic($1,$2,$3,$4,$5,$6) as result",
    [requestId, estimateId, actor, scheduledAt, durationMinutes, notes]
  );
  return rows[0].result;
}

/**
 * A repair request that is ready to book: assigned and ACCEPTED to a technician,
 * with one approved estimate. Each booking scenario needs its own request now that
 * a request may hold only one non-cancelled booking.
 */
async function bookableFixture(label, startIso, options = {}) {
  const { technician = tech.A, cost = 1500, owner = customerId, applianceType = "refrigerator" } = options;
  const id = await createRequest(startIso, null, label, applianceType);
  if (owner !== customerId) {
    await query("update public.service_requests set customer_id = $2 where id = $1", [id, owner]);
  }
  await query(
    `update public.service_requests
        set assigned_technician_id = $2, assignment_status = 'accepted', status = 'quoted'
      where id = $1`,
    [id, technician]
  );
  const estimateId = (
    await query(
      `insert into public.estimates (service_request_id, technician_id, estimated_cost, status, labor_cost)
       values ($1,$2,$3,'accepted',$3) returning id`,
      [id, technician, cost]
    )
  )[0].id;
  return { requestId: id, estimateId, technician };
}

// --- Fixtures: the request/estimate pair for the main flow, plus one request per
// --- booking scenario (a request can only hold one non-cancelled booking).
const rlsFixture = await bookableFixture("RLS enforcement", "2031-01-05T01:00:00Z", { cost: 1500 });
const rlsRequest = rlsFixture.requestId;
const rlsEstimate = rlsFixture.estimateId;
const rlsBooking = (
  await query(
    `insert into public.bookings (service_request_id, estimate_id, customer_id, technician_id, scheduled_at, status, final_cost)
     values ($1,$2,$3,$4,'2031-01-05T01:00:00Z','pending',1500) returning id`,
    [rlsRequest, rlsEstimate, customerId, tech.A]
  )
)[0].id;

// --- (a) A customer cannot book without the approved estimate -----------------
const noEstimateInsert = await refusedBy(
  customerId,
  "authenticated",
  `insert into public.bookings (service_request_id, customer_id, technician_id, scheduled_at)
   values ($1,$2,$3,'2031-01-06T01:00:00Z')`,
  [rlsRequest, customerId, tech.A]
);
check(
  "a customer cannot create a booking that names no estimate",
  noEstimateInsert !== null,
  noEstimateInsert ?? "the insert was ALLOWED"
);

// --- (b) A customer cannot create a booking that is already completed ---------
const completedInsert = await refusedBy(
  customerId,
  "authenticated",
  `insert into public.bookings (service_request_id, estimate_id, customer_id, technician_id, scheduled_at, status)
   values ($1,$2,$3,$4,'2031-01-06T02:00:00Z','completed')`,
  [rlsRequest, rlsEstimate, customerId, tech.A]
);
check(
  "a customer cannot create a booking already marked completed",
  completedInsert !== null,
  completedInsert ?? "the insert was ALLOWED"
);

// --- (c) A customer cannot book against an unapproved estimate ----------------
const pendingEstimate = (
  await query(
    `insert into public.estimates (service_request_id, technician_id, estimated_cost, status, labor_cost)
     values ($1,$2,900,'pending',900) returning id`,
    [rlsRequest, tech.A]
  )
)[0].id;
const unapprovedInsert = await refusedBy(
  customerId,
  "authenticated",
  `insert into public.bookings (service_request_id, estimate_id, customer_id, technician_id, scheduled_at, status)
   values ($1,$2,$3,$4,'2031-01-06T03:00:00Z','pending')`,
  [rlsRequest, pendingEstimate, customerId, tech.A]
);
check(
  "a customer cannot book against an estimate that is not approved",
  unapprovedInsert !== null,
  unapprovedInsert ?? "the insert was ALLOWED"
);

// --- (d) A customer cannot complete their own repair -------------------------
const selfComplete = await refusedBy(
  customerId,
  "authenticated",
  "update public.bookings set status = 'completed' where id = $1",
  [rlsBooking]
);
check(
  "a customer cannot set their own booking to completed",
  selfComplete !== null,
  selfComplete ?? "the update was ALLOWED"
);

// --- (e) A customer cannot write the final cost ------------------------------
const selfCost = await refusedBy(
  customerId,
  "authenticated",
  "update public.bookings set final_cost = 10 where id = $1",
  [rlsBooking]
);
check(
  "a customer cannot record the final cost themselves",
  selfCost !== null,
  selfCost ?? "the update was ALLOWED"
);

// --- (f) A customer cannot self-verify a payment -----------------------------
const selfVerified = await refusedBy(
  customerId,
  "authenticated",
  `insert into public.payments (booking_id, customer_id, gcash_reference, amount, status)
   values ($1,$2,'SELFVERIFY01',1500,'confirmed')`,
  [rlsBooking, customerId]
);
check(
  "a customer cannot insert a payment that is already confirmed",
  selfVerified !== null,
  selfVerified ?? "the insert was ALLOWED"
);

// --- (g) A customer cannot submit a payment against someone else's booking ----
// The other customer needs a booking of their own for this to mean anything, and
// since Batch 2 that means their own repair request too.
const foreignFixture = await bookableFixture("Other customer's repair", "2031-01-07T01:00:00Z", {
  technician: tech.B,
  owner: otherCustomerId,
});
const foreignBooking = (
  await query(
    `insert into public.bookings (service_request_id, estimate_id, customer_id, technician_id, scheduled_at, status, final_cost)
     values ($1,$2,$3,$4,'2031-01-07T01:00:00Z','pending',1500) returning id`,
    [foreignFixture.requestId, foreignFixture.estimateId, otherCustomerId, tech.B]
  )
)[0].id;
const foreignPayment = await refusedBy(
  customerId,
  "authenticated",
  `insert into public.payments (booking_id, customer_id, gcash_reference, amount, status)
   values ($1,$2,'FOREIGN001',1500,'pending_verification')`,
  [foreignBooking, customerId]
);
check(
  "a customer cannot submit a payment against another customer's booking",
  foreignPayment !== null,
  foreignPayment ?? "the insert was ALLOWED"
);

// --- (h) A technician cannot quote a request they were not assigned ----------
const foreignEstimate = await refusedBy(
  tech.B,
  "authenticated",
  `insert into public.estimates (service_request_id, technician_id, estimated_cost, status, labor_cost)
   values ($1,$2,500,'draft',500)`,
  [rlsRequest, tech.B]
);
check(
  "a technician cannot create an estimate for a request they are not assigned to",
  foreignEstimate !== null,
  foreignEstimate ?? "the insert was ALLOWED (address leak)"
);

// --- (i) A customer cannot rewrite the queue state of their own request ------
const assignmentRewrite = await refusedBy(
  customerId,
  "authenticated",
  "update public.service_requests set assigned_technician_id = $2 where id = $1",
  [rlsRequest, tech.B]
);
check(
  "a customer cannot reassign their own request",
  assignmentRewrite !== null,
  assignmentRewrite ?? "the update was ALLOWED"
);

const statusRewrite = await refusedBy(
  customerId,
  "authenticated",
  "update public.service_requests set status = 'completed' where id = $1",
  [rlsRequest]
);
check(
  "a customer cannot close their own request",
  statusRewrite !== null,
  statusRewrite ?? "the update was ALLOWED"
);

// --- (j) A customer cannot see or touch another customer's booking -----------
const foreignRead = await asUser(otherCustomerId, "authenticated", async () =>
  query("select id from public.bookings where id = $1", [rlsBooking])
);
check(
  "a customer cannot read another customer's booking",
  foreignRead.length === 0,
  JSON.stringify(foreignRead)
);

const foreignUpdate = await asUser(otherCustomerId, "authenticated", async () =>
  query("update public.bookings set notes = 'x' where id = $1 returning id", [rlsBooking])
);
check(
  "a customer cannot update another customer's booking",
  foreignUpdate.length === 0,
  JSON.stringify(foreignUpdate)
);

// --- (k) The legitimate path still works -------------------------------------
// It now goes through the ONE atomic entry point: a direct authenticated insert is
// no longer a path at all (see the two assertions above), which is the point of
// Batch 2.
const legalFixture = await bookableFixture("Legal booking", "2031-01-08T01:00:00Z");
const legalOutcome = await bookViaRpc(
  legalFixture.requestId,
  legalFixture.estimateId,
  "2031-01-08T01:00:00Z"
);
check(
  "the atomic function books the current approved estimate",
  legalOutcome.outcome === "booked" && Boolean(legalOutcome.booking_id),
  JSON.stringify(legalOutcome)
);

const legalBooking = (
  await query("select id, status from public.bookings where id = $1", [legalOutcome.booking_id])
)[0];
check(
  "the booking is stored as pending and the request is marked booked",
  legalBooking.status === "pending" &&
    (await query("select status from public.service_requests where id = $1", [legalFixture.requestId]))[0]
      .status === "booked",
  JSON.stringify(legalBooking)
);

const cancelledByCustomer = await asUser(customerId, "authenticated", async () =>
  query(
    "update public.bookings set status = 'cancelled' where id = $1 returning status",
    [legalBooking.id]
  )
);
check(
  "a customer CAN cancel their own booking before the work starts",
  cancelledByCustomer[0]?.status === "cancelled",
  JSON.stringify(cancelledByCustomer)
);

// --- (k2) Booking creation cannot bypass the atomic path ----------------------
// A fresh request, so RLS is the only possible reason for a refusal.
const bypassFixture = await bookableFixture("Bypass attempt", "2031-01-09T01:00:00Z");

const bypassInsert = await refusedBy(
  customerId,
  "authenticated",
  `insert into public.bookings (service_request_id, estimate_id, customer_id, technician_id, scheduled_at, status)
   values ($1,$2,$3,$4,'2031-01-09T01:00:00Z','pending')`,
  [bypassFixture.requestId, bypassFixture.estimateId, customerId, tech.A]
);
check(
  "a direct authenticated booking insert is refused (Batch 2 removed the INSERT policies)",
  bypassInsert !== null,
  bypassInsert ?? "the insert was ALLOWED"
);

const bypassRpc = await refusedBy(
  customerId,
  "authenticated",
  "select public.create_booking_atomic($1,$2,$3,$4,$5,$6)",
  [bypassFixture.requestId, bypassFixture.estimateId, customerId, "2031-01-09T01:00:00Z", 120, null]
);
check(
  "a customer cannot execute the atomic booking function directly",
  bypassRpc !== null,
  bypassRpc ?? "the call was ALLOWED"
);

// --- (l) The technician's own transitions still work -------------------------
await query("update public.bookings set status = 'pending' where id = $1", [rlsBooking]);
const startedByTechnician = await asUser(tech.A, "authenticated", async () =>
  query("update public.bookings set status = 'in_progress' where id = $1 returning status", [rlsBooking])
);
check(
  "the technician CAN start their own job",
  startedByTechnician[0]?.status === "in_progress",
  JSON.stringify(startedByTechnician)
);

const inspectionReady = await asUser(tech.A, "authenticated", async () =>
  query(
    "update public.bookings set status = 'awaiting_inspection' where id = $1 returning status",
    [rlsBooking]
  )
);
check(
  "the technician CAN send their job for customer inspection",
  inspectionReady[0]?.status === "awaiting_inspection",
  JSON.stringify(inspectionReady)
);

// --- (m) The technician cannot do the customer's part or complete the job ----
const technicianConfirms = await refusedBy(
  tech.A,
  "authenticated",
  "update public.bookings set status = 'awaiting_payment' where id = $1",
  [rlsBooking]
);
check(
  "the technician cannot confirm the customer's inspection",
  technicianConfirms !== null,
  technicianConfirms ?? "the update was ALLOWED"
);

const technicianCompletes = await refusedBy(
  tech.A,
  "authenticated",
  "update public.bookings set status = 'completed' where id = $1",
  [rlsBooking]
);
check(
  "the technician cannot complete the repair",
  technicianCompletes !== null,
  technicianCompletes ?? "the update was ALLOWED"
);

// --- (n) The customer confirms the inspection, WITH the written attestation --
const noNote = await refusedBy(
  customerId,
  "authenticated",
  "update public.bookings set status = 'awaiting_payment' where id = $1",
  [rlsBooking]
);
check(
  "the customer's confirmation is refused without an inspection note",
  noNote !== null,
  noNote ?? "the update was ALLOWED"
);

const confirmed = await asUser(customerId, "authenticated", async () =>
  query(
    `update public.bookings
        set status = 'awaiting_payment',
            inspection_note = 'Customer confirmed the appliance is working properly.'
      where id = $1
      returning status, inspection_confirmed_at`,
    [rlsBooking]
  )
);
check(
  "the customer CAN confirm a satisfactory inspection, which opens the payment step",
  confirmed[0]?.status === "awaiting_payment" && confirmed[0]?.inspection_confirmed_at !== null,
  JSON.stringify(confirmed)
);

const customerCompletes = await refusedBy(
  customerId,
  "authenticated",
  "update public.bookings set status = 'completed' where id = $1",
  [rlsBooking]
);
check(
  "confirming the inspection does NOT let the customer complete the repair",
  customerCompletes !== null,
  customerCompletes ?? "the update was ALLOWED"
);

// --- (o) Payment submission is allowed at the payment step, for the exact amount
const wrongAmount = await refusedBy(
  customerId,
  "authenticated",
  `insert into public.payments (booking_id, customer_id, gcash_reference, amount, status)
   values ($1,$2,'WRONGAMT01',99,'pending_verification')`,
  [rlsBooking, customerId]
);
check(
  "a payment that does not match the recorded cost is refused",
  wrongAmount !== null,
  wrongAmount ?? "the insert was ALLOWED"
);

const realPayment = await asUser(customerId, "authenticated", async () =>
  query(
    `insert into public.payments (booking_id, customer_id, gcash_reference, amount, status)
     values ($1,$2,'GCASH-RLS-001',1500,'pending_verification') returning id`,
    [rlsBooking, customerId]
  )
);
check(
  "the customer CAN submit the payment reference at the payment step",
  realPayment.length === 1,
  JSON.stringify(realPayment)
);

// --- (o) A customer cannot verify a payment at all ----------------------------
// `authenticated` holds SELECT and INSERT only on `payments` (Batch 3), so this is
// refused by the TABLE PRIVILEGE, before RLS is ever consulted. The row must also be
// provably unchanged: a refusal that still wrote something would be worse than none.
// RLS is demonstrated separately, on the operations a customer IS allowed to attempt
// (group 25: a SELECT of another customer's row returns nothing).
const foreignConfirmation = await asUser(otherCustomerId, "authenticated", async () => {
  try {
    const rows = await query(
      "update public.payments set status = 'confirmed' where id = $1 returning id, status",
      [realPayment[0].id]
    );
    return { code: null, rowsAffected: rows.length };
  } catch (err) {
    return { code: err.code ?? null, rowsAffected: null };
  }
});
const paymentAfterForeignAttempt = (
  await query("select status, confirmed_by from public.payments where id = $1", [realPayment[0].id])
)[0];
check(
  "a customer's update is refused by the TABLE PRIVILEGE (42501), and the payment is unchanged",
  foreignConfirmation.code === "42501" &&
    paymentAfterForeignAttempt.status === "pending_verification" &&
    paymentAfterForeignAttempt.confirmed_by === null,
  JSON.stringify({ foreignConfirmation, paymentAfterForeignAttempt })
);

console.log("\n== 21. Completion follows verified payment (Decision 1) ==");
// The only writer of a completed repair is confirm_payment(), called by the
// administrator's verification route with the service-role client.

const techBefore = (
  await query("select active_job_load, jobs_completed from public.technicians where id = $1", [tech.A])
)[0];

const notAnAdmin = await (async () => {
  try {
    await query("select public.confirm_payment($1,$2)", [realPayment[0].id, customerId]);
    return null;
  } catch (err) {
    return err.message;
  }
})();
check(
  "a non-administrator cannot verify a payment",
  /only an administrator/.test(notAnAdmin ?? ""),
  notAnAdmin ?? "the call SUCCEEDED"
);

const confirmedOutcome = (
  await query("select public.confirm_payment($1,$2) as result", [realPayment[0].id, adminId])
)[0].result;
check(
  "verifying the payment completes the repair in the same transaction",
  confirmedOutcome.outcome === "confirmed" && confirmedOutcome.completed_now === true,
  JSON.stringify(confirmedOutcome)
);

const bookingAfterPayment = (
  await query("select status, inspection_confirmed_at from public.bookings where id = $1", [rlsBooking])
)[0];
check(
  "the booking is completed once the payment is verified",
  bookingAfterPayment.status === "completed" && bookingAfterPayment.inspection_confirmed_at !== null,
  JSON.stringify(bookingAfterPayment)
);

const requestAfterPayment = (
  await query("select status from public.service_requests where id = $1", [rlsRequest])
)[0];
check(
  "the service request is closed with the booking",
  requestAfterPayment.status === "completed",
  JSON.stringify(requestAfterPayment)
);

const historyRows = await query(
  "select final_cost, summary from public.service_history where booking_id = $1",
  [rlsBooking]
);
check(
  "the service history is archived with the inspection note and the agreed cost",
  historyRows.length === 1 &&
    Number(historyRows[0].final_cost) === 1500 &&
    /Customer inspection:/.test(historyRows[0].summary ?? ""),
  JSON.stringify(historyRows)
);

const techAfter = (
  await query("select active_job_load, jobs_completed from public.technicians where id = $1", [tech.A])
)[0];
check(
  "the technician's slot is freed and their completed count moves once",
  techAfter.jobs_completed === techBefore.jobs_completed + 1,
  JSON.stringify({ techBefore, techAfter })
);

const secondConfirm = (
  await query("select public.confirm_payment($1,$2) as result", [realPayment[0].id, adminId])
)[0].result;
check(
  "verifying the same payment twice changes nothing",
  secondConfirm.outcome === "not_pending",
  JSON.stringify(secondConfirm)
);

const historyAfterSecond = await query(
  "select count(*)::int as n from public.service_history where booking_id = $1",
  [rlsBooking]
);
check(
  "a double verification cannot write a second history row",
  historyAfterSecond[0].n === 1,
  JSON.stringify(historyAfterSecond)
);

const techAfterSecond = (
  await query("select jobs_completed from public.technicians where id = $1", [tech.A])
)[0];
check(
  "a double verification cannot double-count the job",
  techAfterSecond.jobs_completed === techAfter.jobs_completed,
  JSON.stringify({ techAfter, techAfterSecond })
);

// --- A payment verified against a booking that is not awaiting payment is refused
// Its own request: the main RLS request already holds a live booking.
const strandedFixture = await bookableFixture("Stranded payment", "2031-01-09T01:00:00Z");
const strandedBooking = (
  await query(
    `insert into public.bookings (service_request_id, customer_id, technician_id, scheduled_at, status, final_cost)
     values ($1,$2,$3,'2031-01-09T01:00:00Z','pending',800) returning id`,
    [strandedFixture.requestId, customerId, tech.A]
  )
)[0].id;
const strandedPayment = (
  await query(
    `insert into public.payments (booking_id, customer_id, gcash_reference, amount, status)
     values ($1,$2,'GCASH-RLS-002',800,'pending_verification') returning id`,
    [strandedBooking, customerId]
  )
)[0].id;
const strandedResult = await (async () => {
  try {
    await query("select public.confirm_payment($1,$2)", [strandedPayment, adminId]);
    return null;
  } catch (err) {
    return err.message;
  }
})();
check(
  "a payment cannot complete a repair that never reached the payment step",
  /not awaiting payment/.test(strandedResult ?? ""),
  strandedResult ?? "the call SUCCEEDED"
);

// --- A booking completed under the old policy: the reference is verified, the
// --- closed repair is left alone, and no second history row appears.
// Its own request again — a completed booking still occupies its request.
const legacyFixture = await bookableFixture("Legacy completion", "2031-01-10T01:00:00Z");
const legacyBooking = (
  await query(
    `insert into public.bookings (service_request_id, customer_id, technician_id, scheduled_at, status, final_cost)
     values ($1,$2,$3,'2031-01-10T01:00:00Z','completed',700) returning id`,
    [legacyFixture.requestId, customerId, tech.A]
  )
)[0].id;
const legacyPayment = (
  await query(
    `insert into public.payments (booking_id, customer_id, gcash_reference, amount, status)
     values ($1,$2,'GCASH-RLS-003',700,'pending_verification') returning id`,
    [legacyBooking, customerId]
  )
)[0].id;
const legacyOutcome = (
  await query("select public.confirm_payment($1,$2) as result", [legacyPayment, adminId])
)[0].result;
check(
  "a reference for a repair completed before the policy is verified without re-closing it",
  legacyOutcome.outcome === "confirmed_legacy" && legacyOutcome.completed_now === false,
  JSON.stringify(legacyOutcome)
);

const legacyHistory = await query(
  "select count(*)::int as n from public.service_history where booking_id = $1",
  [legacyBooking]
);
check(
  "the legacy path does not rewrite history",
  legacyHistory[0].n === 0,
  JSON.stringify(legacyHistory)
);


console.log("\n== 22. Cancelling a booking, and booking again afterwards ==");
// Decision 2: a customer may cancel their own upcoming booking before the repair
// starts. Cancelling must leave BOTH rows consistent — the booking kept as history
// with its slot released, and the request back in a state the customer can act on —
// otherwise the repair is stranded: POST /api/bookings accepts only `quoted`/`open`,
// so a request left at `booked` could never be booked again.

/** A fresh request assigned + accepted to technician A with an approved estimate. */
async function bookableRequest(label, startIso) {
  const id = await createRequest(startIso, null, label);
  await query(
    `update public.service_requests
        set assigned_technician_id = $2, assignment_status = 'accepted', status = 'quoted'
      where id = $1`,
    [id, tech.A]
  );
  const estimate = (
    await query(
      `insert into public.estimates (service_request_id, technician_id, estimated_cost, status, labor_cost)
       values ($1,$2,1200,'accepted',1200) returning id`,
      [id, tech.A]
    )
  )[0].id;
  return { requestId: id, estimateId: estimate };
}

const cancelCase = await bookableRequest("cancel and rebook", "2031-02-01T01:00:00Z");
const cancelOutcome = await bookViaRpc(
  cancelCase.requestId,
  cancelCase.estimateId,
  "2031-02-01T01:00:00Z"
);
check(
  "the customer CAN book the approved estimate (through the atomic function)",
  cancelOutcome.outcome === "booked" && Boolean(cancelOutcome.booking_id),
  JSON.stringify(cancelOutcome)
);

const cancelBooking = (
  await query("select id, status from public.bookings where id = $1", [cancelOutcome.booking_id])
)[0];
check(
  "the booking starts as pending and the request is marked booked in the same call",
  cancelBooking.status === "pending" &&
    (await query("select status from public.service_requests where id = $1", [cancelCase.requestId]))[0]
      .status === "booked",
  JSON.stringify(cancelBooking)
);

const cancelled = await asUser(customerId, "authenticated", async () =>
  query(
    "update public.bookings set status = 'cancelled' where id = $1 returning status",
    [cancelBooking.id]
  )
);
check(
  "the customer CAN cancel their own pending booking",
  cancelled[0]?.status === "cancelled",
  JSON.stringify(cancelled)
);

const requestAfterCancel = (
  await query("select status, assignment_status, assigned_technician_id from public.service_requests where id = $1", [
    cancelCase.requestId,
  ])
)[0];
check(
  "cancelling the booking returns the request to a bookable state",
  requestAfterCancel.status === "quoted",
  JSON.stringify(requestAfterCancel)
);
check(
  "the technician keeps the job they accepted (no queue turn is re-spent)",
  requestAfterCancel.assignment_status === "accepted" &&
    requestAfterCancel.assigned_technician_id === tech.A,
  JSON.stringify(requestAfterCancel)
);

const estimateAfterCancel = (
  await query("select status, superseded_by from public.estimates where id = $1", [cancelCase.estimateId])
)[0];
check(
  "the approved estimate survives the cancellation, so the price does not change",
  estimateAfterCancel.status === "accepted" && estimateAfterCancel.superseded_by === null,
  JSON.stringify(estimateAfterCancel)
);

const historyRow = (
  await query("select status from public.bookings where id = $1", [cancelBooking.id])
)[0];
check(
  "the cancelled booking is retained as history rather than deleted",
  historyRow.status === "cancelled",
  JSON.stringify(historyRow)
);

// --- Booking again after the cancellation, with the same approved estimate -----
const rebookOutcome = await bookViaRpc(
  cancelCase.requestId,
  cancelCase.estimateId,
  "2031-02-03T01:00:00Z"
);
check(
  "the customer CAN book the same request again after cancelling",
  rebookOutcome.outcome === "booked" && rebookOutcome.booking_id !== cancelBooking.id,
  JSON.stringify(rebookOutcome)
);

const liveBookings = await query(
  "select count(*)::int as n from public.bookings where service_request_id = $1 and status <> 'cancelled'",
  [cancelCase.requestId]
);
check(
  "re-booking leaves exactly one live booking, and the cancelled one is still on file",
  liveBookings[0].n === 1 &&
    (await query("select count(*)::int as n from public.bookings where service_request_id = $1", [
      cancelCase.requestId,
    ]))[0].n === 2,
  JSON.stringify(liveBookings)
);

// --- A second live booking for the same request is impossible ------------------
// Batch 2: uniq_active_booking_per_request. Before it, two live bookings could
// coexist and only the route stood in the way.
const dupCase = await bookableRequest("duplicate booking guard", "2031-02-05T01:00:00Z");
const dupFirst = await bookViaRpc(dupCase.requestId, dupCase.estimateId, "2031-02-05T01:00:00Z");
check(
  "the first booking for a request is created",
  dupFirst.outcome === "booked",
  JSON.stringify(dupFirst)
);

const dupSecond = await bookViaRpc(dupCase.requestId, dupCase.estimateId, "2031-02-06T01:00:00Z");
check(
  "a second booking for the same request is refused by the atomic function",
  dupSecond.outcome === "already_booked" && dupSecond.booking_id === dupFirst.booking_id,
  JSON.stringify(dupSecond)
);

const dupRawInsert = await (async () => {
  try {
    await query(
      `insert into public.bookings (service_request_id, estimate_id, customer_id, technician_id, scheduled_at, status)
       values ($1,$2,$3,$4,'2031-02-07T01:00:00Z','pending')`,
      [dupCase.requestId, dupCase.estimateId, customerId, tech.A]
    );
    return null;
  } catch (err) {
    return err.message;
  }
})();
check(
  "and the unique index refuses one written straight to the table",
  dupRawInsert !== null,
  dupRawInsert ?? "the insert was ALLOWED"
);

const dupLive = await query(
  "select count(*)::int as n from public.bookings where service_request_id = $1 and status <> 'cancelled'",
  [dupCase.requestId]
);
check(
  "the request still holds exactly one live booking",
  dupLive[0].n === 1,
  JSON.stringify(dupLive)
);

await asUser(customerId, "authenticated", async () =>
  query("update public.bookings set status = 'cancelled' where id = $1", [dupFirst.booking_id])
);
check(
  "cancelling that booking reopens the request for booking again",
  (await query("select status from public.service_requests where id = $1", [dupCase.requestId]))[0]
    .status === "quoted",
  "expected quoted"
);

// --- Negative: cancellation after the work has started ------------------------
const startedCase = await bookableRequest("cancel after start", "2031-02-08T01:00:00Z");
const startedBooking = (
  await query(
    `insert into public.bookings (service_request_id, estimate_id, customer_id, technician_id, scheduled_at, status, final_cost)
     values ($1,$2,$3,$4,'2031-02-08T01:00:00Z','pending',1200) returning id`,
    [startedCase.requestId, startedCase.estimateId, customerId, tech.A]
  )
)[0].id;

const cancelWhilePending = await refusedBy(
  customerId,
  "authenticated",
  "update public.bookings set status = 'cancelled' where id = $1",
  [startedBooking]
);
check(
  "a customer CAN cancel while the booking is still pending (control)",
  cancelWhilePending === null,
  cancelWhilePending ?? "refused, but it should be allowed"
);

for (const state of ["in_progress", "awaiting_inspection", "awaiting_payment", "completed"]) {
  await query("update public.bookings set status = $2 where id = $1", [startedBooking, state]);
  const refusal = await refusedBy(
    customerId,
    "authenticated",
    "update public.bookings set status = 'cancelled' where id = $1",
    [startedBooking]
  );
  check(
    `a customer CANNOT cancel a booking that is already ${state}`,
    refusal !== null,
    refusal ?? "the cancellation was ALLOWED"
  );
}

// --- Negative: someone else's cancellation ------------------------------------
const strangerCase = await bookableRequest("stranger cancel", "2031-02-10T01:00:00Z");
const strangerBooking = (
  await query(
    `insert into public.bookings (service_request_id, estimate_id, customer_id, technician_id, scheduled_at, status)
     values ($1,$2,$3,$4,'2031-02-10T01:00:00Z','pending') returning id`,
    [strangerCase.requestId, strangerCase.estimateId, customerId, tech.A]
  )
)[0].id;
const strangerCancel = await asUser(otherCustomerId, "authenticated", async () =>
  query("update public.bookings set status = 'cancelled' where id = $1 returning id", [strangerBooking])
);
check(
  "another customer cannot cancel a booking that is not theirs",
  strangerCancel.length === 0,
  JSON.stringify(strangerCancel)
);

const technicianCancel = await refusedBy(
  tech.A,
  "authenticated",
  "update public.bookings set status = 'cancelled' where id = $1",
  [strangerBooking]
);
check(
  "the technician cannot cancel the customer's booking",
  technicianCancel !== null,
  technicianCancel ?? "the cancellation was ALLOWED"
);

// --- Negative: cancelling a request that is still under way -------------------
const liveCase = await bookableRequest("cancel live request", "2031-02-12T01:00:00Z");
const liveBookingId = (
  await query(
    `insert into public.bookings (service_request_id, estimate_id, customer_id, technician_id, scheduled_at, status)
     values ($1,$2,$3,$4,'2031-02-12T01:00:00Z','pending') returning id`,
    [liveCase.requestId, liveCase.estimateId, customerId, tech.A]
  )
)[0].id;
await query("update public.service_requests set status = 'booked' where id = $1", [liveCase.requestId]);

const cancelRequestWithLiveBooking = await refusedBy(
  customerId,
  "authenticated",
  "update public.service_requests set status = 'cancelled' where id = $1",
  [liveCase.requestId]
);
check(
  "a customer cannot abandon a request that still has a live booking (cancel the booking first)",
  cancelRequestWithLiveBooking !== null,
  cancelRequestWithLiveBooking ?? "the cancellation was ALLOWED"
);

const cancelStartedRequest = await (async () => {
  await query("update public.bookings set status = 'in_progress' where id = $1", [liveBookingId]);
  return refusedBy(
    customerId,
    "authenticated",
    "update public.service_requests set status = 'cancelled' where id = $1",
    [liveCase.requestId]
  );
})();
check(
  "a customer cannot cancel a request whose repair has started",
  cancelStartedRequest !== null,
  cancelStartedRequest ?? "the cancellation was ALLOWED"
);

const cancelUnstartedRequest = await (async () => {
  await query("update public.bookings set status = 'cancelled' where id = $1", [liveBookingId]);
  return asUser(customerId, "authenticated", async () =>
    query("update public.service_requests set status = 'cancelled' where id = $1 returning status", [
      liveCase.requestId,
    ])
  );
})();
check(
  "a customer CAN cancel a request once nothing is booked on it",
  cancelUnstartedRequest[0]?.status === "cancelled",
  JSON.stringify(cancelUnstartedRequest)
);


// --- Verifying a payment for a cancelled appointment --------------------------
// The appointment can be cancelled while a reference is waiting (the customer
// cancels before the work starts, or an administrator does). There is then no repair
// to close, and the payment must be left pending rather than silently confirmed.
const cancelledPaymentCase = await bookableRequest("payment after cancel", "2031-02-14T01:00:00Z");
const cancelledPaymentBooking = (
  await query(
    `insert into public.bookings (service_request_id, estimate_id, customer_id, technician_id, scheduled_at, status, final_cost)
     values ($1,$2,$3,$4,'2031-02-14T01:00:00Z','pending',1200) returning id`,
    [cancelledPaymentCase.requestId, cancelledPaymentCase.estimateId, customerId, tech.A]
  )
)[0].id;
const cancelledPaymentId = (
  await query(
    `insert into public.payments (booking_id, customer_id, gcash_reference, amount, status)
     values ($1,$2,'GCASH-CANCELLED-1',1200,'pending_verification') returning id`,
    [cancelledPaymentBooking, customerId]
  )
)[0].id;
await query("update public.bookings set status = 'cancelled' where id = $1", [cancelledPaymentBooking]);

const verifyCancelled = (
  await query("select public.confirm_payment($1,$2) as result", [cancelledPaymentId, adminId])
)[0].result;
check(
  "verifying a payment for a cancelled appointment reports it instead of closing anything",
  verifyCancelled.outcome === "booking_cancelled" && verifyCancelled.completed_now === false,
  JSON.stringify(verifyCancelled)
);

const paymentState = (
  await query("select status, confirmed_by from public.payments where id = $1", [cancelledPaymentId])
)[0];
check(
  "and the payment is left pending for the administrator to reject",
  paymentState.status === "pending_verification" && paymentState.confirmed_by === null,
  JSON.stringify(paymentState)
);

const bookingState = (
  await query("select status from public.bookings where id = $1", [cancelledPaymentBooking])
)[0];
check(
  "the cancelled booking is not resurrected",
  bookingState.status === "cancelled",
  JSON.stringify(bookingState)
);


console.log("\n== 23. Atomic booking creation and double-booking prevention (Batch 2) ==");
// Every booking in this group goes through create_booking_atomic() — the single
// entry point POST /api/bookings now uses — and a DEDICATED technician is used so
// the availability and capacity limits configured below cannot disturb the queue
// fixtures the other groups depend on.

const techD = await provisionUser({
  email: "tech-d-booking@example.com",
  name: "Technician D",
  role: "technician",
  location: "Makati",
});
/**
 * Technician D is this group's OWN technician and is specialized in an appliance
 * type no other group uses, so the booking scenarios below cannot disturb the
 * shared refrigerator rotation — and, since step 17, the fixtures are genuinely
 * ELIGIBLE: a booking now requires the assigned technician to hold an active
 * membership of the request's appliance queue, which is what
 * `technicians.specializations` mirrors. Group 26 proves the refusals; this group
 * proves the legitimate path still works.
 */
const BOOKING_APPLIANCE = "electric_kettle";
await query(
  "update public.technicians set approved = true, approved_at = now(), specializations = $2 where id = $1",
  [techD, ["Electric Kettle"]]
);

/** A request assigned + accepted to technician D with one approved estimate. */
async function dFixture(label, startIso, cost = 900) {
  return bookableFixture(label, startIso, {
    technician: techD,
    cost,
    applianceType: BOOKING_APPLIANCE,
  });
}

async function techCounters(technicianId) {
  return (
    await query(
      "select active_job_load, jobs_completed from public.technicians where id = $1",
      [technicianId]
    )
  )[0];
}

async function requestState(requestId) {
  return (
    await query(
      "select status, assignment_status, assigned_technician_id, requested_window_start, requested_duration_minutes from public.service_requests where id = $1",
      [requestId]
    )
  )[0];
}

async function bookingsFor(requestId) {
  return (
    await query("select count(*)::int as n from public.bookings where service_request_id = $1", [
      requestId,
    ])
  )[0].n;
}

// --- 1-2. A legitimate booking moves the booking, the request AND the counter ---
const atomicFixture = await dFixture("Atomic booking", "2031-03-02T01:00:00Z");
const countersBefore = await techCounters(techD);
const atomicOutcome = await bookViaRpc(
  atomicFixture.requestId,
  atomicFixture.estimateId,
  "2031-03-02T01:00:00Z",
  { durationMinutes: 120 }
);
const countersAfter = await techCounters(techD);
const atomicRequest = await requestState(atomicFixture.requestId);
check(
  "a customer books a valid approved estimate through the atomic function",
  atomicOutcome.outcome === "booked" && Boolean(atomicOutcome.booking_id),
  JSON.stringify(atomicOutcome)
);
check(
  "the booking, the request state and the job-load counter all move together",
  (await bookingsFor(atomicFixture.requestId)) === 1 &&
    atomicRequest.status === "booked" &&
    atomicRequest.requested_window_start !== null &&
    countersAfter.active_job_load === countersBefore.active_job_load + 1,
  JSON.stringify({ atomicRequest, countersBefore, countersAfter })
);

// --- 3-4. A retry is idempotent: no second booking, no double-count -------------
const retryOutcome = await bookViaRpc(
  atomicFixture.requestId,
  atomicFixture.estimateId,
  "2031-03-02T01:00:00Z",
  { durationMinutes: 120 }
);
const countersAfterRetry = await techCounters(techD);
check(
  "a retry of a successful booking reports already_booked with the same booking id",
  retryOutcome.outcome === "already_booked" && retryOutcome.booking_id === atomicOutcome.booking_id,
  JSON.stringify(retryOutcome)
);
check(
  "the retry created no second booking and did not double-count the job",
  (await bookingsFor(atomicFixture.requestId)) === 1 &&
    countersAfterRetry.active_job_load === countersAfter.active_job_load,
  JSON.stringify({ countersAfter, countersAfterRetry })
);

// --- 10. Adjacent, half-open windows are allowed --------------------------------
// The atomic booking occupies 09:00-11:00 Manila; the next one starts exactly at
// 11:00 and must NOT be treated as a clash.
const adjacentFixture = await dFixture("Adjacent window", "2031-03-02T03:00:00Z");
const adjacentOutcome = await bookViaRpc(
  adjacentFixture.requestId,
  adjacentFixture.estimateId,
  "2031-03-02T03:00:00Z",
  { durationMinutes: 60 }
);
check(
  "an appointment starting exactly when the previous one ends is allowed (half-open intervals)",
  adjacentOutcome.outcome === "booked",
  JSON.stringify(adjacentOutcome)
);


// --- 9/11. An overlapping window on the same technician is refused --------------
const queueBeforeConflict = await queueOrder();
const countersBeforeConflict = await techCounters(techD);
const overlapFixture = await dFixture("Overlapping window", "2031-03-02T02:00:00Z");
const overlapOutcome = await bookViaRpc(
  overlapFixture.requestId,
  overlapFixture.estimateId,
  "2031-03-02T02:00:00Z",
  { durationMinutes: 60 }
);
check(
  "a second request cannot take an overlapping window on the same technician",
  overlapOutcome.outcome === "schedule_conflict",
  JSON.stringify(overlapOutcome)
);
check(
  "the refused booking left no row, no request change and no counter move",
  (await bookingsFor(overlapFixture.requestId)) === 0 &&
    (await requestState(overlapFixture.requestId)).status === "quoted" &&
    (await techCounters(techD)).active_job_load === countersBeforeConflict.active_job_load,
  JSON.stringify({
    rows: await bookingsFor(overlapFixture.requestId),
    request: await requestState(overlapFixture.requestId),
    before: countersBeforeConflict,
    after: await techCounters(techD),
  })
);
check(
  "a scheduling conflict does not touch the queue, the approval or the assignment",
  positions(queueBeforeConflict) === positions(await queueOrder()) &&
    (
      await query("select status, superseded_by from public.estimates where id = $1", [
        overlapFixture.estimateId,
      ])
    )[0].status === "accepted" &&
    (await requestState(overlapFixture.requestId)).assignment_status === "accepted",
  "queue, estimate and assignment must all be untouched"
);

// --- 8/9. The database itself refuses an overlapping write ----------------------
// Not just the function: any writer, including a service-role script, hits the same
// guard. It raises SQLSTATE 23P01 (exclusion_violation).
const rawOverlap = await (async () => {
  try {
    await query(
      `insert into public.bookings (service_request_id, estimate_id, customer_id, technician_id, scheduled_at, duration_minutes, status)
       values ($1,$2,$3,$4,'2031-03-02T02:30:00Z',60,'pending')`,
      [overlapFixture.requestId, overlapFixture.estimateId, customerId, techD]
    );
    return null;
  } catch (err) {
    return `${err.code}: ${err.message}`;
  }
})();
check(
  "a direct write that overlaps is refused by the database guard itself",
  rawOverlap !== null && /23P01/.test(rawOverlap) && /overlaps/.test(rawOverlap),
  rawOverlap ?? "the insert was ALLOWED"
);

// --- 14. Capacity: the daily job limit ------------------------------------------
await query("update public.technicians set max_jobs_per_day = 1 where id = $1", [techD]);
const countersBeforeCapacity = await techCounters(techD);
const capFixture = await dFixture("Capacity refusal", "2031-03-02T05:00:00Z");
const capOutcome = await bookViaRpc(capFixture.requestId, capFixture.estimateId, "2031-03-02T05:00:00Z", {
  durationMinutes: 60,
});
check(
  "a booking beyond the technician's daily job limit is refused with a capacity outcome",
  capOutcome.outcome === "capacity_daily_jobs" && typeof capOutcome.message === "string",
  JSON.stringify(capOutcome)
);
check(
  "the capacity refusal left no row, no request change and no counter move",
  (await bookingsFor(capFixture.requestId)) === 0 &&
    (await requestState(capFixture.requestId)).status === "quoted" &&
    (await techCounters(techD)).active_job_load === countersBeforeCapacity.active_job_load,
  JSON.stringify({ before: countersBeforeCapacity, after: await techCounters(techD) })
);

// --- 14b. Capacity: the daily hours limit ---------------------------------------
await query("update public.technicians set max_jobs_per_day = 4, max_daily_hours = 3 where id = $1", [
  techD,
]);
const hoursFixture = await dFixture("Daily hours refusal", "2031-03-02T06:00:00Z");
const hoursOutcome = await bookViaRpc(hoursFixture.requestId, hoursFixture.estimateId, "2031-03-02T06:00:00Z", {
  durationMinutes: 120,
});
check(
  "a booking that would exceed the technician's daily hours is refused",
  hoursOutcome.outcome === "capacity_daily_hours",
  JSON.stringify(hoursOutcome)
);
await query("update public.technicians set max_daily_hours = 8 where id = $1", [techD]);


// --- 13. A booking during approved time off is refused --------------------------
await query(
  `insert into public.technician_time_off (technician_id, starts_at, ends_at, reason)
   values ($1,'2031-03-04T00:00:00Z','2031-03-05T00:00:00Z','Training day')`,
  [techD]
);
const timeOffFixture = await dFixture("Time off", "2031-03-04T01:00:00Z");
const timeOffOutcome = await bookViaRpc(
  timeOffFixture.requestId,
  timeOffFixture.estimateId,
  "2031-03-04T01:00:00Z"
);
check(
  "a booking during approved time off is refused",
  timeOffOutcome.outcome === "schedule_conflict",
  JSON.stringify(timeOffOutcome)
);

// --- 12. Working hours: configured windows are enforced -------------------------
// Every weekday 09:00-17:00 in the service timezone (Asia/Manila, UTC+8), so the
// assertions below do not depend on which weekday a date happens to be.
for (let weekday = 0; weekday <= 6; weekday += 1) {
  await query(
    `insert into public.technician_availability (technician_id, weekday, start_time, end_time, is_active)
     values ($1,$2,'09:00','17:00',true)`,
    [techD, weekday]
  );
}

// 01:00Z = 09:00 Manila: inside the window, and the only booking that day.
const insideFixture = await dFixture("Inside working hours", "2031-03-06T01:00:00Z");
const insideOutcome = await bookViaRpc(
  insideFixture.requestId,
  insideFixture.estimateId,
  "2031-03-06T01:00:00Z",
  { durationMinutes: 60 }
);
check(
  "a booking inside the technician's working hours is allowed",
  insideOutcome.outcome === "booked",
  JSON.stringify(insideOutcome)
);

// 20:00Z = 04:00 Manila the next day: outside the window.
const outsideFixture = await dFixture("Outside working hours", "2031-03-06T20:00:00Z");
const outsideOutcome = await bookViaRpc(
  outsideFixture.requestId,
  outsideFixture.estimateId,
  "2031-03-06T20:00:00Z",
  { durationMinutes: 60 }
);
check(
  "a booking outside the technician's working hours is refused",
  outsideOutcome.outcome === "outside_availability_window" && typeof outsideOutcome.message === "string",
  JSON.stringify(outsideOutcome)
);

// --- 17/18/19. Authorization and estimate validity ------------------------------
const strangerOutcome = await bookViaRpc(
  foreignFixture.requestId,
  foreignFixture.estimateId,
  "2031-03-08T01:00:00Z",
  { actor: customerId }
);
check(
  "a customer cannot book another customer's request",
  strangerOutcome.outcome === "forbidden" && strangerOutcome.reason === "not_owner",
  JSON.stringify(strangerOutcome)
);

const technicianOutcome = await bookViaRpc(
  insideFixture.requestId,
  insideFixture.estimateId,
  "2031-03-09T01:00:00Z",
  { actor: techD }
);
check(
  "a technician cannot book anything",
  technicianOutcome.outcome === "forbidden",
  JSON.stringify(technicianOutcome)
);

// An estimate belonging to a DIFFERENT request.
const crossRequestFixture = await dFixture("Cross-request estimate", "2031-03-10T01:00:00Z");
const crossRequestOutcome = await bookViaRpc(
  crossRequestFixture.requestId,
  insideFixture.estimateId,
  "2031-03-10T01:00:00Z"
);
check(
  "an estimate from another request is refused",
  crossRequestOutcome.outcome === "estimate_invalid" && crossRequestOutcome.reason === "wrong_request",
  JSON.stringify(crossRequestOutcome)
);

// An estimate written by a technician who is not the assigned one. Built by hand:
// `bookableFixture` already adds an accepted estimate, and a request may hold only
// one (uniq_approved_estimate_per_request), so this request gets exactly one — from
// the wrong technician.
const wrongTechRequest = await createRequest(
  "2031-03-11T01:00:00Z",
  null,
  "Wrong technician estimate",
  BOOKING_APPLIANCE
);
await query(
  `update public.service_requests
      set assigned_technician_id = $2, assignment_status = 'accepted', status = 'quoted'
    where id = $1`,
  [wrongTechRequest, techD]
);
const foreignEstimateId = (
  await query(
    `insert into public.estimates (service_request_id, technician_id, estimated_cost, status, labor_cost)
     values ($1,$2,900,'accepted',900) returning id`,
    [wrongTechRequest, tech.A]
  )
)[0].id;
const wrongTechOutcome = await bookViaRpc(
  wrongTechRequest,
  foreignEstimateId,
  "2031-03-11T01:00:00Z"
);
check(
  "an estimate by a technician who is not assigned is refused",
  wrongTechOutcome.outcome === "estimate_invalid" && wrongTechOutcome.reason === "wrong_technician",
  JSON.stringify(wrongTechOutcome)
);

// A superseded version, and a version still awaiting a decision.
const versionedFixture = await dFixture("Superseded estimate", "2031-03-12T01:00:00Z");
await query("update public.estimates set status = 'superseded' where id = $1", [
  versionedFixture.estimateId,
]);
const supersededOutcome = await bookViaRpc(
  versionedFixture.requestId,
  versionedFixture.estimateId,
  "2031-03-12T01:00:00Z"
);
check(
  "a superseded estimate cannot be booked",
  supersededOutcome.outcome === "estimate_invalid" && supersededOutcome.reason === "superseded",
  JSON.stringify(supersededOutcome)
);

const pendingFixture = await dFixture("Unapproved estimate", "2031-03-13T01:00:00Z");
await query("update public.estimates set status = 'pending' where id = $1", [pendingFixture.estimateId]);
const unapprovedOutcome = await bookViaRpc(
  pendingFixture.requestId,
  pendingFixture.estimateId,
  "2031-03-13T01:00:00Z"
);
check(
  "an estimate still awaiting the customer's decision cannot be booked",
  unapprovedOutcome.outcome === "estimate_invalid" && unapprovedOutcome.reason === "not_approved",
  JSON.stringify(unapprovedOutcome)
);

// A request whose technician has not accepted yet.
const unassignedFixture = await dFixture("Not accepted yet", "2031-03-14T01:00:00Z");
await query("update public.service_requests set assignment_status = 'offered' where id = $1", [
  unassignedFixture.requestId,
]);
const notAssignedOutcome = await bookViaRpc(
  unassignedFixture.requestId,
  unassignedFixture.estimateId,
  "2031-03-14T01:00:00Z"
);
check(
  "a request whose technician has not accepted cannot be booked",
  notAssignedOutcome.outcome === "request_not_bookable" && notAssignedOutcome.reason === "not_assigned",
  JSON.stringify(notAssignedOutcome)
);


// --- 20/21. Batch 1 still works on a booking made by Batch 2 -------------------
// Book, confirm the inspection, pay, have the administrator verify: the whole
// lifecycle on a booking created by create_booking_atomic().
const e2eFixture = await dFixture("End-to-end", "2031-03-16T01:00:00Z", 950);
const e2eOutcome = await bookViaRpc(
  e2eFixture.requestId,
  e2eFixture.estimateId,
  "2031-03-16T01:00:00Z",
  { durationMinutes: 120 }
);
check(
  "the booking exists before the lifecycle runs",
  e2eOutcome.outcome === "booked",
  JSON.stringify(e2eOutcome)
);

const e2eBookingId = e2eOutcome.booking_id;
await query("update public.bookings set final_cost = 950 where id = $1", [e2eBookingId]);
await query("update public.bookings set status = 'in_progress' where id = $1", [e2eBookingId]);
await query("update public.bookings set status = 'awaiting_inspection' where id = $1", [e2eBookingId]);

const e2eConfirmed = await asUser(customerId, "authenticated", async () =>
  query(
    `update public.bookings
        set status = 'awaiting_payment',
            inspection_note = 'Customer confirmed the appliance is working properly.'
      where id = $1
      returning status`,
    [e2eBookingId]
  )
);
check(
  "the customer can still confirm the inspection on a Batch 2 booking",
  e2eConfirmed[0]?.status === "awaiting_payment",
  JSON.stringify(e2eConfirmed)
);

const e2ePaymentId = (
  await query(
    `insert into public.payments (booking_id, customer_id, gcash_reference, amount, status)
     values ($1,$2,'GCASH-BATCH2-1',950,'pending_verification') returning id`,
    [e2eBookingId, customerId]
  )
)[0].id;
const e2eVerified = (
  await query("select public.confirm_payment($1,$2) as result", [e2ePaymentId, adminId])
)[0].result;
check(
  "confirm_payment() still closes the repair and archives the history",
  e2eVerified.outcome === "confirmed" &&
    e2eVerified.completed_now === true &&
    (await query("select status from public.bookings where id = $1", [e2eBookingId]))[0].status ===
      "completed" &&
    (
      await query("select count(*)::int as n from public.service_history where booking_id = $1", [
        e2eBookingId,
      ])
    )[0].n === 1,
  JSON.stringify(e2eVerified)
);

// --- Giving the slot back: the counter must mirror the +1 exactly --------------
const releaseBefore = (await techCounters(techD)).active_job_load;
const released = (
  await query("select public.release_technician_slot($1) as load", [techD])
)[0].load;
check(
  "releasing a cancelled booking's slot lowers the counter by exactly one",
  released === releaseBefore - 1,
  JSON.stringify({ releaseBefore, released })
);

// Floored at zero: a technician can never be pushed negative by a double cancel.
await query("update public.technicians set active_job_load = 0 where id = $1", [techD]);
const releasedAtZero = (await query("select public.release_technician_slot($1) as load", [techD]))[0]
  .load;
check(
  "the counter is floored at zero when a booking is cancelled twice",
  releasedAtZero === 0,
  JSON.stringify({ releasedAtZero })
);
await query("update public.technicians set active_job_load = $2 where id = $1", [
  techD,
  releaseBefore - 1,
]);

const releaseGrants = await query(
  `select has_function_privilege('authenticated', 'public.release_technician_slot(uuid)', 'EXECUTE') as authenticated_can
     , has_function_privilege('service_role', 'public.release_technician_slot(uuid)', 'EXECUTE') as service_role_can`
);
check(
  "the slot release is service-role only, like the booking function",
  releaseGrants[0].authenticated_can === false && releaseGrants[0].service_role_can === true,
  JSON.stringify(releaseGrants)
);

// --- Concurrency: what this harness can and cannot prove -----------------------
// PGlite is a single connection, so two transactions cannot truly interleave here.
// What IS proven: both guards exist, are enforced by the database rather than by a
// route, and refuse the second write (the unique index for one live booking per
// request; the overlap trigger, which serializes on a per-technician advisory lock,
// for the technician's window). A live two-client race still has to be exercised
// against Supabase — see TESTING.md.
const guardIndexes = await query(
  "select indexname from pg_indexes where schemaname = 'public' and indexname = 'uniq_active_booking_per_request'"
);
check(
  "the one-live-booking-per-request index exists (DB-level race guard)",
  guardIndexes.length === 1,
  JSON.stringify(guardIndexes)
);

const overlapTrigger = await query(
  `select t.tgname from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
    where c.relname = 'bookings' and t.tgname = 'trg_booking_no_overlap' and not t.tgisinternal`
);
check(
  "the overlapping-appointment guard is installed on bookings",
  overlapTrigger.length === 1,
  JSON.stringify(overlapTrigger)
);

const serializingLock = await query(
  `select p.proname from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_booking_atomic', 'enforce_booking_no_overlap', 'release_technician_slot')
    order by p.proname`
);
check(
  "the atomic function, the overlap guard and the slot release are all present",
  serializingLock.length === 3,
  JSON.stringify(serializingLock)
);


console.log("\n== 24. Database-enforced payment rejection (Batch 3) ==");
// Every decision about a payment now runs inside one database function. This group
// proves the database - not the route - is the boundary: the actor's role is
// re-read from public.users, the reason is required, a decision is final, and a
// rejection can never be recorded as a verification. It also proves a rejection
// moves NOTHING else: the booking, the service request, the technician's slot
// counter and service_history are all untouched.
//
// The migration is loaded twice at startup (once in the chain, once on its own), so
// idempotence is proven before this group runs.

/** A repair sitting at the payment step, with a pending GCash reference. */
async function paymentStepFixture(label, startIso, options = {}) {
  const { technician = tech.B, cost = 900, reference = "GCASH-B3-001" } = options;
  const fixture = await bookableFixture(label, startIso, { technician, cost });
  const bookingId = (
    await query(
      `insert into public.bookings
         (service_request_id, estimate_id, customer_id, technician_id, scheduled_at, status,
          final_cost, inspection_note, inspection_confirmed_at)
       values ($1,$2,$3,$4,$5,'awaiting_payment',$6,$7,now()) returning id`,
      [
        fixture.requestId,
        fixture.estimateId,
        customerId,
        technician,
        startIso,
        cost,
        "Customer confirmed the appliance is working properly.",
      ]
    )
  )[0].id;
  await query("update public.service_requests set status = 'booked' where id = $1", [
    fixture.requestId,
  ]);
  await query(
    "update public.technicians set active_job_load = active_job_load + 1 where id = $1",
    [technician]
  );
  const paymentId = (
    await query(
      `insert into public.payments (booking_id, customer_id, gcash_reference, amount, status)
       values ($1,$2,$3,$4,'pending_verification') returning id`,
      [bookingId, customerId, reference, cost]
    )
  )[0].id;
  return { ...fixture, bookingId, paymentId, technician, cost };
}

/** A direct-session write (the service-role shape): returns the error, or null. */
async function refused(sql, params) {
  try {
    await query(sql, params);
    return null;
  } catch (err) {
    return err.message;
  }
}

const rejectPaymentRow = (id) =>
  query(
    `select status, confirmed_by, confirmed_at, rejected_by, rejected_at, rejection_reason
       from public.payments where id = $1`,
    [id]
  ).then((rows) => rows[0]);
const rejectionFixture = await paymentStepFixture("Rejection", "2031-04-02T01:00:00Z", {
  reference: "GCASH-B3-REJ",
});
const rejectionCountersBefore = await techCounters(rejectionFixture.technician);
const rejectionRequestBefore = await requestState(rejectionFixture.requestId);

// --- Authorization: the role is re-read from the database ----------------------
const customerReject = (
  await query("select public.reject_payment($1,$2,$3) as result", [
    rejectionFixture.paymentId,
    customerId,
    "The customer would like to reject their own reference",
  ])
)[0].result;
check(
  "a customer cannot reject a payment, even by calling the function directly",
  customerReject.outcome === "forbidden",
  JSON.stringify(customerReject)
);

const customerRejectAsRole = await refusedBy(
  customerId,
  "authenticated",
  "select public.reject_payment($1,$2,$3)",
  [rejectionFixture.paymentId, customerId, "reason"]
);
check(
  "a customer's own session cannot execute reject_payment at all",
  customerRejectAsRole !== null,
  customerRejectAsRole ?? "the call was ALLOWED"
);

const technicianReject = (
  await query("select public.reject_payment($1,$2,$3) as result", [
    rejectionFixture.paymentId,
    tech.A,
    "The technician would like to reject this reference",
  ])
)[0].result;
check(
  "a technician cannot reject a payment",
  technicianReject.outcome === "forbidden",
  JSON.stringify(technicianReject)
);

const strangerReject = (
  await query("select public.reject_payment($1, gen_random_uuid(), $2) as result", [
    rejectionFixture.paymentId,
    "An unknown account cannot reject anything",
  ])
)[0].result;
check(
  "an unknown actor cannot reject a payment",
  strangerReject.outcome === "forbidden",
  JSON.stringify(strangerReject)
);

const rejectGrants = (
  await query(
    `select has_function_privilege('authenticated', 'public.reject_payment(uuid,uuid,text)', 'EXECUTE') as authenticated_can
       , has_function_privilege('service_role', 'public.reject_payment(uuid,uuid,text)', 'EXECUTE') as service_role_can`
  )
)[0];
check(
  "rejecting a payment is service-role only, like verifying one",
  rejectGrants.authenticated_can === false && rejectGrants.service_role_can === true,
  JSON.stringify(rejectGrants)
);

// --- Validation: a reason is required, bounded, and trimmed --------------------
const emptyReason = (
  await query("select public.reject_payment($1,$2,$3) as result", [
    rejectionFixture.paymentId,
    adminId,
    "",
  ])
)[0].result;
check(
  "an empty reason is refused",
  emptyReason.outcome === "invalid_input" && emptyReason.reason === "missing_reason",
  JSON.stringify(emptyReason)
);

const whitespaceReason = (
  await query("select public.reject_payment($1,$2,$3) as result", [
    rejectionFixture.paymentId,
    adminId,
    "    \n\t  ",
  ])
)[0].result;
check(
  "a whitespace-only reason is refused",
  whitespaceReason.outcome === "invalid_input" && whitespaceReason.reason === "missing_reason",
  JSON.stringify(whitespaceReason)
);

const longReason = (
  await query("select public.reject_payment($1,$2,$3) as result", [
    rejectionFixture.paymentId,
    adminId,
    "x".repeat(501),
  ])
)[0].result;
check(
  "a reason longer than 500 characters is refused",
  longReason.outcome === "invalid_input" &&
    longReason.reason === "reason_too_long" &&
    longReason.max_length === 500,
  JSON.stringify(longReason)
);

const unknownPayment = (
  await query("select public.reject_payment(gen_random_uuid(),$1,$2) as result", [
    adminId,
    "This payment does not exist",
  ])
)[0].result;
check(
  "rejecting a payment that does not exist reports not_found",
  unknownPayment.outcome === "not_found",
  JSON.stringify(unknownPayment)
);

const untouchedAfterRefusals = await rejectPaymentRow(rejectionFixture.paymentId);
check(
  "a refused rejection leaves the payment pending, with no metadata written",
  untouchedAfterRefusals.status === "pending_verification" &&
    untouchedAfterRefusals.confirmed_by === null &&
    untouchedAfterRefusals.rejected_by === null &&
    untouchedAfterRefusals.rejection_reason === null,
  JSON.stringify(untouchedAfterRefusals)
);
// --- A successful rejection: the decision, and NOTHING else --------------------
const rejectOutcome = (
  await query("select public.reject_payment($1,$2,$3) as result", [
    rejectionFixture.paymentId,
    adminId,
    "   The GCash reference does not match any payment we received.   ",
  ])
)[0].result;
check(
  "an administrator rejects a pending reference",
  rejectOutcome.outcome === "rejected" &&
    rejectOutcome.payment_status === "rejected" &&
    rejectOutcome.booking_status === "awaiting_payment",
  JSON.stringify(rejectOutcome)
);

const rejectedRow = await rejectPaymentRow(rejectionFixture.paymentId);
check(
  "the rejection is recorded on its OWN columns, never as a verification",
  rejectedRow.status === "rejected" &&
    rejectedRow.confirmed_by === null &&
    rejectedRow.confirmed_at === null &&
    rejectedRow.rejected_by === adminId &&
    rejectedRow.rejected_at !== null,
  JSON.stringify(rejectedRow)
);
check(
  "the stored reason is trimmed and kept for the customer to read",
  rejectedRow.rejection_reason === "The GCash reference does not match any payment we received.",
  JSON.stringify(rejectedRow.rejection_reason)
);
check(
  "the rejected row is the one the function reports back",
  rejectOutcome.payment?.rejection_reason === rejectedRow.rejection_reason &&
    rejectOutcome.payment?.confirmed_at === null,
  JSON.stringify(rejectOutcome.payment)
);

const bookingAfterRejection = (
  await query("select status, final_cost, inspection_confirmed_at from public.bookings where id = $1", [
    rejectionFixture.bookingId,
  ])
)[0];
check(
  "the repair stays at the payment step: the booking is untouched",
  bookingAfterRejection.status === "awaiting_payment" &&
    Number(bookingAfterRejection.final_cost) === rejectionFixture.cost &&
    bookingAfterRejection.inspection_confirmed_at !== null,
  JSON.stringify(bookingAfterRejection)
);

const requestAfterRejection = await requestState(rejectionFixture.requestId);
check(
  "the service request is untouched by a rejection",
  requestAfterRejection.status === rejectionRequestBefore.status &&
    requestAfterRejection.assignment_status === rejectionRequestBefore.assignment_status,
  JSON.stringify({ rejectionRequestBefore, requestAfterRejection })
);

const countersAfterRejection = await techCounters(rejectionFixture.technician);
check(
  "the technician's slot is NOT released by a rejection (the repair is still owed)",
  countersAfterRejection.active_job_load === rejectionCountersBefore.active_job_load &&
    countersAfterRejection.jobs_completed === rejectionCountersBefore.jobs_completed,
  JSON.stringify({ rejectionCountersBefore, countersAfterRejection })
);

const historyAfterRejection = await query(
  "select count(*)::int as n from public.service_history where booking_id = $1",
  [rejectionFixture.bookingId]
);
check(
  "a rejection archives no service history",
  historyAfterRejection[0].n === 0,
  JSON.stringify(historyAfterRejection)
);

// --- A decision is final ------------------------------------------------------
const secondReject = (
  await query("select public.reject_payment($1,$2,$3) as result", [
    rejectionFixture.paymentId,
    adminId,
    "A second, different reason",
  ])
)[0].result;
check(
  "rejecting the same reference twice reports not_pending and changes nothing",
  secondReject.outcome === "not_pending" && secondReject.payment_status === "rejected",
  JSON.stringify(secondReject)
);

const afterSecondReject = await rejectPaymentRow(rejectionFixture.paymentId);
check(
  "the first decision is preserved: administrator, timestamp and reason",
  afterSecondReject.rejected_by === adminId &&
    afterSecondReject.rejection_reason === rejectedRow.rejection_reason &&
    // timestamptz comes back as a Date, so compare instants rather than object identity.
    new Date(afterSecondReject.rejected_at).getTime() === new Date(rejectedRow.rejected_at).getTime(),
  JSON.stringify(afterSecondReject)
);

const confirmRejected = (
  await query("select public.confirm_payment($1,$2) as result", [
    rejectionFixture.paymentId,
    adminId,
  ])
)[0].result;
check(
  "a rejected reference can never be verified afterwards",
  confirmRejected.outcome === "not_pending",
  JSON.stringify(confirmRejected)
);

const afterConfirmAttempt = await rejectPaymentRow(rejectionFixture.paymentId);
check(
  "the verification attempt did not rewrite the rejection",
  afterConfirmAttempt.status === "rejected" &&
    afterConfirmAttempt.confirmed_by === null &&
    afterConfirmAttempt.confirmed_at === null,
  JSON.stringify(afterConfirmAttempt)
);
// --- Legacy: a pending reference on a repair that is already completed ---------
// Rejecting is allowed whenever the PAYMENT is still pending, even if its booking
// was closed under the pre-policy path. Only the payment row moves; the completed
// booking and its archived history are left exactly as they were.
const legacyRejectionFixture = await paymentStepFixture("Legacy completed repair", "2031-04-03T01:00:00Z", {
  reference: "GCASH-B3-LEGACY",
  cost: 750,
});
await query("update public.bookings set status = 'completed' where id = $1", [
  legacyRejectionFixture.bookingId,
]);
await query(
  `insert into public.service_history (booking_id, customer_id, technician_id, appliance_type, final_cost, summary)
   values ($1,$2,$3,'refrigerator',$4,'Repair completed before the payment policy existed.')`,
  [legacyRejectionFixture.bookingId, customerId, legacyRejectionFixture.technician, legacyRejectionFixture.cost]
);
const legacyHistoryBefore = (
  await query("select summary from public.service_history where booking_id = $1", [
    legacyRejectionFixture.bookingId,
  ])
)[0];

const legacyReject = (
  await query("select public.reject_payment($1,$2,$3) as result", [
    legacyRejectionFixture.paymentId,
    adminId,
    "This reference duplicates one that was already verified.",
  ])
)[0].result;
check(
  "a pending reference can still be rejected when its booking is already completed (legacy repair)",
  legacyReject.outcome === "rejected" && legacyReject.booking_status === "completed",
  JSON.stringify(legacyReject)
);

const legacyBookingAfter = (
  await query("select status, final_cost from public.bookings where id = $1", [
    legacyRejectionFixture.bookingId,
  ])
)[0];
check(
  "...and the completed booking is left exactly as it was",
  legacyBookingAfter.status === "completed" &&
    Number(legacyBookingAfter.final_cost) === legacyRejectionFixture.cost,
  JSON.stringify(legacyBookingAfter)
);

const legacyHistoryAfter = (
  await query(
    "select count(*)::int as n, min(summary) as summary from public.service_history where booking_id = $1",
    [legacyRejectionFixture.bookingId]
  )
)[0];
check(
  "...and its archived service history is untouched",
  legacyHistoryAfter.n === 1 && legacyHistoryAfter.summary === legacyHistoryBefore.summary,
  JSON.stringify({ legacyHistoryBefore, legacyHistoryAfter })
);
// --- The guards hold for any writer, including the service role ----------------
const guardFixture = await paymentStepFixture("Decision guards", "2031-04-04T01:00:00Z", {
  reference: "GCASH-B3-GUARD",
});

const mislabelled = await refused(
  `update public.payments
      set status = 'rejected', rejected_by = $2, rejected_at = now(),
          rejection_reason = 'guard test', confirmed_at = now()
    where id = $1`,
  [guardFixture.paymentId, adminId]
);
check(
  "a rejected payment cannot be recorded as verified, even by a direct write",
  mislabelled !== null && /cannot be recorded as verified/.test(mislabelled),
  mislabelled ?? "the update was ALLOWED"
);

const rejectionWithoutReason = await refused(
  `update public.payments
      set status = 'rejected', rejected_by = $2, rejected_at = now()
    where id = $1`,
  [guardFixture.paymentId, adminId]
);
check(
  "a rejected payment with no reason is refused",
  rejectionWithoutReason !== null,
  rejectionWithoutReason ?? "the update was ALLOWED"
);

const pendingMetadata = await refused(
  `update public.payments set rejection_reason = 'sneaky' where id = $1`,
  [guardFixture.paymentId]
);
check(
  "a pending payment cannot carry decision metadata",
  pendingMetadata !== null && /pending payment cannot carry/.test(pendingMetadata),
  pendingMetadata ?? "the update was ALLOWED"
);

const immutableAmount = await refused("update public.payments set amount = 1 where id = $1", [
  guardFixture.paymentId,
]);
check(
  "a payment's amount is immutable after submission",
  immutableAmount !== null && /immutable/.test(immutableAmount),
  immutableAmount ?? "the update was ALLOWED"
);

const immutableReference = await refused(
  "update public.payments set gcash_reference = 'CHANGED-REF' where id = $1",
  [guardFixture.paymentId]
);
check(
  "a payment's reference is immutable after submission",
  immutableReference !== null && /immutable/.test(immutableReference),
  immutableReference ?? "the update was ALLOWED"
);

const reopenedDecision = await refused(
  `update public.payments
      set status = 'pending_verification', confirmed_by = null, confirmed_at = null,
          rejected_by = null, rejected_at = null, rejection_reason = null
    where id = $1`,
  [rejectionFixture.paymentId]
);
check(
  "a decided payment cannot be moved back to pending",
  reopenedDecision !== null && /decision is final/.test(reopenedDecision),
  reopenedDecision ?? "the update was ALLOWED"
);

const guardRow = await rejectPaymentRow(guardFixture.paymentId);
check(
  "every refused write left the row pending and untouched",
  guardRow.status === "pending_verification" &&
    guardRow.rejection_reason === null &&
    guardRow.confirmed_at === null &&
    guardRow.rejected_by === null,
  JSON.stringify(guardRow)
);
// --- Resubmission after a rejection (behaviour this batch preserves) -----------
const resubmitted = await asUser(customerId, "authenticated", async () =>
  query(
    `insert into public.payments (booking_id, customer_id, gcash_reference, amount, status)
     values ($1,$2,'GCASH-B3-RETRY',$3,'pending_verification') returning id`,
    [rejectionFixture.bookingId, customerId, rejectionFixture.cost]
  )
);
check(
  "the customer can submit a new reference after a rejection",
  resubmitted.length === 1,
  JSON.stringify(resubmitted)
);

const preRejected = await refusedBy(
  customerId,
  "authenticated",
  `insert into public.payments (booking_id, customer_id, gcash_reference, amount, status, rejection_reason)
   values ($1,$2,'GCASH-B3-PRE',$3,'pending_verification','pre-loaded rejection')`,
  [guardFixture.bookingId, customerId, guardFixture.cost]
);
check(
  "a customer cannot submit a payment that already carries rejection metadata",
  preRejected !== null,
  preRejected ?? "the insert was ALLOWED"
);

// --- Regression: confirm_payment() is unchanged -------------------------------
const confirmFixture = await paymentStepFixture("Batch 3 regression", "2031-04-05T01:00:00Z", {
  reference: "GCASH-B3-OK",
});
const confirmCountersBefore = await techCounters(confirmFixture.technician);
const confirmOutcome = (
  await query("select public.confirm_payment($1,$2) as result", [
    confirmFixture.paymentId,
    adminId,
  ])
)[0].result;
check(
  "confirm_payment() still completes a repair in one transaction",
  confirmOutcome.outcome === "confirmed" && confirmOutcome.completed_now === true,
  JSON.stringify(confirmOutcome)
);

const confirmedRow = await rejectPaymentRow(confirmFixture.paymentId);
check(
  "a verified payment records its verifier and carries no rejection metadata",
  confirmedRow.status === "confirmed" &&
    confirmedRow.confirmed_by === adminId &&
    confirmedRow.confirmed_at !== null &&
    confirmedRow.rejected_by === null &&
    confirmedRow.rejected_at === null &&
    confirmedRow.rejection_reason === null,
  JSON.stringify(confirmedRow)
);

const confirmBooking = (
  await query("select status from public.bookings where id = $1", [confirmFixture.bookingId])
)[0];
const confirmHistory = (
  await query("select count(*)::int as n from public.service_history where booking_id = $1", [
    confirmFixture.bookingId,
  ])
)[0];
const confirmRequest = await requestState(confirmFixture.requestId);
check(
  "completion still closes the booking, archives the history and closes the request",
  confirmBooking.status === "completed" && confirmHistory.n === 1 && confirmRequest.status === "completed",
  JSON.stringify({ confirmBooking, confirmHistory, confirmRequest })
);

const confirmCountersAfter = await techCounters(confirmFixture.technician);
check(
  "completion still moves the technician's counters once",
  confirmCountersAfter.jobs_completed === confirmCountersBefore.jobs_completed + 1 &&
    confirmCountersAfter.active_job_load === confirmCountersBefore.active_job_load - 1,
  JSON.stringify({ confirmCountersBefore, confirmCountersAfter })
);

const legacyConfirmFixture = await paymentStepFixture("Batch 3 legacy confirm", "2031-04-06T01:00:00Z", {
  reference: "GCASH-B3-LEGACY2",
  cost: 600,
});
await query("update public.bookings set status = 'completed' where id = $1", [
  legacyConfirmFixture.bookingId,
]);
const legacyConfirm = (
  await query("select public.confirm_payment($1,$2) as result", [
    legacyConfirmFixture.paymentId,
    adminId,
  ])
)[0].result;
check(
  "confirm_payment() still verifies a reference on an already-completed repair without rewriting it",
  legacyConfirm.outcome === "confirmed_legacy" && legacyConfirm.completed_now === false,
  JSON.stringify(legacyConfirm)
);

// --- The trim character set: whitespace is stripped, letters are not -----------
// The set is spelled `E' \t\n\r\f' || chr(11)` rather than with `E'\v'`, so it does
// not depend on how a PostgreSQL build reads that escape. An unrecognised escape
// would silently add the letter `v` to the set (trimming a legitimate reason) and
// would leave a vertical tab in place (letting a blank reason through).
const trimSet = (
  await query(
    `select btrim(chr(11), E' \\t\\n\\r\\f' || chr(11)) = '' as vt_stripped
          , btrim('voucher not received', E' \\t\\n\\r\\f' || chr(11)) = 'voucher not received' as v_kept
          , btrim('reference 1234v', E' \\t\\n\\r\\f' || chr(11)) = 'reference 1234v' as v_tail_kept`
  )
)[0];
check(
  "the trim set strips a vertical tab and keeps a 'v' at either end",
  trimSet.vt_stripped === true && trimSet.v_kept === true && trimSet.v_tail_kept === true,
  JSON.stringify(trimSet)
);

const vHeadFixture = await paymentStepFixture("Trim head", "2031-04-07T01:00:00Z", {
  reference: "GCASH-B3-TRIMV",
});
const vHeadReason = "voucher not received";
const vHeadOutcome = (
  await query("select public.reject_payment($1,$2,$3) as result", [
    vHeadFixture.paymentId,
    adminId,
    vHeadReason,
  ])
)[0].result;
const vHeadRow = await rejectPaymentRow(vHeadFixture.paymentId);
check(
  "a stored reason that begins with 'v' is kept intact",
  vHeadOutcome.outcome === "rejected" && vHeadRow.rejection_reason === vHeadReason,
  JSON.stringify({ vHeadOutcome, vHeadRow })
);

const vTailFixture = await paymentStepFixture("Trim tail", "2031-04-08T01:00:00Z", {
  reference: "GCASH-B3-TAILV",
});
const vTailReason = "reference 1234v";
await query("select public.reject_payment($1,$2,$3) as result", [
  vTailFixture.paymentId,
  adminId,
  vTailReason,
]);
const vTailRow = await rejectPaymentRow(vTailFixture.paymentId);
check(
  "a stored reason that ends with 'v' is kept intact",
  vTailRow.rejection_reason === vTailReason,
  JSON.stringify(vTailRow)
);

const vtTrimFixture = await paymentStepFixture("Trim vertical tab", "2031-04-09T01:00:00Z", {
  reference: "GCASH-B3-WS",
});
const vtWrappedReason = "\u000b\t paid twice \n\u000b";
await query("select public.reject_payment($1,$2,$3) as result", [
  vtTrimFixture.paymentId,
  adminId,
  vtWrappedReason,
]);
const vtTrimRow = await rejectPaymentRow(vtTrimFixture.paymentId);
check(
  "a reason wrapped in tabs, newlines and vertical tabs is trimmed to its text",
  vtTrimRow.rejection_reason === "paid twice",
  JSON.stringify(vtTrimRow.rejection_reason)
);

const vtOnlyFixture = await paymentStepFixture("Vertical tab only", "2031-04-10T01:00:00Z", {
  reference: "GCASH-B3-VTONLY",
});
const vtOnly = (
  await query("select public.reject_payment($1,$2,$3) as result", [
    vtOnlyFixture.paymentId,
    adminId,
    "\u000b\u000b\u000b",
  ])
)[0].result;
check(
  "a reason made only of vertical tabs is refused",
  vtOnly.outcome === "invalid_input" && vtOnly.reason === "missing_reason",
  JSON.stringify(vtOnly)
);

const vtOnlyRow = await rejectPaymentRow(vtOnlyFixture.paymentId);
check(
  "...and nothing was written for it",
  vtOnlyRow.status === "pending_verification" &&
    vtOnlyRow.rejection_reason === null &&
    vtOnlyRow.rejected_by === null,
  JSON.stringify(vtOnlyRow)
);

const vtDirect = await refused(
  `update public.payments
      set status = 'rejected', rejected_by = $2, rejected_at = now(), rejection_reason = $3
    where id = $1`,
  [vtOnlyFixture.paymentId, adminId, "\u000b\u000b"]
);
check(
  "a direct write of a vertical-tab-only reason is refused (trigger or constraint)",
  vtDirect !== null,
  vtDirect ?? "the update was ALLOWED"
);

// --- A decided payment is frozen: its status AND its metadata ------------------
// The trigger used to allow edits to decision metadata as long as the status did
// not change, so a rejection reason, the administrator who refused it or the
// timestamp could be rewritten while the row still said `rejected`. Both fixtures
// below were decided earlier in this group.
const frozenRejection = await rejectPaymentRow(rejectionFixture.paymentId);
const frozenConfirmation = await rejectPaymentRow(confirmFixture.paymentId);

const rewriteReason = await refused(
  "update public.payments set rejection_reason = 'a different explanation' where id = $1",
  [rejectionFixture.paymentId]
);
check(
  "a rejection reason cannot be overwritten after the fact",
  rewriteReason !== null && /decision is final/.test(rewriteReason),
  rewriteReason ?? "the update was ALLOWED"
);

const rewriteRejector = await refused(
  "update public.payments set rejected_by = $2 where id = $1",
  [rejectionFixture.paymentId, tech.A]
);
check(
  "the administrator who rejected cannot be swapped out",
  rewriteRejector !== null && /decision is final/.test(rewriteRejector),
  rewriteRejector ?? "the update was ALLOWED"
);

const rewriteRejectedAt = await refused(
  "update public.payments set rejected_at = now() where id = $1",
  [rejectionFixture.paymentId]
);
check(
  "the rejection timestamp cannot be moved",
  rewriteRejectedAt !== null && /decision is final/.test(rewriteRejectedAt),
  rewriteRejectedAt ?? "the update was ALLOWED"
);

const blankRejection = await refused(
  `update public.payments
      set rejected_by = null, rejected_at = null, rejection_reason = null
    where id = $1`,
  [rejectionFixture.paymentId]
);
check(
  "a rejection cannot be blanked out",
  blankRejection !== null && /decision is final/.test(blankRejection),
  blankRejection ?? "the update was ALLOWED"
);

const rewriteVerifier = await refused(
  "update public.payments set confirmed_by = $2 where id = $1",
  [confirmFixture.paymentId, tech.A]
);
check(
  "the administrator who verified cannot be swapped out",
  rewriteVerifier !== null && /decision is final/.test(rewriteVerifier),
  rewriteVerifier ?? "the update was ALLOWED"
);

const rewriteConfirmedAt = await refused(
  "update public.payments set confirmed_at = now() where id = $1",
  [confirmFixture.paymentId]
);
check(
  "the verification timestamp cannot be moved",
  rewriteConfirmedAt !== null && /decision is final/.test(rewriteConfirmedAt),
  rewriteConfirmedAt ?? "the update was ALLOWED"
);

const addRejectionToConfirmed = await refused(
  "update public.payments set rejection_reason = 'retrofit' where id = $1",
  [confirmFixture.paymentId]
);
check(
  "a verified payment cannot be annotated with rejection metadata",
  addRejectionToConfirmed !== null && /decision is final/.test(addRejectionToConfirmed),
  addRejectionToConfirmed ?? "the update was ALLOWED"
);

const stillFrozenRejection = await rejectPaymentRow(rejectionFixture.paymentId);
check(
  "the original rejection survives every attempt: same reason, administrator and timestamp",
  stillFrozenRejection.status === "rejected" &&
    stillFrozenRejection.rejection_reason === frozenRejection.rejection_reason &&
    stillFrozenRejection.rejected_by === frozenRejection.rejected_by &&
    new Date(stillFrozenRejection.rejected_at).getTime() ===
      new Date(frozenRejection.rejected_at).getTime() &&
    stillFrozenRejection.confirmed_by === null,
  JSON.stringify({ frozenRejection, stillFrozenRejection })
);

const stillFrozenConfirmation = await rejectPaymentRow(confirmFixture.paymentId);
check(
  "the verification survives too: same verifier and timestamp, still no rejection metadata",
  stillFrozenConfirmation.status === "confirmed" &&
    stillFrozenConfirmation.confirmed_by === frozenConfirmation.confirmed_by &&
    new Date(stillFrozenConfirmation.confirmed_at).getTime() ===
      new Date(frozenConfirmation.confirmed_at).getTime() &&
    stillFrozenConfirmation.rejected_by === null &&
    stillFrozenConfirmation.rejection_reason === null,
  JSON.stringify({ frozenConfirmation, stillFrozenConfirmation })
);

// The freeze must not leak into the normal path: a payment that is still pending is
// decided exactly as before.
const afterFrozenFixture = await paymentStepFixture("Still decidable", "2031-04-11T01:00:00Z", {
  reference: "GCASH-B3-AFTER",
});
const stillDecidable = (
  await query("select public.reject_payment($1,$2,$3) as result", [
    afterFrozenFixture.paymentId,
    adminId,
    "Still decidable after all of those refusals",
  ])
)[0].result;
check(
  "a pending payment is still decidable after all of those refusals",
  stillDecidable.outcome === "rejected",
  JSON.stringify(stillDecidable)
);

// --- The objects the migration installs ---------------------------------------
const decisionColumns = await query(
  `select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'payments'
      and column_name in ('rejected_by','rejected_at','rejection_reason')`
);
check(
  "the three rejection columns exist",
  decisionColumns.length === 3,
  JSON.stringify(decisionColumns)
);

const decisionConstraint = await query(
  "select conname from pg_constraint where conname = 'payments_decision_metadata_check'"
);
check(
  "the decision metadata constraint is installed",
  decisionConstraint.length === 1,
  JSON.stringify(decisionConstraint)
);

const decisionTrigger = await query(
  `select t.tgname from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
    where c.relname = 'payments' and t.tgname = 'enforce_payment_decision_rules' and not t.tgisinternal`
);
check(
  "the decision trigger is installed on payments",
  decisionTrigger.length === 1,
  JSON.stringify(decisionTrigger)
);
console.log("\n== 25. Payment write authorization: which guard refuses what (Batch 3) ==");
// Every refusal below is attributed to ONE mechanism, and each test says which:
//   table privilege   -> SQLSTATE 42501 raised by the table
//   RLS               -> no error at all: the statement simply matches no row
//   function grant    -> SQLSTATE 42501 raised by the RPC
//   RPC authorization -> the function returns outcome 'forbidden' (or raises)
//   CHECK constraint  -> the constraint is named in the error
//   trigger           -> the trigger's own message
// A refusal by one of these is never counted as proof of another.

/** Run a statement as a role; returns { code, message }, or null when it succeeded. */
async function refusal(userId, role, sql, params) {
  return asUser(userId, role, async () => {
    try {
      await query(sql, params);
      return null;
    } catch (err) {
      return { code: err.code ?? null, message: err.message ?? String(err) };
    }
  });
}

// --- The effective privileges, and who owns the functions ----------------------
// Every table privilege is checked by name for every role: TRUNCATE, REFERENCES and
// TRIGGER are separate privileges from INSERT/UPDATE/DELETE, and they are not
// row-scoped - TRUNCATE ignores RLS completely, and no policy can restrict
// REFERENCES or TRIGGER either.
const tablePrivs = (
  await query(`
    select
      has_table_privilege('service_role','public.payments','SELECT')     as svc_select,
      has_table_privilege('service_role','public.payments','INSERT')     as svc_insert,
      has_table_privilege('service_role','public.payments','UPDATE')     as svc_update,
      has_table_privilege('service_role','public.payments','DELETE')     as svc_delete,
      has_table_privilege('service_role','public.payments','TRUNCATE')   as svc_truncate,
      has_table_privilege('service_role','public.payments','REFERENCES') as svc_references,
      has_table_privilege('service_role','public.payments','TRIGGER')    as svc_trigger,
      has_table_privilege('authenticated','public.payments','SELECT')     as auth_select,
      has_table_privilege('authenticated','public.payments','INSERT')     as auth_insert,
      has_table_privilege('authenticated','public.payments','UPDATE')     as auth_update,
      has_table_privilege('authenticated','public.payments','DELETE')     as auth_delete,
      has_table_privilege('authenticated','public.payments','TRUNCATE')   as auth_truncate,
      has_table_privilege('authenticated','public.payments','REFERENCES') as auth_references,
      has_table_privilege('authenticated','public.payments','TRIGGER')    as auth_trigger,
      has_table_privilege('anon','public.payments','SELECT')     as anon_select,
      has_table_privilege('anon','public.payments','INSERT')     as anon_insert,
      has_table_privilege('anon','public.payments','UPDATE')     as anon_update,
      has_table_privilege('anon','public.payments','DELETE')     as anon_delete,
      has_table_privilege('anon','public.payments','TRUNCATE')   as anon_truncate,
      has_table_privilege('anon','public.payments','REFERENCES') as anon_references,
      has_table_privilege('anon','public.payments','TRIGGER')    as anon_trigger,
      (select rolbypassrls from pg_roles where rolname = 'service_role') as svc_bypassrls
  `)
)[0];
check(
  "the application service role holds SELECT only on payments (no INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER)",
  tablePrivs.svc_select === true &&
    tablePrivs.svc_insert === false &&
    tablePrivs.svc_update === false &&
    tablePrivs.svc_delete === false &&
    tablePrivs.svc_truncate === false &&
    tablePrivs.svc_references === false &&
    tablePrivs.svc_trigger === false,
  JSON.stringify(tablePrivs)
);
check(
  "a signed-in customer holds SELECT and INSERT only (no UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER)",
  tablePrivs.auth_select === true &&
    tablePrivs.auth_insert === true &&
    tablePrivs.auth_update === false &&
    tablePrivs.auth_delete === false &&
    tablePrivs.auth_truncate === false &&
    tablePrivs.auth_references === false &&
    tablePrivs.auth_trigger === false,
  JSON.stringify(tablePrivs)
);
check(
  "an unauthenticated caller holds no table privilege at all on payments",
  tablePrivs.anon_select === false &&
    tablePrivs.anon_insert === false &&
    tablePrivs.anon_update === false &&
    tablePrivs.anon_delete === false &&
    tablePrivs.anon_truncate === false &&
    tablePrivs.anon_references === false &&
    tablePrivs.anon_trigger === false,
  JSON.stringify(tablePrivs)
);
check(
  "the harness mirrors production: service_role bypasses RLS",
  tablePrivs.svc_bypassrls === true,
  JSON.stringify(tablePrivs)
);

const paymentAcl = (
  await query("select coalesce(relacl::text, '(null)') as acl from pg_class where relname = 'payments'")
)[0].acl;
const aclFor = (role) => (paymentAcl.match(new RegExp(`${role}=([^/]*)/`)) ?? [])[1] ?? "";
console.log("      payments relacl:", paymentAcl);
check(
  "the ACL matches the matrix: service_role r, authenticated ar, anon absent",
  aclFor("service_role") === "r" &&
    aclFor("authenticated") === "ar" &&
    aclFor("anon") === "",
  JSON.stringify({ paymentAcl })
);

const fnMeta = await query(`
  select p.proname, p.prosecdef, pg_get_userbyid(p.proowner) as owner
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('confirm_payment', 'reject_payment')
   order by p.proname
`);
console.log("      decision functions:", JSON.stringify(fnMeta));
check(
  "both decision functions are SECURITY DEFINER and owned by the table owner, so the revoke cannot affect them",
  fnMeta.length === 2 && fnMeta.every((f) => f.prosecdef === true && f.owner === "postgres"),
  JSON.stringify(fnMeta)
);

// --- Direct writes as the service role: refused by the TABLE PRIVILEGE ---------
const boundaryFixture = await paymentStepFixture("Write boundary", "2031-06-01T01:00:00Z", {
  reference: "GCASH-B3-BOUNDARY",
});

const svcUpdate = await refusal(
  null,
  "service_role",
  `update public.payments
      set status = 'rejected', rejected_by = $2, rejected_at = now(), rejection_reason = 'service role'
    where id = $1`,
  [boundaryFixture.paymentId, adminId]
);
check(
  "a direct payment UPDATE as the service role is refused by the TABLE PRIVILEGE (42501)",
  svcUpdate?.code === "42501",
  JSON.stringify(svcUpdate)
);

const svcInsert = await refusal(
  null,
  "service_role",
  `insert into public.payments (booking_id, customer_id, gcash_reference, amount, status, confirmed_by, confirmed_at)
   values ($1,$2,'GCASH-B3-SVCINS',900,'confirmed',$3,now())`,
  [boundaryFixture.bookingId, customerId, adminId]
);
check(
  "a direct payment INSERT as the service role is refused by the TABLE PRIVILEGE (42501)",
  svcInsert?.code === "42501",
  JSON.stringify(svcInsert)
);

const svcDelete = await refusal(
  null,
  "service_role",
  "delete from public.payments where id = $1",
  [boundaryFixture.paymentId]
);
check(
  "a direct payment DELETE as the service role is refused by the TABLE PRIVILEGE (42501)",
  svcDelete?.code === "42501",
  JSON.stringify(svcDelete)
);

// --- TRUNCATE is a separate privilege, and it must be gone too ------------------
// Its own fixture, so the "row still present" check cannot be confused by any other
// attempt in this group. Wrapped in an explicit transaction that is rolled back
// either way, so a regression in the revoke cannot empty the table this suite runs
// on (verified: ROLLBACK restores truncated rows on this connection). ROLLBACK also
// undoes SET ROLE, so the session returns to the privileged connection afterwards.
const truncateFixture = await paymentStepFixture("Truncate boundary", "2031-06-06T01:00:00Z", {
  reference: "GCASH-B3-TRUNCATE",
});
await db.exec("begin");
await db.exec("set role service_role;");
let truncateRefusal = null;
try {
  await query("truncate table public.payments");
} catch (err) {
  truncateRefusal = { code: err.code ?? null, message: err.message };
}
await db.exec("rollback;");

const sessionAfterTruncate = (await query("select current_user as u"))[0].u;
const rowAfterTruncate = (
  await query("select count(*)::int as n from public.payments where id = $1", [
    truncateFixture.paymentId,
  ])
)[0].n;
check(
  "a direct TRUNCATE as the service role is refused by the TABLE PRIVILEGE (42501)",
  truncateRefusal?.code === "42501",
  JSON.stringify(truncateRefusal)
);
check(
  "the payment row survives the TRUNCATE attempt, and the session is back on the privileged connection",
  rowAfterTruncate === 1 && sessionAfterTruncate === "postgres",
  JSON.stringify({ rowAfterTruncate, sessionAfterTruncate })
);

const boundaryRow = await rejectPaymentRow(boundaryFixture.paymentId);
check(
  "the payment is untouched by all three attempts",
  boundaryRow.status === "pending_verification" &&
    boundaryRow.rejected_by === null &&
    boundaryRow.confirmed_by === null,
  JSON.stringify(boundaryRow)
);
// --- The decision RPCs still work, and only for the right callers --------------
const svcRejectOutcome = (
  await query("select public.reject_payment($1,$2,$3) as result", [
    boundaryFixture.paymentId,
    adminId,
    "Rejected after the write revoke",
  ])
)[0].result;
check(
  "reject_payment() still succeeds for a valid administrator after the revoke",
  svcRejectOutcome.outcome === "rejected",
  JSON.stringify(svcRejectOutcome)
);

const boundaryConfirm = await paymentStepFixture("Write boundary confirm", "2031-06-02T01:00:00Z", {
  reference: "GCASH-B3-BOUNDARY2",
});
const boundaryCountersBefore = await techCounters(boundaryConfirm.technician);
const svcConfirmOutcome = (
  await query("select public.confirm_payment($1,$2) as result", [boundaryConfirm.paymentId, adminId])
)[0].result;
const boundaryConfirmBooking = (
  await query("select status from public.bookings where id = $1", [boundaryConfirm.bookingId])
)[0];
const boundaryConfirmHistory = (
  await query("select count(*)::int as n from public.service_history where booking_id = $1", [
    boundaryConfirm.bookingId,
  ])
)[0];
const boundaryCountersAfter = await techCounters(boundaryConfirm.technician);
check(
  "confirm_payment() still succeeds for a valid administrator and completes the repair correctly",
  svcConfirmOutcome.outcome === "confirmed" &&
    svcConfirmOutcome.completed_now === true &&
    boundaryConfirmBooking.status === "completed" &&
    boundaryConfirmHistory.n === 1 &&
    boundaryCountersAfter.jobs_completed === boundaryCountersBefore.jobs_completed + 1,
  JSON.stringify({
    svcConfirmOutcome,
    boundaryConfirmBooking,
    boundaryConfirmHistory,
    boundaryCountersBefore,
    boundaryCountersAfter,
  })
);

const fnPrivs = (
  await query(`
    select
      has_function_privilege('service_role','public.reject_payment(uuid,uuid,text)','EXECUTE') as svc_reject,
      has_function_privilege('service_role','public.confirm_payment(uuid,uuid)','EXECUTE') as svc_confirm,
      has_function_privilege('authenticated','public.reject_payment(uuid,uuid,text)','EXECUTE') as auth_reject,
      has_function_privilege('authenticated','public.confirm_payment(uuid,uuid)','EXECUTE') as auth_confirm,
      has_function_privilege('anon','public.reject_payment(uuid,uuid,text)','EXECUTE') as anon_reject
  `)
)[0];
check(
  "both decision RPCs are executable by the service role and by nobody else",
  fnPrivs.svc_reject === true &&
    fnPrivs.svc_confirm === true &&
    fnPrivs.auth_reject === false &&
    fnPrivs.auth_confirm === false &&
    fnPrivs.anon_reject === false,
  JSON.stringify(fnPrivs)
);

const boundaryThird = await paymentStepFixture("Write boundary fn", "2031-06-03T01:00:00Z", {
  reference: "GCASH-B3-BOUNDARY3",
});
const authRpcReject = await refusal(
  customerId,
  "authenticated",
  "select public.reject_payment($1,$2,$3)",
  [boundaryThird.paymentId, customerId, "customer attempt"]
);
check(
  "a customer cannot execute reject_payment(): refused by the FUNCTION GRANT (42501)",
  authRpcReject?.code === "42501",
  JSON.stringify(authRpcReject)
);

const authRpcConfirm = await refusal(
  customerId,
  "authenticated",
  "select public.confirm_payment($1,$2)",
  [boundaryThird.paymentId, customerId]
);
check(
  "a customer cannot execute confirm_payment(): refused by the FUNCTION GRANT (42501)",
  authRpcConfirm?.code === "42501",
  JSON.stringify(authRpcConfirm)
);

// The RPCs' OWN authorization check, which is a different mechanism from the grant
// above: called over a privileged connection, with a non-administrator as the actor.
const forbiddenOutcome = (
  await query("select public.reject_payment($1,$2,$3) as result", [
    boundaryThird.paymentId,
    customerId,
    "customer as the actor",
  ])
)[0].result;
check(
  "reject_payment() refuses a non-administrator actor by its own AUTHORIZATION check (outcome forbidden)",
  forbiddenOutcome.outcome === "forbidden",
  JSON.stringify(forbiddenOutcome)
);

const confirmForbidden = await (async () => {
  try {
    await query("select public.confirm_payment($1,$2)", [boundaryThird.paymentId, customerId]);
    return null;
  } catch (err) {
    return err.message;
  }
})();
check(
  "confirm_payment() refuses a non-administrator actor by its own AUTHORIZATION check (raises)",
  /only an administrator/.test(confirmForbidden ?? ""),
  confirmForbidden ?? "the call SUCCEEDED"
);
// --- The recorded administrator: refused by the TRIGGER ------------------------
const actorFixture = await paymentStepFixture("Recorded actor", "2031-06-04T01:00:00Z", {
  reference: "GCASH-B3-ACTOR",
});
const bogusRejector = await refused(
  `update public.payments
      set status = 'rejected', rejected_by = $2, rejected_at = now(), rejection_reason = 'recorded as a customer'
    where id = $1`,
  [actorFixture.paymentId, customerId]
);
check(
  "the TRIGGER refuses a rejection recorded against a customer",
  /recorded against an administrator/.test(bogusRejector ?? ""),
  bogusRejector ?? "the update was ALLOWED"
);

const bogusVerifier = await refused(
  `update public.payments set status = 'confirmed', confirmed_by = $2, confirmed_at = now() where id = $1`,
  [actorFixture.paymentId, tech.A]
);
check(
  "the TRIGGER refuses a verification recorded against a technician",
  /recorded against an administrator/.test(bogusVerifier ?? ""),
  bogusVerifier ?? "the update was ALLOWED"
);

const bogusVerifierNull = await refused(
  `update public.payments set status = 'confirmed', confirmed_by = $2, confirmed_at = now() where id = $1`,
  [actorFixture.paymentId, otherCustomerId]
);
check(
  "the TRIGGER refuses a verification recorded against another customer",
  /recorded against an administrator/.test(bogusVerifierNull ?? ""),
  bogusVerifierNull ?? "the update was ALLOWED"
);

const actorRow = await rejectPaymentRow(actorFixture.paymentId);
check(
  "the payment is untouched by every refused actor attempt",
  actorRow.status === "pending_verification" &&
    actorRow.rejected_by === null &&
    actorRow.confirmed_by === null,
  JSON.stringify(actorRow)
);

// A super administrator is an administrator too: the recorded role list is
// 'admin' OR 'super_admin', and the decision path must accept both.
const superAdminId = await provisionUser({
  email: "superadmin-payments@example.com",
  name: "Super Admin",
  role: "super_admin",
});
const superFixture = await paymentStepFixture("Super admin decision", "2031-06-05T01:00:00Z", {
  reference: "GCASH-B3-SUPER",
});
const superOutcome = (
  await query("select public.reject_payment($1,$2,$3) as result", [
    superFixture.paymentId,
    superAdminId,
    "Rejected by a super administrator",
  ])
)[0].result;
const superRow = await rejectPaymentRow(superFixture.paymentId);
check(
  "a super administrator can reject, and the trigger accepts the recorded actor",
  superOutcome.outcome === "rejected" && superRow.rejected_by === superAdminId,
  JSON.stringify({ superOutcome, superRow })
);

// --- The CHECK constraint, isolated (an INSERT never reaches the UPDATE trigger) -
const checkViolation = await refused(
  `insert into public.payments (booking_id, customer_id, gcash_reference, amount, status, rejected_by, rejected_at)
   values ($1,$2,'GCASH-B3-CHECK',900,'rejected',$3,now())`,
  [actorFixture.bookingId, customerId, adminId]
);
check(
  "the CHECK CONSTRAINT refuses a rejected row with no reason, and is named in the error",
  /payments_decision_metadata_check/.test(checkViolation ?? ""),
  checkViolation ?? "the insert was ALLOWED"
);

// --- The trigger still freezes a decided record --------------------------------
const terminalRewrite = await refused(
  "update public.payments set rejection_reason = 'rewritten' where id = $1",
  [boundaryFixture.paymentId]
);
check(
  "the TRIGGER still freezes a decided record: the reason cannot be rewritten",
  /decision is final/.test(terminalRewrite ?? ""),
  terminalRewrite ?? "the update was ALLOWED"
);

// --- RLS, on the operations a customer IS allowed to attempt -------------------
// RLS is demonstrated where the role holds the privilege: a customer can SELECT, and
// the policy decides which ROWS come back. (Their UPDATE/DELETE are refused earlier,
// by the privilege - a different guard, tested separately.)
const otherCustomerRead = await asUser(otherCustomerId, "authenticated", async () =>
  query("select id, status from public.payments where id = $1", [boundaryThird.paymentId])
);
check(
  "RLS: a customer's SELECT of another customer's payment returns no row",
  otherCustomerRead.length === 0,
  JSON.stringify(otherCustomerRead)
);

const ownerRead = await asUser(customerId, "authenticated", async () =>
  query("select id, status from public.payments where id = $1", [boundaryThird.paymentId])
);
check(
  "RLS: the owning customer's SELECT of their own payment returns it",
  ownerRead.length === 1,
  JSON.stringify(ownerRead)
);

// And the customer workflow still works with the narrowed privileges: submitting a
// reference is an INSERT, which `authenticated` keeps.
const submissionFixture = await paymentStepFixture("Privilege submission", "2031-06-07T01:00:00Z", {
  reference: "GCASH-B3-SUBMIT",
});
const customerSubmission = await asUser(customerId, "authenticated", async () => {
  try {
    const rows = await query(
      `insert into public.payments (booking_id, customer_id, gcash_reference, amount, status)
       values ($1,$2,'GCASH-B3-CUSTSUB',$3,'pending_verification') returning id`,
      [submissionFixture.bookingId, customerId, submissionFixture.cost]
    );
    return { code: null, rows: rows.length };
  } catch (err) {
    return { code: err.code ?? null, rows: 0 };
  }
});
check(
  "a customer can still submit a payment reference (INSERT is kept)",
  customerSubmission.code === null && customerSubmission.rows === 1,
  JSON.stringify(customerSubmission)
);

const customerDeleteAttempt = await asUser(customerId, "authenticated", async () => {
  try {
    const rows = await query("delete from public.payments where id = $1 returning id", [
      boundaryThird.paymentId,
    ]);
    return { code: null, rows: rows.length };
  } catch (err) {
    return { code: err.code ?? null, rows: null };
  }
});
const paymentStillThere = (
  await query("select count(*)::int as n from public.payments where id = $1", [boundaryThird.paymentId])
)[0].n;
check(
  "a customer's DELETE is refused by the TABLE PRIVILEGE (42501) and the payment still exists",
  customerDeleteAttempt.code === "42501" && paymentStillThere === 1,
  JSON.stringify({ customerDeleteAttempt, paymentStillThere })
);

const anonRead = await refusal(null, "anon", "select id from public.payments limit 1", []);
check(
  "an unauthenticated caller cannot read payments at all (TABLE PRIVILEGE, 42501)",
  anonRead?.code === "42501",
  JSON.stringify(anonRead)
);
console.log("\n== 26. The booking eligibility invariant: no booking without a qualified technician (step 17) ==");
// THE DEFECT. `create_booking_atomic()` validated the request's WORKFLOW STATE - an
// accepted assignment plus the current approved estimate - but never re-checked that
// the assigned technician is still QUALIFIED for the request's appliance type. An
// accepted assignment goes stale the moment a specialization is edited, an account is
// suspended, or an administrator takes somebody out of one rotation, and every one of
// those paths left the request bookable: the booking was written, the request flipped
// to `booked` and the job-load counter moved.
//
// Group 23 is the legitimate path (its fixtures are now genuinely eligible). This
// group is the refusals - and, for each one, the proof that it wrote NOTHING.
//
// The guard lives in the database function, so every case below books through
// `create_booking_atomic()` exactly as POST /api/bookings does with its service-role
// client. There is no client-side copy of the rule to bypass, and a mutation test at
// the end books the SAME request successfully once the technician is qualified again.

/** This group's own technician: qualified for exactly one appliance type. */
const techE = await provisionUser({
  email: "tech-e-eligibility@example.com",
  name: "Technician E",
  role: "technician",
  location: "Makati",
});
const ELIGIBLE_APPLIANCE = "electric_kettle";
await query(
  "update public.technicians set approved = true, approved_at = now(), specializations = $2 where id = $1",
  [techE, ["Electric Kettle"]]
);

/** A request + approved estimate assigned to techE, for one appliance type. */
async function eFixture(label, startIso, applianceType = ELIGIBLE_APPLIANCE) {
  return bookableFixture(label, startIso, { technician: techE, applianceType, cost: 700 });
}

/** The qualification predicate, called the way the booking transaction calls it. */
async function qualificationOf(technicianId, applianceType) {
  return (
    await query("select public.technician_qualification_failure($1,$2) as reason", [
      technicianId,
      applianceType,
    ])
  )[0].reason;
}

/** The queue engine's FULL eligibility gate, for the same comparison. */
async function eligibilityReason(technicianId, applianceType) {
  return (
    await query("select public.technician_eligibility_failure($1,$2,$3,$4,$5,$6) as reason", [
      technicianId,
      applianceType,
      null,
      null,
      null,
      null,
    ])
  )[0].reason;
}

// --- 1. The predicate, and the fact that the queue walk shares it ---------------
check(
  "the qualification predicate accepts a technician who is in the appliance's queue",
  (await qualificationOf(techE, ELIGIBLE_APPLIANCE)) === null,
  JSON.stringify({ reason: await qualificationOf(techE, ELIGIBLE_APPLIANCE) })
);
check(
  "the qualification predicate refuses a technician who does not service the appliance",
  (await qualificationOf(techE, "refrigerator")) === "not_in_queue",
  JSON.stringify({ reason: await qualificationOf(techE, "refrigerator") })
);
// One definition, two callers: the queue walk's gate must give the same answer, or
// the booking transaction and the assignment engine would disagree about who may take
// an appliance.
check(
  "the queue walk's eligibility gate reports the same qualification reason (one shared definition)",
  (await eligibilityReason(techE, "refrigerator")) === "not_in_queue" &&
    (await eligibilityReason(techE, ELIGIBLE_APPLIANCE)) === null,
  JSON.stringify({
    notInQueue: await eligibilityReason(techE, "refrigerator"),
    qualified: await eligibilityReason(techE, ELIGIBLE_APPLIANCE),
  })
);

// --- 2. The workflow-state conditions still refuse -------------------------------
// All of these were enforced before step 17. They are re-asserted here so the new
// check cannot have displaced one of them.

const noTechFixture = await eFixture("No technician assigned", "2031-04-02T01:00:00Z");
await query(
  "update public.service_requests set assigned_technician_id = null, assignment_status = 'matching' where id = $1",
  [noTechFixture.requestId]
);
const noTechOutcome = await bookViaRpc(
  noTechFixture.requestId,
  noTechFixture.estimateId,
  "2031-04-02T01:00:00Z"
);
check(
  "a request with no technician assigned cannot be booked",
  noTechOutcome.outcome === "request_not_bookable" && noTechOutcome.reason === "not_assigned",
  JSON.stringify(noTechOutcome)
);

const offeredFixture = await eFixture("Offer never accepted", "2031-04-02T03:00:00Z");
await query("update public.service_requests set assignment_status = 'offered' where id = $1", [
  offeredFixture.requestId,
]);
const offeredOutcome = await bookViaRpc(
  offeredFixture.requestId,
  offeredFixture.estimateId,
  "2031-04-02T03:00:00Z"
);
check(
  "a request whose offer has not been accepted cannot be booked",
  offeredOutcome.outcome === "request_not_bookable" && offeredOutcome.reason === "not_assigned",
  JSON.stringify(offeredOutcome)
);

const crossA = await eFixture("Estimate cross-check A", "2031-04-02T05:00:00Z");
const crossB = await eFixture("Estimate cross-check B", "2031-04-03T01:00:00Z");
const crossOutcome = await bookViaRpc(crossA.requestId, crossB.estimateId, "2031-04-02T05:00:00Z");
check(
  "an estimate from a different request is refused even when the technician is qualified",
  crossOutcome.outcome === "estimate_invalid" && crossOutcome.reason === "wrong_request",
  JSON.stringify(crossOutcome)
);

// --- 3. The eligibility refusals, and what each one leaves behind ----------------
/**
 * Breaks ONE thing about an otherwise bookable request, attempts the booking at a time
 * that differs from the request's own preference (so "the request was not touched" is a
 * real assertion rather than a coincidence), and reports the outcome with the state
 * either side of the attempt.
 */
async function refusedBooking(label, requestedIso, breakIt, options = {}) {
  const { applianceType = ELIGIBLE_APPLIANCE } = options;
  const fixture = await eFixture(label, requestedIso, applianceType);
  const attemptIso = new Date(new Date(requestedIso).getTime() + 2 * 60 * 60 * 1000).toISOString();
  const snapshot = async () => ({
    counters: await techCounters(techE),
    request: await requestState(fixture.requestId),
    bookings: await bookingsFor(fixture.requestId),
    rotation: positions(await queueOrder(applianceType)),
  });
  const before = await snapshot();
  await breakIt(fixture);
  // A second snapshot AFTER the fixture was broken: the fixture change itself may
  // legitimately move a queue (dropping a specialization leaves the rotation), so the
  // booking attempt is only answerable for what changed between `armed` and `after`.
  const armed = await snapshot();
  const outcome = await bookViaRpc(fixture.requestId, fixture.estimateId, attemptIso);
  const after = await snapshot();
  return { fixture, attemptIso, outcome, before, armed, after };
}

/**
 * The refusal wrote nothing: no booking, the request still open and assigned, the
 * job-load counter untouched, and the rotation exactly as the attempt found it.
 * Returns each condition separately so a failure says WHICH one broke.
 */
function nothingWritten(result) {
  const conditions = {
    noBooking: result.after.bookings === 0,
    statusStillQuoted: result.after.request.status === "quoted",
    stillAccepted:
      result.after.request.assignment_status === "accepted" &&
      result.after.request.assigned_technician_id !== null,
    windowUnchanged: String(result.after.request.requested_window_start) === String(result.before.request.requested_window_start),
    counterUnchanged:
      result.after.counters.active_job_load === result.before.counters.active_job_load,
    rotationUnchanged: result.after.rotation === result.armed.rotation,
  };
  return { ...conditions, ok: Object.values(conditions).every(Boolean) };
}

// (a) The technician is not in THIS appliance's queue. This is the exact case the
//     defect let through: a REFRIGERATOR request assigned to a technician who only
//     services electric kettles booked successfully before step 17.
const notInQueue = await refusedBooking(
  "Assigned technician does not service the appliance",
  "2031-04-10T01:00:00Z",
  async () => {},
  { applianceType: "refrigerator" }
);
check(
  "a booking is refused when the assigned technician does not service that appliance type",
  notInQueue.outcome.outcome === "technician_not_eligible" &&
    notInQueue.outcome.reason === "not_in_queue" &&
    notInQueue.outcome.appliance_type === "refrigerator" &&
    notInQueue.outcome.technician_id === techE &&
    notInQueue.outcome.qualified_technician_available === true,
  JSON.stringify(notInQueue.outcome)
);
const notInQueueWrote = nothingWritten(notInQueue);
check(
  "the refusal wrote nothing: no booking, request untouched, counter and rotation unchanged",
  notInQueueWrote.ok,
  JSON.stringify({ conditions: notInQueueWrote, before: notInQueue.before, after: notInQueue.after })
);

// (b) Queue membership is per appliance type. Being in one rotation is not a licence
//     for every appliance the platform services.
const membershipRows = await query(
  "select appliance_type, is_active from public.technician_queue_state where technician_id = $1 order by appliance_type",
  [techE]
);
check(
  "queue membership is per appliance type: the kettle rotation does not qualify the same technician for refrigerators",
  membershipRows.length === 1 &&
    membershipRows[0].appliance_type === ELIGIBLE_APPLIANCE &&
    membershipRows[0].is_active === true &&
    notInQueue.outcome.outcome === "technician_not_eligible",
  JSON.stringify({ membershipRows, outcome: notInQueue.outcome.outcome })
);

// (c) The specialization was removed AFTER the request was accepted. This is the
//     real-world path: the profile form writes technicians.specializations, the
//     membership sync deactivates the queue membership, and the request the
//     technician already accepted is left exactly where it was.
const staleFixture = await refusedBooking(
  "Specialization removed after acceptance",
  "2031-04-11T01:00:00Z",
  async () => {
    await query("update public.technicians set specializations = $2 where id = $1", [techE, []]);
  }
);
check(
  "a request accepted before the technician dropped the specialization can no longer be booked",
  staleFixture.outcome.outcome === "technician_not_eligible" &&
    staleFixture.outcome.reason === "not_in_queue" &&
    nothingWritten(staleFixture).ok,
  JSON.stringify({ outcome: staleFixture.outcome, wrote: nothingWritten(staleFixture) })
);

await query("update public.technicians set specializations = $2 where id = $1", [
  techE,
  ["Electric Kettle"],
]);
check(
  "re-adding the specialization puts the technician back in the rotation (the refusal was about qualification, not the request)",
  (await qualificationOf(techE, ELIGIBLE_APPLIANCE)) === null,
  JSON.stringify({ reason: await qualificationOf(techE, ELIGIBLE_APPLIANCE) })
);

// (d) The account was suspended after acceptance.
const suspended = await refusedBooking(
  "Technician suspended after acceptance",
  "2031-04-12T01:00:00Z",
  async () => {
    await query("update public.technicians set operational_status = 'SUSPENDED' where id = $1", [
      techE,
    ]);
  }
);
check(
  "a suspended technician's accepted request cannot be booked",
  suspended.outcome.outcome === "technician_not_eligible" &&
    suspended.outcome.reason === "suspended" &&
    nothingWritten(suspended).ok,
  JSON.stringify({ outcome: suspended.outcome, wrote: nothingWritten(suspended) })
);
await query("update public.technicians set operational_status = 'AVAILABLE' where id = $1", [techE]);

// (e) The technician was unapproved after acceptance.
const unapproved = await refusedBooking(
  "Technician unapproved after acceptance",
  "2031-04-13T01:00:00Z",
  async () => {
    await query("update public.technicians set approved = false where id = $1", [techE]);
  }
);
check(
  "an unapproved technician's accepted request cannot be booked",
  unapproved.outcome.outcome === "technician_not_eligible" &&
    unapproved.outcome.reason === "not_available" &&
    nothingWritten(unapproved).ok,
  JSON.stringify({ outcome: unapproved.outcome, wrote: nothingWritten(unapproved) })
);
await query("update public.technicians set approved = true, approved_at = now() where id = $1", [
  techE,
]);

// (f) The account was deactivated after acceptance.
const deactivated = await refusedBooking(
  "Technician account deactivated after acceptance",
  "2031-04-14T01:00:00Z",
  async () => {
    await query("update public.users set is_active = false where id = $1", [techE]);
  }
);
check(
  "a deactivated technician's accepted request cannot be booked",
  deactivated.outcome.outcome === "technician_not_eligible" &&
    deactivated.outcome.reason === "not_available" &&
    nothingWritten(deactivated).ok,
  JSON.stringify({ outcome: deactivated.outcome, wrote: nothingWritten(deactivated) })
);
await query("update public.users set is_active = true where id = $1", [techE]);

// (g) NOBODY covers the appliance type. The assignment exists - it is the stale state
//     an administrator's `remove` override or a dropped final specialization leaves
//     behind - and the request must still not be bookable. This is the case the
//     customer is told about as "no technician currently supports this appliance".
const uncovered = await refusedBooking(
  "No technician covers this appliance type",
  "2031-04-15T01:00:00Z",
  async () => {},
  { applianceType: "solar_inverter" }
);
check(
  "a booking is refused when no technician supports the appliance type at all",
  uncovered.outcome.outcome === "technician_not_eligible" &&
    uncovered.outcome.reason === "not_in_queue" &&
    uncovered.outcome.appliance_type === "solar_inverter" &&
    uncovered.outcome.qualified_technician_available === false &&
    nothingWritten(uncovered).ok,
  JSON.stringify({ outcome: uncovered.outcome, wrote: nothingWritten(uncovered) })
);

// --- 4. Mutation test: the guard is what refuses, not something else ------------
// ONE request, ONE estimate, ONE attempt time. First the technician is ineligible and
// the booking is refused; then the ONLY thing that changes is their membership of the
// appliance queue, and the identical call books. Without step 17 the first call would
// have succeeded - which is precisely the defect, and precisely what the fixtures in
// group 23 used to encode as expected behaviour.
const mutationFixture = await eFixture("Mutation: qualification is the only variable", "2031-04-20T01:00:00Z");
const mutationAttemptIso = "2031-04-20T03:00:00Z";
await query("update public.technicians set specializations = $2 where id = $1", [techE, []]);
const mutationBefore = await bookViaRpc(
  mutationFixture.requestId,
  mutationFixture.estimateId,
  mutationAttemptIso
);
await query("update public.technicians set specializations = $2 where id = $1", [
  techE,
  ["Electric Kettle"],
]);
const mutationAfter = await bookViaRpc(
  mutationFixture.requestId,
  mutationFixture.estimateId,
  mutationAttemptIso
);
check(
  "mutation test: the same request is refused while the technician is ineligible and books once they are eligible",
  mutationBefore.outcome === "technician_not_eligible" &&
    Boolean(mutationAfter.booking_id) &&
    mutationAfter.outcome === "booked",
  JSON.stringify({ refused: mutationBefore.outcome, then: mutationAfter.outcome })
);
check(
  "mutation test: the refused attempt left no booking behind (exactly one booking exists - the successful one)",
  (await bookingsFor(mutationFixture.requestId)) === 1,
  JSON.stringify({ bookings: await bookingsFor(mutationFixture.requestId) })
);

// --- 5. The positive control: eligibility is not a blanket refusal ---------------
const healthy = await eFixture("Qualified technician books normally", "2031-04-21T01:00:00Z");
const healthyCountersBefore = await techCounters(techE);
const healthyOutcome = await bookViaRpc(healthy.requestId, healthy.estimateId, "2031-04-21T01:00:00Z");
const healthyCountersAfter = await techCounters(techE);
const healthyRequest = await requestState(healthy.requestId);
check(
  "a qualified, assigned technician with an approved estimate still books normally (booking, request and counter move together)",
  healthyOutcome.outcome === "booked" &&
    healthyRequest.status === "booked" &&
    healthyCountersAfter.active_job_load === healthyCountersBefore.active_job_load + 1,
  JSON.stringify({
    outcome: healthyOutcome.outcome,
    healthyRequest,
    healthyCountersBefore,
    healthyCountersAfter,
  })
);

// --- 5b. The qualification check is SERIALIZED against qualification changes -----
// The check is a READ. On its own it cannot stop a concurrent commit - a
// specialization edit, an approval change, a suspension, a deactivation, an
// administrative queue removal - from landing between the read and the booking's
// commit, which is the same invalid booking with a narrower window. The transaction
// therefore takes a row lock on each row the decision reads.
//
// The strength is per row: FOR SHARE where the transaction only reads (`users`,
// `technician_queue_state`), FOR NO KEY UPDATE on `technicians`, which this same
// transaction writes later (the job-load counter and the operational status) - a
// FOR SHARE there would have to be upgraded, and an upgrade cannot jump a writer
// already queued behind it.
//
// This harness runs ONE connection, so it cannot demonstrate blocking: a second
// transaction cannot exist here, and PGlite does not report tuple locks at all. What
// it CAN prove deterministically is that the locks are taken - and a row lock and an
// UPDATE of the same row conflict in PostgreSQL, so a held lock IS the wait. The
// conflicts themselves are exercised for real by the two-session test in TESTING.md
// §1.
const lockFixture = await eFixture("Lock inventory", "2031-04-22T01:00:00Z");

/**
 * The relation-level lock each row lock takes. PostgreSQL reports `FOR SHARE` as
 * RowShareLock and `FOR NO KEY UPDATE` as RowExclusiveLock, which is how this suite
 * can tell the two apart from a single connection.
 */
const EXPECTED_LOCKS = {
  technician_queue_state: "RowShareLock",
  technicians: "RowExclusiveLock",
  users: "RowShareLock",
};
const LOCKED_RELATIONS = Object.keys(EXPECTED_LOCKS).sort();

const lockInventory = () =>
  query(
    `select c.relname, l.mode
       from pg_locks l
       join pg_class c on c.oid = l.relation
      where l.locktype = 'relation'
        and c.relname = any($1::text[])
      order by c.relname`,
    [LOCKED_RELATIONS]
  );

let lockOutcome = null;
let heldLocks = [];
await db.exec("begin");
try {
  lockOutcome = await bookViaRpc(
    lockFixture.requestId,
    lockFixture.estimateId,
    "2031-04-22T01:00:00Z"
  );
  heldLocks = await lockInventory();
} finally {
  // Rolled back on purpose: the probe proves a lock, and leaves nothing behind.
  await db.exec("rollback");
}

check(
  "the lock probe booked inside its transaction (so the whole path ran before the locks were read)",
  lockOutcome?.outcome === "booked",
  JSON.stringify(lockOutcome)
);
check(
  "the booking transaction locks the account, the technician and the appliance membership it checks",
  LOCKED_RELATIONS.every((relation) =>
    heldLocks.some((row) => row.relname === relation && row.mode === EXPECTED_LOCKS[relation])
  ),
  JSON.stringify({ expected: EXPECTED_LOCKS, held: heldLocks })
);
check(
  "the rolled-back probe left no booking behind",
  (await bookingsFor(lockFixture.requestId)) === 0,
  JSON.stringify({ bookings: await bookingsFor(lockFixture.requestId) })
);

// The negative control: the predicate alone takes no row lock, which is the whole
// reason the booking transaction has to take them.
let predicateLocks = [];
await db.exec("begin");
try {
  await query("select public.technician_qualification_failure($1,$2)", [
    techE,
    ELIGIBLE_APPLIANCE,
  ]);
  predicateLocks = await lockInventory();
} finally {
  await db.exec("rollback");
}
check(
  "the qualification predicate on its own takes no row lock (the coordination is the booking transaction's)",
  predicateLocks.every((row) => !["RowShareLock", "RowExclusiveLock"].includes(row.mode)),
  JSON.stringify(predicateLocks)
);

// --- 5c. A refusal can never be mistaken for a success ----------------------------
// The route's 201 is reachable only from `outcome = 'booked'`, and the Batch 2 route
// that may still be deployed had no `technician_not_eligible` case at all: it fell
// through to its default branch and answered 500. Both are safe, but only if a
// refusal carries nothing that could be read as a booking - so that is asserted
// here, for every refusal this group produced.
const refusalOutcomes = [
  noTechOutcome,
  offeredOutcome,
  crossOutcome,
  notInQueue.outcome,
  staleFixture.outcome,
  suspended.outcome,
  unapproved.outcome,
  deactivated.outcome,
  uncovered.outcome,
  mutationBefore,
];
check(
  "no refusal outcome carries a booking payload the API could read as success",
  refusalOutcomes.every((o) => o.booking_id === undefined && o.booking === undefined),
  JSON.stringify(
    refusalOutcomes.map((o) => ({ outcome: o.outcome, booking_id: o.booking_id, booking: o.booking }))
  )
);
check(
  "a successful booking does carry the payload the route turns into 201",
  healthyOutcome.outcome === "booked" &&
    healthyOutcome.booking_id !== undefined &&
    healthyOutcome.booking !== undefined,
  JSON.stringify({ outcome: healthyOutcome.outcome, booking_id: healthyOutcome.booking_id })
);


// --- 6. The new helpers are server-only, like every other eligibility predicate --
// They reveal who is qualified for what, which is queue information a customer must
// never read. `create_booking_atomic` is SECURITY DEFINER, so it keeps working.
const qualificationGrants = (
  await query(
    `select has_function_privilege('authenticated', 'public.technician_qualification_failure(uuid,text)', 'EXECUTE') as authenticated_can,
            has_function_privilege('anon', 'public.technician_qualification_failure(uuid,text)', 'EXECUTE') as anon_can,
            has_function_privilege('service_role', 'public.technician_qualification_failure(uuid,text)', 'EXECUTE') as service_role_can,
            has_function_privilege('authenticated', 'public.appliance_has_qualified_technician(text)', 'EXECUTE') as coverage_authenticated_can,
            has_function_privilege('service_role', 'public.appliance_has_qualified_technician(text)', 'EXECUTE') as coverage_service_role_can`
  )
)[0];
check(
  "the qualification and coverage predicates are service-role only",
  qualificationGrants.authenticated_can === false &&
    qualificationGrants.anon_can === false &&
    qualificationGrants.service_role_can === true &&
    qualificationGrants.coverage_authenticated_can === false &&
    qualificationGrants.coverage_service_role_can === true,
  JSON.stringify(qualificationGrants)
);


console.log("\n== 27. A cancellation releases the slot in the SAME transaction (step 18) ==");
// THE DEFECT. `PATCH /api/bookings/:id` cancelled the booking and THEN called
// `release_technician_slot()` as a SECOND call, whose failure was logged and then
// swallowed: a failed release left the booking cancelled, the request reopened by
// `reopen_request_after_booking_cancel`, and the technician's load inflated for good
// — nothing reconciles it, because the counter is not derivable from the booking
// rows. A cancellation that did not go through that route released nothing at all.
//
// Step 18 makes the release an AFTER UPDATE trigger on `bookings`, inside the
// cancelling transaction, for every writer. Group 23 already proves the release
// PRIMITIVE (one decrement, floored at zero); this group proves the TRIGGER.
//
// What one connection cannot prove: two cancellations genuinely racing, and a
// cancellation racing a payment completion. The mechanism is asserted here; the
// interleavings are two-session tests in TESTING.md §1, on staging data.

/** This group's own technician, qualified for an appliance type nothing else uses. */
const techF = await provisionUser({
  email: "tech-f-cancel@example.com",
  name: "Technician F",
  role: "technician",
  location: "Makati",
});
const CANCEL_APPLIANCE = "tv";
await query(
  "update public.technicians set approved = true, approved_at = now(), specializations = $2 where id = $1",
  [techF, ["Television"]]
);

/** A request + approved estimate assigned and accepted to techF. */
async function fFixture(label, startIso) {
  return bookableFixture(label, startIso, {
    technician: techF,
    applianceType: "television",
    cost: 900,
  });
}

/** Cancels through the customer's own session, which is what the route does for them. */
async function cancelAsCustomer(bookingId) {
  return asUser(customerId, "authenticated", () =>
    query("update public.bookings set status = 'cancelled' where id = $1 returning status", [
      bookingId,
    ])
  );
}

// --- 27.1. One cancellation releases exactly one slot, atomically -----------------
const cancelFixture = await fFixture("Cancel releases the slot", "2031-05-02T01:00:00Z");
const countersBeforeCancelBooking = await techCounters(techF);
const cancelBooked = await bookViaRpc(
  cancelFixture.requestId,
  cancelFixture.estimateId,
  "2031-05-02T01:00:00Z"
);
const countersAfterCancelBooking = await techCounters(techF);
check(
  "a booking holds one slot before anything is cancelled",
  cancelBooked.outcome === "booked" &&
    countersAfterCancelBooking.active_job_load === countersBeforeCancelBooking.active_job_load + 1,
  JSON.stringify({ cancelBooked, countersBeforeCancelBooking, countersAfterCancelBooking })
);

const cancelRotationBefore = positions(await queueOrder(CANCEL_APPLIANCE));
const cancelledViaCustomer = await cancelAsCustomer(cancelBooked.booking_id);
const countersAfterCancel = await techCounters(techF);
check(
  "cancelling releases exactly one slot, in the same transaction as the status change",
  cancelledViaCustomer[0]?.status === "cancelled" &&
    countersAfterCancel.active_job_load === countersBeforeCancelBooking.active_job_load,
  JSON.stringify({ cancelledViaCustomer, countersBeforeCancelBooking, countersAfterCancel })
);

const cancelRequestAfter = await requestState(cancelFixture.requestId);
const cancelEstimateAfter = (
  await query("select status from public.estimates where id = $1", [cancelFixture.estimateId])
)[0];
const cancelHistoryRow = (
  await query("select status from public.bookings where id = $1", [cancelBooked.booking_id])
)[0];
check(
  "the request reopens with its assignment and approved estimate, and the cancelled booking stays as history",
  cancelRequestAfter.status === "quoted" &&
    cancelRequestAfter.assignment_status === "accepted" &&
    cancelRequestAfter.assigned_technician_id === techF &&
    cancelEstimateAfter.status === "accepted" &&
    cancelHistoryRow.status === "cancelled",
  JSON.stringify({ cancelRequestAfter, cancelEstimateAfter, cancelHistoryRow })
);
check(
  "the cancellation does not re-rotate the queue",
  positions(await queueOrder(CANCEL_APPLIANCE)) === cancelRotationBefore,
  `${positions(await queueOrder(CANCEL_APPLIANCE))} vs ${cancelRotationBefore}`
);

// --- 27.2. Repeating the cancellation releases nothing ----------------------------
// The three shapes a repeat takes: a retried PATCH, a second cancel of the same row,
// and an unrelated write that touches the row while it is already cancelled.
await query("update public.bookings set status = 'cancelled' where id = $1", [
  cancelBooked.booking_id,
]);
await query("update public.bookings set updated_at = now() where id = $1", [
  cancelBooked.booking_id,
]);
const countersAfterRepeat = await techCounters(techF);
check(
  "cancelling an already-cancelled booking releases nothing (retry, double click, updated_at touch)",
  countersAfterRepeat.active_job_load === countersBeforeCancelBooking.active_job_load,
  JSON.stringify({ countersBeforeCancelBooking, countersAfterRepeat })
);

// --- 27.3. A failed release rolls the whole cancellation back ---------------------
// The primitive is replaced by a raising stub INSIDE a transaction, so the rollback
// removes the stub as well as the attempt — the only way to make it fail without
// editing a real function definition on disk. What is asserted afterwards is the
// property that matters: the cancellation did not survive.
const releaseFailFixture = await fFixture("Release failure", "2031-05-03T01:00:00Z");
const releaseFailBooking = await bookViaRpc(
  releaseFailFixture.requestId,
  releaseFailFixture.estimateId,
  "2031-05-03T01:00:00Z"
);
const countersBeforeReleaseFailure = await techCounters(techF);

await db.exec("begin");
await db.exec(`
  create or replace function public.release_technician_slot(p_technician_id uuid)
  returns integer
  language plpgsql
  as $$
  begin
    raise exception 'forced release failure (group 27)';
  end;
  $$;
`);
const releaseFailure = await expectError(() =>
  query("update public.bookings set status = 'cancelled' where id = $1", [
    releaseFailBooking.booking_id,
  ])
);
await db.exec("rollback");

const bookingAfterReleaseFailure = (
  await query("select status from public.bookings where id = $1", [releaseFailBooking.booking_id])
)[0].status;
const countersAfterReleaseFailure = await techCounters(techF);
const requestAfterReleaseFailure = await requestState(releaseFailFixture.requestId);
check(
  "a failed release rolls the cancellation back: the booking stays live and nothing moves",
  /forced release failure/.test(releaseFailure ?? "") &&
    bookingAfterReleaseFailure !== "cancelled" &&
    countersAfterReleaseFailure.active_job_load === countersBeforeReleaseFailure.active_job_load &&
    requestAfterReleaseFailure.status === "booked",
  JSON.stringify({
    releaseFailure,
    bookingAfterReleaseFailure,
    countersBeforeReleaseFailure,
    countersAfterReleaseFailure,
    requestAfterReleaseFailure,
  })
);

// The rollback restored the real primitive, not the stub.
const releaseDefAfterRollback = (
  await query("select pg_get_functiondef('public.release_technician_slot(uuid)'::regprocedure) as def")
)[0].def;
check(
  "the forced failure left the real release primitive in place",
  /greatest\(0, active_job_load - 1\)/.test(releaseDefAfterRollback),
  releaseDefAfterRollback.slice(0, 160)
);

// --- 27.4. A failed status refresh rolls the transition back too ------------------
// This is the stronger half of the atomicity claim: the RELEASE has already run when
// the refresh raises, so the rollback has to undo a completed decrement as well as
// the status change.
const refreshFailFixture = await fFixture("Refresh failure", "2031-05-04T01:00:00Z");
const refreshFailBooking = await bookViaRpc(
  refreshFailFixture.requestId,
  refreshFailFixture.estimateId,
  "2031-05-04T01:00:00Z"
);
const countersBeforeRefreshFailure = await techCounters(techF);

await db.exec("begin");
await db.exec(`
  create or replace function public.refresh_technician_operational_status(p_technician_id uuid)
  returns text
  language plpgsql
  as $$
  begin
    raise exception 'forced refresh failure (group 27)';
  end;
  $$;
`);
const refreshFailure = await expectError(() =>
  query("update public.bookings set status = 'cancelled' where id = $1", [
    refreshFailBooking.booking_id,
  ])
);
await db.exec("rollback");

const bookingAfterRefreshFailure = (
  await query("select status from public.bookings where id = $1", [refreshFailBooking.booking_id])
)[0].status;
const countersAfterRefreshFailure = await techCounters(techF);
check(
  "a failed status refresh rolls back both the cancellation and the release it already performed",
  /forced refresh failure/.test(refreshFailure ?? "") &&
    bookingAfterRefreshFailure !== "cancelled" &&
    countersAfterRefreshFailure.active_job_load === countersBeforeRefreshFailure.active_job_load,
  JSON.stringify({
    refreshFailure,
    bookingAfterRefreshFailure,
    countersBeforeRefreshFailure,
    countersAfterRefreshFailure,
  })
);

const refreshDefAfterRollback = (
  await query(
    "select pg_get_functiondef('public.refresh_technician_operational_status(uuid)'::regprocedure) as def"
  )
)[0].def;
check(
  "the forced failure left the real status refresh in place",
  /compute_technician_status/.test(refreshDefAfterRollback),
  refreshDefAfterRollback.slice(0, 160)
);

// --- 27.5. A completed booking cannot release capacity a second time ---------------
// `completed -> cancelled` is still permitted for staff by the transition matrix (a
// separate, tracked follow-up — see the migration's section 6). What matters for the
// counter is that it releases NOTHING: `confirm_payment()` already gave the slot back
// when it closed the repair.
const completeFixture = await fFixture("Completed booking", "2031-05-05T01:00:00Z");
const completeBooking = await bookViaRpc(
  completeFixture.requestId,
  completeFixture.estimateId,
  "2031-05-05T01:00:00Z"
);
const countersAfterCompleteBooking = await techCounters(techF);

await query("update public.bookings set status = 'awaiting_payment', final_cost = 900 where id = $1", [
  completeBooking.booking_id,
]);
const cancelPayment = await query(
  `insert into public.payments (booking_id, customer_id, gcash_reference, amount, status)
   values ($1,$2,'GCASH-CANCEL-001',900,'pending_verification') returning id`,
  [completeBooking.booking_id, customerId]
);
const completedOutcome = (
  await query("select public.confirm_payment($1,$2) as result", [cancelPayment[0].id, adminId])
)[0].result;
const countersAfterCompletion = await techCounters(techF);
check(
  "verifying the payment still frees the slot exactly once (unchanged by step 18)",
  completedOutcome.outcome === "confirmed" &&
    countersAfterCompletion.active_job_load === countersAfterCompleteBooking.active_job_load - 1,
  JSON.stringify({ completedOutcome, countersAfterCompleteBooking, countersAfterCompletion })
);

// An administrator CANNOT cancel it either: the `completed` guard in the transition
// matrix sits before every role branch. (An earlier draft of the migration claimed a
// staff member could — this check pins the corrected reading.)
const adminCancelCompleted = await refusedBy(
  adminId,
  "authenticated",
  "update public.bookings set status = 'cancelled' where id = $1",
  [completeBooking.booking_id]
);
const completedStatusAfterAdminAttempt = (
  await query("select status from public.bookings where id = $1", [completeBooking.booking_id])
)[0].status;
check(
  "an administrator cannot cancel a completed booking (the matrix refuses it before any role branch)",
  /completed repair is final/.test(adminCancelCompleted ?? "") &&
    completedStatusAfterAdminAttempt === "completed",
  JSON.stringify({ adminCancelCompleted, completedStatusAfterAdminAttempt })
);

// A TRUSTED writer is not bound by the matrix — it returns early for the service role
// and for a direct database session — so that is the only way `completed -> cancelled`
// is reachable at all, and it still must not release a second slot.
await query("update public.bookings set status = 'cancelled' where id = $1", [
  completeBooking.booking_id,
]);
const countersAfterCompletedCancel = await techCounters(techF);
check(
  "a completed booking cannot release capacity a second time",
  countersAfterCompletedCancel.active_job_load === countersAfterCompletion.active_job_load,
  JSON.stringify({ countersAfterCompletion, countersAfterCompletedCancel })
);

// --- 27.6. Two cancellations for one technician keep the counter correct -----------
// Sequentially here (one connection cannot interleave two transactions): the property
// that matters is that each booking releases its own slot exactly once, so the
// counter lands back on the baseline rather than on baseline+1.
const pairA = await fFixture("Two cancellations A", "2031-05-06T01:00:00Z");
const pairB = await fFixture("Two cancellations B", "2031-05-06T03:00:00Z");
const countersBeforePair = await techCounters(techF);
const pairABooked = await bookViaRpc(pairA.requestId, pairA.estimateId, "2031-05-06T01:00:00Z");
const pairBBooked = await bookViaRpc(pairB.requestId, pairB.estimateId, "2031-05-06T03:00:00Z");
const countersAfterPairBooked = await techCounters(techF);
await query("update public.bookings set status = 'cancelled' where id = any($1::uuid[])", [
  [pairABooked.booking_id, pairBBooked.booking_id],
]);
const countersAfterPairCancelled = await techCounters(techF);
check(
  "two bookings take two slots and their cancellations give both back, once each",
  countersAfterPairBooked.active_job_load === countersBeforePair.active_job_load + 2 &&
    countersAfterPairCancelled.active_job_load === countersBeforePair.active_job_load,
  JSON.stringify({ countersBeforePair, countersAfterPairBooked, countersAfterPairCancelled })
);

// --- 27.8. The release follows the technician who HELD the slot --------------------
// `create_booking_atomic()` attributed the `+1` to the technician the booking was
// assigned to, so that is whose slot a cancellation must give back — `OLD`, never an
// assignment that never took a slot.
//
// The schema makes OLD and NEW the same in every application path: the column is NOT
// NULL, and `enforce_booking_update_rules` pins it as immutable for every client role.
// The case that matters is the one the matrix deliberately lets through — a trusted
// writer (the service role, or a direct database session like this harness) — because
// there `NEW` can be a different technician entirely.

/** A second technician, so a reassignment has somewhere to go. */
const techG = await provisionUser({
  email: "tech-g-reassign@example.com",
  name: "Technician G",
  role: "technician",
  location: "Makati",
});

// A live booking for the attempts below.
const assignmentFixture = await fFixture("Assignment is fixed", "2031-05-09T01:00:00Z");
const assignmentBooking = await bookViaRpc(
  assignmentFixture.requestId,
  assignmentFixture.estimateId,
  "2031-05-09T01:00:00Z"
);
const countersBeforeAssignmentAttempts = await techCounters(techF);

// (a) The column cannot be cleared at all — so "the slot became unattributable" is not
//     a state the trigger has to handle.
const technicianIdNullability = (
  await query(
    `select is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'bookings' and column_name = 'technician_id'`
  )
)[0].is_nullable;
const nullTechnicianAttempt = await expectError(() =>
  query("update public.bookings set technician_id = null where id = $1", [assignmentBooking.booking_id])
);
check(
  "bookings.technician_id is NOT NULL, so a cancellation can never leave the slot unattributed",
  technicianIdNullability === "NO" && /not-null|null value/i.test(nullTechnicianAttempt ?? ""),
  JSON.stringify({ technicianIdNullability, nullTechnicianAttempt })
);

// (b) No client role can move a booking to another technician, whatever its status:
//     the immutability guard runs before every role branch.
for (const attempt of [
  { who: "the customer", userId: customerId },
  { who: "the technician", userId: techF },
  { who: "an administrator", userId: adminId },
]) {
  const refusal = await refusedBy(
    attempt.userId,
    "authenticated",
    "update public.bookings set technician_id = $2 where id = $1",
    [assignmentBooking.booking_id, techG]
  );
  check(
    `${attempt.who} cannot move a booking to another technician (it is fixed by the booking workflow)`,
    /fixed by the booking workflow/.test(refusal ?? ""),
    refusal ?? "the UPDATE SUCCEEDED"
  );
}

const assignmentAfterRefusals = (
  await query("select technician_id, status from public.bookings where id = $1", [
    assignmentBooking.booking_id,
  ])
)[0];
check(
  "the refused reassignments changed nothing, and released no slot",
  assignmentAfterRefusals.technician_id === techF &&
    assignmentAfterRefusals.status === "pending" &&
    (await techCounters(techF)).active_job_load === countersBeforeAssignmentAttempts.active_job_load,
  JSON.stringify({ assignmentAfterRefusals, countersBeforeAssignmentAttempts })
);

// (c) A trusted writer CAN reassign — the matrix returns early for it — so a
//     cancellation in the same statement is the case where NEW and OLD differ. The
//     slot released must be OLD's: the new technician's counter never took the `+1`.
const countersOfTechGBefore = await techCounters(techG);
await query("update public.bookings set technician_id = $2, status = 'cancelled' where id = $1", [
  assignmentBooking.booking_id,
  techG,
]);
const countersOfTechFAfter = await techCounters(techF);
const countersOfTechGAfter = await techCounters(techG);
const reassignedBooking = (
  await query("select technician_id, status from public.bookings where id = $1", [
    assignmentBooking.booking_id,
  ])
)[0];
check(
  "a cancellation that reassigns in the same statement releases the slot of the technician who held it, not the new one",
  reassignedBooking.technician_id === techG &&
    reassignedBooking.status === "cancelled" &&
    countersOfTechFAfter.active_job_load === countersBeforeAssignmentAttempts.active_job_load - 1 &&
    countersOfTechGAfter.active_job_load === countersOfTechGBefore.active_job_load,
  JSON.stringify({
    reassignedBooking,
    countersBeforeAssignmentAttempts,
    countersOfTechFAfter,
    countersOfTechGBefore,
    countersOfTechGAfter,
  })
);

// --- 27.7. The vocabulary, the trigger inventory and the privilege boundary --------
const slotVocabulary = await query(
  `select s.status::text as status, public.booking_status_holds_slot(s.status::text) as holds_a_slot
     from unnest(enum_range(null::public.booking_status)) as s(status)
    order by s.status::text`
);
const slotHolding = slotVocabulary
  .filter((row) => row.holds_a_slot)
  .map((row) => row.status)
  .sort()
  .join(",");
check(
  "the slot-holding predicate names exactly the four live statuses",
  slotHolding === "awaiting_inspection,awaiting_payment,in_progress,pending",
  JSON.stringify(slotVocabulary)
);

const cancelTriggers = await query(
  `select t.tgname, pg_get_triggerdef(t.oid) as def
     from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'bookings' and not t.tgisinternal
    order by t.tgname`
);
const cancelTriggerNames = cancelTriggers.map((t) => t.tgname);
const cancellationTrigger = cancelTriggers.find((t) => t.tgname === "release_slot_after_booking_cancel");
check(
  "the cancellation trigger is installed AFTER UPDATE on bookings, beside the request-reopening trigger",
  cancelTriggerNames.length === 5 &&
    Boolean(cancellationTrigger) &&
    /after update/i.test(cancellationTrigger.def) &&
    cancelTriggerNames.includes("reopen_request_after_booking_cancel") &&
    cancelTriggerNames.includes("enforce_booking_update_rules") &&
    cancelTriggerNames.includes("require_approved_estimate_for_booking") &&
    cancelTriggerNames.includes("trg_booking_no_overlap"),
  JSON.stringify(cancelTriggerNames)
);

const releaseTriggerDef = (
  await query(
    "select pg_get_functiondef('public.release_slot_after_booking_cancel()'::regprocedure) as def"
  )
)[0].def;
check(
  "the release calls the shared primitive and never touches the queue rotation",
  /release_technician_slot/.test(releaseTriggerDef) &&
    /refresh_technician_operational_status/.test(releaseTriggerDef) &&
    !/technician_queue_state/.test(releaseTriggerDef),
  releaseTriggerDef.slice(0, 200)
);

const cancelGrants = (
  await query(
    `select has_function_privilege('authenticated', 'public.booking_status_holds_slot(text)', 'EXECUTE') as predicate_authenticated_can,
            has_function_privilege('anon', 'public.booking_status_holds_slot(text)', 'EXECUTE') as predicate_anon_can,
            has_function_privilege('service_role', 'public.booking_status_holds_slot(text)', 'EXECUTE') as predicate_service_role_can,
            has_function_privilege('authenticated', 'public.release_technician_slot(uuid)', 'EXECUTE') as release_authenticated_can,
            has_function_privilege('service_role', 'public.release_technician_slot(uuid)', 'EXECUTE') as release_service_role_can`
  )
)[0];
check(
  "the predicate is service-role only and the release primitive's grants are unchanged",
  cancelGrants.predicate_authenticated_can === false &&
    cancelGrants.predicate_anon_can === false &&
    cancelGrants.predicate_service_role_can === true &&
    cancelGrants.release_authenticated_can === false &&
    cancelGrants.release_service_role_can === true,
  JSON.stringify(cancelGrants)
);


await db.close();



console.log(`\n${results.length - failures}/${results.length} checks passed`);
if (failures) {
  console.log(`\nFAILURES:\n${results.filter((r) => !r.ok).map((r) => ` - ${r.name}`).join("\n")}`);
}
process.exit(failures ? 1 : 0);






