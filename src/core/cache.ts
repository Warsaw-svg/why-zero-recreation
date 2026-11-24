/** Tiny IndexedDB blob cache: lets repeat visits skip work that was already done (e.g. synthesised audio). Fails soft. */
const DB = 'zero-cache', STORE = 'blobs';
function open(): Promise<IDBDatabase | null> {
  return new Promise((res) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch { res(null); }
  });
}
export async function cacheGet(key: string): Promise<Blob | null> {
  const db = await open(); if (!db) return null;
  return new Promise((res) => {
    try {
      const q = db.transaction(STORE).objectStore(STORE).get(key);
      q.onsuccess = () => res((q.result as Blob | undefined) ?? null);
      q.onerror = () => res(null);
    } catch { res(null); }
  });
}
export async function cacheSet(key: string, blob: Blob): Promise<void> {
  const db = await open(); if (!db) return;
  try { db.transaction(STORE, 'readwrite').objectStore(STORE).put(blob, key); } catch { /* ignore */ }
}
