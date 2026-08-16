/* Pure accounting engine. Never mutates, never trusts a cached total —
   always recomputes from the immutable transaction list. Mirrors the
   semantics in JAPAN_TRAVEL_FINANCE_APP_SPEC.md §12 and the kyu.dc.html
   prototype's ledger()/allocate()/cashflowEntries(). */

const DEFAULT_CATEGORY_COLORS = { Food: '#B79DF7', Shopping: '#D6F55C', Transport: '#9EDDE9', Accommodation: '#F6C7E4', Fees: '#F9887A' };
const TRAVELER_PALETTE = ['#B79DF7', '#9EDDE9', '#F6C7E4', '#F9887A', '#DDD7CC'];
const CATEGORY_PALETTE = ['#B79DF7', '#9EDDE9', '#F6C7E4', '#D6F55C', '#F9887A', '#FFD08A', '#8FD9A8', '#A9C7FF', '#E8B4BC', '#F2E28A'];
const TRANSPORT_CARD_PALETTE = ['#D6F55C', '#15232F', '#0015FF', '#FF00A1', '#8400FF'];
const SELF_COLOR = '#D6F55C';

/**
 * Deterministic proportional tax allocation with largest-remainder rounding.
 * subs: [{travelerId, subtotal}]  totalTax: integer
 * returns [{travelerId, subtotal, tax, share}] summing exactly to sum(subtotal)+totalTax
 */
function allocateTax(subs, totalTax) {
  const sum = subs.reduce((a, b) => a + b.subtotal, 0);
  if (!sum || !totalTax) return subs.map(s => ({ ...s, tax: 0, share: s.subtotal }));
  const raw = subs.map(s => ({ ...s, exact: totalTax * s.subtotal / sum }));
  const floors = raw.map(r => ({ ...r, tax: Math.floor(r.exact), rem: r.exact - Math.floor(r.exact) }));
  let left = totalTax - floors.reduce((a, b) => a + b.tax, 0);
  const order = floors.map((f, i) => i).sort((a, b) => floors[b].rem - floors[a].rem || a - b);
  for (const i of order) { if (left <= 0) break; floors[i].tax += 1; left -= 1; }
  return floors.map(f => ({ travelerId: f.travelerId, subtotal: f.subtotal, tax: f.tax, share: f.subtotal + f.tax }));
}

function computeTax(sum, taxMode, taxValue) {
  if (taxMode === 'percent') return Math.round(sum * (taxValue || 0) / 100);
  if (taxMode === 'fixed') return taxValue || 0;
  return 0;
}

/** Resolve the parts (per-traveler share) for a full_user_paid split transaction. */
function splitParts(txn) {
  const subs = (txn.subs || []).map(s => ({ travelerId: s.travelerId, subtotal: s.subtotal || 0 }));
  const sum = subs.reduce((a, b) => a + b.subtotal, 0);
  const tax = computeTax(sum, txn.taxMode, txn.taxValue);
  const parts = allocateTax(subs, tax);
  const total = sum + tax;
  return { parts, sum, tax, total };
}

function accountsByType(accounts) {
  const byType = {};
  accounts.forEach(a => { (byType[a.type] = byType[a.type] || []).push(a); });
  return byType;
}

/**
 * Compute the full derived ledger from source transactions.
 * accounts: Account[]  categories: Category[] (used to resolve 'Fees' category id)
 * selfTravelerId: the traveler id flagged isSelf for this trip
 */
function computeLedger(transactions, accounts, categories, selfTravelerId) {
  const bal = {};
  accounts.forEach(a => { if (a.type !== 'credit_card') bal[a.id] = a.startingBalance || 0; });
  const cardSpend = {};
  accounts.forEach(a => { if (a.type === 'credit_card') cardSpend[a.id] = 0; });

  let cf = 0;
  const spend = {};      // categoryId -> amount (My Spending breakdown)
  const recv = {};       // travelerId -> amount they owe user
  const pay = {};        // travelerId -> amount user owes them

  const feesCategory = categories.find(c => c.name === 'Fees');
  const feesCategoryId = feesCategory ? feesCategory.id : '__fees__';

  const addSpend = (catId, n) => { if (!catId) return; spend[catId] = (spend[catId] || 0) + n; };
  const accountOf = id => accounts.find(a => a.id === id);
  const isCard = id => { const a = accountOf(id); return a && a.type === 'credit_card'; };

  const sorted = transactions.slice().filter(t => t.status !== 'voided').sort((a, b) => a.occurredAt < b.occurredAt ? -1 : 1);

  for (const t of sorted) {
    if (t.type === 'expense' || (t.type === 'transport' && !t.coveredByPass) || t.type === 'pass_purchase') {
      const catId = t.type === 'transport' ? t.transportCategoryId : (t.type === 'pass_purchase' ? t.transportCategoryId : t.categoryId);
      if (t.splitMode === 'self_share_other_paid') {
        addSpend(catId, t.amount);
        pay[t.payerTravelerId] = (pay[t.payerTravelerId] || 0) + t.amount;
      } else if (t.splitMode === 'full_user_paid') {
        const { parts, total } = splitParts(t);
        const mine = (parts.find(p => p.travelerId === selfTravelerId) || { share: 0 }).share;
        if (isCard(t.accountId)) { cardSpend[t.accountId] = (cardSpend[t.accountId] || 0) + total; }
        else { bal[t.accountId] -= total; cf -= total; }
        addSpend(catId, mine);
        parts.filter(p => p.travelerId !== selfTravelerId).forEach(p => { recv[p.travelerId] = (recv[p.travelerId] || 0) + p.share; });
      } else {
        const amt = t.type === 'transport' ? t.fareAmount : t.amount;
        if (isCard(t.accountId)) { cardSpend[t.accountId] = (cardSpend[t.accountId] || 0) + amt; }
        else { bal[t.accountId] -= amt; cf -= amt; }
        addSpend(catId, amt);
      }
    } else if (t.type === 'transfer') {
      const fee = t.feeAmount || 0;
      bal[t.sourceAccountId] -= t.amount + fee;
      bal[t.destinationAccountId] += t.amount;
      if (fee) { cf -= fee; addSpend(feesCategoryId, fee); }
    } else if (t.type === 'funding') {
      bal[t.accountId] += t.amount; cf += t.amount;
    } else if (t.type === 'adjustment') {
      bal[t.accountId] += t.delta; cf += t.delta;
    } else if (t.type === 'settlement') {
      if (t.direction === 'they_paid_me') { bal[t.accountId] += t.amount; cf += t.amount; recv[t.travelerId] = (recv[t.travelerId] || 0) - t.amount; }
      else { bal[t.accountId] -= t.amount; cf -= t.amount; pay[t.travelerId] = (pay[t.travelerId] || 0) - t.amount; }
    }
  }

  const mySpending = Object.values(spend).reduce((a, b) => a + b, 0);
  const totalCardSpend = Object.values(cardSpend).reduce((a, b) => a + b, 0);

  return { bal, cf, cardSpend, totalCardSpend, spend, recv, pay, mySpending, feesCategoryId };
}

/** FIFO breakdown of which specific split records still contribute to a
    traveler's outstanding receivable, after netting out settlements
    chronologically against their oldest shares first. */
function receivableBreakdown(transactions, travelerId) {
  const records = transactions
    .filter(t => t.status !== 'voided' && t.splitMode === 'full_user_paid' && (t.subs || []).some(s => s.travelerId === travelerId))
    .sort((a, b) => a.occurredAt < b.occurredAt ? -1 : 1);
  const settled = transactions
    .filter(t => t.status !== 'voided' && t.type === 'settlement' && t.travelerId === travelerId && t.direction === 'they_paid_me')
    .reduce((a, t) => a + t.amount, 0);
  let remainingSettled = settled;
  const rows = [];
  for (const t of records) {
    const { parts } = splitParts(t);
    const share = (parts.find(p => p.travelerId === travelerId) || { share: 0 }).share;
    if (!share) continue;
    if (remainingSettled >= share) { remainingSettled -= share; continue; }
    rows.push({ txn: t, owed: share - remainingSettled });
    remainingSettled = 0;
  }
  return rows;
}

function availableBalance(ledger, accounts) {
  const cash = accounts.find(a => a.type === 'cash');
  const wise = accounts.find(a => a.type === 'wise');
  return (cash ? ledger.bal[cash.id] || 0 : 0) + (wise ? ledger.bal[wise.id] || 0 : 0);
}

/** Row descriptor for record lists (Records tab, category detail, transport log). */
function rowFor(t, ctx) {
  const { accounts, travelers, categories, transportTypes, passes, timezone, currency, selfTravelerId } = ctx;
  const accountOf = id => accounts.find(a => a.id === id);
  const catOf = id => categories.find(c => c.id === id);
  const isCard = id => { const a = accountOf(id); return a && a.type === 'credit_card'; };

  if (t.type === 'expense') {
    const cat = catOf(t.categoryId);
    let amount = t.amount, sub = '', badge = '';
    if (t.splitMode === 'full_user_paid') {
      const { parts, total } = splitParts(t);
      amount = total;
      const mine = (parts.find(p => p.travelerId === selfTravelerId) || { share: 0 }).share;
      sub = (cat ? cat.name : '—') + ' · you paid · your share ' + fmtMoney(mine, currency);
      badge = 'Split ' + (t.subs || []).length;
    } else if (t.splitMode === 'self_share_other_paid') {
      const p = travelers.find(x => x.id === t.payerTravelerId);
      sub = (cat ? cat.name : '—') + ' · paid by ' + (p ? p.name : '—') + ' · your share only';
      badge = 'Payable';
    } else {
      const acc = accountOf(t.accountId);
      sub = (cat ? cat.name : '—') + ' · ' + (acc ? acc.name : '—');
      if (isCard(t.accountId)) badge = 'Card';
    }
    return { id: t.id, title: t.title || (cat ? cat.name : 'Expense'), sub, amount: fmtMoney(amount, currency), color: cat ? cat.color : '#EFEAE0', badge, occurredAt: t.occurredAt, type: t.type };
  }
  if (t.type === 'transport') {
    const tt = transportTypes.find(x => x.id === t.transportTypeId);
    const acc = t.accountId ? accountOf(t.accountId) : null;
    let amount = t.fareAmount, badge = t.coveredByPass ? 'Pass' : '';
    if (t.splitMode === 'full_user_paid') { amount = splitParts(t).total; badge = 'Split ' + (t.subs || []).length; }
    if (t.splitMode === 'self_share_other_paid') badge = 'Payable';
    const sub = (tt ? tt.name : 'Transport') + ' · ' + (t.coveredByPass ? 'covered by pass' : (t.splitMode === 'self_share_other_paid' ? 'paid by ' + ((travelers.find(x => x.id === t.payerTravelerId) || {}).name || '—') : (acc ? acc.name : '—')));
    return { id: t.id, title: t.from + ' → ' + t.to, sub, amount: fmtMoney(amount, currency), color: DEFAULT_CATEGORY_COLORS.Transport, badge, occurredAt: t.occurredAt, type: t.type };
  }
  if (t.type === 'pass_purchase') {
    const acc = accountOf(t.accountId);
    const p = passes.find(x => x.id === t.passId);
    return { id: t.id, title: t.title || (p ? p.name : 'Pass purchase'), sub: 'Transport · ' + (acc ? acc.name : '—'), amount: fmtMoney(t.amount, currency), color: DEFAULT_CATEGORY_COLORS.Transport, badge: 'Pass', occurredAt: t.occurredAt, type: t.type };
  }
  if (t.type === 'transfer') {
    const src = accountOf(t.sourceAccountId), dst = accountOf(t.destinationAccountId);
    const label = t.subtype === 'atm_withdrawal' ? 'ATM withdrawal' : (t.subtype === 'top_up' ? ('Top up ' + (dst ? dst.name : '')) : 'Transfer');
    const sub = (src ? src.name : '—') + ' → ' + (dst ? dst.name : '—') + (t.feeAmount ? ' · fee ' + fmtMoney(t.feeAmount, currency) : '');
    return { id: t.id, title: t.title || label, sub, amount: fmtMoney(t.amount, currency), color: '#EFEAE0', badge: t.subtype === 'top_up' ? 'Transfer' : 'Transfer', occurredAt: t.occurredAt, type: t.type };
  }
  if (t.type === 'funding') {
    const acc = accountOf(t.accountId);
    return { id: t.id, title: 'Add funds', sub: acc ? acc.name : '—', amount: fmtMoney(t.amount, currency), color: '#EFEAE0', badge: 'Funding', occurredAt: t.occurredAt, type: t.type };
  }
  if (t.type === 'adjustment') {
    const acc = accountOf(t.accountId);
    return { id: t.id, title: 'Balance adjustment', sub: t.reason || (acc ? acc.name : '—'), amount: fmtSigned(t.delta, currency), color: DEFAULT_CATEGORY_COLORS.Fees, badge: 'Adjust', occurredAt: t.occurredAt, type: t.type };
  }
  if (t.type === 'settlement') {
    const p = travelers.find(x => x.id === t.travelerId);
    const acc = accountOf(t.accountId);
    return { id: t.id, title: t.direction === 'they_paid_me' ? ((p ? p.name : '—') + ' paid you') : ('You paid ' + (p ? p.name : '—')), sub: 'Settlement · ' + (acc ? acc.name : '—'), amount: fmtMoney(t.amount, currency), color: '#EFEAE0', badge: 'Settled', occurredAt: t.occurredAt, type: t.type };
  }
  return { id: t.id, title: t.type, sub: '', amount: '', color: '#EFEAE0', badge: '', occurredAt: t.occurredAt, type: t.type };
}
