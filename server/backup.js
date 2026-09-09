// Shared backup/restore logic. The admin panel and the command-line scripts
// both go through here so the safety rules — never delete, validate the whole
// file before writing anything, blanks keep the current value — cannot drift
// apart between the two.
import { sql } from './db.js';
import { toCsv, fromCsv } from './csv.js';

// --- what a snapshot contains ----------------------------------------------
export async function snapshot() {
  return {
    takenAt: new Date().toISOString(),
    categories: await sql`SELECT * FROM categories ORDER BY sort, slug`,
    products: await sql`SELECT * FROM products ORDER BY id`,
    site_content: await sql`SELECT * FROM site_content ORDER BY key`,
    // The admin password hash is included so a restore does not lock you out.
    settings: await sql`SELECT * FROM settings ORDER BY key`,
    orders: await sql`SELECT * FROM orders ORDER BY id`,
    order_items: await sql`SELECT * FROM order_items ORDER BY id`,
    subscribers: await sql`SELECT * FROM subscribers ORDER BY id`,
    messages: await sql`SELECT * FROM messages ORDER BY id`,
  };
}

// --- CSV shapes -------------------------------------------------------------
// Orders are deliberately absent from the importable set: they are financial
// records, not something a spreadsheet restore should rewrite.
export const CSV_TABLES = {
  products: {
    key: 'slug', required: ['slug', 'name', 'price'], numeric: ['price', 'stock', 'featured'],
    columns: ['slug','name','species','price','stock','category','featured','image','alt','care','description'],
    query: () => sql`SELECT slug,name,species,price,stock,category,featured,image,alt,care,description
                     FROM products ORDER BY category, name`,
  },
  categories: {
    key: 'slug', required: ['slug', 'name'], numeric: ['sort'],
    columns: ['slug','name','tagline','hero_image','sort'],
    query: () => sql`SELECT slug,name,tagline,hero_image,sort FROM categories ORDER BY sort, slug`,
  },
  site_content: {
    key: 'key', required: ['key', 'value'], numeric: [],
    columns: ['key','value'],
    query: () => sql`SELECT key,value FROM site_content ORDER BY key`,
  },
  orders: {
    exportOnly: true,
    columns: ['order_no','created_at','status','name','email','phone','address1','address2','city','state','postcode','subtotal','shipping','total','notes'],
    query: () => sql`SELECT order_no,created_at,status,name,email,phone,address1,address2,city,state,
                            postcode,subtotal,shipping,total,notes FROM orders ORDER BY id`,
  },
  order_items: {
    exportOnly: true,
    columns: ['order_no','name','price','qty'],
    query: () => sql`SELECT o.order_no, i.name, i.price, i.qty
                     FROM order_items i JOIN orders o ON o.id = i.order_id ORDER BY i.id`,
  },
};

export async function exportCsv(table) {
  const shape = CSV_TABLES[table];
  if (!shape) throw new Error(`Unknown table "${table}".`);
  const rows = await shape.query();
  return { csv: toCsv(rows, shape.columns), rows: rows.length };
}

// --- import -----------------------------------------------------------------
// Works out which table a CSV belongs to from its header.
function detectTable(header) {
  return Object.keys(CSV_TABLES).find(t => {
    const s = CSV_TABLES[t];
    return !s.exportOnly && s.required.every(c => header.includes(c));
  });
}

const q = (id) => '"' + String(id).replace(/"/g, '""') + '"';

// Returns what an import WOULD do, without writing. The admin panel shows this
// as a confirmation step and the CLI shows it as --dry-run.
export async function analyseCsv(text) {
  const rows = fromCsv(text);
  if (!rows.length) throw new Error('That file has no data rows.');

  const header = Object.keys(rows[0]);
  const table = detectTable(header);
  if (!table) {
    const exportOnly = Object.keys(CSV_TABLES).filter(t => CSV_TABLES[t].exportOnly);
    if (exportOnly.some(t => CSV_TABLES[t].columns.every(c => header.includes(c)))) {
      throw new Error('Orders can be exported but not imported — they are financial records.');
    }
    throw new Error(`Could not tell what this file is. Columns found: ${header.join(', ')}`);
  }
  const shape = CSV_TABLES[table];

  const live = (await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
  `).map(r => r.column_name);
  const cols = header.filter(c => live.includes(c));
  const ignored = header.filter(c => !live.includes(c));

  // Validate everything up front: a half-applied price list is worse than a
  // rejected one.
  const problems = [];
  rows.forEach((r, i) => {
    const line = i + 2; // +1 header, +1 for 1-based numbering
    if (!String(r[shape.key] || '').trim()) problems.push(`Line ${line}: ${shape.key} is empty`);
    for (const n of shape.numeric) {
      if (r[n] === undefined || r[n] === '') continue;
      if (!Number.isFinite(Number(r[n]))) problems.push(`Line ${line}: ${n} is not a number ("${r[n]}")`);
      else if ((n === 'price' || n === 'stock') && Number(r[n]) < 0) problems.push(`Line ${line}: ${n} is negative`);
    }
  });

  const existing = new Map((await sql.unsafe(`SELECT * FROM ${q(table)}`)).map(r => [r[shape.key], r]));
  const changes = [];
  let creates = 0, updates = 0, unchanged = 0;
  for (const r of rows) {
    const cur = existing.get(r[shape.key]);
    if (!cur) { creates++; changes.push({ key: r[shape.key], kind: 'new' }); continue; }
    const changed = cols.filter(c => c !== shape.key &&
      String(cur[c] ?? '').trim() !== String(r[c] ?? '').trim() &&
      !(shape.numeric.includes(c) && Number(cur[c]) === Number(r[c])));
    if (!changed.length) { unchanged++; continue; }
    updates++;
    changes.push({
      key: r[shape.key], kind: 'changed',
      fields: changed.map(c => ({ field: c, from: String(cur[c] ?? ''), to: String(r[c] ?? '') })),
    });
  }
  return { table, rows, cols, ignored, problems, creates, updates, unchanged, changes };
}

// Applies a previously analysed CSV. Rows are upserted by their natural key and
// NOTHING is deleted — a row missing from the file is left alone, so deleting
// lines in a spreadsheet can never wipe the shop.
export async function applyCsv(text) {
  const a = await analyseCsv(text);
  if (a.problems.length) {
    const err = new Error(`Refusing to import — ${a.problems.length} problem(s) found.`);
    err.problems = a.problems;
    throw err;
  }
  const shape = CSV_TABLES[a.table];
  const updatable = a.cols.filter(c => c !== shape.key);
  // One transaction: either the whole file lands or none of it does.
  await sql.begin(async (tx) => {
    for (const r of a.rows) {
      const values = a.cols.map(c => {
        if (r[c] === '' || r[c] === undefined) return null;   // blank keeps current value
        return shape.numeric.includes(c) ? Number(r[c]) : r[c];
      });
      const stmt = `INSERT INTO ${q(a.table)} (${a.cols.map(q).join(', ')}) ` +
        `VALUES (${a.cols.map((_, i) => '$' + (i + 1)).join(', ')}) ` +
        `ON CONFLICT (${q(shape.key)}) DO UPDATE SET ` +
        updatable.map(c => `${q(c)} = coalesce(excluded.${q(c)}, ${q(a.table)}.${q(c)})`).join(', ');
      await tx.unsafe(stmt, values);
    }
  });
  return a;
}
