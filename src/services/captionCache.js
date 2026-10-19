// Word timings can be larger than the transcript itself. Bound both the number
// of sources and the serialized text retained, and expire stale entries.
export function createCaptionCache({ maxEntries = 12, maxCharacters = 2_000_000, ttl = 5 * 60_000, now = Date.now } = {}) {
  const entries = new Map();
  let characters = 0;
  const remove = key => {
    const entry = entries.get(key);
    if (entry) characters -= entry.size;
    entries.delete(key);
  };
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        remove(key);
        return undefined;
      }
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key, value) {
      remove(key);
      const time = now();
      for (const [id, entry] of entries) if (entry.expiresAt <= time) remove(id);
      const size = JSON.stringify(value).length;
      if (size > maxCharacters) return;
      entries.set(key, { value, size, expiresAt: time + ttl });
      characters += size;
      while (entries.size > maxEntries || characters > maxCharacters) remove(entries.keys().next().value);
    },
    delete: remove,
    clear() { entries.clear(); characters = 0; },
  };
}
