// Restores a snapshot produced by scripts/backup.js.
//
//   npm run backup -- --list                       # find the snapshot you want
//   npm run restore -- <name-or-path> --dry-run    # always preview first
//   npm run restore -- <name-or-path>
//
// The argument is either a local .json file or the name of a snapshot in the
// private backup bucket, which is downloaded automatically.
//
// Rows are upserted by natural key (slug / key / order_no) and nothing is
// deleted, so restoring is additive: it puts back what was lost without
// discarding anything created since the snapshot was taken.
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { sql } from '../server/db.js';

const BUCKET = process.env.SUPABASE_BACKUP_BUCKET || 'plantmood-backups';
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const target = args.find(a => !a.startsWith('--'));

if (!target) {
  console.error('Usage: npm run restore -- <snapshot.json | snapshot-name-in-bucket> [--dry-run]');
  process.exit(1);
}

let body;
if (fs.existsSync(path.resolve(target))) {
  body = fs.readFileSync(path.resolve(target), 'utf8');
  console.log(`Reading local file ${path.resolve(target)}`);
} else {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.storage.from(BUCKET).download(target);
  if (error) {
    console.error(`Not found locally or in bucket "${BUCKET}": ${target}`);
    console.error('Run `npm run backup -- --list` to see what is stored.');
    process.exit(1);
  }
  body = Buffer.from(await data.arrayBuffer()).toString('utf8');
  console.log(`Downloaded ${target} from "${BUCKET}"`);
}

const snap = JSON.parse(body);
console.log(`Snapshot taken at ${snap.takenAt}`);
console.log(`  ${snap.products?.length || 0} products, ${snap.orders?.length || 0} orders, ` +
            `${snap.site_content?.length || 0} content overrides`);

const q = (id) => '"' + String(id).replace(/"/g, '""') + '"';

async function upsert(table, rows, conflictKey) {
  if (!rows?.length) { console.log(`- ${table}: nothing in snapshot`); return; }
  if (dryRun) { console.log(`- ${table}: would restore ${rows.length} row(s)`); return; }
  // Restore only columns the live schema still has, so an older snapshot
  // (taken before a column was added or removed) still applies.
  const live = (await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
  `).map(r => r.column_name);
  const cols = Object.keys(rows[0]).filter(c => live.includes(c));
  const updatable = cols.filter(c => c !== conflictKey && c !== 'id');

  for (const row of rows) {
    let stmt = `INSERT INTO ${q(table)} (${cols.map(q).join(', ')}) ` +
               `VALUES (${cols.map((_, i) => '$' + (i + 1)).join(', ')})`;
    stmt += updatable.length
      ? ` ON CONFLICT (${q(conflictKey)}) DO UPDATE SET ` +
        updatable.map(c => `${q(c)} = excluded.${q(c)}`).join(', ')
      : ` ON CONFLICT (${q(conflictKey)}) DO NOTHING`;
    await sql.unsafe(stmt, cols.map(c => row[c] ?? null));
  }
  console.log(`- ${table}: restored ${rows.length} row(s)`);
}

await upsert('categories', snap.categories, 'slug');
await upsert('products', snap.products, 'slug');
await upsert('settings', snap.settings, 'key');
await upsert('site_content', snap.site_content, 'key');
await upsert('subscribers', snap.subscribers, 'email');
await upsert('orders', snap.orders, 'order_no');

// order_items has no natural key; re-insert only for orders that currently have
// none, so a repeated restore cannot duplicate an order's lines.
if (snap.order_items?.length && !dryRun) {
  const idByNo = new Map((await sql`SELECT id, order_no FROM orders`).map(r => [r.order_no, r.id]));
  const noById = new Map((snap.orders || []).map(o => [o.id, o.order_no]));
  const withItems = new Set((await sql`SELECT DISTINCT order_id FROM order_items`).map(r => r.order_id));
  let n = 0;
  for (const it of snap.order_items) {
    const liveId = idByNo.get(noById.get(it.order_id));
    if (!liveId || withItems.has(liveId)) continue;
    await sql`
      INSERT INTO order_items (order_id, product_id, name, price, qty)
      VALUES (${liveId}, ${it.product_id}, ${it.name}, ${it.price}, ${it.qty})
    `;
    n++;
  }
  console.log(`- order_items: restored ${n} line(s)`);
} else if (snap.order_items?.length) {
  console.log(`- order_items: would restore up to ${snap.order_items.length} line(s)`);
}

if (!dryRun) {
  for (const t of ['products', 'orders', 'order_items', 'subscribers', 'messages']) {
    await sql.unsafe(
      `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`
    );
  }
  console.log('\nRestore complete.');
} else {
  console.log('\nDry run — nothing was written.');
}

await sql.end();
