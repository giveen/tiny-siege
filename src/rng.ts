// Deterministic seeded RNG (mulberry32) so a run is reproducible from its seed.

export class RNG {
  private s: number;

  constructor(seed?: number) {
    this.s = (seed ?? ((Math.random() * 2 ** 32) >>> 0)) >>> 0;
    if (this.s === 0) this.s = 0x9e3779b9;
  }

  get seed(): number {
    return this.s >>> 0;
  }

  /** float in [0, 1) */
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length) % arr.length];
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Fisher–Yates shuffle (returns a new array). */
  shuffle<T>(arr: readonly T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}
