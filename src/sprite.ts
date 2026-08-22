import type { Assets, AssetDef } from "./assets";

export interface DrawOpts {
  scale?: number;
  flipX?: boolean;
  alpha?: number;
  filter?: string;
  offsetY?: number;
}

/**
 * Draw a single frame of an AssetDef anchored at (x, y) in world space.
 * Anchor is the def's anchor (bottom-center => feet, center => middle).
 */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  assets: Assets,
  def: AssetDef,
  frameIdx: number,
  x: number,
  y: number,
  o: DrawOpts = {}
): void {
  const i = Math.max(0, Math.min(def.frames.length - 1, frameIdx));
  const img = assets.img(def.frames[i]);
  const [cw, ch] = def.cell;
  const s = o.scale ?? 1;
  const oy = (def.anchor === "bottom-center" ? -(ch - 1) : -ch / 2) + (o.offsetY ?? 0);
  ctx.save();
  if (o.alpha != null) ctx.globalAlpha = o.alpha;
  if (o.filter) ctx.filter = o.filter;
  ctx.translate(x, y);
  ctx.scale(o.flipX ? -s : s, s);
  ctx.drawImage(img, -cw / 2, oy, cw, ch);
  ctx.restore();
}

/** Stateful animation that steps through an AssetDef's frames over time. */
export class Sprite {
  def: AssetDef;
  t = 0;
  frameIdx = 0;
  playing = true;
  finished = false;

  constructor(def: AssetDef) {
    this.def = def;
  }

  setDef(def: AssetDef): void {
    this.def = def;
    this.t = 0;
    this.frameIdx = 0;
    this.playing = true;
    this.finished = false;
  }

  playOnce(): void {
    this.t = 0;
    this.frameIdx = 0;
    this.playing = true;
    this.finished = false;
  }

  update(dt: number): void {
    if (!this.playing) return;
    const fps = this.def.fps ?? 10;
    this.t += dt;
    const n = this.def.frames.length;
    const raw = this.t * fps;
    let f = Math.floor(raw);
    if (this.def.loop) {
      this.frameIdx = f % n;
    } else {
      if (raw >= n - 1) {
        this.frameIdx = n - 1;
        this.playing = false;
        this.finished = true;
      } else {
        this.frameIdx = Math.max(0, f);
      }
    }
  }
}
