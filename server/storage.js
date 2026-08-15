import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

// Owner-uploaded photos live in Supabase Storage, not on the host's disk.
// Writing them to the filesystem is what lost them before: Vercel's bundle is
// read-only (so uploads land in /tmp and vanish on the next cold start), and on
// a container host they die with the container.
//
// The public path format is deliberately unchanged: the database still stores
// '/uploads/<file>'. Everything downstream relies on that prefix to tell an
// owner upload apart from a built-in '/images/...' seed photo, and only ever
// deletes the former. Express redirects /uploads/<file> to the Supabase public
// URL, so no stored value has to change.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
export const BUCKET = process.env.SUPABASE_BUCKET || 'plantmood-uploads';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error(
    'SUPABASE_URL / SUPABASE_SERVICE_KEY are not set. Copy .env.example to .env — ' +
    'the service key is under Project Settings → API Keys (secret key, NOT the ' +
    'publishable one; uploads bypass RLS and need the privileged key).'
  );
}

// Module-level singleton so a warm serverless instance reuses it.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Create the bucket on first use. Public-read: these are storefront photos, and
// serving them straight from Supabase's CDN keeps the app off the image path.
export async function ensureBucket() {
  const { data, error } = await supabase.storage.getBucket(BUCKET);
  if (data && !error) return;
  const { error: createError } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 6 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  });
  if (createError && !/already exists/i.test(createError.message)) throw createError;
}

// Confirm the bytes really are the image type they claim to be.
function sniffImageExt(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

// Shared image-upload handler for both the Content editor and the Products
// editor. Decodes an admin-supplied data URL, validates it hard (never trusts
// the client's declared MIME type or extension — the real type is sniffed from
// the bytes), and uploads it under an unpredictable random name.
// Returns { path: '/uploads/<file>' } on success, or { error, status } on
// failure so the caller can respond without leaking server internals.
export async function saveUploadedImage(dataUrl, namePrefix) {
  const m = /^data:(image\/[a-z+]+);base64,([\s\S]+)$/.exec(String(dataUrl || ''));
  if (!m) return { error: 'Please choose an image file (JPG, PNG or WebP).', status: 400 };

  let buf;
  try { buf = Buffer.from(m[2], 'base64'); } catch { buf = null; }
  if (!buf || !buf.length) return { error: 'The image could not be read. Please try another file.', status: 400 };
  if (buf.length > 6 * 1024 * 1024) {
    return { error: 'That image is larger than 6 MB. Please use a smaller photo.', status: 413 };
  }
  const ext = sniffImageExt(buf); // magic-byte check — SVG/GIF/HTML/etc. rejected here
  if (!ext) return { error: 'Only JPG, PNG or WebP images are allowed.', status: 400 };

  // Sanitise the prefix (no path traversal / odd chars) and add random bytes so
  // object names are unpredictable and never collide with an existing file.
  const safePrefix = String(namePrefix || 'img')
    .replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'img';
  const fname = `${safePrefix}-${crypto.randomBytes(6).toString('hex')}.${ext}`;

  try {
    await ensureBucket();
    const { error } = await supabase.storage.from(BUCKET).upload(fname, buf, {
      contentType: MIME[ext],
      cacheControl: '604800',
      upsert: false,
    });
    if (error) throw error;
  } catch {
    return { error: 'Could not save the image. Please try again.', status: 500 };
  }
  return { path: `/uploads/${fname}` };
}

// Only objects we uploaded under /uploads/ are ever deleted — never the seed
// images that ship with the site under /images/. Returns a warning string if
// deletion failed, matching the previous filesystem behaviour.
export async function removeUploadedImage(publicPath) {
  if (typeof publicPath !== 'string' || !publicPath.startsWith('/uploads/')) return undefined;
  const name = publicPath.slice('/uploads/'.length);
  if (!name || name.includes('/')) return undefined; // guard traversal
  try {
    const { error } = await supabase.storage.from(BUCKET).remove([name]);
    if (error) throw error;
    return undefined;
  } catch {
    return `The previous image (${name}) could not be removed from storage. The site is fine — you can delete it manually later.`;
  }
}

// Public CDN URL for an object, used by the /uploads/:name redirect.
export function publicUrl(name) {
  return supabase.storage.from(BUCKET).getPublicUrl(name).data.publicUrl;
}
