// Small math + misc utilities shared across the game.

export interface Vec {
  x: number;
  y: number;
}

export const v = (x: number, y: number): Vec => ({ x, y });

export function add(a: Vec, b: Vec): Vec {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec, b: Vec): Vec {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec, s: number): Vec {
  return { x: a.x * s, y: a.y * s };
}

export function len(a: Vec): number {
  return Math.hypot(a.x, a.y);
}

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function norm(a: Vec): Vec {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
}

export function angleTo(a: Vec, b: Vec): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

export function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Move `a` toward `b` by at most `maxDelta`; returns new value.
export function approach(a: number, b: number, maxDelta: number): number {
  if (a < b) return Math.min(a + maxDelta, b);
  if (a > b) return Math.max(a - maxDelta, b);
  return b;
}

export function randInt(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

// Format a number compactly (1234 -> 1.2k).
export function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "m";
  if (n >= 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return Math.round(n).toString();
}
