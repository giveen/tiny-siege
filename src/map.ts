import type { Assets } from "./assets";
import type { RNG } from "./rng";
import { COLS, ROWS, TILE, WORLD_W, WORLD_H, CASTLE_CELL } from "./config";
import { type Vec, v, dist, clamp } from "./util";

const cellCenter = (c: number, r: number): Vec => v(c * TILE + TILE / 2, r * TILE + TILE / 2);
export const cellKey = (c: number, r: number) => `${c},${r}`;

// ---------------------------------------------------------------------------
// The growing island
//
// The map starts as a compact corridor around a short route to the castle
// (about ten build pads) and physically grows every 5 waves: new land
// appears, the enemy route gets longer, and a few more pads are carved out.
//
// The stage routes form a CUMULATIVE chain: every route still traverses the
// previous stage's walk (only the spawn side and length change), so growing
// never strands a player's towers far from the road. Build spots are never
// placed on a cell of ANY stage's route, so a newly revealed route can never
// cross a player's tower. Every route spawns over the top water and ends at
// the castle.
//
//   stage 1: spawn W,  row 1  6→12, drop col 12, row 2 12→16, tail
//   stage 2: spawn E,  over the TOP row (24→6), then stage 1's exact walk
//   stage 3: spawn far W, row 1 2→24 (both arms), row 2 24→16, tail

const STAGE_WAYPOINTS: [number, number][][] = [
  // Stage 0 (waves 1-5): a compact S — the opening island.
  [[12, -1], [12, 2], [16, 2], [16, 8], [14, 8], [14, 14]],
  // Stage 1 (waves 6-10): the western arm joins in.
  [[6, -1], [6, 1], [12, 1], [12, 2], [16, 2], [16, 8], [14, 8], [14, 14]],
  // Stage 2 (waves 11-15): the eastern arm joins in; the walk detours over
  // the top row and then follows stage 1's walk, so western towers stay live.
  [[24, -1], [24, 0], [6, 0], [6, 1], [12, 1], [12, 2], [16, 2], [16, 8], [14, 8], [14, 14]],
  // Stage 3 (waves 16+): the full span — one row-1 crossing of both arms,
  // then row 2 back to the shared tail.
  [[2, -1], [2, 1], [24, 1], [24, 2], [16, 2], [16, 8], [14, 8], [14, 14]],
];

/** Which island stage a given (1-based) wave belongs to. */
export function stageForWave(wave: number): number {
  return wave < 6 ? 0 : wave < 11 ? 1 : wave < 16 ? 2 : 3;
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
  kind: "tree" | "bush" | "rock" | "stump";
  idx: number;
  flip: boolean;
  scale: number;
}

export class World {
  assets: Assets;
  rng: RNG;
  stage = 0;
  island: Uint8Array = new Uint8Array(COLS * ROWS);
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

    this.island = this.islandFor(stage);

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

    // prerender background
    this.bg = document.createElement("canvas");
    this.bg.width = WORLD_W;
    this.bg.height = WORLD_H;
    this.renderBackground(this.bg.getContext("2d")!);
  }

  isGrass(c: number, r: number): boolean {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return false;
    return this.island[r * COLS + c] === 1;
  }

  /** (Re)compute the enemy route for a stage. */
  private setStagePath(stage: number): void {
    this.stage = stage;
    this.path = STAGE_PATH_CELLS[stage].map(([c, r]) => cellCenter(c, r));
    this.pathCells = new Set(STAGE_PATH_CELLS[stage].filter(([, r]) => r >= 0).map(([c, r]) => cellKey(c, r)));
    this.cum = [0];
    for (let i = 1; i < this.path.length; i++) {
      this.cum.push(this.cum[i - 1] + dist(this.path[i - 1], this.path[i]));
    }
    this.pathLen = this.cum[this.cum.length - 1];
  }

  /**
   * Land up to a stage: the UNION of a 5-wide corridor around every stage's
   * route so far, an organic fringe on top, and the castle yard. Land only
   * ever grows — existing pads and towers must never be left floating over
   * water.
   */
  private islandFor(stage: number): Uint8Array {
    const m = new Uint8Array(COLS * ROWS);
    for (let s = 0; s <= stage; s++) {
      const cells = STAGE_PATH_CELLS[s];
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          if (m[r * COLS + c]) continue;
          let d = Infinity;
          for (const [pc, pr] of cells) {
            const dd = Math.max(Math.abs(pc - c), Math.abs(pr - r));
            if (dd < d) d = dd;
          }
          if (d <= 2 || (d === 3 && (c * 7 + r * 13) % 3 === 0)) m[r * COLS + c] = 1;
        }
    }
    for (let dc = -1; dc <= 1; dc++)
      for (let dr = -1; dr <= 1; dr++) {
        const c = CASTLE_CELL.c + dc;
        const r = CASTLE_CELL.r + dr;
        if (r >= 0 && r < ROWS && c >= 0 && c < COLS) m[r * COLS + c] = 1;
      }
    return m;
  }

  /** Grow the island to a later stage: new land, longer route, new pads. */
  growToStage(stage: number): void {
    if (stage <= this.stage || stage >= STAGE_PATH_CELLS.length) return;
    this.island = this.islandFor(stage);
    this.setStagePath(stage);
    this.addSpotsForStage(stage, false);
    this.scatterDecos(this.freeCells());
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
      if (r < 0) continue;
      for (let dc = -1; dc <= 1; dc++)
        for (let dr = -1; dr <= 1; dr++) {
          if (dc === 0 && dr === 0) continue;
          nearPath.add(cellKey(c + dc, r + dr));
        }
    }
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        if (!this.isGrass(c, r) || (c + r) % 2 !== 0) continue;
        const k = cellKey(c, r);
        if (!nearPath.has(k) || RESERVED_CELLS.has(k) || this.castleCells.has(k)) continue;
        if (!initial && this.buildSpotByCell.has(k)) continue;
        const p = cellCenter(c, r);
        const spot = { c, r, x: p.x, y: p.y };
        this.buildSpots.push(spot);
        this.buildSpotByCell.set(k, spot);
      }
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
    this.decos = this.decos.filter((d) => d.cell !== cellKey(c, r));
    this.renderBackground(this.bg.getContext("2d")!);
  }

  /** Grass cells carrying no route / pad / castle — deco candidates.
   *  ANY stage's route is excluded so a tree never sits under a future road. */
  private freeCells(): Set<string> {
    const free = new Set<string>();
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const k = cellKey(c, r);
        if (
          this.isGrass(c, r) &&
          !this.pathCells.has(k) &&
          !RESERVED_CELLS.has(k) &&
          !this.buildSpotByCell.has(k) &&
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
    }
  }

  private scatterDecos(free: Set<string>): void {
    // Only decorate cells that don't already carry a deco, so growth adds
    // fresh scatter on the new land instead of duplicating the old.
    const occupied = new Set(this.decos.map((d) => d.cell));
    const cells = [...free].filter((k) => !occupied.has(k));
    this.rng.shuffle(cells);
    const kinds: Deco["kind"][] = ["tree", "tree", "bush", "bush", "rock", "rock", "stump"];
    const target = Math.floor(cells.length * 0.62);
    for (let i = 0; i < target; i++) {
      const k = cells[i];
      const [c, r] = k.split(",").map(Number);
      const p = cellCenter(c, r);
      const kind = this.rng.pick(kinds);
      const count = this.assets.manifest.deco[kind].length;
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

  private renderBackground(ctx: CanvasRenderingContext2D): void {
    // water fill (tile the water background)
    const water = this.assets.img(this.assets.manifest.tiles.water);
    for (let y = 0; y < WORLD_H; y += water.height)
      for (let x = 0; x < WORLD_W; x += water.width) ctx.drawImage(water, x, y);

    // grass autotile
    for (let r = 0; r < ROWS; r++)
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
            ctx.drawImage(this.assets.img(vars[(c * 7 + r * 13) % vars.length]), c * TILE, r * TILE);
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
    const list = this.assets.manifest.deco[d.kind];
    const img = this.assets.img(list[d.idx]);
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
