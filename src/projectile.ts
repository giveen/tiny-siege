import type { Game } from "./game";
import type { Enemy } from "./enemy";
import type { TowerStats } from "./types";
import { WORLD_W, WORLD_H } from "./config";

type ProjKind = "arrow" | "spear" | "cannonball";

let pid = 1;

export class Projectile {
  id = pid++;
  kind: ProjKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  damage: number;
  splash = 0;
  pierce = 0;
  dead = false;
  private target: Enemy | null;
  private tx: number;
  private ty: number;
  private hitSet = new Set<Enemy>();
  private travel = 0;
  private maxTravel: number;
  private angle: number;

  constructor(
    kind: ProjKind,
    x: number,
    y: number,
    angle: number,
    speed: number,
    damage: number,
    opts: { target?: Enemy; tx?: number; ty?: number; splash?: number; pierce?: number } = {}
  ) {
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.speed = speed;
    this.damage = damage;
    this.target = opts.target ?? null;
    this.tx = opts.tx ?? x;
    this.ty = opts.ty ?? y;
    this.splash = opts.splash ?? 0;
    this.pierce = opts.pierce ?? 0;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.maxTravel = kind === "spear" ? 280 : kind === "cannonball" ? 900 : 700;
  }

  update(game: Game, dt: number): void {
    if (this.kind === "arrow") {
      // home to target; retarget or fizzle if dead
      if (!this.target || this.target.dead) {
        const t = this.nearest(game, 70);
        if (t) this.target = t;
        else {
          this.dead = true;
          game.spawnPuffFx(this.x, this.y);
          return;
        }
      }
      const a = Math.atan2(this.target.visualY - this.y, this.target.x - this.x);
      this.angle = a;
      this.vx = Math.cos(a) * this.speed;
      this.vy = Math.sin(a) * this.speed;
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.travel += this.speed * dt;

    if (this.travel > this.maxTravel || this.x < -40 || this.x > WORLD_W + 40 || this.y < -40 || this.y > WORLD_H + 40) {
      if (this.kind === "cannonball") this.explode(game);
      else this.dead = true;
      return;
    }

    if (this.kind === "arrow" && this.target) {
      const t = this.target;
      const d = Math.hypot(t.x - this.x, t.visualY - this.y);
      if (d < 13) {
        this.hitEnemy(game, t);
        this.dead = true;
      }
    } else if (this.kind === "spear") {
      for (const e of game.enemies) {
        if (e.dead || this.hitSet.has(e)) continue;
        if (Math.hypot(e.x - this.x, e.visualY - this.y) < 16 * e.scale + 7) {
          this.hitEnemy(game, e);
          this.hitSet.add(e);
          if (this.hitSet.size >= this.pierce) {
            this.dead = true;
            break;
          }
        }
      }
    } else if (this.kind === "cannonball") {
      if (Math.hypot(this.tx - this.x, this.ty - this.y) < 8) {
        this.explode(game);
        this.dead = true;
      }
    }
  }

  private nearest(game: Game, range: number): Enemy | null {
    let best: Enemy | null = null;
    let bd = range;
    for (const e of game.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - this.x, e.visualY - this.y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private hitEnemy(game: Game, e: Enemy): void {
    game.damageEnemy(e, this.damage, "physical");
    game.spawnHitFx(e.x, e.visualY - 10);
    if (this.kind === "arrow") {
      if (game.buffs.arrowSlow > 0) {
        e.slowUntil = game.time + 1.0;
        e.slowFactor = 1 - game.buffs.arrowSlow;
      }
      if (game.buffs.arrowBurnDps > 0) {
        e.burnDps = Math.max(e.burnDps, game.buffs.arrowBurnDps);
        e.burnUntil = game.time + 1.5;
      }
    }
  }

  private explode(game: Game): void {
    game.spawnExplosionFx(this.x, this.y, 1);
    for (const e of game.enemies) {
      if (e.dead) continue;
      // A ground blast can't reach flying foes.
      if (this.kind === "cannonball" && e.flying) continue;
      if (Math.hypot(e.x - this.x, e.visualY - this.y) <= this.splash + 8 * e.scale) {
        game.damageEnemy(e, this.damage, "physical");
        game.spawnHitFx(e.x, e.visualY - 10);
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, _game: Game): void {
    ctx.save();
    ctx.translate(this.x, this.y);
    if (this.kind === "arrow") {
      ctx.rotate(this.angle);
      ctx.strokeStyle = "#e8e2d0";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-8, 0);
      ctx.lineTo(6, 0);
      ctx.stroke();
      // head
      ctx.fillStyle = "#c9c2ac";
      ctx.beginPath();
      ctx.moveTo(9, 0);
      ctx.lineTo(3, -3);
      ctx.lineTo(3, 3);
      ctx.closePath();
      ctx.fill();
      // fletching
      ctx.fillStyle = "#4a90d9";
      ctx.beginPath();
      ctx.moveTo(-8, 0);
      ctx.lineTo(-11, -3);
      ctx.lineTo(-6, 0);
      ctx.lineTo(-11, 3);
      ctx.closePath();
      ctx.fill();
    } else if (this.kind === "spear") {
      ctx.rotate(this.angle);
      ctx.strokeStyle = "#d9c9a0";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-14, 0);
      ctx.lineTo(10, 0);
      ctx.stroke();
      ctx.fillStyle = "#cfd6dd";
      ctx.beginPath();
      ctx.moveTo(18, 0);
      ctx.lineTo(8, -4);
      ctx.lineTo(8, 4);
      ctx.closePath();
      ctx.fill();
    } else {
      // cannonball
      ctx.fillStyle = "#2a2f36";
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.arc(-2, -2, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// helper so towers can build projectiles with a stats object
export function makeSpear(
  x: number,
  y: number,
  angle: number,
  s: TowerStats
): Projectile {
  return new Projectile("spear", x, y, angle, s.projSpeed, s.damage, { pierce: s.pierce });
}
