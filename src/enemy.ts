// Enemies, built on the PixelFlush "Pixel Monsters Mega Pack"
// (enemies/PixelFlush - Pixel Monsters Mega Pack). Every creature in the pack
// is its own enemy type; the six big "Boss" monsters (plus the visually
// strong Forest Boss Imp) roll under the shared `boss` type via `variants`,
// and the four healing monsters roll under the shared `healer` type.
//
// The roster below is the single source of truth: it drives the EnemyType
// union, ENEMY_DEFS, and the family tables waves.ts unlocks over the run.

import type { Game } from "./game";
import { Sprite, drawSprite } from "./sprite";
import type { AssetDef, Assets } from "./assets";
import {
  PATH_SPEED_MULT,
  ENEMY_SCALE_MULT,
  SIEGE_WAVE,
  ENDLESS_ACCEL_RATE,
  ELITE_HP_MULT,
  ELITE_DMG_MULT,
  ELITE_REWARD_MULT,
} from "./config";

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

// Row: [key, name, family, hp, speed, castleDamage, reward, scale, flags]
//   key     manifest special key (enemies/<key>_<i>.png)
//   family  theme family used by waves.ts for unlocks and composition
//   flags   f = flying (cannons can't hit it)
//           h = healer (mends nearby enemies over time)
//           aN = armor N (flat physical soak per hit)
//           p = death leaves a toxic fire patch on the path

const ROSTER = [
  // -- abyss -------------------------------------------------------------
  ["abyss_bat", "Abyss Bat", "abyss", 28, 70, 4, 3, 1.2, "f"],
  ["abyss_bat_2", "Abyss Bat II", "abyss", 36, 66, 5, 3, 1.3, "f"],
  ["abyss_blueberry", "Abyss Blueberry", "abyss", 18, 74, 3, 2, 1.05, ""],
  ["abyss_cult_leader", "Abyss Cult Leader", "abyss", 70, 46, 8, 5, 1.5, ""],
  ["abyss_drone", "Abyss Drone", "abyss", 22, 72, 3, 2, 1.1, ""],
  ["abyss_druid", "Abyss Druid", "abyss", 50, 50, 7, 4, 1.4, ""],
  ["abyss_fat_gargoyle", "Abyss Fat Gargoyle", "abyss", 60, 52, 7, 5, 1.5, "f a2"],
  ["abyss_goblin", "Abyss Goblin", "abyss", 40, 56, 5, 3, 1.4, ""],
  ["abyss_imp", "Abyss Imp", "abyss", 30, 66, 4, 3, 1.2, "f"],
  ["abyss_lurker", "Abyss Lurker", "abyss", 44, 52, 5, 4, 1.3, ""],
  ["abyss_minion", "Abyss Minion", "abyss", 34, 58, 5, 3, 1.3, ""],
  ["abyss_monster", "Abyss Monster", "abyss", 28, 64, 4, 2, 1.2, ""],
  ["abyss_reaper", "Abyss Reaper", "abyss", 80, 44, 9, 6, 1.5, ""],
  ["abyss_siren_form_1", "Abyss Siren", "abyss", 30, 60, 4, 3, 1.2, ""],
  ["abyss_siren_form_2", "Abyss Siren II", "abyss", 42, 54, 6, 3, 1.3, ""],
  ["abyss_siren_form_3", "Abyss Siren III", "abyss", 100, 46, 10, 6, 1.8, ""],
  ["abyss_slug", "Abyss Slug", "abyss", 48, 34, 6, 4, 1.4, "a2"],
  ["abyss_squid", "Abyss Squid", "abyss", 36, 56, 5, 3, 1.3, ""],
  ["abyss_tiny_slug", "Abyss Tiny Slug", "abyss", 26, 46, 4, 2, 1.2, "a1"],
  // -- blobs -------------------------------------------------------------
  ["green_blob_form_1", "Green Blob", "blobs", 30, 58, 5, 3, 1.2, ""],
  ["happy_blob", "Happy Blob", "blobs", 80, 48, 8, 4, 1.85, ""],
  ["suspicious_blob", "Suspicious Blob", "blobs", 26, 62, 5, 2, 1.2, ""],
  // -- cave ----------------------------------------------------------------
  ["cave_tiny_troll", "Cave Tiny Troll", "cave", 40, 54, 6, 3, 1.25, ""],
  ["cave_healing_troll", "Cave Healing Troll", "cave", 72, 42, 5, 6, 1.4, "h"],
  // -- chaos ---------------------------------------------------------------
  ["chaos_imp", "Chaos Imp", "chaos", 24, 66, 4, 2, 1.1, ""],
  ["chaos_weaver", "Chaos Weaver", "chaos", 32, 60, 5, 3, 1.3, ""],
  ["chaos_druid", "Chaos Druid", "chaos", 55, 48, 7, 4, 1.5, ""],
  // -- clockwork -------------------------------------------------------------
  ["clockwork_imp", "Clockwork Imp", "clockwork", 34, 58, 5, 3, 1.25, "a1"],
  ["clockwork_soldier", "Clockwork Soldier", "clockwork", 44, 52, 6, 4, 1.3, "a2"],
  ["clockwork_behemoth", "Clockwork Behemoth", "clockwork", 95, 40, 11, 5, 1.7, "a3"],
  // -- dust ------------------------------------------------------------------
  ["dust_explosioniate", "Dust Explosioniate", "dust", 36, 56, 5, 3, 1.2, ""],
  ["dust_elemental", "Dust Elemental", "dust", 55, 48, 7, 4, 1.45, "a1"],
  // -- fire -------------------------------------------------------------------
  ["fire_imp", "Fire Imp", "fire", 32, 58, 5, 3, 1.2, ""],
  ["fire_elemental", "Fire Elemental", "fire", 44, 50, 7, 4, 1.4, ""],
  // -- forest -------------------------------------------------------------------
  ["forest_boss_imp", "Forest Boss Imp", "forest", 240, 48, 18, 12, 1.6, "a2"],
  ["forest_bushling", "Forest Bushling", "forest", 22, 70, 4, 2, 1.1, ""],
  ["forest_girl", "Forest Girl", "forest", 28, 64, 5, 3, 1.2, ""],
  ["forest_healing_imp", "Forest Healing Imp", "forest", 64, 46, 5, 6, 1.3, "h"],
  ["forest_imp", "Forest Imp", "forest", 18, 76, 3, 2, 1.1, ""],
  ["forest_nymph", "Forest Nymph", "forest", 70, 50, 8, 5, 1.75, ""],
  ["forest_spider", "Forest Spider", "forest", 24, 68, 4, 2, 1.2, ""],
  // -- frost -----------------------------------------------------------------------
  ["frost_yetling", "Frost Yetling", "frost", 45, 52, 6, 4, 1.3, ""],
  ["frost_ice_buff", "Frost Ice Buff", "frost", 70, 44, 5, 6, 1.4, "h"],
  ["frost_golem", "Frost Golem", "frost", 110, 38, 12, 5, 1.65, "a3"],
  ["frost_gorilla", "Frost Gorilla", "frost", 150, 36, 14, 7, 1.85, "a3"],
  // -- junkyard -----------------------------------------------------------------------
  ["junkyard_tiny_boxer", "Junkyard Tiny Boxer", "junkyard", 34, 60, 5, 3, 1.2, ""],
  ["junkyard_goblin", "Junkyard Goblin", "junkyard", 40, 56, 5, 3, 1.2, ""],
  ["junkyard_boxer", "Junkyard Boxer", "junkyard", 60, 52, 8, 4, 1.5, "a1"],
  ["junkyard_skeleton", "Junkyard Skeleton", "junkyard", 48, 50, 7, 4, 1.3, ""],
  ["junkyard_golem", "Junkyard Golem", "junkyard", 70, 46, 9, 4, 1.55, "a2"],
  ["junkyard_brute", "Junkyard Brute", "junkyard", 90, 42, 11, 5, 1.6, "a2"],
  ["junkyard_goliath", "Junkyard Goliath", "junkyard", 100, 40, 12, 6, 1.65, "a3"],
  ["junkyard_titan", "Junkyard Titan", "junkyard", 110, 38, 13, 6, 1.7, "a3"],
  ["junkyard_buffed_titan", "Junkyard Buffed Titan", "junkyard", 130, 36, 14, 7, 1.8, "a3"],
  // -- molten -----------------------------------------------------------------------------
  ["molten_golem", "Molten Golem", "molten", 55, 46, 7, 4, 1.45, "a1"],
  ["molten_golem_2", "Molten Golem II", "molten", 75, 42, 9, 5, 1.6, "a2"],
  // -- night ------------------------------------------------------------------------------
  ["night_imp", "Night Imp", "night", 30, 62, 5, 3, 1.1, ""],
  ["night_healing_imp", "Night Healing Imp", "night", 66, 44, 5, 6, 1.3, "h"],
  // -- phantom -------------------------------------------------------------------------------
  ["phantom_minitaur", "Phantom Minitaur", "phantom", 55, 52, 7, 4, 1.3, ""],
  ["phantom_mediumtaur", "Phantom Mediumtaur", "phantom", 70, 48, 9, 4, 1.4, ""],
  ["phantom_bull", "Phantom Bull", "phantom", 85, 50, 11, 5, 1.5, "a1"],
  ["phantom_minotaur", "Phantom Minotaur", "phantom", 100, 46, 12, 6, 1.6, "a2"],
  // -- plague ---------------------------------------------------------------------------------
  ["plaguebearer_imp", "Plaguebearer Imp", "plague", 26, 64, 4, 3, 1.1, ""],
  ["plaguebearer_mono_imp", "Plaguebearer Mono Imp", "plague", 24, 66, 4, 3, 1.1, ""],
  ["plaguebearer_handless_imp", "Plaguebearer Handless Imp", "plague", 30, 60, 5, 3, 1.2, ""],
  ["plaguebearer_dog", "Plaguebearer Dog", "plague", 38, 56, 6, 3, 1.4, ""],
  // -- scavengers (small fast strays) --------------------------------------------------------------------
  ["rat", "Rat", "scavengers", 14, 78, 3, 1, 1.1, ""],
  ["tick", "Tick", "scavengers", 16, 64, 3, 1, 1.0, ""],
  ["tiny_spider", "Tiny Spider", "scavengers", 12, 84, 2, 1, 1.0, ""],
  ["lime", "Lime", "scavengers", 13, 80, 2, 1, 1.05, ""],
  ["shadowfiend", "Shadowfiend", "scavengers", 18, 72, 4, 2, 1.25, ""],
  ["large_snake", "Large Snake", "scavengers", 26, 70, 5, 2, 1.3, ""],
  ["sandworm", "Sandworm", "scavengers", 40, 52, 6, 3, 1.6, ""],
  // -- shell (armored shellers) --------------------------------------------------------------------------
  ["shell_tortoise", "Shell Tortoise", "shell", 60, 34, 9, 4, 1.35, "a3"],
  ["shell_tortoise_form_2", "Shell Tortoise II", "shell", 85, 30, 11, 5, 1.55, "a3"],
  ["shell_tortoise_form_3", "Shell Tortoise III", "shell", 130, 26, 14, 6, 1.95, "a4"],
  ["giant_turtle", "Giant Turtle", "shell", 75, 32, 10, 4, 1.45, "a3"],
  ["stone_slug_1", "Stone Slug", "shell", 65, 30, 9, 4, 1.45, "a3"],
  // -- spectral ---------------------------------------------------------------------------------------------
  ["spectral_hound", "Spectral Hound", "spectral", 34, 66, 5, 3, 1.3, ""],
  ["spectral_hound_2", "Spectral Hound II", "spectral", 38, 64, 5, 3, 1.3, ""],
  ["spectral_harvester_1", "Spectral Harvester", "spectral", 70, 52, 8, 5, 1.6, ""],
  // -- spiders ------------------------------------------------------------------------------------------------
  ["spiderling_swarm_leader", "Spiderling Swarm Leader", "spiders", 40, 58, 6, 3, 1.3, ""],
  ["giant_spider", "Giant Spider", "spiders", 120, 44, 13, 6, 1.8, "a2"],
  // -- strays (odd one-offs) -----------------------------------------------------------------------------------
  ["goblin_cutthroat", "Goblin Cutthroat", "strays", 30, 62, 5, 3, 1.2, ""],
  ["mirrorfiend", "Mirrorfiend", "strays", 34, 58, 6, 3, 1.3, ""],
  ["wierd_traveler", "Wierd Traveler", "strays", 38, 55, 6, 3, 1.3, ""],
  // -- toxic (death leaves a poison patch) -------------------------------------------------------------------------
  ["toxic_sludge_small_pile", "Toxic Sludge Small Pile", "toxic", 40, 44, 6, 3, 1.25, "p"],
  ["toxic_sludge_wisp", "Toxic Sludge Wisp", "toxic", 30, 60, 4, 3, 1.1, "p"],
  ["toxic_sludge_slime", "Toxic Sludge Slime", "toxic", 45, 48, 5, 3, 1.3, "p"],
  ["toxic_sludge_skeleton", "Toxic Sludge Skeleton", "toxic", 80, 44, 9, 5, 1.55, "p a2"],
  ["toxic_sludge_pile", "Toxic Sludge Pile", "toxic", 90, 40, 10, 5, 1.6, "p a2"],
  // -- undead (late-run skeletons and reapers) -----------------------------------------------------------------------
  ["skeleton", "Skeleton", "undead", 50, 48, 8, 4, 1.35, "a2"],
  ["skeleton_spearman", "Skeleton Spearman", "undead", 55, 46, 9, 4, 1.4, "a2"],
  ["skeleton_warrior", "Skeleton Warrior", "undead", 60, 44, 9, 4, 1.4, "a3"],
  ["skeletal_rat", "Skeletal Rat", "undead", 65, 50, 8, 5, 1.55, "a1"],
  ["reaper", "Reaper", "undead", 75, 46, 10, 5, 1.55, ""],
  ["graveyard_guardian", "Graveyard Guardian", "undead", 90, 42, 11, 5, 1.55, "a2"],
  ["shadow_man", "Shadow Man", "undead", 55, 58, 7, 4, 1.4, ""],
  // -- volcano ----------------------------------------------------------------------------------------------
  ["volcano_imp", "Volcano Imp", "volcano", 34, 58, 5, 3, 1.2, ""],
  ["volcano_drakling", "Volcano Drakling", "volcano", 95, 52, 12, 6, 1.8, "f a2"],
  // -- wisp (floating wraiths) --------------------------------------------------------------------------------
  ["wisp_wraith_1", "Wisp Wraith", "wisp", 26, 72, 4, 3, 1.2, "f"],
  ["wisp_wraith_2", "Wisp Wraith II", "wisp", 28, 70, 4, 3, 1.2, "f"],
  ["wisp_wraith_3", "Wisp Wraith III", "wisp", 50, 62, 6, 4, 1.5, "f"],
  ["wisp_wraith_4", "Wisp Wraith IV", "wisp", 24, 76, 4, 3, 1.2, "f"],
] as const;

// The six monsters that exist ONLY as boss rolls (never regular spawns).
export const BOSS_VARIANTS = [
  "cave_troll_boss",
  "dust_elemental_boss",
  "frost_boss_yeti",
  "phantom_buffed_minotaur",
  "skeletal_rat_boss",
  "volcano_drake_boss",
  "forest_boss_imp", // strong forest member; also rolls as a lesser boss
] as const;

// The four healing monsters, rolled for healer escorts.
export const HEALER_VARIANTS = [
  "cave_healing_troll",
  "forest_healing_imp",
  "night_healing_imp",
  "frost_ice_buff",
] as const;

export const ENEMY_TYPES = [...ROSTER.map((r) => r[0]), "boss", "healer"] as const;
export type EnemyType = (typeof ENEMY_TYPES)[number];

export const FAMILY_KEYS = [
  "abyss", "blobs", "cave", "chaos", "clockwork", "dust", "fire", "forest",
  "frost", "junkyard", "molten", "night", "phantom", "plague", "scavengers",
  "shell", "spectral", "spiders", "strays", "toxic", "undead", "volcano", "wisp",
] as const;
export type FamilyKey = (typeof FAMILY_KEYS)[number];

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export interface EnemyDef {
  type: EnemyType;
  /** Display name shown in tooltips. */
  name: string;
  /** Theme family (waves.ts unlocks families, not individual types). */
  family?: FamilyKey;
  /** Special asset key; pools (boss/healer) use `variants` instead. */
  special?: string;
  /** Alternate special keys; one is picked per spawn. */
  variants?: readonly string[];
  /** Flies over the path — cannons can't hit it. */
  flying?: boolean;
  hp: number;
  /** Base path speed (multiplied by PATH_SPEED_MULT). */
  speed: number;
  castleDamage: number;
  reward: number;
  /** Sprite scale (multiplied by ENEMY_SCALE_MULT). */
  scale: number;
  /** Mends nearby enemies over time. */
  healer?: boolean;
  /** Flat physical damage soaked per hit. */
  armor?: number;
  /** Death leaves a toxic fire patch on the path. */
  puddle?: boolean;
}

function armorFromFlags(flags: string): number {
  const m = /a(\d+)/.exec(flags);
  return m ? Number(m[1]) : 0;
}

function defFromRow(r: (typeof ROSTER)[number]): EnemyDef {
  const [key, name, family, hp, speed, castleDamage, reward, scale, flags] = r;
  return {
    type: key as EnemyType,
    name,
    family: family as FamilyKey,
    special: key,
    hp,
    speed,
    castleDamage,
    reward,
    scale,
    flying: flags.includes("f"),
    healer: flags.includes("h"),
    armor: armorFromFlags(flags) || undefined,
    puddle: flags.includes("p"),
  };
}

function buildDefs(): Record<EnemyType, EnemyDef> {
  const d = {} as Record<EnemyType, EnemyDef>;
  for (const r of ROSTER) d[r[0] as EnemyType] = defFromRow(r);
  d.boss = {
    type: "boss",
    name: "Boss",
    variants: BOSS_VARIANTS,
    hp: 850,
    speed: 30,
    castleDamage: 60,
    reward: 100,
    scale: 2.3,
    armor: 3,
  };
  d.healer = {
    type: "healer",
    name: "Healer",
    variants: HEALER_VARIANTS,
    hp: 70,
    speed: 45,
    castleDamage: 5,
    reward: 6,
    scale: 1.35,
    healer: true,
  };
  return d;
}

export const ENEMY_DEFS: Record<EnemyType, EnemyDef> = buildDefs();

// Fail loudly if the roster and the def table ever drift apart.
for (const t of ENEMY_TYPES) {
  if (!ENEMY_DEFS[t]) throw new Error(`ENEMY_DEFS is missing an entry for "${t}"`);
}

/** Family -> the roster member types it contains (for wave composition). */
export const ENEMY_FAMILIES: Record<FamilyKey, EnemyType[]> = (() => {
  const f = {} as Record<FamilyKey, EnemyType[]>;
  for (const k of FAMILY_KEYS) f[k] = [];
  for (const r of ROSTER) f[r[2] as FamilyKey].push(r[0] as EnemyType);
  return f;
})();

/** Display names of the boss-pool monsters (they have no roster rows of their own). */
export const SPECIAL_NAMES: Record<string, string> = {
  cave_troll_boss: "Cave Troll Boss",
  dust_elemental_boss: "Dust Elemental Boss",
  frost_boss_yeti: "Frost Boss Yeti",
  phantom_buffed_minotaur: "Phantom Buffed Minotaur",
  skeletal_rat_boss: "Skeletal Rat Boss",
  volcano_drake_boss: "Volcano Drake Boss",
};

/** The sprite AssetDef for a type (first variant for pools) — wave previews. */
export function enemyPreviewDef(assets: Assets, type: EnemyType): AssetDef {
  const d = ENEMY_DEFS[type];
  const key = d.special ?? d.variants?.[0];
  if (!key) throw new Error(`enemyPreviewDef: no sprite for ${type}`);
  return assets.special(key);
}

// ---------------------------------------------------------------------------
// Enemy
// ---------------------------------------------------------------------------

let nextId = 1;

export class Enemy {
  id = nextId++;
  def: EnemyDef;
  x = 0;
  y = 0;
  pathDist = 0;
  hp: number;
  maxHp: number;
  speed: number;
  castleDamage: number;
  reward: number;
  scale: number;
  armor: number;
  flying: boolean;
  specialKey: string;
  angle = 0;
  flipX = false;
  hitFlash = 0;
  slowUntil = 0;
  slowFactor = 1;
  burnDps = 0;
  burnUntil = 0;
  /** Cooldown for striking a blocking soldier. */
  private soldierAtk = 0;
  /** Burn damage dealt but not yet shown (DoT ticks are too small per frame). */
  dotAccum = 0;
  /** Next time a burn total may be shown as a floating number. */
  dotShowAt = 0;
  dead = false;
  reached = false;
  /** Endless mode: a tougher, higher-reward reinforcement (see waves.ts). */
  elite: boolean;
  private bob = 0;
  private sprite: Sprite;
  private healTimer = 0;

  /** Y position of the sprite anchor (raised + bobbing for flying enemies). */
  get visualY(): number {
    return this.y - (this.flying ? 26 : 0) + this.bob;
  }

  constructor(game: Game, type: EnemyType, wave: number, elite = false) {
    const base = ENEMY_DEFS[type];
    this.def = base;
    this.flying = !!base.flying;
    this.elite = elite;
    // Endless (past the Siege): a gentle accelerating term on top of the
    // normal linear per-wave scale, so the climb keeps steepening the
    // longer a run continues instead of running the pre-Siege slope out
    // forever. Elites stack a further flat multiplier on top of that.
    const endlessWaves = Math.max(0, wave - SIEGE_WAVE);
    const endlessMult = 1 + endlessWaves * endlessWaves * ENDLESS_ACCEL_RATE;
    const eliteHp = elite ? ELITE_HP_MULT : 1;
    const eliteDmg = elite ? ELITE_DMG_MULT : 1;
    const eliteReward = elite ? ELITE_REWARD_MULT : 1;
    const hpScale = (1 + wave * 0.13 + (type === "boss" ? wave * 0.02 : 0)) * endlessMult * eliteHp;
    const dmgScale = (1 + wave * 0.04) * endlessMult * eliteDmg;
    this.maxHp = Math.round(base.hp * hpScale);
    this.hp = this.maxHp;
    this.speed = base.speed * PATH_SPEED_MULT * (1 + wave * 0.008);
    this.castleDamage = Math.round(base.castleDamage * dmgScale);
    this.reward = Math.round(base.reward * (1 + wave * 0.02) * endlessMult * eliteReward);
    this.scale = base.scale * ENEMY_SCALE_MULT * (elite ? 1.15 : 1);
    this.armor = base.armor ?? 0;
    const spawn = game.world.spawnPoint();
    this.x = spawn.x;
    this.y = spawn.y;

    // Every enemy is a Mega Pack creature: pools roll one variant per spawn.
    this.specialKey = base.variants ? game.rng.pick(base.variants) : base.special!;
    this.sprite = new Sprite(game.assets.special(this.specialKey));
  }

  /** The sprite AssetDef for this enemy. */
  spriteDef(game: Game) {
    return game.assets.special(this.specialKey);
  }

  /** Display name; pools resolve to the actually-rolled variant. */
  get displayName(): string {
    return this.def.variants?.length ? SPECIAL_NAMES[this.specialKey] ?? this.def.name : this.def.name;
  }

  get pos() {
    return { x: this.x, y: this.y };
  }

  update(game: Game, dt: number): void {
    const now = game.time;

    // burn damage over time. The DoT deals tiny per-frame amounts, so show
    // the accumulated total once per 0.5s instead of a stream of "0" numbers.
    if (now < this.burnUntil && this.burnDps > 0) {
      game.damageEnemy(this, this.burnDps * dt, "burn");
      if (now >= this.dotShowAt) {
        if (this.dotAccum >= 1) {
          game.addText(this.x + (game.rng.next() - 0.5) * 16, this.y - 24, String(Math.round(this.dotAccum)), "#ff9a3c");
          this.dotAccum = 0;
        }
        this.dotShowAt = now + 0.5;
      }
    }

    // healer aura
    if (this.def.healer) {
      this.healTimer -= dt;
      if (this.healTimer <= 0) {
        this.healTimer = 0.9;
        for (const e of game.enemies) {
          if (e === this || e.dead) continue;
          if (Math.hypot(e.x - this.x, e.y - this.y) < 95) {
            const heal = Math.round(this.maxHp * 0.09);
            if (e.hp < e.maxHp) {
              e.hp = Math.min(e.maxHp, e.hp + heal);
              game.spawnHealFx(e.x, e.y);
            }
          }
        }
      }
    }

    if (this.dead) return;

    // A barracks soldier in front of us blocks the path: we stop and fight it.
    const blocker = this.flying ? null : this.blockingSoldier(game);
    if (blocker) {
      this.flipX = blocker.x >= this.x;
      this.soldierAtk -= dt;
      if (this.soldierAtk <= 0) {
        this.soldierAtk = 1.0;
        blocker.takeDamage(game, this.castleDamage);
        game.sfx("hit");
      }
      this.hitFlash = Math.max(0, this.hitFlash - dt);
      this.sprite.update(dt);
      return;
    }

    const slow = now < this.slowUntil ? this.slowFactor : 1;
    this.pathDist += this.speed * slow * dt;

    const p = game.world.pointAt(this.pathDist);
    this.x = p.x;
    this.y = p.y;
    this.angle = p.angle;
    this.flipX = Math.cos(p.angle) < 0;
    if (this.flying) this.bob = Math.sin(now * 5 + this.id * 0.7) * 5;

    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.sprite.update(dt);

    if (this.pathDist >= game.world.pathLen) {
      this.reached = true;
      this.dead = true;
      game.damageCastle(this.castleDamage);
    }
  }

  /** The nearest live barracks soldier on the path — a wall that stops the
   *  march, even while it's already striking another foe. */
  blockingSoldier(game: Game) {
    let best: import("./soldier").Soldier | null = null;
    let bd = 26;
    for (const s of game.soldiers) {
      if (s.dead) continue;
      const d = Math.abs(s.pathDist - this.pathDist);
      if (d < bd && Math.hypot(s.x - this.x, s.y - this.y) < 34) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  takeDamage(game: Game, amount: number, kind: "physical" | "burn" | "magic", armorIgnore = 0): void {
    if (this.dead) return;
    // Armor soaks flat physical damage per hit; burn and magic ignore it.
    // Sunder-style armorIgnore soaks part of the armor first.
    let dmg = amount;
    if (kind === "physical" && this.armor > 0) {
      const soak = Math.max(0, this.armor - (armorIgnore ?? 0));
      dmg = Math.max(1, dmg - soak);
    }
    this.hp -= dmg;
    this.hitFlash = 0.12;
    if (kind !== "burn") game.sfx("hit");
    if (this.hp <= 0) {
      this.dead = true;
      game.killEnemy(this);
    }
  }

  draw(ctx: CanvasRenderingContext2D, game: Game): void {
    const def = this.spriteDef(game);
    // shadow (on the ground; smaller when flying)
    const ss = this.flying ? 0.65 : 1;
    ctx.save();
    ctx.globalAlpha = this.flying ? 0.16 : 0.22;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 2, 12 * this.scale * ss, 5 * this.scale * ss, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const hit = this.hitFlash > 0;
    const burning = game.time < this.burnUntil;
    let filter: string | undefined;
    if (hit) filter = "brightness(2.2) saturate(0.4)";
    else if (burning) filter = "sepia(0.6) hue-rotate(-30deg) saturate(2) brightness(1.1)";
    drawSprite(ctx, game.assets, def, this.sprite.frameIdx, this.x, this.visualY, {
      scale: this.scale,
      flipX: this.flipX,
      filter,
    });

    // elite ring: a pulsing gold halo marking an endless-mode reinforcement
    if (this.elite) {
      ctx.save();
      ctx.globalAlpha = 0.55 + Math.sin(game.time * 4 + this.id) * 0.15;
      ctx.strokeStyle = "#ffd24a";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(this.x, this.y - 14 * this.scale, 15 * this.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // healer halo
    if (this.def.healer) {
      ctx.save();
      ctx.globalAlpha = 0.5 + Math.sin(game.time * 6) * 0.2;
      ctx.strokeStyle = "#9ff0ff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x, this.y - 18 * this.scale, 14 * this.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // hp bar (only when damaged, and not a tiny pawn to reduce clutter we still show)
    if (this.hp < this.maxHp) {
      const w = 22 * this.scale;
      const x = this.x - w / 2;
      const y = this.y - 34 * this.scale;
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(x - 1, y - 1, w + 2, 5);
      ctx.fillStyle = this.hp / this.maxHp > 0.4 ? "#6fe06f" : "#e05555";
      ctx.fillRect(x, y, w * Math.max(0, this.hp / this.maxHp), 3);
      ctx.restore();
    }

    // status pips just above the hp bar: armor shield (gray) and slow (blue)
    const slowed = game.time < this.slowUntil;
    if (this.armor > 0 || slowed) {
      ctx.save();
      const baseY = this.y - 37 * this.scale;
      const s = 5.2 * Math.min(1.15, this.scale);
      let ix = this.x - (this.armor > 0 && slowed ? s : 0); // center a pair
      if (this.armor > 0) {
        // shield
        ctx.fillStyle = "rgba(172,192,214,0.95)";
        ctx.strokeStyle = "rgba(20,30,45,0.85)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(ix - s, baseY);
        ctx.lineTo(ix + s, baseY);
        ctx.lineTo(ix + s, baseY + s);
        ctx.lineTo(ix, baseY + s * 2);
        ctx.lineTo(ix - s, baseY + s);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ix += s * 2.6;
      }
      if (slowed) {
        // frost dot
        ctx.fillStyle = "rgba(130,205,255,0.95)";
        ctx.strokeStyle = "rgba(20,30,45,0.8)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(ix, baseY + s * 0.7, s * 0.85, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}
