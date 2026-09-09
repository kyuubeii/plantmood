// Minimal RFC 4180 CSV reader/writer. Product descriptions routinely contain
// commas, quotes and newlines, so the naive split(',') version corrupts them —
// and a corrupted backup is worse than none.
export function toCsv(rows, columns) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [columns.map(esc).join(',')];
  for (const r of rows) lines.push(columns.map(c => esc(r[c])).join(','));
  // \r\n and a UTF-8 BOM so Excel opens it correctly, accents and all.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function fromCsv(text) {
  let s = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* handled by \n */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows.shift().map(h => h.trim());
  return rows
    .filter(r => r.some(v => v !== ''))          // skip blank lines Excel adds
    .map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}
