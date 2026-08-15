import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  sql, num, getSetting, setSetting, hashPassword, verifyPassword,
  getContentOverrides, getContentValue, setContentValue, deleteContentValue,
} from './db.js';
import { saveUploadedImage, removeUploadedImage, publicUrl } from './storage.js';
import { CONTENT_REGISTRY, contentByKey } from './content.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 4000;

export const app = express();
// These admin routes carry a base64 photo, so they need a larger body limit
// than everything else. Mounting them first means body-parser marks the body
// as read and the default (small) JSON parser below skips it (no double-parse).
app.use('/api/admin/content/image', express.json({ limit: '14mb' }));
app.use('/api/admin/products', express.json({ limit: '14mb' }));
app.use(express.json());

// Every route below talks to Postgres, so handlers are async. Express 4 does
// not catch a rejected promise, so wrap each one — without this an await that
// throws hangs the request instead of reaching the error handler.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Owner-uploaded photos live in Supabase Storage. The database still stores
// '/uploads/<file>', which is what distinguishes an owner upload from a
// built-in '/images/...' seed photo everywhere else, so redirect that path to
// the storage CDN rather than changing every stored value.
app.get('/uploads/:name', (req, res) => {
  const name = req.params.name;
  if (!name || name.includes('/')) return res.status(404).end();
  res.setHeader('Cache-Control', 'public, max-age=604800');
  res.redirect(302, publicUrl(name));
});

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
    price: num(row.price),
    category: row.category,
    categoryName: row.category_name || undefined,
    image: row.image,
    alt: row.alt,
    soldOut: row.stock <= 0,
    featured: !!row.featured,
  };
}

// ---------------------------------------------------------------- public API
app.get('/api/categories', ah(async (req, res) => {
  res.json(await sql`SELECT * FROM categories ORDER BY sort, name`);
}));

app.get('/api/products', ah(async (req, res) => {
  const { category, featured } = req.query;
  const rows = await sql`
    SELECT p.*, c.name AS category_name FROM products p
    JOIN categories c ON c.slug = p.category
    WHERE ${category ? sql`p.category = ${String(category)}` : sql`TRUE`}
      AND ${featured === '1' ? sql`p.featured = 1` : sql`TRUE`}
    ORDER BY p.featured DESC, p.id
  `;
  res.json(rows.map(publicProduct));
}));

app.get('/api/products/:slug', ah(async (req, res) => {
  const [row] = await sql`
    SELECT p.*, c.name AS category_name FROM products p
    JOIN categories c ON c.slug = p.category WHERE p.slug = ${req.params.slug}
  `;
  if (!row) return res.status(404).json({ error: 'Product not found' });

  const related = await sql`
    SELECT p.*, c.name AS category_name FROM products p
    JOIN categories c ON c.slug = p.category
    WHERE p.category = ${row.category} AND p.id != ${row.id}
    ORDER BY random() LIMIT 3
  `;

  res.json({ ...publicProduct(row), related: related.map(publicProduct) });
}));

app.post('/api/subscribe', ah(async (req, res) => {
  const email = clean(req.body.email, 200).toLowerCase();
  if (!isEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  // Duplicate signup is not an error from the visitor's point of view.
  await sql`INSERT INTO subscribers (email) VALUES (${email}) ON CONFLICT (email) DO NOTHING`;
  res.json({ ok: true });
}));

app.post('/api/contact', ah(async (req, res) => {
  const name = clean(req.body.name, 120);
  const email = clean(req.body.email, 200).toLowerCase();
  const subject = clean(req.body.subject, 200);
  const message = clean(req.body.message, 4000);
  if (!name || !message || !isEmail(email)) {
    return res.status(400).json({ error: 'Name, a valid email and a message are required.' });
  }
  await sql`
    INSERT INTO messages (name, email, subject, message)
    VALUES (${name}, ${email}, ${subject}, ${message})
  `;
  res.json({ ok: true });
}));

// Mock checkout: validates cart against DB, creates the order, decrements stock.
// No real payment is taken.
app.post('/api/orders', ah(async (req, res) => {
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

  const lines = [];
  for (const it of items) {
    const qty = Math.floor(Number(it.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > 99) {
      return res.status(400).json({ error: 'Invalid quantity in cart.' });
    }
    const [p] = await sql`SELECT * FROM products WHERE id = ${Number(it.id) || 0}`;
    if (!p) return res.status(400).json({ error: 'An item in your cart is no longer available.' });
    if (p.stock < qty) {
      return res.status(409).json({ error: `Only ${p.stock} left of "${p.name}". Please adjust your cart.` });
    }
    lines.push({ product: p, qty });
  }

  const subtotal = lines.reduce((s, l) => s + num(l.product.price) * l.qty, 0);
  const flat = Number(await getSetting('shipping_flat', '15'));
  const freeOver = Number(await getSetting('free_shipping_over', '250'));
  const shipping = subtotal >= freeOver ? 0 : flat;
  const total = subtotal + shipping;

  const year = new Date().getFullYear();
  const token = crypto.randomBytes(24).toString('hex');

  let orderNo;
  for (let attempt = 0; ; attempt++) {
    orderNo = 'PM-' + year + '-' + crypto.randomInt(0, 1e6).toString().padStart(6, '0');
    try {
      // sql.begin() runs every statement on one dedicated connection. Bare
      // BEGIN/COMMIT would be routed independently by the pooler and silently
      // lose atomicity — the order could be created without its stock movement.
      await sql.begin(async (tx) => {
        const [order] = await tx`
          INSERT INTO orders (order_no, name, email, phone, address1, address2, city, state,
                              postcode, notes, subtotal, shipping, total, token)
          VALUES (${orderNo}, ${customer.name}, ${customer.email}, ${customer.phone},
                  ${customer.address1}, ${customer.address2}, ${customer.city}, ${customer.state},
                  ${customer.postcode}, ${customer.notes}, ${subtotal}, ${shipping}, ${total}, ${token})
          RETURNING id
        `;
        for (const l of lines) {
          await tx`
            INSERT INTO order_items (order_id, product_id, name, price, qty)
            VALUES (${order.id}, ${l.product.id}, ${l.product.name}, ${num(l.product.price)}, ${l.qty})
          `;
          const changed = await tx`
            UPDATE products SET stock = stock - ${l.qty}
            WHERE id = ${l.product.id} AND stock >= ${l.qty}
          `;
          if (changed.count === 0) throw new Error('stock-conflict');
        }
      });
      break;
    } catch (e) {
      if (e.message === 'stock-conflict') {
        return res.status(409).json({ error: 'An item just sold out. Please review your cart.' });
      }
      // duplicate order number — regenerate and retry a few times
      if ((e.code === '23505' || /duplicate key/i.test(e.message)) && attempt < 5) continue;
      throw e;
    }
  }

  res.json({ ok: true, orderNo, token, subtotal, shipping, total });
}));

// Order lookup requires the unguessable token issued at checkout (prevents
// enumeration of orders by their short, human-readable order number).
app.get('/api/orders/:orderNo', ah(async (req, res) => {
  const [order] = await sql`SELECT * FROM orders WHERE order_no = ${req.params.orderNo}`;
  const token = String(req.query.token || '');
  if (!order || !order.token || token.length !== order.token.length ||
      !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(order.token))) {
    return res.status(404).json({ error: 'Order not found' });
  }
  const items = await sql`SELECT name, price, qty FROM order_items WHERE order_id = ${order.id}`;
  res.json({
    orderNo: order.order_no, name: order.name, email: order.email, phone: order.phone,
    address1: order.address1, address2: order.address2, city: order.city,
    state: order.state, postcode: order.postcode, notes: order.notes,
    status: order.status, subtotal: num(order.subtotal), shipping: num(order.shipping),
    total: num(order.total), created_at: order.created_at,
    items: items.map(i => ({ ...i, price: num(i.price) })),
  });
}));

app.get('/api/settings/shipping', ah(async (req, res) => {
  res.json({
    flat: Number(await getSetting('shipping_flat', '15')),
    freeOver: Number(await getSetting('free_shipping_over', '250')),
    whatsapp: await getSetting('whatsapp_number', ''),
  });
}));

// Public content: only the values the owner has overridden. Pages ship their
// own defaults in the HTML, so this stays tiny (usually empty) and the site is
// fully readable — SEO-friendly and never blank — even if this request fails.
app.get('/api/content', ah(async (req, res) => {
  res.json({ content: await getContentOverrides() });
}));

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

app.post('/api/admin/login', ah(async (req, res) => {
  const password = String(req.body.password || '');
  if (!verifyPassword(password, await getSetting('admin_password'))) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { created: Date.now() });
  res.json({ token });
}));

app.post('/api/admin/logout', adminAuth, (req, res) => {
  sessions.delete(req.headers['x-admin-token']);
  res.json({ ok: true });
});

app.post('/api/admin/password', adminAuth, ah(async (req, res) => {
  const pw = String(req.body.password || '');
  if (pw.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  await setSetting('admin_password', hashPassword(pw));
  res.json({ ok: true });
}));

app.get('/api/admin/products', adminAuth, ah(async (req, res) => {
  const rows = await sql`
    SELECT p.*, c.name AS category_name FROM products p
    JOIN categories c ON c.slug = p.category ORDER BY p.category, p.id
  `;
  res.json(rows.map(r => ({ ...r, price: num(r.price) })));
}));

app.post('/api/admin/products', adminAuth, ah(async (req, res) => {
  const b = req.body || {};
  const name = clean(b.name, 200);
  const price = Number(b.price);
  const category = clean(b.category, 60);
  // 1) validate the ordinary fields first, before touching any files
  if (!name || !Number.isFinite(price) || price < 0 || !category) {
    return res.status(400).json({ error: 'Name, price and category are required.' });
  }
  const [cat] = await sql`SELECT slug FROM categories WHERE slug = ${category}`;
  if (!cat) return res.status(400).json({ error: 'Unknown category.' });
  // 2) a photo is required to create a product
  if (!b.imageDataUrl) return res.status(400).json({ error: 'Please choose a product photo.' });

  const slugBase = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'product';

  // 3) save the new photo
  const saved = await saveUploadedImage(b.imageDataUrl, `product-${slugBase}`);
  if (saved.error) return res.status(saved.status).json({ error: saved.error });

  let slug = slugBase, n = 2;
  while ((await sql`SELECT 1 FROM products WHERE slug = ${slug}`).length) slug = `${slugBase}-${n++}`;
  try {
    // 4-5) write the /uploads path into products.image and create the product
    const [row] = await sql`
      INSERT INTO products (slug, name, species, description, care, price, category, image, alt, stock, featured)
      VALUES (${slug}, ${name}, ${clean(b.species, 200)}, ${clean(b.description, 4000)},
              ${clean(b.care, 500)}, ${price}, ${category}, ${saved.path}, ${clean(b.alt, 300)},
              ${Math.max(0, Math.floor(Number(b.stock) || 0))}, ${b.featured ? 1 : 0})
      RETURNING id
    `;
    res.json({ ok: true, id: row.id, slug, image: saved.path });
  } catch (e) {
    // 6) the insert failed — remove the just-uploaded file so no orphan is left
    await removeUploadedImage(saved.path);
    throw e;
  }
}));

app.put('/api/admin/products/:id', adminAuth, ah(async (req, res) => {
  const [p] = await sql`SELECT * FROM products WHERE id = ${Number(req.params.id) || 0}`;
  if (!p) return res.status(404).json({ error: 'Product not found' });
  const b = req.body || {};

  const merged = {
    name: b.name !== undefined ? clean(b.name, 200) : p.name,
    species: b.species !== undefined ? clean(b.species, 200) : p.species,
    description: b.description !== undefined ? clean(b.description, 4000) : p.description,
    care: b.care !== undefined ? clean(b.care, 500) : p.care,
    price: b.price !== undefined ? Number(b.price) : num(p.price),
    category: b.category !== undefined ? clean(b.category, 60) : p.category,
    // image is never edited as text — it changes only when a new photo is uploaded
    alt: b.alt !== undefined ? clean(b.alt, 300) : p.alt,
    stock: b.stock !== undefined ? Math.max(0, Math.floor(Number(b.stock) || 0)) : p.stock,
    featured: b.featured !== undefined ? (b.featured ? 1 : 0) : p.featured,
  };
  if (!merged.name || !Number.isFinite(merged.price) || merged.price < 0) {
    return res.status(400).json({ error: 'Invalid name or price.' });
  }
  if (!(await sql`SELECT 1 FROM categories WHERE slug = ${merged.category}`).length) {
    return res.status(400).json({ error: 'Unknown category.' });
  }

  // A new photo is optional on edit. Save it first; only if that succeeds do we
  // point the row at it and (after the DB commits) remove the old upload.
  let newImagePath = null;
  if (b.imageDataUrl) {
    const saved = await saveUploadedImage(b.imageDataUrl, `product-${merged.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
    if (saved.error) return res.status(saved.status).json({ error: saved.error });
    newImagePath = saved.path;
  }
  const nextImage = newImagePath || p.image; // keep the current photo if none uploaded

  try {
    await sql`
      UPDATE products SET name = ${merged.name}, species = ${merged.species},
        description = ${merged.description}, care = ${merged.care}, price = ${merged.price},
        category = ${merged.category}, image = ${nextImage}, alt = ${merged.alt},
        stock = ${merged.stock}, featured = ${merged.featured}
      WHERE id = ${p.id}
    `;
  } catch (e) {
    // DB update failed — drop the freshly-uploaded orphan and keep the old image
    if (newImagePath) await removeUploadedImage(newImagePath);
    throw e;
  }

  // DB now points at the new photo → safe to delete the previous upload.
  // removeUploadedImage() only ever touches /uploads/ files, so a built-in
  // /images/... seed photo is never deleted. A delete failure is non-fatal:
  // the product update stands and we just surface a warning.
  let warning;
  if (newImagePath && p.image !== newImagePath) warning = await removeUploadedImage(p.image);
  res.json({ ok: true, image: nextImage, warning });
}));

app.delete('/api/admin/products/:id', adminAuth, ah(async (req, res) => {
  const [p] = await sql`SELECT * FROM products WHERE id = ${Number(req.params.id) || 0}`;
  if (!p) return res.status(404).json({ error: 'Product not found' });
  await sql`DELETE FROM products WHERE id = ${p.id}`;
  // Order history keeps its own name/price snapshot in order_items, so removing
  // the product photo here is safe. Only /uploads/ files are deleted — built-in
  // /images/ seed photos are left untouched — and a failed/absent delete is
  // non-fatal (the product is already gone).
  const warning = await removeUploadedImage(p.image);
  res.json({ ok: true, warning });
}));

app.get('/api/admin/orders', adminAuth, ah(async (req, res) => {
  const orders = await sql`SELECT * FROM orders ORDER BY id DESC`;
  const out = [];
  for (const o of orders) {
    const items = await sql`SELECT name, price, qty FROM order_items WHERE order_id = ${o.id}`;
    out.push({
      ...o,
      subtotal: num(o.subtotal), shipping: num(o.shipping), total: num(o.total),
      items: items.map(i => ({ ...i, price: num(i.price) })),
    });
  }
  res.json(out);
}));

app.put('/api/admin/orders/:id', adminAuth, ah(async (req, res) => {
  const status = clean(req.body.status, 30);
  const allowed = ['pending', 'paid', 'shipped', 'completed', 'cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status.' });

  const [order] = await sql`SELECT * FROM orders WHERE id = ${Number(req.params.id) || 0}`;
  if (!order) return res.status(404).json({ error: 'Order not found' });

  await sql.begin(async (tx) => {
    await tx`UPDATE orders SET status = ${status} WHERE id = ${order.id}`;
    // Return items to stock when an order moves into 'cancelled' (and take them
    // back out if it is later un-cancelled), so inventory stays consistent.
    const wasCancelled = order.status === 'cancelled';
    const nowCancelled = status === 'cancelled';
    if (wasCancelled !== nowCancelled) {
      const sign = nowCancelled ? 1 : -1;
      const items = await tx`SELECT product_id, qty FROM order_items WHERE order_id = ${order.id}`;
      for (const it of items) {
        // GREATEST, not MAX — MAX is an aggregate function in Postgres.
        await tx`UPDATE products SET stock = GREATEST(0, stock + ${sign * it.qty}) WHERE id = ${it.product_id}`;
      }
    }
  });
  res.json({ ok: true });
}));

app.get('/api/admin/subscribers', adminAuth, ah(async (req, res) => {
  res.json(await sql`SELECT * FROM subscribers ORDER BY id DESC`);
}));

app.get('/api/admin/messages', adminAuth, ah(async (req, res) => {
  res.json(await sql`SELECT * FROM messages ORDER BY id DESC`);
}));

app.get('/api/admin/settings', adminAuth, ah(async (req, res) => {
  res.json({
    shipping_flat: await getSetting('shipping_flat', '15'),
    free_shipping_over: await getSetting('free_shipping_over', '250'),
    whatsapp_number: await getSetting('whatsapp_number', ''),
  });
}));

app.put('/api/admin/settings', adminAuth, ah(async (req, res) => {
  const toNum = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));
  const flat = toNum(req.body.shipping_flat);
  const freeOver = toNum(req.body.free_shipping_over);
  if (Number.isFinite(flat) && flat >= 0) await setSetting('shipping_flat', flat);
  if (Number.isFinite(freeOver) && freeOver >= 0) await setSetting('free_shipping_over', freeOver);
  if (req.body.whatsapp_number !== undefined) {
    // keep digits only (wa.me needs international format without + or spaces)
    await setSetting('whatsapp_number', clean(req.body.whatsapp_number, 20).replace(/[^\d]/g, ''));
  }
  res.json({ ok: true });
}));

// ------- site content (editable text & images) -------
app.get('/api/admin/content', adminAuth, ah(async (req, res) => {
  const overrides = await getContentOverrides();
  res.json(CONTENT_REGISTRY.map(c => ({
    key: c.key, type: c.type, section: c.section, label: c.label, hint: c.hint || '',
    def: c.def, value: overrides[c.key] ?? null, effective: overrides[c.key] ?? c.def,
  })));
}));

app.put('/api/admin/content', adminAuth, ah(async (req, res) => {
  const key = clean(req.body.key, 120);
  const entry = contentByKey.get(key);
  if (!entry) return res.status(400).json({ error: 'Unknown content item.' });
  if (entry.type !== 'text') return res.status(400).json({ error: 'This item is a photo — use the upload button.' });
  const value = String(req.body.value ?? '').replace(/\r\n/g, '\n').trim().slice(0, 2000);
  // Empty or identical-to-default → drop the override so the built-in text shows.
  if (!value || value === entry.def) {
    await deleteContentValue(key);
    return res.json({ ok: true, value: entry.def, usingDefault: true });
  }
  await setContentValue(key, value);
  res.json({ ok: true, value, usingDefault: false });
}));

app.post('/api/admin/content/image', adminAuth, ah(async (req, res) => {
  const key = clean(req.body.key, 120);
  const entry = contentByKey.get(key);
  if (!entry) return res.status(400).json({ error: 'Unknown content item.' });
  if (entry.type !== 'image') return res.status(400).json({ error: 'This item is text, not a photo.' });

  const saved = await saveUploadedImage(req.body.dataUrl, key);
  if (saved.error) return res.status(saved.status).json({ error: saved.error });

  // Only after the new file is safely in storage do we switch the live value and
  // clean up the old upload — so a failure never leaves the page without a photo.
  const newPath = saved.path;
  const previous = await getContentValue(key);
  await setContentValue(key, newPath);
  const warning = previous && previous !== newPath ? await removeUploadedImage(previous) : undefined;

  res.json({ ok: true, value: newPath, warning });
}));

// Reset an item back to its built-in default (and tidy up an uploaded photo).
app.delete('/api/admin/content/:key', adminAuth, ah(async (req, res) => {
  const key = clean(req.params.key, 120);
  const entry = contentByKey.get(key);
  if (!entry) return res.status(400).json({ error: 'Unknown content item.' });
  const current = await getContentValue(key);
  const warning = entry.type === 'image' && current ? await removeUploadedImage(current) : undefined;
  await deleteContentValue(key);
  res.json({ ok: true, value: entry.def, warning });
}));

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

// NOTE: the catalogue is NOT seeded on boot any more. `seedIfEmpty()` used to
// run here, which is precisely how the shop reset itself to factory prices: on
// a host with no persistent database every cold start saw an empty catalogue
// and re-seeded it. Seeding is now an explicit one-off command:
//   npm run migrate && npm run seed
// Vercel invokes the exported Express application as a serverless function.
// Keep listening only for the existing local start command.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Plantmood running on port ${PORT}`);
  });
}

export default app;
