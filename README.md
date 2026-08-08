# Plantmood 🌱

E-commerce website for **Plantmood** — a Kuala Lumpur plant studio. Design closely follows the
Soilboy reference sample (cream background, deep-green accents, extended-grotesk headings,
outline pill buttons), with all photos, products and copy from Plantmood's own catalogue.

## Stack

| Layer    | Tech |
|----------|------|
| Backend  | Node.js (≥22.5) + Express 4, SQLite via built-in `node:sqlite` (zero native deps) |
| Frontend | Static HTML/CSS/vanilla JS, fonts: Archivo (expanded) + Hanken Grotesk |
| Database | `data/plantmood.db` (created automatically) |

## Run it locally

```bash
npm install        # first time only
npm start          # → http://localhost:4000  (auto-seeds the catalogue if empty)
```

`npm run seed` re-imports `server/seed/catalog.json` at any time (upsert — safe to re-run).

## Deploy (Railway / Render)

The app is a long-running Node server with a SQLite file, so deploy it on a host with a
**persistent disk** (Railway or Render — not Vercel/serverless, which has an ephemeral filesystem).

1. Push this repo to GitHub (see `.gitignore` — `node_modules/` and `data/` are excluded).
2. Create a new project from the repo. Build: `npm install`. Start: `npm start` (also in `Procfile`).
3. **Add a persistent volume** and set env var `PLANTMOOD_DATA_DIR` to the volume's mount path
   (e.g. `/data`). Without this the database resets on every redeploy.
4. Set env var `PLANTMOOD_ADMIN_PASSWORD` to your real admin password **before the first boot**
   (it seeds the initial password; afterwards change it in Admin → Settings).
5. Deploy. On first boot the catalogue auto-seeds (55 products, 7 categories).
6. In **Admin → Settings**, set your **WhatsApp number** (orders are sent there) and delivery fees.

Notes: the platform provides `PORT` automatically. Admin login sessions live in memory, so they
reset on redeploy (just log in again). Node 24+ is required (`node:sqlite`) — pinned via `.nvmrc`
and `engines`.

## Pages

- `/` — homepage (hero, featured products, event banner, soil-free spotlight, category banners, mission, Instagram, newsletter)
- `/shop` and `/shop/:category` — catalogue with category filter
- `/product/:slug` — product detail with related products
- `/cart`, `/checkout`, `/order/:orderNo` — cart (localStorage) → mock checkout → confirmation
- `/events`, `/about`, `/plant-care`, `/faq`, `/privacy`, `/contact`
- `/admin` — management panel

## Admin panel

Open `http://localhost:4000/admin`.

- **Default password: `plantmood2026`** — change it in Admin → Settings
  (or set `PLANTMOOD_ADMIN_PASSWORD` before first launch).
- Products: create / edit / delete, price, stock, featured flag. **Product photos
  are uploaded straight from your computer** — JPG, PNG or WebP, up to 6 MB; a
  preview shows before you save. On create, a photo is required; on edit, leaving
  the file picker empty keeps the current photo, or pick a new one to replace it.
  When a photo is replaced or a product is deleted, the old admin-uploaded image
  is cleaned up automatically (built-in `/images/...` seed photos are never
  deleted). No file paths to type.
- Content: edit homepage/site text and photos (same upload rules as products).
- Orders: view details, update status (pending → paid → shipped → completed / cancelled)
- Subscribers & contact messages
- Settings: delivery fee (default RM 15) and free-delivery threshold (default RM 250)

Uploaded images are stored in `UPLOAD_DIR` and served from `/uploads/...`. In
production (Railway/Render) set **`PLANTMOOD_UPLOADS_DIR`** to a path on the same
persistent volume as the database so owner-uploaded photos survive redeploys.

### Vercel

The repository now includes a Vercel serverless entry point (`api/index.js`)
and a catch-all rewrite, so all page URLs (`/shop`, `/about`,
`/product/:slug`, etc.) and `/api/*` endpoints are served instead of only the
static homepage. Vercel's deployment filesystem is read-only, so the app uses
`/tmp` automatically for SQLite and uploads there.

`/tmp` is reset whenever Vercel starts a new function instance. That makes a
Vercel deployment suitable for a demo storefront, but **not** for persistent
orders, stock, admin edits or uploaded images. For a live shop, keep this app
on Railway/Render with a persistent volume, or migrate its SQLite data to a
persistent hosted database before relying on Vercel.

## Checkout model

The checkout is a **mock** — it validates the cart against live prices/stock, records the
order, decrements stock, and returns an order number (`PM-YYYY-NNNNNN`). No payment is taken;
you contact the customer to arrange payment (matches the FAQ copy).

## Product data

Seed data lives in `server/seed/catalog.json` (generated from the categorised photo folders,
with species identification and MYR pricing). `npm run seed` upserts — safe to re-run after
editing. Images live under `public/images/<category>/`.
