import type { Assets, AssetDef } from "./assets";
import { Sprite, drawSprite } from "./sprite";
import { clamp } from "./util";

export type FxKind =
  | "explosion"
  | "fire"
  | "splash"
  | "dust"
  | "heal"
  | "ring"
  | "float"
  | "slash";

interface FxInit {
  kind: FxKind;
  x: number;
  y: number;
  dur?: number;
  scale?: number;
  color?: string;
  text?: string;
  fx?: string; // which particle sheet for animated kinds
  angle?: number;
  tint?: string; // fill a white sprite silhouette with this color
}

export class Fx {
  kind: FxKind;
  x: number;
  y: number;
  t = 0;
  dur: number;
  scale: number;
  color: string;
  text: string;
  angle: number;
  tint?: string;
  private sprite: Sprite | null = null;
  private def: AssetDef | null = null;

  constructor(init: FxInit) {
    this.kind = init.kind;
    this.x = init.x;
    this.y = init.y;
    this.dur = init.dur ?? 0.4;
    this.scale = init.scale ?? 1;
    this.color = init.color ?? "#ffffff";
    this.text = init.text ?? "";
    this.angle = init.angle ?? 0;
    this.tint = init.tint;
  }

  attach(def: AssetDef, fpsOverride?: number): void {
    this.def = def;
    const d = fpsOverride ? { ...def, fps: fpsOverride } : def;
    this.sprite = new Sprite(d);
  }

  update(dt: number): void {
    this.t += dt;
    this.sprite?.update(dt);
  }

  get done(): boolean {
    return this.t >= this.dur;
  }

  get p(): number {
    return clamp(this.t / this.dur, 0, 1);
  }

  draw(ctx: CanvasRenderingContext2D, assets: Assets): void {
    const p = this.p;
    switch (this.kind) {
      case "explosion":
      case "fire":
      case "splash":
      case "dust":
      case "heal":
        if (this.sprite && this.def) {
          const alpha = this.kind === "explosion" || this.kind === "fire" ? 1 - p * 0.3 : 1;
          drawSprite(ctx, assets, this.def, this.sprite.frameIdx, this.x, this.y, {
            scale: this.scale * (0.6 + p * 0.8),
            alpha,
            tint: this.tint,
          });
        }
        break;
      case "ring": {
        const r = this.scale * (0.2 + p * 1) * 60;
        ctx.save();
        ctx.globalAlpha = (1 - p) * 0.8;
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 3 + (1 - p) * 3;
        ctx.beginPath();
        ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        break;
      }
      case "slash": {
        // quick white arc sweep
        const r = 30 * this.scale;
        const a0 = this.angle - 1.1 + p * 2.2;
        ctx.save();
        ctx.globalAlpha = (1 - p) * 0.9;
        ctx.strokeStyle = this.color;
        ctx.lineCap = "round";
        ctx.lineWidth = 4 * (1 - p) + 2;
        ctx.beginPath();
        ctx.arc(this.x, this.y, r, a0 - 0.9, a0 + 0.9);
        ctx.stroke();
        ctx.restore();
        break;
      }
      case "float": {
        const yOff = -p * 26;
        ctx.save();
        ctx.globalAlpha = 1 - p;
        ctx.font = "bold 16px 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.fillStyle = this.color;
        ctx.strokeText(this.text, this.x, this.y + yOff);
        ctx.fillText(this.text, this.x, this.y + yOff);
        ctx.restore();
        break;
      }
    }
  }
}
