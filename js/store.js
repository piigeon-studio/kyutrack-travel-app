/* In-memory cache over IndexedDB for the active trip, plus mutation helpers.
   Every mutation writes to IndexedDB first, then updates the in-memory
   arrays that ledger.js folds over. Nothing here caches a derived total. */

const Data = {
  trips: [],
  trip: null,
  travelers: [], categories: [], accounts: [], transportTypes: [], passes: [], transactions: [], receipts: []
};

function selfTraveler() { return Data.travelers.find(t => t.isSelf); }

async function loadTripsList() {
  Data.trips = (await DB.all('trips')).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return Data.trips;
}

async function loadTrip(tripId) {
  const [trip, travelers, categories, accounts, transportTypes, passes, transactions, receipts] = await Promise.all([
    DB.get('trips', tripId),
    DB.byTrip('travelers', tripId),
    DB.byTrip('categories', tripId),
    DB.byTrip('accounts', tripId),
    DB.byTrip('transportTypes', tripId),
    DB.byTrip('passes', tripId),
    DB.byTrip('transactions', tripId),
    DB.byTrip('receipts', tripId)
  ]);
  Data.trip = trip;
  Data.travelers = travelers.slice().sort((a, b) => (b.isSelf ? 1 : 0) - (a.isSelf ? 1 : 0));
  Data.categories = categories.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const legacyLodging = Data.categories.find(c => c.name === 'Lodging');
  if (legacyLodging) { legacyLodging.name = 'Accommodation'; await DB.put('categories', legacyLodging); }
  Data.accounts = accounts;
  Data.transportTypes = transportTypes.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  Data.passes = passes;
  Data.transactions = transactions;
  Data.receipts = receipts;
  await DB.setMeta('currentTripId', tripId);
  return trip;
}

function ledger() {
  return computeLedger(Data.transactions, Data.accounts, Data.categories, selfTraveler() ? selfTraveler().id : null);
}

/* ---------------- Trip lifecycle ---------------- */

const DEFAULT_CATEGORIES = [
  { name: 'Food', color: DEFAULT_CATEGORY_COLORS.Food },
  { name: 'Transport', color: DEFAULT_CATEGORY_COLORS.Transport },
  { name: 'Accommodation', color: DEFAULT_CATEGORY_COLORS.Accommodation },
  { name: 'Shopping', color: DEFAULT_CATEGORY_COLORS.Shopping }
];
const DEFAULT_TRANSPORT_TYPES = ['Subway', 'Train', 'Shinkansen', 'Bus', 'Taxi'];

async function createTrip(fields) {
  const now = new Date().toISOString();
  const trip = {
    id: uid(), name: fields.name, country: fields.country || '', currency: fields.currency || 'JPY',
    timezone: fields.timezone || 'Asia/Tokyo', startDate: fields.startDate, endDate: fields.endDate,
    totalBudget: Number(fields.totalBudget) || 0, status: 'active', createdAt: now, updatedAt: now
  };
  await DB.put('trips', trip);

  const self = { id: uid(), tripId: trip.id, name: 'You', color: SELF_COLOR, isSelf: true };
  await DB.put('travelers', self);

  const cats = DEFAULT_CATEGORIES.map((c, i) => ({ id: uid(), tripId: trip.id, name: c.name, color: c.color, icon: '', sortOrder: i, isArchived: false }));
  await DB.putMany('categories', cats);

  const types = DEFAULT_TRANSPORT_TYPES.map((n, i) => ({ id: uid(), tripId: trip.id, name: n, sortOrder: i, isArchived: false }));
  await DB.putMany('transportTypes', types);

  const cash = { id: uid(), tripId: trip.id, type: 'cash', name: 'Cash', startingBalance: Number(fields.startingCash) || 0, isActive: true };
  const wise = { id: uid(), tripId: trip.id, type: 'wise', name: 'Wise', startingBalance: Number(fields.startingWise) || 0, isActive: true };
  await DB.putMany('accounts', [cash, wise]);

  await loadTripsList();
  return trip;
}

async function updateTrip(patch) {
  Data.trip = { ...Data.trip, ...patch, updatedAt: new Date().toISOString() };
  await DB.put('trips', Data.trip);
  return Data.trip;
}

async function setTripStatus(status) { return updateTrip({ status }); }

async function duplicateTrip(tripId) {
  const src = await DB.get('trips', tripId);
  const travelers = await DB.byTrip('travelers', tripId);
  const categories = await DB.byTrip('categories', tripId);
  const transportTypes = await DB.byTrip('transportTypes', tripId);
  const now = new Date().toISOString();
  const newTrip = { ...src, id: uid(), name: src.name + ' (copy)', status: 'active', createdAt: now, updatedAt: now };
  await DB.put('trips', newTrip);

  const idMap = {};
  const newTravelers = travelers.map(t => { const nid = uid(); idMap[t.id] = nid; return { ...t, id: nid, tripId: newTrip.id }; });
  await DB.putMany('travelers', newTravelers);
  await DB.putMany('categories', categories.map(c => ({ ...c, id: uid(), tripId: newTrip.id })));
  await DB.putMany('transportTypes', transportTypes.map(t => ({ ...t, id: uid(), tripId: newTrip.id })));

  const cash = { id: uid(), tripId: newTrip.id, type: 'cash', name: 'Cash', startingBalance: 0, isActive: true };
  const wise = { id: uid(), tripId: newTrip.id, type: 'wise', name: 'Wise', startingBalance: 0, isActive: true };
  await DB.putMany('accounts', [cash, wise]);

  await loadTripsList();
  return newTrip;
}

async function deleteTrip(tripId) {
  await Promise.all(['travelers', 'categories', 'accounts', 'transportTypes', 'passes', 'transactions', 'receipts'].map(s => DB.deleteByTrip(s, tripId)));
  await DB.delete('trips', tripId);
  await loadTripsList();
}

/* ---------------- Reference config: travelers / categories / accounts / transport types / passes ---------------- */

function nextTravelerColor() {
  const used = Data.travelers.map(t => t.color);
  const free = TRAVELER_PALETTE.find(c => !used.includes(c));
  return free || TRAVELER_PALETTE[Data.travelers.length % TRAVELER_PALETTE.length];
}

async function addTraveler(name) {
  const t = { id: uid(), tripId: Data.trip.id, name, color: nextTravelerColor(), isSelf: false };
  await DB.put('travelers', t);
  Data.travelers.push(t);
  return t;
}
async function renameTraveler(id, name) {
  const t = Data.travelers.find(x => x.id === id);
  if (!t) return;
  t.name = name;
  await DB.put('travelers', t);
}
function isTravelerReferenced(id) {
  return Data.transactions.some(t =>
    t.payerTravelerId === id || t.travelerId === id || (t.subs || []).some(s => s.travelerId === id));
}
async function removeTraveler(id) {
  if (isTravelerReferenced(id)) throw new Error('This traveler has records — cannot remove.');
  await DB.delete('travelers', id);
  Data.travelers = Data.travelers.filter(t => t.id !== id);
}

function nextCategoryColor() {
  const used = Data.categories.map(c => c.color);
  const free = CATEGORY_PALETTE.find(c => !used.includes(c));
  return free || CATEGORY_PALETTE[Data.categories.length % CATEGORY_PALETTE.length];
}
async function addCategory(name, color) {
  const c = { id: uid(), tripId: Data.trip.id, name, color: color || nextCategoryColor(), icon: '', sortOrder: Data.categories.length, isArchived: false, system: false };
  await DB.put('categories', c);
  Data.categories.push(c);
  return c;
}
function isCategoryReferenced(id) { return Data.transactions.some(t => t.categoryId === id || t.transportCategoryId === id); }
async function removeCategory(id) {
  if (isCategoryReferenced(id)) { await updateCategory(id, { isArchived: true }); return 'archived'; }
  await DB.delete('categories', id);
  Data.categories = Data.categories.filter(c => c.id !== id);
  return 'deleted';
}
async function updateCategory(id, patch) {
  const c = Data.categories.find(x => x.id === id); Object.assign(c, patch);
  await DB.put('categories', c);
}

async function addAccount(fields) {
  const a = { id: uid(), tripId: Data.trip.id, type: fields.type, name: fields.name, startingBalance: fields.startingBalance || 0, isActive: true };
  await DB.put('accounts', a);
  Data.accounts.push(a);
  return a;
}
function isAccountReferenced(id) {
  return Data.transactions.some(t => t.accountId === id || t.sourceAccountId === id || t.destinationAccountId === id);
}
async function removeAccount(id) {
  const acc = Data.accounts.find(a => a.id === id);
  if (acc && (acc.type === 'cash' || acc.type === 'wise')) throw new Error('Cash and Wise cannot be removed.');
  if (isAccountReferenced(id)) { acc.isActive = false; await DB.put('accounts', acc); return 'archived'; }
  await DB.delete('accounts', id);
  Data.accounts = Data.accounts.filter(a => a.id !== id);
  return 'deleted';
}

async function addTransportType(name) {
  const t = { id: uid(), tripId: Data.trip.id, name, sortOrder: Data.transportTypes.length, isArchived: false };
  await DB.put('transportTypes', t);
  Data.transportTypes.push(t);
  return t;
}
function isTransportTypeReferenced(id) { return Data.transactions.some(t => t.transportTypeId === id); }
async function removeTransportType(id) {
  if (isTransportTypeReferenced(id)) {
    const t = Data.transportTypes.find(x => x.id === id); t.isArchived = true;
    await DB.put('transportTypes', t); return 'archived';
  }
  await DB.delete('transportTypes', id);
  Data.transportTypes = Data.transportTypes.filter(t => t.id !== id);
  return 'deleted';
}

async function addPass(fields) {
  const p = { id: uid(), tripId: Data.trip.id, name: fields.name, purchasePrice: fields.purchasePrice, startDate: fields.startDate, endDate: fields.endDate, status: 'active', notes: fields.notes || '', isArchived: false };
  await DB.put('passes', p);
  Data.passes.push(p);
  return p;
}
function isPassReferenced(id) { return Data.transactions.some(t => t.passId === id); }
async function removePass(id) {
  if (isPassReferenced(id)) {
    const p = Data.passes.find(x => x.id === id); p.isArchived = true;
    await DB.put('passes', p); return 'archived';
  }
  await DB.delete('passes', id);
  Data.passes = Data.passes.filter(p => p.id !== id);
  return 'deleted';
}

/* ---------------- Transactions ---------------- */

async function addTransaction(txn) {
  const now = new Date().toISOString();
  const t = { id: uid(), tripId: Data.trip.id, status: 'posted', createdAt: now, updatedAt: now, receiptIds: [], ...txn };
  await DB.put('transactions', t);
  Data.transactions.push(t);
  return t;
}

/** Simulate the ledger with an edit/delete applied; block if any receivable/payable would go negative. */
function wouldBreakSplitInvariant(txnId, replacement) {
  const next = Data.transactions
    .filter(t => t.id !== txnId)
    .concat(replacement ? [replacement] : []);
  const L = computeLedger(next, Data.accounts, Data.categories, selfTraveler() ? selfTraveler().id : null);
  return Object.values(L.recv).some(v => v < -0.5) || Object.values(L.pay).some(v => v < -0.5);
}

async function updateTransaction(id, patch) {
  const existing = Data.transactions.find(t => t.id === id);
  if (!existing) throw new Error('Record not found.');
  const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  if (wouldBreakSplitInvariant(id, updated)) {
    throw new Error('This record has settlements against it — settle or reverse those first.');
  }
  await DB.put('transactions', updated);
  Data.transactions = Data.transactions.map(t => t.id === id ? updated : t);
  return updated;
}

async function deleteTransaction(id) {
  if (wouldBreakSplitInvariant(id, null)) {
    throw new Error('This record has settlements against it — settle or reverse those first.');
  }
  await DB.delete('transactions', id);
  Data.transactions = Data.transactions.filter(t => t.id !== id);
}

/* ---------------- Receipts ---------------- */

async function addReceipt(transactionId, file) {
  const id = uid();
  const r = { id, tripId: Data.trip.id, transactionId, mimeType: file.type, blob: file, createdAt: new Date().toISOString() };
  await DB.put('receipts', r);
  Data.receipts.push(r);
  const t = Data.transactions.find(x => x.id === transactionId);
  if (t) { t.receiptIds = (t.receiptIds || []).concat([id]); await DB.put('transactions', t); }
  return r;
}
async function removeReceipt(id) {
  const r = Data.receipts.find(x => x.id === id);
  await DB.delete('receipts', id);
  Data.receipts = Data.receipts.filter(x => x.id !== id);
  if (r) {
    const t = Data.transactions.find(x => x.id === r.transactionId);
    if (t) { t.receiptIds = (t.receiptIds || []).filter(rid => rid !== id); await DB.put('transactions', t); }
  }
}
