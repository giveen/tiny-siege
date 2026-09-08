// Minimal browser shims so the game's real modules run in plain Node
// (headless balance harness — see balance_sim.ts).
//
// Only the surface the *simulation* touches is implemented: the game loop
// never renders or plays audio here, so the 2D context is a no-op proxy,
// the AudioContext is absent (Audio.unlock() catches and stays silent), and
// localStorage is an in-memory map. Import this module BEFORE ../src/game.

// ---------------------------------------------------------------- canvas
function makeFakeCtx(): unknown {
  // Universal "anything goes" 2D context: every method call returns the same
  // chainable value (so value-returning APIs like measureText(...).width or
  // createLinearGradient(...).addColorStop(...) work), property reads return
  // small numbers, and drawing is a no-op. Set properties are remembered.
  const stored: Record<PropertyKey, unknown> = {};
  const value: unknown = new Proxy(
    function () {},
    {
      get(_t, prop) {
        if (prop in stored) return stored[prop];
        if (prop === "width") return 8;
        if (prop === "height") return 8;
        if (prop === "ok") return true;
        if (prop === "then" || prop === "iterator") return undefined;
        if (prop === Symbol.toPrimitive) return () => 0;
        return value;
      },
      set(_t, prop, v) {
        stored[prop] = v;
        return true;
      },
      apply() {
        return value;
      },
    }
  );
  return value;
}

/** A just-enough canvas element for Input/pointer plumbing and no-op drawing. */
export function makeFakeCanvas(): HTMLCanvasElement {
  const ctx = makeFakeCtx();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100, x: 0, y: 0, right: 100, bottom: 100 }),
  } as unknown as HTMLCanvasElement;
  return canvas;
}

// ---------------------------------------------------------------- storage
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }
  get length(): number {
    return this.store.size;
  }
}

// ---------------------------------------------------------------- install
let installed = false;

export function installBrowserStubs(): void {
  if (installed) return;
  installed = true;

  const g = globalThis as Record<string, unknown>;

  if (g.localStorage === undefined) g.localStorage = new MemoryStorage();

  if (g.window === undefined) {
    // No AudioContext on purpose: Audio.unlock() fails soft and stays silent.
    g.window = {
      addEventListener: () => {},
      removeEventListener: () => {},
      setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms ?? 0),
      clearTimeout: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>),
      dispatchEvent: () => false,
    };
  }

  if (g.document === undefined) {
    // Only sprite.tintedImage() touches document, and only when drawing with
    // a tint — the headless sim never draws, but be safe.
    g.document = { createElement: () => makeFakeCanvas() };
  }

  if (g.requestAnimationFrame === undefined) {
    // The Game constructor schedules one frame; it never fires in headless.
    g.requestAnimationFrame = () => 0;
  }
}

installBrowserStubs();
