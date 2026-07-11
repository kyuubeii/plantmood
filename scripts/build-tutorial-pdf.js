#!/usr/bin/env node
/* Plantmood — tutorial PDF builder.

   Renders scripts/tutorial-content.js into a real, browser-openable HTML
   page (docs/tutorial/source/tutorial.html + tutorial.css), then uses
   Playwright to print that exact page to
   docs/tutorial/PlantMood_User_Tutorial.pdf.

   The HTML file in docs/tutorial/source/ IS the source of the PDF, not a
   throwaway string — open it directly in a browser to proof-read before
   (re)printing, or to tweak layout without touching the JS.

   Run: npm run tutorial:pdf   (screenshots must already exist — see
   npm run tutorial:screenshots, or just `npm run generate:tutorial` for both)
*/

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTIONS, ALL_SCREENSHOTS } from './tutorial-content.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const TUTORIAL_DIR = path.join(ROOT, 'docs', 'tutorial');
const SOURCE_DIR = path.join(TUTORIAL_DIR, 'source');
const SCREENSHOTS_DIR = path.join(TUTORIAL_DIR, 'screenshots');
const OUT_PDF = path.join(TUTORIAL_DIR, 'PlantMood_User_Tutorial.pdf');

const GENERATED_ON = new Date().toLocaleDateString('en-MY', {
  year: 'numeric', month: 'long', day: 'numeric',
});

// ---------------------------------------------------------------- helpers

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Minimal markdown-lite: escapes HTML, then turns **bold** into <strong>.
const mdLite = (s) => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

const CALLOUT_META = {
  tip: { icon: '🌱', label: 'Tip' },
  warning: { icon: '⚠️', label: 'Important' },
  note: { icon: '📌', label: 'Note' },
};

function renderImage(block) {
  if (!ALL_SCREENSHOTS.includes(block.src)) {
    throw new Error(`tutorial-content.js references a screenshot not in ALL_SCREENSHOTS: ${block.src}`);
  }
  const filePath = path.join(SCREENSHOTS_DIR, block.src);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing screenshot file: ${filePath}\nRun "npm run tutorial:screenshots" first.`);
  }
  return `
    <figure class="shot">
      <img src="../screenshots/${escapeHtml(block.src)}" alt="${escapeHtml(block.caption || '')}">
      ${block.caption ? `<figcaption>${mdLite(block.caption)}</figcaption>` : ''}
    </figure>`;
}

function renderBlock(block) {
  switch (block.type) {
    case 'subheading':
      return `<h3>${mdLite(block.text)}</h3>`;

    case 'p':
      return `<p>${mdLite(block.text)}</p>`;

    case 'list':
      return `<ul>${block.items.map((i) => `<li>${mdLite(i)}</li>`).join('')}</ul>`;

    case 'steps':
      return `<ol class="steps">${block.items.map((i) => `<li>${mdLite(i)}</li>`).join('')}</ol>`;

    case 'checklist':
      return `<ul class="checklist">${block.items.map((i) => `<li><span class="box"></span>${mdLite(i)}</li>`).join('')}</ul>`;

    case 'table': {
      const head = `<tr>${block.headers.map((h) => `<th>${mdLite(h)}</th>`).join('')}</tr>`;
      const rows = block.rows.map((r) => `<tr>${r.map((c) => `<td>${mdLite(c)}</td>`).join('')}</tr>`).join('');
      return `<table><thead>${head}</thead><tbody>${rows}</tbody></table>`;
    }

    case 'callout': {
      const meta = CALLOUT_META[block.kind] || CALLOUT_META.note;
      return `
        <aside class="callout callout--${block.kind}">
          <div class="callout__icon">${meta.icon}</div>
          <div class="callout__body">
            <p class="callout__title">${escapeHtml(block.title || meta.label)}</p>
            <p>${mdLite(block.text)}</p>
          </div>
        </aside>`;
    }

    case 'image':
      return renderImage(block);

    case 'row':
      return `<div class="row">${block.items.map((it) => renderBlock(it)).join('')}</div>`;

    default:
      throw new Error(`Unknown content block type: ${block.type}`);
  }
}

function renderSection(section) {
  return `
    <section class="tutorial-section" id="${escapeHtml(section.id)}">
      <p class="eyebrow">Section ${section.number}</p>
      <h2>${escapeHtml(section.title)}</h2>
      ${section.blocks.map(renderBlock).join('\n')}
    </section>`;
}

function renderCover() {
  return `
    <section class="cover">
      <div class="cover__mark">🌿</div>
      <p class="cover__eyebrow">User Tutorial</p>
      <h1>PlantMood<br>Website User Tutorial</h1>
      <p class="cover__subtitle">A simple, step-by-step guide to running your website<br>and managing your admin panel — no coding required.</p>
      <p class="cover__date">Prepared ${escapeHtml(GENERATED_ON)}</p>
    </section>`;
}

function renderToc() {
  const items = SECTIONS.map((s) => `
    <li>
      <a href="#${escapeHtml(s.id)}">
        <span class="toc__num">${String(s.number).padStart(2, '0')}</span>
        <span class="toc__title">${escapeHtml(s.title)}</span>
      </a>
    </li>`).join('');
  return `
    <section class="tutorial-section toc">
      <p class="eyebrow">Contents</p>
      <h2>What's inside</h2>
      <p>Tap any section below to jump straight to it — you don't need to read this guide in order.</p>
      <ol class="toc__list">${items}</ol>
    </section>`;
}

function buildHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>PlantMood Website User Tutorial</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Karla:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="tutorial.css">
</head>
<body>
${renderCover()}
${renderToc()}
${SECTIONS.map(renderSection).join('\n')}
</body>
</html>
`;
}

function buildCss() {
  // Same palette as public/css/site.css, so the tutorial reads as a natural
  // extension of the website rather than a generic document.
  return `
:root {
  --bg: hsl(42, 100%, 99%);
  --ink: hsl(0, 0%, 14.9%);
  --accent: hsl(131.11, 35.06%, 15.1%);
  --accent-tint: hsl(131.11, 35.06%, 94%);
  --terracotta: hsl(12.12, 44%, 44.12%);
  --terracotta-tint: hsl(12.12, 60%, 95%);
  --line: hsla(0, 0%, 14.9%, 0.15);
  --heading-font: 'Cormorant Garamond', Georgia, 'Times New Roman', serif;
  --body-font: 'Karla', 'Helvetica Neue', Arial, sans-serif;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--body-font);
  font-size: 12.5pt;
  line-height: 1.55;
}

h1, h2, h3 {
  font-family: var(--heading-font);
  font-weight: 600;
  line-height: 1.15;
  margin: 0 0 0.5em;
  color: var(--accent);
}

h2 { font-size: 26pt; font-weight: 600; }
h3 { font-size: 15pt; margin-top: 1.6em; color: var(--ink); }

p { margin: 0 0 0.9em; }
strong { font-weight: 700; }

a { color: var(--accent); }

.eyebrow {
  font-family: var(--body-font);
  font-size: 9.5pt;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--terracotta);
  margin: 0 0 0.4em;
}

/* ---------------- cover page ---------------- */
.cover {
  /* A4 is 297mm tall; Playwright's own top+bottom margins (18mm + 16mm)
     already remove 34mm, leaving ~263mm of usable content height per page.
     Keep this comfortably under that so the cover can never itself spill
     onto a second, near-blank page — the TOC's own break-before:page is
     what starts the next page, so no break-after is needed here. */
  height: 250mm;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.cover__mark { font-size: 46pt; margin-bottom: 0.3em; }
.cover__eyebrow {
  font-size: 11pt; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--terracotta); margin-bottom: 0.6em;
}
.cover h1 { font-size: 40pt; margin-bottom: 0.5em; }
.cover__subtitle { font-size: 13pt; color: hsla(0,0%,14.9%,0.75); max-width: 420px; margin-bottom: 1.6em; }
.cover__date { font-size: 10.5pt; color: hsla(0,0%,14.9%,0.55); }

/* ---------------- table of contents ---------------- */
.toc__list { list-style: none; margin: 1.4em 0 0; padding: 0; }
.toc__list li { border-bottom: 1px solid var(--line); }
.toc__list a {
  display: flex; align-items: baseline; gap: 0.9em;
  padding: 0.7em 0.2em; text-decoration: none; color: var(--ink);
}
.toc__num { font-family: var(--heading-font); font-size: 15pt; color: var(--terracotta); width: 1.6em; }
.toc__title { font-size: 13pt; }

/* ---------------- sections ---------------- */
.tutorial-section {
  break-before: page;
  padding-top: 6mm;
}

ul, ol { margin: 0 0 1em; padding-left: 1.3em; }
ul li, ol li { margin-bottom: 0.45em; }

ol.steps { padding-left: 0; list-style: none; counter-reset: step; }
ol.steps li {
  counter-increment: step;
  position: relative;
  padding-left: 2.1em;
  margin-bottom: 0.65em;
}
ol.steps li::before {
  content: counter(step);
  position: absolute; left: 0; top: -0.05em;
  width: 1.5em; height: 1.5em; border-radius: 50%;
  background: var(--accent); color: var(--bg);
  font-family: var(--heading-font); font-weight: 600; font-size: 10.5pt;
  display: flex; align-items: center; justify-content: center;
}

ul.checklist { list-style: none; padding-left: 0; }
ul.checklist li { display: flex; align-items: flex-start; gap: 0.7em; margin-bottom: 0.6em; }
ul.checklist .box {
  flex: none; width: 0.95em; height: 0.95em; margin-top: 0.28em;
  border: 1.4px solid var(--ink); border-radius: 3px;
}

table { width: 100%; border-collapse: collapse; margin: 0.8em 0 1.4em; font-size: 10.8pt; }
th, td { text-align: left; padding: 0.55em 0.7em; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: 9.5pt; text-transform: uppercase; letter-spacing: 0.05em; color: hsla(0,0%,14.9%,0.6); }
tbody tr:nth-child(odd) { background: hsla(0,0%,14.9%,0.025); }

.callout {
  display: flex; gap: 0.8em;
  border-radius: 10px;
  padding: 0.9em 1.1em;
  margin: 1em 0 1.4em;
  break-inside: avoid;
}
.callout--tip { background: var(--accent-tint); }
.callout--warning, .callout--note { background: var(--terracotta-tint); }
.callout__icon { font-size: 15pt; line-height: 1; }
.callout__title { font-weight: 700; margin: 0 0 0.25em; font-family: var(--heading-font); font-size: 12.5pt; }
.callout p:last-child { margin-bottom: 0; }

.shot {
  margin: 1em 0 1.5em;
  break-inside: avoid;
}
.shot img {
  width: 100%;
  display: block;
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: 0 6px 18px hsla(0,0%,14.9%,0.1);
}
.shot figcaption {
  font-size: 9.8pt;
  color: hsla(0,0%,14.9%,0.6);
  margin-top: 0.5em;
  font-style: italic;
  text-align: center;
}

.row { display: flex; gap: 0.9em; }
.row .shot { flex: 1 1 0; margin-top: 0; }

@media print {
  .tutorial-section { break-before: page; }
}
`;
}

// ---------------------------------------------------------------- main

async function main() {
  fs.mkdirSync(SOURCE_DIR, { recursive: true });

  // Fail loudly and early if the content module points at a screenshot that
  // was never captured — better than shipping a PDF with a broken image.
  const missing = ALL_SCREENSHOTS.filter((f) => !fs.existsSync(path.join(SCREENSHOTS_DIR, f)));
  if (missing.length) {
    throw new Error(
      `Missing screenshots: ${missing.join(', ')}\nRun "npm run tutorial:screenshots" first.`
    );
  }

  const html = buildHtml();
  const css = buildCss();
  fs.writeFileSync(path.join(SOURCE_DIR, 'tutorial.html'), html);
  fs.writeFileSync(path.join(SOURCE_DIR, 'tutorial.css'), css);
  console.log(`Wrote ${path.relative(ROOT, path.join(SOURCE_DIR, 'tutorial.html'))} (${(html.length / 1024).toFixed(0)} KB)`);

  console.log('Launching Chromium to print the PDF...');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto('file://' + path.join(SOURCE_DIR, 'tutorial.html'), { waitUntil: 'networkidle' });

    await page.pdf({
      path: OUT_PDF,
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '16mm', left: '16mm', right: '16mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `
        <div style="width:100%; font-size:8.5px; font-family: Karla, Arial, sans-serif; color:#8a8a86; padding:0 16mm; display:flex; justify-content:space-between;">
          <span>PlantMood Website User Tutorial</span>
          <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
        </div>`,
    });
  } finally {
    await browser.close();
  }

  const stat = fs.statSync(OUT_PDF);
  console.log(`\nPDF written to ${path.relative(ROOT, OUT_PDF)} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
}

main().catch((err) => {
  console.error('\nPDF build failed:', err);
  process.exit(1);
});
