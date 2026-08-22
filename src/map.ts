import type { Assets } from "./assets";
import type { RNG } from "./rng";
import { COLS, ROWS, TILE, WORLD_W, WORLD_H, CASTLE_CELL, BUILD_SPOT_PATH_DIST } from "./config";
import { type Vec, v, dist, clamp } from "./util";

// Island mask: 1 = grass, 0 = water. 16 wide x 10 tall.
const ISLAND = [
  "0001111111110000",
  "0011111111111000",
  "0111111111111100",
  "0111111111111110",
  "0111111111111111",
  "0111111111111111",
  "0111111111111111",
  "0111111111111111",
  "0111111111111110",
  "0011111111111100",
];

// Enemy path as a list of cell waypoints (meandering top -> bottom to the castle).
const PATH_CELLS: [number, number][] = [
  [2, -1],
  [2, 0],
  [2, 1],
  [2, 2],
  [2, 3],
  [3, 3],
  [4, 3],
  [5, 3],
  [6, 3],
  [6, 4],
  [6, 5],
  [5, 5],
  [4, 5],
  [3, 5],
  [3, 6],
  [3, 7],
  [4, 7],
  [5, 7],
  [6, 7],
  [7, 7],
  [8, 7],
  [8, 8],
];

export interface BuildSpot {
  c: number;
  r: number;
  x: number;
  y: number;
}

export interface Deco {
  x: number;
  y: number;
  kind: "tree" | "bush" | "rock" | "stump";
  idx: number;
  flip: boolean;
  scale: number;
}

const cellCenter = (c: number, r: number): Vec => v(c * TILE + TILE / 2, r * TILE + TILE / 2);
export const cellKey = (c: number, r: number) => `${c},${r}`;

export class World {
  assets: Assets;
  rng: RNG;
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

  constructor(assets: Assets, rng: RNG) {
    this.assets = assets;
    this.rng = rng;

    // island mask
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        this.island[r * COLS + c] = ISLAND[r][c] === "1" ? 1 : 0;

    // path polyline
    this.path = PATH_CELLS.map(([c, r]) => cellCenter(c, r));
    this.pathCells = new Set(PATH_CELLS.filter(([, r]) => r >= 0).map(([c, r]) => cellKey(c, r)));
    for (let i = 1; i < this.path.length; i++) {
      const d = dist(this.path[i - 1], this.path[i]);
      this.cum.push(this.cum[i - 1] + d);
    }
    this.pathLen = this.cum[this.cum.length - 1];

    // castle footprint (a few cells around CASTLE_CELL)
    this.castlePos = cellCenter(CASTLE_CELL.c, CASTLE_CELL.r);
    for (let dc = -1; dc <= 1; dc++)
      for (let dr = -1; dr <= 1; dr++) {
        const c = CASTLE_CELL.c + dc;
        const r = CASTLE_CELL.r + dr;
        if (r >= 0 && r < ROWS && c >= 0 && c < COLS && this.isGrass(c, r))
          this.castleCells.add(cellKey(c, r));
      }

    // build spots: grass cells near the path, not on path, not on castle
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        if (!this.isGrass(c, r)) continue;
        const k = cellKey(c, r);
        if (this.pathCells.has(k) || this.castleCells.has(k)) continue;
        const p = cellCenter(c, r);
        const nearPath = this.path.some((wp) => dist(p, wp) <= BUILD_SPOT_PATH_DIST);
        if (nearPath) {
          const spot = { c, r, x: p.x, y: p.y };
          this.buildSpots.push(spot);
          this.buildSpotByCell.set(k, spot);
        }
      }

    // decorations on grass that is not path / build spot / castle
    const free = new Set<string>();
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const k = cellKey(c, r);
        if (this.isGrass(c, r) && !this.pathCells.has(k) && !this.buildSpotByCell.has(k) && !this.castleCells.has(k))
          free.add(k);
      }
    this.scatterDecos(free);

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
    const cells = [...free];
    this.rng.shuffle(cells);
    const kinds: Deco["kind"][] = ["tree", "tree", "bush", "bush", "rock", "rock", "stump"];
    let placed = 0;
    for (const k of cells) {
      if (placed >= 18) break;
      const p = cellCenter(...(k.split(",").map(Number) as [number, number]));
      const kind = this.rng.pick(kinds);
      const count = this.assets.manifest.deco[kind].length;
      this.decos.push({
        x: p.x + this.rng.range(-12, 12),
        y: p.y + this.rng.range(-6, 10),
        kind,
        idx: this.rng.int(0, count - 1),
        flip: this.rng.chance(0.5),
        scale: this.scaleFor(kind),
      });
      placed++;
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
