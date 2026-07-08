import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  db, getSetting, setSetting, hashPassword, verifyPassword,
  getContentOverrides, getContentValue, setContentValue, deleteContentValue,
} from './db.js';
import { CONTENT_REGISTRY, contentByKey } from './content.js';
import { seedIfEmpty } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 4000;

// Uploaded content images. Defaults to public/images/uploads for local dev; on a
// host with an ephemeral filesystem point PLANTMOOD_UPLOADS_DIR at the same
// persistent volume as the database so owner-uploaded photos survive redeploys.
const UPLOAD_DIR = process.env.PLANTMOOD_UPLOADS_DIR
  ? path.resolve(process.env.PLANTMOOD_UPLOADS_DIR)
  : path.join(PUBLIC_DIR, 'images', 'uploads');

const app = express();
// The image-upload route carries a base64 photo, so it needs a larger body
// limit than everything else. Mounting it first means body-parser marks the
// body as read and the default (small) JSON parser below skips it.
app.use('/api/admin/content/image', express.json({ limit: '14mb' }));
app.use(express.json());

// Serve uploaded content images (kept out of /public so the folder can live on
// a persistent volume in production).
app.use('/uploads', express.static(UPLOAD_DIR, {
  setHeaders(res) { res.setHeader('Cache-Control', 'public, max-age=604800'); },
}));

// ---------------------------------------------------------------- helpers
const clean = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

function publicProduct(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    species: row.species,
    description: row.description,
    care: row.care,
    price: row.price,
    category: row.category,
    categoryName: row.category_name || undefined,
    image: row.image,
    alt: row.alt,
    soldOut: row.stock <= 0,
    featured: !!row.featured,
  };
}

// ---------------------------------------------------------------- public API
app.get('/api/categories', (req, res) => {
  const rows = db.prepare('SELECT * FROM categories ORDER BY sort, name').all();
  res.json(rows);
});

app.get('/api/products', (req, res) => {
  const { category, featured } = req.query;
  let sql = `SELECT p.*, c.name AS category_name FROM products p
             JOIN categories c ON c.slug = p.category`;
  const where = [];
  const params = [];
  if (category) { where.push('p.category = ?'); params.push(String(category)); }
  if (featured === '1') { where.push('p.featured = 1'); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY p.featured DESC, p.id';
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(publicProduct));
});

app.get('/api/products/:slug', (req, res) => {
  const row = db.prepare(
    `SELECT p.*, c.name AS category_name FROM products p
     JOIN categories c ON c.slug = p.category WHERE p.slug = ?`
  ).get(req.params.slug);
  if (!row) return res.status(404).json({ error: 'Product not found' });

  const related = db.prepare(
    `SELECT p.*, c.name AS category_name FROM products p
     JOIN categories c ON c.slug = p.category
     WHERE p.category = ? AND p.id != ? ORDER BY RANDOM() LIMIT 3`
  ).all(row.category, row.id);

  res.json({ ...publicProduct(row), related: related.map(publicProduct) });
});

app.post('/api/subscribe', (req, res) => {
  const email = clean(req.body.email, 200).toLowerCase();
  if (!isEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  try {
    db.prepare('INSERT INTO subscribers (email) VALUES (?)').run(email);
  } catch {
    /* duplicate — treat as success */
  }
  res.json({ ok: true });
});

app.post('/api/contact', (req, res) => {
  const name = clean(req.body.name, 120);
  const email = clean(req.body.email, 200).toLowerCase();
  const subject = clean(req.body.subject, 200);
  const message = clean(req.body.message, 4000);
  if (!name || !message || !isEmail(email)) {
    return res.status(400).json({ error: 'Name, a valid email and a message are required.' });
  }
  db.prepare('INSERT INTO messages (name, email, subject, message) VALUES (?, ?, ?, ?)')
    .run(name, email, subject, message);
  res.json({ ok: true });
});

// Mock checkout: validates cart against DB, creates the order, decrements stock.
// No real payment is taken.
app.post('/api/orders', (req, res) => {
  const b = req.body || {};
  const customer = {
    name: clean(b.name, 120),
    email: clean(b.email, 200).toLowerCase(),
    phone: clean(b.phone, 40),
    address1: clean(b.address1, 240),
    address2: clean(b.address2, 240),
    city: clean(b.city, 120),
    state: clean(b.state, 120),
    postcode: clean(b.postcode, 20),
    notes: clean(b.notes, 1000),
  };
  if (!customer.name || !isEmail(customer.email) || !customer.address1 ||
      !customer.city || !customer.state || !customer.postcode) {
    return res.status(400).json({ error: 'Please fill in your name, email and full delivery address.' });
  }

  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) return res.status(400).json({ error: 'Your cart is empty.' });
  if (items.length > 50) return res.status(400).json({ error: 'Too many items.' });

  const getProduct = db.prepare('SELECT * FROM products WHERE id = ?');
  const lines = [];
  for (const it of items) {
    const qty = Math.floor(Number(it.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > 99) {
      return res.status(400).json({ error: 'Invalid quantity in cart.' });
    }
    const p = getProduct.get(Number(it.id));
    if (!p) return res.status(400).json({ error: 'An item in your cart is no longer available.' });
    if (p.stock < qty) {
      return res.status(409).json({ error: `Only ${p.stock} left of "${p.name}". Please adjust your cart.` });
    }
    lines.push({ product: p, qty });
  }

  const subtotal = lines.reduce((s, l) => s + l.product.price * l.qty, 0);
  const flat = Number(getSetting('shipping_flat', '15'));
  const freeOver = Number(getSetting('free_shipping_over', '250'));
  const shipping = subtotal >= freeOver ? 0 : flat;
  const total = subtotal + shipping;

  const year = new Date().getFullYear();
  const token = crypto.randomBytes(24).toString('hex');
  const insertOrder = db.prepare(
    `INSERT INTO orders (order_no, name, email, phone, address1, address2, city, state, postcode, notes, subtotal, shipping, total, token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertItem = db.prepare(
    'INSERT INTO order_items (order_id, product_id, name, price, qty) VALUES (?, ?, ?, ?, ?)'
  );
  const decStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?');

  let orderNo;
  for (let attempt = 0; ; attempt++) {
    orderNo = 'PM-' + year + '-' + crypto.randomInt(0, 1e6).toString().padStart(6, '0');
    db.exec('BEGIN');
    try {
      const info = insertOrder.run(orderNo, customer.name, customer.email, customer.phone,
        customer.address1, customer.address2, customer.city, customer.state, customer.postcode,
        customer.notes, subtotal, shipping, total, token);
      const orderId = info.lastInsertRowid;
      for (const l of lines) {
        insertItem.run(orderId, l.product.id, l.product.name, l.product.price, l.qty);
        const r = decStock.run(l.qty, l.product.id, l.qty);
        if (r.changes === 0) throw new Error('stock-conflict');
      }
      db.exec('COMMIT');
      break;
    } catch (e) {
      db.exec('ROLLBACK');
      if (e.message === 'stock-conflict') {
        return res.status(409).json({ error: 'An item just sold out. Please review your cart.' });
      }
      // duplicate order number — regenerate and retry a few times
      if (/UNIQUE/i.test(e.message) && attempt < 5) continue;
      throw e;
    }
  }

  res.json({ ok: true, orderNo, token, subtotal, shipping, total });
});

// Order lookup requires the unguessable token issued at checkout (prevents
// enumeration of orders by their short, human-readable order number).
app.get('/api/orders/:orderNo', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(req.params.orderNo);
  const token = String(req.query.token || '');
  if (!order || !order.token || token.length !== order.token.length ||
      !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(order.token))) {
    return res.status(404).json({ error: 'Order not found' });
  }
  const items = db.prepare('SELECT name, price, qty FROM order_items WHERE order_id = ?').all(order.id);
  res.json({
    orderNo: order.order_no, name: order.name, email: order.email, phone: order.phone,
    address1: order.address1, address2: order.address2, city: order.city,
    state: order.state, postcode: order.postcode, notes: order.notes,
    status: order.status, subtotal: order.subtotal, shipping: order.shipping,
    total: order.total, created_at: order.created_at, items,
  });
});

app.get('/api/settings/shipping', (req, res) => {
  res.json({
    flat: Number(getSetting('shipping_flat', '15')),
    freeOver: Number(getSetting('free_shipping_over', '250')),
    whatsapp: getSetting('whatsapp_number', ''),
  });
});

// Public content: only the values the owner has overridden. Pages ship their
// own defaults in the HTML, so this stays tiny (usually empty) and the site is
// fully readable — SEO-friendly and never blank — even if this request fails.
app.get('/api/content', (req, res) => {
  res.json({ content: getContentOverrides() });
});

// ---------------------------------------------------------------- admin
const sessions = new Map(); // token -> { created }
const SESSION_TTL = 1000 * 60 * 60 * 8;

function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  const s = token && sessions.get(token);
  if (!s || Date.now() - s.created > SESSION_TTL) {
    if (token) sessions.delete(token);
    return res.status(401).json({ error: 'Not authorised' });
  }
  next();
}

app.post('/api/admin/login', (req, res) => {
  const password = String(req.body.password || '');
  if (!verifyPassword(password, getSetting('admin_password'))) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { created: Date.now() });
  res.json({ token });
});

app.post('/api/admin/logout', adminAuth, (req, res) => {
  sessions.delete(req.headers['x-admin-token']);
  res.json({ ok: true });
});

app.post('/api/admin/password', adminAuth, (req, res) => {
  const pw = String(req.body.password || '');
  if (pw.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  setSetting('admin_password', hashPassword(pw));
  res.json({ ok: true });
});

app.get('/api/admin/products', adminAuth, (req, res) => {
  const rows = db.prepare(
    `SELECT p.*, c.name AS category_name FROM products p
     JOIN categories c ON c.slug = p.category ORDER BY p.category, p.id`
  ).all();
  res.json(rows);
});

app.post('/api/admin/products', adminAuth, (req, res) => {
  const b = req.body || {};
  const name = clean(b.name, 200);
  const price = Number(b.price);
  const category = clean(b.category, 60);
  const image = clean(b.image, 300);
  if (!name || !Number.isFinite(price) || price < 0 || !category || !image) {
    return res.status(400).json({ error: 'name, price, category and image are required.' });
  }
  const cat = db.prepare('SELECT slug FROM categories WHERE slug = ?').get(category);
  if (!cat) return res.status(400).json({ error: 'Unknown category.' });
  const slugBase = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'product';
  let slug = slugBase, n = 2;
  while (db.prepare('SELECT 1 FROM products WHERE slug = ?').get(slug)) slug = `${slugBase}-${n++}`;
  const info = db.prepare(
    `INSERT INTO products (slug, name, species, description, care, price, category, image, alt, stock, featured)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(slug, name, clean(b.species, 200), clean(b.description, 4000), clean(b.care, 500),
        price, category, image, clean(b.alt, 300),
        Math.max(0, Math.floor(Number(b.stock) || 0)), b.featured ? 1 : 0);
  res.json({ ok: true, id: info.lastInsertRowid, slug });
});

app.put('/api/admin/products/:id', adminAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Product not found' });
  const b = req.body || {};
  const merged = {
    name: b.name !== undefined ? clean(b.name, 200) : p.name,
    species: b.species !== undefined ? clean(b.species, 200) : p.species,
    description: b.description !== undefined ? clean(b.description, 4000) : p.description,
    care: b.care !== undefined ? clean(b.care, 500) : p.care,
    price: b.price !== undefined ? Number(b.price) : p.price,
    category: b.category !== undefined ? clean(b.category, 60) : p.category,
    image: b.image !== undefined ? clean(b.image, 300) : p.image,
    alt: b.alt !== undefined ? clean(b.alt, 300) : p.alt,
    stock: b.stock !== undefined ? Math.max(0, Math.floor(Number(b.stock) || 0)) : p.stock,
    featured: b.featured !== undefined ? (b.featured ? 1 : 0) : p.featured,
  };
  if (!merged.name || !Number.isFinite(merged.price) || merged.price < 0) {
    return res.status(400).json({ error: 'Invalid name or price.' });
  }
  if (!db.prepare('SELECT 1 FROM categories WHERE slug = ?').get(merged.category)) {
    return res.status(400).json({ error: 'Unknown category.' });
  }
  db.prepare(
    `UPDATE products SET name=?, species=?, description=?, care=?, price=?, category=?, image=?, alt=?, stock=?, featured=?
     WHERE id=?`
  ).run(merged.name, merged.species, merged.description, merged.care, merged.price, merged.category,
        merged.image, merged.alt, merged.stock, merged.featured, p.id);
  res.json({ ok: true });
});

app.delete('/api/admin/products/:id', adminAuth, (req, res) => {
  const info = db.prepare('DELETE FROM products WHERE id = ?').run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: 'Product not found' });
  res.json({ ok: true });
});

app.get('/api/admin/orders', adminAuth, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
  const itemsStmt = db.prepare('SELECT name, price, qty FROM order_items WHERE order_id = ?');
  res.json(orders.map(o => ({ ...o, items: itemsStmt.all(o.id) })));
});

app.put('/api/admin/orders/:id', adminAuth, (req, res) => {
  const status = clean(req.body.status, 30);
  const allowed = ['pending', 'paid', 'shipped', 'completed', 'cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status.' });

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'Order not found' });

  db.exec('BEGIN');
  try {
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, order.id);
    // Return items to stock when an order moves into 'cancelled' (and take them
    // back out if it is later un-cancelled), so inventory stays consistent.
    const wasCancelled = order.status === 'cancelled';
    const nowCancelled = status === 'cancelled';
    if (wasCancelled !== nowCancelled) {
      const sign = nowCancelled ? 1 : -1;
      const items = db.prepare('SELECT product_id, qty FROM order_items WHERE order_id = ?').all(order.id);
      const adjust = db.prepare('UPDATE products SET stock = MAX(0, stock + ?) WHERE id = ?');
      for (const it of items) adjust.run(sign * it.qty, it.product_id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  res.json({ ok: true });
});

app.get('/api/admin/subscribers', adminAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM subscribers ORDER BY id DESC').all());
});

app.get('/api/admin/messages', adminAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM messages ORDER BY id DESC').all());
});

app.get('/api/admin/settings', adminAuth, (req, res) => {
  res.json({
    shipping_flat: getSetting('shipping_flat', '15'),
    free_shipping_over: getSetting('free_shipping_over', '250'),
    whatsapp_number: getSetting('whatsapp_number', ''),
  });
});

app.put('/api/admin/settings', adminAuth, (req, res) => {
  const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));
  const flat = num(req.body.shipping_flat);
  const freeOver = num(req.body.free_shipping_over);
  if (Number.isFinite(flat) && flat >= 0) setSetting('shipping_flat', flat);
  if (Number.isFinite(freeOver) && freeOver >= 0) setSetting('free_shipping_over', freeOver);
  if (req.body.whatsapp_number !== undefined) {
    // keep digits only (wa.me needs international format without + or spaces)
    setSetting('whatsapp_number', clean(req.body.whatsapp_number, 20).replace(/[^\d]/g, ''));
  }
  res.json({ ok: true });
});

// ------- site content (editable text & images) -------
// Only files we created under UPLOAD_DIR are ever deleted — never seed images
// that ship with the site. Returns a warning string if deletion failed.
function removeUploadedImage(publicPath) {
  if (typeof publicPath !== 'string' || !publicPath.startsWith('/uploads/')) return undefined;
  const name = path.basename(publicPath);
  const resolved = path.resolve(UPLOAD_DIR, name);
  if (path.dirname(resolved) !== path.resolve(UPLOAD_DIR)) return undefined; // guard traversal
  try {
    if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
    return undefined;
  } catch {
    return `The previous image file (${name}) could not be removed from the server. The site is fine — you can delete it manually later.`;
  }
}

// Confirm the bytes really are the image type they claim to be.
function sniffImageExt(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

app.get('/api/admin/content', adminAuth, (req, res) => {
  const overrides = getContentOverrides();
  res.json(CONTENT_REGISTRY.map(c => ({
    key: c.key, type: c.type, section: c.section, label: c.label, hint: c.hint || '',
    def: c.def, value: overrides[c.key] ?? null, effective: overrides[c.key] ?? c.def,
  })));
});

app.put('/api/admin/content', adminAuth, (req, res) => {
  const key = clean(req.body.key, 120);
  const entry = contentByKey.get(key);
  if (!entry) return res.status(400).json({ error: 'Unknown content item.' });
  if (entry.type !== 'text') return res.status(400).json({ error: 'This item is a photo — use the upload button.' });
  const value = String(req.body.value ?? '').replace(/\r\n/g, '\n').trim().slice(0, 2000);
  // Empty or identical-to-default → drop the override so the built-in text shows.
  if (!value || value === entry.def) {
    deleteContentValue(key);
    return res.json({ ok: true, value: entry.def, usingDefault: true });
  }
  setContentValue(key, value);
  res.json({ ok: true, value, usingDefault: false });
});

app.post('/api/admin/content/image', adminAuth, (req, res) => {
  const key = clean(req.body.key, 120);
  const entry = contentByKey.get(key);
  if (!entry) return res.status(400).json({ error: 'Unknown content item.' });
  if (entry.type !== 'image') return res.status(400).json({ error: 'This item is text, not a photo.' });

  const m = /^data:(image\/[a-z+]+);base64,([\s\S]+)$/.exec(String(req.body.dataUrl || ''));
  if (!m) return res.status(400).json({ error: 'Please choose an image file (JPG, PNG or WebP).' });

  let buf;
  try { buf = Buffer.from(m[2], 'base64'); } catch { buf = null; }
  if (!buf || !buf.length) return res.status(400).json({ error: 'The image could not be read. Please try another file.' });
  if (buf.length > 6 * 1024 * 1024) {
    return res.status(413).json({ error: 'That image is larger than 6 MB. Please use a smaller photo.' });
  }
  const ext = sniffImageExt(buf);
  if (!ext) return res.status(400).json({ error: 'Only JPG, PNG or WebP images are allowed.' });

  try {
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  } catch {
    return res.status(500).json({ error: 'Could not prepare the upload folder on the server.' });
  }

  const safeKey = key.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  const fname = `${safeKey}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  try {
    fs.writeFileSync(path.join(UPLOAD_DIR, fname), buf);
  } catch {
    return res.status(500).json({ error: 'Could not save the image on the server. Your live photo is unchanged.' });
  }

  // Only after the new file is safely on disk do we switch the live value and
  // clean up the old upload — so a failure never leaves the page without a photo.
  const newPath = `/uploads/${fname}`;
  const previous = getContentValue(key);
  setContentValue(key, newPath);
  const warning = previous && previous !== newPath ? removeUploadedImage(previous) : undefined;

  res.json({ ok: true, value: newPath, warning });
});

// Reset an item back to its built-in default (and tidy up an uploaded photo).
app.delete('/api/admin/content/:key', adminAuth, (req, res) => {
  const key = clean(req.params.key, 120);
  const entry = contentByKey.get(key);
  if (!entry) return res.status(400).json({ error: 'Unknown content item.' });
  const current = getContentValue(key);
  const warning = entry.type === 'image' && current ? removeUploadedImage(current) : undefined;
  deleteContentValue(key);
  res.json({ ok: true, value: entry.def, warning });
});

// ---------------------------------------------------------------- pages
app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  setHeaders(res, filePath) {
    // Images and icons are immutable-ish assets; HTML/CSS/JS stay revalidated
    // so content and style updates show up immediately.
    if (/\.(jpe?g|png|webp|avif|gif|svg|ico)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=604800');
    }
  },
}));

const page = (file) => (req, res) => res.sendFile(path.join(PUBLIC_DIR, file));
app.get('/shop/:category', page('shop.html'));
app.get('/product/:slug', page('product.html'));
app.get('/order/:orderNo', page('order.html'));
app.get('/admin', page('admin.html'));

app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side.' });
});

// Populate the catalogue on first boot (e.g. a fresh deploy on a clean volume).
try {
  const seeded = seedIfEmpty();
  if (seeded) console.log(`Seeded ${seeded.categories} categories, ${seeded.products} products.`);
} catch (e) {
  console.error('Seed on startup failed:', e.message);
}

app.listen(PORT, () => {
  console.log(`Plantmood running on port ${PORT}`);
});
