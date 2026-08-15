// Creates the Supabase Postgres schema and fills in the settings the app needs
// to boot. Safe to re-run: every statement is CREATE TABLE IF NOT EXISTS, and
// defaults are only written when missing, so the owner's data is never touched.
//
//   npm run migrate
import { sql, migrate } from '../server/db.js';

await migrate();

const [{ count }] = await sql`SELECT count(*)::int AS count FROM products`;
console.log(`Schema ready. Products currently in the database: ${count}`);
if (count === 0) {
  console.log('Catalogue is empty — run `npm run seed` to load server/seed/catalog.json,');
  console.log('or `npm run import:sqlite -- <file.db>` to restore a recovered database.');
}

await sql.end();
