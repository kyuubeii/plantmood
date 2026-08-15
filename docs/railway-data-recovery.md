# Railway data recovery — findings (2026-08-12)

Investigating loss of admin-edited data (prices, product text, uploaded photos)
after moving the deployment from Railway to Vercel.

## Status: NOT RECOVERABLE — confirmed by inspection (2026-08-12, 20:0x SGT)

The volume was mounted into a running container and read directly. It contains
**only `lost+found`** (20K, created 2026-07-07 when the volume was made). Nothing
was ever written to it.

```
$ railway ssh "ls -la '/da ta'; du -sh '/da ta'; find '/da ta' -type f"
drwx------ 2 root root 16384 Jul  7 07:35 lost+found
20K	/da ta
(no files)
```

The "32MB used" reported by `railway volume list` is filesystem overhead, not
data — it was a red herring that briefly looked like good news.

So the owner's edits between 2026-07-12 and 2026-08-07 lived only on the
container's ephemeral disk and were destroyed when that container was removed on
2026-08-07. There is no backup: Railway's free tier has no volume snapshots, and
the `snapshotId` values on deployment records are build snapshots, not data.

**The prices, product text and photos must be re-entered by hand.** Nothing else
will bring them back.

## Verified facts

- Volume `plantmood-volume` (id `7ae7bbca-b34c-4341-8036-f01deac82743`) exists,
  Status: Ready, reports 32MB used — but contains no files.
- Its mount path is literally `/da ta` — with a space. A typo made when the
  volume was created.
- Neither `PLANTMOOD_DATA_DIR` nor `PLANTMOOD_UPLOADS_DIR` was ever set on the
  Railway service.
- Every deployment is `REMOVED`; the last real one (commit 715e881) ran
  2026-07-12 → 2026-08-07. The site now 404s (`Application not found`).
- The only `FAILED` deployment is the very first one (2026-07-07, empty repo).
- `railway up` is refused: "Your trial has expired. Please select a plan."
- Wayback CDX index returns `[]` for `plantmood.up.railway.app*` — no archived
  snapshots of the storefront or its `/api/products` JSON.
- The local `data/plantmood.db` in this repo is unrelated dev data from July
  (55 products, 0 orders).

## How the volume was finally read (for reference)

`railway volume files list|download` and `railway ssh` all route through a
*running* container, so an idle or crashed service cannot be inspected.

1. Free-tier deploys to `asia-southeast1` are blocked 08:00–20:00 SGT.
2. Deploying the current code crashed on boot — it now requires `DATABASE_URL`,
   which is not set on Railway.
3. A start command of `sleep infinity` deploys but does not bind `$PORT`, so
   Railway puts the service to sleep and SFTP still times out.
4. What worked: a start command running a minimal HTTP listener on `$PORT`, which
   keeps the container Online and lets `railway ssh` / volume file commands in.

`Procfile` was changed temporarily for step 4 and has been restored to `web: npm start`.

## If a database is ever recovered from elsewhere

The import path exists and is tested, so it can be used with any old
`plantmood.db`:

```bash
npm run import:sqlite  -- ./plantmood.db --dry-run
npm run import:sqlite  -- ./plantmood.db
npm run import:uploads -- ./uploads
```

The importer upserts products by slug, so it overwrites the seeded catalogue
with the recovered prices.

## Migration to Supabase — done and verified (2026-08-12)

The app no longer writes to the filesystem at all, so this cannot recur. Verified
against the real Supabase project, not just syntax-checked:

- schema created; catalogue seeded (7 categories, 55 products)
- storefront endpoints incl. all four `/api/products` filter combinations
- checkout: order created, stock decremented, oversell rejected with 409
- order lookup by token; wrong token 404s
- admin: login, 401 without token, settings roundtrip
- cancel/un-cancel an order restores and re-takes stock (the `GREATEST` path)
- image upload → Supabase Storage → `/uploads/…` 302 → CDN 200; forged image
  bytes rejected; replaced photo's object deleted; `/images/` seed photos untouched
- test data removed afterwards; database left clean (55 products, 0 orders)

Boot-time `seedIfEmpty()` is gone — that was the mechanism that reset the shop.

## Root cause

Persistence was configured but never actually wired up: the volume was mounted
at a typo'd path, and the app was never pointed at it. All data lived on the
container's ephemeral filesystem and died with the container on 2026-08-07.

## Why it must not be rebuilt the same way

Vercel is worse, not better: its bundle is read-only and the fallback is `/tmp`,
which is wiped on every cold start (server/db.js:9-15). Re-entering data on the
current Vercel deployment would lose it again, repeatedly.

## Fix before re-entering any data

Move persistence off the local filesystem:
- Products/orders/content → Supabase Postgres (replace the SQLite layer in
  server/db.js and its callers)
- Uploaded images → Supabase Storage (server/index.js `saveUploadedImage`)

Alternative if staying on a disk-based host: set `PLANTMOOD_DATA_DIR` and
`PLANTMOOD_UPLOADS_DIR` to a correctly-mounted volume path, and verify by
writing a file and redeploying.
