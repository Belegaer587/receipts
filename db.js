// Minimal IndexedDB wrapper. Records: {id, created, status: 'inbox'|'sent', pageCount, pdf: Blob, preview: Blob, sentAt?}
let dbp;
function open() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('receipts-db', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('receipts', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('receipts', mode);
    const req = fn(tx.objectStore('receipts'));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const all = () => run('readonly', (s) => s.getAll());
export const put = (rec) => run('readwrite', (s) => s.put(rec));
export const del = (id) => run('readwrite', (s) => s.delete(id));
