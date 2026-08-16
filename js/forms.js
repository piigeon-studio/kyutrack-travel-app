/* Money-amount sheets (expense, transport, settlement, top-up, funding,
   transfer, ATM, adjustment, pass purchase) and plain field sheets
   (trip create/edit, account/wallet add). Amounts are plain number inputs;
   validation happens on save (toast), not via a live-disabled button. */

const FORM_TITLES = {
  expense: 'Add expense', transport: 'Add trip', settlement: 'Settlement',
  topup: 'Top up', funding: 'Add funds', transfer: 'Transfer',
  atm: 'ATM withdrawal', adjustment: 'Balance adjustment', pass: 'Add pass'
};

function chip(label, active, action, extraAttrs) {
  return `<span class="chip ${active ? 'active' : ''}" data-action="${action.action}" ${Object.entries(action.data || {}).map(([k, v]) => `data-${k}="${escapeHtml(String(v))}"`).join(' ')} ${extraAttrs || ''}>${escapeHtml(label)}</span>`;
}

function paymentAccounts() { return Data.accounts.filter(a => a.isActive && (a.type === 'cash' || a.type === 'wise' || a.type === 'credit_card')); }
function transportPaymentAccounts() { return Data.accounts.filter(a => a.isActive && (a.type === 'cash' || a.type === 'wise' || a.type === 'transport_wallet')); }
function cashWiseAccounts() { return Data.accounts.filter(a => a.isActive && (a.type === 'cash' || a.type === 'wise')); }
function adjustableAccounts() { return Data.accounts.filter(a => a.isActive && a.type !== 'credit_card'); }
function otherTravelers() { return Data.travelers.filter(t => !t.isSelf); }
function availablePasses() { return Data.passes.filter(p => !p.isArchived); }

/* ================= Open / mutate form state ================= */

/** Center nav button: opens a chooser between the two record kinds users add most often. */
function quickAdd() {
  if (UI.tab === 'records') { quickAddPick('expense'); return; }
  if (UI.tab === 'transport') { quickAddPick('transport'); return; }
  UI.quickAddMenu = true;
  render();
}

function quickAddPick(kind) {
  UI.quickAddMenu = false;
  openForm(kind);
}

function openForm(kind, editId, prefill) {
  if (Data.trip.status !== 'active') { showToast('Trip is completed — reactivate it to add records.'); return; }
  UI.pageFormReturn = UI.sheet === 'settingsSub' ? { sheet: 'settingsSub', section: UI.settingsSection } : null;
  const now = nowZonedParts(Data.trip.timezone);
  const base = { kind, amount: 0, dateStr: now.date, timeStr: now.time, note: '', editingId: editId || null };
  const self = selfTraveler();

  if (editId) {
    const t = Data.transactions.find(x => x.id === editId);
    if (t) { UI.form = hydrateForm(kind, t); UI.sheet = 'form'; render(); return; }
  }

  if (kind === 'expense') {
    const firstCat = Data.categories.find(c => !c.isArchived && c.name !== 'Fees') || Data.categories[0];
    UI.form = { ...base, categoryId: firstCat ? firstCat.id : null, accountId: (paymentAccounts()[0] || {}).id, splitOn: false, taxMode: 'fixed', taxValue: 0, subs: {}, included: [self.id], receiptFile: null, receiptPreviewUrl: null };
  } else if (kind === 'transport') {
    const firstType = Data.transportTypes.find(t => !t.isArchived);
    UI.form = { ...base, from: '', to: '', transportTypeId: firstType ? firstType.id : null, payMode: 'account', accountId: (transportPaymentAccounts()[0] || {}).id, passId: (availablePasses()[0] || {}).id || null, splitOn: false, taxMode: 'percent', taxValue: 10, subs: {}, included: [self.id] };
  } else if (kind === 'settlement') {
    const L = ledger();
    const openR = otherTravelers().filter(t => (L.recv[t.id] || 0) > 0.5);
    const person = (prefill && prefill.travelerId && Data.travelers.find(t => t.id === prefill.travelerId)) || openR[0] || otherTravelers()[0];
    const open = person ? (L.recv[person.id] || 0) : 0;
    UI.form = { ...base, direction: 'they_paid_me', travelerId: person ? person.id : null, accountId: (cashWiseAccounts()[0] || {}).id, amount: (prefill && prefill.amount) || open };
  } else if (kind === 'topup') {
    const wallets = Data.accounts.filter(a => a.type === 'transport_wallet' && a.isActive);
    UI.form = { ...base, sourceAccountId: (cashWiseAccounts()[0] || {}).id, destinationAccountId: (prefill && prefill.destinationAccountId) || (wallets[0] || {}).id, feeAmount: 0, amount: 1000 };
  } else if (kind === 'funding') {
    UI.form = { ...base, accountId: (cashWiseAccounts()[0] || {}).id };
  } else if (kind === 'transfer') {
    const accs = cashWiseAccounts();
    UI.form = { ...base, sourceAccountId: (accs[0] || {}).id, destinationAccountId: (accs[1] || {}).id, feeAmount: 0 };
  } else if (kind === 'atm') {
    const wise = Data.accounts.find(a => a.type === 'wise'), cash = Data.accounts.find(a => a.type === 'cash');
    UI.form = { ...base, sourceAccountId: wise ? wise.id : null, destinationAccountId: cash ? cash.id : null, feeAmount: 0 };
  } else if (kind === 'adjustment') {
    UI.form = { ...base, accountId: (adjustableAccounts()[0] || {}).id, sign: 1, reason: '' };
  } else if (kind === 'pass') {
    UI.form = { ...base, name: '', accountId: (paymentAccounts()[0] || {}).id, startDate: Data.trip.startDate, endDate: Data.trip.endDate, color: nextPassColor() };
  }
  UI.sheet = 'form';
  render();
}

function subsFromArray(arr) { const o = {}; (arr || []).forEach(s => { o[s.travelerId] = s.subtotal; }); return o; }

function hydrateForm(kind, t) {
  const self = selfTraveler();
  const parts = utcIsoToZonedParts(t.occurredAt, Data.trip.timezone);
  const base = { kind, dateStr: parts.date, timeStr: parts.time, note: t.note || '', editingId: t.id, amount: t.amount || 0 };
  if (kind === 'expense') {
    const isTraveler = t.splitMode === 'self_share_other_paid';
    const isSplit = t.splitMode === 'full_user_paid';
    return { ...base, categoryId: t.categoryId, payerType: isTraveler ? 'traveler' : 'me', accountId: t.accountId || null, payerTravelerId: t.payerTravelerId || null,
      splitOn: isSplit, taxMode: t.taxMode || 'fixed', taxValue: t.taxValue || 0, subs: subsFromArray(t.subs), included: isSplit ? (t.subs || []).map(s => s.travelerId) : [self.id], title: t.title || '' };
  }
  if (kind === 'transport') {
    const isTraveler = t.splitMode === 'self_share_other_paid';
    const isSplit = t.splitMode === 'full_user_paid';
    return { ...base, amount: t.fareAmount || 0, from: t.from, to: t.to, transportTypeId: t.transportTypeId,
      payMode: t.coveredByPass ? 'pass' : (isTraveler ? 'traveler' : 'account'), accountId: t.accountId || null, passId: t.passId || (availablePasses()[0] || {}).id || null,
      payerTravelerId: t.payerTravelerId || null, splitOn: isSplit, taxMode: t.taxMode || 'percent', taxValue: t.taxValue || 10, subs: subsFromArray(t.subs), included: isSplit ? (t.subs || []).map(s => s.travelerId) : [self.id] };
  }
  if (kind === 'settlement') return { ...base, direction: t.direction, travelerId: t.travelerId, accountId: t.accountId, originalAmount: t.amount, originalTravelerId: t.travelerId, originalDirection: t.direction };
  if (kind === 'topup') return { ...base, sourceAccountId: t.sourceAccountId, destinationAccountId: t.destinationAccountId, feeAmount: t.feeAmount || 0 };
  if (kind === 'funding') return { ...base, accountId: t.accountId };
  if (kind === 'transfer') return { ...base, sourceAccountId: t.sourceAccountId, destinationAccountId: t.destinationAccountId, feeAmount: t.feeAmount || 0 };
  if (kind === 'atm') return { ...base, sourceAccountId: t.sourceAccountId, destinationAccountId: t.destinationAccountId, feeAmount: t.feeAmount || 0 };
  if (kind === 'adjustment') return { ...base, accountId: t.accountId, sign: t.delta < 0 ? -1 : 1, amount: Math.abs(t.delta), reason: t.reason || '' };
  return base;
}

function setForm(patch) { UI.form = { ...UI.form, ...patch }; render(); }

const TAX_MODE_DEFAULTS = { percent: 10, fixed: 400, none: 0 };
function setTaxMode(mode) { setForm({ taxMode: mode, taxValue: TAX_MODE_DEFAULTS[mode] }); }

function toggleSplit() {
  const f = UI.form; const self = selfTraveler();
  if (f.splitOn) setForm({ splitOn: false });
  else setForm({ splitOn: true, included: [self.id], payerType: 'me' });
}

/* ================= Shared sub-renderers ================= */

function optionRow(label, options) {
  return `<div class="form-row">
    <div class="field-label">${escapeHtml(label)}</div>
    <div class="chip-row" style="margin-top:9px">${options}</div>
  </div>`;
}

function colorSwatchRow(label, palette, selected, action, field) {
  const swatches = palette.map(c => `<button type="button" class="color-swatch${c === selected ? ' active' : ''}" style="background:${c}" data-action="${action}" data-field="${field}" data-value="${c}" aria-label="${c}"></button>`).join('');
  return `<div class="form-row">
    <div class="field-label">${escapeHtml(label)}</div>
    <div class="chip-row" style="margin-top:9px;gap:10px;padding:8px">${swatches}</div>
  </div>`;
}

/** Checkbox + plain-input subtotal editor shared by expense and transport
    splits. Transport keeps its percent/fixed/none tax chips; expense passes
    its own tax input separately (see splitEditorHtmlPlain). */
function splitEditorHtmlTransport(f, parts) {
  return `
    <div class="split-block">
      <div class="field-label">Subtotals per traveler</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">
        ${Data.travelers.map(t => {
          const inc = f.included.indexOf(t.id) >= 0;
          const p = parts.find(x => x.travelerId === t.id);
          return `<div class="participant-row ${inc ? '' : 'excluded'}" style="cursor:default">
            <input type="checkbox" data-action="toggleSplitParticipant" data-id="${t.id}" ${inc ? 'checked' : ''} ${t.isSelf ? 'disabled' : ''} style="width:19px;height:19px;flex:none;accent-color:var(--ink);cursor:${t.isSelf ? 'default' : 'pointer'}">
            <span class="avatar" style="width:26px;height:26px;background:${t.color}">${escapeHtml(t.name[0])}</span>
            <div style="flex:1;min-width:0">
              <div class="row-title">${escapeHtml(t.name)}</div>
              ${inc && p ? `<div class="row-sub" style="margin-top:5px;font-size:10px">tax ${fmtMoney(p.tax, Data.trip.currency)} → share ${fmtMoney(p.share, Data.trip.currency)}</div>` : ''}
            </div>
            ${inc ? `<input type="number" min="0" value="${f.subs[t.id] || 0}" data-bind="subs.${t.id}" style="width:88px;flex:none;text-align:right;border:1px solid rgba(21,35,47,.14);border-radius:12px;padding:8px 10px;font:700 13px/1 var(--font);background:#fff">` : ''}
          </div>`;
        }).join('')}
      </div>
      <div class="chip-row" style="margin-top:14px">
        ${chip('Tax 10%', f.taxMode === 'percent', { action: 'setTaxMode', data: { mode: 'percent' } })}
        ${chip('Fixed ¥400', f.taxMode === 'fixed', { action: 'setTaxMode', data: { mode: 'fixed' } })}
        ${chip('No tax', f.taxMode === 'none', { action: 'setTaxMode', data: { mode: 'none' } })}
      </div>
    </div>`;
}

function taxSummaryHtml(tax, mine, others) {
  return `<div class="tax-summary">
    <div class="tax-summary-row"><span>Tax allocated</span><b>${fmtMoney(tax, Data.trip.currency)}</b></div>
    <div class="tax-summary-row"><span>Your total</span><b>${fmtMoney(mine, Data.trip.currency)}</b></div>
    <div class="tax-summary-row"><span>Others owe you</span><b>${fmtMoney(others, Data.trip.currency)}</b></div>
  </div>`;
}

function saveButtonHtml(label, action, small) {
  if (small) {
    return `<button class="btn-add" style="margin-top:14px" data-action="${action || 'saveForm'}">
      <span>${escapeHtml(label)}</span>
    </button>`;
  }
  return `<button class="cta cta-ink" style="margin-top:14px" data-action="${action || 'saveForm'}">
    <span class="cta-label">${escapeHtml(label)}</span>
  </button>`;
}

function dateTimeRowHtml(f) {
  return `<div class="form-row">
    <div class="field-label">Date</div>
    <input type="date" value="${f.dateStr}" data-bind="dateStr" style="margin-top:9px;width:100%;border:1px solid rgba(21,35,47,.14);border-radius:14px;padding:10px 12px;font:600 13px/1 var(--font);background:#fff">
  </div>`;
}

function noteRowHtml(f) {
  return `<div class="form-row">
    <div class="field-label">Note (optional)</div>
    <textarea data-bind="note" placeholder="Add a note" style="margin-top:9px;width:100%;border:1px solid rgba(21,35,47,.14);border-radius:16px;padding:11px 13px;font:600 13px/1.4 var(--font);background:#fff;min-height:52px">${escapeHtml(f.note || '')}</textarea>
  </div>`;
}

/* ================= Main money-form router ================= */

function renderMoneyFormSheet() {
  const f = UI.form;
  const base = FORM_TITLES[f.kind] || '';
  const title = f.editingId ? 'Edit ' + base.replace(/^(Add|Buy)\s+/i, '') : base;
  let body = '';
  if (f.kind === 'expense') body = expenseFormBody(f);
  else if (f.kind === 'transport') body = transportFormBody(f);
  else if (f.kind === 'settlement') body = settlementFormBody(f);
  else if (f.kind === 'topup') body = topupFormBody(f);
  else if (f.kind === 'funding') body = fundingFormBody(f);
  else if (f.kind === 'transfer' || f.kind === 'atm') body = transferFormBody(f);
  else if (f.kind === 'adjustment') body = adjustmentFormBody(f);
  else if (f.kind === 'pass') body = passFormBody(f);
  return sheetShell(title, body);
}

/* ---- Expense ---- */

function toggleSplitParticipant(travelerId) {
  const f = UI.form; const self = selfTraveler();
  if (travelerId === self.id) return;
  if (f.included.indexOf(travelerId) < 0) setForm({ included: f.included.concat([travelerId]) });
  else setForm({ included: f.included.filter(x => x !== travelerId), subs: { ...f.subs, [travelerId]: 0 } });
}

function splitRemainingHtml(remaining) {
  if (remaining === 0) return '';
  const label = remaining > 0
    ? fmtMoney(remaining, Data.trip.currency) + ' left to allocate'
    : fmtMoney(-remaining, Data.trip.currency) + ' over';
  return `<div class="warning-card" style="margin-top:12px">${label}</div>`;
}

/** Recomputes and patches just the #split-remaining / #split-tax-summary
    nodes in place — avoids a full render() while typing, which would race
    the next tap/blur and could swallow clicks on whatever's rendered next
    to a live-bound input. */
function updateSplitRemaining() {
  const f = UI.form;
  if (!f || f.kind !== 'expense') return;
  const self = selfTraveler();
  const amt = Number(f.amount) || 0;
  const subs = f.included.map(id => ({ travelerId: id, subtotal: Number(f.subs[id]) || 0 }));
  const sum = subs.reduce((a, b) => a + b.subtotal, 0);
  const tax = Number(f.taxValue) || 0;

  const remainingEl = document.getElementById('split-remaining');
  if (remainingEl) remainingEl.innerHTML = splitRemainingHtml(amt - sum - tax);

  const summaryEl = document.getElementById('split-tax-summary');
  if (summaryEl) {
    const parts = allocateTax(subs, tax);
    const mine = (parts.find(p => p.travelerId === self.id) || { share: 0 }).share;
    const others = sum + tax - mine;
    summaryEl.innerHTML = taxSummaryHtml(tax, mine, others);
  }
}

function splitEditorHtmlPlain(f, amt, sum, tax) {
  return `
    <div class="split-block">
      <div class="field-label">Subtotals per traveler</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">
        ${Data.travelers.map(t => {
          const inc = f.included.indexOf(t.id) >= 0;
          return `<div class="participant-row ${inc ? '' : 'excluded'}" style="cursor:default">
            <input type="checkbox" data-action="toggleSplitParticipant" data-id="${t.id}" ${inc ? 'checked' : ''} ${t.isSelf ? 'disabled' : ''} style="width:19px;height:19px;flex:none;accent-color:var(--ink);cursor:${t.isSelf ? 'default' : 'pointer'}">
            <span class="avatar" style="width:26px;height:26px;background:${t.color}">${escapeHtml(t.name[0])}</span>
            <div class="row-title" style="flex:1;min-width:0">${escapeHtml(t.name)}</div>
            ${inc ? `<input type="number" min="0" value="${f.subs[t.id] || 0}" data-bind="subs.${t.id}" data-recalc="split" style="width:88px;flex:none;text-align:right;border:1px solid rgba(21,35,47,.14);border-radius:12px;padding:8px 10px;font:700 13px/1 var(--font);background:#fff">` : ''}
          </div>`;
        }).join('')}
      </div>
      <div class="form-row" style="margin-top:14px">
        <div class="field-label">Tax (optional)</div>
        <input type="number" min="0" value="${f.taxValue || 0}" data-bind="taxValue" data-recalc="split" style="margin-top:9px;width:100%;border:1px solid rgba(21,35,47,.14);border-radius:14px;padding:10px 12px;font:700 14px/1 var(--font);background:#fff;box-sizing:border-box">
      </div>
      <div id="split-remaining">${splitRemainingHtml(amt - sum - tax)}</div>
    </div>`;
}

function receiptPickerHtml(f) {
  return `<div class="form-row">
    <div class="field-label">Receipt (optional)</div>
    <div style="display:flex;gap:8px;margin-top:10px">
      ${f.receiptPreviewUrl ? `
        <div style="position:relative">
          <img src="${f.receiptPreviewUrl}" style="width:64px;height:64px;object-fit:cover;border-radius:12px;border:1px solid rgba(21,35,47,.1)">
          <button data-action="removePendingReceipt" style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;background:var(--ink);color:#fff;border:none;font-size:11px;cursor:pointer">${icon('close', 10)}</button>
        </div>` : `
        <label style="width:64px;height:64px;border-radius:12px;border:1px dashed rgba(21,35,47,.25);display:flex;align-items:center;justify-content:center;cursor:pointer;color:rgba(21,35,47,.4)">
          ${icon('camera', 20)}
          <input type="file" accept="image/*" capture="environment" data-pending-receipt="1" style="display:none">
        </label>`}
    </div>
  </div>`;
}

function expenseFormBody(f) {
  const self = selfTraveler();
  const amt = Number(f.amount) || 0;
  const subs = f.included.map(id => ({ travelerId: id, subtotal: Number(f.subs[id]) || 0 }));
  const sum = subs.reduce((a, b) => a + b.subtotal, 0);
  const tax = Number(f.taxValue) || 0;
  const parts = allocateTax(subs, tax);
  const mine = (parts.find(p => p.travelerId === self.id) || { share: 0 }).share;
  const others = sum + tax - mine;

  const acc = f.accountId ? Data.accounts.find(a => a.id === f.accountId) : null;

  const saveLabel = 'Save';

  let ledgerHint;
  if (f.splitOn) ledgerHint = 'Account and cash flow move by the full amount; budget only by your share.';
  else ledgerHint = (acc && acc.type === 'credit_card') ? 'Card spending and budget move; Cash and Wise do not.' : 'Account, cash flow and budget all move by the full amount.';

  return `
    ${dateTimeRowHtml(f)}

    ${optionRow('Category', Data.categories.filter(c => !c.isArchived).map(c => chip(c.name, f.categoryId === c.id, { action: 'setForm', data: { field: 'categoryId', value: c.id } })).join(''))}

    <div class="form-row">
      <div class="field-label">Amount</div>
      <input type="number" min="0" value="${f.amount}" data-bind="amount" data-recalc="split" style="margin-top:9px;width:100%;border:1px solid rgba(21,35,47,.14);border-radius:14px;padding:10px 12px;font:700 15px/1 var(--font);background:#fff;box-sizing:border-box">
    </div>

    ${optionRow('Paid with', paymentAccounts().map(a => chip(a.name + (a.type === 'credit_card' ? ' (card)' : ''), f.accountId === a.id, { action: 'setForm', data: { field: 'accountId', value: a.id } })).join(''))}

    <button class="split-toggle" data-action="toggleSplit">
      <div style="flex:1;min-width:0">
        <div class="row-title">Split</div>
      </div>
      <div class="switch-track ${f.splitOn ? 'on' : ''}"><div class="switch-knob"></div></div>
    </button>

    ${f.splitOn ? splitEditorHtmlPlain(f, amt, sum, tax) + `<div id="split-tax-summary">${taxSummaryHtml(tax, mine, others)}</div>` : ''}

    ${!f.editingId ? receiptPickerHtml(f) : ''}

    ${noteRowHtml(f)}

    ${saveButtonHtml(saveLabel)}
    <div class="ledger-hint">${ledgerHint}</div>
  `;
}

/* ---- Transport ---- */

function transportFormBody(f) {
  const self = selfTraveler();
  const subs = f.included.map(id => ({ travelerId: id, subtotal: f.subs[id] || 0 }));
  const sum = subs.reduce((a, b) => a + b.subtotal, 0);
  const tax = computeTax(sum, f.taxMode, f.taxValue);
  const parts = allocateTax(subs, tax);
  const total = sum + tax;
  const mine = (parts.find(p => p.travelerId === self.id) || { share: 0 }).share;
  const others = total - mine;

  const acc = f.accountId ? Data.accounts.find(a => a.id === f.accountId) : null;
  const L = ledger();
  const walletShort = f.payMode === 'account' && acc && acc.type === 'transport_wallet' && f.amount > (L.bal[acc.id] || 0);
  const activePass = Data.passes.find(p => p.id === f.passId);
  const passOutOfRange = f.payMode === 'pass' && activePass && (f.dateStr < activePass.startDate || f.dateStr > activePass.endDate);

  const saveLabel = 'Save trip';

  let ledgerHint;
  if (f.payMode === 'pass') ledgerHint = 'No account moves. Pass value used increases by the fare.';
  else if (f.splitOn) ledgerHint = 'Wallet/account and cash flow move by the full fare; budget only by your share.';
  else ledgerHint = 'Wallet decreases; cash flow and budget move by the fare.';

  return `
    <div class="form-row" style="display:flex;gap:10px">
      <div style="flex:1;min-width:0"><div class="field-label">From</div><input type="text" data-bind="from" value="${escapeHtml(f.from)}" placeholder="Shibuya" style="margin-top:9px;width:100%;border:1px solid rgba(21,35,47,.14);border-radius:14px;padding:10px 12px;font:600 13px/1 var(--font);background:#fff"></div>
      <div style="flex:1;min-width:0"><div class="field-label">To</div><input type="text" data-bind="to" value="${escapeHtml(f.to)}" placeholder="Shinjuku" style="margin-top:9px;width:100%;border:1px solid rgba(21,35,47,.14);border-radius:14px;padding:10px 12px;font:600 13px/1 var(--font);background:#fff"></div>
    </div>

    ${optionRow('Type', Data.transportTypes.filter(t => !t.isArchived).map(t => chip(t.name, f.transportTypeId === t.id, { action: 'setForm', data: { field: 'transportTypeId', value: t.id } })).join(''))}

    ${f.splitOn && f.payMode === 'account' ? `
    <div class="form-row">
      <div class="field-label">Invoice total (derived)</div>
      <div style="margin-top:9px;width:100%;border:1px solid rgba(21,35,47,.14);border-radius:14px;padding:10px 12px;font:700 15px/1 var(--font);background:var(--sand);box-sizing:border-box">${fmtMoney(total, Data.trip.currency)}</div>
      <div class="row-sub" style="margin-top:8px">Your share ${fmtMoney(mine, Data.trip.currency)} · others ${fmtMoney(others, Data.trip.currency)}</div>
    </div>` : `
    <div class="form-row">
      <div class="field-label">${f.payMode === 'pass' ? 'Comparable normal price (optional)' : 'Fare'}</div>
      <input type="number" min="0" value="${f.amount}" data-bind="amount" style="margin-top:9px;width:100%;border:1px solid rgba(21,35,47,.14);border-radius:14px;padding:10px 12px;font:700 15px/1 var(--font);background:#fff;box-sizing:border-box">
      ${f.payMode === 'pass' ? `<div class="row-sub" style="margin-top:8px">Only needed if you want this ride counted in the pass's savings estimate — leave blank to just log the trip</div>` : ''}
    </div>`}

    ${optionRow('Paid by', transportPaymentAccounts().map(a => chip(a.name, f.payMode === 'account' && f.accountId === a.id, { action: 'setForm', data: { field: 'accountId', value: a.id } })).join('') +
      (availablePasses().length ? chip('Covered by pass', f.payMode === 'pass', { action: 'setForm', data: { field: 'payMode', value: 'pass' } }) : ''))}
    ${f.payMode === 'pass' && availablePasses().length > 1 ? optionRow('Which pass', availablePasses().map(p => chip(p.name, f.passId === p.id, { action: 'setForm', data: { field: 'passId', value: p.id } })).join('')) : ''}

    ${f.payMode === 'account' ? `
    <button class="split-toggle" data-action="toggleSplit">
      <div style="flex:1;min-width:0">
        <div class="row-title">Split this fare</div>
      </div>
      <div class="switch-track ${f.splitOn ? 'on' : ''}"><div class="switch-knob"></div></div>
    </button>` : ''}
    ${f.splitOn && f.payMode === 'account' ? splitEditorHtmlTransport(f, parts) + taxSummaryHtml(tax, mine, others) : ''}

    ${walletShort ? `<div class="warning-card">${escapeHtml(acc.name)} balance is ${fmtMoney(L.bal[acc.id] || 0, Data.trip.currency)} — top up first</div>` : ''}
    ${passOutOfRange ? `<div class="warning-card">This pass isn't active on the selected date — check before saving</div>` : ''}

    ${dateTimeRowHtml(f)}
    ${noteRowHtml(f)}

    ${saveButtonHtml(saveLabel)}
    <div class="ledger-hint">${ledgerHint}</div>
  `;
}

/* ---- Settlement ---- */

// When editing an existing settlement, Data.transactions still holds its old amount,
// so L.recv already has that amount netted out — add it back to get the balance as it
// stood before this settlement, which is what the user should be free to adjust within.
function settlementOpenBalance(f, L) {
  const raw = f.travelerId ? (L.recv[f.travelerId] || 0) : 0;
  const editingSameDebt = f.editingId && f.travelerId === f.originalTravelerId && f.direction === f.originalDirection;
  return raw + (editingSameDebt ? (f.originalAmount || 0) : 0);
}

function settlementFormBody(f) {
  const L = ledger();
  const open = settlementOpenBalance(f, L);
  return `
    <div class="form-row">
      <div class="field-label">They paid me</div>
      <input type="number" min="0" value="${f.amount}" data-bind="amount" style="margin-top:9px;width:100%;border:1px solid rgba(21,35,47,.14);border-radius:14px;padding:10px 12px;font:700 15px/1 var(--font);background:#fff;box-sizing:border-box">
      <div class="row-sub" style="margin-top:8px">Open balance ${fmtMoney(open, Data.trip.currency)}</div>
    </div>
    ${optionRow('Person', otherTravelers().map(t => chip(t.name, f.travelerId === t.id, { action: 'setForm', data: { field: 'travelerId', value: t.id } })).join(''))}
    ${optionRow('Account', cashWiseAccounts().map(a => chip(a.name, f.accountId === a.id, { action: 'setForm', data: { field: 'accountId', value: a.id } })).join(''))}
    ${noteRowHtml(f)}
    ${f.amount > open + 0.5 ? `<div class="warning-card">Over-settlement blocked — max ${fmtMoney(open, Data.trip.currency)}</div>` : ''}
    ${saveButtonHtml('Save settlement')}
    <div class="ledger-hint">Account, cash flow and the matching debt move. Spending and budget never do.</div>
  `;
}

/* ---- Top up ---- */

function topupFormBody(f) {
  const L = ledger();
  const wallets = Data.accounts.filter(a => a.type === 'transport_wallet' && a.isActive);
  const dst = Data.accounts.find(a => a.id === f.destinationAccountId);
  return `
    <div class="form-row">
      <div class="field-label">Top-up amount</div>
      <input type="number" min="0" value="${f.amount}" data-bind="amount" style="margin-top:9px;width:100%;border:1px solid rgba(21,35,47,.14);border-radius:14px;padding:10px 12px;font:700 15px/1 var(--font);background:#fff;box-sizing:border-box">
      <div class="row-sub" style="margin-top:8px">${dst ? dst.name : 'Wallet'} now ${fmtMoney(dst ? (L.bal[dst.id] || 0) : 0, Data.trip.currency)}</div>
    </div>
    ${optionRow('From', cashWiseAccounts().map(a => chip(a.name, f.sourceAccountId === a.id, { action: 'setForm', data: { field: 'sourceAccountId', value: a.id } })).join(''))}
    ${wallets.length > 1 ? optionRow('To', wallets.map(a => chip(a.name, f.destinationAccountId === a.id, { action: 'setForm', data: { field: 'destinationAccountId', value: a.id } })).join('')) : ''}
    ${dateTimeRowHtml(f)}
    ${saveButtonHtml('Top up')}
    <div class="ledger-hint">Transfer only — no spending, no net cash flow.</div>
  `;
}

/* ---- Funding ---- */

function fundingFormBody(f) {
  return `
    <div class="form-row">
      <div class="field-label">Amount to add</div>
      <input type="number" min="0" value="${f.amount}" data-bind="amount" style="margin-top:9px;width:100%;border:1px solid rgba(21,35,47,.14);border-radius:14px;padding:10px 12px;font:700 15px/1 var(--font);background:#fff;box-sizing:border-box">
    </div>
    ${optionRow('To', cashWiseAccounts().map(a => chip(a.name, f.accountId === a.id, { action: 'setForm', data: { field: 'accountId', value: a.id } })).join(''))}
    ${dateTimeRowHtml(f)}
    ${noteRowHtml(f)}
    ${saveButtonHtml('Add funds')}
    <div class="ledger-hint">Account and cash flow increase. Spending and budget don't change.</div>
  `;
}

/* ---- Transfer / ATM ---- */

function transferFormBody(f) {
  const isAtm = f.kind === 'atm';
  const accs = cashWiseAccounts();
  const src = Data.accounts.find(a => a.id === f.sourceAccountId);
  const dst = Data.accounts.find(a => a.id === f.destinationAccountId);
  return `
    <div class="form-row">
      <div class="field-label">Amount</div>
      <input type="number" min="0" value="${f.amount}" data-bind="amount" style="margin-top:9px;width:100%;border:1px solid rgba(21,35,47,.14);border-radius:14px;padding:10px 12px;font:700 15px/1 var(--font);background:#fff;box-sizing:border-box">
      <div class="row-sub" style="margin-top:8px">${src ? src.name : '—'} → ${dst ? dst.name : '—'}</div>
    </div>
    ${!isAtm ? optionRow('From', accs.map(a => chip(a.name, f.sourceAccountId === a.id, { action: 'setForm', data: { field: 'sourceAccountId', value: a.id } })).join('')) : ''}
    ${!isAtm ? optionRow('To', accs.map(a => chip(a.name, f.destinationAccountId === a.id, { action: 'setForm', data: { field: 'destinationAccountId', value: a.id } })).join('')) : ''}
    <div class="form-row">
      <div class="field-label">Fee (optional)</div>
      <input type="number" min="0" value="${f.feeAmount || 0}" data-bind="feeAmount" style="margin-top:9px;width:100%;border:1px solid rgba(21,35,47,.14);border-radius:14px;padding:10px 12px;font:700 14px/1 var(--font);background:#fff;box-sizing:border-box">
    </div>
    ${dateTimeRowHtml(f)}
    ${saveButtonHtml(isAtm ? 'Withdraw' : 'Transfer')}
    <div class="ledger-hint">Principal nets to zero in cash flow; only the fee (if any) is spending.</div>
  `;
}

/* ---- Balance adjustment ---- */

function adjustmentFormBody(f) {
  const acc = Data.accounts.find(a => a.id === f.accountId);
  const L = ledger();
  const delta = (f.sign || 1) * (Number(f.amount) || 0);
  return `
    <div class="form-row">
      <div class="field-label">Adjustment amount</div>
      <input type="number" min="0" value="${f.amount}" data-bind="amount" style="margin-top:9px;width:100%;border:1px solid rgba(21,35,47,.14);border-radius:14px;padding:10px 12px;font:700 15px/1 var(--font);background:#fff;box-sizing:border-box">
      <div class="row-sub" style="margin-top:8px">${fmtSignedBig(delta, Data.trip.currency)} · ${acc ? acc.name : '—'} now ${fmtMoney(acc ? (L.bal[acc.id] || 0) : 0, Data.trip.currency)} → ${fmtMoney((acc ? (L.bal[acc.id] || 0) : 0) + delta, Data.trip.currency)}</div>
    </div>
    ${optionRow('Account', adjustableAccounts().map(a => chip(a.name, f.accountId === a.id, { action: 'setForm', data: { field: 'accountId', value: a.id } })).join(''))}
    ${optionRow('Direction', [{ v: 1, l: 'Increase' }, { v: -1, l: 'Decrease' }].map(o => chip(o.l, f.sign === o.v, { action: 'setForm', data: { field: 'sign', value: o.v } })).join(''))}
    <div class="form-row">
      <div class="field-label">Reason (required)</div>
      <input type="text" data-bind="reason" value="${escapeHtml(f.reason || '')}" placeholder="e.g. lost receipt reconciliation" style="margin-top:9px;width:100%;border:1px solid rgba(21,35,47,.14);border-radius:14px;padding:10px 12px;font:600 13px/1 var(--font);background:#fff">
    </div>
    ${dateTimeRowHtml(f)}
    ${saveButtonHtml('Save adjustment')}
    <div class="ledger-hint">Account and cash flow change by the difference. Spending, budget and splits don't change.</div>
  `;
}

/* ---- Pass purchase ---- */

function passFormBody(f) {
  return `
    <div class="form-row">
      <div class="field-label">Purchase price</div>
      <input type="number" min="0" value="${f.amount}" data-bind="amount" style="margin-top:9px;width:100%;border:1px solid rgba(21,35,47,.14);border-radius:14px;padding:10px 12px;font:700 15px/1 var(--font);background:#fff;box-sizing:border-box">
    </div>
    <div class="form-row">
      <div class="field-label">Pass name</div>
      <input type="text" data-bind="name" value="${escapeHtml(f.name || '')}" placeholder="JR Pass 7-Day" style="margin-top:9px;width:100%;border:1px solid rgba(21,35,47,.14);border-radius:14px;padding:10px 12px;font:600 13px/1 var(--font);background:#fff">
    </div>
    ${optionRow('Paid with', paymentAccounts().map(a => chip(a.name, f.accountId === a.id, { action: 'setForm', data: { field: 'accountId', value: a.id } })).join(''))}
    <div class="form-row"><div class="field-label">Start date</div><input type="date" value="${f.startDate}" data-bind="startDate" style="margin-top:9px;width:100%;border:1px solid rgba(21,35,47,.14);border-radius:14px;padding:10px 12px;font:600 13px/1 var(--font);background:#fff"></div>
    <div class="form-row"><div class="field-label">End date</div><input type="date" value="${f.endDate}" data-bind="endDate" style="margin-top:9px;width:100%;border:1px solid rgba(21,35,47,.14);border-radius:14px;padding:10px 12px;font:600 13px/1 var(--font);background:#fff"></div>
    ${colorSwatchRow('Pass color', TRANSPORT_CARD_PALETTE, f.color, 'setForm', 'color')}
    ${saveButtonHtml('Buy pass')}
    <div class="ledger-hint">A real personal expense — cash flow, spending and budget all move now.</div>
  `;
}

function passEditFormBody(f) {
  return `
    ${pageField('Pass name', 'pf-name', { value: f.name })}
    ${pageField('Start date', 'pf-start', { type: 'date', value: f.startDate, bind: 'startDate' })}
    ${pageField('End date', 'pf-end', { type: 'date', value: f.endDate, bind: 'endDate' })}
    ${colorSwatchRow('Pass color', TRANSPORT_CARD_PALETTE, f.color, 'pageChip', 'color')}
    ${saveButtonHtml('Save changes', 'savePageForm', true)}
  `;
}

/* ================= Save ================= */

function autoExpenseTitle(f) {
  if (f.title) return f.title;
  const cat = Data.categories.find(c => c.id === f.categoryId);
  const catName = cat ? cat.name : 'Expense';
  if (f.splitOn) return catName + ' · split';
  return catName + ' expense';
}

async function saveForm() {
  const f = UI.form;
  const occurredAt = zonedToUtcIso(f.dateStr, f.timeStr, Data.trip.timezone);
  let patch = null;

  if (f.kind === 'expense') {
    const title = autoExpenseTitle(f);
    const amt = Number(f.amount) || 0;
    if (f.splitOn) {
      if (!amt) { showToast('Amount is required'); return; }
      const subs = f.included.map(id => ({ travelerId: id, subtotal: Number(f.subs[id]) || 0 }));
      const sum = subs.reduce((a, b) => a + b.subtotal, 0);
      const tax = Number(f.taxValue) || 0;
      if (sum + tax !== amt) { showToast('Subtotals + tax must add up to ' + fmtMoney(amt, Data.trip.currency)); return; }
      patch = { type: 'expense', occurredAt, note: f.note, categoryId: f.categoryId, accountId: f.accountId, splitMode: 'full_user_paid', taxMode: 'fixed', taxValue: tax, subs, amount: amt, title };
    } else {
      if (!amt) { showToast('Amount is required'); return; }
      if (!f.accountId) { showToast('Choose an account'); return; }
      patch = { type: 'expense', occurredAt, note: f.note, categoryId: f.categoryId, accountId: f.accountId, splitMode: 'none', amount: amt, title };
    }
  } else if (f.kind === 'transport') {
    const amt = Number(f.amount) || 0;
    if (!f.from || !f.to) { showToast('From and to are required'); return; }
    const common = { type: 'transport', occurredAt, note: f.note, from: f.from, to: f.to, transportTypeId: f.transportTypeId, transportCategoryId: (Data.categories.find(c => c.name === 'Transport') || {}).id };
    if (f.payMode === 'pass') {
      if (!f.passId) { showToast('Choose which pass covered this'); return; }
      patch = { ...common, coveredByPass: true, passId: f.passId, fareAmount: amt, splitMode: 'none' };
    } else if (f.splitOn) {
      const subs = f.included.map(id => ({ travelerId: id, subtotal: Number(f.subs[id]) || 0 }));
      const sum = subs.reduce((a, b) => a + b.subtotal, 0);
      if (!sum || !f.accountId) { showToast('Enter at least one subtotal'); return; }
      const tax = computeTax(sum, f.taxMode, f.taxValue);
      patch = { ...common, coveredByPass: false, accountId: f.accountId, splitMode: 'full_user_paid', taxMode: f.taxMode, taxValue: f.taxValue, subs, fareAmount: sum + tax };
    } else {
      if (!amt || !f.accountId) { showToast('Fare and account are required'); return; }
      patch = { ...common, coveredByPass: false, accountId: f.accountId, splitMode: 'none', fareAmount: amt };
    }
  } else if (f.kind === 'settlement') {
    const L = ledger();
    const amt = Number(f.amount) || 0;
    const open = settlementOpenBalance(f, L);
    if (!amt || !f.travelerId || !f.accountId) { showToast('Amount, person and account are required'); return; }
    if (amt > open + 0.5) { showToast('Over-settlement blocked — max ' + fmtMoney(open, Data.trip.currency)); return; }
    patch = { type: 'settlement', occurredAt, note: f.note, direction: 'they_paid_me', travelerId: f.travelerId, accountId: f.accountId, amount: amt };
  } else if (f.kind === 'topup') {
    const amt = Number(f.amount) || 0;
    if (!amt || !f.sourceAccountId || !f.destinationAccountId) { showToast('Amount and accounts are required'); return; }
    patch = { type: 'transfer', subtype: 'top_up', occurredAt, note: f.note, sourceAccountId: f.sourceAccountId, destinationAccountId: f.destinationAccountId, amount: amt, feeAmount: Number(f.feeAmount) || 0 };
  } else if (f.kind === 'funding') {
    const amt = Number(f.amount) || 0;
    if (!amt || !f.accountId) { showToast('Amount and account are required'); return; }
    patch = { type: 'funding', occurredAt, note: f.note, accountId: f.accountId, amount: amt };
  } else if (f.kind === 'transfer' || f.kind === 'atm') {
    const amt = Number(f.amount) || 0;
    if (!amt || !f.sourceAccountId || !f.destinationAccountId || f.sourceAccountId === f.destinationAccountId) { showToast('Amount and two different accounts are required'); return; }
    patch = { type: 'transfer', subtype: f.kind === 'atm' ? 'atm_withdrawal' : 'transfer', occurredAt, note: f.note, sourceAccountId: f.sourceAccountId, destinationAccountId: f.destinationAccountId, amount: amt, feeAmount: Number(f.feeAmount) || 0 };
  } else if (f.kind === 'adjustment') {
    const amt = Number(f.amount) || 0;
    if (!amt || !f.accountId || !f.reason) { showToast('Amount, account and reason are required'); return; }
    patch = { type: 'adjustment', occurredAt, accountId: f.accountId, delta: (f.sign || 1) * amt, reason: f.reason };
  } else if (f.kind === 'pass') {
    const amt = Number(f.amount) || 0;
    if (!amt || !f.name || !f.accountId) { showToast('Price, name and account are required'); return; }
    const pass = await addPass({ name: f.name, purchasePrice: amt, startDate: f.startDate, endDate: f.endDate, color: f.color });
    patch = { type: 'pass_purchase', occurredAt, note: f.note, passId: pass.id, accountId: f.accountId, amount: amt, title: f.name, transportCategoryId: (Data.categories.find(c => c.name === 'Transport') || {}).id, splitMode: 'none' };
  }

  if (!patch) return;
  let savedTxn;
  if (f.editingId) savedTxn = await updateTransaction(f.editingId, patch);
  else savedTxn = await addTransaction(patch);
  if (f.kind === 'expense' && !f.editingId && f.receiptFile) {
    await addReceipt(savedTxn.id, f.receiptFile);
  }

  if (UI.pageFormReturn) {
    closePageForm();
  } else {
    const landingTab = f.kind === 'settlement' ? 'split' : (f.kind === 'expense' ? 'records' : (f.kind === 'pass' ? 'transport' : (f.kind === 'topup' ? 'transport' : UI.tab)));
    UI.sheet = null; UI.form = null; UI.tab = landingTab;
  }
  render();
}

/* ================= Page forms (plain field sheets) ================= */

const PAGE_FORM_TITLES = {
  trip: 'New trip', tripInfo: 'Edit trip', account: 'Add credit card', wallet: 'Add transport card',
  newTraveler: 'Add traveler', newCategory: 'Add category', newTransportType: 'Add transport type',
  editTraveler: 'Rename traveler', editWallet: 'Edit transport card', editPass: 'Edit pass'
};

function openPageForm(kind, editId) {
  UI.pageFormReturn = UI.sheet === 'settingsSub' ? { sheet: 'settingsSub', section: UI.settingsSection } : null;
  if (kind === 'trip') {
    const now = nowZonedParts('Asia/Tokyo');
    UI.pageForm = { kind, name: '', country: '', currency: 'JPY', timezone: 'Asia/Tokyo', startDate: now.date, endDate: now.date, totalBudget: 0, startingCash: 0, startingWise: 0 };
  } else if (kind === 'tripInfo') {
    const t = Data.trip;
    UI.pageForm = { kind, name: t.name, country: t.country, currency: t.currency, timezone: t.timezone, startDate: t.startDate, endDate: t.endDate, totalBudget: t.totalBudget || 0 };
  } else if (kind === 'account') {
    UI.pageForm = { kind, type: 'credit_card', name: '', startingBalance: 0 };
  } else if (kind === 'wallet') {
    UI.pageForm = { kind, type: 'transport_wallet', name: '', startingBalance: 0, color: nextTransportCardColor() };
  } else if (kind === 'editWallet') {
    const a = Data.accounts.find(x => x.id === editId);
    UI.pageForm = { kind, id: editId, type: 'transport_wallet', name: a ? a.name : '', color: a ? a.color : TRANSPORT_CARD_PALETTE[0] };
  } else if (kind === 'editPass') {
    const p = Data.passes.find(x => x.id === editId);
    UI.pageForm = { kind, id: editId, name: p ? p.name : '', startDate: p ? p.startDate : '', endDate: p ? p.endDate : '', color: p ? p.color : TRANSPORT_CARD_PALETTE[0] };
  } else if (kind === 'newTraveler' || kind === 'newCategory' || kind === 'newTransportType') {
    UI.pageForm = { kind, name: '' };
  } else if (kind === 'editTraveler') {
    const t = Data.travelers.find(x => x.id === editId);
    UI.pageForm = { kind, id: editId, name: t ? t.name : '' };
  }
  UI.sheet = 'pageForm';
  render();
}
function setPageForm(patch) { UI.pageForm = { ...UI.pageForm, ...patch }; render(); }

function pageField(label, id, opts) {
  opts = opts || {};
  const type = opts.type || 'text';
  const value = opts.value != null ? opts.value : '';
  return `<div class="field">
    <div class="field-label">${escapeHtml(label)}</div>
    <input type="${type}" id="${id}" data-bind="${opts.bind || id.replace(/^pf-/, '')}" data-bind-target="page" value="${escapeHtml(String(value))}" ${opts.placeholder ? `placeholder="${escapeHtml(opts.placeholder)}"` : ''} ${opts.min != null ? `min="${opts.min}"` : ''}>
  </div>`;
}

function renderPageFormSheet() {
  const f = UI.pageForm;
  let body = '';
  if (f.kind === 'trip') body = tripFormBody(f);
  else if (f.kind === 'tripInfo') body = tripInfoFormBody(f);
  else if (f.kind === 'account' || f.kind === 'wallet' || f.kind === 'editWallet') body = accountFormBody(f);
  else if (f.kind === 'editPass') body = passEditFormBody(f);
  else if (f.kind === 'newTraveler') body = quickNameFormBody(f, 'e.g. Jason', 'Add traveler');
  else if (f.kind === 'editTraveler') body = quickNameFormBody(f, 'e.g. Jason', 'Save name');
  else if (f.kind === 'newCategory') body = quickNameFormBody(f, 'e.g. Entertainment', 'Add category');
  else if (f.kind === 'newTransportType') body = quickNameFormBody(f, 'e.g. Ferry', 'Add transport type');
  return sheetShell(PAGE_FORM_TITLES[f.kind] || 'Edit', body);
}

function quickNameFormBody(f, placeholder, saveLabel) {
  return `
    ${pageField('Name', 'pf-name', { value: f.name, placeholder })}
    ${saveButtonHtml(saveLabel, 'savePageForm', true)}
  `;
}

function tripFormBody(f) {
  return `
    ${pageField('Trip name', 'pf-name', { value: f.name, placeholder: 'Japan 2026' })}
    ${pageField('Country', 'pf-country', { value: f.country, placeholder: 'Japan' })}
    <div style="display:flex;gap:10px">
      <div style="flex:1;min-width:0">${pageField('Currency', 'pf-currency', { value: f.currency, placeholder: 'JPY' })}</div>
      <div style="flex:1;min-width:0">${pageField('Timezone', 'pf-timezone', { value: f.timezone, placeholder: 'Asia/Tokyo' })}</div>
    </div>
    ${pageField('Start date', 'pf-start', { type: 'date', value: f.startDate, bind: 'startDate' })}
    ${pageField('End date', 'pf-end', { type: 'date', value: f.endDate, bind: 'endDate' })}
    ${pageField('Total budget (optional)', 'pf-budget', { type: 'number', value: f.totalBudget, bind: 'totalBudget', min: 0 })}
    <div style="display:flex;gap:10px">
      <div style="flex:1;min-width:0">${pageField('Starting cash', 'pf-cash', { type: 'number', value: f.startingCash, bind: 'startingCash', min: 0 })}</div>
      <div style="flex:1;min-width:0">${pageField('Starting Wise', 'pf-wise', { type: 'number', value: f.startingWise, bind: 'startingWise', min: 0 })}</div>
    </div>
    <div class="hint" style="margin-top:6px">Starting balances are historical setup data — add more later with Funding, never by editing this.</div>
    ${saveButtonHtml('Create trip', 'savePageForm', true)}
  `;
}

function tripInfoFormBody(f) {
  return `
    ${pageField('Trip name', 'pf-name', { value: f.name })}
    ${pageField('Country', 'pf-country', { value: f.country })}
    <div style="display:flex;gap:10px">
      <div style="flex:1;min-width:0">${pageField('Currency', 'pf-currency', { value: f.currency })}</div>
      <div style="flex:1;min-width:0">${pageField('Timezone', 'pf-timezone', { value: f.timezone })}</div>
    </div>
    ${pageField('Start date', 'pf-start', { type: 'date', value: f.startDate, bind: 'startDate' })}
    ${pageField('End date', 'pf-end', { type: 'date', value: f.endDate, bind: 'endDate' })}
    ${pageField('Total budget', 'pf-budget', { type: 'number', value: f.totalBudget, bind: 'totalBudget', min: 0 })}
    ${saveButtonHtml('Save changes', 'savePageForm', true)}
  `;
}

function accountFormBody(f) {
  const isWallet = f.type === 'transport_wallet';
  const isEdit = !!f.id;
  return `
    ${pageField('Name', 'pf-name', { value: f.name, placeholder: isWallet ? 'Suica' : 'Amex' })}
    ${isWallet && !isEdit ? pageField('Starting balance', 'pf-bal', { type: 'number', value: f.startingBalance, bind: 'startingBalance', min: 0 }) : ''}
    ${isWallet ? colorSwatchRow('Card color', TRANSPORT_CARD_PALETTE, f.color, 'pageChip', 'color') : ''}
    ${saveButtonHtml(isEdit ? 'Save changes' : (isWallet ? 'Add transport card' : 'Add credit card'), 'savePageForm', true)}
  `;
}

async function savePageForm() {
  const f = UI.pageForm;
  if (f.kind === 'trip') {
    if (!f.name) { showToast('Trip name is required'); return; }
    const trip = await createTrip(f);
    await loadTrip(trip.id);
    UI.screen = 'trip'; UI.tab = 'dashboard'; UI.sheet = null; UI.pageForm = null;
    render();
    return;
  }
  if (f.kind === 'tripInfo') {
    await updateTrip({ name: f.name, country: f.country, currency: f.currency, timezone: f.timezone, startDate: f.startDate, endDate: f.endDate, totalBudget: Number(f.totalBudget) || 0 });
    closePageForm();
    render();
    return;
  }
  if (f.kind === 'account' || f.kind === 'wallet') {
    if (!f.name) { showToast('Name is required'); return; }
    await addAccount({ type: f.type, name: f.name, startingBalance: Number(f.startingBalance) || 0, color: f.color });
    closePageForm();
    render();
    return;
  }
  if (f.kind === 'editWallet') {
    if (!f.name) { showToast('Name is required'); return; }
    await editWallet(f.id, { name: f.name, color: f.color });
    closePageForm();
    render();
    return;
  }
  if (f.kind === 'editPass') {
    if (!f.name) { showToast('Name is required'); return; }
    await editPass(f.id, { name: f.name, startDate: f.startDate, endDate: f.endDate, color: f.color });
    closePageForm();
    render();
    return;
  }
  if (f.kind === 'newTraveler') {
    if (!f.name) { showToast('Name is required'); return; }
    await addTraveler(f.name);
    closePageForm();
    render();
    return;
  }
  if (f.kind === 'editTraveler') {
    if (!f.name) { showToast('Name is required'); return; }
    await renameTraveler(f.id, f.name);
    closePageForm();
    render();
    return;
  }
  if (f.kind === 'newCategory') {
    if (!f.name) { showToast('Name is required'); return; }
    await addCategory(f.name);
    closePageForm();
    render();
    return;
  }
  if (f.kind === 'newTransportType') {
    if (!f.name) { showToast('Name is required'); return; }
    await addTransportType(f.name);
    closePageForm();
    render();
    return;
  }
}
