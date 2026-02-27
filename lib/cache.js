// Simple in-memory LRU cache for serverless environments

const MAX_ENTRIES = 100;
const TTL_MS = 10 * 60 * 1000; // 10 minutes

const store = new Map();

export function getCache(key) {
  const entry = store.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiry) {
    store.delete(key);
    return null;
  }

  // refresh position (LRU behavior)
  store.delete(key);
  store.set(key, entry);

  return entry.value;
}

export function setCache(key, value) {
  if (store.size >= MAX_ENTRIES) {
    const oldestKey = store.keys().next().value;
    store.delete(oldestKey);
  }

  store.set(key, {
    value,
    expiry: Date.now() + TTL_MS,
  });
}
