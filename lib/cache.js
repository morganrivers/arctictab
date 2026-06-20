const DB_NAME = "arctictab";
const STORE = "embeddings";
const VERSION = 1;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function keyFor(url) {
  const bytes = new TextEncoder().encode(url);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function getMany(urls) {
  const keys = await Promise.all(urls.map(keyFor));
  const db = await open();
  const tx = db.transaction(STORE, "readonly");
  const store = tx.objectStore(STORE);
  const results = keys.map(
    (k) =>
      new Promise((res) => {
        const r = store.get(k);
        r.onsuccess = () => res(r.result || null);
        r.onerror = () => res(null);
      }),
  );
  const out = await Promise.all(results);
  db.close();
  return out;
}

export async function put(url, embedding, text) {
  console.assert(embedding instanceof Float32Array, "embedding must be Float32Array");
  const key = await keyFor(url);
  const db = await open();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put({ key, url, embedding, text, ts: Date.now() });
  await new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
  db.close();
}
