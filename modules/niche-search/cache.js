const TTL_MS = 60 * 60 * 1000;
const store = new Map();

function cacheKey(niche, location, limit) {
  return `${niche.trim().toLowerCase()}|${location.trim().toLowerCase()}|${limit}`;
}

function get(niche, location, limit) {
  const key = cacheKey(niche, location, limit);
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > TTL_MS) {
    store.delete(key);
    return null;
  }
  return { ...entry.value, cached: true };
}

function set(niche, location, limit, value) {
  const key = cacheKey(niche, location, limit);
  store.set(key, { at: Date.now(), value: { ...value, cached: false } });
}

function clear() {
  store.clear();
}

module.exports = { get, set, clear, cacheKey };
