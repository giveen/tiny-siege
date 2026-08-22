import type { Game } from "./game";
import { Sprite, drawSprite } from "./sprite";
import type { UnitColor, Assets } from "./assets";
import { PATH_SPEED_MULT, ENEMY_SCALE_MULT } from "./config";

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
  /** Flat physical-damage reduction per hit (burn/magic ignore it). */
  armor?: number;
}

// Base stats; scaled by wave number at spawn.
export const ENEMY_DEFS: Record<EnemyType, EnemyDef> = {
  // Distinct HP tiers: frail speedsters -> sturdy melee -> heavy tanks -> boss.
  mantis: { type: "mantis", unit: null, special: "mantis", hp: 16, speed: 104, castleDamage: 4, reward: 3, scale: 1.7 },
  mushroom: { type: "mushroom", unit: null, special: "mushroom", hp: 20, speed: 92, castleDamage: 5, reward: 3, scale: 1.1 },
  archer: { type: "archer", unit: "archer", hp: 24, speed: 78, castleDamage: 7, reward: 3, scale: 1.0 },
  fly3: { type: "fly3", unit: null, special: "fly3", flying: true, hp: 34, speed: 74, castleDamage: 6, reward: 3, scale: 1.4 },
  pawn: { type: "pawn", unit: "pawn", hp: 42, speed: 56, castleDamage: 6, reward: 2, scale: 1.0 },
  flydemon: { type: "flydemon", unit: null, special: "flydemon", flying: true, hp: 54, speed: 66, castleDamage: 8, reward: 4, scale: 1.05 },
  healer: { type: "healer", unit: "monk", hp: 68, speed: 46, castleDamage: 5, reward: 6, scale: 1.0, healer: true },
  beetle: { type: "beetle", unit: null, special: "beetle", hp: 84, speed: 33, castleDamage: 9, reward: 4, scale: 1.7, armor: 3 },
  warrior: { type: "warrior", unit: "warrior", hp: 110, speed: 40, castleDamage: 11, reward: 4, scale: 1.05, armor: 2 },
  skeleton: {
    type: "skeleton", unit: null, special: "skeleton",
    variants: ["skeleton_white", "skeleton_yellow"],
    hp: 145, speed: 44, castleDamage: 10, reward: 5, scale: 1.25, armor: 3,
  },
  lancer: { type: "lancer", unit: "lancer", hp: 205, speed: 34, castleDamage: 17, reward: 7, scale: 1.12, armor: 4 },
  // The boss is the Minotaur — slow and sturdy, boss waves only (every 5th,
  // right before the island grows). Early bosses must be beatable by a small
  // fleet of archers on the tiny starting island, so base stats stay low;
  // the wave scaling carries the later ones.
  boss: { type: "boss", unit: null, special: "minotaur", hp: 800, speed: 30, castleDamage: 60, reward: 90, scale: 2.3, armor: 3 },
};

/** Sprite AssetDef for an enemy type (for wave-preview icons). */
export function enemyPreviewDef(assets: Assets, type: EnemyType, color: UnitColor) {
  const base = ENEMY_DEFS[type];
  if (base.special) {
    const key = base.variants ? base.variants[0] : base.special;
    return assets.special(key);
  }
  return assets.unit(color, base.unit!, "run");
}

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
  armor: number;
  flying: boolean;
  specialKey: string | null;
  angle = 0;
  flipX = false;
  hitFlash = 0;
  slowUntil = 0;
  slowFactor = 1;
  burnDps = 0;
  burnUntil = 0;
  /** Burn damage dealt but not yet shown (DoT ticks are too small per frame). */
  dotAccum = 0;
  /** Next time a burn total may be shown as a floating number. */
  dotShowAt = 0;
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
    this.scale = base.scale * ENEMY_SCALE_MULT;
    this.armor = base.armor ?? 0;
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

    // burn damage over time. The DoT deals tiny per-frame amounts, so show
    // the accumulated total once per 0.5s instead of a stream of "0" numbers.
    if (now < this.burnUntil && this.burnDps > 0) {
      game.damageEnemy(this, this.burnDps * dt, "burn");
      if (now >= this.dotShowAt) {
        if (this.dotAccum >= 1) {
          game.addText(this.x + (game.rng.next() - 0.5) * 16, this.y - 24, String(Math.round(this.dotAccum)), "#ff9a3c");
          this.dotAccum = 0;
        }
        this.dotShowAt = now + 0.5;
      }
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
    // Armor soaks flat physical damage per hit; burn and magic ignore it.
    let dmg = amount;
    if (kind === "physical" && this.armor > 0) dmg = Math.max(1, dmg - this.armor);
    this.hp -= dmg;
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

    // status pips just above the hp bar: armor shield (gray) and slow (blue)
    const slowed = game.time < this.slowUntil;
    if (this.armor > 0 || slowed) {
      ctx.save();
      const baseY = this.y - 37 * this.scale;
      const s = 5.2 * Math.min(1.15, this.scale);
      let ix = this.x - (this.armor > 0 && slowed ? s : 0); // center a pair
      if (this.armor > 0) {
        // shield
        ctx.fillStyle = "rgba(172,192,214,0.95)";
        ctx.strokeStyle = "rgba(20,30,45,0.85)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(ix - s, baseY);
        ctx.lineTo(ix + s, baseY);
        ctx.lineTo(ix + s, baseY + s);
        ctx.lineTo(ix, baseY + s * 2);
        ctx.lineTo(ix - s, baseY + s);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ix += s * 2.6;
      }
      if (slowed) {
        // frost dot
        ctx.fillStyle = "rgba(130,205,255,0.95)";
        ctx.strokeStyle = "rgba(20,30,45,0.8)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(ix, baseY + s * 0.7, s * 0.85, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}
