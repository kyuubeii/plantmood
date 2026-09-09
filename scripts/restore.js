// Restores a snapshot produced by scripts/backup.js or downloaded from
// Settings → Backup & restore.
//
//   npm run backup -- --list                       # find the snapshot you want
//   npm run restore -- <name-or-path> --dry-run    # always preview first
//   npm run restore -- <name-or-path>
//   npm run restore -- <name-or-path> --include-password
//
// The argument is either a local .json file or the name of a snapshot in the
// private backup bucket, which is downloaded automatically.
//
// Rows are upserted by natural key and nothing is deleted, so restoring is
// additive: it puts back what was lost without discarding anything created
// since. The logic is shared with the admin panel (server/backup.js).
//
// The admin password is NOT restored unless --include-password is given:
// putting back the password from the snapshot's date can lock you out.
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { sql } from '../server/db.js';
import { analyseSnapshot, applySnapshot } from '../server/backup.js';

const BUCKET = process.env.SUPABASE_BACKUP_BUCKET || 'plantmood-backups';
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const includeAdminPassword = args.includes('--include-password');
const target = args.find(a => !a.startsWith('--'));

if (!target) {
  console.error('Usage: npm run restore -- <snapshot.json | name-in-bucket> [--dry-run] [--include-password]');
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

let snap;
try { snap = JSON.parse(body); }
catch { console.error('That file is not valid JSON.'); process.exit(1); }

const opts = { includeAdminPassword };
let report;
try {
  report = dryRun ? await analyseSnapshot(snap, opts) : await applySnapshot(snap, opts);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

console.log(`Snapshot taken at ${report.takenAt || 'unknown time'}${dryRun ? '  (dry run — nothing will be written)' : ''}\n`);
for (const t of report.tables) {
  if (!t.total) { console.log(`- ${t.table}: nothing in snapshot`); continue; }
  console.log(`- ${t.table}: ${t.creates} new, ${t.updates} changed, ${t.unchanged} unchanged  (of ${t.total})`);
}
for (const s of report.skipped) console.log(`  note: skipped ${s}`);

console.log(dryRun ? '\nDry run — nothing was written.' : '\nRestore complete.');
await sql.end();
