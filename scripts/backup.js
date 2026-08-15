// Daily snapshot of everything the owner can change: prices, products,
// categories, site content, settings, orders and their line items.
//
//   npm run backup                    -> upload to the private Supabase bucket
//   npm run backup -- --local ./dir   -> also write a copy into ./dir
//   npm run backup -- --list          -> list the snapshots already stored
//
// Snapshots go to a PRIVATE Storage bucket, never into git: the repository is
// public and orders contain customer names, phone numbers and addresses.
//
// Restore with:  npm run restore -- <snapshot.json>
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { sql } from '../server/db.js';

const BUCKET = process.env.SUPABASE_BACKUP_BUCKET || 'plantmood-backups';
const KEEP_DAYS = Number(process.env.PLANTMOOD_BACKUP_KEEP_DAYS || 30);

const args = process.argv.slice(2);
const localIdx = args.indexOf('--local');
const localDir = localIdx !== -1 ? args[localIdx + 1] : null;
const listOnly = args.includes('--list');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Private bucket — a snapshot holds customer personal data and must never be
// reachable by URL.
async function ensureBackupBucket() {
  const { data } = await supabase.storage.getBucket(BUCKET);
  if (data) {
    if (data.public) {
      throw new Error(
        `Bucket "${BUCKET}" is PUBLIC. Snapshots contain customer names, phone ` +
        'numbers and addresses — make it private in the Supabase dashboard before backing up.'
      );
    }
    return;
  }
  const { error } = await supabase.storage.createBucket(BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) throw error;
}

if (listOnly) {
  await ensureBackupBucket();
  const { data, error } = await supabase.storage.from(BUCKET).list('', {
    limit: 100, sortBy: { column: 'name', order: 'desc' },
  });
  if (error) throw error;
  if (!data.length) console.log('No snapshots stored yet.');
  for (const f of data) {
    console.log(`  ${f.name}  ${(f.metadata?.size / 1024).toFixed(1)} KB  ${f.created_at}`);
  }
  await sql.end();
  process.exit(0);
}

// --- collect -----------------------------------------------------------------
const snapshot = {
  takenAt: new Date().toISOString(),
  categories: await sql`SELECT * FROM categories ORDER BY sort, slug`,
  products: await sql`SELECT * FROM products ORDER BY id`,
  site_content: await sql`SELECT * FROM site_content ORDER BY key`,
  // The admin password hash is included so a restore does not lock the owner out.
  settings: await sql`SELECT * FROM settings ORDER BY key`,
  orders: await sql`SELECT * FROM orders ORDER BY id`,
  order_items: await sql`SELECT * FROM order_items ORDER BY id`,
  subscribers: await sql`SELECT * FROM subscribers ORDER BY id`,
  messages: await sql`SELECT * FROM messages ORDER BY id`,
};

const body = JSON.stringify(snapshot, null, 2);
const stamp = snapshot.takenAt.slice(0, 19).replace(/[:T]/g, '-');
const name = `plantmood-${stamp}.json`;

console.log(
  `Snapshot: ${snapshot.products.length} products, ${snapshot.orders.length} orders, ` +
  `${snapshot.site_content.length} content overrides, ${(body.length / 1024).toFixed(1)} KB`
);

// A snapshot with no products almost certainly means something is wrong
// (bad credentials, wrong database). Refuse to store it — otherwise the daily
// job would quietly rotate the good snapshots out and replace them with empties.
if (!snapshot.products.length) {
  console.error('Refusing to store a snapshot with 0 products — check DATABASE_URL.');
  await sql.end();
  process.exit(1);
}

// --- store -------------------------------------------------------------------
await ensureBackupBucket();
const { error: upErr } = await supabase.storage.from(BUCKET).upload(name, Buffer.from(body), {
  contentType: 'application/json',
  upsert: true,
});
if (upErr) throw upErr;
console.log(`Stored ${name} in private bucket "${BUCKET}".`);

if (localDir) {
  fs.mkdirSync(path.resolve(localDir), { recursive: true });
  const p = path.join(path.resolve(localDir), name);
  fs.writeFileSync(p, body);
  console.log(`Local copy: ${p}`);
}

// --- prune -------------------------------------------------------------------
const { data: existing } = await supabase.storage.from(BUCKET).list('', { limit: 1000 });
const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
const stale = (existing || [])
  .filter(f => f.name.endsWith('.json') && f.name !== name)
  .filter(f => new Date(f.created_at).getTime() < cutoff)
  .map(f => f.name);
if (stale.length) {
  await supabase.storage.from(BUCKET).remove(stale);
  console.log(`Removed ${stale.length} snapshot(s) older than ${KEEP_DAYS} days.`);
}

await sql.end();
