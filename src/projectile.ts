import type { Game } from "./game";
import type { Enemy } from "./enemy";
import type { TowerStats } from "./types";
import { WORLD_W, WORLD_H } from "./config";
import { drawSprite } from "./sprite";

type ProjKind = "arrow" | "spear" | "cannonball" | "bolt";

/** Specialization modifiers a tower attaches to its projectiles. */
export interface SpecMods {
  /** Arrows: pass through this many extra enemies (flies straight, no homing). */
  pierce?: number;
  /** Arrows: apply this burn dps on hit. */
  burnDps?: number;
  /** Spears: each hit splashes 50% damage within this radius. */
  ripple?: number;
  /** Ignore up to this much enemy armor (Infinity = all). */
  armorIgnore?: number;
  /** Spears: ricochet to the nearest foe this many times at 70% damage. */
  ricochet?: number;
  /** Cannon: burst into this many shards on impact (35% dmg, r 22). */
  cluster?: number;
  /** Cannon: leave a burning patch dealing this dps. */
  napalm?: number;
  /** Cannon: bounce to the nearest foe this many times at 70% damage. */
  bounce?: number;
  /** Wizard: slow the struck foe by this fraction (0..1) on hit. */
  slow?: number;
  /** Wizard: duration of the slow, seconds. */
  slowDur?: number;
  /** Wizard: burst for pct damage within r of the struck foe. */
  blast?: { r: number; pct: number };
}

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
  mods: SpecMods;
  /** True once the arrow is a straight-flying piercer (no homing). */
  straight = false;
  /** Wizard bolt: animated fx sheet key (manifest.fx) + per-level draw scale. */
  fxKey?: string;
  impactKey?: string;
  scale = 1;
  private target: Enemy | null;
  private tx: number;
  private ty: number;
  private hitSet = new Set<Enemy>();
  private travel = 0;
  private maxTravel: number;
  private angle: number;
  private ricochets = 0;
  private bounces = 0;
  /** Elapsed flight time (drives the bolt's sprite animation). */
  private t = 0;

  constructor(
    kind: ProjKind,
    x: number,
    y: number,
    angle: number,
    speed: number,
    damage: number,
    opts: {
      target?: Enemy;
      tx?: number;
      ty?: number;
      splash?: number;
      pierce?: number;
      mods?: SpecMods;
      fxKey?: string;
      impactKey?: string;
      scale?: number;
    } = {}
  ) {
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.speed = speed;
    this.damage = damage;
    this.mods = opts.mods ?? {};
    this.target = opts.target ?? null;
    this.tx = opts.tx ?? x;
    this.ty = opts.ty ?? y;
    this.splash = opts.splash ?? 0;
    this.pierce = opts.pierce ?? 0;
    this.fxKey = opts.fxKey;
    this.impactKey = opts.impactKey;
    this.scale = opts.scale ?? 1;
    if ((this.kind === "arrow" || this.kind === "bolt") && (this.mods.pierce ?? 0) > 0) {
      this.pierce = this.mods.pierce!;
      this.straight = true;
      this.target = null;
    }
    this.ricochets = this.mods.ricochet ?? 0;
    this.bounces = this.mods.bounce ?? 0;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.maxTravel = kind === "spear" ? 280 : kind === "cannonball" ? 900 : 700;
  }

  update(game: Game, dt: number): void {
    this.t += dt;
    if (this.kind === "arrow" || this.kind === "bolt") {
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
      else if (!this.tryRicochet(game)) this.dead = true;
      return;
    }

    if ((this.kind === "arrow" || this.kind === "bolt") && this.target) {
      const t = this.target;
      const d = Math.hypot(t.x - this.x, t.visualY - this.y);
      if (d < 13) {
        this.hitEnemy(game, t);
        this.dead = true;
      }
    } else if ((this.kind === "arrow" || this.kind === "bolt") && this.straight) {
      // Piercing bolt: flies straight, hits each enemy in its path once.
      for (const e of game.enemies) {
        if (e.dead || this.hitSet.has(e)) continue;
        if (Math.hypot(e.x - this.x, e.visualY - this.y) < 14 * e.scale + 6) {
          this.hitEnemy(game, e);
          this.hitSet.add(e);
          if (this.hitSet.size > this.pierce) {
            this.dead = true;
            break;
          }
        }
      }
    } else if (this.kind === "spear") {
      for (const e of game.enemies) {
        if (e.dead || this.hitSet.has(e)) continue;
        if (Math.hypot(e.x - this.x, e.visualY - this.y) < 16 * e.scale + 7) {
          this.hitEnemy(game, e);
          if (this.mods.ripple) this.ripple(game, e);
          this.hitSet.add(e);
          if (this.hitSet.size >= this.pierce) {
            if (!this.tryRicochet(game)) this.dead = true;
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

  /** Horned Charge: splash 50% of the hit's damage to foes near the struck enemy. */
  private ripple(game: Game, center: Enemy): void {
    const r = this.mods.ripple!;
    for (const e of game.enemies) {
      if (e.dead || e === center) continue;
      if (Math.hypot(e.x - center.x, e.visualY - center.visualY) <= r) {
        game.damageEnemy(e, this.damage * 0.5, "physical", this.mods.armorIgnore ?? 0);
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
    game.damageEnemy(e, this.damage, "physical", this.mods.armorIgnore ?? 0);
    if (this.kind === "bolt") {
      // The animated impact sheet IS the hit effect; add slow + burst mods.
      if (this.impactKey) game.spawnWizardImpactFx(this.impactKey, e.x, e.visualY - 10);
      const slow = this.mods.slow ?? 0;
      if (slow > 0) {
        e.slowUntil = game.time + (this.mods.slowDur ?? 1.2);
        e.slowFactor = 1 - slow;
      }
      if (this.mods.blast) this.blast(game, e);
      return;
    }
    game.spawnHitFx(e.x, e.visualY - 10);
    if (this.kind === "arrow") {
      if (game.buffs.arrowSlow > 0) {
        e.slowUntil = game.time + 1.0;
        e.slowFactor = 1 - game.buffs.arrowSlow;
      }
      const burn = Math.max(game.buffs.arrowBurnDps, this.mods.burnDps ?? 0);
      if (burn > 0) {
        e.burnDps = Math.max(e.burnDps, burn);
        e.burnUntil = game.time + 1.5;
      }
    }
  }

  /** Arcane Blast: burst for pct of the hit's damage to foes near the struck enemy. */
  private blast(game: Game, center: Enemy): void {
    const b = this.mods.blast!;
    for (const e of game.enemies) {
      if (e.dead || e === center) continue;
      if (Math.hypot(e.x - center.x, e.visualY - center.visualY) <= b.r) {
        game.damageEnemy(e, this.damage * b.pct, "physical", this.mods.armorIgnore ?? 0);
      }
    }
  }

  /** Ricochet: a spent spear that struck at least one foe flies at the nearest
   *  other foe at 70% damage. Returns true if it relaunched. */
  private tryRicochet(game: Game): boolean {
    if (this.kind !== "spear" || this.ricochets <= 0 || this.hitSet.size === 0) return false;
    this.ricochets--;
    let best: Enemy | null = null;
    let bd = 220;
    for (const e of game.enemies) {
      if (e.dead || this.hitSet.has(e)) continue;
      const d = Math.hypot(e.x - this.x, e.visualY - this.y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (!best) return false;
    this.damage *= 0.7;
    this.angle = Math.atan2(best.visualY - this.y, best.x - this.x);
    this.vx = Math.cos(this.angle) * this.speed;
    this.vy = Math.sin(this.angle) * this.speed;
    this.hitSet.clear();
    this.travel = 0;
    game.spawnPuffFx(this.x, this.y);
    return true;
  }

  private explode(game: Game): void {
    game.spawnExplosionFx(this.x, this.y, 1);
    for (const e of game.enemies) {
      if (e.dead) continue;
      // A ground blast can't reach flying foes.
      if (this.kind === "cannonball" && e.flying) continue;
      if (Math.hypot(e.x - this.x, e.visualY - this.y) <= this.splash + 8 * e.scale) {
        game.damageEnemy(e, this.damage, "physical", this.mods.armorIgnore ?? 0);
        game.spawnHitFx(e.x, e.visualY - 10);
      }
    }
    // Cluster Shell: sub-blasts around the impact point.
    if (this.mods.cluster) {
      for (let i = 0; i < this.mods.cluster; i++) {
        const a = game.rng.next() * Math.PI * 2;
        const d = 28 + game.rng.next() * 72;
        const cx = this.x + Math.cos(a) * d;
        const cy = this.y + Math.sin(a) * d;
        game.spawnExplosionFx(cx, cy, 0.55);
        for (const e of game.enemies) {
          if (e.dead || e.flying) continue;
          if (Math.hypot(e.x - cx, e.visualY - cy) <= 22 + 8 * e.scale) {
            game.damageEnemy(e, this.damage * 0.35, "physical", this.mods.armorIgnore ?? 0);
          }
        }
      }
    }
    // Napalm: a burning patch where the shell landed (fliers pass over).
    if (this.mods.napalm) {
      game.addFirePatch(this.x, this.y, 34, 3, this.mods.napalm);
    }
    // Bouncing Shell: relaunch at the nearest grounded foe.
    if (this.bounces > 0) {
      let best: Enemy | null = null;
      let bd = 140;
      for (const e of game.enemies) {
        if (e.dead || e.flying) continue;
        const d = Math.hypot(e.x - this.x, e.visualY - this.y);
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
      if (best) {
        this.bounces--;
        game.spawnCannonball(this.x, this.y, best.x, best.visualY, this.damage * 0.7, this.splash, this.speed, {
          bounce: this.bounces,
        });
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, game: Game): void {
    ctx.save();
    ctx.translate(this.x, this.y);
    if (this.kind === "bolt") {
      // Animated projectile: rotate to the travel angle and step the fx sheet.
      ctx.rotate(this.angle);
      const def = this.fxKey ? game.assets.manifest.fx[this.fxKey] : null;
      if (def) {
        const fps = def.fps ?? 24;
        const f = Math.floor(this.t * fps) % def.frames.length;
        drawSprite(ctx, game.assets, def, f, 0, 0, { scale: this.scale });
      }
    } else if (this.kind === "arrow") {
      ctx.rotate(this.angle);
      const fiery = (this.mods.burnDps ?? 0) > 0;
      const len = this.straight ? 12 : 8;
      ctx.strokeStyle = fiery ? "#ffb066" : "#e8e2d0";
      ctx.lineWidth = fiery ? 3 : 2.5;
      ctx.beginPath();
      ctx.moveTo(-len, 0);
      ctx.lineTo(6, 0);
      ctx.stroke();
      // head
      ctx.fillStyle = fiery ? "#ff8a3c" : "#c9c2ac";
      ctx.beginPath();
      ctx.moveTo(9, 0);
      ctx.lineTo(3, -3);
      ctx.lineTo(3, 3);
      ctx.closePath();
      ctx.fill();
      // fletching
      ctx.fillStyle = fiery ? "#ff5a2a" : "#4a90d9";
      ctx.beginPath();
      ctx.moveTo(-len, 0);
      ctx.lineTo(-len - 3, -3);
      ctx.lineTo(-len + 2, 0);
      ctx.lineTo(-len - 3, 3);
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
