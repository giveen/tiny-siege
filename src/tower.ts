import type { Game } from "./game";
import { Sprite, drawSprite } from "./sprite";
import { asAsset } from "./assets";
import type { BuildSpot } from "./map";
import type { TowerType, TowerStats } from "./types";
import type { Enemy } from "./enemy";

export interface TowerDef {
  type: TowerType;
  name: string;
  building: string;
  unit: "archer" | "lancer" | "monk" | null;
  cost: number;
  damage: number;
  rate: number;
  range: number;
  splash: number;
  pierce: number;
  projSpeed: number;
  buffDmg: number;
  buffSpeed: number;
  desc: string;
}

export const TOWER_DEFS: Record<TowerType, TowerDef> = {
  archer: {
    type: "archer",
    name: "Archer Post",
    building: "archery",
    unit: "archer",
    cost: 50,
    damage: 9,
    rate: 2.2,
    range: 150,
    splash: 0,
    pierce: 0,
    projSpeed: 430,
    buffDmg: 0,
    buffSpeed: 0,
    desc: "Rapid single-target arrows.",
  },
  lancer: {
    type: "lancer",
    name: "Lance Tower",
    building: "tower",
    unit: "lancer",
    cost: 90,
    damage: 22,
    rate: 0.9,
    range: 140,
    splash: 0,
    pierce: 2,
    projSpeed: 540,
    buffDmg: 0,
    buffSpeed: 0,
    desc: "Heavy spears that pierce a line of foes.",
  },
  cannon: {
    type: "cannon",
    name: "Cannon",
    building: "barracks",
    unit: null,
    cost: 120,
    damage: 34,
    rate: 0.55,
    range: 155,
    splash: 56,
    pierce: 0,
    projSpeed: 320,
    buffDmg: 0,
    buffSpeed: 0,
    desc: "Slow splash shells. Can't hit flying foes.",
  },
  monastery: {
    type: "monastery",
    name: "Monastery",
    building: "monastery",
    unit: "monk",
    cost: 100,
    damage: 0,
    rate: 0,
    range: 125,
    splash: 0,
    pierce: 0,
    projSpeed: 0,
    buffDmg: 0.18,
    buffSpeed: 0.18,
    desc: "Blesses nearby towers: +damage & +speed.",
  },
};

export const TOWER_ORDER: TowerType[] = ["archer", "lancer", "cannon", "monastery"];
export const MAX_UPGRADE = 5;

// Per-stat upgrade tracks. Each track has its own level (0..MAX_UPGRADE) and cost.
export type UpgradeTrack = "damage" | "rate" | "range";

const TRACK_COST_FACTOR: Record<UpgradeTrack, number> = { damage: 0.6, rate: 0.5, range: 0.45 };

export function upgradeCost(type: TowerType, track: UpgradeTrack, level: number): number {
  return Math.round(TOWER_DEFS[type].cost * TRACK_COST_FACTOR[track] * (level + 1));
}

/** Which upgrade tracks a tower offers (monastery blesses rather than shoots). */
export function tracksFor(type: TowerType): UpgradeTrack[] {
  return type === "monastery" ? ["damage", "range"] : ["damage", "rate", "range"];
}

export function trackLabel(type: TowerType, track: UpgradeTrack): string {
  if (type === "monastery") return track === "damage" ? "Blessing" : "Aura";
  if (track === "damage") return "Damage";
  if (track === "rate") return "Fire Rate";
  return "Range";
}

export class Tower {
  type: TowerType;
  def: TowerDef;
  spot: BuildSpot;
  x: number;
  y: number;
  upg: Record<UpgradeTrack, number> = { damage: 0, rate: 0, range: 0 };
  cooldown = 0;
  facing = 1; // 1 = face right, -1 = face left
  private idle: Sprite;
  private anim: Sprite;
  private animDef: { action: string; loop: boolean } | null = null;
  private pulse = 0;
  totalInvested = 0;

  constructor(game: Game, type: TowerType, spot: BuildSpot) {
    this.type = type;
    this.def = TOWER_DEFS[type];
    this.spot = spot;
    this.x = spot.x;
    this.y = spot.y;
    this.totalInvested = this.def.cost;
    const color = "blue";
    if (this.def.unit) {
      const idleDef = game.assets.unit(color, this.def.unit, "idle");
      this.idle = new Sprite(idleDef);
      const atkAction =
        type === "archer" ? "shoot" : type === "lancer" ? "attack" : type === "monastery" ? "heal" : "idle";
      const atkDef = game.assets.unit(color, this.def.unit, atkAction);
      this.anim = new Sprite(atkDef);
      this.animDef = { action: atkAction, loop: type === "monastery" };
    } else {
      // cannon: use a warrior as the loader for flavor
      this.idle = new Sprite(game.assets.unit(color, "warrior", "idle"));
      this.anim = new Sprite(game.assets.unit(color, "warrior", "attack1"));
      this.animDef = { action: "attack1", loop: false };
    }
  }

  /** Total upgrade points invested (for pips / display). */
  get totalUpgrades(): number {
    return this.upg.damage + this.upg.rate + this.upg.range;
  }

  /** Monastery: effective aura buff multiplier from Blessing upgrades + gear. */
  buffPower(game: Game): number {
    const eq = game.equipFor("monastery");
    return this.def.buffDmg * (1 + 0.5 * this.upg.damage) * (1 + eq.bless);
  }

  /** Effective stats after per-track upgrades + global buffs + monastery aura + synergy. */
  stats(game: Game): TowerStats {
    const d = this.def;
    const u = this.upg;
    let damage = d.damage * (1 + 0.3 * u.damage);
    let rate = d.rate * (1 + 0.2 * u.rate);
    let range = d.range * (1 + 0.12 * u.range);
    let splash = d.splash * (1 + 0.1 * u.damage);
    let pierce = d.pierce + Math.floor(u.damage / 2);

    // Gear equipped in the Armory: flat % per equipped piece (tier-scaled).
    const eq = game.equipFor(this.type);
    damage *= 1 + eq.damage;
    rate *= 1 + eq.rate;
    range *= 1 + eq.range;
    splash *= 1 + eq.splash;

    const b = game.buffs;
    damage *= b.damageMult;
    rate *= b.speedMult;
    range *= b.rangeMult;
    splash *= b.splashMult;
    pierce += b.pierceBonus;

    // archer-specific boon multipliers
    if (this.type === "archer") {
      damage *= game.archerDamageMult;
      rate *= game.archerSpeedMult;
    }

    // monastery auras affecting this tower
    for (const t of game.towers) {
      if (t !== this && t.type === "monastery") {
        const ms = t.statsOnly(game);
        if (Math.hypot(t.x - this.x, t.y - this.y) <= ms.range) {
          const p = t.buffPower(game);
          damage *= 1 + p;
          rate *= 1 + p;
        }
      }
    }

    // Adjacency synergy: clustering towers grants a small +damage (base), and the
    // Battle Line boon amplifies the per-neighbor bonus further. Placement always
    // carries meaning.
    let adj = 0;
    for (const t of game.towers)
      if (t !== this && Math.hypot(t.x - this.x, t.y - this.y) < 78) adj++;
    const perAdj = 0.04 + b.synergy; // base +4%/neighbor, boon adds more
    damage *= 1 + Math.min(6, adj) * perAdj;

    return { damage, rate, range, splash, pierce, projSpeed: d.projSpeed, buffDmg: d.buffDmg, buffSpeed: d.buffSpeed };
  }

  /** stats without recursion (used by aura checks) */
  private statsOnly(game: Game): TowerStats {
    const d = this.def;
    const eq = game.equipFor(this.type);
    const range = d.range * (1 + 0.15 * this.upg.range) * (1 + eq.range) * game.buffs.rangeMult;
    return {
      damage: 0,
      rate: 0,
      range,
      splash: 0,
      pierce: 0,
      projSpeed: 0,
      buffDmg: d.buffDmg,
      buffSpeed: d.buffSpeed,
    };
  }

  private acquireTarget(game: Game, range: number): Enemy | null {
    let best: Enemy | null = null;
    for (const e of game.enemies) {
      if (e.dead) continue;
      // Ground artillery can't reach flying foes — a real anti-air counter.
      if (this.type === "cannon" && e.flying) continue;
      const d = Math.hypot(e.x - this.x, e.visualY - this.y);
      if (d <= range && (!best || e.pathDist > best.pathDist)) best = e;
    }
    return best;
  }

  update(game: Game, dt: number): void {
    this.idle.update(dt);
    this.anim.update(dt);

    if (this.type === "monastery") {
      // periodic blessing pulse for visuals
      this.pulse -= dt;
      if (this.pulse <= 0) {
        this.pulse = 2.4;
        game.spawnRingFx(this.x, this.y - 20, "#bfe8ff", 1);
      }
      return;
    }

    this.cooldown -= dt;
    const s = this.stats(game);
    const target = this.acquireTarget(game, s.range);

    if (target) {
      this.facing = target.x >= this.x ? 1 : -1;
      if (this.cooldown <= 0) {
        this.fire(game, target, s);
        this.cooldown = 1 / Math.max(0.05, s.rate);
      }
    }
  }

  private fire(game: Game, target: Enemy, s: TowerStats): void {
    const ox = this.x;
    const oy = this.y - 22;
    // trigger attack animation
    if (this.animDef && !this.animDef.loop) this.anim.playOnce();
    const angle = Math.atan2(target.visualY - oy, target.x - ox);

    if (this.type === "archer") {
      game.spawnArrow(ox, oy, target, s.damage, s.projSpeed);
      game.sfx("shoot");
    } else if (this.type === "lancer") {
      game.spawnSpear(ox, oy, angle, s.damage, s.projSpeed, s.pierce);
      game.spawnSlashFx(ox, oy, angle, 1);
      game.sfx("spear");
    } else if (this.type === "cannon") {
      game.spawnCannonball(ox, oy, target.x, target.visualY, s.damage, s.splash, s.projSpeed);
      game.sfx("cannon");
    }
  }

  draw(ctx: CanvasRenderingContext2D, game: Game): void {
    const assets = game.assets;
    const color = "blue";
    // range ring (faint) — only when selected/placing handled in HUD; draw a subtle base
    // building
    const b = assets.building(color, this.def.building);
    const bAsset = asAsset(b);
    // keep the tower compact so it fits neatly on its pad
    const bs = 0.32;
    drawSprite(ctx, assets, bAsset, 0, this.x, this.y + 6, { scale: bs });

    // unit operator in front
    if (this.def.unit || this.type === "cannon") {
      const showAnim = this.animDef && !this.animDef.loop && this.anim.playing;
      const def = showAnim
        ? assets.unit(color, this.def.unit ?? "warrior", this.animDef!.action)
        : assets.unit(color, this.def.unit ?? "warrior", "idle");
      const idx = showAnim ? this.anim.frameIdx : this.idle.frameIdx;
      const flip = this.facing < 0;
      drawSprite(ctx, assets, def, idx, this.x + (flip ? -5 : 5), this.y, { scale: 0.46, flipX: flip });
    }

    // upgrade pips (one per upgrade point)
    const pts = Math.min(this.totalUpgrades, 8);
    if (pts > 0) {
      const startX = this.x - ((pts - 1) * 5) / 2;
      for (let i = 0; i < pts; i++) {
        ctx.save();
        ctx.fillStyle = i < 3 ? "#ffd24a" : "#ff8a3c";
        ctx.strokeStyle = "rgba(0,0,0,0.5)";
        ctx.lineWidth = 1;
        const px = startX + i * 5;
        const py = this.y + 16;
        ctx.beginPath();
        ctx.arc(px, py, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
  }
}
