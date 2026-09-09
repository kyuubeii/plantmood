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

// --- snapshot restore -------------------------------------------------------
// Tables a snapshot puts back, and the key each row is matched on. Nothing is
// deleted here either: a row missing from the snapshot stays in the database.
const SNAPSHOT_TABLES = [
  ['categories',   'slug'],
  ['products',     'slug'],
  ['site_content', 'key'],
  ['settings',     'key'],
  ['subscribers',  'email'],
  ['orders',       'order_no'],
];

// The admin password hash lives in `settings`. Restoring it would silently put
// back whatever password was in force when the snapshot was taken, locking the
// owner out of the panel they are standing in. The admin panel therefore never
// restores it; `npm run restore` can, with --include-password.
export const ADMIN_PASSWORD_KEY = 'admin_password';

function rowsOf(snap, table) {
  const r = snap[table];
  return Array.isArray(r) ? r : [];
}


// JSON round-trips lose type fidelity: NUMERIC comes back as "135.00" where the
// live row holds 135, and TIMESTAMPTZ becomes an ISO string where the live row
// is a Date. Comparing those as text marks every row as changed, which turns
// the restore preview — the screen someone reads before overwriting their shop
// — into noise. Compare by value instead.
function sameValue(a, b) {
  if (a === b) return true;
  if (a === null || a === undefined || a === '') return b === null || b === undefined || b === '';
  if (b === null || b === undefined || b === '') return false;
  const na = Number(a), nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && String(a).trim() !== '' && String(b).trim() !== '') return na === nb;
  if (a instanceof Date || b instanceof Date) {
    const ta = new Date(a).getTime(), tb = new Date(b).getTime();
    if (Number.isFinite(ta) && Number.isFinite(tb)) return ta === tb;
  }
  return String(a).trim() === String(b).trim();
}

export async function analyseSnapshot(snap, { includeAdminPassword = false } = {}) {
  if (!snap || typeof snap !== 'object' || !Array.isArray(snap.products)) {
    throw new Error('That file is not a Plantmood backup.');
  }
  const report = { takenAt: snap.takenAt || null, tables: [], skipped: [] };

  for (const [table, key] of SNAPSHOT_TABLES) {
    let rows = rowsOf(snap, table);
    if (table === 'settings' && !includeAdminPassword) {
      const before = rows.length;
      rows = rows.filter(r => r.key !== ADMIN_PASSWORD_KEY);
      if (rows.length < before) report.skipped.push('the admin password (you stay logged in with your current one)');
    }
    if (!rows.length) { report.tables.push({ table, total: 0, creates: 0, updates: 0, unchanged: 0 }); continue; }

    const live = (await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table}
    `).map(r => r.column_name);
    const cols = Object.keys(rows[0]).filter(c => live.includes(c));
    const existing = new Map((await sql.unsafe(`SELECT * FROM "${table}"`)).map(r => [String(r[key]), r]));

    let creates = 0, updates = 0, unchanged = 0;
    for (const r of rows) {
      const cur = existing.get(String(r[key]));
      if (!cur) { creates++; continue; }
      const differs = cols.some(c => c !== key && c !== 'id' && !sameValue(cur[c], r[c]));
      differs ? updates++ : unchanged++;
    }
    report.tables.push({ table, total: rows.length, creates, updates, unchanged, cols });
  }

  // order_items carry no natural key, so they are only re-inserted for orders
  // that currently have none — a repeated restore cannot duplicate them.
  const items = rowsOf(snap, 'order_items');
  if (items.length) {
    const withItems = new Set((await sql`SELECT DISTINCT order_id FROM order_items`).map(r => r.order_id));
    const idByNo = new Map((await sql`SELECT id, order_no FROM orders`).map(r => [r.order_no, r.id]));
    const noById = new Map(rowsOf(snap, 'orders').map(o => [o.id, o.order_no]));
    const restorable = items.filter(it => {
      const liveId = idByNo.get(noById.get(it.order_id));
      return !liveId || !withItems.has(liveId);   // orders not yet created count too
    }).length;
    report.tables.push({ table: 'order_items', total: items.length, creates: restorable, updates: 0, unchanged: items.length - restorable });
  }

  if (rowsOf(snap, 'messages').length) {
    report.skipped.push(`${rowsOf(snap, 'messages').length} contact message(s) — they have no unique key, so restoring them would create duplicates`);
  }
  return report;
}

export async function applySnapshot(snap, { includeAdminPassword = false } = {}) {
  const report = await analyseSnapshot(snap, { includeAdminPassword });
  const q = (id) => '"' + String(id).replace(/"/g, '""') + '"';

  await sql.begin(async (tx) => {
    for (const [table, key] of SNAPSHOT_TABLES) {
      let rows = rowsOf(snap, table);
      if (table === 'settings' && !includeAdminPassword) rows = rows.filter(r => r.key !== ADMIN_PASSWORD_KEY);
      if (!rows.length) continue;

      const live = (await tx`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${table}
      `).map(r => r.column_name);
      // `id` is kept so order_items can be re-linked and ids stay stable.
      const cols = Object.keys(rows[0]).filter(c => live.includes(c));
      const updatable = cols.filter(c => c !== key && c !== 'id');

      for (const r of rows) {
        const stmt = `INSERT INTO ${q(table)} (${cols.map(q).join(', ')}) ` +
          `VALUES (${cols.map((_, i) => '$' + (i + 1)).join(', ')}) ` +
          (updatable.length
            ? `ON CONFLICT (${q(key)}) DO UPDATE SET ` + updatable.map(c => `${q(c)} = excluded.${q(c)}`).join(', ')
            : `ON CONFLICT (${q(key)}) DO NOTHING`);
        await tx.unsafe(stmt, cols.map(c => r[c] ?? null));
      }
    }

    const items = rowsOf(snap, 'order_items');
    if (items.length) {
      const withItems = new Set((await tx`SELECT DISTINCT order_id FROM order_items`).map(r => r.order_id));
      const idByNo = new Map((await tx`SELECT id, order_no FROM orders`).map(r => [r.order_no, r.id]));
      const noById = new Map(rowsOf(snap, 'orders').map(o => [o.id, o.order_no]));
      for (const it of items) {
        const liveId = idByNo.get(noById.get(it.order_id));
        if (!liveId || withItems.has(liveId)) continue;
        await tx`INSERT INTO order_items (order_id, product_id, name, price, qty)
                 VALUES (${liveId}, ${it.product_id}, ${it.name}, ${it.price}, ${it.qty})`;
      }
    }

    // Keep identity sequences ahead of the ids just inserted, or the next
    // INSERT collides with a restored row.
    for (const t of ['products', 'orders', 'order_items', 'subscribers', 'messages']) {
      await tx.unsafe(
        `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`
      );
    }
  });

  return report;
}
