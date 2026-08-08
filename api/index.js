import app from '../server/index.js';

// Vercel only discovers Node serverless functions inside /api for this
// project. vercel.json forwards every public URL here and attaches the
// original path as __pm_path, so restore it before Express matches routes.
export default function handler(req, res) {
  const url = new URL(req.url || '/', 'http://plantmood.local');
  const originalPath = url.searchParams.get('__pm_path');

  if (originalPath !== null) {
    url.searchParams.delete('__pm_path');
    req.url = '/' + originalPath.replace(/^\/+/, '') + url.search;
  }

  return app(req, res);
}
