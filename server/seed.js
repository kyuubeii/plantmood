import { sql } from './db.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalogPath = path.join(__dirname, 'seed', 'catalog.json');

// Loads the built-in catalogue. This OVERWRITES prices, stock and photos for
// any product whose slug it knows, so it is only ever run deliberately
// (`npm run seed`) — never on boot. Automatic boot-time seeding is what reset
// the shop to factory prices after a redeploy.
export async function seed() {
  if (!fs.existsSync(catalogPath)) {
    throw new Error('Missing server/seed/catalog.json — nothing to seed.');
  }
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));

  for (const c of catalog.categories) {
    await sql`
      INSERT INTO categories (slug, name, tagline, hero_image, sort)
      VALUES (${c.slug}, ${c.name}, ${c.tagline || ''}, ${c.hero_image || ''}, ${c.sort || 0})
      ON CONFLICT (slug) DO UPDATE SET
        name = excluded.name, tagline = excluded.tagline,
        hero_image = excluded.hero_image, sort = excluded.sort
    `;
  }
  let count = 0;
  for (const p of catalog.products) {
    await sql`
      INSERT INTO products (slug, name, species, description, care, price, category, image, alt, stock, featured)
      VALUES (${p.slug}, ${p.name}, ${p.species || ''}, ${p.description || ''}, ${p.care || ''},
              ${p.price}, ${p.category}, ${p.image}, ${p.alt || ''}, ${p.stock ?? 5}, ${p.featured ? 1 : 0})
      ON CONFLICT (slug) DO UPDATE SET
        name = excluded.name, species = excluded.species, description = excluded.description,
        care = excluded.care, price = excluded.price, category = excluded.category,
        image = excluded.image, alt = excluded.alt, stock = excluded.stock, featured = excluded.featured
    `;
    count++;
  }
  return { categories: catalog.categories.length, products: count };
}

// Allow `node server/seed.js` to (re)seed from the command line.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await seed();
  console.log(`Seeded ${r.categories} categories, ${r.products} products.`);
  await sql.end();
}
