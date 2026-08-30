// Wave generation: themed family unlocks across the run.
//
// The Mega Pack has ~100 fieldable creatures, so waves no longer unlock
// individual types — they unlock FAMILIES (theme groups, see ENEMY_FAMILIES in
// enemy.ts). Within an unlocked family a random member is picked per spawn,
// so every creature in the pack shows up throughout a run.

import type { RNG } from "./rng";
import type { EnemyType, FamilyKey } from "./enemy";
import { ENEMY_FAMILIES, FAMILY_KEYS } from "./enemy";
import { SIEGE_WAVE, ENDLESS_ELITE_INTERVAL, ENDLESS_ELITE_FRACTION } from "./config";

export interface SpawnEntry {
  type: EnemyType;
  time: number; // seconds into the wave
  /** Endless mode: a tougher, higher-reward reinforcement (see enemy.ts). */
  elite?: boolean;
}

// ---------------------------------------------------------------------------
// Family unlock schedule
// ---------------------------------------------------------------------------

// Row: [family, unlockWave, baseWeight, tier]
//   tier 1 = light/early flavor, tier 2 = mid, tier 3 = heavy/late.
// Once every family is unlocked, the tier shifts the composition toward the
// heavy families so late waves feel meatier without new content.

type Tier = 1 | 2 | 3;

const FAMILY_SCHEDULE: Array<readonly [FamilyKey, number, number, Tier]> = [
  ["scavengers", 1, 6, 1], // rats, ticks, bugs — frail speedsters
  ["strays", 1, 5, 1], // goblin, mirrorfiend, traveler
  ["forest", 2, 6, 1], // imps, bushling, girl, nymph
  ["chaos", 3, 4, 2],
  ["blobs", 3, 4, 1],
  ["plague", 4, 5, 1],
  ["junkyard", 5, 6, 3], // armored scrap heavies
  ["night", 6, 3, 1],
  ["wisp", 6, 4, 2], // first flyers
  ["fire", 7, 4, 1],
  ["molten", 7, 4, 2],
  ["shell", 8, 5, 3], // armored tortoises
  ["spectral", 9, 4, 2],
  ["clockwork", 10, 4, 2],
  ["undead", 11, 5, 3], // skeletons, reapers
  ["frost", 12, 5, 3], // golems, the big gorilla
  ["cave", 13, 3, 1],
  ["abyss", 14, 6, 3], // the 19-strong deep pack
  ["spiders", 15, 4, 2],
  ["toxic", 16, 5, 2], // sludge that leaves poison patches
  ["dust", 17, 3, 2],
  ["volcano", 18, 4, 3], // drakling + imp
  ["phantom", 19, 4, 3], // minotaurs
];

// The schedule must cover every family in the roster.
{
  const covered = new Set<FamilyKey>(FAMILY_SCHEDULE.map((r) => r[0]));
  for (const k of FAMILY_KEYS) {
    if (!covered.has(k)) throw new Error(`FAMILY_SCHEDULE has no unlock wave for family "${k}"`);
  }
}

const TIER_SHIFT: Record<Tier, number> = { 1: 1, 2: 1.25, 3: 1.6 };
/** Once every family is in, heavier families take a bigger share. */
const TIER_SHIFT_FROM = Math.max(...FAMILY_SCHEDULE.map((r) => r[1]));

function familyWeights(N: number): Array<readonly [FamilyKey, number]> {
  const shift = N >= TIER_SHIFT_FROM;
  return FAMILY_SCHEDULE.filter(([, at]) => N >= at).map(([k, , w, tier]) => [
    k,
    w * (shift ? TIER_SHIFT[tier] : 1),
  ]);
}

function weightedPickFamily(rng: RNG, N: number): FamilyKey {
  const items = familyWeights(N);
  let total = 0;
  for (const [, w] of items) total += w;
  let r = rng.next() * total;
  for (const [k, w] of items) {
    r -= w;
    if (r <= 0) return k;
  }
  return items[items.length - 1][0];
}

/** One enemy pick: a family by weight, then a random member of it. */
function pickType(rng: RNG, N: number): EnemyType {
  const family = weightedPickFamily(rng, N);
  return rng.pick(ENEMY_FAMILIES[family]);
}

// ---------------------------------------------------------------------------
// Wave builder
// ---------------------------------------------------------------------------

/** Build the full spawn schedule for a wave. */
export function generateWave(N: number, rng: RNG): SpawnEntry[] {
  const entries: SpawnEntry[] = [];
  const isBoss = N % 5 === 0;

  let count = 5 + Math.floor(N * 1.35);
  if (isBoss) count = Math.max(4, Math.floor(count * 0.6));

  // Endless (past the Siege): every ENDLESS_ELITE_INTERVAL waves, a chunk of
  // this wave's spawns are reinforced as tougher, higher-reward Elites —
  // fresh challenge without needing new enemy content.
  const endlessWaves = N - SIEGE_WAVE;
  const eliteWave = endlessWaves > 0 && endlessWaves % ENDLESS_ELITE_INTERVAL === 0;

  // Themed surge: once the whole roster is available, most waves pick one
  // family to feature — 55% of the spawns come from it, so waves read as
  // "the junkyard wave" or "the abyss wave" instead of an even stew.
  const featured = N >= 25 ? weightedPickFamily(rng, N) : null;

  let t = 0.5;
  const squad = 3 + rng.int(0, 2);
  for (let i = 0; i < count; i++) {
    const type =
      featured && rng.chance(0.55) ? rng.pick(ENEMY_FAMILIES[featured]) : pickType(rng, N);
    const elite = eliteWave && rng.chance(ENDLESS_ELITE_FRACTION);
    entries.push({ type, time: t, elite });
    const gap = Math.max(0.28, rng.range(0.4, 0.85) - N * 0.012);
    t += gap;
    if (i % squad === squad - 1) t += rng.range(0.5, 1.3);
  }

  if (isBoss) {
    entries.push({ type: "boss", time: 2.5 });
    if (N % 15 === 0) entries.push({ type: "boss", time: 9 });
    // escort healers for bosses
    if (N >= 10) entries.push({ type: "healer", time: 3.5 });
  }

  // The Siege (final wave): a full boss assault — the run's climax.
  if (N === SIEGE_WAVE) {
    entries.push({ type: "boss", time: 8 });
    entries.push({ type: "boss", time: 15 });
    entries.push({ type: "healer", time: 5 });
    entries.push({ type: "healer", time: 12 });
    entries.push({ type: "healer", time: 18 });
  }

  entries.sort((a, b) => a.time - b.time);
  return entries;
}
