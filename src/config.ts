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
export const START_CASTLE_HP = 100;

// Castle sits at the bottom-center of the island.
export const CASTLE_CELL = { c: 14, r: 14 };

// Enemy damage to the castle when they reach it is enemy.castleDamage.
// Gold rewards scale with enemy.reward.

// Global multiplier on every enemy's sprite scale. The island is large, so the
// (small) source sprites are shrunk to read correctly against the map.
export const ENEMY_SCALE_MULT = 0.8;

// Wave / economy tuning
export const WAVE_CLEAR_GOLD = (wave: number) => 20 + wave * 6;
export const KILL_GOLD_BASE = 1;

// The map is large and the path long; multiply enemy speed so a traversal
// still takes a reasonable number of seconds (tune to taste).
export const PATH_SPEED_MULT = 2.2;

// Tower range is in world px.
export const TOWER_RANGE_PREVIEW = 1;

// Speed options
export const SPEEDS = [1, 2, 3];

// localStorage key for best score
export const BEST_KEY = "tinysiege.best.v1";
