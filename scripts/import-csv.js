// Restores (or bulk-edits) the shop from a CSV produced by `npm run export:csv`.
//
//   npm run import:csv -- ./exports/products-2026-09-09.csv --dry-run
//   npm run import:csv -- ./exports/products-2026-09-09.csv
//
// The table is chosen from the file's header, so you can pass a products,
// categories or site_content CSV and it does the right thing.
//
// Rows are upserted by natural key (slug / key) and nothing is deleted: a row
// you remove from the spreadsheet is left alone in the database, so an
// accidental deletion in Excel cannot wipe the shop. Delete products in the
// admin panel instead.
//
// Orders are intentionally NOT importable — they are financial records, and
// rewriting them from a spreadsheet is not something a restore should do.
import fs from 'node:fs';
import path from 'node:path';
import { sql } from '../server/db.js';
import { fromCsv } from './csv.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const file = args.find(a => !a.startsWith('--'));

if (!file) {
  console.error('Usage: npm run import:csv -- <file.csv> [--dry-run]');
  process.exit(1);
}
const p = path.resolve(file);
if (!fs.existsSync(p)) { console.error(`No such file: ${p}`); process.exit(1); }

const rows = fromCsv(fs.readFileSync(p, 'utf8'));
if (!rows.length) { console.error('That CSV has no data rows.'); process.exit(1); }

const header = Object.keys(rows[0]);
const SHAPES = {
  products:     { key: 'slug', required: ['slug', 'name', 'price'],
                  numeric: ['price', 'stock', 'featured'] },
  categories:   { key: 'slug', required: ['slug', 'name'], numeric: ['sort'] },
  site_content: { key: 'key',  required: ['key', 'value'], numeric: [] },
};

const table = Object.keys(SHAPES).find(t => SHAPES[t].required.every(c => header.includes(c)));
if (!table) {
  console.error('Could not tell what this CSV is. Expected a products, categories or');
  console.error(`site_content export. Columns found: ${header.join(', ')}`);
  process.exit(1);
}
const shape = SHAPES[table];
console.log(`Reading ${rows.length} row(s) as "${table}"${dryRun ? '  (dry run — nothing will be written)' : ''}\n`);

// Only write columns that exist in both the file and the live table, so an
// export from an older version of the schema still imports.
const live = (await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = ${table}
`).map(r => r.column_name);
const cols = header.filter(c => live.includes(c));
const skipped = header.filter(c => !live.includes(c));
if (skipped.length) console.log(`  ignoring unknown column(s): ${skipped.join(', ')}`);

// Validate everything before writing anything: a half-applied price list is
// worse than a rejected one.
const problems = [];
rows.forEach((r, i) => {
  const line = i + 2; // +1 header, +1 to 1-based
  if (!String(r[shape.key] || '').trim()) problems.push(`line ${line}: empty ${shape.key}`);
  for (const n of shape.numeric) {
    if (r[n] === undefined || r[n] === '') continue;
    if (!Number.isFinite(Number(r[n]))) problems.push(`line ${line}: ${n} is not a number ("${r[n]}")`);
    else if ((n === 'price' || n === 'stock') && Number(r[n]) < 0) problems.push(`line ${line}: ${n} is negative`);
  }
});
if (problems.length) {
  console.error(`\nRefusing to import — ${problems.length} problem(s):`);
  problems.slice(0, 15).forEach(m => console.error('  ' + m));
  if (problems.length > 15) console.error(`  …and ${problems.length - 15} more`);
  process.exit(1);
}

// Show what would actually change, so a dry run is worth reading.
const existing = new Map(
  (await sql.unsafe(`SELECT * FROM ${table}`)).map(r => [r[shape.key], r])
);
let creates = 0, updates = 0, unchanged = 0;
const diffs = [];
for (const r of rows) {
  const cur = existing.get(r[shape.key]);
  if (!cur) { creates++; diffs.push(`  + new: ${r[shape.key]}`); continue; }
  const changed = cols.filter(c => c !== shape.key &&
    String(cur[c] ?? '').trim() !== String(r[c] ?? '').trim() &&
    !(shape.numeric.includes(c) && Number(cur[c]) === Number(r[c])));
  if (!changed.length) { unchanged++; continue; }
  updates++;
  diffs.push(`  ~ ${r[shape.key]}: ` + changed.map(c =>
    `${c} ${JSON.stringify(String(cur[c] ?? '').slice(0, 30))} -> ${JSON.stringify(String(r[c] ?? '').slice(0, 30))}`).join(', '));
}
diffs.slice(0, 40).forEach(d => console.log(d));
if (diffs.length > 40) console.log(`  …and ${diffs.length - 40} more`);
console.log(`\n${creates} new, ${updates} changed, ${unchanged} unchanged`);

if (dryRun) { console.log('\nDry run — nothing was written.'); await sql.end(); process.exit(0); }
if (!creates && !updates) { console.log('\nNothing to do.'); await sql.end(); process.exit(0); }

const q = (id) => '"' + String(id).replace(/"/g, '""') + '"';
const updatable = cols.filter(c => c !== shape.key);
let written = 0;
for (const r of rows) {
  const values = cols.map(c => {
    if (r[c] === '' || r[c] === undefined) return null;
    if (shape.numeric.includes(c)) return Number(r[c]);
    return r[c];
  });
  const stmt = `INSERT INTO ${q(table)} (${cols.map(q).join(', ')}) ` +
    `VALUES (${cols.map((_, i) => '$' + (i + 1)).join(', ')}) ` +
    `ON CONFLICT (${q(shape.key)}) DO UPDATE SET ` +
    updatable.map(c => `${q(c)} = coalesce(excluded.${q(c)}, ${q(table)}.${q(c)})`).join(', ');
  await sql.unsafe(stmt, values);
  written++;
}
console.log(`\nApplied ${written} row(s) to "${table}".`);
await sql.end();
