// Exports the shop as spreadsheet files you can open in Excel or Google Sheets.
// The same export is available in the admin panel under Settings → Backup.
//
//   npm run export:csv                 -> ./exports/
//   npm run export:csv -- ./somewhere
//
// NOTE: `image` holds the photo's path, not the photo itself. Photo files live
// in Supabase Storage; a CSV restore brings back every price and word but
// points at photos that must still exist (or be re-uploaded).
import fs from 'node:fs';
import path from 'node:path';
import { sql } from '../server/db.js';
import { CSV_TABLES, exportCsv } from '../server/backup.js';

const outDir = path.resolve(process.argv.slice(2).find(a => !a.startsWith('--')) || './exports');
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);

for (const table of Object.keys(CSV_TABLES)) {
  const { csv, rows } = await exportCsv(table);
  const file = path.join(outDir, `${table}-${stamp}.csv`);
  fs.writeFileSync(file, csv);
  console.log(`  ${String(rows).padStart(4)} rows -> ${file}`);
}

console.log('\nOpen these in Excel or Google Sheets. To apply edits back:');
console.log('  npm run import:csv -- ./exports/products-<date>.csv --dry-run');
console.log('\nReminder: orders CSVs contain customer names, phone numbers and');
console.log('addresses — keep them off shared drives and out of git.');

await sql.end();
