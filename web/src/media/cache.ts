// A short-lived cache for a server's replies, so returning to a screen
// reuses them. A failed request is not kept.

/** Replies are reused for a minute. */
const MAX_AGE = 60_000;

export function createCache() {
  // Entries stay in the order they were stored, oldest first.
  const entries = new Map<string, { at: number; value: Promise<unknown> }>();
  return {
    /** The reply stored under `key` if it is fresh, else `load()`'s. */
    cached<T>(key: string, load: () => Promise<T>): Promise<T> {
      const now = Date.now();
      const hit = entries.get(key);
      if (hit && now - hit.at < MAX_AGE) return hit.value as Promise<T>;
      for (const [k, entry] of entries) {
        if (now - entry.at < MAX_AGE) break;
        entries.delete(k);
      }
      const value = load();
      entries.delete(key);
      entries.set(key, { at: now, value });
      // Only this request's own entry goes: a newer one under the key stays.
      value.catch(() => entries.get(key)?.value === value && entries.delete(key));
      return value;
    },
    /** Drop every reply, after changes such as playback or watched state. */
    clear(): void {
      entries.clear();
    },
  };
}
