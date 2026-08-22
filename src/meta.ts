// Persistent meta-progression (between runs): a rune economy + relic unlock
// tree, and the gear vault (equipment dropped by enemies). A lost (or won)
// run still banks runes + gear, so every attempt moves you closer to the
// build you're chasing. Stored in localStorage.

import { emptyGearState, type GearState } from "./gear";

export const META_KEY = "tinysiege.meta.v1";

export interface MetaState {
  runes: number;
  levels: Record<string, number>;
  gear: GearState;
  /** Blacksmith currency from recycled gear; spends on tier upgrades. */
  scrap: number;
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
}

export const RELICS: Relic[] = [
  {
    id: "provisions",
    name: "Provisions",
    blurb: "Start each siege with more gold.",
    maxLevel: 5,
    cost: (l) => 12 + l * 10,
    effect: (l) => `+${l * 40} starting gold`,
  },
  {
    id: "bastion",
    name: "Bastion",
    blurb: "Fortify the castle before every run.",
    maxLevel: 5,
    cost: (l) => 12 + l * 10,
    effect: (l) => `+${l * 25} max castle HP`,
  },
  {
    id: "armory",
    name: "Armory",
    blurb: "Your towers hit harder.",
    maxLevel: 5,
    cost: (l) => 16 + l * 12,
    effect: (l) => `+${l * 8}% tower damage`,
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
    id: "sage",
    name: "Sage's Insight",
    blurb: "Boons lean rarer each run.",
    maxLevel: 3,
    cost: (l) => 30 + l * 25,
    effect: (l) => `Boon rarity +${l}`,
  },
  {
    id: "recruit",
    name: "Old Guard",
    blurb: "More tower types ready at the start — all six at max.",
    maxLevel: 5,
    cost: (l) => 40 + l * 30,
    effect: (l) => `Start with ${1 + l} tower type${l ? "s" : ""}`,
  },
  {
    id: "quartermaster",
    name: "Quartermaster",
    blurb: "Builds and upgrades cost less, every run.",
    maxLevel: 5,
    cost: (l) => 16 + l * 12,
    effect: (l) => `-${l * 8}% build & upgrade cost`,
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
];

export function loadMeta(): MetaState {
  const state = { runes: 0, levels: {} as Record<string, number>, gear: emptyGearState(), scrap: 0 };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      state.runes = typeof p.runes === "number" ? p.runes : 0;
      state.levels = p.levels && typeof p.levels === "object" ? p.levels : {};
      state.scrap = typeof p.scrap === "number" ? p.scrap : 0;
      // Migrate pre-gear saves: keep owned/equipped only if the shapes are sane.
      const g = p.gear;
      if (g && typeof g === "object" && Array.isArray(g.owned) && g.equipped && typeof g.equipped === "object") {
        state.gear = { owned: g.owned, equipped: g.equipped };
      }
    }
  } catch {
    /* ignore */
  }
  return state;
}

export function saveMeta(m: MetaState): void {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

export function relicLevel(m: MetaState, id: string): number {
  return m.levels[id] ?? 0;
}

/** Runes granted for clearing a wave (banked immediately, so a loss still counts). */
export function runesForWave(wave: number): number {
  return 1 + Math.floor(wave / 5);
}

export const VICTORY_RUNES = 40;

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
