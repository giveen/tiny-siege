// Persistent meta-progression (between runs): a rune economy + relic unlock
// tree, the Supply Crate currency (spent on gacha lootboxes of gear), and the
// gear vault. A lost (or won) run still banks runes + crates, so every
// attempt moves you closer to the build you're chasing. Stored in localStorage.

import { emptyGearState, LOOTBOX_FORTUNE_MAX, lootboxOddsText, type GearState } from "./gear";
import { queuePersist } from "./persist";

export const META_KEY = "tinysiege.meta.v1";

/** A real-time research in progress (persisted, completes while away). */
export interface ResearchJob {
  /** Relic id being researched. */
  id: string;
  /** Level applied once completesAt has passed. */
  level: number;
  startedAt: number;
  completesAt: number;
}

export interface MetaState {
  runes: number;
  levels: Record<string, number>;
  gear: GearState;
  /** Blacksmith currency from recycled gear; spends on tier upgrades. */
  scrap: number;
  /** Supply Crate currency banked from cleared waves; spent on gacha lootboxes. */
  crates: number;
  /** At most one research at a time (null = idle). */
  research: ResearchJob | null;
}

export interface Relic {
  id: string;
  name: string;
  blurb: string;
  maxLevel: number;
  /** Cost in runes to buy level (level -> level+1); `level` is the current level. */
  cost: (level: number) => number;
  /** Human-readable effect at a given level. */
  effect: (level: number) => string;
  /** If present, levels are researched in real time instead of applying
   *  instantly: ms it takes to research from `level` to `level+1`. */
  research?: (level: number) => number;
}

/** One hour in ms (research durations). */
const HOUR = 3_600_000;

/** A branch is a linear chain of relics: node i>0 only becomes purchasable
 *  once node i-1 is fully maxed — the Codex's "research tree" shape. */
export interface RelicBranch {
  id: string;
  name: string;
  nodeIds: string[];
}

export const RELIC_BRANCHES: RelicBranch[] = [
  { id: "economy", name: "Economy", nodeIds: ["provisions", "mint", "treasury", "caravan"] },
  { id: "defense", name: "Defense", nodeIds: ["bastion", "walls", "menders"] },
  { id: "offense", name: "Offense", nodeIds: ["armory", "lookouts", "drums", "siege_engineers"] },
  { id: "support", name: "Support", nodeIds: ["quartermaster", "recruit", "sage", "vanguard_scouts"] },
];

export const RELICS: Relic[] = [
  // ---------------------------------------------------------------- economy
  {
    id: "provisions",
    name: "Provisions",
    blurb: "Start each siege with more gold.",
    maxLevel: 5,
    cost: (l) => 12 + l * 10,
    effect: (l) => `+${l * 40} starting gold`,
  },
  {
    id: "mint",
    name: "Mint",
    blurb: "Every kill and wave pays more.",
    maxLevel: 5,
    cost: (l) => 16 + l * 12,
    effect: (l) => `+${l * 8}% gold earned`,
  },
  {
    id: "treasury",
    name: "Treasury",
    blurb: "The Crown pays a larger bonus for a won siege.",
    maxLevel: 5,
    cost: (l) => 20 + l * 15,
    effect: (l) => `+${l * 4} victory runes & crates`,
  },
  {
    id: "caravan",
    name: "Caravan",
    blurb: "A supply caravan arrives every fifth wave.",
    maxLevel: 5,
    cost: (l) => 24 + l * 16,
    effect: (l) => `+${l * 20} gold every 5th wave`,
  },
  // ---------------------------------------------------------------- defense
  {
    id: "bastion",
    name: "Bastion",
    blurb: "Fortify the castle before every run.",
    maxLevel: 5,
    cost: (l) => 12 + l * 10,
    effect: (l) => `+${l * 25} max castle HP`,
  },
  {
    id: "walls",
    name: "Walls",
    blurb: "Thicker walls, permanently, every run.",
    maxLevel: 5,
    cost: (l) => 18 + l * 14,
    effect: (l) => `-${l * 5}% castle damage taken`,
  },
  {
    id: "menders",
    name: "Menders",
    blurb: "Field medics patch the castle after every wave.",
    maxLevel: 5,
    cost: (l) => 20 + l * 16,
    effect: (l) => `+${l * 8} castle HP restored per wave`,
  },
  // ---------------------------------------------------------------- offense
  {
    id: "armory",
    name: "Armory",
    blurb: "Your towers hit harder.",
    maxLevel: 5,
    cost: (l) => 16 + l * 12,
    effect: (l) => `+${l * 8}% tower damage`,
  },
  {
    id: "lookouts",
    name: "Lookouts",
    blurb: "Towers spot enemies from farther away.",
    maxLevel: 5,
    cost: (l) => 16 + l * 12,
    effect: (l) => `+${l * 10}% tower range`,
  },
  {
    id: "drums",
    name: "War Drums",
    blurb: "Every tower keeps a faster tempo.",
    maxLevel: 5,
    cost: (l) => 16 + l * 12,
    effect: (l) => `+${l * 8}% tower fire rate`,
  },
  {
    id: "siege_engineers",
    name: "Siege Engineers",
    blurb: "Every blast radius grows a little wider.",
    maxLevel: 5,
    cost: (l) => 22 + l * 16,
    effect: (l) => `+${l * 6}% splash radius (all towers)`,
  },
  // ---------------------------------------------------------------- support
  {
    id: "quartermaster",
    name: "Quartermaster",
    blurb: "Builds and upgrades cost less, every run.",
    maxLevel: 5,
    cost: (l) => 16 + l * 12,
    effect: (l) => `-${l * 8}% build & upgrade cost`,
  },
  {
    id: "recruit",
    name: "Old Guard",
    blurb: "More tower types ready at the start — all eight at max.",
    maxLevel: 7,
    cost: (l) => 40 + l * 30,
    effect: (l) => `Start with ${1 + l} tower type${l ? "s" : ""}`,
  },
  {
    id: "sage",
    name: "Sage's Insight",
    blurb: "Boons lean rarer each run.",
    maxLevel: 3,
    cost: (l) => 30 + l * 25,
    effect: (l) => `Boon rarity +${l}`,
  },
  {
    id: "vanguard_scouts",
    name: "Vanguard Scouts",
    blurb: "Scouts turn up an extra option after every wave.",
    maxLevel: 2,
    cost: (l) => 30 + l * 28,
    effect: (l) => `+${l} boon choice${l > 1 ? "s" : ""} offered`,
  },
  {
    id: "fortune",
    name: "Crate Fortune",
    blurb: "Supply Crates lean rarer — each level shifts 10% of the odds off T1.",
    maxLevel: LOOTBOX_FORTUNE_MAX,
    cost: (l) => 80 * 2 ** l,
    effect: (l) => lootboxOddsText(l),
    research: (l) => HOUR * 2 ** l, // 1h, 2h, 4h, 8h, 16h
  },
];

const RELIC_BY_ID = new Map(RELICS.map((r) => [r.id, r]));

/** Which branch (and position within it) a relic belongs to, if any. */
function branchNodeIndex(id: string): { branch: RelicBranch; index: number } | null {
  for (const b of RELIC_BRANCHES) {
    const index = b.nodeIds.indexOf(id);
    if (index >= 0) return { branch: b, index };
  }
  return null;
}

/** A branch node beyond the first requires the previous node in its chain to
 *  be fully maxed — the tree's prerequisite gate. */
export function relicPrereqMet(m: MetaState, id: string): boolean {
  const loc = branchNodeIndex(id);
  if (!loc || loc.index === 0) return true;
  const prevId = loc.branch.nodeIds[loc.index - 1];
  const prev = RELIC_BY_ID.get(prevId);
  if (!prev) return true;
  return relicLevel(m, prevId) >= prev.maxLevel;
}

/** The relic (if any) that must be maxed before this one unlocks. */
export function relicPrereqOf(id: string): Relic | null {
  const loc = branchNodeIndex(id);
  if (!loc || loc.index === 0) return null;
  return RELIC_BY_ID.get(loc.branch.nodeIds[loc.index - 1]) ?? null;
}

/** A fresh MetaState with no storage access (tests / seeding). */
export function emptyMetaState(): MetaState {
  return { runes: 0, levels: {}, gear: emptyGearState(), scrap: 0, crates: 0, research: null };
}

export function loadMeta(): MetaState {
  const state = { runes: 0, levels: {} as Record<string, number>, gear: emptyGearState(), scrap: 0, crates: 0, research: null as ResearchJob | null };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      state.runes = typeof p.runes === "number" ? p.runes : 0;
      state.levels = p.levels && typeof p.levels === "object" ? p.levels : {};
      state.scrap = typeof p.scrap === "number" ? p.scrap : 0;
      // Migrate pre-crate saves: absent field means zero.
      state.crates = typeof p.crates === "number" ? p.crates : 0;
      // Migrate pre-gear saves: keep owned/equipped only if the shapes are sane.
      const g = p.gear;
      if (g && typeof g === "object" && Array.isArray(g.owned) && g.equipped && typeof g.equipped === "object") {
        state.gear = { owned: g.owned, equipped: g.equipped };
      }
      // Migrate pre-research saves: absent field means no research in flight.
      const r = p.research;
      if (r && typeof r === "object" && typeof r.id === "string" && typeof r.level === "number" && typeof r.completesAt === "number") {
        state.research = { id: r.id, level: r.level, startedAt: typeof r.startedAt === "number" ? r.startedAt : r.completesAt, completesAt: r.completesAt };
      }
    }
  } catch {
    /* ignore */
  }
  // A research that finished while the game was closed applies now.
  tickResearch(state, Date.now());
  return state;
}

/** Records `m` for the next batched write (see persist.ts). The recorder
 *  reads the live object, so the flush persists the latest state even if
 *  more runes/crates/research landed while the timer was pending. */
export function saveMeta(m: MetaState): void {
  queuePersist(META_KEY, () => JSON.stringify(m));
}

export function relicLevel(m: MetaState, id: string): number {
  return m.levels[id] ?? 0;
}

/**
 * Apply the in-flight research's level once its completion time has passed
 * (wall-clock — it finishes while the game is closed too). Returns true if
 * a research just completed.
 */
export function tickResearch(m: MetaState, now: number): boolean {
  const r = m.research;
  if (!r || now < r.completesAt) return false;
  m.levels[r.id] = r.level;
  m.research = null;
  saveMeta(m);
  return true;
}

/** Human duration: "45m", "1h", "1h 20m". */
export function fmtDuration(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60000));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h > 0 ? (r > 0 ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
}

/** Runes granted for clearing a wave (banked immediately, so a loss still counts). */
export function runesForWave(wave: number): number {
  return 1 + Math.floor(wave / 5);
}

export const VICTORY_RUNES = 40;

/** Supply crates granted for clearing a wave (banked immediately, so a loss still counts). */
export function cratesForWave(wave: number): number {
  return 1 + Math.floor(wave / 5);
}

/** Bonus crates banked for winning the siege. */
export const VICTORY_CRATES = 20;

export function metaStartGold(level: number): number {
  return level * 40;
}
export function metaCastleHp(level: number): number {
  return level * 25;
}
export function metaDamageMult(level: number): number {
  return 1 + level * 0.08;
}
export function metaGoldMult(level: number): number {
  return 1 + level * 0.08;
}
export function metaStartTowers(level: number): number {
  return 1 + level; // 1..6 of TOWER_ORDER (all types at max)
}
export function metaCostMult(level: number): number {
  return 1 - level * 0.08;
}
export function metaRangeMult(level: number): number {
  return 1 + level * 0.1;
}
export function metaRateMult(level: number): number {
  return 1 + level * 0.08;
}
export function metaVictoryBonus(level: number): number {
  return level * 4;
}
export function metaCaravanBonus(level: number): number {
  return level * 20;
}
export function metaWallsReduction(level: number): number {
  return level * 0.05;
}
export function metaCastleRegen(level: number): number {
  return level * 8;
}
export function metaSplashMult(level: number): number {
  return 1 + level * 0.06;
}
export function metaBoonBonus(level: number): number {
  return level;
}
