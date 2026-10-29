#!/usr/bin/env node
/**
 * SPARKServ migration-state preflight  —  `npm run db:check`
 * =========================================================
 *
 * Answers one question against the REAL Supabase project in `.env.local`:
 * "which migrations have actually been applied?"
 *
 * Why this exists: `npm run verify:queue` refuses to run until the queue
 * migration is applied, but its failure message can only say "something is
 * missing" — and the app's own symptom is a blanket HTTP 500, because PostgREST
 * turns a missing column into PostgreSQL 42703 and the API swallows the detail
 * outside development. Guessing which of three files was skipped wastes a lot
 * of time. This prints it per-migration, per-object.
 *
 * READ-ONLY, BY CONSTRUCTION. No writes, no DDL, no fixtures:
 *
 *   * columns/tables are probed with a `select().limit(1)` — a 42P01 (missing
 *     table) or 42703 (missing column) means absent; ANY other outcome,
 *     including an empty result or an RLS denial, means present. "Cannot read
 *     it" is not the same as "it does not exist", and reporting the difference
 *     wrongly would send you chasing a migration that is already applied.
 *   * functions are detected from PostgREST's OpenAPI document, NOT by calling
 *     them. `expire_stale_offers()` lapses real offers and `respond_to_offer()`
 *     assigns real jobs; probing those by invocation would mutate live data.
 *   * a file whose ONLY effects are invisible to PostgREST — an enum value, a
 *     dropped NOT NULL, a storage bucket — has nothing to probe. Such a file is
 *     reported as UNVERIFIABLE rather than "applied", and it is listed with the
 *     pending files while any file that DEPENDS on it is still pending. Skipping
 *     it is not a cosmetic mistake: the estimate workflow file uses the enum
 *     values its predecessor adds inside index predicates, so applying it without
 *     them fails with `invalid input value for enum estimate_status: draft` — an
 *     error that names a value the pending list never mentioned.
 *     That dependency is declared explicitly (`prerequisiteOf: [order]`) rather
 *     than inferred from the numbering: a file's number says when to apply it, not
 *     what needs it, and comparing numbers pulled independent files into the list.
 *
 * Exit code is 0 only when every check passes, so it is safe to use as a gate
 * in a deploy script.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const file = path.join(repoRoot, ".env.local");
  const env = { ...process.env };
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (!env[match[1]]) env[match[1]] = value;
  }
  return env;
}

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Copy .env.example to .env.local and fill them in."
  );
  process.exit(2);
}

// Service role: probes must reflect the SCHEMA, not one role's RLS policies.
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

// PostgREST error codes that mean "this object does not exist".
const MISSING_TABLE = new Set(["42P01", "PGRST205"]);
const MISSING_COLUMN = new Set(["42703", "PGRST204"]);

/**
 * Every file that changes the LIVE schema, in the order it must be applied.
 * Keeping this list complete matters more than the order does: any migration
 * omitted here is invisible to the preflight, which is how a missing
 * `users.first_name` (and the "Unable to update profile" it caused) survived an
 * all-green run. `settings` are row-level seeds rather than schema: migration 3
 * writes queue_model_version = '2.0' as its LAST statement, which makes it a
 * reliable "did the file run to completion" marker — a half-applied file leaves
 * the tables present but this row missing, and that distinction is worth
 * keeping.
 */
const MIGRATIONS = [
  {
    order: 1,
    file: "supabase/migration_sync_live_schema.sql",
    purpose: "Appliance-centric columns the app already writes (stopped the blanket 500s)",
    columns: [
      ["appliances", "model_number"],
      ["appliances", "serial_number"],
      ["appliances", "warranty_status"],
      ["appliances", "warranty_expiry_date"],
      ["service_requests", "appliance_id"],
      ["service_requests", "issue_category"],
      ["service_requests", "photos"],
      ["service_requests", "service_type"],
      ["service_requests", "problem_description"],
      ["bookings", "inspection_confirmed_at"],
      ["bookings", "inspection_note"],
    ],
    tables: [],
    functions: [],
  },
  {
    order: 2,
    file: "supabase/migration_flow_hardening.sql",
    purpose: "Offer expiry + one-active-offer-per-technician guard",
    columns: [["service_requests", "offers_expires_at"]],
    tables: [],
    functions: ["technician_linked_to_request", "expire_offer"],
  },
  {
    order: 3,
    file: "supabase/migration_queue_redesign.sql",
    purpose: "Queue model v2 — rotation positions, eligibility, availability, capacity",
    columns: [
      ["service_requests", "requested_window_start"],
      ["service_requests", "requested_window_end"],
      ["service_requests", "requested_duration_minutes"],
      ["technician_queue_state", "queue_position"],
      ["technician_queue_state", "turn_count"],
    ],
    tables: [
      "technician_availability",
      "technician_time_off",
      "technician_service_areas",
      "technician_queue_events",
    ],
    functions: [
      "assign_technician_to_request",
      "respond_to_offer",
      "technician_queue_snapshot",
      "expire_stale_offers",
      "consume_queue_turn",
      "refresh_technician_operational_status",
      "admin_queue_override",
      "technician_eligibility_failure",
      "technician_schedule_conflict",
      "technician_within_availability",
      "sync_appliance_queue_memberships",
      "service_timezone",
    ],
    settings: [["queue_model_version", "2.0"]],
  },
  {
    // Not queue work, but it changes the LIVE schema, which is what this script
    // is for. It was missing from this list, and that omission is exactly how
    // "Unable to update profile" — a 42703 on `users.first_name` — stayed
    // invisible while this check reported all-green.
    order: 4,
    file: "supabase/migration_profile_name_address.sql",
    purpose: "Split the profile name into first/last/middle initial and add the address",
    columns: [
      ["users", "first_name"],
      ["users", "last_name"],
      ["users", "middle_initial"],
      ["users", "address"],
    ],
    tables: [],
    functions: [],
  },
  {
    order: 5,
    file: "supabase/migration_service_location.sql",
    purpose:
      "Service location on service_requests: coordinates, range/pairing constraints, and the location-privacy policy",
    columns: [
      ["service_requests", "location"],
      ["service_requests", "latitude"],
      ["service_requests", "longitude"],
    ],
    tables: [],
    // `technician_pending_offers()` is the one read path that returns an
    // unaccepted offer WITHOUT the address or coordinates, so its absence is the
    // clearest signal that this file has not run: the tightened policy alone
    // would leave technicians with an empty offer list.
    functions: ["technician_pending_offers"],
  },
  {
    order: 6,
    file: "supabase/migration_troubleshooting.sql",
    purpose:
      "Identified issue (issue_id) and the customer-reported troubleshooting outcome",
    columns: [
      ["service_requests", "issue_id"],
      ["service_requests", "troubleshooting_outcome"],
    ],
    tables: [],
    functions: [],
  },
  {
    order: 7,
    file: "supabase/migration_offer_lifecycle.sql",
    purpose:
      "Offer lifecycle: cancelling releases the live offer, a closed request is never accepted or re-offered, and a lapsed offer cannot freeze the rotation",
    columns: [],
    tables: [],
    // `lapse_offer()` is the single release path this file adds; its presence is
    // the signal that the replaced engine functions are in place too.
    functions: ["lapse_offer"],
  },
  {
    order: 8,
    file: "supabase/migration_estimate_status.sql",
    purpose:
      "Estimate status vocabulary: draft / revision_requested / superseded added to estimate_status",
    // Enum values cannot be probed through PostgREST, so this file can never be
    // confirmed — only its successor passing proves it ran. It stays in the list
    // for two reasons: the ORDER is explicit (the workflow file below uses these
    // values in index predicates, and PostgreSQL refuses to use an enum value in
    // the same transaction that adds it), and `prerequisiteOf` records that the
    // workflow file genuinely needs it, so it is printed alongside the pending
    // files while step 9 is pending — and stops being printed once 9 is applied,
    // because then nothing left to apply depends on it.
    columns: [],
    tables: [],
    functions: [],
    prerequisiteOf: [9],
  },
  {
    order: 9,
    file: "supabase/migration_estimate_workflow.sql",
    purpose:
      "Estimate workflow: itemized costs, version history, the submit/decide functions and the approved-estimate booking guard",
    columns: [
      ["estimates", "labor_cost"],
      ["estimates", "parts_cost"],
      ["estimates", "other_cost"],
      ["estimates", "other_description"],
      ["estimates", "scope"],
      ["estimates", "version"],
      ["estimates", "supersedes_id"],
      ["estimates", "superseded_by"],
      ["estimates", "revision_reason"],
      ["estimates", "revision_requested_at"],
      ["estimates", "decision_note"],
      ["estimates", "submitted_at"],
      ["estimates", "decided_at"],
      ["estimates", "decided_by"],
      ["estimates", "approved_at"],
    ],
    tables: [],
    // `decide_estimate()` is the only path that can approve a version, so its
    // presence is the clearest signal that this file ran to completion.
    functions: ["decide_estimate", "submit_estimate"],
  },
  {
    // Independent of the chain above (additive, no dependency either way), and
    // unverifiable for the same reason as #8: dropping a NOT NULL leaves nothing
    // to probe. It is listed here so it is not invisible to this preflight —
    // until it runs, every customer-submitted request dies on the legacy
    // `service_requests.issue_description` NOT NULL (23502 -> a blanket HTTP 500),
    // which is exactly the class of silent gap this script exists to surface.
    order: 10,
    file: "supabase/migration_legacy_columns.sql",
    purpose:
      "Retires the legacy NOT NULL column the appliance-centric flow replaced (issue_description)",
    // Nothing in the chain depends on it: `prerequisiteOf` is deliberately absent,
    // which is what keeps it out of the pending list (see the summary block).
    columns: [],
    tables: [],
    functions: [],
  },
  {
    // Also unverifiable: the bucket lives in Supabase's `storage` schema, which
    // PostgREST does not expose. Nothing depends on it either.
    order: 11,
    file: "supabase/migration_service_request_photos_bucket.sql",
    purpose:
      "Repair-request photo evidence bucket (public read, service-role write) behind /api/service-requests/photos",
    columns: [],
    tables: [],
    functions: [],
  },
  {
    // Probeable, so it appears in the pending list until it is applied — which is
    // the point: these two columns were invisible to every check (the file that
    // defines them early-returns on an already-appliance-centric database, and
    // schema.sql only covers fresh installs), so `POST /api/appliances` answered
    // PGRST204 for `warranty_type` with nothing in this preflight to explain it.
    order: 12,
    file: "supabase/migration_appliance_columns.sql",
    purpose:
      "appliances.warranty_type / warranty_proof_url — the columns migration_appliance_centric_flow.sql skips",
    columns: [
      ["appliances", "warranty_type"],
      ["appliances", "warranty_proof_url"],
    ],
    tables: [],
    functions: [],
  },
  {
    // Enum values cannot be probed through PostgREST, so this file can never be
    // confirmed — only the file that uses the value can prove it ran. It is listed
    // with the pending files while step 14 is pending, because 14 references
    // 'awaiting_payment' in a policy predicate and PostgreSQL refuses to use an enum
    // value in the same transaction that adds it.
    order: 13,
    file: "supabase/migration_booking_payment_status.sql",
    purpose:
      "booking_status gains 'awaiting_payment' — the state between a confirmed inspection and a verified payment",
    columns: [],
    tables: [],
    functions: [],
    prerequisiteOf: [14],
  },
  {
    // The policies and triggers this file installs cannot be probed through the
    // API, but confirm_payment() can: its presence is the signal that the file ran
    // to completion, and it is the only writer of a completed repair.
    order: 14,
    file: "supabase/migration_rls_workflow_enforcement.sql",
    purpose:
      "RLS + trigger enforcement of the workflow rules, and confirm_payment() as the only path to completion",
    columns: [],
    tables: [],
    functions: ["confirm_payment"],
    // Batch 2's booking transaction writes the request statuses this file's matrix
    // allows and relies on its `reopen_request_after_booking_cancel` trigger to
    // return a request to `quoted`, so it must not be applied first. Batch 3's
    // reject_payment() extends the payment decision model this file established
    // (confirm_payment, the submission policy and the pending_verification rule),
    // so it depends on this file too.
    prerequisiteOf: [15, 16],
  },
  {
    // Batch 2. The unique index and the overlap trigger are invisible to
    // PostgREST, but both functions are listed in the OpenAPI document, so their
    // presence is the signal that the file ran to completion. `create_booking_atomic`
    // is what POST /api/bookings calls; `release_technician_slot` is the atomic
    // counterpart for a cancellation.
    order: 15,
    file: "supabase/migration_atomic_booking.sql",
    purpose:
      "Atomic booking creation, one live booking per request, and no overlapping appointments per technician",
    columns: [],
    tables: [],
    functions: ["create_booking_atomic", "release_technician_slot"],
  },
  {
    // Batch 3. The rejection columns ARE probeable (they are real columns on
    // `payments`), so this step is listed as pending until the file is applied;
    // `reject_payment` is the signal that the file ran to completion, and the
    // decision trigger and the constraint come with it. confirm_payment() is
    // deliberately not touched by this file.
    order: 16,
    file: "supabase/migration_reject_payment.sql",
    purpose:
      "Database-enforced payment rejection: reject_payment(), rejection metadata, and the payment decision trigger",
    // [table, column] pairs — the probe loop destructures them, so a bare string
    // would be iterated character by character ("rejected_by" -> table "r",
    // column "e") and reported as a missing object that does not exist.
    columns: [
      ["payments", "rejected_by"],
      ["payments", "rejected_at"],
      ["payments", "rejection_reason"],
    ],
    tables: [],
    functions: ["reject_payment"],
  },
  {
    // Step 17, the booking eligibility invariant. Both new helpers are granted to
    // service_role, so PostgREST lists them and their presence is the signal that the
    // file ran. `create_booking_atomic` is re-declared here as well: it exists from
    // step 15, so it alone cannot tell you whether THIS file ran — the two helpers can.
    order: 17,
    file: "supabase/migration_booking_eligibility.sql",
    purpose:
      "A booking requires a technician who is still qualified for the request's appliance type (technician_qualification_failure, appliance_has_qualified_technician, create_booking_atomic)",
    columns: [],
    tables: [],
    functions: ["technician_qualification_failure", "appliance_has_qualified_technician"],
    // It replaces the eligibility gate and the booking transaction, so it must not be
    // applied before the queue engine (step 3) and Batch 2 (step 15) exist.
    prerequisiteOf: [],
  },
  {
    // Step 18, the atomic cancellation release. `booking_status_holds_slot` is the
    // signal that the file ran: it is granted to service_role, so PostgREST lists it.
    // The trigger and its function cannot be the signal — a `returns trigger`
    // function is not callable as an RPC, so it never appears in the OpenAPI
    // document. `release_technician_slot` is re-used by the trigger but exists from
    // step 15, so it proves nothing about THIS file.
    order: 18,
    file: "supabase/migration_cancel_release.sql",
    purpose:
      "Cancelling a booking releases the technician's slot and refreshes their operational status in the same transaction (release_slot_after_booking_cancel trigger, booking_status_holds_slot predicate)",
    columns: [],
    tables: [],
    functions: ["booking_status_holds_slot"],
    // It calls the release primitive (step 15) and the status refresh (step 3) and
    // fires on `bookings`, so it must not be applied before either of them exists.
    prerequisiteOf: [],
  },
];

/**
 * A malformed registry entry MISREPORTS the database, which is worse than not
 * checking at all: a bare string in `columns` is destructured character by
 * character by the probe loop, so "rejected_by" became a probe of table "r",
 * column "e" and produced a FAIL for an object that was never real — while the
 * migration was fully applied. Fail loudly here instead of quietly blaming the
 * database.
 */
for (const migration of MIGRATIONS) {
  for (const entry of migration.columns ?? []) {
    const wellFormed =
      Array.isArray(entry) &&
      entry.length === 2 &&
      entry.every((part) => typeof part === "string" && part.length > 0);
    if (!wellFormed) {
      throw new Error(
        `check-migration-state: step ${migration.order} (${migration.file}) has a malformed columns entry ` +
          `${JSON.stringify(entry)} — expected ["table", "column"]`
      );
    }
  }
  for (const key of ["tables", "functions"]) {
    for (const entry of migration[key] ?? []) {
      if (typeof entry !== "string" || entry.length === 0) {
        throw new Error(
          `check-migration-state: step ${migration.order} (${migration.file}) has a malformed ${key} entry ${JSON.stringify(entry)} — expected a name`
        );
      }
    }
  }
}

let failures = 0;
let passes = 0;

function ok(label) {
  passes++;
  console.log(`  PASS  ${label}`);
}

function bad(label, detail) {
  failures++;
  console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`);
}

/** Reads PostgREST's OpenAPI document once and keeps the exposed RPC names. */
async function fetchExposedFunctions() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: "application/openapi+json",
    },
  });
  if (!res.ok) {
    throw new Error(`OpenAPI fetch failed: HTTP ${res.status} ${res.statusText}`);
  }
  const spec = await res.json();
  const names = new Set();
  for (const p of Object.keys(spec.paths ?? {})) {
    const m = /^\/rpc\/(.+)$/.exec(p);
    if (m) names.add(m[1]);
  }
  return names;
}

async function main() {
  console.log(`SPARKServ migration preflight`);
  console.log(`Project: ${SUPABASE_URL}\n`);

  let exposed;
  try {
    exposed = await fetchExposedFunctions();
  } catch (err) {
    console.error(`Could not read the project's OpenAPI document: ${err.message}`);
    console.error("Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(2);
  }
  console.log(`PostgREST exposes ${exposed.size} RPCs to the service role.\n`);

  const status = [];

  for (const migration of MIGRATIONS) {
    console.log(`-- ${migration.order}. ${migration.file}`);
    console.log(`   ${migration.purpose}`);
    let pendingHere = 0;

    // Nothing to probe means nothing to confirm. Enum values, a dropped NOT NULL
    // and a storage bucket are all invisible to PostgREST, so such a file must not
    // be allowed to print a bare "applied" — that is the same all-green lie this
    // script was written to stop.
    const probes =
      migration.columns.length +
      migration.tables.length +
      migration.functions.length +
      (migration.settings ?? []).length;
    const unverifiable = probes === 0;

    for (const [table, column] of migration.columns) {
      const { error } = await admin.from(table).select(column).limit(1);
      const missing =
        error && (MISSING_TABLE.has(error.code) || MISSING_COLUMN.has(error.code));
      if (missing) {
        // PGRST204/205 mean "not in PostgREST's schema cache", which is true both
        // of a column that does not exist AND of one added after the cache was
        // last reloaded. The app cannot tell the difference either — it fails the
        // same way — but the reader can, and the two fixes are different: apply
        // the migration, or reload the cache.
        bad(
          `${table}.${column}`,
          error.code === "PGRST204" || error.code === "PGRST205"
            ? "not in PostgREST's schema cache: either it does not exist, or it was added after the cache was last reloaded"
            : undefined
        );
        pendingHere++;
      } else {
        ok(`${table}.${column}`);
      }
    }

    for (const table of migration.tables) {
      // limit(0) keeps the response empty; we only care whether it resolves.
      const { error } = await admin.from(table).select("*").limit(0);
      if (error && MISSING_TABLE.has(error.code)) {
        bad(`table ${table}`);
        pendingHere++;
      } else {
        ok(`table ${table}`);
      }
    }

    for (const fn of migration.functions) {
      if (exposed.has(fn)) ok(`${fn}()`);
      else {
        bad(`${fn}()`);
        pendingHere++;
      }
    }

    for (const [key, expected] of migration.settings ?? []) {
      const { data, error } = await admin
        .from("system_settings")
        .select("value")
        .eq("key", key)
        .maybeSingle();
      if (error) {
        bad(`system_settings.${key}`, `table not readable yet (${error.code ?? "?"})`);
        pendingHere++;
      } else if (!data) {
        bad(`system_settings.${key}`, "row missing — this file's last statement never ran");
        pendingHere++;
      } else if (String(data.value) !== expected) {
        bad(`system_settings.${key}`, `expected "${expected}", found "${data.value}"`);
        pendingHere++;
      } else {
        ok(`system_settings.${key} = ${expected}`);
      }
    }

    status.push({ migration, pending: pendingHere, unverifiable });
    console.log(
      unverifiable
        ? `   => nothing to probe: cannot be confirmed through the API\n`
        : pendingHere === 0
          ? `   => applied\n`
          : `   => ${pendingHere} object(s) MISSING\n`
    );
  }

  console.log("-".repeat(62));
  const pendingMig = status.filter((s) => s.pending > 0);
  const unverifiable = status.filter((s) => s.unverifiable);

  /**
   * What to put in the "apply these, in this order" list:
   *
   *   * every file with a failing probe, and
   *   * every UNVERIFIABLE file that a still-pending file DECLARES it needs
   *     (`prerequisiteOf`). Leaving one out is how "5, 6, 7, 9" gets applied and
   *     step 9 fails on an enum value nothing warned about.
   *
   * An unverifiable file that nothing pending depends on is deliberately NOT
   * listed: it can never be confirmed, so listing it forever would only teach you
   * to ignore the list. It is reported in the block above instead.
   *
   * The dependency is read from `prerequisiteOf` and never from the numbering.
   * Order is not dependency: #10 and #11 sit before #12 but nothing needs them, and
   * a numeric comparison pulled them into the list with a note claiming a later
   * file required them — and kept printing #8 after step 9 had already been applied.
   */
  const pendingOrders = new Set(pendingMig.map((s) => s.migration.order));
  const neededBy = (migration) =>
    (migration.prerequisiteOf ?? []).filter((order) => pendingOrders.has(order));

  const mustApply = status.filter(
    (s) => s.pending > 0 || (s.unverifiable && neededBy(s.migration).length > 0)
  );

  if (unverifiable.length > 0) {
    console.log("Not directly verifiable through PostgREST (no probeable object):");
    for (const { migration } of unverifiable) {
      console.log(`  ${migration.order}. ${migration.file}`);
    }
    console.log(
      "Their effects (enum values, a dropped NOT NULL, a storage bucket) are\n" +
        "invisible to the API, so this check can neither confirm nor deny them.\n"
    );
  }

  if (mustApply.length === 0) {
    console.log(`All ${MIGRATIONS.length} migrations are applied. (${passes} checks passed)`);
    console.log("Next: npm run verify:queue");
    process.exit(0);
  }

  console.log("PENDING - apply these in the Supabase SQL Editor, in this exact order,");
  console.log("one file at a time, waiting for each to report success:\n");
  for (const { migration, pending, unverifiable: cannotConfirm } of mustApply) {
    const needs = neededBy(migration);
    const note =
      pending === 0 && cannotConfirm
        ? `   (no probeable object; step ${needs.join(", ")} needs it)`
        : "";
    console.log(`  ${migration.order}. ${migration.file}${note}`);
  }
  console.log(
    "\nEvery file is guarded and idempotent, so re-running one that is already\n" +
      "applied is harmless. Then re-run this check: npm run db:check"
  );
  console.log(
    "\nA file that reports success here and STILL fails above was added after\n" +
      "PostgREST last read the schema — reload its cache, then re-run this check:\n" +
      "  notify pgrst, 'reload schema';"
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(`\nUnexpected failure: ${err.message}`);
  process.exit(2);
});

