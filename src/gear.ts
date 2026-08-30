// Gear: equipment (helm / armor / ring). Pieces are won from Supply Crates —
// a gacha lootbox bought with the crate currency banked between runs — and
// can then be equipped, per tower type, one piece per slot, from the Armory
// in the main menu. A piece's bonus scales linearly with its tier.

import type { TowerType } from "./types";
import type { RNG } from "./rng";

export type GearSlot = "helm" | "armor" | "ring";
export type GearStat = "damage" | "rate" | "range" | "splash" | "bless" | "health";

/** One stat roll on a gear piece. `base` is the bonus % per tier (total =
 *  base * tier); `unlockTier` is the tier at which this stat kicks in — a
 *  piece's later stats only come online as it's upgraded at the Blacksmith. */
export interface GearStatRoll {
  stat: GearStat;
  base: number;
  unlockTier: number;
}

export interface GearDef {
  id: string;
  name: string;
  icon: string; // file under assets/gear/
  slot: GearSlot;
  tower: TowerType;
  /** 2 stats for helm/armor, 3 for the capstone ring slot; ordered by unlockTier. */
  stats: GearStatRoll[];
}

export interface GearInstance {
  uid: string;
  def: string;
  tier: number;
}

/** Persistent vault state (lives in MetaState.gear). */
export interface GearState {
  owned: GearInstance[];
  /** uid of the piece equipped in each (tower, slot). */
  equipped: Record<TowerType, Partial<Record<GearSlot, string>>>;
}

export function emptyGearState(): GearState {
  return {
    owned: [],
    equipped: {
      archer: {},
      lancer: {},
      cannon: {},
      monastery: {},
      barracks: {},
      wizard: {},
      alchemist: {},
      ballista: {},
    },
  };
}

export const GEAR_SLOTS: GearSlot[] = ["helm", "armor", "ring"];
export const SLOT_LABEL: Record<GearSlot, string> = { helm: "Helm", armor: "Armor", ring: "Ring" };
export const TIER_MAX = 5;
/** 1-based tier color (index 0 unused). */
export const TIER_COLORS = ["", "#c9d6e2", "#7ec87e", "#6fb7ff", "#c58bff", "#ffd24a"];

/** helm/armor: primary at T1, a second stat wakes up at T3.
 *  ring (capstone slot): primary + secondary, plus a third stat at T5. */
const two = (stat: GearStat, base: number, stat2: GearStat, base2: number): GearStatRoll[] => [
  { stat, base, unlockTier: 1 },
  { stat: stat2, base: base2, unlockTier: 3 },
];
const three = (stat: GearStat, base: number, stat2: GearStat, base2: number, stat3: GearStat, base3: number): GearStatRoll[] => [
  { stat, base, unlockTier: 1 },
  { stat: stat2, base: base2, unlockTier: 3 },
  { stat: stat3, base: base3, unlockTier: 5 },
];

export const GEARS: GearDef[] = [
  // ---------------- archer post
  { id: "archer_sentinel", name: "Sentinel Helm", icon: "archer_sentinel", slot: "helm", tower: "archer", stats: two("rate", 10, "range", 8) },
  { id: "archer_ranger", name: "Ranger's Coif", icon: "archer_ranger", slot: "helm", tower: "archer", stats: two("damage", 12, "rate", 8) },
  { id: "archer_warden", name: "Warden Plate", icon: "archer_warden", slot: "armor", tower: "archer", stats: two("range", 10, "damage", 8) },
  { id: "archer_hunter", name: "Hunter Tunic", icon: "archer_hunter", slot: "armor", tower: "archer", stats: two("rate", 12, "range", 8) },
  { id: "archer_eagle", name: "Eagle Ring", icon: "archer_eagle", slot: "ring", tower: "archer", stats: three("damage", 10, "range", 8, "rate", 6) },
  { id: "archer_swift", name: "Swift Signet", icon: "archer_swift", slot: "ring", tower: "archer", stats: three("range", 12, "damage", 8, "rate", 6) },
  // ---------------- lance tower
  { id: "lancer_horned", name: "Horned Warhelm", icon: "lancer_horned", slot: "helm", tower: "lancer", stats: two("damage", 14, "rate", 8) },
  { id: "lancer_crimson", name: "Crimson Plume", icon: "lancer_crimson", slot: "helm", tower: "lancer", stats: two("rate", 10, "damage", 8) },
  { id: "lancer_vanguard", name: "Vanguard Cuirass", icon: "lancer_vanguard", slot: "armor", tower: "lancer", stats: two("range", 10, "damage", 8) },
  { id: "lancer_surcoat", name: "Lancer's Surcoat", icon: "lancer_surcoat", slot: "armor", tower: "lancer", stats: two("rate", 12, "range", 8) },
  { id: "lancer_warlord", name: "Warlord Signet", icon: "lancer_warlord", slot: "ring", tower: "lancer", stats: three("damage", 14, "rate", 8, "range", 6) },
  { id: "lancer_keen", name: "Keen Ring", icon: "lancer_keen", slot: "ring", tower: "lancer", stats: three("rate", 10, "damage", 8, "range", 6) },
  // ---------------- cannon
  { id: "cannon_powder", name: "Powderhelm", icon: "cannon_powder", slot: "helm", tower: "cannon", stats: two("damage", 12, "splash", 8) },
  { id: "cannon_fusilier", name: "Fusilier Coif", icon: "cannon_fusilier", slot: "helm", tower: "cannon", stats: two("splash", 10, "damage", 8) },
  { id: "cannon_blast", name: "Blast Aegis", icon: "cannon_blast", slot: "armor", tower: "cannon", stats: two("splash", 14, "rate", 8) },
  { id: "cannon_brass", name: "Brass Hauberk", icon: "cannon_brass", slot: "armor", tower: "cannon", stats: two("rate", 10, "splash", 8) },
  { id: "cannon_salvage", name: "Salvage Ring", icon: "cannon_salvage", slot: "ring", tower: "cannon", stats: three("splash", 12, "damage", 8, "rate", 6) },
  { id: "cannon_flint", name: "Flint Signet", icon: "cannon_flint", slot: "ring", tower: "cannon", stats: three("rate", 10, "splash", 8, "damage", 6) },
  // ---------------- monastery (only bless/range are meaningful support stats)
  { id: "monastery_sage", name: "Sage's Hood", icon: "monastery_sage", slot: "helm", tower: "monastery", stats: two("bless", 14, "range", 8) },
  { id: "monastery_pilgrim", name: "Pilgrim Cowl", icon: "monastery_pilgrim", slot: "helm", tower: "monastery", stats: two("range", 12, "bless", 8) },
  { id: "monastery_benevolent", name: "Benevolent Robe", icon: "monastery_benevolent", slot: "armor", tower: "monastery", stats: two("bless", 14, "range", 8) },
  { id: "monastery_aura", name: "Aura Vest", icon: "monastery_aura", slot: "armor", tower: "monastery", stats: two("range", 12, "bless", 8) },
  { id: "monastery_sanctum", name: "Sanctum Ring", icon: "monastery_sanctum", slot: "ring", tower: "monastery", stats: three("bless", 14, "range", 8, "bless", 5) },
  { id: "monastery_glow", name: "Glowing Gem", icon: "monastery_glow", slot: "ring", tower: "monastery", stats: three("bless", 10, "range", 6, "bless", 5) },
  // ---------------- barracks (stats describe the soldiers it musters)
  { id: "barracks_drill", name: "Drillmaster's Cap", icon: "barracks_drill", slot: "helm", tower: "barracks", stats: two("rate", 10, "health", 8) },
  { id: "barracks_hawk", name: "Hawk Helm", icon: "barracks_hawk", slot: "helm", tower: "barracks", stats: two("damage", 12, "rate", 8) },
  { id: "barracks_cuirass", name: "Guard Cuirass", icon: "barracks_cuirass", slot: "armor", tower: "barracks", stats: two("health", 14, "damage", 8) },
  { id: "barracks_tunic", name: "Muster Tunic", icon: "barracks_tunic", slot: "armor", tower: "barracks", stats: two("rate", 10, "health", 8) },
  { id: "barracks_signet", name: "Vanguard Signet", icon: "barracks_signet", slot: "ring", tower: "barracks", stats: three("damage", 12, "health", 8, "rate", 6) },
  { id: "barracks_loyal", name: "Loyalist Ring", icon: "barracks_loyal", slot: "ring", tower: "barracks", stats: three("health", 10, "damage", 8, "rate", 6) },
  // ---------------- alchemist's hut
  { id: "alchemist_hood", name: "Poisoner's Hood", icon: "alchemist_hood", slot: "helm", tower: "alchemist", stats: two("rate", 10, "splash", 8) },
  { id: "alchemist_cowl", name: "Tainted Cowl", icon: "alchemist_cowl", slot: "helm", tower: "alchemist", stats: two("damage", 12, "rate", 8) },
  { id: "alchemist_vest", name: "Corrosive Vest", icon: "alchemist_vest", slot: "armor", tower: "alchemist", stats: two("splash", 14, "damage", 8) },
  { id: "alchemist_robes", name: "Miasma Robes", icon: "alchemist_robes", slot: "armor", tower: "alchemist", stats: two("rate", 10, "splash", 8) },
  { id: "alchemist_band", name: "Reagent Band", icon: "alchemist_band", slot: "ring", tower: "alchemist", stats: three("damage", 10, "splash", 8, "rate", 6) },
  { id: "alchemist_signet", name: "Vial Signet", icon: "alchemist_signet", slot: "ring", tower: "alchemist", stats: three("splash", 12, "damage", 8, "rate", 6) },
  // ---------------- ballista nest
  { id: "ballista_sallet", name: "Marksman's Sallet", icon: "ballista_sallet", slot: "helm", tower: "ballista", stats: two("damage", 14, "rate", 8) },
  { id: "ballista_crest", name: "Crimson Crest Helm", icon: "ballista_crest", slot: "helm", tower: "ballista", stats: two("rate", 10, "damage", 8) },
  { id: "ballista_plating", name: "Reinforced Plating", icon: "ballista_plating", slot: "armor", tower: "ballista", stats: two("range", 10, "damage", 8) },
  { id: "ballista_harness", name: "Loader's Harness", icon: "ballista_harness", slot: "armor", tower: "ballista", stats: two("rate", 12, "range", 8) },
  { id: "ballista_sight", name: "Sighting Ring", icon: "ballista_sight", slot: "ring", tower: "ballista", stats: three("damage", 14, "rate", 8, "range", 6) },
  { id: "ballista_windage", name: "Windage Band", icon: "ballista_windage", slot: "ring", tower: "ballista", stats: three("range", 12, "damage", 8, "rate", 6) },
];

export const GEAR_BY_ID = new Map(GEARS.map((g) => [g.id, g]));

export function gearBySlotTower(tower: TowerType): GearDef[] {
  return GEARS.filter((g) => g.tower === tower);
}

/** The stat rolls currently active on a piece at a given tier (a piece's
 *  later rolls only switch on once the piece is upgraded that far). */
export function gearActiveStats(def: GearDef, tier: number): GearStatRoll[] {
  return def.stats.filter((s) => s.unlockTier <= tier);
}

/** The next stat still waiting to unlock at a higher tier, if any. */
export function nextLockedStat(def: GearDef, tier: number): GearStatRoll | null {
  return def.stats.find((s) => s.unlockTier > tier) ?? null;
}

/** Total bonus % a stat roll grants at a given tier. */
export function gearPercent(roll: GearStatRoll, tier: number): number {
  return roll.base * tier;
}

export function statLabel(tower: TowerType, stat: GearStat): string {
  if (tower === "monastery") return stat === "bless" ? "blessing" : "aura";
  if (tower === "barracks") return stat === "rate" ? "muster" : stat === "health" ? "health" : "damage";
  switch (stat) {
    case "damage":
      return "damage";
    case "rate":
      return "fire rate";
    case "range":
      return "range";
    case "splash":
      return "splash";
    case "bless":
      return "power";
    case "health":
      return "health";
  }
}

/** Short human line, one segment per active stat: "+24% damage · +8% range". */
export function gearBonusText(def: GearDef, tier: number): string {
  return gearActiveStats(def, tier)
    .map((s) => `+${gearPercent(s, tier)}% ${statLabel(def.tower, s.stat)}`)
    .join(" · ");
}

// ---------------------------------------------------------------- drops
/** Tier of a drop at a given wave: T1 (waves 1-4) ... T5 (wave 21+). */
export function gearTierForWave(wave: number): number {
  return Math.min(TIER_MAX, 1 + Math.floor(wave / 5));
}

let uidCounter = 0;
function nextUid(): string {
  uidCounter++;
  return "g" + Date.now().toString(36) + uidCounter.toString(36) + Math.floor(Math.random() * 1296).toString(36);
}

/** A guaranteed drop of a given tier (e.g. the victory bonus). */
export function makeGearDrop(tier: number, rng: RNG): GearInstance {
  const def = GEARS[Math.floor(rng.next() * GEARS.length)];
  return { uid: nextUid(), def: def.id, tier: Math.min(TIER_MAX, Math.max(1, tier)) };
}

// ---------------------------------------------------------------- supply crates (gacha)
/** Crate currency cost to open one Supply Crate (one random gear piece). */
export const LOOTBOX_COST = 10;

/**
 * Fortune ladder: [T1..T5] tier odds per pull at Crate Fortune level l (0..5).
 * Base (level 0) is T1 80% / T2 20% — no chance of higher tiers. Each relic
 * level shifts 10% of the odds off T1, into T3 (lvl 1), then T4 (lvl 2),
 * then straight into T5 (lvl 3+).
 */
export const LOOTBOX_FORTUNE_MAX = 5;
export const LOOTBOX_FORTUNE_WEIGHTS: number[][] = [
  [80, 20, 0, 0, 0],
  [70, 20, 10, 0, 0],
  [60, 20, 10, 10, 0],
  [50, 20, 10, 10, 10],
  [40, 20, 10, 10, 20],
  [30, 20, 10, 10, 30],
];

/** Tier odds per pull at a given Fortune level, 1-based (index 0 unused). */
export function lootboxTierWeights(fortuneLevel: number): number[] {
  const l = Math.min(LOOTBOX_FORTUNE_MAX, Math.max(0, Math.floor(fortuneLevel)));
  return [0, ...LOOTBOX_FORTUNE_WEIGHTS[l]];
}

/** One line of tier odds for UI: "T1 80% · T2 20% · T3 0% · T4 0% · T5 0%". */
export function lootboxOddsText(fortuneLevel: number): string {
  const w = lootboxTierWeights(fortuneLevel);
  return `T1 ${w[1]}% · T2 ${w[2]}% · T3 ${w[3]}% · T4 ${w[4]}% · T5 ${w[5]}%`;
}

/** Roll one gear piece from a Supply Crate at a given Fortune level. */
export function rollLootbox(rng: RNG, fortuneLevel = 0): GearInstance {
  const weights = lootboxTierWeights(fortuneLevel);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng.next() * total;
  let tier = TIER_MAX;
  for (let t = 1; t <= TIER_MAX; t++) {
    r -= weights[t];
    if (r <= 0) {
      tier = t;
      break;
    }
  }
  const def = GEARS[Math.floor(rng.next() * GEARS.length)];
  return { uid: nextUid(), def: def.id, tier };
}

// ---------------------------------------------------------------- blacksmith
/** Scrap gained by recycling a piece. */
export function scrapValue(inst: GearInstance): number {
  return inst.tier * 3;
}

/** Scrap cost to raise a piece from its tier to tier+1. */
export function gearUpgradeCost(inst: GearInstance): number {
  return inst.tier * 5;
}

/** Aggregated fractional bonuses for a tower type, from its equipped pieces. */
export interface GearBonus {
  damage: number;
  rate: number;
  range: number;
  splash: number;
  bless: number;
  /** Soldier health (barracks only). */
  health: number;
}

export const EMPTY_GEAR_BONUS: GearBonus = { damage: 0, rate: 0, range: 0, splash: 0, bless: 0, health: 0 };
