/* Backup export/import (JSON + embedded receipts as data URIs), CSV report,
   and a print-to-PDF report view. All offline — no external libraries. */

const BACKUP_SCHEMA_VERSION = 1;

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
function dataUrlToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(',');
  const mime = meta.match(/data:(.*);base64/)[1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function exportBackup() {
  const receipts = await Promise.all(Data.receipts.map(async r => ({
    id: r.id, transactionId: r.transactionId, mimeType: r.mimeType, createdAt: r.createdAt,
    dataUrl: await blobToDataUrl(r.blob)
  })));
  const payload = {
    schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: new Date().toISOString(),
    trip: Data.trip, travelers: Data.travelers, categories: Data.categories,
    accounts: Data.accounts, transportTypes: Data.transportTypes, passes: Data.passes,
    transactions: Data.transactions, receipts
  };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  downloadBlob(blob, `kyu-backup-${Data.trip.name.replace(/[^a-z0-9]+/gi, '-')}-${Data.trip.id.slice(0, 8)}.json`);
}

async function importBackup(file) {
  const text = await file.text();
  let payload;
  try { payload = JSON.parse(text); } catch (e) { throw new Error('Not a valid kyu backup file.'); }
  if (!payload || payload.schemaVersion == null || !payload.trip || !Array.isArray(payload.transactions)) {
    throw new Error('Backup file is missing required data.');
  }
  if (payload.schemaVersion > BACKUP_SCHEMA_VERSION) {
    throw new Error('This backup was made with a newer version of kyu.');
  }

  const idMap = {};
  const remap = id => { if (id == null) return id; if (!idMap[id]) idMap[id] = uid(); return idMap[id]; };
  const now = new Date().toISOString();

  const newTripId = remap(payload.trip.id);
  const trip = { ...payload.trip, id: newTripId, status: 'active', createdAt: now, updatedAt: now };
  await DB.put('trips', trip);

  for (const t of payload.travelers || []) await DB.put('travelers', { ...t, id: remap(t.id), tripId: newTripId });
  for (const c of payload.categories || []) await DB.put('categories', { ...c, id: remap(c.id), tripId: newTripId });
  for (const a of payload.accounts || []) await DB.put('accounts', { ...a, id: remap(a.id), tripId: newTripId });
  for (const tt of payload.transportTypes || []) await DB.put('transportTypes', { ...tt, id: remap(tt.id), tripId: newTripId });
  for (const p of payload.passes || []) await DB.put('passes', { ...p, id: remap(p.id), tripId: newTripId, purchaseTransactionId: remap(p.purchaseTransactionId) });

  for (const t of payload.transactions) {
    const nt = { ...t, id: remap(t.id), tripId: newTripId };
    ['accountId', 'sourceAccountId', 'destinationAccountId', 'categoryId', 'transportCategoryId', 'transportTypeId', 'passId', 'payerTravelerId', 'travelerId'].forEach(k => { if (nt[k] != null) nt[k] = remap(nt[k]); });
    if (Array.isArray(nt.subs)) nt.subs = nt.subs.map(s => ({ ...s, travelerId: remap(s.travelerId) }));
    nt.receiptIds = (nt.receiptIds || []).map(remap);
    await DB.put('transactions', nt);
  }

  for (const r of payload.receipts || []) {
    const blob = dataUrlToBlob(r.dataUrl);
    await DB.put('receipts', { id: remap(r.id), tripId: newTripId, transactionId: remap(r.transactionId), mimeType: r.mimeType, blob, createdAt: r.createdAt });
  }

  await loadTripsList();
}

function csvEscape(v) {
  const s = String(v == null ? '' : v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

async function exportCsv() {
  const c = ctx();
  const header = ['Date', 'Time', 'Type', 'Title', 'Category', 'Account', 'Amount', 'Currency', 'Split mode', 'Note'];
  const lines = [header.map(csvEscape).join(',')];
  Data.transactions.slice().sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).forEach(t => {
    const parts = utcIsoToZonedParts(t.occurredAt, Data.trip.timezone);
    const r = rowFor(t, c);
    const acc = Data.accounts.find(a => a.id === (t.accountId || t.sourceAccountId));
    const cat = Data.categories.find(x => x.id === t.categoryId);
    lines.push([parts.date, parts.time, t.type, r.title, cat ? cat.name : '', acc ? acc.name : '', r.amount, Data.trip.currency, t.splitMode || '', t.note || ''].map(csvEscape).join(','));
  });
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, `kyu-${Data.trip.name.replace(/[^a-z0-9]+/gi, '-')}-report.csv`);
}

function exportPdfView() {
  const L = ledger();
  const c = ctx();
  const trip = Data.trip;
  const rows = Data.transactions.slice().sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).map(t => rowFor(t, c));
  const win = window.open('', '_blank');
  if (!win) { showToast('Allow pop-ups to export a PDF'); return; }
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(trip.name)} — kyu report</title>
    <style>
      body{font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#15232F;padding:32px;max-width:800px;margin:0 auto}
      h1{font-size:24px;margin-bottom:4px} .meta{color:#666;font-size:13px;margin-bottom:24px}
      table{width:100%;border-collapse:collapse;font-size:12px} th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #eee}
      th{background:#F5F1E8} .stats{display:flex;gap:24px;margin:20px 0;flex-wrap:wrap}
      .stat b{display:block;font-size:18px} .stat span{font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.05em}
      @media print { button{display:none} }
    </style></head><body>
    <h1>${escapeHtml(trip.name)}</h1>
    <div class="meta">${escapeHtml(trip.country || '')} · ${escapeHtml(trip.currency)} · ${escapeHtml(trip.timezone)} · ${escapeHtml(trip.startDate)} – ${escapeHtml(trip.endDate)}</div>
    <div class="stats">
      <div class="stat"><b>${fmtMoney(availableBalance(L, Data.accounts), trip.currency)}</b><span>Total balance</span></div>
      <div class="stat"><b>${fmtSigned(L.cf, trip.currency)}</b><span>Cash flow</span></div>
      <div class="stat"><b>${fmtMoney(L.mySpending, trip.currency)}</b><span>My spending</span></div>
      ${trip.totalBudget ? `<div class="stat"><b>${fmtMoney(trip.totalBudget - L.mySpending, trip.currency)}</b><span>Budget remaining</span></div>` : ''}
    </div>
    <button onclick="window.print()" style="padding:10px 16px;border-radius:10px;border:none;background:#15232F;color:#fff;cursor:pointer;margin-bottom:16px">Save as PDF</button>
    <table><thead><tr><th>Date</th><th>Title</th><th>Detail</th><th style="text-align:right">Amount</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${escapeHtml(dayLabel(r.occurredAt, trip.timezone))}</td><td>${escapeHtml(r.title)}</td><td>${escapeHtml(r.sub)}</td><td style="text-align:right">${r.amount}</td></tr>`).join('')}
    </tbody></table>
  </body></html>`);
  win.document.close();
}
