import type { Assets } from "./assets";
import type { RNG } from "./rng";
import { COLS, ROWS, TILE, WORLD_W, WORLD_H, CASTLE_CELL } from "./config";
import { type Vec, v, dist, clamp } from "./util";

const cellCenter = (c: number, r: number): Vec => v(c * TILE + TILE / 2, r * TILE + TILE / 2);
export const cellKey = (c: number, r: number) => `${c},${r}`;
/** True mathematical modulo (always non-negative) — JS's `%` keeps the
 *  dividend's sign, which breaks array indexing now that rows go negative. */
const mod = (n: number, m: number) => ((n % m) + m) % m;

// ---------------------------------------------------------------------------
// The growing island
//
// The map starts as a compact corridor around a short route to the castle
// (about ten build pads) and physically grows every 5 waves: the island
// gets taller — new land and a longer enemy route appear ABOVE the current
// top edge — and a few more pads are carved out. The castle never moves, so
// as the map grows the world becomes taller than the camera viewport and the
// player must drag (pan) upward to see the new territory; the default view
// on entering a run shows the bottom of the island (the castle) exactly as
// before.
//
// The stage routes form a CUMULATIVE chain: every route still traverses the
// previous stage's walk in full (only a new band is prepended above it), so
// growing never strands a player's towers far from the road, and old pads
// never end up floating over water. Each new stage's band is a "comb"
// zigzag spliced in by dropping straight down into the previous stage's own
// spawn point — build spots are never placed on a cell of ANY stage's
// route, so a newly revealed route can never cross a player's tower.

/**
 * One stage's added growth: a double zigzag sweep across new rows directly
 * above `topRow`, entering from an off-grid spawn one row above the band and
 * exiting by dropping straight down into the previous stage's own spawn
 * point — so the whole old walk is preserved untouched and each new stage
 * simply extends the road upward. Only 3 rows actually sweep edge-to-edge
 * (mirroring the game's original hand-authored meanders); a 3-row-tall
 * quiet gap carries just a single-column vertical transit between the 2nd
 * and 3rd sweeps. That gap has to be a genuine 3 rows, not 1 — decorations
 * are kept a full cell away from every path cell (so a tree can never
 * visually spill onto the road), and a path row that size sweeps edge to
 * edge, so anything closer than 2 rows from it is still within that margin.
 * A 3-row gap leaves its middle row untouched by either sweep, which is
 * where build pads and scatter actually land.
 */
function combBand(topRow: number, colMin: number, colMax: number, spawnCol: number, exitCol: number): [number, number][] {
  const farSide = colMax - spawnCol >= spawnCol - colMin;
  const edgeA = farSide ? colMax : colMin;
  const edgeB = farSide ? colMin : colMax;
  return [
    [spawnCol, topRow - 1],
    [spawnCol, topRow],
    [edgeA, topRow], // sweep 1: spawnCol -> edgeA along topRow
    [edgeA, topRow + 1], // drop
    [edgeB, topRow + 1], // sweep 2: edgeA -> edgeB along topRow+1
    [edgeB, topRow + 5], // quiet vertical transit through topRow+2..+4 (no sweep)
    [exitCol, topRow + 5], // sweep 3: edgeB -> exitCol along topRow+5
    [exitCol, topRow + 6], // drop into the previous stage's spawn point
  ];
}

// Each growth stage's entrance column, alternating sides of the island so
// consecutive bands read differently.
const GROWTH_SPAWN_COLS = [22, 6, 20, 8, 18, 10, 16, 12, 24];
const GROWTH_BAND_ROWS = 6;
const GROWTH_COL_MARGIN = 1;

const STAGE_WAYPOINTS: [number, number][][] = [
  // Stage 0 (waves 1-5): a compact S — the opening island around the castle.
  [
    [12, -1],
    [12, 2],
    [16, 2],
    [16, 8],
    [14, 8],
    [14, 14],
  ],
];
for (let s = 1; s <= 9; s++) {
  const prev = STAGE_WAYPOINTS[s - 1];
  const [exitCol, exitRow] = prev[0]; // the previous stage's own spawn point
  const topRow = exitRow - GROWTH_BAND_ROWS;
  const spawnCol = GROWTH_SPAWN_COLS[s - 1];
  const band = combBand(topRow, GROWTH_COL_MARGIN, COLS - 1 - GROWTH_COL_MARGIN, spawnCol, exitCol);
  STAGE_WAYPOINTS.push([...band, ...prev.slice(1)]);
}

/** Which island stage a given (1-based) wave belongs to. */

/** Which island stage a given (1-based) wave belongs to. One stage per 5
 *  waves; the campaign climax (wave 50) plays on the final stage. */
export function stageForWave(wave: number): number {
  return Math.min(9, Math.floor((wave - 1) / 5));
}

/** Expand axis-aligned waypoints into every cell the path passes through. */
function expandPath(wps: [number, number][]): [number, number][] {
  const out: [number, number][] = [wps[0]];
  for (let i = 1; i < wps.length; i++) {
    const [c0, r0] = wps[i - 1];
    const [c1, r1] = wps[i];
    const dc = Math.sign(c1 - c0);
    const dr = Math.sign(r1 - r0);
    let c = c0,
      r = r0;
    while (c !== c1 || r !== r1) {
      c += dc;
      r += dr;
      out.push([c, r]);
    }
  }
  return out;
}

const STAGE_PATH_CELLS: [number, number][][] = STAGE_WAYPOINTS.map(expandPath);

/** Cells of any stage's route — build spots are never placed here. */
const RESERVED_CELLS = new Set(STAGE_PATH_CELLS.flat().map(([c, r]) => cellKey(c, r)));

/** RESERVED_CELLS plus a 1-cell buffer all around — decoration sprites
 *  (tree canopies, rocks) spill well beyond their own cell, so keeping only
 *  the exact path cells clear isn't enough: a deco anchored in a cell right
 *  beside the path visually overlaps it. Build spots still use the tighter
 *  RESERVED_CELLS (they're deliberately placed hugging the route). */
const RESERVED_RING = new Set<string>();
for (const [c, r] of STAGE_PATH_CELLS.flat()) {
  for (let dc = -1; dc <= 1; dc++)
    for (let dr = -1; dr <= 1; dr++) RESERVED_RING.add(cellKey(c + dc, r + dr));
}

export interface BuildSpot {
  c: number;
  r: number;
  x: number;
  y: number;
}

export interface Deco {
  x: number;
  y: number;
  cell: string;
  kind: "tree" | "bush" | "rock" | "stump" | "sheep" | "goldstone" | "water_rock" | "duck";
  idx: number;
  flip: boolean;
  scale: number;
}

export class World {
  assets: Assets;
  rng: RNG;
  stage = 0;
  /** Grass cells as "c,r" keys — a Set (not a fixed array) because growth
   *  extends the island to negative rows (upward), which a row-major typed
   *  array indexed from 0 can't represent. */
  grass = new Set<string>();
  /** The lowest (most negative) row currently reached by the island. 0 until
   *  the first upward growth; decreases every time the map grows taller. */
  minRow = 0;
  path: Vec[] = [];
  pathLen = 0;
  private cum: number[] = [0];
  pathCells = new Set<string>();
  buildSpots: BuildSpot[] = [];
  buildSpotByCell = new Map<string, BuildSpot>();
  castlePos: Vec;
  castleCells = new Set<string>();
  decos: Deco[] = [];
  bg: HTMLCanvasElement;

  constructor(assets: Assets, rng: RNG, stage = 0) {
    this.assets = assets;
    this.rng = rng;
    this.castlePos = cellCenter(CASTLE_CELL.c, CASTLE_CELL.r);

    this.minRow = this.landRowFloor(stage);
    this.grass = this.islandFor(stage);

    // castle footprint (a few cells around CASTLE_CELL)
    for (let dc = -1; dc <= 1; dc++)
      for (let dr = -1; dr <= 1; dr++) {
        const c = CASTLE_CELL.c + dc;
        const r = CASTLE_CELL.r + dr;
        if (r >= 0 && r < ROWS && c >= 0 && c < COLS && this.isGrass(c, r))
          this.castleCells.add(cellKey(c, r));
      }

    this.setStagePath(stage);
    this.addSpotsForStage(stage, true);
    this.scatterDecos(this.freeCells());
    this.scatterWaterDecos();

    // prerender background
    this.bg = document.createElement("canvas");
    this.renderBackground(this.bg.getContext("2d")!);
  }

  isGrass(c: number, r: number): boolean {
    if (c < 0 || c >= COLS || r >= ROWS) return false;
    return this.grass.has(cellKey(c, r));
  }

  /** (Re)compute the enemy route for a stage. */
  private setStagePath(stage: number): void {
    this.stage = stage;
    this.path = STAGE_PATH_CELLS[stage].map(([c, r]) => cellCenter(c, r));
    // The route's first cell is always the off-grid spawn marker (sitting in
    // water, one row above the island); every other cell is real land.
    this.pathCells = new Set(STAGE_PATH_CELLS[stage].slice(1).map(([c, r]) => cellKey(c, r)));
    this.cum = [0];
    for (let i = 1; i < this.path.length; i++) {
      this.cum.push(this.cum[i - 1] + dist(this.path[i - 1], this.path[i]));
    }
    this.pathLen = this.cum[this.cum.length - 1];
  }

  /** The lowest row any stage up to `stage` needs land on (one below the
   *  lowest path cell, which is always that stage's own off-grid spawn
   *  marker — land is never generated at or above the marker's own row). */
  private landRowFloor(stage: number): number {
    let m = Infinity;
    for (let s = 0; s <= stage; s++) for (const [, r] of STAGE_PATH_CELLS[s]) if (r < m) m = r;
    return m + 1;
  }

  /**
   * Land up to a stage: the UNION of a 5-wide corridor around every stage's
   * route so far, an organic fringe on top, and the castle yard. Land only
   * ever grows — existing pads and towers must never be left floating over
   * water.
   */
  private islandFor(stage: number): Set<string> {
    const m = new Set<string>();
    const floor = this.landRowFloor(stage);
    for (let s = 0; s <= stage; s++) {
      const cells = STAGE_PATH_CELLS[s];
      for (let r = floor; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          const k = cellKey(c, r);
          if (m.has(k)) continue;
          let d = Infinity;
          for (const [pc, pr] of cells) {
            const dd = Math.max(Math.abs(pc - c), Math.abs(pr - r));
            if (dd < d) d = dd;
          }
          if (d <= 2 || (d === 3 && (c * 7 + r * 13) % 3 === 0)) m.add(k);
        }
    }
    for (let dc = -1; dc <= 1; dc++)
      for (let dr = -1; dr <= 1; dr++) {
        const c = CASTLE_CELL.c + dc;
        const r = CASTLE_CELL.r + dr;
        if (r >= 0 && r < ROWS && c >= 0 && c < COLS) m.add(cellKey(c, r));
      }
    return m;
  }

  /** Grow the island to a later stage: new land, longer route, new pads. */
  growToStage(stage: number): void {
    if (stage <= this.stage || stage >= STAGE_PATH_CELLS.length) return;
    this.minRow = this.landRowFloor(stage);
    this.grass = this.islandFor(stage);
    this.setStagePath(stage);
    this.addSpotsForStage(stage, false);
    this.scatterDecos(this.freeCells());
    this.scatterWaterDecos();
    this.renderBackground(this.bg.getContext("2d")!);
  }

  /**
   * Build pads: grass cells hugging the stage route (Chebyshev distance 1),
   * checkerboarded so pads read as distinct slabs. Existing pads are never
   * touched, so growth only ever ADDS spots.
   */
  private addSpotsForStage(stage: number, initial: boolean): void {
    const nearPath = new Set<string>();
    for (const [c, r] of STAGE_PATH_CELLS[stage]) {
      for (let dc = -1; dc <= 1; dc++)
        for (let dr = -1; dr <= 1; dr++) {
          if (dc === 0 && dr === 0) continue;
          nearPath.add(cellKey(c + dc, r + dr));
        }
    }
    const added: BuildSpot[] = [];
    for (let r = this.minRow; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        if (!this.isGrass(c, r) || (c + r) % 2 !== 0) continue;
        const k = cellKey(c, r);
        if (!nearPath.has(k) || RESERVED_CELLS.has(k) || this.castleCells.has(k)) continue;
        if (!initial && this.buildSpotByCell.has(k)) continue;
        const p = cellCenter(c, r);
        const spot = { c, r, x: p.x, y: p.y };
        this.buildSpots.push(spot);
        this.buildSpotByCell.set(k, spot);
        added.push(spot);
      }
    // A pad's slab is a 64px tile but deco sprites (rocks, tree canopies)
    // spill well beyond their own cell — keep the pad's ring clear so a rock
    // never sits on top of a freshly carved spot.
    if (added.length > 0)
      this.decos = this.decos.filter((d) => {
        const [dc, dr] = d.cell.split(",").map(Number);
        return !added.some((s) => Math.abs(s.c - dc) <= 1 && Math.abs(s.r - dr) <= 1);
      });
  }

  /**
   * Can an empty pad be relocated to this cell? Grass only, never on ANY
   * stage's route (so later growth can't cross a player pad), never on the
   * castle footprint, never stacked on another pad.
   */
  canRelocateTo(c: number, r: number): boolean {
    if (!this.isGrass(c, r)) return false;
    const k = cellKey(c, r);
    if (RESERVED_CELLS.has(k)) return false;
    if (this.castleCells.has(k)) return false;
    if (this.buildSpotByCell.has(k)) return false;
    return true;
  }

  /**
   * Relocate a pad to a new cell (the caller enforces the gold cost). Any
   * deco on the target cell is cleared, and the prerendered background is
   * redrawn since the pads are painted into it.
   */
  moveSpot(spot: BuildSpot, c: number, r: number): void {
    this.buildSpotByCell.delete(cellKey(spot.c, spot.r));
    spot.c = c;
    spot.r = r;
    const p = cellCenter(c, r);
    spot.x = p.x;
    spot.y = p.y;
    this.buildSpotByCell.set(cellKey(c, r), spot);
    // Clear the whole 3x3 ring so no neighbouring rock/canopy covers the slab.
    this.decos = this.decos.filter((d) => {
      const [dc, dr] = d.cell.split(",").map(Number);
      return Math.abs(dc - c) > 1 || Math.abs(dr - r) > 1;
    });
    this.renderBackground(this.bg.getContext("2d")!);
  }

  /** Grass cells carrying no route / pad / castle — deco candidates.
   *  ANY stage's route is excluded so a tree never sits under a future road.
   *  The 3x3 ring around every pad is excluded too, because deco sprites
   *  (rocks, tree canopies) spill past their cell and would cover the slab. */
  private freeCells(): Set<string> {
    const padRing = new Set<string>();
    for (const s of this.buildSpots)
      for (let dc = -1; dc <= 1; dc++)
        for (let dr = -1; dr <= 1; dr++) padRing.add(cellKey(s.c + dc, s.r + dr));
    const free = new Set<string>();
    for (let r = this.minRow; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const k = cellKey(c, r);
        if (
          this.isGrass(c, r) &&
          !this.pathCells.has(k) &&
          !RESERVED_RING.has(k) &&
          !this.buildSpotByCell.has(k) &&
          !padRing.has(k) &&
          !this.castleCells.has(k)
        )
          free.add(k);
      }
    return free;
  }

  private scaleFor(kind: Deco["kind"]): number {
    switch (kind) {
      case "tree":
        return this.rng.range(0.5, 0.66);
      case "bush":
        return this.rng.range(0.7, 0.95);
      case "rock":
        return this.rng.range(0.8, 1.1);
      case "stump":
        return this.rng.range(0.55, 0.7);
      case "sheep":
        return this.rng.range(0.6, 0.75);
      case "goldstone":
        return this.rng.range(0.4, 0.55);
      case "water_rock":
        return this.rng.range(0.7, 1.0);
      case "duck":
        return this.rng.range(0.35, 0.45);
    }
  }

  /** sheep/goldstone are single-image (StaticDef) manifest entries, not an
   *  array of variants like the rest — this is the only variant either has. */
  private decoCount(kind: Deco["kind"]): number {
    if (kind === "sheep" || kind === "goldstone") return 1;
    return this.assets.manifest.deco[kind].length;
  }

  private decoImagePath(kind: Deco["kind"], idx: number): string {
    if (kind === "sheep") return this.assets.manifest.deco.sheep_grass.image;
    if (kind === "goldstone") return this.assets.manifest.deco.goldstone.image;
    return this.assets.manifest.deco[kind][idx];
  }

  private scatterDecos(free: Set<string>): void {
    // Only decorate cells that don't already carry a deco, so growth adds
    // fresh scatter on the new land instead of duplicating the old.
    const occupied = new Set(this.decos.map((d) => d.cell));
    const cells = [...free].filter((k) => !occupied.has(k));
    this.rng.shuffle(cells);
    const kinds: Deco["kind"][] = ["tree", "tree", "bush", "bush", "rock", "rock", "stump", "sheep", "goldstone"];
    const target = Math.floor(cells.length * 0.62);
    for (let i = 0; i < target; i++) {
      const k = cells[i];
      const [c, r] = k.split(",").map(Number);
      const p = cellCenter(c, r);
      const kind = this.rng.pick(kinds);
      const count = this.decoCount(kind);
      this.decos.push({
        x: p.x + this.rng.range(-14, 14),
        y: p.y + this.rng.range(-8, 12),
        cell: k,
        kind,
        idx: this.rng.int(0, count - 1),
        flip: this.rng.chance(0.5),
        scale: this.scaleFor(kind),
      });
    }
  }

  /** Scatter decorative rocks (and a rare rubber duck) in the water just off
   *  the coastline — purely cosmetic, the water is never otherwise touched. */
  private scatterWaterDecos(): void {
    const occupied = new Set(this.decos.map((d) => d.cell));
    const candidates: string[] = [];
    for (let r = this.minRow; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        if (this.isGrass(c, r)) continue;
        const k = cellKey(c, r);
        if (occupied.has(k)) continue;
        let nearLand = false;
        for (let dc = -1; dc <= 1 && !nearLand; dc++)
          for (let dr = -1; dr <= 1 && !nearLand; dr++) if (this.isGrass(c + dc, r + dr)) nearLand = true;
        if (nearLand) candidates.push(k);
      }
    this.rng.shuffle(candidates);
    const target = Math.floor(candidates.length * 0.3);
    for (let i = 0; i < target; i++) {
      const k = candidates[i];
      const [c, r] = k.split(",").map(Number);
      const p = cellCenter(c, r);
      const kind: Deco["kind"] = this.rng.chance(0.04) ? "duck" : "water_rock";
      const count = this.decoCount(kind);
      this.decos.push({
        x: p.x + this.rng.range(-16, 16),
        y: p.y + this.rng.range(-10, 14),
        cell: k,
        kind,
        idx: this.rng.int(0, count - 1),
        flip: this.rng.chance(0.5),
        scale: this.scaleFor(kind),
      });
    }
  }

  private renderBackground(ctx: CanvasRenderingContext2D): void {
    // The canvas holds the island's CURRENT full extent, which grows taller
    // (never wider) as minRow goes more negative; resizing clears it, which
    // is fine since every call redraws from scratch. Everything below still
    // draws in absolute world coordinates — the translate maps world y=
    // minRow*TILE (the current top edge) to the canvas's own pixel row 0.
    const canvas = ctx.canvas;
    canvas.width = WORLD_W;
    canvas.height = (ROWS - this.minRow) * TILE;
    ctx.translate(0, -this.minRow * TILE);

    // water fill (tile the water background)
    const water = this.assets.img(this.assets.manifest.tiles.water);
    for (let y = this.minRow * TILE; y < WORLD_H; y += water.height)
      for (let x = 0; x < WORLD_W; x += water.width) ctx.drawImage(water, x, y);

    // grass autotile
    for (let r = this.minRow; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        if (!this.isGrass(c, r)) continue;
        const T = !this.isGrass(c, r - 1);
        const B = !this.isGrass(c, r + 1);
        const L = !this.isGrass(c - 1, r);
        const R = !this.isGrass(c + 1, r);
        const tileC = L && R ? 3 : L ? 0 : R ? 2 : 1;
        const tileR = T && B ? 3 : T ? 0 : B ? 2 : 1;
        if (T || B || L || R) {
          ctx.drawImage(this.assets.grassTile(tileR, tileC), c * TILE, r * TILE);
        } else {
          // interior: mostly plain, occasional variation for texture
          const plain = this.assets.grassTile(1, 1);
          if ((c * 5 + r * 11) % 4 === 0) {
            const vars = this.assets.manifest.tiles.grass_var;
            ctx.drawImage(this.assets.img(vars[mod(c * 7 + r * 13, vars.length)]), c * TILE, r * TILE);
          } else {
            ctx.drawImage(plain, c * TILE, r * TILE);
          }
        }
      }

    // path: a subtle dirt trail along the polyline
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(150,120,70,0.35)";
    ctx.lineWidth = 40;
    ctx.beginPath();
    ctx.moveTo(this.path[0].x, this.path[0].y);
    for (let i = 1; i < this.path.length; i++) ctx.lineTo(this.path[i].x, this.path[i].y);
    ctx.stroke();
    ctx.strokeStyle = "rgba(190,160,100,0.25)";
    ctx.lineWidth = 26;
    ctx.stroke();
    ctx.restore();

    // build pads: subtle stone squares marking where towers may be placed
    const pad = TILE * 0.82;
    for (const s of this.buildSpots) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.beginPath();
      ctx.roundRect(-pad / 2, -pad / 2, pad, pad, 9);
      ctx.fillStyle = "rgba(122,102,66,0.30)";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(86,70,44,0.42)";
      ctx.stroke();
      // small inner highlight so the pad reads as a raised slab
      ctx.beginPath();
      ctx.roundRect(-pad / 2 + 4, -pad / 2 + 4, pad - 8, pad - 8, 6);
      ctx.strokeStyle = "rgba(230,214,170,0.18)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    // decorations (behind units) — trees are tall, draw sorted by y
    const sorted = this.decos.slice().sort((a, b) => a.y - b.y);
    for (const d of sorted) this.drawDeco(ctx, d);
  }

  private drawDeco(ctx: CanvasRenderingContext2D, d: Deco): void {
    const img = this.assets.img(this.decoImagePath(d.kind, d.idx));
    const s = d.scale;
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.scale(d.flip ? -s : s, s);
    // anchor the base (bottom-center) at the ground point
    ctx.drawImage(img, -img.width / 2, -img.height, img.width, img.height);
    ctx.restore();
  }

  /** The path point nearest a world position (soldiers join the march here). */
  nearestPathPoint(x: number, y: number): { x: number; y: number; angle: number; dist: number } {
    let best = 0;
    let bd = Infinity;
    const step = 8;
    for (let d = 0; d <= this.pathLen; d += step) {
      const p = this.pointAt(d);
      const dist = Math.hypot(p.x - x, p.y - y);
      if (dist < bd) {
        bd = dist;
        best = d;
      }
    }
    // refine around the best hit
    for (let d = Math.max(0, best - step); d <= Math.min(this.pathLen, best + step); d += 2) {
      const p = this.pointAt(d);
      const dist = Math.hypot(p.x - x, p.y - y);
      if (dist < bd) {
        bd = dist;
        best = d;
      }
    }
    const p = this.pointAt(best);
    return { ...p, dist: best };
  }

  /** Position + heading at a distance along the path. */
  pointAt(d: number): { x: number; y: number; angle: number } {
    const dd = clamp(d, 0, this.pathLen);
    // find segment
    for (let i = 1; i < this.path.length; i++) {
      if (dd <= this.cum[i]) {
        const segLen = this.cum[i] - this.cum[i - 1];
        const t = segLen === 0 ? 0 : (dd - this.cum[i - 1]) / segLen;
        const a = this.path[i - 1];
        const b = this.path[i];
        return {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          angle: Math.atan2(b.y - a.y, b.x - a.x),
        };
      }
    }
    const last = this.path[this.path.length - 1];
    const prev = this.path[this.path.length - 2] ?? last;
    return { x: last.x, y: last.y, angle: Math.atan2(last.y - prev.y, last.x - prev.x) };
  }

  spawnPoint(): { x: number; y: number } {
    return { x: this.path[0].x, y: this.path[0].y };
  }
}
