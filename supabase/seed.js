#!/usr/bin/env node
/**
 * Seed the `clients` table with our existing sub-accounts.
 *
 * Usage:
 *   SUPABASE_URL=https://<project>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
 *   node seed.js
 *
 * Fill in the real GHL location ids below first (Settings → Business Profile
 * in each sub-account, or copy from the sub-account URL: .../location/<ID>/...).
 * The script refuses to run while any REPLACE_ME placeholder remains.
 *
 * Re-runnable: existing rows are skipped (ignore-duplicates), so re-seeding
 * never resets a tier you've since bumped. To change a tier, use SQL or the
 * Supabase table editor (see README).
 *
 * Requires Node 18+ (built-in fetch). No npm dependencies.
 */

const CLIENTS = [
  { location_id: 'REPLACE_ME_AUTOTAX',  name: 'AutoTax' },
  { location_id: 'REPLACE_ME_SIXWATCH', name: 'Sixwatch' },
  { location_id: 'REPLACE_ME_SOSDEBT',  name: 'SOS Debt' },
  { location_id: 'REPLACE_ME_BAYMASTER', name: 'Baymaster' },
  { location_id: 'REPLACE_ME_PULLMAN',  name: 'Pullman' },
  { location_id: 'REPLACE_ME_SQFT',     name: 'SQFT' },
  { location_id: 'REPLACE_ME_DENTLY',   name: 'Dently AI' },
].map((c) => ({ ...c, tier: 'DeliHub Free', products: [] }));

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.');
    process.exit(1);
  }

  const placeholders = CLIENTS.filter((c) => c.location_id.startsWith('REPLACE_ME'));
  if (placeholders.length) {
    console.error(
      'Fill in real GHL location ids for: ' + placeholders.map((c) => c.name).join(', ')
    );
    process.exit(1);
  }

  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/clients?on_conflict=location_id`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=representation',
    },
    body: JSON.stringify(CLIENTS),
  });

  if (!res.ok) {
    console.error(`Seed failed: HTTP ${res.status}`, await res.text());
    process.exit(1);
  }

  const rows = await res.json();
  console.log(`Inserted ${rows.length} new clients (already-existing rows skipped):`);
  for (const r of rows) console.log(`  ${r.location_id}  ${r.name}  [${r.tier}]`);
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
