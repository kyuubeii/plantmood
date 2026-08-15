// Restores a recovered SQLite database (the old plantmood.db) into Supabase.
//
//   npm run migrate
//   npm run import:sqlite -- /path/to/plantmood.db
//   npm run import:sqlite -- /path/to/plantmood.db --dry-run
//
// The deployed schema drifted from this repo's more than once (there used to be
// an ALTER TABLE migration for orders.token), so every table is imported using
// the columns the file actually has, intersected with the columns Postgres has.
// Missing columns fall back to their Postgres defaults instead of failing.
//
// Products/categories/settings/content are upserted by their natural key, so
// re-running is safe. Orders are matched on order_no and skipped if already
// present, so an interrupted run can simply be repeated.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { sql } from '../server/db.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const file = args.find(a => !a.startsWith('--'));

if (!file) {
  console.error('Usage: npm run import:sqlite -- <path-to-plantmood.db> [--dry-run]');
  process.exit(1);
}
const dbPath = path.resolve(file);
if (!fs.existsSync(dbPath)) {
  console.error(`No such file: ${dbPath}`);
  process.exit(1);
}

const sqlite = new DatabaseSync(dbPath, { readOnly: true });

// --- what the source file actually contains --------------------------------
const sourceTables = new Set(
  sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name)
);
const sourceCols = (table) =>
  sqlite.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);

// --- what Postgres will accept ---------------------------------------------
async function pgCols(table) {
  const rows = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
  `;
  return rows.map(r => r.column_name);
}

// Columns present on both sides. Anything else in the old file is reported and
// ignored rather than aborting the import.
async function sharedColumns(table) {
  const src = sourceCols(table);
  const dest = await pgCols(table);
  const shared = src.filter(c => dest.includes(c));
  const dropped = src.filter(c => !dest.includes(c));
  if (dropped.length) console.log(`  note: ignoring column(s) not in the new schema: ${dropped.join(', ')}`);
  return shared;
}

const rowsOf = (table) => sqlite.prepare(`SELECT * FROM ${table}`).all();

// Booleans/integers survive as-is; SQLite stores prices as REAL and Postgres
// wants NUMERIC, which the driver handles from a JS number.
function pick(row, cols) {
  const out = {};
  for (const c of cols) out[c] = row[c] ?? null;
  return out;
}

// Column lists are dynamic (they depend on what the recovered file contains),
// so the statement is built as text. Identifiers come from information_schema
// and PRAGMA — never from user input — and every value stays a bound parameter.
const q = (id) => '"' + String(id).replace(/"/g, '""') + '"';

async function insertRow(table, row, cols, conflictKey, returning = false) {
  const updatable = cols.filter(c => c !== conflictKey && c !== 'id');
  let stmt = `INSERT INTO ${q(table)} (${cols.map(q).join(', ')}) ` +
             `VALUES (${cols.map((_, i) => '$' + (i + 1)).join(', ')})`;
  if (conflictKey) {
    stmt += updatable.length
      ? ` ON CONFLICT (${q(conflictKey)}) DO UPDATE SET ` +
        updatable.map(c => `${q(c)} = excluded.${q(c)}`).join(', ')
      : ` ON CONFLICT (${q(conflictKey)}) DO NOTHING`;
  }
  if (returning) stmt += ' RETURNING id';
  return sql.unsafe(stmt, cols.map(c => row[c] ?? null));
}

async function importTable(table, conflictKey) {
  if (!sourceTables.has(table)) {
    console.log(`- ${table}: not present in the source file, skipped`);
    return 0;
  }
  const cols = await sharedColumns(table);
  const rows = rowsOf(table);
  if (!rows.length) {
    console.log(`- ${table}: empty`);
    return 0;
  }
  if (dryRun) {
    console.log(`- ${table}: would import ${rows.length} row(s) [${cols.join(', ')}]`);
    return rows.length;
  }
  for (const row of rows) await insertRow(table, row, cols, conflictKey);
  console.log(`- ${table}: imported ${rows.length} row(s)`);
  return rows.length;
}

console.log(`Reading ${dbPath}${dryRun ? ' (dry run — nothing will be written)' : ''}\n`);

// Categories first: products reference them.
await importTable('categories', 'slug');
await importTable('products', 'slug');
await importTable('settings', 'key');
await importTable('site_content', 'key');
await importTable('subscribers', 'email');

// --- orders + their line items ---------------------------------------------
// order_items.order_id points at the OLD order ids, so orders are inserted
// first and each new id is mapped back before the items are written.
if (sourceTables.has('orders')) {
  // Resolve the column mapping even on a dry run — a schema mismatch in orders
  // is precisely what the preview exists to surface.
  const orderCols = (await sharedColumns('orders')).filter(c => c !== 'id');
  const itemCols = sourceTables.has('order_items')
    ? (await sharedColumns('order_items')).filter(c => c !== 'id' && c !== 'order_id')
    : [];
  const existing = new Set(
    (await sql`SELECT order_no FROM orders`).map(r => r.order_no)
  );

  if (dryRun) {
    const all = rowsOf('orders');
    const fresh = all.filter(o => !existing.has(o.order_no));
    console.log(`- orders: would import ${fresh.length} order(s) with their items` +
                `${all.length - fresh.length ? `, ${all.length - fresh.length} already present` : ''}` +
                ` [${orderCols.join(', ')}]`);
    if (!itemCols.length && sourceTables.has('order_items')) {
      console.log('  warning: order_items has no columns in common with the new schema');
    }
  } else {

  let imported = 0, skipped = 0;
  for (const o of rowsOf('orders')) {
    if (existing.has(o.order_no)) { skipped++; continue; }
    const [created] = await insertRow('orders', pick(o, orderCols), orderCols, null, true);
    if (itemCols.length) {
      const items = sqlite.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id);
      for (const it of items) {
        await insertRow(
          'order_items',
          { order_id: created.id, ...pick(it, itemCols) },
          ['order_id', ...itemCols],
          null
        );
      }
    }
    imported++;
  }
  console.log(`- orders: imported ${imported} order(s)${skipped ? `, skipped ${skipped} already present` : ''}`);
  }
}

await importTable('messages', null);

// Keep the identity sequences ahead of the ids that were just inserted,
// otherwise the next INSERT collides with an imported row.
if (!dryRun) {
  for (const t of ['products', 'orders', 'order_items', 'subscribers', 'messages']) {
    await sql.unsafe(
      `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`
    );
  }
}

if (dryRun) {
  console.log('\nDry run complete — nothing was written. Re-run without --dry-run to import.');
} else {
  const [{ count: products }] = await sql`SELECT count(*)::int AS count FROM products`;
  const [{ count: orders }] = await sql`SELECT count(*)::int AS count FROM orders`;
  console.log(`\nDone. Supabase now holds ${products} product(s) and ${orders} order(s).`);
  console.log('Uploaded photos are separate — they must be copied into Supabase Storage');
  console.log('with `npm run import:uploads -- <folder>`.');
}

sqlite.close();
await sql.end();
