// Batched localStorage persistence.
//
// Gameplay mutates meta/progress state in memory on every event (kills,
// gold, waves...) and calls saveMeta/saveProgress to record it. Those saves
// used to write to localStorage on every call — dozens of setItem+
// stringify pairs per second during a fight, which stalls the main thread
// on slow phones. Instead, saves register a "recorder" (key + a closure
// that produces the current JSON) with this module; one timer flushes all
// dirty records ~1s later, and everything is flushed synchronously when
// the page hides (mobile browsers kill backgrounded tabs without warning).
//
// Recorders read the live state object at flush time, so the flush always
// persists the latest in-memory state even if mutations kept coming while
// the timer was pending.

const FLUSH_MS = 1000;

interface Recorder {
  write: () => string;
}

const dirty = new Map<string, Recorder>();
let timer: ReturnType<typeof setTimeout> | null = null;

export function queuePersist(key: string, write: () => string): void {
  dirty.set(key, { write });
  if (timer === null) {
    timer = setTimeout(flush, FLUSH_MS);
  }
}

/** Write every dirty record now. Records that fail (storage full/unavailable)
 *  stay queued for the next flush. */
function flush(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  for (const [key, rec] of dirty) {
    try {
      localStorage.setItem(key, rec.write());
      dirty.delete(key);
    } catch {
      /* keep it queued; retry on the next flush */
    }
  }
}

export function flushPersist(): void {
  flush();
}

// Flush when the page is hidden/closed so no progress is lost to a tab kill.
// Guarded: the headless balance sim's window stub has a no-op addEventListener.
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("pagehide", () => flushPersist());
  window.addEventListener("beforeunload", () => flushPersist());
}
