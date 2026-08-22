import type { Game } from "./game";
import type { RNG } from "./rng";
import type { TowerType } from "./types";

export type Rarity = "common" | "rare" | "epic";

export const RARITY_COLOR: Record<Rarity, string> = {
  common: "#9fd0ff",
  rare: "#c58bff",
  epic: "#ffce5a",
};
const RARITY_WEIGHT: Record<Rarity, number> = { common: 100, rare: 45, epic: 16 };

export interface Boon {
  id: string;
  name: string;
  desc: string;
  icon: number; // avatar index 0..24
  rarity: Rarity;
  maxStacks: number;
  weight: number; // extra multiplier on top of rarity weight
  available?: (game: Game) => boolean;
  apply: (game: Game) => void;
}

const unlock = (type: TowerType) => (game: Game) => !game.unlocked.has(type);

export const BOONS: Boon[] = [
  // ---- Economy ----
  {
    id: "war_chest",
    name: "War Chest",
    desc: "+60 gold, immediately.",
    icon: 0,
    rarity: "common",
    maxStacks: 99,
    weight: 1.2,
    apply: (g) => {
      g.gold += 60;
    },
  },
  {
    id: "bounty",
    name: "Bounty",
    desc: "+2 gold from every kill.",
    icon: 1,
    rarity: "common",
    maxStacks: 5,
    weight: 1.0,
    apply: (g) => {
      g.buffs.killGoldFlat += 2;
    },
  },
  {
    id: "mint",
    name: "Royal Mint",
    desc: "+20% gold from kills.",
    icon: 2,
    rarity: "rare",
    maxStacks: 3,
    weight: 1.0,
    apply: (g) => {
      g.buffs.goldKillMult *= 1.2;
    },
  },
  {
    id: "tax",
    name: "Tax Collector",
    desc: "+30% gold at the end of each wave.",
    icon: 3,
    rarity: "rare",
    maxStacks: 3,
    weight: 1.0,
    apply: (g) => {
      g.buffs.goldWaveMult *= 1.3;
    },
  },
  // ---- Tower stats ----
  {
    id: "sharp",
    name: "Sharpened Arrows",
    desc: "+20% Archer Post damage.",
    icon: 4,
    rarity: "common",
    maxStacks: 3,
    weight: 1.0,
    apply: (g) => {
      g.archerDamageMult *= 1.2;
    },
  },
  {
    id: "quickdraw",
    name: "Quick Draw",
    desc: "+20% Archer Post attack speed.",
    icon: 5,
    rarity: "common",
    maxStacks: 3,
    weight: 1.0,
    apply: (g) => {
      g.archerSpeedMult *= 1.2;
    },
  },
  {
    id: "heavy",
    name: "War Council",
    desc: "+15% damage from ALL towers.",
    icon: 6,
    rarity: "rare",
    maxStacks: 4,
    weight: 1.0,
    apply: (g) => {
      g.buffs.damageMult *= 1.15;
    },
  },
  {
    id: "overdrive",
    name: "Drummers",
    desc: "+12% attack speed from ALL towers.",
    icon: 7,
    rarity: "rare",
    maxStacks: 3,
    weight: 1.0,
    apply: (g) => {
      g.buffs.speedMult *= 1.12;
    },
  },
  {
    id: "longbow",
    name: "Eagle-Eyed Scouts",
    desc: "+12% range from ALL towers.",
    icon: 8,
    rarity: "rare",
    maxStacks: 3,
    weight: 1.0,
    apply: (g) => {
      g.buffs.rangeMult *= 1.12;
    },
  },
  {
    id: "splash",
    name: "Volatile Powder",
    desc: "+28% Cannon splash radius.",
    icon: 9,
    rarity: "rare",
    maxStacks: 3,
    weight: 1.0,
    available: (g) => g.unlocked.has("cannon"),
    apply: (g) => {
      g.buffs.splashMult *= 1.28;
    },
  },
  {
    id: "pierce",
    name: "Javelin Drill",
    desc: "Lancer spears pierce +1 more enemy.",
    icon: 10,
    rarity: "rare",
    maxStacks: 3,
    weight: 1.0,
    available: (g) => g.unlocked.has("lancer"),
    apply: (g) => {
      g.buffs.pierceBonus += 1;
    },
  },
  // ---- Unlocks ----
  {
    id: "unlock_lancer",
    name: "Recruit Lancers",
    desc: "Unlocks the Lance Tower (piercing spears).",
    icon: 11,
    rarity: "common",
    maxStacks: 1,
    weight: 1.4,
    available: (g) => unlock("lancer")(g),
    apply: (g) => {
      g.unlocked.add("lancer");
    },
  },
  {
    id: "unlock_cannon",
    name: "Artillery Train",
    desc: "Unlocks the Cannon (splash damage).",
    icon: 12,
    rarity: "common",
    maxStacks: 1,
    weight: 1.4,
    available: (g) => unlock("cannon")(g),
    apply: (g) => {
      g.unlocked.add("cannon");
    },
  },
  {
    id: "unlock_monastery",
    name: "Found a Monastery",
    desc: "Unlocks the Monastery (blesses nearby towers).",
    icon: 13,
    rarity: "common",
    maxStacks: 1,
    weight: 1.3,
    available: (g) => unlock("monastery")(g),
    apply: (g) => {
      g.unlocked.add("monastery");
    },
  },
  {
    id: "unlock_barracks",
    name: "Conscript the Militia",
    desc: "Unlocks the Barracks (musters soldiers to hold the road).",
    icon: 16,
    rarity: "rare",
    maxStacks: 1,
    weight: 1.1,
    available: (g) => unlock("barracks")(g) && g.wave >= 5,
    apply: (g) => {
      g.unlocked.add("barracks");
    },
  },
  {
    id: "unlock_wizard",
    name: "The Arcane Academy",
    desc: "Unlocks the Wizard Tower (evolving arcane bolts).",
    icon: 17,
    rarity: "rare",
    maxStacks: 1,
    weight: 1.0,
    available: (g) => unlock("wizard")(g) && g.wave >= 8,
    apply: (g) => {
      g.unlocked.add("wizard");
    },
  },
  // ---- Castle ----
  {
    id: "reinforce",
    name: "Reinforce",
    desc: "+15% max castle HP and heal by the same amount.",
    icon: 14,
    rarity: "common",
    maxStacks: 4,
    weight: 1.0,
    apply: (g) => {
      g.castle.maxHp = Math.round(g.castle.maxHp * 1.15);
      g.castle.hp = Math.min(g.castle.maxHp, g.castle.hp + Math.round(g.castle.maxHp * 0.15));
    },
  },
  {
    id: "repair",
    name: "Repair Party",
    desc: "Restore 35 castle HP right now.",
    icon: 15,
    rarity: "common",
    maxStacks: 99,
    weight: 1.1,
    apply: (g) => {
      g.castle.hp = Math.min(g.castle.maxHp, g.castle.hp + 35);
    },
  },
  {
    id: "walls",
    name: "Thicker Walls",
    desc: "The castle takes 12% less damage.",
    icon: 16,
    rarity: "rare",
    maxStacks: 3,
    weight: 1.0,
    apply: (g) => {
      g.buffs.castleDmgReduction = Math.min(0.75, g.buffs.castleDmgReduction + 0.12);
    },
  },
  {
    id: "ballista",
    name: "Castle Ballista",
    desc: "The castle hurls bolts, hurting nearby enemies (+6/s, stacks).",
    icon: 17,
    rarity: "epic",
    maxStacks: 3,
    weight: 1.0,
    apply: (g) => {
      g.buffs.castleAuraDps += 6;
    },
  },
  // ---- Special / risky ----
  {
    id: "frost",
    name: "Frost Arrows",
    desc: "Archer arrows slow enemies by 25% for 1s.",
    icon: 18,
    rarity: "epic",
    maxStacks: 2,
    weight: 1.0,
    apply: (g) => {
      g.buffs.arrowSlow = Math.min(0.6, g.buffs.arrowSlow + 0.25);
    },
  },
  {
    id: "fire",
    name: "Fire Arrows",
    desc: "Archer arrows burn for 8 damage/s (+4 each).",
    icon: 19,
    rarity: "rare",
    maxStacks: 3,
    weight: 1.0,
    apply: (g) => {
      g.buffs.arrowBurnDps += g.buffs.arrowBurnDps === 0 ? 8 : 4;
    },
  },
  {
    id: "synergy",
    name: "Battle Line",
    desc: "Each tower gets +6% damage per adjacent allied tower.",
    icon: 20,
    rarity: "epic",
    maxStacks: 3,
    weight: 1.0,
    apply: (g) => {
      g.buffs.synergy += 0.06;
    },
  },
  {
    id: "cursed_gold",
    name: "Cursed Gold",
    desc: "+50% all gold, but enemies gain +18% max HP.",
    icon: 21,
    rarity: "epic",
    maxStacks: 2,
    weight: 0.9,
    apply: (g) => {
      g.buffs.goldKillMult *= 1.5;
      g.buffs.goldWaveMult *= 1.5;
      g.buffs.enemyHpMult *= 1.18;
    },
  },
  {
    id: "adrenaline",
    name: "War Adrenaline",
    desc: "+20% tower attack speed, but -12% tower damage.",
    icon: 22,
    rarity: "rare",
    maxStacks: 2,
    weight: 0.9,
    apply: (g) => {
      g.buffs.speedMult *= 1.2;
      g.buffs.damageMult *= 0.88;
    },
  },
];

/** Roll up to `n` distinct, currently-available boons, weighted by rarity. */
export function rollBoons(game: Game, rng: RNG, n = 3): Boon[] {
  // Sage's Insight (meta) shifts the odds toward rarer boons.
  const sage = game.sageLevel ?? 0;
  const rw: Record<Rarity, number> = {
    common: RARITY_WEIGHT.common,
    rare: RARITY_WEIGHT.rare + sage * 18,
    epic: RARITY_WEIGHT.epic + sage * 12,
  };
  const pool = BOONS.filter((b) => {
    if (game.countBoon(b.id) >= b.maxStacks) return false;
    if (b.available && !b.available(game)) return false;
    return true;
  });
  const result: Boon[] = [];
  const used = new Set<string>();
  let guard = 60;
  while (result.length < n && pool.length > 0 && guard-- > 0) {
    let total = 0;
    for (const b of pool) if (!used.has(b.id)) total += rw[b.rarity] * b.weight;
    if (total <= 0) break;
    let r = rng.next() * total;
    let chosen: Boon | null = null;
    for (const b of pool) {
      if (used.has(b.id)) continue;
      r -= rw[b.rarity] * b.weight;
      if (r <= 0) {
        chosen = b;
        break;
      }
    }
    if (!chosen) chosen = pool[pool.length - 1];
    used.add(chosen.id);
    result.push(chosen);
  }
  // If we ran dry (rare), top up with any not-already-offered
  if (result.length < n) {
    for (const b of BOONS) {
      if (result.length >= n) break;
      if (!used.has(b.id) && game.countBoon(b.id) < b.maxStacks) {
        used.add(b.id);
        result.push(b);
      }
    }
  }
  return result;
}
