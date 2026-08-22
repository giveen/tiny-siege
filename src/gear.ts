// Gear: equipment (helm / armor / ring) that enemies drop during a run.
// Dropped pieces are banked permanently and can be equipped — per tower
// type, one piece per slot — from the Armory in the main menu. A piece's
// bonus scales linearly with its tier; higher waves drop higher tiers.

import type { TowerType } from "./types";
import type { RNG } from "./rng";

export type GearSlot = "helm" | "armor" | "ring";
export type GearStat = "damage" | "rate" | "range" | "splash" | "bless" | "health";

export interface GearDef {
  id: string;
  name: string;
  icon: string; // file under assets/gear/
  slot: GearSlot;
  tower: TowerType;
  stat: GearStat;
  /** Bonus % at tier 1; total bonus = base * tier. */
  base: number;
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
  return { owned: [], equipped: { archer: {}, lancer: {}, cannon: {}, monastery: {}, barracks: {}, wizard: {} } };
}

export const GEAR_SLOTS: GearSlot[] = ["helm", "armor", "ring"];
export const SLOT_LABEL: Record<GearSlot, string> = { helm: "Helm", armor: "Armor", ring: "Ring" };
export const TIER_MAX = 5;
/** 1-based tier color (index 0 unused). */
export const TIER_COLORS = ["", "#c9d6e2", "#7ec87e", "#6fb7ff", "#c58bff", "#ffd24a"];

export const GEARS: GearDef[] = [
  // ---------------- archer post
  { id: "archer_sentinel", name: "Sentinel Helm", icon: "archer_sentinel", slot: "helm", tower: "archer", stat: "rate", base: 10 },
  { id: "archer_ranger", name: "Ranger's Coif", icon: "archer_ranger", slot: "helm", tower: "archer", stat: "damage", base: 12 },
  { id: "archer_warden", name: "Warden Plate", icon: "archer_warden", slot: "armor", tower: "archer", stat: "range", base: 10 },
  { id: "archer_hunter", name: "Hunter Tunic", icon: "archer_hunter", slot: "armor", tower: "archer", stat: "rate", base: 12 },
  { id: "archer_eagle", name: "Eagle Ring", icon: "archer_eagle", slot: "ring", tower: "archer", stat: "damage", base: 10 },
  { id: "archer_swift", name: "Swift Signet", icon: "archer_swift", slot: "ring", tower: "archer", stat: "range", base: 12 },
  // ---------------- lance tower
  { id: "lancer_horned", name: "Horned Warhelm", icon: "lancer_horned", slot: "helm", tower: "lancer", stat: "damage", base: 14 },
  { id: "lancer_crimson", name: "Crimson Plume", icon: "lancer_crimson", slot: "helm", tower: "lancer", stat: "rate", base: 10 },
  { id: "lancer_vanguard", name: "Vanguard Cuirass", icon: "lancer_vanguard", slot: "armor", tower: "lancer", stat: "range", base: 10 },
  { id: "lancer_surcoat", name: "Lancer's Surcoat", icon: "lancer_surcoat", slot: "armor", tower: "lancer", stat: "rate", base: 12 },
  { id: "lancer_warlord", name: "Warlord Signet", icon: "lancer_warlord", slot: "ring", tower: "lancer", stat: "damage", base: 14 },
  { id: "lancer_keen", name: "Keen Ring", icon: "lancer_keen", slot: "ring", tower: "lancer", stat: "rate", base: 10 },
  // ---------------- cannon
  { id: "cannon_powder", name: "Powderhelm", icon: "cannon_powder", slot: "helm", tower: "cannon", stat: "damage", base: 12 },
  { id: "cannon_fusilier", name: "Fusilier Coif", icon: "cannon_fusilier", slot: "helm", tower: "cannon", stat: "splash", base: 10 },
  { id: "cannon_blast", name: "Blast Aegis", icon: "cannon_blast", slot: "armor", tower: "cannon", stat: "splash", base: 14 },
  { id: "cannon_brass", name: "Brass Hauberk", icon: "cannon_brass", slot: "armor", tower: "cannon", stat: "rate", base: 10 },
  { id: "cannon_salvage", name: "Salvage Ring", icon: "cannon_salvage", slot: "ring", tower: "cannon", stat: "splash", base: 12 },
  { id: "cannon_flint", name: "Flint Signet", icon: "cannon_flint", slot: "ring", tower: "cannon", stat: "rate", base: 10 },
  // ---------------- monastery
  { id: "monastery_sage", name: "Sage's Hood", icon: "monastery_sage", slot: "helm", tower: "monastery", stat: "bless", base: 14 },
  { id: "monastery_pilgrim", name: "Pilgrim Cowl", icon: "monastery_pilgrim", slot: "helm", tower: "monastery", stat: "range", base: 12 },
  { id: "monastery_benevolent", name: "Benevolent Robe", icon: "monastery_benevolent", slot: "armor", tower: "monastery", stat: "bless", base: 14 },
  { id: "monastery_aura", name: "Aura Vest", icon: "monastery_aura", slot: "armor", tower: "monastery", stat: "range", base: 12 },
  { id: "monastery_sanctum", name: "Sanctum Ring", icon: "monastery_sanctum", slot: "ring", tower: "monastery", stat: "bless", base: 14 },
  { id: "monastery_glow", name: "Glowing Gem", icon: "monastery_glow", slot: "ring", tower: "monastery", stat: "bless", base: 10 },
  // ---------------- barracks (stats describe the soldiers it musters)
  { id: "barracks_drill", name: "Drillmaster's Cap", icon: "barracks_drill", slot: "helm", tower: "barracks", stat: "rate", base: 10 },
  { id: "barracks_hawk", name: "Hawk Helm", icon: "barracks_hawk", slot: "helm", tower: "barracks", stat: "damage", base: 12 },
  { id: "barracks_cuirass", name: "Guard Cuirass", icon: "barracks_cuirass", slot: "armor", tower: "barracks", stat: "health", base: 14 },
  { id: "barracks_tunic", name: "Muster Tunic", icon: "barracks_tunic", slot: "armor", tower: "barracks", stat: "rate", base: 10 },
  { id: "barracks_signet", name: "Vanguard Signet", icon: "barracks_signet", slot: "ring", tower: "barracks", stat: "damage", base: 12 },
  { id: "barracks_loyal", name: "Loyalist Ring", icon: "barracks_loyal", slot: "ring", tower: "barracks", stat: "health", base: 10 },
];

export const GEAR_BY_ID = new Map(GEARS.map((g) => [g.id, g]));

export function gearBySlotTower(tower: TowerType): GearDef[] {
  return GEARS.filter((g) => g.tower === tower);
}

/** Total bonus % a piece grants at its tier. */
export function gearPercent(def: GearDef, tier: number): number {
  return def.base * tier;
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

/** Short human line: "+24% damage". */
export function gearBonusText(def: GearDef, tier: number): string {
  return `+${gearPercent(def, tier)}% ${statLabel(def.tower, def.stat)}`;
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

/** Roll a gear drop for a cleared wave: guaranteed on boss waves (every 5th),
 *  otherwise a 40% chance. Returns null when nothing drops. */
export function rollGearDrop(wave: number, rng: RNG): GearInstance | null {
  const boss = wave % 5 === 0;
  if (!boss && rng.next() > 0.4) return null;
  const def = GEARS[Math.floor(rng.next() * GEARS.length)];
  return { uid: nextUid(), def: def.id, tier: gearTierForWave(wave) };
}

/** A guaranteed drop of a given tier (e.g. the victory bonus). */
export function makeGearDrop(tier: number, rng: RNG): GearInstance {
  const def = GEARS[Math.floor(rng.next() * GEARS.length)];
  return { uid: nextUid(), def: def.id, tier: Math.min(TIER_MAX, Math.max(1, tier)) };
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
