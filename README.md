# Plantmood 🌱

E-commerce website for **Plantmood** — a Kuala Lumpur plant studio. Design closely follows the
Soilboy reference sample (cream background, deep-green accents, extended-grotesk headings,
outline pill buttons), with all photos, products and copy from Plantmood's own catalogue.

## Stack

| Layer    | Tech |
|----------|------|
| Backend  | Node.js (≥22.5) + Express 4, Postgres via `postgres` |
| Frontend | Static HTML/CSS/vanilla JS, fonts: Archivo (expanded) + Hanken Grotesk |
| Database | Supabase Postgres |
| Uploads  | Supabase Storage (public bucket, served through `/uploads/...`) |

Nothing is stored on the host's filesystem. That is deliberate: the app used to keep a
SQLite file and uploaded photos on local disk, which meant every price, photo and order
the owner entered was destroyed the next time the container was replaced.

## Run it locally

```bash
npm install                # first time only
cp .env.example .env       # then fill in the Supabase values
npm run migrate            # create the schema (safe to re-run)
npm run seed               # load server/seed/catalog.json — see the warning below
npm start                  # → http://localhost:4000
```

⚠️ **`npm run seed` overwrites prices, stock and photos** for every product whose slug is in
`catalog.json`. It is a first-time setup command, not a maintenance one. Run it once on an
empty database and never again on a live shop. Seeding no longer happens automatically on
boot — that automatic behaviour is exactly what reset the shop to factory prices after a
redeploy.

## Restoring data from an old SQLite database

```bash
npm run migrate
npm run import:sqlite  -- /path/to/plantmood.db --dry-run   # preview first
npm run import:sqlite  -- /path/to/plantmood.db
npm run import:uploads -- /path/to/uploads                  # the photo files
```

The importer reads whichever columns the old file actually has, so a database from an
older version of the schema still imports. Products, categories, settings and content are
upserted by their natural key and orders are skipped if already present, so both commands
are safe to re-run after an interruption.

## Deploy

Any host works now — there is no persistent-disk requirement.

1. Push this repo to GitHub (`.gitignore` excludes `node_modules/` and `.env`).
2. Create the project from the repo. Build: `npm install`. Start: `npm start` (also in `Procfile`).
3. Set the environment variables from `.env.example` — `DATABASE_URL`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_KEY`. Use the Supabase **transaction pooler** (port 6543) for
   `DATABASE_URL` on serverless hosts.
4. Set `PLANTMOOD_ADMIN_PASSWORD` **before the first `npm run migrate`** (it seeds the
   initial password; afterwards change it in Admin → Settings).
5. Run `npm run migrate` once against the production database.
6. In **Admin → Settings**, set your **WhatsApp number** (orders are sent there) and delivery fees.

Notes: the platform provides `PORT` automatically. Admin login sessions live in memory, so they
reset on redeploy (just log in again).

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

Uploaded images go to a public Supabase Storage bucket. The database still records them as
`/uploads/<file>`, and the app redirects that path to the storage CDN — so the `/uploads/`
prefix keeps distinguishing an owner upload from a built-in `/images/...` seed photo, and
only the former is ever deleted.

### Vercel

The repository includes a Vercel serverless entry point (`api/index.js`) and a catch-all
rewrite, so all page URLs (`/shop`, `/about`, `/product/:slug`, etc.) and `/api/*` endpoints
are served instead of only the static homepage.

Vercel's filesystem is read-only apart from `/tmp`, which is wiped on every cold start.
Since the app no longer writes to disk at all, that is no longer a problem — but it is also
why `DATABASE_URL` must point at the **transaction pooler** (port 6543): each function
invocation gets a pooled connection instead of opening its own Postgres backend.

## Checkout model

The checkout is a **mock** — it validates the cart against live prices/stock, records the
order, decrements stock, and returns an order number (`PM-YYYY-NNNNNN`). No payment is taken;
you contact the customer to arrange payment (matches the FAQ copy).

## Product data

Seed data lives in `server/seed/catalog.json` (generated from the categorised photo folders,
with species identification and MYR pricing). Images live under `public/images/<category>/`.

`npm run seed` upserts by slug, so re-running it **replaces any price, stock or photo the
owner has since changed in the admin panel**. Use it to populate an empty database, not to
update a live one.
