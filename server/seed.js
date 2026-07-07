import { db } from './db.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalogPath = path.join(__dirname, 'seed', 'catalog.json');

export function seed() {
  if (!fs.existsSync(catalogPath)) {
    throw new Error('Missing server/seed/catalog.json — nothing to seed.');
  }
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));

  const upsertCategory = db.prepare(`
    INSERT INTO categories (slug, name, tagline, hero_image, sort)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name, tagline = excluded.tagline,
      hero_image = excluded.hero_image, sort = excluded.sort
  `);

  const upsertProduct = db.prepare(`
    INSERT INTO products (slug, name, species, description, care, price, category, image, alt, stock, featured)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name, species = excluded.species, description = excluded.description,
      care = excluded.care, price = excluded.price, category = excluded.category,
      image = excluded.image, alt = excluded.alt, stock = excluded.stock, featured = excluded.featured
  `);

  for (const c of catalog.categories) {
    upsertCategory.run(c.slug, c.name, c.tagline || '', c.hero_image || '', c.sort || 0);
  }
  let count = 0;
  for (const p of catalog.products) {
    upsertProduct.run(
      p.slug, p.name, p.species || '', p.description || '', p.care || '',
      p.price, p.category, p.image, p.alt || '', p.stock ?? 5, p.featured ? 1 : 0
    );
    count++;
  }
  return { categories: catalog.categories.length, products: count };
}

// Seed only when the catalogue is empty — safe to call on every boot without
// clobbering prices/stock the shop owner has since edited in the admin panel.
export function seedIfEmpty() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM products').get();
  if (n > 0) return null;
  return seed();
}

// Allow `node server/seed.js` to (re)seed from the command line.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = seed();
  console.log(`Seeded ${r.categories} categories, ${r.products} products.`);
}
