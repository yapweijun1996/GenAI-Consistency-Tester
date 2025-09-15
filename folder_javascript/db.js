const DB_NAME = 'GeminiTesterDB';
const STORE_NAME = 'Settings';
let db;

async function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject("Error opening DB");
    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
  });
}

export async function dbGet(key) {
  if (!db) await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onerror = () => reject("Error getting data from DB");
    request.onsuccess = () => resolve(request.result?.value);
  });
}

export async function dbSet(key, value) {
  if (!db) await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put({ key, value });
    request.onerror = () => reject("Error setting data in DB");
    request.onsuccess = () => resolve(request.result);
  });
}

export async function loadApiKey() {
    await initDB();
    return await dbGet('gemini_api_key');
}