import type { RNG } from "./rng";
import type { EnemyType } from "./enemy";
import type { UnitColor } from "./assets";
import { ENEMY_COLORS } from "./assets";
import { SIEGE_WAVE } from "./config";

export interface SpawnEntry {
  type: EnemyType;
  color: UnitColor;
  time: number; // seconds into the wave
}

function weightedPick(rng: RNG, types: EnemyType[], weights: Record<EnemyType, number>): EnemyType {
  let total = 0;
  for (const t of types) total += weights[t] ?? 0;
  let r = rng.next() * total;
  for (const t of types) {
    r -= weights[t] ?? 0;
    if (r <= 0) return t;
  }
  return types[types.length - 1];
}

/** Build the full spawn schedule for a wave. */
export function generateWave(N: number, rng: RNG): SpawnEntry[] {
  const entries: SpawnEntry[] = [];
  const isBoss = N % 5 === 0;

  // Pacing: waves 1-4 are frail speedsters only (the starting island is
  // small and early towers are weak). The armored heavies (warrior/beetle/
  // lancer/skeleton) only join after an island growth, and the Minotaur
  // itself appears solely on boss waves — the 5th, right before each growth.
  const available: EnemyType[] = ["pawn"];
  if (N >= 2) available.push("archer");
  if (N >= 3) {
    available.push("mushroom");
    available.push("mantis");
  }
  if (N >= 6) {
    available.push("warrior");
    available.push("fly3");
  }
  if (N >= 7) {
    available.push("healer");
    available.push("flydemon");
  }
  if (N >= 8) available.push("beetle");
  if (N >= 10) available.push("lancer");
  if (N >= 11) available.push("skeleton");

  const weights: Record<EnemyType, number> = {
    pawn: 10,
    archer: 6,
    warrior: 5,
    lancer: 3,
    healer: 2,
    mushroom: 0,
    skeleton: 0,
    flydemon: 0,
    mantis: 0,
    beetle: 0,
    fly3: 0,
    boss: 0,
  };
  // introduce + shift weight toward new/tougher types over time
  // (weights only matter once the type is in `available`)
  if (N >= 3) {
    weights.mushroom = 5;
    weights.mantis = 4;
  }
  if (N >= 6) {
    weights.warrior = 6;
    weights.fly3 = 3;
  }
  if (N >= 7) weights.flydemon = 4;
  if (N >= 8) {
    weights.beetle = 4;
    weights.healer += 1;
  }
  if (N >= 9) weights.fly3 += 2;
  if (N >= 10) {
    weights.lancer = 5;
    weights.flydemon += 1;
    weights.mantis += 1;
    weights.beetle += 1;
  }
  if (N >= 11) weights.skeleton = 5;

  let count = 5 + Math.floor(N * 1.35);
  if (isBoss) count = Math.max(4, Math.floor(count * 0.6));

  let t = 0.5;
  const squad = 3 + rng.int(0, 2);
  let ci = 0;
  for (let i = 0; i < count; i++) {
    const type = weightedPick(rng, available, weights);
    const color = ENEMY_COLORS[ci % ENEMY_COLORS.length];
    ci++;
    entries.push({ type, color, time: t });
    const gap = Math.max(0.28, rng.range(0.4, 0.85) - N * 0.012);
    t += gap;
    if (i % squad === squad - 1) t += rng.range(0.5, 1.3);
  }

  if (isBoss) {
    entries.push({ type: "boss", color: rng.pick(ENEMY_COLORS), time: 2.5 });
    if (N % 15 === 0) entries.push({ type: "boss", color: rng.pick(ENEMY_COLORS), time: 9 });
    // escort healers for bosses
    if (N >= 10) entries.push({ type: "healer", color: rng.pick(ENEMY_COLORS), time: 3.5 });
  }

  // The Siege (final wave): a full Minotaur assault — the run's climax.
  if (N === SIEGE_WAVE) {
    const bc = () => rng.pick(ENEMY_COLORS);
    entries.push({ type: "boss", color: bc(), time: 8 });
    entries.push({ type: "boss", color: bc(), time: 15 });
    entries.push({ type: "healer", color: bc(), time: 5 });
    entries.push({ type: "healer", color: bc(), time: 12 });
    entries.push({ type: "healer", color: bc(), time: 18 });
  }

  entries.sort((a, b) => a.time - b.time);
  return entries;
}
