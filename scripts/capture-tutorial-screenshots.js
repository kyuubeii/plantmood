#!/usr/bin/env node
/* Plantmood — tutorial screenshot capture.

   Boots a throw-away instance of the site (its own port, its own temporary
   SQLite database and upload folder — never touches your real local dev data
   or the live Railway site), drives it with a real browser via Playwright,
   and saves clean screenshots into docs/tutorial/screenshots/.

   Why an isolated instance: so the tutorial's screenshots always show a
   predictable, clean catalogue (the 55 seeded demo products) and can safely
   use an obviously-fake demo customer for the checkout screenshots, without
   any risk of touching real orders, real content edits, or your real admin
   password.

   Run: npm run tutorial:screenshots
*/

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_SCREENSHOTS } from './tutorial-content.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'tutorial', 'screenshots');
const SERVER_ENTRY = path.join(ROOT, 'server', 'index.js');

// Obviously-fake demo data — never real customer or admin information.
const DEMO_ADMIN_PASSWORD = 'Demo-Tutorial-2026';
const DEMO_CUSTOMER = {
  name: 'Ain Example',
  email: 'hello@example.com',
  phone: '+60 12-345 6789',
  address1: '12 Jalan Contoh',
  city: 'Kuala Lumpur',
  state: 'Kuala Lumpur',
  postcode: '50480',
  notes: 'Demo order created for the PlantMood user tutorial screenshots.',
};

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServer(baseUrl, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${baseUrl}/api/categories`);
      if (res.ok) return;
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server did not become ready at ${baseUrl}`);
}

// Waits until every <img> matched by selector has actually finished loading —
// avoids screenshotting blank placeholders from lazy-loaded product photos.
// The live site fades sections/cards in on scroll (a `.pm-reveal` /
// `.pm-in` IntersectionObserver animation with a CSS transition). That's a
// nice touch for real visitors, but it makes tutorial screenshots flaky —
// an element photographed mid-fade looks blank. Neutralise it for every
// page in this context, from the very first paint, so every screenshot is
// deterministic and fully visible.
const DISABLE_SCROLL_REVEAL_CSS = `
  .pm-reveal { opacity: 1 !important; transform: none !important; transition: none !important; }
`;
async function disableScrollReveal(context) {
  await context.addInitScript((css) => {
    // addInitScript runs at document-start — before the parser has even
    // created <html> yet — so document.documentElement can still be null
    // here. A mutation observer on `document` reliably catches the moment
    // it appears, however early that is.
    const inject = () => {
      const style = document.createElement('style');
      style.textContent = css;
      document.documentElement.appendChild(style);
    };
    if (document.documentElement) {
      inject();
    } else {
      new MutationObserver((_, obs) => {
        if (document.documentElement) { obs.disconnect(); inject(); }
      }).observe(document, { childList: true });
    }
  }, DISABLE_SCROLL_REVEAL_CSS);
}

async function waitForImages(page, selector, timeout = 8000) {
  await page.waitForFunction(
    (sel) => {
      const imgs = [...document.querySelectorAll(sel)];
      return imgs.length > 0 && imgs.every((img) => img.complete && img.naturalWidth > 0);
    },
    selector,
    { timeout }
  ).catch(() => { /* best-effort — proceed even if a stray image never loads */ });
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const shot = (name) => path.join(OUT_DIR, name);

  const dataDir = mkdtempSync(path.join(tmpdir(), 'plantmood-tutorial-data-'));
  const uploadsDir = path.join(dataDir, 'uploads');
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  console.log(`Starting an isolated Plantmood instance on ${baseUrl} (temp data: ${dataDir})`);

  const server = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      PLANTMOOD_DATA_DIR: dataDir,
      PLANTMOOD_UPLOADS_DIR: uploadsDir,
      PLANTMOOD_ADMIN_PASSWORD: DEMO_ADMIN_PASSWORD,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => process.stdout.write(`  [server] ${d}`));
  server.stderr.on('data', (d) => process.stderr.write(`  [server] ${d}`));

  let browser;
  try {
    await waitForServer(baseUrl);
    console.log('Server ready. Launching Chromium...');

    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1.5,
    });
    await disableScrollReveal(context);
    const page = await context.newPage();
    // The order confirmation page auto-opens WhatsApp in a new tab on a real
    // order — swallow that popup immediately so it can't hang the script.
    // (Only close *other* pages the context opens — never our own `page`.)
    context.on('page', (p) => { if (p !== page) p.close().catch(() => {}); });
    page.on('pageerror', (e) => console.error('  (browser JS error)', e.message));
    page.on('console', (msg) => { if (msg.type() === 'error') console.error('  (browser console.error)', msg.text()); });

    // ---------------------------------------------------------- homepage
    console.log('1-2/18 · homepage');
    await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
    await waitForImages(page, '.section--hero img, .section--hero [style*="background-image"]');
    await page.waitForSelector('#featured-grid .product-card', { timeout: 15000 });
    await waitForImages(page, '#featured-grid .product-card img');
    await page.screenshot({ path: shot('01-homepage-hero.png') });
    await page.locator('section:has(#featured-grid)').screenshot({ path: shot('02-homepage-featured.png') });

    // ---------------------------------------------------------- shop listing
    console.log('3/18 · shop listing');
    await page.goto(`${baseUrl}/shop`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#shop-grid .product-card', { timeout: 15000 });
    await waitForImages(page, '#shop-grid .product-card img');
    await page.screenshot({ path: shot('03-shop-listing.png') });

    // ---------------------------------------------------------- product detail
    console.log('4/18 · product detail');
    const products = await (await fetch(`${baseUrl}/api/products`)).json();
    const featuredProduct = products.find((p) => !p.soldOut && p.care && p.description) || products.find((p) => !p.soldOut);
    await page.goto(`${baseUrl}/product/${featuredProduct.slug}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.product-detail', { timeout: 15000 });
    await waitForImages(page, '.product-detail__gallery img');
    await page.screenshot({ path: shot('04-product-detail.png') });

    // ---------------------------------------------------------- cart
    console.log('5/18 · cart');
    const cartProducts = products.filter((p) => !p.soldOut).slice(0, 2);
    await page.evaluate((items) => {
      localStorage.setItem('pm_cart', JSON.stringify(items.map((p) => ({ id: p.id, qty: 1 }))));
    }, cartProducts);
    await page.goto(`${baseUrl}/cart`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.cart-line', { timeout: 15000 });
    await waitForImages(page, '.cart-line img');
    await page.screenshot({ path: shot('05-cart.png') });

    // ---------------------------------------------------------- checkout (fill, screenshot, submit)
    console.log('6/18 · checkout form');
    await page.goto(`${baseUrl}/checkout`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#checkout-form', { state: 'visible', timeout: 15000 });
    await page.fill('#checkout-form [name="name"]', DEMO_CUSTOMER.name);
    await page.fill('#checkout-form [name="email"]', DEMO_CUSTOMER.email);
    await page.fill('#checkout-form [name="phone"]', DEMO_CUSTOMER.phone);
    await page.fill('#checkout-form [name="postcode"]', DEMO_CUSTOMER.postcode);
    await page.fill('#checkout-form [name="address1"]', DEMO_CUSTOMER.address1);
    await page.fill('#checkout-form [name="city"]', DEMO_CUSTOMER.city);
    await page.selectOption('#checkout-form [name="state"]', DEMO_CUSTOMER.state);
    await page.fill('#checkout-form [name="notes"]', DEMO_CUSTOMER.notes);
    await page.screenshot({ path: shot('06-checkout-form.png') });

    // ---------------------------------------------------------- order confirmation + WhatsApp button
    console.log('7/18 · order confirmation (WhatsApp)');
    await Promise.all([
      page.waitForURL(/\/order\//, { timeout: 15000 }),
      page.click('#checkout-form button[type="submit"]'),
    ]);
    await page.waitForSelector('#wa-btn', { timeout: 15000 });
    await page.screenshot({ path: shot('07-order-whatsapp.png') });

    // ---------------------------------------------------------- contact page
    console.log('8/18 · contact page');
    await page.goto(`${baseUrl}/contact`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#contact-form', { timeout: 15000 });
    await page.screenshot({ path: shot('08-contact-page.png') });

    // ---------------------------------------------------------- admin: login screen
    console.log('9/18 · admin login');
    await page.goto(`${baseUrl}/admin`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#login-view:not([hidden])', { timeout: 15000 });
    await page.screenshot({ path: shot('09-admin-login.png') });

    // log in
    await page.fill('#login-form [name="password"]', DEMO_ADMIN_PASSWORD);
    await page.click('#login-form button[type="submit"]');
    await page.waitForSelector('#app-view:not([hidden])', { timeout: 15000 });

    // ---------------------------------------------------------- admin: products tab (default)
    console.log('10/18 · admin products tab');
    await page.waitForSelector('table.admin', { timeout: 15000 });
    await waitForImages(page, 'table.admin img');
    await page.screenshot({ path: shot('10-admin-products-tab.png') });

    // ---------------------------------------------------------- admin: new product form
    // Note: the product/content form element itself carries the "drawer" box
    // styling (<form class="drawer">) — it is not a form nested inside a
    // separate .drawer container, so we wait for and screenshot `.drawer`.
    console.log('11/18 · admin add product form');
    await page.click('#new-product-btn');
    await page.waitForSelector('#form-slot .drawer', { timeout: 15000 });
    await page.locator('#form-slot .drawer').screenshot({ path: shot('11-admin-add-product.png') });
    await page.click('#form-slot [data-cancel]'); // close without creating a demo product

    // ---------------------------------------------------------- admin: edit product form
    console.log('12/18 · admin edit product form');
    await page.locator('table.admin [data-edit]').first().click();
    await page.waitForSelector('#form-slot .drawer', { timeout: 15000 });
    await waitForImages(page, '#form-slot .img-preview');
    await page.locator('#form-slot .drawer').screenshot({ path: shot('12-admin-edit-product.png') });
    await page.click('#form-slot [data-cancel]');

    // ---------------------------------------------------------- admin: content tab
    console.log('13-15/18 · admin content tab');
    await page.click('.admin-tabs [data-tab="content"]');
    await page.waitForSelector('.content-field', { timeout: 15000 });
    await waitForImages(page, '.content-field img');
    await page.screenshot({ path: shot('13-admin-content-tab.png') });
    await page.locator('.content-field[data-type="image"]').first().screenshot({ path: shot('14-admin-content-image-field.png') });
    await page.locator('.content-field[data-type="text"]').first().screenshot({ path: shot('15-admin-content-text-field.png') });

    // ---------------------------------------------------------- admin: orders tab
    console.log('16/18 · admin orders tab');
    await page.click('.admin-tabs [data-tab="orders"]');
    await page.waitForSelector('table.admin, .muted', { timeout: 15000 });
    await page.screenshot({ path: shot('16-admin-orders-tab.png') });

    // ---------------------------------------------------------- admin: settings tab
    console.log('17/18 · admin settings tab');
    await page.click('.admin-tabs [data-tab="settings"]');
    await page.waitForSelector('#ship-form', { timeout: 15000 });
    await page.screenshot({ path: shot('17-admin-settings-tab.png') });

    // ---------------------------------------------------------- mobile homepage
    console.log('18/18 · mobile homepage');
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
    });
    await disableScrollReveal(mobileContext);
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
    await mobilePage.waitForSelector('#featured-grid .product-card', { timeout: 15000 });
    await waitForImages(mobilePage, '.section--hero img, #featured-grid .product-card img');
    await mobilePage.screenshot({ path: shot('18-mobile-homepage.png') });
    await mobileContext.close();

    await browser.close();
    browser = undefined;

    // ---------------------------------------------------------- sanity check
    const fs = await import('node:fs');
    const missing = ALL_SCREENSHOTS.filter((f) => !fs.existsSync(shot(f)));
    if (missing.length) throw new Error(`Missing expected screenshots: ${missing.join(', ')}`);
    console.log(`\nAll ${ALL_SCREENSHOTS.length} screenshots saved to ${path.relative(ROOT, OUT_DIR)}/`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
    rmSync(dataDir, { recursive: true, force: true });
    console.log('Isolated server stopped and temp data cleaned up.');
  }
}

main().catch((err) => {
  console.error('\nScreenshot capture failed:', err);
  process.exit(1);
});
