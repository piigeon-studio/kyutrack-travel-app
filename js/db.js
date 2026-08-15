/* IndexedDB persistence layer. Every store keeps immutable-ish source records;
   derived numbers are always recomputed by ledger.js, never cached here. */

const DB_NAME = 'kyu-db';
const DB_VERSION = 1;
const STORES = ['trips', 'travelers', 'categories', 'accounts', 'transportTypes', 'passes', 'transactions', 'receipts', 'meta'];

let _dbPromise = null;

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('trips')) db.createObjectStore('trips', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      ['travelers', 'categories', 'accounts', 'transportTypes', 'passes', 'transactions', 'receipts'].forEach(name => {
        if (!db.objectStoreNames.contains(name)) {
          const os = db.createObjectStore(name, { keyPath: 'id' });
          os.createIndex('tripId', 'tripId', { unique: false });
        }
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

async function tx(storeName, mode) {
  const db = await openDb();
  return db.transaction(storeName, mode).objectStore(storeName);
}

const DB = {
  async put(store, obj) {
    const os = await tx(store, 'readwrite');
    return new Promise((resolve, reject) => {
      const r = os.put(obj);
      r.onsuccess = () => resolve(obj);
      r.onerror = () => reject(r.error);
    });
  },
  async putMany(store, list) {
    const os = await tx(store, 'readwrite');
    return new Promise((resolve, reject) => {
      list.forEach(o => os.put(o));
      os.transaction.oncomplete = () => resolve();
      os.transaction.onerror = () => reject(os.transaction.error);
    });
  },
  async get(store, id) {
    const os = await tx(store, 'readonly');
    return new Promise((resolve, reject) => {
      const r = os.get(id);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  },
  async all(store) {
    const os = await tx(store, 'readonly');
    return new Promise((resolve, reject) => {
      const r = os.getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
  },
  async byTrip(store, tripId) {
    const os = await tx(store, 'readonly');
    return new Promise((resolve, reject) => {
      const idx = os.index('tripId');
      const r = idx.getAll(tripId);
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
  },
  async delete(store, id) {
    const os = await tx(store, 'readwrite');
    return new Promise((resolve, reject) => {
      const r = os.delete(id);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  },
  async deleteByTrip(store, tripId) {
    const items = await DB.byTrip(store, tripId);
    const os = await tx(store, 'readwrite');
    return new Promise((resolve, reject) => {
      items.forEach(i => os.delete(i.id));
      os.transaction.oncomplete = () => resolve();
      os.transaction.onerror = () => reject(os.transaction.error);
    });
  },
  async setMeta(key, value) { return DB.put('meta', { key, value }); },
  async getMeta(key) { const r = await DB.get('meta', key); return r ? r.value : null; },
  async clearAll() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORES, 'readwrite');
      STORES.forEach(s => t.objectStore(s).clear());
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }
};
