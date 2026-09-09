// Restores (or bulk-edits) the shop from a CSV produced by `npm run export:csv`
// or by the admin panel's Settings → Backup tab.
//
//   npm run import:csv -- ./exports/products-2026-09-09.csv --dry-run
//   npm run import:csv -- ./exports/products-2026-09-09.csv
//
// All the safety rules live in server/backup.js, shared with the admin panel.
import fs from 'node:fs';
import path from 'node:path';
import { sql } from '../server/db.js';
import { analyseCsv, applyCsv } from '../server/backup.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const file = args.find(a => !a.startsWith('--'));

if (!file) {
  console.error('Usage: npm run import:csv -- <file.csv> [--dry-run]');
  process.exit(1);
}
const p = path.resolve(file);
if (!fs.existsSync(p)) { console.error(`No such file: ${p}`); process.exit(1); }
const text = fs.readFileSync(p, 'utf8');

let a;
try { a = await analyseCsv(text); }
catch (e) { console.error(e.message); process.exit(1); }

console.log(`Reading ${a.rows.length} row(s) as "${a.table}"${dryRun ? '  (dry run — nothing will be written)' : ''}\n`);
if (a.ignored.length) console.log(`  ignoring unknown column(s): ${a.ignored.join(', ')}`);

if (a.problems.length) {
  console.error(`\nRefusing to import — ${a.problems.length} problem(s):`);
  a.problems.slice(0, 15).forEach(m => console.error('  ' + m));
  if (a.problems.length > 15) console.error(`  …and ${a.problems.length - 15} more`);
  process.exit(1);
}

const show = (c) => c.kind === 'new'
  ? `  + new: ${c.key}`
  : `  ~ ${c.key}: ` + c.fields.map(f =>
      `${f.field} ${JSON.stringify(f.from.slice(0, 30))} -> ${JSON.stringify(f.to.slice(0, 30))}`).join(', ');
a.changes.slice(0, 40).forEach(c => console.log(show(c)));
if (a.changes.length > 40) console.log(`  …and ${a.changes.length - 40} more`);
console.log(`\n${a.creates} new, ${a.updates} changed, ${a.unchanged} unchanged`);

if (dryRun) { console.log('\nDry run — nothing was written.'); await sql.end(); process.exit(0); }
if (!a.creates && !a.updates) { console.log('\nNothing to do.'); await sql.end(); process.exit(0); }

await applyCsv(text);
console.log(`\nApplied ${a.rows.length} row(s) to "${a.table}".`);
await sql.end();
