/* App shell: UI state machine, single delegated event dispatcher, render loop.
   Screens/sheets return HTML strings (views.js, forms.js); nothing here
   touches IndexedDB directly except through store.js. */

const UI = {
  screen: 'loading',   // 'loading' | 'trips' | 'trip'
  tab: 'dashboard',    // dashboard | records | transport | split | settings
  sheet: null,         // null | 'form' | 'pageForm' | 'category' | 'recordDetail' | 'travelerDetail' | 'settingsSub'
  form: null,
  pageForm: null,
  pageFormReturn: null, // { sheet, section } to restore after a pageForm opened from within a sub-sheet is closed/saved
  detail: null,
  settingsSection: null,
  recordsFilter: 'All',
  recordsSearch: '',
  toast: null,
  confirmDialog: null, // { message, action, confirmLabel, danger }
  quickAddMenu: false,
  tabTransitionDir: null // 'next' | 'prev' | null — one-shot hint consumed by renderAppShell, cleared after each render
};

const TAB_ORDER = ['dashboard', 'records', 'transport', 'split'];

/** In-app replacement for window.confirm — confirm()/prompt() are unsupported
    in installed/standalone PWA contexts on several platforms. */
function askConfirm(message, action, opts) {
  UI.confirmDialog = { message, action, confirmLabel: (opts && opts.confirmLabel) || 'Confirm', danger: !!(opts && opts.danger) };
  render();
}

/** Closes the current pageForm/form, restoring the sub-sheet it was opened from
    (e.g. Settings > Transport) instead of always dropping back to the top level. */
function closePageForm() {
  UI.pageForm = null;
  UI.form = null;
  if (UI.pageFormReturn) {
    UI.sheet = UI.pageFormReturn.sheet;
    UI.settingsSection = UI.pageFormReturn.section;
    UI.pageFormReturn = null;
  } else {
    UI.sheet = null;
  }
}

function ctx() {
  return {
    accounts: Data.accounts, travelers: Data.travelers, categories: Data.categories,
    transportTypes: Data.transportTypes, passes: Data.passes,
    timezone: Data.trip.timezone, currency: Data.trip.currency,
    selfTravelerId: selfTraveler() ? selfTraveler().id : null
  };
}

function render() {
  const root = document.getElementById('root');
  if (UI.screen === 'loading') { root.innerHTML = ''; return; }
  root.innerHTML = renderAppShell();
  UI.tabTransitionDir = null;
  afterRender();
}

function afterRender() {
  const search = document.getElementById('search-input');
  if (search) {
    search.value = UI.recordsSearch;
    search.addEventListener('input', e => { UI.recordsSearch = e.target.value; updateRecordsList(); });
  }
}

function showToast(msg) {
  UI.toast = msg;
  render();
  setTimeout(() => { UI.toast = null; const t = document.querySelector('.toast'); if (t) t.remove(); }, 2200);
}

async function safe(fn) {
  try { await fn(); } catch (e) { showToast(e.message || String(e)); }
}

/* ---------------- Bootstrap ---------------- */

async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  await loadTripsList();
  const lastId = await DB.getMeta('currentTripId');
  const last = lastId && Data.trips.find(t => t.id === lastId);
  if (last) {
    await loadTrip(last.id);
    UI.screen = 'trip'; UI.tab = 'dashboard';
  } else {
    UI.screen = 'trips';
  }
  render();
}

document.addEventListener('DOMContentLoaded', boot);

/* ---------------- Delegated dispatch ---------------- */

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  e.preventDefault();
  dispatch(el.dataset.action, el, e);
});

document.addEventListener('change', e => {
  if (e.target.matches('[data-receipt-target]')) {
    const file = e.target.files && e.target.files[0];
    if (file) safe(async () => { await addReceipt(e.target.dataset.receiptTarget, file); render(); });
  }
  if (e.target.matches('[data-pending-receipt]')) {
    const file = e.target.files && e.target.files[0];
    if (file && UI.form) { UI.form.receiptFile = file; UI.form.receiptPreviewUrl = URL.createObjectURL(file); render(); }
  }
});

function syncBind(e) {
  if (e.target.matches('[data-bind]')) {
    const key = e.target.dataset.bind;
    const target = e.target.dataset.bindTarget === 'page' ? UI.pageForm : UI.form;
    if (!target) return;
    if (key.indexOf('.') >= 0) {
      const [obj, sub] = key.split('.');
      target[obj] = { ...(target[obj] || {}), [sub]: e.target.value };
    } else {
      target[key] = e.target.value;
    }
  }
}
document.addEventListener('input', syncBind);
document.addEventListener('change', syncBind);
document.addEventListener('input', e => {
  if (e.target.matches('[data-recalc="split"]')) updateSplitRemaining();
});

function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }
function num(id) { const n = Number(val(id)); return isFinite(n) ? n : 0; }

function goToTab(tab) {
  const fromIdx = TAB_ORDER.indexOf(UI.tab), toIdx = TAB_ORDER.indexOf(tab);
  UI.tabTransitionDir = (fromIdx >= 0 && toIdx >= 0 && toIdx !== fromIdx) ? (toIdx > fromIdx ? 'next' : 'prev') : null;
  UI.tab = tab; UI.sheet = null; UI.form = null; UI.pageFormReturn = null; render();
}

function dispatch(action, el, ev) {
  const d = el.dataset;
  switch (action) {
    /* ---- navigation ---- */
    case 'tab': goToTab(d.tab); break;
    case 'goSettings': UI.tab = 'settings'; UI.sheet = null; UI.pageFormReturn = null; render(); break;
    case 'goTrips': safe(async () => { await loadTripsList(); UI.screen = 'trips'; render(); }); break;
    case 'openTrip': safe(async () => { await loadTrip(d.id); UI.screen = 'trip'; UI.tab = 'dashboard'; UI.sheet = null; render(); }); break;
    case 'newTrip': openPageForm('trip'); break;
    case 'editTripInfo': openPageForm('tripInfo'); break;

    /* ---- generic sheet control ---- */
    case 'closeSheet':
      if (UI.sheet === 'pageForm' || UI.sheet === 'form') { closePageForm(); } else { UI.sheet = null; UI.pageFormReturn = null; }
      UI.detail = null; render(); break;
    case 'openCategory': UI.sheet = 'category'; UI.detail = d.id; render(); break;
    case 'openRecordDetail': UI.sheet = 'recordDetail'; UI.detail = d.id; render(); break;
    case 'openTravelerDetail': UI.sheet = 'travelerDetail'; UI.detail = d.id; render(); break;
    case 'openSettingsSub': UI.sheet = 'settingsSub'; UI.settingsSection = d.section; render(); break;

    /* ---- money-form sheets ---- */
    case 'quickAdd': quickAdd(); break;
    case 'quickAddPick': quickAddPick(d.kind); break;
    case 'closeQuickAddMenu': UI.quickAddMenu = false; render(); break;
    case 'openForm': openForm(d.kind, d.id || null); break;
    case 'setForm': setForm({ [d.field]: d.value }); break;
    case 'setTaxMode': setTaxMode(d.mode); break;
    case 'toggleSplit': toggleSplit(); break;
    case 'toggleSplitParticipant': toggleSplitParticipant(d.id); break;
    case 'removePendingReceipt': if (UI.form) { UI.form.receiptFile = null; UI.form.receiptPreviewUrl = null; } render(); break;
    case 'saveForm': safe(saveForm); break;

    /* ---- page-form sheets (plain field forms) ---- */
    case 'openPageForm': openPageForm(d.kind, d.id || null); break;
    case 'pageChip': setPageForm({ [d.field]: d.value }); break;
    case 'savePageForm': safe(savePageForm); break;

    /* ---- records ---- */
    case 'recordsFilter': UI.recordsFilter = d.filter; render(); break;
    case 'editRecord': UI.sheet = null; openForm(d.kind, d.id); break;
    case 'deleteRecord':
      askConfirm('Delete this record? This cannot be undone.', async () => {
        await deleteTransaction(d.id);
        UI.sheet = null; UI.detail = null; render();
      }, { confirmLabel: 'Delete', danger: true });
      break;
    case 'removeReceipt': safe(async () => { await removeReceipt(d.id); render(); }); break;

    /* ---- split ---- */
    case 'openSettlementFor': openForm('settlement', null, { travelerId: d.travelerId, amount: Number(d.amount) }); break;

    /* ---- transport ---- */
    case 'openTopUp': openForm('topup', null, { destinationAccountId: d.walletId }); break;

    /* ---- settings: config management ---- */
    case 'addTraveler': openPageForm('newTraveler'); break;
    case 'editTraveler': openPageForm('editTraveler', d.id); break;
    case 'removeTraveler': safe(async () => { await removeTraveler(d.id); render(); }); break;
    case 'addCategory': openPageForm('newCategory'); break;
    case 'removeCategory': safe(async () => { await removeCategory(d.id); render(); }); break;
    case 'addTransportType': openPageForm('newTransportType'); break;
    case 'removeTransportType': safe(async () => { await removeTransportType(d.id); render(); }); break;
    case 'removeAccount': safe(async () => { await removeAccount(d.id); render(); }); break;
    case 'removePass': safe(async () => { await removePass(d.id); render(); }); break;

    /* ---- trip lifecycle ---- */
    case 'completeTrip':
      askConfirm('Mark this trip as completed? New records will be locked.', async () => {
        await setTripStatus('completed'); render();
      }, { confirmLabel: 'Complete trip' });
      break;
    case 'reactivateTrip': safe(async () => { await setTripStatus('active'); render(); }); break;
    case 'duplicateTrip': safe(async () => { const t = await duplicateTrip(Data.trip.id); showToast('Duplicated as "' + t.name + '"'); }); break;
    case 'deleteTrip':
      askConfirm('Delete this trip and all its data? This cannot be undone.', async () => {
        await deleteTrip(Data.trip.id);
        Data.trip = null; UI.screen = 'trips'; render();
      }, { confirmLabel: 'Delete trip', danger: true });
      break;
    case 'deleteAllData':
      askConfirm('Delete ALL trips and all local data on this device? This cannot be undone.', async () => {
        await DB.clearAll();
        Data.trip = null; Data.trips = [];
        UI.screen = 'trips'; render();
      }, { confirmLabel: 'Delete everything', danger: true });
      break;

    /* ---- confirm dialog ---- */
    case 'cancelConfirm': UI.confirmDialog = null; render(); break;
    case 'confirmYes':
      safe(async () => {
        const action = UI.confirmDialog && UI.confirmDialog.action;
        UI.confirmDialog = null;
        if (action) await action();
      });
      break;

    /* ---- data export/import ---- */
    case 'exportBackup': safe(() => exportBackup()); break;
    case 'exportCsv': safe(() => exportCsv()); break;
    case 'exportPdf': safe(() => exportPdfView()); break;
    case 'triggerImport': document.getElementById('import-file-input').click(); break;

    default: break;
  }
}

document.addEventListener('change', e => {
  if (e.target && e.target.id === 'import-file-input') {
    const file = e.target.files && e.target.files[0];
    if (file) safe(async () => { await importBackup(file); e.target.value = ''; render(); });
  }
});
