#!/usr/bin/env node
/**
 * SPARKServ migration-state preflight  —  `npm run db:check`
 * =========================================================
 *
 * Answers one question against the REAL Supabase project in `.env.local`:
 * "which of the three migrations have actually been applied?"
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
 * The three migrations, in the order they must be applied. `settings` are
 * row-level seeds rather than schema: migration 3 writes
 * queue_model_version = '2.0' as its LAST statement, which makes it a reliable
 * "did the file run to completion" marker — a half-applied file leaves the
 * tables present but this row missing, and that distinction is worth keeping.
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
];

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

    for (const [table, column] of migration.columns) {
      const { error } = await admin.from(table).select(column).limit(1);
      const missing =
        error && (MISSING_TABLE.has(error.code) || MISSING_COLUMN.has(error.code));
      if (missing) {
        bad(`${table}.${column}`);
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

    status.push({ migration, pending: pendingHere });
    console.log(pendingHere === 0 ? `   => applied\n` : `   => ${pendingHere} object(s) MISSING\n`);
  }

  console.log("-".repeat(62));
  const pendingMig = status.filter((s) => s.pending > 0);
  if (pendingMig.length === 0) {
    console.log(`All three migrations are applied. (${passes} checks passed)`);
    console.log("Next: npm run verify:queue");
    process.exit(0);
  }

  console.log("PENDING - apply these in the Supabase SQL Editor, in this exact order,");
  console.log("one file at a time, waiting for each to report success:\n");
  for (const { migration } of pendingMig) {
    console.log(`  ${migration.order}. ${migration.file}`);
  }
  console.log(
    "\nEvery file is guarded and idempotent, so re-running one that is already\n" +
      "applied is harmless. Then re-run this check: npm run db:check"
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(`\nUnexpected failure: ${err.message}`);
  process.exit(2);
});

