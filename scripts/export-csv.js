// Exports the shop as spreadsheet files you can open in Excel or Google Sheets.
//
//   npm run export:csv                 -> ./exports/
//   npm run export:csv -- ./somewhere
//
// This is the human-readable counterpart to the JSON snapshot: if the database
// is ever lost, `npm run import:csv` puts these rows back. Edit prices in a
// spreadsheet and import the file to apply them in bulk.
//
// NOTE: `image` holds the photo's path, not the photo itself. Photo files live
// in Supabase Storage; a CSV restore brings back every price and word but
// points at photos that must still exist (or be re-uploaded).
import fs from 'node:fs';
import path from 'node:path';
import { sql } from '../server/db.js';
import { toCsv } from './csv.js';

const outDir = path.resolve(process.argv.slice(2).find(a => !a.startsWith('--')) || './exports');
fs.mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().slice(0, 10);

const tables = [
  ['products', ['slug','name','species','price','stock','category','featured','image','alt','care','description'],
   await sql`SELECT slug,name,species,price,stock,category,featured,image,alt,care,description FROM products ORDER BY category, name`],
  ['categories', ['slug','name','tagline','hero_image','sort'],
   await sql`SELECT slug,name,tagline,hero_image,sort FROM categories ORDER BY sort, slug`],
  ['site_content', ['key','value'],
   await sql`SELECT key,value FROM site_content ORDER BY key`],
  ['orders', ['order_no','created_at','status','name','email','phone','address1','address2','city','state','postcode','subtotal','shipping','total','notes'],
   await sql`SELECT order_no,created_at,status,name,email,phone,address1,address2,city,state,postcode,subtotal,shipping,total,notes FROM orders ORDER BY id`],
  ['order_items', ['order_no','name','price','qty'],
   await sql`SELECT o.order_no, i.name, i.price, i.qty FROM order_items i JOIN orders o ON o.id = i.order_id ORDER BY i.id`],
];

for (const [name, cols, rows] of tables) {
  const file = path.join(outDir, `${name}-${stamp}.csv`);
  fs.writeFileSync(file, toCsv(rows, cols));
  console.log(`  ${rows.length.toString().padStart(4)} rows -> ${file}`);
}

console.log('\nOpen these in Excel or Google Sheets. To apply edits back:');
console.log('  npm run import:csv -- ./exports/products-<date>.csv --dry-run');
console.log('\nReminder: orders CSVs contain customer names, phone numbers and');
console.log('addresses — keep them off shared drives and out of git.');

await sql.end();
