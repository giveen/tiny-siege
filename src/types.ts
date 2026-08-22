// Shared types used across the game (kept dependency-light to avoid cycles).

import type { UnitColor } from "./assets";

export type TowerType = "archer" | "lancer" | "cannon" | "monastery";

export interface TowerStats {
  damage: number;
  rate: number; // attacks per second
  range: number;
  splash: number; // AoE radius (0 = single target)
  pierce: number; // extra enemies a lancer spear passes through
  projSpeed: number;
  buffDmg: number; // monastery: damage bonus to nearby towers
  buffSpeed: number; // monastery: speed bonus to nearby towers
}

/** Global multipliers modified by roguelite boons. */
export interface Buffs {
  damageMult: number;
  speedMult: number;
  rangeMult: number;
  splashMult: number;
  pierceBonus: number;
  goldKillMult: number;
  goldWaveMult: number;
  killGoldFlat: number;
  arrowSlow: number; // 0..1 slow applied by archer arrows
  arrowBurnDps: number; // burn DoT applied by archer arrows
  castleHpMult: number;
  castleDmgReduction: number; // 0..1
  castleAuraDps: number; // ballista: castle damages nearby enemies
  synergy: number; // +damage per adjacent allied tower
  enemyHpMult: number; // risky boons can raise this
}

export function defaultBuffs(): Buffs {
  return {
    damageMult: 1,
    speedMult: 1,
    rangeMult: 1,
    splashMult: 1,
    pierceBonus: 0,
    goldKillMult: 1,
    goldWaveMult: 1,
    killGoldFlat: 0,
    arrowSlow: 0,
    arrowBurnDps: 0,
    castleHpMult: 1,
    castleDmgReduction: 0,
    castleAuraDps: 0,
    synergy: 0,
    enemyHpMult: 1,
  };
}

export interface CastleState {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

export type Color = UnitColor;
