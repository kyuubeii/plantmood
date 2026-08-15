// Copies a recovered uploads folder into Supabase Storage, keeping every
// filename exactly as it was. The database stores '/uploads/<file>', so as long
// as the object names match, recovered products and content point at their
// photos again with no further changes.
//
//   npm run import:uploads -- /path/to/uploads
//   npm run import:uploads -- /path/to/uploads --dry-run
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { ensureBucket, BUCKET } from '../server/storage.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dir = args.find(a => !a.startsWith('--'));

if (!dir) {
  console.error('Usage: npm run import:uploads -- <path-to-uploads-folder> [--dry-run]');
  process.exit(1);
}
const root = path.resolve(dir);
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.error(`Not a folder: ${root}`);
  process.exit(1);
}

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

const files = fs.readdirSync(root)
  .filter(f => fs.statSync(path.join(root, f)).isFile())
  .filter(f => MIME[path.extname(f).toLowerCase()]);

if (!files.length) {
  console.log('No JPG/PNG/WebP files found in that folder.');
  process.exit(0);
}
console.log(`Found ${files.length} image(s)${dryRun ? ' (dry run — nothing will be uploaded)' : ''}`);
if (dryRun) {
  for (const f of files) console.log(`  would upload ${f}`);
  process.exit(0);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
await ensureBucket();

let ok = 0, failed = 0;
for (const f of files) {
  const buf = fs.readFileSync(path.join(root, f));
  // upsert so an interrupted run can simply be repeated.
  const { error } = await supabase.storage.from(BUCKET).upload(f, buf, {
    contentType: MIME[path.extname(f).toLowerCase()],
    cacheControl: '604800',
    upsert: true,
  });
  if (error) { console.error(`  ✗ ${f}: ${error.message}`); failed++; }
  else { ok++; }
}
console.log(`\nUploaded ${ok} image(s)${failed ? `, ${failed} failed` : ''} into bucket "${BUCKET}".`);
