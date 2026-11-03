/** Device token lives in localStorage AND IndexedDB (iOS may clear one of them). */
const KEY = 'suds.token';
const DB = 'sudsqueue';

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function idbGet(key: string): Promise<string | undefined> {
  try {
    const db = await idb();
    return await new Promise((res) => {
      const q = db.transaction('kv').objectStore('kv').get(key);
      q.onsuccess = () => res(q.result as string | undefined);
      q.onerror = () => res(undefined);
    });
  } catch {
    return undefined;
  }
}

async function idbSet(key: string, value: string | null) {
  try {
    const db = await idb();
    const s = db.transaction('kv', 'readwrite').objectStore('kv');
    if (value == null) s.delete(key);
    else s.put(value, key);
  } catch {
    /* private mode: localStorage still has it */
  }
}

function lsGet(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string | null) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the app still works for this session */
  }
}

export async function loadToken(): Promise<string | null> {
  const t = lsGet(KEY) ?? (await idbGet(KEY)) ?? null;
  if (t) saveToken(t);
  return t;
}

export function saveToken(t: string | null) {
  lsSet(KEY, t);
  void idbSet(KEY, t);
}

/** Small per-device preferences. */
export const prefs = {
  get<T>(k: string, d: T): T {
    const v = lsGet(`suds.${k}`);
    if (v == null) return d;
    try {
      return JSON.parse(v) as T;
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    lsSet(`suds.${k}`, JSON.stringify(v));
  },
};
