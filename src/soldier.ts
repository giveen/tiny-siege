// Soldier: a friendly unit mustered by a Barracks. It marches the enemy path
// toward the castle and intercepts the first ground foe it meets — both stop
// and fight until one drops. Ground only (fliers pass overhead).

import type { Game } from "./game";
import type { Tower } from "./tower";
import type { Enemy } from "./enemy";
import { Sprite, drawSprite } from "./sprite";
import { PATH_SPEED_MULT } from "./config";

let sid = 1;

export class Soldier {
  id = sid++;
  home: Tower;
  pathDist: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  dmg: number;
  dead = false;
  target: Enemy | null = null;
  facing = 1;
  private speed: number;
  private atkCd = 0;
  private run: Sprite;
  private idle: Sprite;
  private guard: Sprite;
  private attack: Sprite;
  /** Standing at the standoff, not moving (shows the idle loop). */
  holding = false;

  /** Where the soldier stops and holds the road (a short standoff past the barracks). */
  private holdDist: number;

  constructor(game: Game, home: Tower, stats: { hp: number; dmg: number }) {
    this.home = home;
    // Join the path at the point nearest the barracks, then hold a standoff
    // ahead of it — the marching column arrives into the guard.
    const p = game.world.nearestPathPoint(home.x, home.y);
    this.pathDist = p.dist;
    this.holdDist = Math.min(p.dist + 90, game.world.pathLen - 40);
    this.x = p.x;
    this.y = p.y;
    this.hp = stats.hp;
    this.maxHp = stats.hp;
    this.dmg = stats.dmg;
    // A fast skirmisher: sprints out to meet the column, then walls in place.
    this.speed = 85 * PATH_SPEED_MULT;
    const c = "blue";
    this.run = new Sprite(game.assets.unit(c, "warrior", "run"));
    this.idle = new Sprite(game.assets.unit(c, "warrior", "idle"));
    this.guard = new Sprite(game.assets.unit(c, "warrior", "guard"));
    this.attack = new Sprite(game.assets.unit(c, "warrior", "attack1"));
    // guard is a non-loop brace: start it parked on frame 0, play it when engaged
    this.guard.playing = false;
    game.soldiers.push(this);
  }

  update(game: Game, dt: number): void {
    if (this.dead) return;

    // Keep the current target if it's still in melee; otherwise re-acquire.
    if (this.target) {
      if (this.target.dead || Math.abs(this.target.pathDist - this.pathDist) > 36) this.target = null;
    }
    if (!this.target) {
      let best: Enemy | null = null;
      let bd = 30;
      for (const e of game.enemies) {
        if (e.dead || e.flying) continue;
        const d = Math.abs(e.pathDist - this.pathDist);
        if (d < bd && Math.hypot(e.x - this.x, e.y - this.y) < 36) {
          bd = d;
          best = e;
        }
      }
      if (best) this.guard.playOnce();
      this.target = best;
    }

    if (this.target) {
      // Engaged: stop and strike on a 0.8s cadence.
      this.facing = this.target.x >= this.x ? 1 : -1;
      this.atkCd -= dt;
      if (this.atkCd <= 0) {
        this.atkCd = 0.8;
        game.damageEnemy(this.target, this.dmg, "physical");
        this.attack.playOnce();
        game.sfx("hit");
      }
    } else if (this.pathDist < this.holdDist) {
      // Marching out to the standoff.
      this.holding = false;
      this.pathDist += this.speed * dt;
      const p = game.world.pointAt(this.pathDist);
      this.x = p.x;
      this.y = p.y;
      this.facing = Math.cos(p.angle) >= 0 ? 1 : -1;
    } else {
      // Holding the road: face the direction the column comes from.
      this.holding = true;
      const p = game.world.pointAt(this.pathDist);
      this.x = p.x;
      this.y = p.y;
      this.facing = Math.cos(p.angle) < 0 ? 1 : -1;
    }

    this.run.update(dt);
    this.idle.update(dt);
    this.guard.update(dt);
    this.attack.update(dt);

    // Reached the castle: stand down (no reward, back to the barracks).
    if (this.pathDist >= game.world.pathLen) {
      this.dead = true;
      game.spawnRingFx(this.x, this.y - 8, "#9fd8ff", 0.6);
    }
  }

  takeDamage(game: Game, amount: number): void {
    if (this.dead) return;
    this.hp -= amount;
    game.addText(this.x + (game.rng.next() - 0.5) * 10, this.y - 26, String(Math.round(amount)), "#ff8a3c");
    if (this.hp <= 0) {
      this.dead = true;
      game.spawnExplosionFx(this.x, this.y - 6, 0.5);
      game.sfx("die");
    }
  }

  draw(ctx: CanvasRenderingContext2D, game: Game): void {
    if (this.dead) return;
    // shadow
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 2, 10, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const showAttack = this.attack.playing;
    const anim = showAttack ? this.attack : this.target ? this.guard : this.holding ? this.idle : this.run;
    drawSprite(ctx, game.assets, anim.def, anim.frameIdx, this.x, this.y, { scale: 0.5, flipX: this.facing < 0 });

    // hp bar when hurt
    if (this.hp < this.maxHp) {
      const w = 20;
      const x = this.x - w / 2;
      const y = this.y - 34;
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(x - 1, y - 1, w + 2, 5);
      ctx.fillStyle = "#7ec87e";
      ctx.fillRect(x, y, w * Math.max(0, this.hp / this.maxHp), 3);
      ctx.restore();
    }
  }
}
