// Global tuning + world constants.

export const WORLD_W = 1792;
export const WORLD_H = 1024;
export const TILE = 64;
export const COLS = WORLD_W / TILE; // 28
export const ROWS = WORLD_H / TILE; // 16

// Black margins around the gameplay world. The HUD lives here — the info
// panel in the right margin and the tower palette in the bottom margin — so
// nothing ever covers the island itself.
export const MARGIN_R = 240;
export const MARGIN_B = 108;
export const CANVAS_W = WORLD_W + MARGIN_R;
export const CANVAS_H = WORLD_H + MARGIN_B;

export const START_GOLD = 220;
export const START_CASTLE_HP = 125;
/** Portion of max castle HP mended after every cleared wave (base mending,
 *  independent of the Menders relic). Keeps early leaks from ratcheting a
 *  fresh run into a death spiral; at 3% it is negligible once late-wave
 *  leaks deal tens of damage. Tuned with the balance sim (npm run sim). */
export const CASTLE_REGEN_PCT = 0.05;

/** Gold cost to relocate an unoccupied build pad to another grass cell. */
export const SPOT_MOVE_COST = 50;

// Castle sits at the bottom-center of the island.
export const CASTLE_CELL = { c: 14, r: 14 };

// Enemy damage to the castle when they reach it is enemy.castleDamage.
// Gold rewards scale with enemy.reward.

// Global multiplier on every enemy's sprite scale. The island is large, so the
// (small) source sprites are shrunk to read correctly against the map — but
// the smallest creatures need a visible presence, so the floor is 0.9.
export const ENEMY_SCALE_MULT = 0.9;

// Wave / economy tuning
export const WAVE_CLEAR_GOLD = (wave: number) => 20 + wave * 6;
export const KILL_GOLD_BASE = 1;

// The map is large and the path long; multiply enemy speed so a traversal
// still takes a reasonable number of seconds (tune to taste).
export const PATH_SPEED_MULT = 2.2;

// Tower range is in world px.
export const TOWER_RANGE_PREVIEW = 1;

// The run's climax: clearing this wave wins the run (the Siege). Players can
// choose to keep going past it from the victory screen ("Keep Defending") —
// the map stops growing (stageForWave caps at 9) but waves keep coming.
export const SIEGE_WAVE = 50;

// ---------------------------------------------------------------- endless
// Past the Siege, the composition periodically reinforces with tougher
// "Elite" versions of existing enemies (no new content needed), and the
// difficulty curve gains a gentle accelerating term on top of the normal
// per-wave scale so the climb keeps steepening instead of running the
// pre-Siege slope out forever. Single tunable knobs — tuned with the
// headless balance sim (`npm run sim`; see README), which plays seeded
// runs through the demo bot and reports where the wall sits.
export const ENDLESS_ELITE_INTERVAL = 10;
export const ENDLESS_ELITE_FRACTION = 0.4;
export const ELITE_HP_MULT = 1.8;
export const ELITE_DMG_MULT = 1.35;
export const ELITE_REWARD_MULT = 2.2;
/** Quadratic accel applied to enemy hp/damage/reward for every wave past the
 *  Siege: `1 + (wave - SIEGE_WAVE)^2 * ENDLESS_ACCEL_RATE`. */
export const ENDLESS_ACCEL_RATE = 0.00035;

// Per-enemy stats: every spawned enemy rolls its OWN base around the roster
// base (±ENEMY_BASE_VARIANCE) before wave scaling, so no two identical types
// are ever quite the same. Armored enemies carry a shatter pool of
// `armor tier * ARMOR_POINT_VALUE` points that must be stripped to zero
// before any of their HP can be touched.
export const ENEMY_BASE_VARIANCE = 0.2;
/** No enemy carries a shatter-armor pool before this wave. From then on,
 *  the chance an armored type rolls its pool starts at ARMOR_UNLOCK_CHANCE
 *  and gains ARMOR_RAMP_PER_WAVE per wave, capping at 100%. Bosses (and
 *  elites) from this wave on always carry their full pool. */
export const ARMOR_UNLOCK_WAVE = 10;
export const ARMOR_UNLOCK_CHANCE = 0.4;
export const ARMOR_RAMP_PER_WAVE = 0.1;
export const ARMOR_POINT_VALUE = 18;

// Speed options
export const SPEEDS = [1, 2, 3];

// localStorage key for best score
export const BEST_KEY = "tinysiege.best.v1";
