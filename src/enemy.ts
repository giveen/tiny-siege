import type { Game } from "./game";
import { Sprite, drawSprite } from "./sprite";
import type { UnitColor } from "./assets";
import { PATH_SPEED_MULT } from "./config";

export type EnemyType =
  | "pawn"
  | "warrior"
  | "archer"
  | "lancer"
  | "healer"
  | "mushroom"
  | "skeleton"
  | "flydemon"
  | "mantis"
  | "beetle"
  | "fly3"
  | "boss";

export interface EnemyDef {
  type: EnemyType;
  unit: "pawn" | "warrior" | "archer" | "lancer" | "monk" | null;
  /** key into assets.special for external-pack enemies (overrides unit). */
  special?: string;
  /** alternate special keys to randomly pick from (e.g. skeleton colors). */
  variants?: string[];
  flying?: boolean;
  hp: number;
  speed: number;
  castleDamage: number;
  reward: number;
  scale: number;
  healer?: boolean;
}

// Base stats; scaled by wave number at spawn.
export const ENEMY_DEFS: Record<EnemyType, EnemyDef> = {
  pawn: { type: "pawn", unit: "pawn", hp: 32, speed: 56, castleDamage: 6, reward: 2, scale: 1.0 },
  archer: { type: "archer", unit: "archer", hp: 26, speed: 78, castleDamage: 7, reward: 3, scale: 1.0 },
  warrior: { type: "warrior", unit: "warrior", hp: 78, speed: 40, castleDamage: 11, reward: 4, scale: 1.05 },
  lancer: { type: "lancer", unit: "lancer", hp: 140, speed: 34, castleDamage: 17, reward: 7, scale: 1.12 },
  healer: { type: "healer", unit: "monk", hp: 60, speed: 46, castleDamage: 5, reward: 6, scale: 1.0, healer: true },
  // New enemy archetypes from the added packs.
  mushroom: { type: "mushroom", unit: null, special: "mushroom", hp: 22, speed: 92, castleDamage: 5, reward: 3, scale: 1.1 },
  skeleton: {
    type: "skeleton", unit: null, special: "skeleton",
    variants: ["skeleton_white", "skeleton_yellow"],
    hp: 96, speed: 44, castleDamage: 10, reward: 5, scale: 1.25,
  },
  flydemon: { type: "flydemon", unit: null, special: "flydemon", flying: true, hp: 44, speed: 66, castleDamage: 8, reward: 4, scale: 1.05 },
  // Insects — small ground bugs.
  mantis: { type: "mantis", unit: null, special: "mantis", hp: 18, speed: 104, castleDamage: 4, reward: 3, scale: 1.0 },
  beetle: { type: "beetle", unit: null, special: "beetle", hp: 58, speed: 33, castleDamage: 9, reward: 4, scale: 1.0 },
  // A second, smaller flying type (forest sprite).
  fly3: { type: "fly3", unit: null, special: "fly3", flying: true, hp: 30, speed: 74, castleDamage: 6, reward: 3, scale: 1.0 },
  // The boss is the Minotaur.
  boss: { type: "boss", unit: null, special: "minotaur", hp: 950, speed: 44, castleDamage: 60, reward: 90, scale: 2.3 },
};

let nextId = 1;

export class Enemy {
  id = nextId++;
  def: EnemyDef;
  color: UnitColor;
  x = 0;
  y = 0;
  pathDist = 0;
  hp: number;
  maxHp: number;
  speed: number;
  castleDamage: number;
  reward: number;
  scale: number;
  flying: boolean;
  specialKey: string | null;
  angle = 0;
  flipX = false;
  hitFlash = 0;
  slowUntil = 0;
  slowFactor = 1;
  burnDps = 0;
  burnUntil = 0;
  dead = false;
  reached = false;
  private bob = 0;
  private sprite: Sprite;
  private healTimer = 0;

  /** Y position of the sprite anchor (raised + bobbing for flying enemies). */
  get visualY(): number {
    return this.y - (this.flying ? 26 : 0) + this.bob;
  }

  constructor(game: Game, type: EnemyType, color: UnitColor, wave: number) {
    const base = ENEMY_DEFS[type];
    this.def = base;
    this.color = color;
    this.flying = !!base.flying;
    const hpScale = 1 + wave * 0.13 + (type === "boss" ? wave * 0.02 : 0);
    const dmgScale = 1 + wave * 0.04;
    this.maxHp = Math.round(base.hp * hpScale);
    this.hp = this.maxHp;
    this.speed = base.speed * PATH_SPEED_MULT * (1 + wave * 0.008);
    this.castleDamage = Math.round(base.castleDamage * dmgScale);
    this.reward = Math.round(base.reward * (1 + wave * 0.02));
    this.scale = base.scale;
    const spawn = game.world.spawnPoint();
    this.x = spawn.x;
    this.y = spawn.y;

    if (base.special) {
      this.specialKey = base.variants ? game.rng.pick(base.variants) : base.special;
      this.sprite = new Sprite(game.assets.special(this.specialKey));
    } else {
      this.specialKey = null;
      this.sprite = new Sprite(game.assets.unit(color, base.unit!, "run"));
    }
  }

  /** The sprite AssetDef for this enemy (special pack or colored unit). */
  spriteDef(game: Game) {
    return this.specialKey ? game.assets.special(this.specialKey) : game.assets.unit(this.color, this.def.unit!, "run");
  }

  get pos() {
    return { x: this.x, y: this.y };
  }

  update(game: Game, dt: number): void {
    const now = game.time;

    // burn damage over time
    if (now < this.burnUntil && this.burnDps > 0) {
      game.damageEnemy(this, this.burnDps * dt, "burn");
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

  takeDamage(game: Game, amount: number, kind: "physical" | "burn" | "magic"): void {
    if (this.dead) return;
    this.hp -= amount;
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
  }
}
