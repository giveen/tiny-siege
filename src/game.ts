import { loadAssets, type Assets, ENEMY_COLORS, asAsset } from "./assets";
import { World } from "./map";
import { Input } from "./input";
import { Audio } from "./audio";
import { RNG } from "./rng";
import { Sprite, drawSprite } from "./sprite";
import { Enemy, type EnemyType } from "./enemy";
import { Tower, TOWER_DEFS, TOWER_ORDER, MAX_LEVEL, upgradeCost } from "./tower";
import { Projectile } from "./projectile";
import { Fx } from "./fx";
import { generateWave, type SpawnEntry } from "./waves";
import { rollBoons, BOONS, type Boon } from "./boons";
import { defaultBuffs, type Buffs, type TowerType, type CastleState } from "./types";
import {
  WORLD_W,
  WORLD_H,
  START_GOLD,
  START_CASTLE_HP,
  WAVE_CLEAR_GOLD,
  KILL_GOLD_BASE,
  SPEEDS,
  BEST_KEY,
} from "./config";
import { Hud } from "./hud";

export type Screen = "loading" | "menu" | "game" | "over";
export type WavePhase = "build" | "active" | "boon";

export class Game {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  input: Input;
  audio: Audio;

  assets: Assets;
  world: World;
  hud: Hud;
  rng: RNG = new RNG();

  // run state
  screen: Screen = "loading";
  wavePhase: WavePhase = "build";
  paused = false;
  time = 0;
  speedIdx = 0;
  get speed() {
    return SPEEDS[this.speedIdx];
  }

  gold = START_GOLD;
  wave = 0;
  kills = 0;
  castle: CastleState = { x: 0, y: 0, hp: START_CASTLE_HP, maxHp: START_CASTLE_HP };
  buffs: Buffs = defaultBuffs();
  archerDamageMult = 1;
  archerSpeedMult = 1;
  unlocked: Set<TowerType> = new Set(["archer"]);
  private boonCounts: Record<string, number> = {};

  // entities
  towers: Tower[] = [];
  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  fx: Fx[] = [];
  spawnQueue: SpawnEntry[] = [];
  private waveTime = 0;
  private castleAuraTimer = 0;

  // interaction
  placing: TowerType | null = null;
  selectedTower: Tower | null = null;
  _showHelp = false;
  mouse = { x: 0, y: 0, over: false };

  // intermission boons
  boonChoices: Boon[] = [];

  // demo / attract mode (enabled via ?demo or ?start in the URL)
  demo = false;
  autoStart = false;
  rngSeed: number | null = null;
  private demoBuildTimer = 0;
  private demoBoonTimer = 0;
  private demoBuildCount = 0;

  best = 0;
  private castleSprite: Sprite;
  private shake = 0;

  private lastTs = 0;
  private raf = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.width = WORLD_W;
    canvas.height = WORLD_H;
    this.ctx = canvas.getContext("2d")!;
    this.ctx.imageSmoothingEnabled = false;
    this.input = new Input(canvas);
    this.audio = new Audio();
    this.assets = undefined as unknown as Assets; // set in init
    this.world = undefined as unknown as World;
    this.hud = undefined as unknown as Hud;
    this.castleSprite = undefined as unknown as Sprite;

    try {
      this.best = parseInt(localStorage.getItem(BEST_KEY) ?? "0", 10) || 0;
    } catch {
      this.best = 0;
    }

    // start the loop immediately so the loading screen renders right away
    this.lastTs = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  async init(): Promise<void> {
    const assets = await loadAssets("assets/");
    this.assets = assets;
    this.rng = new RNG();
    this.world = new World(assets, this.rng);
    this.castle.x = this.world.castlePos.x;
    this.castle.y = this.world.castlePos.y;
    this.castleSprite = new Sprite(asAsset(assets.building("blue", "castle")));
    this.hud = new Hud(assets);
    this.screen = "menu";

    const params = new URLSearchParams(location.search);
    const seedParam = params.get("seed");
    if (seedParam && !Number.isNaN(parseInt(seedParam, 10))) this.rngSeed = parseInt(seedParam, 10);
    this.autoStart = params.has("start");
    this.demo = params.has("demo");
    if (this.autoStart || this.demo) {
      this.startRun();
      const ff = parseFloat(params.get("ff") ?? "0");
      if (ff > 0) this.fastForward(ff);
    }

    // ?show=type1,type2,...  — spawn a lineup of specific enemy types for inspection
    const show = params.get("show");
    if (show) {
      this.startRun();
      // place a handful of archers so we can see them engage
      const spots = [...this.world.buildSpots];
      this.rng.shuffle(spots);
      let placed = 0;
      for (const s of spots) {
        if (placed >= 3) break;
        if (this.gold >= TOWER_DEFS.archer.cost && !this.towerAt(s.c, s.r)) {
          this.buildTower("archer", s);
          placed++;
        }
      }
      const types = show.split(",").map((s) => s.trim()).filter(Boolean) as EnemyType[];
      let d = 240;
      for (const t of types) {
        const e = new Enemy(this, t, "red", 6);
        e.pathDist = d;
        const p = this.world.pointAt(d);
        e.x = p.x;
        e.y = p.y;
        this.enemies.push(e);
        d += 120;
      }
    }

    // ?buildall — place one of every tower type (verification / dev tool)
    if (params.has("buildall")) {
      this.startRun();
      this.unlocked = new Set(["archer", "lancer", "cannon", "monastery"]);
      this.gold = 9999;
      const spots = [...this.world.buildSpots];
      this.rng.shuffle(spots);
      const types: TowerType[] = ["archer", "lancer", "cannon", "monastery"];
      for (let i = 0; i < 4 && i < spots.length; i++) this.buildTower(types[i], spots[i]);
      for (let i = 0; i < 3; i++) {
        const e = new Enemy(this, "pawn", "red", 3);
        e.pathDist = 320 + i * 130;
        const p = this.world.pointAt(e.pathDist);
        e.x = p.x;
        e.y = p.y;
        this.enemies.push(e);
      }
    }
  }

  /** Deterministically advance the simulation (used for ?demo screenshots/tests). */
  fastForward(seconds: number): void {
    const step = 1 / 60;
    let t = 0;
    while (t < seconds && this.screen === "game") {
      const dt = Math.min(step, seconds - t);
      this.update(dt);
      t += dt;
    }
  }

  private frame = (ts: number): void => {
    let dt = (ts - this.lastTs) / 1000;
    this.lastTs = ts;
    if (dt > 0.05) dt = 0.05;
    if (dt < 0) dt = 0;

    this.handleInput();

    if (this.screen === "game" && !this.paused) {
      const sdt = dt * this.speed;
      this.simTime(sdt);
      this.update(sdt);
    } else {
      // still tick light animations (menu / paused / over)
      this.time += dt;
      this.fxTick(dt, false);
    }

    this.render();
    this.raf = requestAnimationFrame(this.frame);
  };

  // ---------------------------------------------------------------- run
  startRun(): void {
    this.rng = this.rngSeed != null ? new RNG(this.rngSeed) : new RNG();
    this.world = new World(this.assets, this.rng);
    this.castle.x = this.world.castlePos.x;
    this.castle.y = this.world.castlePos.y;
    this.gold = START_GOLD;
    this.wave = 0;
    this.kills = 0;
    this.castle.hp = START_CASTLE_HP;
    this.castle.maxHp = START_CASTLE_HP;
    this.buffs = defaultBuffs();
    this.archerDamageMult = 1;
    this.archerSpeedMult = 1;
    this.unlocked = new Set(["archer"]);
    this.boonCounts = {};
    this.towers = [];
    this.enemies = [];
    this.projectiles = [];
    this.fx = [];
    this.spawnQueue = [];
    this.placing = null;
    this.selectedTower = null;
    this.wavePhase = "build";
    this.paused = false;
    this.speedIdx = 0;
    this.screen = "game";
    this.audio.unlock();
    this.sfx("wave");
  }

  // ---------------------------------------------------------------- sim
  private simTime(dt: number): void {
    this.time += dt;
  }

  private update(dt: number): void {
    // spawn queue
    if (this.wavePhase === "active") {
      this.waveTime += dt;
      while (this.spawnQueue.length > 0 && this.spawnQueue[0].time <= this.waveTime) {
        const entry = this.spawnQueue.shift()!;
        this.spawnEnemy(entry);
      }
    }

    // enemies
    for (const e of this.enemies) e.update(this, dt);
    this.enemies = this.enemies.filter((e) => !e.dead);

    // towers
    for (const t of this.towers) t.update(this, dt);

    // projectiles
    for (const p of this.projectiles) p.update(this, dt);
    this.projectiles = this.projectiles.filter((p) => !p.dead);

    // fx
    this.fxTick(dt, true);

    // castle ballista aura
    if (this.buffs.castleAuraDps > 0) {
      this.castleAuraTimer -= dt;
      if (this.castleAuraTimer <= 0) {
        this.castleAuraTimer = 0.5;
        for (const e of this.enemies) {
          if (Math.hypot(e.x - this.castle.x, e.y - this.castle.y) < 120)
            this.damageEnemy(e, this.buffs.castleAuraDps * 0.5, "magic");
        }
      }
    }

    // shake decay
    this.shake = Math.max(0, this.shake - dt * 3);

    // wave cleared?
    if (this.wavePhase === "active" && this.spawnQueue.length === 0 && this.enemies.length === 0) {
      this.onWaveCleared();
    }

    // game over?
    if (this.castle.hp <= 0 && this.screen === "game") {
      this.gameOver();
    }

    // demo / attract mode
    if (this.demo && this.screen === "game") {
      if (this.wavePhase === "build") {
        this.demoBuildTimer -= dt;
        if (this.demoBuildTimer <= 0) {
          this.demoBuildTimer = 0.25;
          const built = this.demoAutoBuild();
          if (built) this.demoBuildCount++;
          if (this.demoBuildCount >= 4 || this.gold < 50) {
            this.demoBuildCount = 0;
            this.startWave();
          }
        }
      } else if (this.wavePhase === "boon") {
        this.demoBoonTimer -= dt;
        if (this.demoBoonTimer <= 0 && this.boonChoices.length > 0) {
          this.demoBoonTimer = 0.8;
          this.applyBoon(this.boonChoices[this.rng.int(0, this.boonChoices.length - 1)]);
        }
      }
    }
  }

  private demoAutoBuild(): boolean {
    const spots = this.world.buildSpots.filter((s) => !this.towerAt(s.c, s.r));
    if (spots.length === 0) return false;
    const types = TOWER_ORDER.filter((t) => this.unlocked.has(t));
    const type = this.rng.pick(types);
    if (this.gold < TOWER_DEFS[type].cost) return false;
    // bias toward spots with enemies nearby for satisfying fights
    const spot = this.rng.pick(spots);
    return this.buildTower(type, spot);
  }

  private fxTick(dt: number, sim: boolean): void {
    for (const f of this.fx) f.update(dt * (sim ? 1 : 1));
    this.fx = this.fx.filter((f) => !f.done);
  }

  // ---------------------------------------------------------------- waves
  startWave(): void {
    if (this.wavePhase !== "build") return;
    this.wave++;
    this.spawnQueue = generateWave(this.wave, this.rng);
    this.waveTime = 0;
    this.wavePhase = "active";
    this.placing = null;
    this.selectedTower = null;
    this.sfx("wave");
  }

  private onWaveCleared(): void {
    const reward = Math.round(WAVE_CLEAR_GOLD(this.wave) * this.buffs.goldWaveMult);
    this.gold += reward;
    this.addText(this.castle.x, this.castle.y - 60, `+${reward} gold`, "#ffd24a");
    this.sfx("coin");
    this.boonChoices = rollBoons(this, this.rng, 3);
    this.wavePhase = "boon";
  }

  applyBoon(boon: Boon): void {
    boon.apply(this);
    this.boonCounts[boon.id] = (this.boonCounts[boon.id] ?? 0) + 1;
    this.boonChoices = [];
    this.wavePhase = "build";
    this.sfx("boon");
  }

  countBoon(id: string): number {
    return this.boonCounts[id] ?? 0;
  }

  private spawnEnemy(entry: SpawnEntry): void {
    const e = new Enemy(this, entry.type, entry.color, this.wave);
    // apply risky enemy HP buff
    e.maxHp = Math.round(e.maxHp * this.buffs.enemyHpMult);
    e.hp = e.maxHp;
    this.enemies.push(e);
    if (entry.type === "boss") this.addText(e.x, e.y - 40, "BOSS!", "#ff6a5a");
  }

  private gameOver(): void {
    this.screen = "over";
    this.sfx("over");
    if (this.wave > this.best) {
      this.best = this.wave;
      try {
        localStorage.setItem(BEST_KEY, String(this.best));
      } catch {
        /* ignore */
      }
    }
  }

  // ---------------------------------------------------------------- combat
  damageEnemy(e: Enemy, amount: number, kind: "physical" | "burn" | "magic"): void {
    if (e.dead) return;
    e.takeDamage(this, amount, kind);
    const col = kind === "burn" ? "#ff9a3c" : kind === "magic" ? "#c58bff" : "#ffffff";
    this.addText(e.x + (this.rng.next() - 0.5) * 16, e.y - 24, String(Math.round(amount)), col);
  }

  killEnemy(e: Enemy): void {
    if (e.dead && this.killsCounted(e)) return;
    this.markKilled(e);
    this.kills++;
    const reward = Math.round((KILL_GOLD_BASE + e.reward) * this.buffs.goldKillMult) + this.buffs.killGoldFlat;
    this.gold += reward;
    this.spawnExplosionFx(e.x, e.y - 6, e.def.type === "boss" ? 1.6 : 0.7);
    this.addText(e.x, e.y - 18, `+${reward}`, "#ffd24a");
    this.sfx("die");
  }

  private killed = new Set<Enemy>();
  private killsCounted(e: Enemy): boolean {
    return this.killed.has(e);
  }
  private markKilled(e: Enemy): void {
    this.killed.add(e);
  }

  damageCastle(amount: number): void {
    const reduced = amount * (1 - this.buffs.castleDmgReduction);
    this.castle.hp -= reduced;
    this.shake = 1;
    this.spawnSplashFx(this.castle.x, this.castle.y - 20);
    this.addText(this.castle.x, this.castle.y - 50, `-${Math.round(reduced)}`, "#ff6a5a");
    this.sfx("castle");
  }

  // ---------------------------------------------------------------- building
  buildTower(type: TowerType, spot: { c: number; r: number; x: number; y: number }): boolean {
    const cost = TOWER_DEFS[type].cost;
    if (this.gold < cost) {
      this.addText(spot.x, spot.y - 20, "Need gold", "#ff9a3c");
      return false;
    }
    if (this.towerAt(spot.c, spot.r)) return false;
    this.gold -= cost;
    const t = new Tower(this, type, spot);
    this.towers.push(t);
    this.spawnRingFx(spot.x, spot.y - 10, "#8fe08f", 0.8);
    this.sfx("build");
    return true;
  }

  upgradeTower(t: Tower): void {
    if (t.level >= MAX_LEVEL) return;
    const cost = upgradeCost(t.type, t.level);
    if (this.gold < cost) {
      this.addText(t.x, t.y - 30, "Need gold", "#ff9a3c");
      return;
    }
    this.gold -= cost;
    t.totalInvested += cost;
    t.level++;
    this.spawnRingFx(t.x, t.y - 16, "#ffd24a", 0.9);
    this.sfx("upgrade");
  }

  sellTower(t: Tower): void {
    const refund = Math.round(t.totalInvested * 0.6);
    this.gold += refund;
    this.towers = this.towers.filter((x) => x !== t);
    if (this.selectedTower === t) this.selectedTower = null;
    this.addText(t.x, t.y - 20, `+${refund}`, "#ffd24a");
    this.sfx("sell");
  }

  towerAt(c: number, r: number): Tower | null {
    for (const t of this.towers) if (t.spot.c === c && t.spot.r === r) return t;
    return null;
  }

  spotAtWorld(x: number, y: number): { c: number; r: number; x: number; y: number } | null {
    for (const s of this.world.buildSpots)
      if (Math.abs(s.x - x) < 32 && Math.abs(s.y - y) < 32) return s;
    return null;
  }

  towerAtWorld(x: number, y: number): Tower | null {
    for (const t of this.towers) if (Math.abs(t.x - x) < 30 && Math.abs(t.y - (y - 8)) < 40) return t;
    return null;
  }

  // ---------------------------------------------------------------- projectiles
  spawnArrow(x: number, y: number, target: Enemy, damage: number, speed: number): void {
    const a = Math.atan2(target.y - y, target.x - x);
    this.projectiles.push(new Projectile("arrow", x, y, a, speed, damage, { target }));
  }
  spawnSpear(x: number, y: number, angle: number, damage: number, speed: number, pierce: number): void {
    this.projectiles.push(new Projectile("spear", x, y, angle, speed, damage, { pierce }));
  }
  spawnCannonball(x: number, y: number, tx: number, ty: number, damage: number, splash: number, speed: number): void {
    const a = Math.atan2(ty - y, tx - x);
    this.projectiles.push(new Projectile("cannonball", x, y, a, speed, damage, { tx, ty, splash }));
  }

  // ---------------------------------------------------------------- fx
  private mkFx(kind: Fx["kind"], x: number, y: number, dur: number, scale = 1, extra: Partial<Fx> = {}): Fx {
    const f = new Fx({ kind, x, y, dur, scale, ...extra });
    this.fx.push(f);
    return f;
  }
  spawnExplosionFx(x: number, y: number, scale = 1): void {
    const f = this.mkFx("explosion", x, y, 0.45, scale);
    f.attach(this.assets.manifest.fx.explosion2, 40);
  }
  spawnHitFx(x: number, y: number): void {
    const f = this.mkFx("fire", x, y, 0.22, 0.5);
    f.attach(this.assets.manifest.fx.fire2, 40);
  }
  spawnPuffFx(x: number, y: number): void {
    const f = this.mkFx("dust", x, y, 0.3, 0.6);
    f.attach(this.assets.manifest.fx.dust2, 30);
  }
  spawnSplashFx(x: number, y: number): void {
    const f = this.mkFx("splash", x, y, 0.4, 0.9);
    f.attach(this.assets.manifest.fx.water_splash, 30);
  }
  spawnHealFx(x: number, y: number): void {
    const f = this.mkFx("heal", x, y, 0.4, 0.7);
    f.attach(this.assets.manifest.fx.water_splash, 30);
    f.color = "#9ff0ff";
  }
  spawnRingFx(x: number, y: number, color: string, scale = 1): void {
    this.mkFx("ring", x, y, 0.5, scale, { color });
  }
  spawnSlashFx(x: number, y: number, angle: number, scale = 1): void {
    this.mkFx("slash", x, y, 0.18, scale, { angle, color: "#eaf6ff" });
  }
  addText(x: number, y: number, text: string, color: string): void {
    this.mkFx("float", x, y, 0.9, 1, { text, color });
  }
  sfx(name: Parameters<Audio["play"]>[0]): void {
    this.audio.play(name);
  }

  // ---------------------------------------------------------------- input
  private handleInput(): void {
    if (this.screen === "loading") return;
    this.mouse.x = this.input.world.x;
    this.mouse.y = this.input.world.y;
    this.mouse.over = this.mouse.x >= 0 && this.mouse.x <= WORLD_W && this.mouse.y >= 0 && this.mouse.y <= WORLD_H;

    // global keys
    if (this.input.key("KeyP") && !this._pKey) this.togglePause();
    if (this.input.key("KeyM") && !this._mKey) this.toggleMute();
    if (this.input.key("KeyF") && !this._fKey) this.cycleSpeed();
    if (this.input.key("Escape") && !this._eKey) this.cancelAction();
    if (this.input.key("Space") && !this._spaceKey && this.screen === "game" && !this.paused && this.wavePhase === "build")
      this.startWave();
    const numMap: Record<string, TowerType> = {
      Digit1: "archer",
      Digit2: "lancer",
      Digit3: "cannon",
      Digit4: "monastery",
    };
    for (const code in numMap) {
      const t = numMap[code];
      if (this.input.key(code) && !this._numKeys[code] && this.screen === "game" && this.unlocked.has(t))
        this.setPlacing(this.placing === t ? null : t);
      this._numKeys[code] = this.input.key(code);
    }
    this._pKey = this.input.key("KeyP");
    this._mKey = this.input.key("KeyM");
    this._fKey = this.input.key("KeyF");
    this._eKey = this.input.key("Escape");
    this._spaceKey = this.input.key("Space");

    const clicked = this.input.consumeClick();
    if (!clicked) return;

    if (this.screen === "menu") {
      this.hud.handleMenuClick(this, this.mouse);
      return;
    }
    if (this.screen === "over") {
      this.hud.handleOverClick(this, this.mouse);
      return;
    }

    // game screen: HUD first
    if (this.hud.handleClick(this, this.mouse)) return;

    if (this.wavePhase === "boon") {
      // handled by HUD (modal covers)
      return;
    }

    // placing / selecting
    if (this.paused) return;
    this.worldInteract(this.mouse.x, this.mouse.y);

    // right-click cancels
    if (this.input.consumeRightClick()) this.cancelAction();
  }

  _pKey = false;
  _mKey = false;
  _fKey = false;
  _eKey = false;
  _spaceKey = false;
  _numKeys: Record<string, boolean> = {};

  private worldInteract(x: number, y: number): void {
    if (this.placing) {
      const spot = this.spotAtWorld(x, y);
      if (spot) {
        this.buildTower(this.placing, spot);
        // keep placing if still affordable
        if (this.gold < TOWER_DEFS[this.placing].cost) this.placing = null;
      }
      return;
    }
    const t = this.towerAtWorld(x, y);
    if (t) {
      this.selectedTower = t;
      this.sfx("click");
    } else {
      this.selectedTower = null;
    }
  }

  cancelAction(): void {
    this.placing = null;
    this.selectedTower = null;
  }

  togglePause(): void {
    if (this.screen !== "game") return;
    this.paused = !this.paused;
    this.sfx("click");
  }
  toggleMute(): void {
    this.audio.setEnabled(!this.audio.enabled);
  }
  cycleSpeed(): void {
    this.speedIdx = (this.speedIdx + 1) % SPEEDS.length;
    this.sfx("click");
  }
  setPlacing(type: TowerType | null): void {
    this.placing = type;
    this.selectedTower = null;
    if (type) this.sfx("click");
  }
  get audioEnabled() {
    return this.audio.enabled;
  }

  // ---------------------------------------------------------------- render
  render(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, WORLD_W, WORLD_H);

    if (this.screen === "loading") {
      this.drawLoading(ctx);
      return;
    }
    if (this.screen === "menu") {
      this.hud.drawMenu(this, ctx);
      return;
    }

    // world
    ctx.save();
    if (this.shake > 0) {
      const s = this.shake * 6;
      ctx.translate((this.rng.next() - 0.5) * s, (this.rng.next() - 0.5) * s);
    }
    ctx.drawImage(this.world.bg, 0, 0);

    this.drawBuildSpots(ctx);
    this.drawCastle(ctx);

    // depth-sorted entities
    const items: { y: number; d: () => void }[] = [];
    for (const t of this.towers) items.push({ y: t.y, d: () => t.draw(ctx, this) });
    for (const e of this.enemies) items.push({ y: e.y, d: () => e.draw(ctx, this) });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.d();

    for (const p of this.projectiles) p.draw(ctx, this);
    for (const f of this.fx) f.draw(ctx, this.assets);

    // placement preview
    this.drawPlacementPreview(ctx);

    ctx.restore();

    // HUD (screen space)
    this.hud.draw(this, ctx);

    if (this.paused) this.drawPauseOverlay(ctx);
  }

  private drawBuildSpots(ctx: CanvasRenderingContext2D): void {
    if (!this.placing) return;
    for (const s of this.world.buildSpots) {
      if (this.towerAt(s.c, s.r)) continue;
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = "#7fe07f";
      ctx.beginPath();
      ctx.arc(s.x, s.y - 6, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawPlacementPreview(ctx: CanvasRenderingContext2D): void {
    if (!this.placing || !this.mouse.over) return;
    const s = this.spotAtWorld(this.mouse.x, this.mouse.y);
    const x = s ? s.x : this.mouse.x;
    const y = s ? s.y : this.mouse.y;
    const valid = !!s && !this.towerAt(s.c, s.r) && this.gold >= TOWER_DEFS[this.placing].cost;
    const def = TOWER_DEFS[this.placing];
    // range
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = valid ? "#8fe08f" : "#e05555";
    ctx.beginPath();
    ctx.arc(x, y - 10, def.range, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = valid ? "#8fe08f" : "#e05555";
    ctx.lineWidth = 2;
    ctx.stroke();
    // ghost building (matches the in-world tower scale)
    const b = asAsset(this.assets.building("blue", def.building));
    drawSprite(ctx, this.assets, b, 0, x, y + 6, { scale: 0.32, alpha: 0.7 });
    ctx.restore();
  }

  private drawCastle(ctx: CanvasRenderingContext2D): void {
    const c = this.castle;
    // shadow
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(c.x, c.y + 8, 70, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    drawSprite(ctx, this.assets, this.castleSprite.def, 0, c.x, c.y + 6, { scale: 1.15 });

    // castle aura
    if (this.buffs.castleAuraDps > 0) {
      ctx.save();
      ctx.globalAlpha = 0.12 + Math.sin(this.time * 4) * 0.04;
      ctx.fillStyle = "#8fd0ff";
      ctx.beginPath();
      ctx.arc(c.x, c.y - 10, 120, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // hp bar
    const w = 130;
    const x = c.x - w / 2;
    const y = c.y - 78;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(x - 2, y - 2, w + 4, 12);
    const frac = Math.max(0, c.hp / c.maxHp);
    ctx.fillStyle = frac > 0.5 ? "#6fe06f" : frac > 0.25 ? "#ffd24a" : "#e05555";
    ctx.fillRect(x, y, w * frac, 8);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 11px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${Math.max(0, Math.ceil(c.hp))} / ${c.maxHp}`, c.x, y + 8.5);
    ctx.restore();
  }

  private drawPauseOverlay(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = "#04141a";
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#eaf6ff";
    ctx.font = "bold 40px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("PAUSED", WORLD_W / 2, WORLD_H / 2);
    ctx.font = "16px 'Segoe UI', sans-serif";
    ctx.fillText("Press P to resume", WORLD_W / 2, WORLD_H / 2 + 30);
    ctx.restore();
  }

  private drawLoading(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "#06222b";
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.fillStyle = "#bfe6ef";
    ctx.font = "bold 28px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Tiny Siege", WORLD_W / 2, WORLD_H / 2 - 10);
    ctx.font = "16px 'Segoe UI', sans-serif";
    ctx.fillText("Loading…", WORLD_W / 2, WORLD_H / 2 + 24);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.input.destroy();
  }
}

// keep reference so bundlers don't tree-shake the pool (used by HUD for tooltips)
export { BOONS };
export const towerOrder = TOWER_ORDER;
export const enemyColors = ENEMY_COLORS;
export type { EnemyType };
