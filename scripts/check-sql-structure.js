const fs = require("fs");

const files = [
  "supabase/schema.sql",
  "supabase/migration_flow_hardening.sql",
  "supabase/migration_appliance_centric_flow.sql",
  "supabase/migration_technician_queue.sql",
  "supabase/migration_sync_live_schema.sql",
];

const DOLLAR = /\$\$/g;
let failed = false;

for (const f of files) {
  const s = fs.readFileSync(f, "utf8");
  const dollars = (s.match(DOLLAR) || []).length;
  const functions = (s.match(/create (or replace )?(function|procedure)/gi) || []).length;
  const doBlocks = (s.match(/do \$\$/gi) || []).length;
  const balanced = dollars % 2 === 0;

  console.log(`${f}`);
  console.log(`  $$ markers: ${dollars} ${balanced ? "(balanced)" : "(UNBALANCED!)"}`);
  console.log(`  functions: ${functions}  do-blocks: ${doBlocks}`);

  if (!balanced) failed = true;

  // every create function/do block should have a matching closing "$$;"
  const closers = (s.match(/\$\$;/g) || []).length;
  const bodies = functions + doBlocks;
  console.log(`  bodies: ${bodies}  "$$;" closers: ${closers}`);
  if (closers < bodies) {
    console.log("  WARNING: fewer closers than bodies");
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
