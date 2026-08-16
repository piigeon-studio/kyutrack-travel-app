/* Screen/tab renderers. Every function returns an HTML string; nothing here
   mutates state directly — clicks go through data-action + dispatch() in app.js. */

function confirmDialogHtml() {
  if (!UI.confirmDialog) return '';
  const c = UI.confirmDialog;
  return `
    <div class="confirm-scrim" data-action="cancelConfirm"></div>
    <div class="confirm-dialog">
      <div class="confirm-message">${escapeHtml(c.message)}</div>
      <div class="confirm-actions">
        <button class="confirm-btn cancel" data-action="cancelConfirm">Cancel</button>
        <button class="confirm-btn ok ${c.danger ? 'danger' : ''}" data-action="confirmYes">${escapeHtml(c.confirmLabel)}</button>
      </div>
    </div>`;
}

function quickAddMenuHtml() {
  if (!UI.quickAddMenu) return '';
  return `
    <div class="confirm-scrim" data-action="closeQuickAddMenu"></div>
    <div class="confirm-dialog quickadd-dialog">
      <div class="confirm-message">What would you like to add?</div>
      <div style="display:flex;flex-direction:column;gap:12px;margin-top:20px">
        <button class="quickadd-btn" data-action="quickAddPick" data-kind="expense">
          <span class="quickadd-icon">${icon('plus', 16)}</span>
          <span>Add expense</span>
        </button>
        <button class="quickadd-btn" data-action="quickAddPick" data-kind="transport">
          <span class="quickadd-icon">${icon('plus', 16)}</span>
          <span>Add trip</span>
        </button>
      </div>
    </div>`;
}

function screenHeader(title, subtitle) {
  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:6px 0 16px">
      <div>
        <div class="screen-title">${escapeHtml(title)}</div>
        ${subtitle ? `<div class="row-sub" style="font-size:12px;margin-top:7px">${subtitle}</div>` : ''}
      </div>
      <button class="gear-btn" style="flex:none" data-action="goSettings">${icon('gear', 18)}</button>
    </div>`;
}

/* Persistent, non-scrolling header shown above .scroll for every tab —
   keeps title/logo pinned in place while the tab's content scrolls beneath it. */
function topHeaderHtml() {
  if (UI.tab === 'dashboard') {
    return `
    <div class="header-row" style="padding-bottom:24px">
      <div class="header-left">
        <button style="border:none;background:none;cursor:pointer;padding:0;display:flex" data-action="goTrips">
          ${logoBadge(34, true)}
        </button>
        <span class="wordmark">${greetingText(Data.trip.timezone)}</span>
      </div>
      <button class="gear-btn" data-action="goSettings">${icon('gear', 18)}</button>
    </div>`;
  }
  if (UI.tab === 'records') {
    const L = ledger();
    return screenHeader('Records', `${Data.transactions.filter(t => t.type !== 'transport').length} records · ${fmtMoney(L.mySpending, Data.trip.currency)} of my spending`);
  }
  if (UI.tab === 'transport') {
    const trips = Data.transactions.filter(t => t.type === 'transport');
    return screenHeader('Transport', `${trips.length} journeys logged`);
  }
  if (UI.tab === 'split') {
    return screenHeader('Split', 'Only debts involving you');
  }
  if (UI.tab === 'settings') {
    return `
    <div style="padding:6px 0 4px">
      <div class="screen-title">Settings</div>
      <div class="row-sub" style="font-size:12px;margin-top:7px">Scoped to ${escapeHtml(Data.trip.name)}</div>
    </div>`;
  }
  return '';
}

function logoBadge(size, dark) {
  const px = size || 26;
  return `<div class="logo-badge" style="width:${px}px;height:${px}px;border-radius:${Math.round(px*0.34)}px;background:${dark ? 'var(--lime)' : 'var(--sand)'}">
    <img src="icons/wordmark-ink.png" alt="kyu" style="width:${Math.round(px*0.62)}px;height:auto"/>
  </div>`;
}

function emptyStateHtml(title, message) {
  return `
    <div class="card-white empty-state" style="text-align:center;padding:34px 20px">
      <div class="empty-state-badge" style="display:flex;justify-content:center">${logoBadge(42, true)}</div>
      <div class="row-title" style="font-size:15px;margin:14px 0 6px">${escapeHtml(title)}</div>
      <div class="muted-note">${escapeHtml(message)}</div>
    </div>`;
}

/* ==================== My Trips ==================== */

function tripsScreenInner() {
  const trips = Data.trips;
  const rows = trips.map(t => `
    <button class="trip-card" data-action="openTrip" data-id="${t.id}">
      <div class="trip-card-name">${escapeHtml(t.name)}</div>
      <div class="trip-card-meta">${escapeHtml(t.country || '')}${t.country ? ' · ' : ''}${escapeHtml(t.currency)} · ${escapeHtml(t.startDate)} – ${escapeHtml(t.endDate)}</div>
      <span class="status-pill ${t.status}">${t.status === 'active' ? 'Active' : 'Completed'}</span>
    </button>
  `).join('');

  return `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px">
      ${logoBadge(34, true)}
      <span class="wordmark" style="font-size:22px">kyu</span>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px">
      <span class="screen-title" style="font-size:22px">My Trips</span>
    </div>
    ${rows || emptyStateHtml('No trips yet', 'Start planning your first trip — set a budget, currency and dates, and every number on the dashboard follows from there.')}
    <button class="cta cta-lime" style="margin-top:14px" data-action="newTrip">
      ${icon('plus', 18)}<span class="cta-label">New trip</span>
    </button>
  `;
}

/* ==================== Unified app shell ==================== */

function renderAppShell() {
  if (UI.screen === 'trips' || !Data.trip) {
    return `
    <div class="app">
      <div class="scroll" id="scroll-area" style="padding-top:max(24px, env(safe-area-inset-top))">${tripsScreenInner()}</div>
      ${sheetHtml()}
      ${confirmDialogHtml()}
      ${UI.toast ? `<div class="toast">${escapeHtml(UI.toast)}</div>` : ''}
    </div>`;
  }

  let content = '';
  if (UI.tab === 'dashboard') content = renderDashboard();
  else if (UI.tab === 'records') content = renderRecords();
  else if (UI.tab === 'transport') content = renderTransport();
  else if (UI.tab === 'split') content = renderSplit();
  else if (UI.tab === 'settings') content = renderSettings();

  const dirClass = UI.tabTransitionDir === 'next' ? 'dir-next' : (UI.tabTransitionDir === 'prev' ? 'dir-prev' : '');

  return `
  <div class="app">
    <div class="top-header">${topHeaderHtml()}</div>
    <div class="scroll" id="scroll-area"><div class="tab-content ${dirClass}">${content}</div></div>
    <div class="chrome">
      ${tabbarHtml()}
    </div>
    ${sheetHtml()}
    ${confirmDialogHtml()}
    ${quickAddMenuHtml()}
    ${UI.toast ? `<div class="toast">${escapeHtml(UI.toast)}</div>` : ''}
  </div>`;
}

function tabbarHtml() {
  const left = [
    { key: 'dashboard', label: 'Dashboard', ic: 'home' },
    { key: 'records', label: 'Records', ic: 'list' }
  ];
  const right = [
    { key: 'transport', label: 'Transport', ic: 'transport' },
    { key: 'split', label: 'Split', ic: 'split' }
  ];
  const tabBtn = t => {
    const active = UI.tab === t.key;
    const color = active ? 'var(--lime)' : 'rgba(255,255,255,.42)';
    return `<button class="tab-item" data-action="tab" data-tab="${t.key}" aria-label="${t.label}">
      <span class="tab-icon-chip${active ? ' active' : ''}" style="color:${color}">${icon(t.ic, 24)}</span>
    </button>`;
  };
  const centerDisabled = Data.trip.status !== 'active' || !!UI.sheet;
  return `
  <div class="tabbar">
    ${left.map(tabBtn).join('')}
    <div class="tab-item">
      <button class="center-fab" data-action="quickAdd" aria-label="Add" ${centerDisabled ? 'disabled' : ''}>
        ${icon('plus', 24)}
      </button>
    </div>
    ${right.map(tabBtn).join('')}
  </div>`;
}

/* ==================== Dashboard ==================== */

function renderDashboard() {
  const trip = Data.trip;
  const L = ledger();
  const cash = Data.accounts.find(a => a.type === 'cash');
  const wise = Data.accounts.find(a => a.type === 'wise');
  const cashBal = cash ? (L.bal[cash.id] || 0) : 0;
  const wiseBal = wise ? (L.bal[wise.id] || 0) : 0;
  const openingCash = cash ? (cash.startingBalance || 0) : 0;
  const openingWise = wise ? (wise.startingBalance || 0) : 0;
  const openingTotal = openingCash + openingWise;
  const cards = Data.accounts.filter(a => a.type === 'credit_card');
  const available = availableBalance(L, Data.accounts);
  const pctTotalUsed = openingTotal > 0 ? (Math.max(0, openingTotal - available) / openingTotal * 100) : 0;
  const pctCashUsed = openingCash > 0 ? (Math.max(0, openingCash - cashBal) / openingCash * 100) : 0;
  const pctWiseUsed = openingWise > 0 ? (Math.max(0, openingWise - wiseBal) / openingWise * 100) : 0;
  const hasCards = cards.length > 0 && L.totalCardSpend > 0;
  const budget = trip.totalBudget || 0;
  const pct = budget ? (L.mySpending / budget * 100) : 0;
  const remaining = budget - L.mySpending;
  const overBudget = remaining < 0;
  const dleft = daysLeft(trip.endDate, trip.timezone);

  const catList = Data.categories
    .filter(c => (L.spend[c.id] || 0) > 0)
    .sort((a, b) => (L.spend[b.id] || 0) - (L.spend[a.id] || 0));

  const recent = Data.transactions.slice()
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, 4)
    .map(t => rowFor(t, ctx()));

  return `
    <div class="roomy">
    <div style="padding:2px 2px 0">
      <div class="section-label">Total balance</div>
      <div class="hero-amount" style="margin-top:12px;font-size:52px">${fmtMoneyBig(available, trip.currency)}</div>
      <div class="balance-mini-track dark" style="margin-top:20px">
        <div class="balance-mini-fill" style="width:${pctTotalUsed.toFixed(1)}%;background:var(--ink)"></div>
      </div>
      <div class="row-sub" style="margin-top:11px">${pctTotalUsed.toFixed(0)}% of balance used</div>
    </div>

    <div style="display:flex;gap:14px;margin-top:22px">
      <button class="balance-card balance-card-cash" data-action="openSettingsSub" data-section="accounts">
        <div class="balance-card-head">
          <span class="balance-card-label balance-card-label-lg">Cash</span>
        </div>
        <div class="balance-card-amount">${fmtMoneyBig(cashBal, trip.currency)}</div>
        <div class="balance-mini-track" style="margin-top:12px">
          <div class="balance-mini-fill" style="width:${pctCashUsed.toFixed(1)}%;background:var(--lime)"></div>
        </div>
        <div class="balance-card-pct">${pctCashUsed.toFixed(0)}% used</div>
      </button>
      <button class="balance-card balance-card-wise" data-action="openSettingsSub" data-section="accounts">
        <div class="balance-card-head">
          <img src="icons/wise-logo.svg" alt="Wise" style="height:16px;width:auto;display:block">
        </div>
        <div class="balance-card-amount">${fmtMoneyBig(wiseBal, trip.currency)}</div>
        <div class="balance-mini-track dark" style="margin-top:12px">
          <div class="balance-mini-fill" style="width:${pctWiseUsed.toFixed(1)}%;background:var(--ink)"></div>
        </div>
        <div class="balance-card-pct">${pctWiseUsed.toFixed(0)}% used</div>
      </button>
    </div>

    ${hasCards ? `
    <div class="card" style="background:var(--sand);margin-top:16px;display:flex;justify-content:space-between;align-items:center">
      <div>
        <div class="row-title" style="opacity:.6">Credit cards spent</div>
        <div class="row-amount" style="font-size:16px;margin-top:6px">${fmtMoneyBig(L.totalCardSpend, trip.currency)}</div>
      </div>
      <div style="text-align:right">
        <div class="row-title" style="opacity:.6">Net position</div>
        <div class="row-amount" style="font-size:16px;margin-top:6px">${fmtMoneyBig(available - L.totalCardSpend, trip.currency)}</div>
      </div>
    </div>` : ''}

    <div class="card-white" style="margin-top:16px">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span class="section-label">${budget ? 'Budget' : 'Total expenses'}</span>
        <span class="row-title">${budget ? pct.toFixed(1) + '% used' : ''}</span>
      </div>
      ${budget ? `
      <div style="display:flex;align-items:baseline;gap:7px;margin-top:14px">
        <span class="metric-md" style="${overBudget ? 'color:var(--negative)' : ''}">${fmtMoneyBig(Math.abs(remaining), trip.currency)}</span>
        <span style="font:700 14px/1 var(--font);color:rgba(21,35,47,.4)">${overBudget ? 'over ' + fmtMoney(budget, trip.currency) + ' budget' : 'left of ' + fmtMoney(budget, trip.currency)}</span>
      </div>
      <div class="progress-track" style="margin-top:16px">
        <div class="progress-fill" style="width:${Math.min(100, pct).toFixed(1)}%;${overBudget ? 'background:var(--negative)' : ''}"></div>
      </div>
      ${!overBudget && dleft > 0 ? `<div class="muted-note" style="margin-top:14px">${fmtMoney(Math.ceil(remaining / dleft), trip.currency)} a day for the remaining ${dleft} day${dleft === 1 ? '' : 's'}</div>` : ''}
      ` : `
      <div style="margin-top:14px"><span class="metric-md">${fmtMoneyBig(L.mySpending, trip.currency)}</span></div>
      `}
      ${catList.length ? `
      <div style="height:1px;background:rgba(21,35,47,.08);margin:20px 0"></div>
      <div style="display:flex;flex-direction:column;gap:2px">
        ${catList.map(c => `
          <button class="grouped-row" style="padding:12px 0;border-bottom-color:rgba(21,35,47,.06)" data-action="openCategory" data-id="${c.id}">
            <span class="dot" style="background:${c.color}"></span>
            <span class="row-title" style="flex:1">${escapeHtml(c.name)}</span>
            <span class="row-sub">${(L.spend[c.id] / L.mySpending * 100).toFixed(1)}%</span>
            <span class="row-amount" style="min-width:62px;text-align:right">${fmtMoneyBig(L.spend[c.id], trip.currency)}</span>
          </button>`).join('')}
      </div>` : ''}
    </div>

    <div style="margin-top:30px;display:flex;justify-content:space-between;align-items:baseline">
      <span class="section-label">Recent records</span>
      <button data-action="tab" data-tab="records" style="border:none;background:none;font:700 12px/1 var(--font);color:var(--ink);cursor:pointer">All ›</button>
    </div>
    <div style="margin-top:14px;display:flex;flex-direction:column;gap:10px">
      ${recent.length ? recent.map(r => recordRowHtml(r)).join('') : `<div class="muted-note" style="padding:6px 0">No records yet — tap Records to add your first expense.</div>`}
    </div>
    </div>
  `;
}

function recordRowHtml(r, t) {
  const content = `
  <button class="row-card swipe-content" data-action="openRecordDetail" data-id="${r.id}">
    <span class="dot" style="background:${r.color}"></span>
    <div style="flex:1;min-width:0">
      <div class="row-title">${escapeHtml(r.title)}</div>
      <div class="row-sub" style="margin-top:4px">${escapeHtml(r.sub)}</div>
    </div>
    <div style="text-align:right">
      <div class="row-amount">${styleCcy(r.amount)}</div>
      ${r.badge ? `<div class="badge${r.type === 'settlement' ? ' badge-done' : ''}">${r.type === 'settlement' ? icon('check', 10) : ''}${escapeHtml(r.badge)}</div>` : ''}
    </div>
  </button>`;
  if (!t || Data.trip.status !== 'active') return content;
  return `
  <div class="swipe-row">
    <div class="swipe-actions">
      <button class="swipe-action edit" data-action="editRecord" data-kind="${txnKindForForm(t)}" data-id="${t.id}">${icon('edit', 15)}</button>
      <button class="swipe-action delete" data-action="deleteRecord" data-id="${t.id}">${icon('trash', 15)}</button>
    </div>
    ${content}
  </div>`;
}

/* ==================== Records ==================== */

function recordsMatch(t, r) {
  if (UI.recordsFilter !== 'All') {
    if (UI.recordsFilter === 'Split') { if (!(t.splitMode === 'full_user_paid' || t.splitMode === 'self_share_other_paid')) return false; }
    else if (UI.recordsFilter === 'Card') { const acc = Data.accounts.find(a => a.id === t.accountId); if (!acc || acc.type !== 'credit_card') return false; }
    else if (UI.recordsFilter === 'Top up') { if (!(t.type === 'transfer' && t.subtype === 'top_up')) return false; }
    else if (UI.recordsFilter === 'Pass') { if (t.type !== 'pass_purchase') return false; }
    else if (UI.recordsFilter === 'Settlement') { if (t.type !== 'settlement') return false; }
    else { const cat = Data.categories.find(c => c.id === t.categoryId); if (!cat || cat.name !== UI.recordsFilter) return false; }
  }
  if (UI.recordsSearch) {
    const q = UI.recordsSearch.toLowerCase();
    const hay = (r.title + ' ' + r.sub).toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function recordsFilteredRows() {
  const c = ctx();
  return Data.transactions
    .filter(t => t.type !== 'transport')
    .map(t => ({ t, r: rowFor(t, c) }))
    .filter(({ t, r }) => recordsMatch(t, r))
    .sort((a, b) => b.t.occurredAt.localeCompare(a.t.occurredAt));
}

function renderRecords() {
  const L = ledger();
  const cats = Data.categories.filter(c => !c.isArchived);
  const filters = ['All', ...cats.map(c => c.name), 'Split', 'Card', 'Top up', 'Pass', 'Settlement'];
  return `
    <div class="roomy">
    <div class="field" style="margin-top:0;margin-bottom:14px">
      <div style="position:relative">
        <span style="position:absolute;left:13px;top:50%;transform:translateY(-50%);color:rgba(21,35,47,.4)">${icon('search', 16)}</span>
        <input id="search-input" type="text" placeholder="Search records" style="padding-left:38px;width:100%;border:1px solid rgba(21,35,47,.14);border-radius:16px;padding-top:11px;padding-bottom:11px;font:600 13px/1.3 var(--font);background:#fff">
      </div>
    </div>
    <div class="filter-scroll">
      ${filters.map(f => `<button class="filter-chip ${UI.recordsFilter === f ? 'active' : ''}" data-action="recordsFilter" data-filter="${escapeHtml(f)}">${escapeHtml(f)}</button>`).join('')}
    </div>
    <div id="records-list-body">${recordsListInnerHtml()}</div>
    </div>
  `;
}

function recordsListInnerHtml() {
  const rows = recordsFilteredRows();
  if (!rows.length) return emptyStateHtml('No records match', 'Try a different search term or switch filters.');
  const groups = [];
  rows.forEach(({ t, r }) => {
    const label = dayLabel(r.occurredAt, Data.trip.timezone);
    let g = groups.find(x => x.date === label);
    if (!g) { g = { date: label, items: [] }; groups.push(g); }
    g.items.push({ t, r });
  });
  return groups.map(g => `
    <div style="margin-bottom:22px">
      <div class="field-label" style="padding:0 4px 12px">${g.date}</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${g.items.map(({ t, r }) => recordRowHtml(r, t)).join('')}
      </div>
    </div>`).join('');
}

function updateRecordsList() {
  const el = document.getElementById('records-list-body');
  if (el) el.innerHTML = recordsListInnerHtml();
}

/* ==================== Transport ==================== */

function renderTransport() {
  const L = ledger();
  const wallets = Data.accounts.filter(a => a.type === 'transport_wallet');
  const passes = Data.passes.filter(p => !p.isArchived);
  const trips = Data.transactions.filter(t => t.type === 'transport').slice().sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const c = ctx();

  return `
    ${wallets.length ? `<div class="h-scroll h-scroll-transit">
      ${wallets.map(w => {
        const toppedUp = Data.transactions
          .filter(t => t.status !== 'voided' && ((t.type === 'transfer' && t.subtype === 'top_up' && t.destinationAccountId === w.id) || (t.type === 'funding' && t.accountId === w.id)))
          .reduce((a, t) => a + t.amount, 0);
        const walletBal = L.bal[w.id] || 0;
        const pctUsed = toppedUp > 0 ? Math.min(100, Math.max(0, (toppedUp - walletBal) / toppedUp * 100)) : 0;
        const onLight = w.color === TRANSPORT_CARD_PALETTE[0];
        const lowBalance = walletBal < 300;
        return `
        <div class="transit-card-slide">
          <div class="transit-card${onLight ? ' on-light' : ''}" style="background:${w.color || 'var(--ink)'}">
            <div class="transit-card-decor"></div>
            <div class="transit-card-body">
              <div class="transit-card-top">
                <span class="transit-card-name">${escapeHtml(w.name)}</span>
                <button class="cta-lime" style="border-radius:18px;padding:7px 12px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center" data-action="openTopUp" data-wallet-id="${w.id}">
                  <span class="cta-label" style="font-size:11px">Top up</span>
                </button>
              </div>
              <div>
                <div class="transit-card-label${lowBalance ? ' transit-card-label-alert' : ''}">${lowBalance ? 'Low balance' : 'Balance'}</div>
                <div style="display:flex;align-items:center;gap:9px">
                  <div class="transit-card-balance">${fmtMoneyBig(walletBal, Data.trip.currency)}</div>
                  ${lowBalance ? `<span class="transit-card-alert" title="Low balance — top up soon">${icon('topUpReminder', 16)}</span>` : ''}
                </div>
              </div>
              <div>
                <div class="transit-card-track"><div class="transit-card-fill" style="width:${pctUsed.toFixed(1)}%"></div></div>
                <div class="transit-card-stats">${pctUsed.toFixed(0)}% used · Topped up ${fmtMoney(toppedUp, Data.trip.currency)} total</div>
              </div>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>` : `
      <div class="card-white" style="text-align:center">
        <div class="muted-note">No transport wallets yet. Add one in Settings › Transport.</div>
      </div>`}

    ${passes.length ? `<div class="h-scroll h-scroll-transit">
      ${passes.map(p => {
        const onLight = p.color === TRANSPORT_CARD_PALETTE[0];
        return `
      <div class="pass-ticket-slide">
        <div class="pass-ticket${onLight ? ' on-light' : ''}" style="background:${p.color || 'var(--lilac)'}">
          <div class="pass-ticket-decor"></div>
          <div class="pass-ticket-body">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span class="row-title" style="font-size:15px">${escapeHtml(p.name)}</span>
              <span class="badge pass-ticket-badge">${p.status === 'active' ? 'Active' : 'Inactive'}</span>
            </div>
            <div class="pass-ticket-countdown">${passCountdownLabel(p.startDate, p.endDate, Data.trip.timezone)}</div>
            <div style="display:flex;justify-content:space-between;align-items:flex-end">
              <span class="pass-ticket-dates">${escapeHtml(p.startDate)} – ${escapeHtml(p.endDate)}</span>
              <span class="row-amount">${fmtMoneyBig(p.purchasePrice, Data.trip.currency)}</span>
            </div>
          </div>
        </div>
      </div>`;
      }).join('')}
    </div>` : ''}

    <div style="margin-top:2px" class="section-label">Trip log</div>
    <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px">
      ${trips.length ? trips.map(t => {
        const r = rowFor(t, c);
        const tag = t.coveredByPass ? 'Pass' : (r.badge || (Data.accounts.find(a => a.id === t.accountId) || {}).name || '');
        return `
        <button class="row-card" data-action="openRecordDetail" data-id="${t.id}">
          <div style="flex:1;min-width:0">
            <div class="row-title">${escapeHtml(t.from)} → ${escapeHtml(t.to)}</div>
            <div class="row-sub" style="margin-top:4px">${escapeHtml(r.sub)}</div>
          </div>
          <div style="text-align:right">
            <div class="row-amount">${styleCcy(r.amount)}</div>
            <div class="badge ${t.coveredByPass ? 'tag-pass' : ''}">${escapeHtml(tag)}</div>
          </div>
        </button>`;
      }).join('') : `<div class="muted-note" style="padding:6px 0">No trips logged yet.</div>`}
    </div>
  `;
}

/* ==================== Split ==================== */

function renderSplit() {
  const L = ledger();
  const receivables = Data.travelers.filter(t => !t.isSelf && (L.recv[t.id] || 0) > 0.5);
  const recvTotal = receivables.reduce((a, t) => a + L.recv[t.id], 0);
  const history = Data.transactions.filter(t => t.type === 'settlement').slice().sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const c = ctx();

  const travelerRow = (t, amount) => `
    <button class="row-card" style="background:rgba(255,255,255,.62);border:none;padding:11px 13px;border-radius:18px" data-action="openTravelerDetail" data-id="${t.id}">
      <span class="avatar" style="width:26px;height:26px;background:${t.color}">${escapeHtml(t.name[0])}</span>
      <span class="row-title" style="flex:1">${escapeHtml(t.name)}</span>
      <span class="row-amount">${fmtMoneyBig(amount, Data.trip.currency)}</span>
    </button>`;

  const unsettledRows = receivables.flatMap(t =>
    receivableBreakdown(Data.transactions, t.id).map(row => {
      const r = rowFor(row.txn, c);
      return `<div class="row-card" style="background:rgba(214,245,92,.22);border:none;border-left:3px solid var(--lime);padding:11px 13px 11px 12px;border-radius:18px;display:flex;align-items:center;gap:10px">
        <span class="avatar" style="width:26px;height:26px;background:${t.color}">${escapeHtml(t.name[0])}</span>
        <div style="flex:1;min-width:0">
          <div class="row-title">${escapeHtml(r.title)}</div>
          <div class="row-sub" style="margin-top:4px">${escapeHtml(t.name)} owes ${fmtMoney(row.owed, Data.trip.currency)} · ${relativeDayLabel(r.occurredAt, Data.trip.timezone)}</div>
        </div>
        ${Data.trip.status === 'active' ? `<button class="chip" style="background:var(--ink);color:#fff;border-color:var(--ink)" data-action="openSettlementFor" data-traveler-id="${t.id}" data-amount="${row.owed}">Collect</button>` : ''}
      </div>`;
    }));

  return `
    <div class="split-hero">
      <div class="section-label" style="color:rgba(21,35,47,.55)">You should receive</div>
      <div class="metric-lg" style="margin-top:9px">${fmtMoneyBig(recvTotal, Data.trip.currency)}</div>
      <div style="display:flex;flex-direction:column;gap:7px;margin-top:14px">
        ${receivables.length ? receivables.map(t => travelerRow(t, L.recv[t.id])).join('') : `<div class="muted-note">All settled.</div>`}
      </div>
    </div>

    ${unsettledRows.length ? `
    <div style="margin-top:22px" class="section-label">Unsettled records</div>
    <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px">
      ${unsettledRows.join('')}
    </div>` : ''}

    <div style="margin-top:22px" class="section-label">Settlement history</div>
    <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px">
      ${history.length ? history.map(t => { const r = rowFor(t, c); const rDated = { ...r, sub: r.sub + ' · ' + relativeDayLabel(r.occurredAt, Data.trip.timezone) }; return recordRowHtml(rDated); }).join('') : `<div class="muted-note" style="padding:6px 0">No settlements yet.</div>`}
    </div>
  `;
}

/* ==================== Settings ==================== */

function renderSettings() {
  const trip = Data.trip;
  const rows = [
    { key: 'accounts', name: 'Accounts', sub: Data.accounts.filter(a => a.isActive).map(a => a.name).join(' · ') },
    { key: 'categories', name: 'Categories', sub: Data.categories.filter(c => !c.isArchived).map(c => c.name).join(', ') },
    { key: 'data', name: 'Data', sub: 'Full backup · CSV · PDF report' },
    { key: 'transport', name: 'Transport', sub: 'Transport card, types, passes' },
    { key: 'travelers', name: 'Travelers', sub: Data.travelers.map(t => t.name).join(', ') },
    { key: 'trip', name: 'Trip', sub: 'Dates, timezone, budget' }
  ];
  return `
    <div class="grouped-list" style="margin-top:6px">
      ${rows.map(r => `
        <button class="grouped-row" data-action="openSettingsSub" data-section="${r.key}">
          <div style="flex:1">
            <div class="row-title">${r.name}</div>
            <div class="row-sub" style="margin-top:5px">${escapeHtml(r.sub || '')}</div>
          </div>
          <span class="chev">${icon('chevronRight', 15)}</span>
        </button>`).join('')}
    </div>
    <div class="card-white" style="margin-top:12px">
      <div class="section-label">Trip actions</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
        <button class="btn-outline-ink" data-action="duplicateTrip">${icon('export', 14)}<span>Duplicate trip</span></button>
        ${trip.status === 'active' ? `
        <button class="btn-outline-ink" data-action="completeTrip">${icon('check', 14)}<span>Complete trip</span></button>` : `
        <button class="btn-outline-ink" data-action="reactivateTrip">${icon('check', 14)}<span>Reactivate trip</span></button>`}
      </div>
      <div class="row-sub" style="margin-top:10px;line-height:1.5">Duplicate copies config only — no records or balances. Completing locks new records; export stays available.</div>
    </div>
    <div class="danger-card" style="margin-top:12px">
      <div class="danger-heading">Danger zone</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
        <button class="chip danger" data-action="deleteTrip">Delete this trip</button>
        <button class="chip danger" data-action="deleteAllData">Delete all local data</button>
      </div>
      <div class="row-sub" style="margin-top:10px;line-height:1.5">Both require explicit confirmation and cannot be undone.</div>
    </div>
    <div class="center-note" style="margin-top:14px">All data stored on device. No account, no sync.</div>
  `;
}

/* ==================== Sheet shell + routing ==================== */

function sheetShell(title, bodyHtml) {
  return `
    <div class="scrim" data-action="closeSheet"></div>
    <div class="sheet">
      <div class="sheet-header">
        <span class="sheet-title">${escapeHtml(title)}</span>
        <button class="close-btn" data-action="closeSheet">${icon('close', 14)}</button>
      </div>
      ${bodyHtml}
    </div>`;
}

function sheetHtml() {
  if (!UI.sheet) return '';
  if (UI.sheet === 'form') return renderMoneyFormSheet();
  if (UI.sheet === 'pageForm') return renderPageFormSheet();
  if (UI.sheet === 'category') return renderCategorySheet();
  if (UI.sheet === 'recordDetail') return renderRecordDetailSheet();
  if (UI.sheet === 'travelerDetail') return renderTravelerDetailSheet();
  if (UI.sheet === 'settingsSub') return renderSettingsSubSheet();
  return '';
}

/* ---- Category detail ---- */

function renderCategorySheet() {
  const L = ledger();
  const cat = Data.categories.find(c => c.id === UI.detail);
  if (!cat) return sheetShell('Category', `<div class="muted-note" style="margin-top:16px">Not found.</div>`);
  const c = ctx();
  const items = Data.transactions.filter(t =>
    (t.type === 'expense' && t.categoryId === cat.id) ||
    (t.type === 'pass_purchase' && t.categoryId === cat.id) ||
    (t.type === 'transport' && !t.coveredByPass && cat.name === 'Transport') ||
    (t.type === 'transfer' && t.feeAmount && cat.name === 'Fees')
  ).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).map(t => rowFor(t, c));
  const total = L.spend[cat.id] || 0;
  const pct = L.mySpending ? (total / L.mySpending * 100).toFixed(1) : '0.0';
  const body = `
    <div class="list-summary">
      <span class="row-title" style="color:rgba(255,255,255,.55)">${pct}% of my spending</span>
      <span class="metric-sm" style="font-size:22px;color:var(--lime)">${fmtMoneyBig(total, Data.trip.currency)}</span>
    </div>
    <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px;padding-bottom:6px">
      ${items.length ? items.map(r => `
        <button class="row-card" data-action="openRecordDetail" data-id="${r.id}">
          <div style="flex:1;min-width:0"><div class="row-title">${escapeHtml(r.title)}</div><div class="row-sub" style="margin-top:4px">${escapeHtml(r.sub)}</div></div>
          <span class="row-amount">${styleCcy(r.amount)}</span>
        </button>`).join('') : `<div class="muted-note" style="padding:12px 0">Nothing in this category yet.</div>`}
    </div>
    <div class="list-note">Percentages use total My Spending as denominator.</div>
  `;
  return sheetShell(cat.name, body);
}

/* ---- Record detail ---- */

function txnKindForForm(t) {
  if (t.type === 'transfer') return t.subtype === 'atm_withdrawal' ? 'atm' : (t.subtype === 'top_up' ? 'topup' : 'transfer');
  return t.type; // expense | transport | settlement | funding | adjustment | pass_purchase
}

function renderRecordDetailSheet() {
  const t = Data.transactions.find(x => x.id === UI.detail);
  if (!t) return sheetShell('Record', `<div class="muted-note" style="margin-top:16px">Not found.</div>`);
  const c = ctx();
  const r = rowFor(t, c);
  const receipts = Data.receipts.filter(x => x.transactionId === t.id);
  const canEdit = Data.trip.status === 'active';

  let splitTable = '';
  if (t.splitMode === 'full_user_paid') {
    const { parts, tax, sum } = splitParts(t);
    splitTable = `
      <div class="card-white" style="margin-top:12px">
        <div class="field-label">Split allocation</div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
          ${parts.map(p => {
            const tv = Data.travelers.find(x => x.id === p.travelerId);
            return `<div style="display:flex;justify-content:space-between;align-items:center">
              <span class="row-title">${escapeHtml(tv ? tv.name : '—')}</span>
              <span class="row-sub">subtotal ${fmtMoney(p.subtotal, c.currency)} + tax ${fmtMoney(p.tax, c.currency)}</span>
              <span class="row-amount">${fmtMoneyBig(p.share, c.currency)}</span>
            </div>`;
          }).join('')}
        </div>
      </div>`;
  } else if (t.splitMode === 'self_share_other_paid') {
    const p = Data.travelers.find(x => x.id === t.payerTravelerId);
    splitTable = `<div class="card-white" style="margin-top:12px"><div class="row-sub">Paid by <b>${escapeHtml(p ? p.name : '—')}</b> — only your share is recorded. This creates a payable.</div></div>`;
  }

  const receiptsHtml = `
    <div class="card-white" style="margin-top:12px">
      <div class="field-label">Receipts</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
        ${receipts.map(rc => `
          <div style="position:relative">
            <img src="${URL.createObjectURL(rc.blob)}" style="width:64px;height:64px;object-fit:cover;border-radius:12px;border:1px solid rgba(21,35,47,.1)">
            <button data-action="removeReceipt" data-id="${rc.id}" style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;background:var(--ink);color:#fff;border:none;font-size:11px;cursor:pointer">${icon('close', 10)}</button>
          </div>`).join('')}
        <label style="width:64px;height:64px;border-radius:12px;border:1px dashed rgba(21,35,47,.25);display:flex;align-items:center;justify-content:center;cursor:pointer;color:rgba(21,35,47,.4)">
          ${icon('camera', 20)}
          <input type="file" accept="image/*" capture="environment" data-receipt-target="${t.id}" style="display:none">
        </label>
      </div>
    </div>`;

  const body = `
    <div class="amount-display">
      <div class="amount-display-label">${escapeHtml(r.title)}</div>
      <div class="amount-display-val">${styleCcy(r.amount)}</div>
      ${t.note ? `<div class="amount-note">${escapeHtml(t.note)}</div>` : ''}
    </div>
    <div class="card-white" style="margin-top:12px">
      <div style="display:flex;flex-direction:column;gap:9px">
        <div style="display:flex;justify-content:space-between"><span class="row-sub">Date</span><span class="row-title">${fullDateLabel(t.occurredAt, c.timezone)}</span></div>
        <div style="display:flex;justify-content:space-between"><span class="row-sub">Context</span><span class="row-title">${escapeHtml(r.sub)}</span></div>
      </div>
    </div>
    ${splitTable}
    ${receiptsHtml}
    ${canEdit ? `
    <div style="display:flex;gap:10px;margin-top:14px">
      <button class="cta cta-ink" data-action="editRecord" data-kind="${txnKindForForm(t)}" data-id="${t.id}">${icon('edit', 16)}<span class="cta-label">Edit</span></button>
      <button class="cta" style="background:var(--coral);color:var(--ink)" data-action="deleteRecord" data-id="${t.id}">${icon('trash', 16)}<span class="cta-label">Delete</span></button>
    </div>` : `<div class="center-note" style="margin-top:14px">Trip is completed — reactivate it to edit records.</div>`}
  `;
  return sheetShell('Record', body);
}

/* ---- Traveler detail ---- */

function renderTravelerDetailSheet() {
  const trav = Data.travelers.find(x => x.id === UI.detail);
  if (!trav) return sheetShell('Traveler', `<div class="muted-note" style="margin-top:16px">Not found.</div>`);
  const L = ledger();
  const c = ctx();
  const recv = L.recv[trav.id] || 0, pay = L.pay[trav.id] || 0;
  const sourceTxns = Data.transactions.filter(t =>
    t.payerTravelerId === trav.id || t.travelerId === trav.id || (t.subs || []).some(s => s.travelerId === trav.id)
  ).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).map(t => rowFor(t, c));

  const body = `
    <div class="list-summary" style="align-items:center">
      <div style="display:flex;align-items:center;gap:10px">
        <span class="avatar" style="width:32px;height:32px;line-height:32px;font-size:13px;background:${trav.color}">${escapeHtml(trav.name[0])}</span>
        <span class="row-title" style="color:#fff;font-size:14px">${escapeHtml(trav.name)}</span>
      </div>
      <div style="text-align:right">
        ${recv > 0.5 ? `<div class="row-sub" style="color:rgba(255,255,255,.55)">owes you</div><div class="metric-sm" style="font-size:18px;color:var(--lime)">${fmtMoneyBig(recv, c.currency)}</div>` : ''}
        ${pay > 0.5 ? `<div class="row-sub" style="color:rgba(255,255,255,.55)">you owe</div><div class="metric-sm" style="font-size:18px;color:var(--coral)">${fmtMoneyBig(pay, c.currency)}</div>` : ''}
        ${recv <= 0.5 && pay <= 0.5 ? `<div class="row-sub" style="color:rgba(255,255,255,.55)">settled</div>` : ''}
      </div>
    </div>
    <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px">
      ${sourceTxns.length ? sourceTxns.map(r => recordRowHtml(r)).join('') : `<div class="muted-note" style="padding:12px 0">No history with ${escapeHtml(trav.name)} yet.</div>`}
    </div>
  `;
  return sheetShell(trav.name, body);
}

/* ---- Settings sub-pages ---- */

function renderSettingsSubSheet() {
  const s = UI.settingsSection;
  if (s === 'trip') return settingsSubTrip();
  if (s === 'travelers') return settingsSubTravelers();
  if (s === 'categories') return settingsSubCategories();
  if (s === 'accounts') return settingsSubAccounts();
  if (s === 'transport') return settingsSubTransport();
  if (s === 'data') return settingsSubData();
  return sheetShell('Settings', '');
}

function settingsSubTrip() {
  const trip = Data.trip;
  const body = `
    <div class="card-white" style="margin-top:14px">
      <div class="row-sub" style="line-height:1.6">
        ${trip.country ? escapeHtml(trip.country) + ' · ' : ''}${escapeHtml(trip.currency)} · ${escapeHtml(trip.timezone)}<br>
        ${escapeHtml(trip.startDate)} – ${escapeHtml(trip.endDate)}<br>
        Budget ${trip.totalBudget ? fmtMoney(trip.totalBudget, trip.currency) : 'not set'}
      </div>
    </div>
    <button class="btn-add" style="margin-top:10px" data-action="openPageForm" data-kind="tripInfo">${icon('edit', 14)}<span>Edit trip details</span></button>
  `;
  return sheetShell('Trip', body);
}

function settingsSubTravelers() {
  const body = `
    <div class="grouped-list" style="margin-top:14px">
      ${Data.travelers.map(t => `
        <div class="grouped-row" style="cursor:pointer" data-action="editTraveler" data-id="${t.id}">
          <span class="avatar" style="width:26px;height:26px;background:${t.color}">${escapeHtml(t.name[0])}</span>
          <span class="row-title" style="flex:1">${escapeHtml(t.name)}</span>
          ${!t.isSelf ? `<button data-action="removeTraveler" data-id="${t.id}" class="chip small danger">Remove</button>` : ''}
        </div>`).join('')}
    </div>
    <button class="btn-add" style="margin-top:10px" data-action="addTraveler">${icon('plus', 14)}<span>Add traveler</span></button>
  `;
  return sheetShell('Travelers', body);
}

function settingsSubCategories() {
  const body = `
    <div class="grouped-list" style="margin-top:14px">
      ${Data.categories.map(c => `
        <div class="grouped-row" style="cursor:default">
          <span class="dot" style="background:${c.color}"></span>
          <span class="row-title" style="flex:1">${escapeHtml(c.name)}${c.isArchived ? ' (archived)' : ''}</span>
          <button data-action="removeCategory" data-id="${c.id}" class="chip small danger">Remove</button>
        </div>`).join('')}
    </div>
    <button class="btn-add" style="margin-top:10px" data-action="addCategory">${icon('plus', 14)}<span>Add category</span></button>
    <div class="center-note" style="margin-top:14px">Removing a category already used by records archives it instead, so past records stay intact.</div>
  `;
  return sheetShell('Categories', body);
}

function settingsSubAccounts() {
  const groups = [
    { label: 'Spendable', types: ['cash', 'wise'] },
    { label: 'Credit cards', types: ['credit_card'] }
  ];
  const L = ledger();
  const body = `
    ${groups.map(g => {
      const accs = Data.accounts.filter(a => g.types.includes(a.type) && a.isActive);
      return `
      <div class="section-label" style="margin-top:16px">${g.label}</div>
      <div class="grouped-list" style="margin-top:10px">
        ${accs.length ? accs.map(a => `
          <div class="grouped-row" style="cursor:default">
            <div style="flex:1;min-width:0">
              <span class="row-title">${escapeHtml(a.name)}</span>
              ${a.type === 'cash' || a.type === 'wise' ? `<div class="row-sub" style="margin-top:4px">Started with ${fmtMoney(a.startingBalance || 0, Data.trip.currency)}</div>` : ''}
            </div>
            <span class="row-amount">${a.type === 'credit_card' ? fmtMoneyBig(L.cardSpend[a.id] || 0, Data.trip.currency) + ' spent' : fmtMoneyBig(L.bal[a.id] || 0, Data.trip.currency)}</span>
            ${a.type !== 'cash' && a.type !== 'wise' ? `<button data-action="removeAccount" data-id="${a.id}" class="chip small danger" style="margin-left:8px">Remove</button>` : ''}
          </div>`).join('') : `<div class="grouped-row" style="cursor:default"><span class="muted-note">None yet.</span></div>`}
      </div>`;
    }).join('')}
    <button class="btn-add" style="margin-top:12px" data-action="openPageForm" data-kind="account">${icon('plus', 14)}<span>Add credit card</span></button>
    <div style="display:flex;gap:10px;margin-top:10px">
      <button class="btn-outline-ink" data-action="openForm" data-kind="funding">Add funds</button>
      <button class="btn-outline-ink" data-action="openForm" data-kind="adjustment">Adjust balance</button>
    </div>
    <div style="display:flex;gap:10px;margin-top:10px">
      <button class="btn-outline-ink" data-action="openForm" data-kind="transfer">Transfer</button>
      <button class="btn-outline-ink" data-action="openForm" data-kind="atm">ATM withdrawal</button>
    </div>
  `;
  return sheetShell('Accounts', body);
}

function settingsSubTransport() {
  const L = ledger();
  const body = `
    <div class="section-label" style="margin-top:4px">Transport card</div>
    <div class="grouped-list" style="margin-top:10px">
      ${Data.accounts.filter(a => a.type === 'transport_wallet').map(a => `
        <div class="grouped-row" style="cursor:pointer" data-action="openPageForm" data-kind="editWallet" data-id="${a.id}">
          <span class="dot" style="background:${a.color || 'var(--ink)'}"></span>
          <span class="row-title" style="flex:1">${escapeHtml(a.name)}</span>
          <span class="row-amount" style="margin-right:8px">${fmtMoneyBig(L.bal[a.id] || 0, Data.trip.currency)}</span>
          <button data-action="removeAccount" data-id="${a.id}" class="chip small danger">Remove</button>
        </div>`).join('') || `<div class="grouped-row" style="cursor:default"><span class="muted-note">None yet.</span></div>`}
    </div>
    <button class="btn-add" style="margin-top:10px" data-action="openPageForm" data-kind="wallet">${icon('plus', 14)}<span>Add transport card</span></button>

    <div class="section-label" style="margin-top:20px">Passes</div>
    <div class="grouped-list" style="margin-top:10px">
      ${Data.passes.map(p => `
        <div class="grouped-row" style="cursor:pointer" data-action="openPageForm" data-kind="editPass" data-id="${p.id}">
          <span class="dot" style="background:${p.color || 'var(--lilac)'}"></span>
          <div style="flex:1"><div class="row-title">${escapeHtml(p.name)}${p.isArchived ? ' (archived)' : ''}</div><div class="row-sub" style="margin-top:4px">${escapeHtml(p.startDate)} – ${escapeHtml(p.endDate)} · ${p.status}</div></div>
          <span class="row-amount" style="margin-right:8px">${fmtMoneyBig(p.purchasePrice, Data.trip.currency)}</span>
          <button data-action="removePass" data-id="${p.id}" class="chip small danger">Remove</button>
        </div>`).join('') || `<div class="grouped-row" style="cursor:default"><span class="muted-note">None yet.</span></div>`}
    </div>
    <button class="btn-add" style="margin-top:10px" data-action="openForm" data-kind="pass">${icon('plus', 14)}<span>Add pass</span></button>

    <div class="section-label" style="margin-top:20px">Transport types</div>
    <div class="grouped-list" style="margin-top:10px">
      ${Data.transportTypes.map(t => `
        <div class="grouped-row" style="cursor:default">
          <span class="row-title" style="flex:1">${escapeHtml(t.name)}${t.isArchived ? ' (archived)' : ''}</span>
          <button data-action="removeTransportType" data-id="${t.id}" class="chip small danger">Remove</button>
        </div>`).join('')}
    </div>
    <button class="btn-add" style="margin-top:10px" data-action="addTransportType">${icon('plus', 14)}<span>Add type</span></button>
  `;
  return sheetShell('Transport', body);
}

function settingsSubData() {
  const body = `
    <div class="card-white" style="margin-top:14px">
      <div class="row-sub" style="line-height:1.6">${Data.transactions.length} records · ${Data.receipts.length} receipts stored on this device.</div>
    </div>
    <div class="section-label" style="margin-top:18px">Export</div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
      <button class="row-card" data-action="exportBackup">${icon('export', 18)}<span class="row-title" style="flex:1">Full backup (JSON + receipts)</span></button>
      <button class="row-card" data-action="exportCsv">${icon('export', 18)}<span class="row-title" style="flex:1">CSV report</span></button>
      <button class="row-card" data-action="exportPdf">${icon('export', 18)}<span class="row-title" style="flex:1">PDF report</span></button>
    </div>
    <div class="section-label" style="margin-top:18px">Import</div>
    <div style="margin-top:10px">
      <button class="row-card" data-action="triggerImport">${icon('import', 18)}<span class="row-title" style="flex:1">Restore from backup</span></button>
      <input type="file" id="import-file-input" accept="application/json,.json,.zip" style="display:none">
    </div>
    <div class="center-note" style="margin-top:14px">Import adds a new trip — it never overwrites existing data.</div>
  `;
  return sheetShell('Data', body);
}
