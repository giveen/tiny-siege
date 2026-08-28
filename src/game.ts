import { loadAssets, type Assets, ENEMY_COLORS, asAsset } from "./assets";
import { World, stageForWave, type BuildSpot } from "./map";
import { Input } from "./input";
import { Audio } from "./audio";
import { RNG } from "./rng";
import { Sprite, drawSprite } from "./sprite";
import { Enemy, type EnemyType } from "./enemy";
import {
  Tower,
  TOWER_DEFS,
  TOWER_ORDER,
  MAX_UPGRADE,
  upgradeCost,
  SPECS,
  SPEC_UNLOCK_COST,
  MAX_SPEC,
  specUpgradeCost,
  type UpgradeTrack,
} from "./tower";
import { Projectile, type SpecMods } from "./projectile";
import { clamp } from "./util";
import { Soldier } from "./soldier";
import { Fx } from "./fx";
import { generateWave, type SpawnEntry } from "./waves";
import { rollBoons, BOONS, type Boon } from "./boons";
import {
  loadMeta,
  saveMeta,
  relicLevel,
  runesForWave,
  VICTORY_RUNES,
  cratesForWave,
  VICTORY_CRATES,
  metaStartGold,
  metaCastleHp,
  metaDamageMult,
  metaGoldMult,
  metaStartTowers,
  metaCostMult,
  metaRangeMult,
  metaRateMult,
  metaVictoryBonus,
  metaCaravanBonus,
  metaWallsReduction,
  metaCastleRegen,
  metaSplashMult,
  metaBoonBonus,
  relicPrereqMet,
  RELICS,
  type MetaState,
} from "./meta";
import {
  loadProgress,
  saveProgress,
  refreshMissions,
  bumpStat,
  achievementProgress,
  isAchievementClaimed,
  missionProgress,
  missionDef,
  canClaimLogin,
  claimLoginReward as claimLoginRewardProgress,
  ACHIEVEMENTS,
  type ProgressState,
} from "./progress";
import { defaultBuffs, type Buffs, type TowerType, type CastleState } from "./types";
import {
  EMPTY_GEAR_BONUS,
  GEAR_BY_ID,
  GEAR_SLOTS,
  gearActiveStats,
  gearTierForWave,
  gearUpgradeCost,
  LOOTBOX_COST,
  makeGearDrop,
  rollLootbox,
  scrapValue,
  TIER_COLORS,
  TIER_MAX,
  type GearBonus,
  type GearInstance,
  type GearSlot,
} from "./gear";
import {
  WORLD_W,
  WORLD_H,
  CANVAS_W,
  CANVAS_H,
  TILE,
  COLS,
  ROWS,
  START_GOLD,
  START_CASTLE_HP,
  SPOT_MOVE_COST,
  WAVE_CLEAR_GOLD,
  KILL_GOLD_BASE,
  SIEGE_WAVE,
  SPEEDS,
  BEST_KEY,
} from "./config";
import { Hud } from "./hud";

export type Screen = "loading" | "menu" | "game" | "over" | "victory";
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
  /** Codex relic multipliers (recomputed per run). */
  metaCostMult = 1; // Quartermaster: build/upgrade cost scale (<1)
  metaRangeMult = 1; // Lookouts: tower range scale (>1)
  metaRateMult = 1; // War Drums: tower fire-rate scale (>1)
  unlocked: Set<TowerType> = new Set(["archer"]);
  private boonCounts: Record<string, number> = {};

  // entities
  towers: Tower[] = [];
  enemies: Enemy[] = [];
  soldiers: Soldier[] = [];
  /** Napalm patches: burning ground that damages grounded enemies standing in it. */
  firePatches: { x: number; y: number; r: number; until: number; dps: number }[] = [];
  projectiles: Projectile[] = [];
  fx: Fx[] = [];
  spawnQueue: SpawnEntry[] = [];
  /** Pre-generated composition of the next wave (telegraphed during build). */
  nextWave: SpawnEntry[] = [];
  private waveTime = 0;
  private castleAuraTimer = 0;

  // interaction
  placing: TowerType | null = null;
  /** Pad awaiting relocation (click a target cell to commit, right-click to cancel). */
  movingSpot: BuildSpot | null = null;
  selectedTower: Tower | null = null;
  _showHelp = false;
  _showCodex = false;
  _showArmory = false;
  _showProgress = false;
  /** World-space cursor (through the camera). */
  mouse = { x: 0, y: 0, over: false };
  /** Canvas-space cursor — the HUD is screen-space, so it clicks here. */
  mouseCanvas = { x: 0, y: 0 };

  /**
   * World viewport camera. x/y are the pan offset in canvas px (the world's
   * top-left in canvas space); zoom is a multiplier (1 = whole island fits).
   * Drag to pan, wheel to zoom in around the cursor; zoom < 1 is not
   * allowed so the viewport never shows past the world's edges.
   */
  cam = { x: 0, y: 0, zoom: 1 };
  static readonly CAM_ZOOM_MIN = 1;
  static readonly CAM_ZOOM_MAX = 3;

  // intermission boons
  boonChoices: Boon[] = [];

  // demo / attract mode (enabled via ?demo or ?start in the URL)
  demo = false;
  autoStart = false;
  /** ?stage=N — start the island already grown to stage N (verification). */
  debugStage = 0;
  /** ?burn[=N] — archer arrows ignite (verification). */
  debugBurn = 0;
  rngSeed: number | null = null;
  private demoBuildTimer = 0;
  private demoBoonTimer = 0;
  private demoBuildCount = 0;

  best = 0;
  meta: MetaState = loadMeta();
  progress: ProgressState = loadProgress();
  /** Sage's Insight level — shifts boon rarity weights (0..3). */
  sageLevel = 0;
  /** True once the run's victory has been claimed (guards rune banking). */
  runWon = false;
  private castleSprite: Sprite;
  private shake = 0;

  private lastTs = 0;
  private raf = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    // Canvas is the world plus black HUD margins (right + bottom); the world
    // itself is drawn at (0,0) and the HUD lives in the margins.
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    this.ctx = canvas.getContext("2d")!;
    this.ctx.imageSmoothingEnabled = false;
    this.input = new Input(canvas);
    this.audio = new Audio();
    this.assets = undefined as unknown as Assets; // set in init
    this.world = undefined as unknown as World;
    this.hud = undefined as unknown as Hud;
    this.castleSprite = undefined as unknown as Sprite;
    // BGM intent from load: calm forest. It actually starts on the first user
    // gesture (audio unlock) so browsers don't block it.
    this.audio.music("forest");

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
    this.audio.setBase("assets/");
    this.rng = new RNG();
    this.world = new World(assets, this.rng);
    this.castle.x = this.world.castlePos.x;
    this.castle.y = this.world.castlePos.y;
    this.castleSprite = new Sprite(asAsset(assets.building("blue", "castle")));
    this.hud = new Hud(assets);
    this.screen = "menu";
    refreshMissions(this.progress, this.rng);

    const params = new URLSearchParams(location.search);
    const seedParam = params.get("seed");
    if (seedParam && !Number.isNaN(parseInt(seedParam, 10))) this.rngSeed = parseInt(seedParam, 10);
    this.autoStart = params.has("start");
    this.demo = params.has("demo");
    // ?stage=N — start the island already grown to stage N (verification)
    const stageParam = parseInt(params.get("stage") ?? "", 10);
    if (!Number.isNaN(stageParam)) this.debugStage = Math.max(0, Math.min(9, stageParam));
    // ?burn[=N] — archer arrows ignite for N dps (verification)
    const burnParam = params.get("burn");
    if (burnParam !== null) this.debugBurn = burnParam === "" ? 8 : Math.max(0, parseFloat(burnParam) || 0);
    if ((this.debugStage > 0 || this.debugBurn > 0) && !this.autoStart && !this.demo) this.startRun();
    const ffSeconds = parseFloat(params.get("ff") ?? "0") || 0;
    if (this.autoStart || this.demo) this.startRun();

    // ?buildall — place one of every tower type (verification / dev tool)
    if (params.has("buildall")) {
      this.startRun();
      this.unlocked = new Set(["archer", "lancer", "cannon", "monastery", "barracks", "wizard"]);
      this.gold = 9999;
      const spots = [...this.world.buildSpots];
      this.rng.shuffle(spots);
      const types: TowerType[] = ["archer", "lancer", "cannon", "monastery", "barracks", "wizard"];
      for (let i = 0; i < 6 && i < spots.length; i++) this.buildTower(types[i], spots[i]);
      for (let i = 0; i < 3; i++) {
        const e = new Enemy(this, "pawn", "red", 3);
        e.pathDist = 320 + i * 130;
        const p = this.world.pointAt(e.pathDist);
        e.x = p.x;
        e.y = p.y;
        this.enemies.push(e);
      }
    }

    // ?specs[=N] — dev tool: give every built tower 3 free upgrade points and
    // specialize each into a different line (cycles per type, offset N) for screenshots.
    const specsParam = params.get("specs");
    if (specsParam !== null && this.towers.length > 0) {
      const off = Math.max(0, parseInt(specsParam ?? "", 10) || 0);
      let k = 0;
      for (const t of this.towers) {
        for (let i = 0; i < 3; i++) {
          const tracks: UpgradeTrack[] = ["damage", "rate", "range"];
          this.upgradeTower(t, tracks[i % 3]);
        }
        const lines = SPECS[t.type];
        this.specializeTower(t, lines[(k + off) % lines.length].id);
        k++;
      }
    }

    // ?show=type1,type2,...  — spawn a lineup of specific enemy types for inspection
    // (runs after ?buildall; reuses an already-started run instead of resetting it)
    const show = params.get("show");
    if (show) {
      if ((this.screen as Screen) !== "game") this.startRun();
      // place a handful of archers so we can see them engage
      const spots = [...this.world.buildSpots];
      this.rng.shuffle(spots);
      let placed = 0;
      for (const s of spots) {
        if (placed >= 3) break;
        if (this.gold >= this.towerCost("archer") && !this.towerAt(s.c, s.r)) {
          this.buildTower("archer", s);
          placed++;
        }
      }
      const types = show.split(",").map((s) => s.trim()).filter(Boolean) as EnemyType[];
      this.wavePhase = "active"; // soldiers must deploy for the lineup to be met
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

    // ?seltower[=N] — select the Nth tower (verifies the upgrade/specialize panel)
    const selParam = params.get("seltower");
    if (selParam !== null && this.towers.length > 0) {
      const n = Math.max(0, parseInt(selParam ?? "", 10) || 0);
      this.selectedTower = this.towers[n % this.towers.length] ?? this.towers[0];
    }

    // ?codex — open the meta Codex on the menu (verification / dev tool)
    if (params.has("codex")) {
      this._showCodex = true;
    }
    // ?armory — open the gear Armory on the menu (verification / dev tool)
    // ?smith — same, but on the Blacksmith tab
    if (params.has("armory") || params.has("smith")) {
      this._showArmory = true;
      if (params.has("smith")) this.hud.armoryTab = "smith";
    }
    // ?progress — open the Achievements/Missions/Rewards screen (verification / dev tool)
    if (params.has("progress")) {
      this._showProgress = true;
    }
    // ?crates=N — seed the Supply Crate balance (verification / dev tool)
    const crateParam = params.get("crates");
    if (crateParam) {
      const n = parseInt(crateParam, 10);
      if (Number.isFinite(n) && n >= 0) this.meta.crates = n;
      saveMeta(this.meta);
    }
    // ?gearseed — bank a handful of random gear so the Armory has content
    if (params.has("gearseed")) {
      for (let i = 0; i < 8; i++) {
        const inst = makeGearDrop(1 + Math.floor(this.rng.next() * 3), this.rng);
        this.meta.gear.owned.push(inst);
      }
      // Demo-equip one piece per empty slot so filled slots are visible.
      for (const inst of this.meta.gear.owned) {
        const def = GEAR_BY_ID.get(inst.def);
        if (!def) continue;
        if (!this.meta.gear.equipped[def.tower]?.[def.slot]) {
          this.equipGear(inst.uid, def.tower, def.slot);
        }
      }
      saveMeta(this.meta);
    }
    // ?victory — jump straight to the victory screen (verification / dev tool)
    if (params.has("victory")) {
      this.startRun();
      this.wave = SIEGE_WAVE;
      this.runWon = true;
      this.screen = "victory";
    }

    // ?waven=N — telegraph a specific wave's composition (verifies the preview)
    const waven = parseInt(params.get("waven") ?? "", 10);
    if (!Number.isNaN(waven) && waven > 0) {
      this.startRun();
      this.wave = waven - 1;
      this.nextWave = generateWave(waven, this.rng);
      this.wavePhase = "build";
      this.screen = "game";
    }

    // ?ff=N — applied last so debug startRun blocks above don't reset the jump.
    // Works with ?demo (drives the attract loop) or any started run.
    if (ffSeconds > 0 && this.screen === "game") this.fastForward(ffSeconds);

    // ?click=x,y — synthesize one canvas click at canvas coordinates after the
    // first paint (verification / dev tool; lets URL flows drive any button).
    const clickParam = params.get("click");
    if (clickParam) {
      const [cx, cy] = clickParam.split(",").map((s) => parseFloat(s));
      if (Number.isFinite(cx) && Number.isFinite(cy)) {
        setTimeout(() => this.debugClick(cx, cy), 700);
      }
    }
  }

  /** Synthesize a pointer click at canvas coordinates (verification / dev tool). */
  private debugClick(cx: number, cy: number): void {
    const r = this.canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const px = r.left + (cx / this.canvas.width) * r.width;
    const py = r.top + (cy / this.canvas.height) * r.height;
    const down = new PointerEvent("pointerdown", { clientX: px, clientY: py, button: 0 });
    const up = new PointerEvent("pointerup", { clientX: px, clientY: py, button: 0 });
    this.canvas.dispatchEvent(down);
    window.dispatchEvent(up);
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
    if (this.debugStage > 0) this.world.growToStage(this.debugStage);
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.castle.x = this.world.castlePos.x;
    this.castle.y = this.world.castlePos.y;
    // Meta-progression: apply purchased relics to this run's starting state.
    this.gold = START_GOLD + metaStartGold(relicLevel(this.meta, "provisions"));
    this.wave = 0;
    this.kills = 0;
    const castleMax = START_CASTLE_HP + metaCastleHp(relicLevel(this.meta, "bastion"));
    this.castle.hp = castleMax;
    this.castle.maxHp = castleMax;
    this.buffs = defaultBuffs();
    if (this.debugBurn > 0) this.buffs.arrowBurnDps = this.debugBurn;
    this.buffs.damageMult = metaDamageMult(relicLevel(this.meta, "armory"));
    this.buffs.goldKillMult = metaGoldMult(relicLevel(this.meta, "mint"));
    this.buffs.goldWaveMult = metaGoldMult(relicLevel(this.meta, "mint"));
    this.buffs.castleDmgReduction = metaWallsReduction(relicLevel(this.meta, "walls"));
    this.buffs.splashMult = metaSplashMult(relicLevel(this.meta, "siege_engineers"));
    this.metaCostMult = metaCostMult(relicLevel(this.meta, "quartermaster"));
    this.metaRangeMult = metaRangeMult(relicLevel(this.meta, "lookouts"));
    this.metaRateMult = metaRateMult(relicLevel(this.meta, "drums"));
    this.archerDamageMult = 1;
    this.archerSpeedMult = 1;
    this.unlocked = new Set(TOWER_ORDER.slice(0, metaStartTowers(relicLevel(this.meta, "recruit"))));
    this.sageLevel = relicLevel(this.meta, "sage");
    this.runWon = false;
    this.boonCounts = {};
    this.towers = [];
    this.enemies = [];
    this.soldiers = [];
    this.firePatches = [];
    this.projectiles = [];
    this.fx = [];
    this.spawnQueue = [];
    this.placing = null;
    this.movingSpot = null;
    this.selectedTower = null;
    this.wavePhase = "build";
    this.paused = false;
    this.speedIdx = 0;
    // Pre-generate the first wave so its composition is telegraphed during build.
    this.nextWave = generateWave(1, this.rng);
    this.screen = "game";
    this.audio.unlock();
    this.audio.music("forest");
    this.sfx("wave");
    bumpStat(this.progress, "runsPlayed");
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

    // soldiers (barracks musters)
    for (const s of this.soldiers) s.update(this, dt);
    this.soldiers = this.soldiers.filter((s) => !s.dead);

    // napalm patches: burn grounded enemies standing in them
    if (this.firePatches.length > 0) {
      for (const f of this.firePatches) {
        for (const e of this.enemies) {
          if (e.dead || e.flying) continue;
          if (Math.hypot(e.x - f.x, e.y - f.y) <= f.r + 6 * e.scale) {
            this.damageEnemy(e, f.dps * dt, "burn");
          }
        }
      }
      this.firePatches = this.firePatches.filter((f) => f.until > this.time);
    }

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

  /** Build cost after the Quartermaster relic. */
  towerCost(type: TowerType): number {
    return Math.max(1, Math.round(TOWER_DEFS[type].cost * this.metaCostMult));
  }

  /** Per-track upgrade cost after the Quartermaster relic. */
  upgradeCostFor(t: Tower, track: UpgradeTrack, lvl: number): number {
    return Math.max(1, Math.round(upgradeCost(t.type, track, lvl) * this.metaCostMult));
  }

  private demoAutoBuild(): boolean {
    const spots = this.world.buildSpots.filter((s) => !this.towerAt(s.c, s.r));
    if (spots.length === 0) return false;
    const types = TOWER_ORDER.filter((t) => this.unlocked.has(t));
    const type = this.rng.pick(types);
    if (this.gold < this.towerCost(type)) return false;
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
    // Use the pre-generated (telegraphed) composition for this wave.
    this.spawnQueue = this.nextWave;
    this.nextWave = [];
    this.waveTime = 0;
    this.wavePhase = "active";
    this.placing = null;
    this.movingSpot = null;
    this.selectedTower = null;
    // Boss waves (every 5th) shift the score to the ominous cave theme.
    this.audio.music(this.wave % 5 === 0 ? "cave" : "forest");
    this.sfx("wave");
  }

  private onWaveCleared(): void {
    const reward = Math.round(WAVE_CLEAR_GOLD(this.wave) * this.buffs.goldWaveMult);
    this.gold += reward;
    bumpStat(this.progress, "goldEarned", reward);
    this.addText(this.castle.x, this.castle.y - 60, `+${reward} gold`, "#ffd24a");
    // Bank meta runes for clearing this wave (a loss or a win, it counts).
    const runes = runesForWave(this.wave);
    this.meta.runes += runes;
    saveMeta(this.meta);
    this.addText(this.castle.x, this.castle.y - 84, `+${runes} ◆`, "#c58bff");
    this.sfx("coin");

    // Supply crates: banked for every cleared wave (a loss or a win, it
    // counts) — spend them in the Armory to open a Supply Crate for a random
    // gear piece.
    const crates = cratesForWave(this.wave);
    this.meta.crates += crates;
    saveMeta(this.meta);
    this.addText(this.castle.x, this.castle.y - 108, `+${crates} crate${crates === 1 ? "" : "s"}`, "#d2a24c");

    // Caravan relic: a bonus gold delivery every 5th wave.
    const caravan = metaCaravanBonus(relicLevel(this.meta, "caravan"));
    if (caravan > 0 && this.wave % 5 === 0) {
      this.gold += caravan;
      bumpStat(this.progress, "goldEarned", caravan);
      this.addText(this.castle.x, this.castle.y - 132, `+${caravan} caravan gold`, "#ffd24a");
    }
    // Menders relic: patch the castle up after every wave.
    const mend = metaCastleRegen(relicLevel(this.meta, "menders"));
    if (mend > 0) this.healCastle(mend);

    bumpStat(this.progress, "wavesCleared");

    // The island grows every 5 waves: new land, a longer enemy route, and a
    // few more build pads — the map itself is the meta-progression.
    const nextStage = stageForWave(this.wave + 1);
    if (nextStage > this.world.stage) {
      this.world.growToStage(nextStage);
      this.addText(this.castle.x, this.castle.y - 156, "The island grows!", "#9ff0ff");
      this.sfx("castle");
    }

    // Climax: clearing the Siege wave wins the run.
    if (this.wave === SIEGE_WAVE) {
      this.onVictory();
      return;
    }
    const boonBonus = metaBoonBonus(relicLevel(this.meta, "vanguard_scouts"));
    this.boonChoices = rollBoons(this, this.rng, 3 + boonBonus);
    this.wavePhase = "boon";
  }

  private onVictory(): void {
    this.runWon = true;
    const victoryBonus = metaVictoryBonus(relicLevel(this.meta, "treasury"));
    this.meta.runes += VICTORY_RUNES + victoryBonus;
    this.meta.crates += VICTORY_CRATES + victoryBonus;
    saveMeta(this.meta);
    bumpStat(this.progress, "sieges");
    // Victory bonus: a guaranteed top-tier piece from the Siege.
    this.bankGearDrop(makeGearDrop(gearTierForWave(SIEGE_WAVE), this.rng));
    this.screen = "victory";
    this.audio.music("forest"); // the calm after the siege
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

  /** From the victory screen: keep defending past the Siege (endless). */
  continueEndless(): void {
    this.wavePhase = "build";
    this.nextWave = generateWave(this.wave + 1, this.rng);
    this.screen = "game";
    this.sfx("wave");
  }

  applyBoon(boon: Boon): void {
    boon.apply(this);
    this.boonCounts[boon.id] = (this.boonCounts[boon.id] ?? 0) + 1;
    this.boonChoices = [];
    this.wavePhase = "build";
    // Telegraph the following wave while the player plans.
    this.nextWave = generateWave(this.wave + 1, this.rng);
    this.sfx("boon");
    bumpStat(this.progress, "boonsChosen");
  }

  countBoon(id: string): number {
    return this.boonCounts[id] ?? 0;
  }

  // ------------------------------------------------------------- meta
  /** Spend runes to level up a relic. Returns true if it succeeded. */
  buyRelic(id: string): boolean {
    const relic = RELICS.find((r) => r.id === id);
    if (!relic) return false;
    if (!relicPrereqMet(this.meta, id)) return false;
    const lvl = relicLevel(this.meta, id);
    if (lvl >= relic.maxLevel) return false;
    const cost = relic.cost(lvl);
    if (this.meta.runes < cost) return false;
    this.meta.runes -= cost;
    this.meta.levels[id] = lvl + 1;
    saveMeta(this.meta);
    bumpStat(this.progress, "relicsBought");
    return true;
  }

  // ---------------------------------------------------------------- gear
  /** Aggregated fractional stat bonuses for a tower type from its equipped gear. */
  equipFor(type: TowerType): GearBonus {
    const b: GearBonus = { ...EMPTY_GEAR_BONUS };
    const eq = this.meta.gear.equipped[type] ?? {};
    for (const uid of Object.values(eq)) {
      if (!uid) continue;
      const inst = this.meta.gear.owned.find((o) => o.uid === uid);
      if (!inst) continue;
      const def = GEAR_BY_ID.get(inst.def);
      if (!def) continue;
      for (const roll of gearActiveStats(def, inst.tier)) {
        b[roll.stat] += (roll.base * inst.tier) / 100;
      }
    }
    return b;
  }

  /** The instance equipped in a (tower, slot), if any. */
  equippedFor(type: TowerType, slot: GearSlot): GearInstance | null {
    const uid = this.meta.gear.equipped[type]?.[slot];
    return uid ? this.meta.gear.owned.find((o) => o.uid === uid) ?? null : null;
  }

  /** Equip an owned piece into a slot (replaces whatever was there). */
  equipGear(uid: string, type: TowerType, slot: GearSlot): void {
    const inst = this.meta.gear.owned.find((o) => o.uid === uid);
    if (!inst) return;
    const def = GEAR_BY_ID.get(inst.def);
    if (!def || def.tower !== type || def.slot !== slot) return;
    this.meta.gear.equipped[type] = { ...(this.meta.gear.equipped[type] ?? {}), [slot]: uid };
    saveMeta(this.meta);
    bumpStat(this.progress, "gearEquipped");
  }

  /** Remove a slot's equipped piece (it returns to the vault). */
  unequipGear(type: TowerType, slot: GearSlot): void {
    const cur = this.meta.gear.equipped[type];
    if (!cur || !cur[slot]) return;
    this.meta.gear.equipped[type] = { ...cur, [slot]: undefined };
    saveMeta(this.meta);
  }

  /** Is this piece equipped in any slot? */
  isEquipped(inst: GearInstance): boolean {
    const eq = this.meta.gear.equipped;
    for (const t of TOWER_ORDER) for (const s of GEAR_SLOTS) if (eq[t]?.[s] === inst.uid) return true;
    return false;
  }

  /** Recycle an unequipped vault piece into scrap. Returns scrap gained. */
  recycleGear(uid: string): number {
    const i = this.meta.gear.owned.findIndex((o) => o.uid === uid);
    if (i < 0 || this.isEquipped(this.meta.gear.owned[i])) return 0;
    const value = scrapValue(this.meta.gear.owned[i]);
    this.meta.gear.owned.splice(i, 1);
    this.meta.scrap += value;
    saveMeta(this.meta);
    bumpStat(this.progress, "gearRecycled");
    return value;
  }

  /** Raise an owned piece one tier, paying scrap. Works equipped or banked. */
  upgradeGear(uid: string): boolean {
    const inst = this.meta.gear.owned.find((o) => o.uid === uid);
    if (!inst || inst.tier >= TIER_MAX) return false;
    const cost = gearUpgradeCost(inst);
    if (this.meta.scrap < cost) return false;
    this.meta.scrap -= cost;
    inst.tier++;
    saveMeta(this.meta);
    return true;
  }

  /** Spend crates to open a Supply Crate. Returns the rolled piece, or null
   *  when the player can't afford it. The piece is banked to the vault. */
  buyLootbox(): GearInstance | null {
    if (this.meta.crates < LOOTBOX_COST) return null;
    this.meta.crates -= LOOTBOX_COST;
    const inst = rollLootbox(this.rng);
    this.meta.gear.owned.push(inst);
    saveMeta(this.meta);
    bumpStat(this.progress, "cratesOpened");
    return inst;
  }

  // -------------------------------------------------------------- progress
  /** Grant a Reward's currencies into MetaState and persist. */
  private grantReward(reward: { runes?: number; crates?: number; scrap?: number }): void {
    if (reward.runes) this.meta.runes += reward.runes;
    if (reward.crates) this.meta.crates += reward.crates;
    if (reward.scrap) this.meta.scrap += reward.scrap;
    saveMeta(this.meta);
  }

  /** Claim a completed achievement's reward. Returns true if it succeeded. */
  claimAchievement(id: string): boolean {
    const def = ACHIEVEMENTS.find((a) => a.id === id);
    if (!def || isAchievementClaimed(this.progress, id)) return false;
    if (achievementProgress(this.progress, def) < def.target) return false;
    this.grantReward(def.reward);
    this.progress.claimedAchievements.push(id);
    saveProgress(this.progress);
    this.sfx("coin");
    return true;
  }

  /** Claim a daily/weekly/bounty mission's reward. Bounties immediately
   *  re-arm (re-snapshot) so they can be completed again. */
  claimMission(kind: "daily" | "weekly" | "bounty", defId: string): boolean {
    const list = kind === "daily" ? this.progress.daily.missions : kind === "weekly" ? this.progress.weekly.missions : this.progress.bounty;
    const inst = list.find((m) => m.defId === defId);
    const def = missionDef(defId);
    if (!inst || !def || inst.claimed) return false;
    if (missionProgress(this.progress, def, inst) < def.amount) return false;
    this.grantReward(def.reward);
    if (kind === "bounty") {
      inst.base = this.progress.stats[def.statKey] ?? 0; // re-arm, infinitely repeatable
    } else {
      inst.claimed = true;
    }
    saveProgress(this.progress);
    this.sfx("coin");
    return true;
  }

  /** Claim today's login reward, advancing (or resetting) the streak. */
  claimLoginReward(): boolean {
    if (!canClaimLogin(this.progress)) return false;
    const reward = claimLoginRewardProgress(this.progress);
    this.grantReward(reward);
    this.sfx("coin");
    return true;
  }

  /** Bank a piece into the vault (the victory bonus still uses this). */
  private bankGearDrop(inst: GearInstance, yOff = -108): void {
    this.meta.gear.owned.push(inst);
    saveMeta(this.meta);
    const def = GEAR_BY_ID.get(inst.def);
    if (def) {
      this.addText(
        this.castle.x,
        this.castle.y + yOff,
        `${def.name} T${inst.tier} → ${TOWER_DEFS[def.tower].name}`,
        TIER_COLORS[inst.tier]
      );
    }
    this.sfx("boon");
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
  damageEnemy(e: Enemy, amount: number, kind: "physical" | "burn" | "magic", armorIgnore = 0): void {
    if (e.dead) return;
    e.takeDamage(this, amount, kind, armorIgnore);
    if (kind === "burn") {
      // DoT ticks accumulate; Enemy.update shows the burn total every 0.5s.
      e.dotAccum += amount;
      return;
    }
    const col = kind === "magic" ? "#c58bff" : "#ffffff";
    this.addText(e.x + (this.rng.next() - 0.5) * 16, e.y - 24, String(Math.round(amount)), col);
  }

  killEnemy(e: Enemy): void {
    if (e.dead && this.killsCounted(e)) return;
    this.markKilled(e);
    this.kills++;
    bumpStat(this.progress, "kills");
    if (e.def.type === "boss") bumpStat(this.progress, "bossKills");
    const reward = Math.round((KILL_GOLD_BASE + e.reward) * this.buffs.goldKillMult) + this.buffs.killGoldFlat;
    this.gold += reward;
    bumpStat(this.progress, "goldEarned", reward);
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

  /** Blessed Ward: heal the castle; returns the HP actually restored. */
  healCastle(amount: number): number {
    if (amount <= 0 || this.castle.hp >= this.castle.maxHp) return 0;
    const healed = Math.min(amount, this.castle.maxHp - this.castle.hp);
    this.castle.hp += healed;
    this.sfx("coin");
    return healed;
  }

  /** Napalm: a burning ground patch (grounded enemies only). */
  addFirePatch(x: number, y: number, r: number, dur: number, dps: number): void {
    this.firePatches.push({ x, y, r, until: this.time + dur, dps });
  }

  // ---------------------------------------------------------------- building
  buildTower(type: TowerType, spot: { c: number; r: number; x: number; y: number }): boolean {
    const cost = this.towerCost(type);
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
    bumpStat(this.progress, "towersBuilt");
    return true;
  }

  upgradeTower(t: Tower, track: UpgradeTrack): void {
    if (t.upg[track] >= MAX_UPGRADE) return;
    const cost = this.upgradeCostFor(t, track, t.upg[track]);
    if (this.gold < cost) {
      this.addText(t.x, t.y - 30, "Need gold", "#ff9a3c");
      return;
    }
    this.gold -= cost;
    t.totalInvested += cost;
    t.upg[track]++;
    this.spawnRingFx(t.x, t.y - 16, "#ffd24a", 0.9);
    this.sfx("upgrade");
    bumpStat(this.progress, "towerUpgrades");
  }

  /** Pick a tower's specialization line (once, after SPEC_UNLOCK_AT upgrade points). */
  specializeTower(t: Tower, specId: string): void {
    if (!t.specReady) return;
    if (!SPECS[t.type].some((s) => s.id === specId)) return;
    if (this.gold < SPEC_UNLOCK_COST) {
      this.addText(t.x, t.y - 30, "Need gold", "#ff9a3c");
      return;
    }
    this.gold -= SPEC_UNLOCK_COST;
    t.totalInvested += SPEC_UNLOCK_COST;
    t.spec = specId;
    t.specLvl = 1;
    const sd = t.specDef();
    this.spawnRingFx(t.x, t.y - 16, sd?.color ?? "#ffd24a", 1.2);
    this.addText(t.x, t.y - 40, sd?.name ?? "Specialized", sd?.color ?? "#ffd24a");
    this.sfx("upgrade");
  }

  /** Upgrade an already-chosen specialization line. */
  upgradeSpec(t: Tower): void {
    if (!t.spec || t.specLvl >= MAX_SPEC) return;
    const cost = Math.max(1, Math.round(specUpgradeCost(t.type, t.specLvl) * this.metaCostMult));
    if (this.gold < cost) {
      this.addText(t.x, t.y - 30, "Need gold", "#ff9a3c");
      return;
    }
    this.gold -= cost;
    t.totalInvested += cost;
    t.specLvl++;
    const sd = t.specDef();
    this.spawnRingFx(t.x, t.y - 16, sd?.color ?? "#ffd24a", 0.9);
    this.sfx("upgrade");
    bumpStat(this.progress, "towerUpgrades");
  }

  /** Barracks musters a soldier (stats come from the barracks' upgrades/specs). */
  spawnSoldier(t: Tower): void {
    const ss = t.soldierStats(this);
    new Soldier(this, t, { hp: ss.hp, dmg: ss.dmg, armor: ss.armor, patrol: ss.patrol });
    this.spawnRingFx(t.x, t.y - 12, "#9fd8ff", 0.7);
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
  spawnArrow(x: number, y: number, target: Enemy, damage: number, speed: number, mods: SpecMods = {}): void {
    const a = Math.atan2(target.y - y, target.x - x);
    this.projectiles.push(new Projectile("arrow", x, y, a, speed, damage, { target, mods }));
  }
  spawnSpear(x: number, y: number, angle: number, damage: number, speed: number, pierce: number, mods: SpecMods = {}): void {
    this.projectiles.push(new Projectile("spear", x, y, angle, speed, damage, { pierce, mods }));
  }
  spawnCannonball(
    x: number,
    y: number,
    tx: number,
    ty: number,
    damage: number,
    splash: number,
    speed: number,
    mods: SpecMods = {}
  ): void {
    const a = Math.atan2(ty - y, tx - x);
    this.projectiles.push(new Projectile("cannonball", x, y, a, speed, damage, { tx, ty, splash, mods }));
  }
  /**
   * Wizard Tower bolt: an animated projectile whose sprite sheet follows the
   * tower's evolution level — 1 fireball, 2 ice shard, 3 star.
   */
  spawnWizardBolt(x: number, y: number, target: Enemy, damage: number, speed: number, level: number, mods: SpecMods = {}): void {
    const a = Math.atan2(target.y - y, target.x - x);
    const [fxKey, impactKey, scale]: [string, string, number] =
      level === 2
        ? ["wizard_ice", "wizard_ice_impact", 1.1]
        : level >= 3
          ? ["wizard_star", "wizard_star_impact", 0.85]
          : ["wizard_fire", "wizard_fire_impact", 0.9];
    this.projectiles.push(new Projectile("bolt", x, y, a, speed, damage, { target, mods, fxKey, impactKey, scale }));
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
  /** One-shot animated impact burst (wizard bolt impact sheets). */
  spawnWizardImpactFx(key: string, x: number, y: number): void {
    const def = this.assets.manifest.fx[key];
    if (!def) return;
    const f = this.mkFx("fire", x, y, 0.5, 0.55);
    f.attach(def, def.fps ?? 48);
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
    // Camera input is consumed on every screen so a wheel/drag queued during
    // a screen transition never fires on the next one.
    const wheel = this.input.consumeWheel();
    const pan = this.input.consumePan();
    if (this.screen === "game") {
      if (pan.x !== 0 || pan.y !== 0) {
        this.cam.x += pan.x;
        this.cam.y += pan.y;
        this.clampCam();
      }
      if (wheel !== 0) this.zoomAt(this.input.world.x, this.input.world.y, wheel);
    }
    const z = this.screen === "game" ? this.cam.zoom : 1;
    const ox = this.screen === "game" ? this.cam.x : 0;
    const oy = this.screen === "game" ? this.cam.y : 0;
    this.mouseCanvas.x = this.input.world.x;
    this.mouseCanvas.y = this.input.world.y;
    this.mouse.x = (this.input.world.x - ox) / z;
    this.mouse.y = (this.input.world.y - oy) / z;
    this.mouse.over =
      this.mouse.x >= 0 &&
      this.mouse.x <= WORLD_W &&
      this.mouse.y >= this.world.minRow * TILE &&
      this.mouse.y <= WORLD_H;

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
      Digit5: "barracks",
      Digit6: "wizard",
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

    // Right-click cancels the current action. Its own gate — the left-click
    // gate below would return early and swallow a lone right press.
    if (this.input.consumeRightClick()) {
      this.audio.unlock();
      this.cancelAction();
      return;
    }

    const clicked = this.input.consumeClick();
    if (!clicked) return;
    // Any click is a user gesture: safe to unlock (resume) the AudioContext.
    this.audio.unlock();

    // The HUD lives in screen space (unaffected by the camera), so it is
    // hit-tested with the raw canvas cursor.
    if (this.screen === "menu") {
      this.hud.handleMenuClick(this, this.mouseCanvas);
      return;
    }
    if (this.screen === "over") {
      this.hud.handleOverClick(this, this.mouseCanvas);
      return;
    }
    if (this.screen === "victory") {
      this.hud.handleVictoryClick(this, this.mouseCanvas);
      return;
    }

    // game screen: HUD first
    if (this.hud.handleClick(this, this.mouseCanvas)) return;

    if (this.wavePhase === "boon") {
      // handled by HUD (modal covers)
      return;
    }

    // placing / selecting (only within the world, not the HUD margins)
    if (this.paused) return;
    if (this.mouse.over) this.worldInteract(this.mouse.x, this.mouse.y);
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
        if (this.gold < this.towerCost(this.placing)) this.placing = null;
      }
      return;
    }
    if (this.movingSpot) {
      // A valid click commits; an invalid target keeps the mode alive
      // (right-click / Esc cancels, same as tower placing).
      const cell = this.cellAtWorld(x, y);
      const isOrigin = !!cell && cell.c === this.movingSpot.c && cell.r === this.movingSpot.r;
      if (cell && !isOrigin && this.world.canRelocateTo(cell.c, cell.r)) {
        if (this.gold >= SPOT_MOVE_COST) {
          this.gold -= SPOT_MOVE_COST;
          this.world.moveSpot(this.movingSpot, cell.c, cell.r);
          this.addText(this.movingSpot.x, this.movingSpot.y - 30, `-${SPOT_MOVE_COST}`, "#ffd24a");
          this.spawnRingFx(this.movingSpot.x, this.movingSpot.y, "#ffd24a", 0.8);
          this.sfx("build");
        } else {
          this.addText(x, y - 30, `Need ${SPOT_MOVE_COST}g`, "#e07a5a");
        }
        this.movingSpot = null;
      }
      return;
    }
    const t = this.towerAtWorld(x, y);
    if (t) {
      this.selectedTower = t;
      this.sfx("click");
    } else {
      // Empty pad: click it to start relocating (if the gold is there).
      const spot = this.spotAtWorld(x, y);
      if (spot && !this.towerAt(spot.c, spot.r)) {
        if (this.gold >= SPOT_MOVE_COST) {
          this.movingSpot = spot;
          this.selectedTower = null;
          this.sfx("click");
        } else {
          this.addText(x, y - 30, `Need ${SPOT_MOVE_COST}g to move a pad`, "#e07a5a");
        }
      } else {
        this.selectedTower = null;
      }
    }
  }

  /** The map cell under a world position (null outside the grid). */
  private cellAtWorld(x: number, y: number): { c: number; r: number } | null {
    const c = Math.floor(x / TILE);
    const r = Math.floor(y / TILE);
    if (c < 0 || r < this.world.minRow || c >= COLS || r >= ROWS) return null;
    return { c, r };
  }

  cancelAction(): void {
    this.placing = null;
    this.movingSpot = null;
    this.selectedTower = null;
  }

  /** Wheel zoom centered on the cursor (cx/cy in canvas px). */
  private zoomAt(cx: number, cy: number, deltaY: number): void {
    const z0 = this.cam.zoom;
    const z1 = clamp(z0 * Math.exp(-deltaY * 0.0012), Game.CAM_ZOOM_MIN, Game.CAM_ZOOM_MAX);
    if (z1 === z0) return;
    // Keep the world point under the cursor fixed while zooming.
    this.cam.x = cx - ((cx - this.cam.x) / z0) * z1;
    this.cam.y = cy - ((cy - this.cam.y) / z0) * z1;
    this.cam.zoom = z1;
    this.clampCam();
  }

  /** The zoomed world must always cover the viewport (no water gaps). */
  private clampCam(): void {
    const z = this.cam.zoom;
    // The island only ever grows upward (taller), never wider, so the top
    // bound (unlike the original fixed-at-0 top) tracks how far above y=0
    // the world currently extends — that's what makes dragging able to
    // reveal newly grown land above the default (bottom/castle) view.
    const top = this.world.minRow * TILE;
    this.cam.x = clamp(this.cam.x, WORLD_W - WORLD_W * z, 0);
    this.cam.y = clamp(this.cam.y, WORLD_H - WORLD_H * z, -top * z);
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
  /** Abandon the current run and return to the main menu.
   *  Runes already banked for cleared waves are kept (they're saved per wave). */
  toMenu(): void {
    this.screen = "menu";
    this.placing = null;
    this.movingSpot = null;
    this.selectedTower = null;
    this.paused = false;
    this.audio.music("forest");
    this.sfx("click");
    refreshMissions(this.progress, this.rng);
  }
  setPlacing(type: TowerType | null): void {
    this.placing = type;
    this.movingSpot = null;
    this.selectedTower = null;
    if (type) this.sfx("click");
  }
  get audioEnabled() {
    return this.audio.enabled;
  }

  // ---------------------------------------------------------------- render
  render(): void {
    const ctx = this.ctx;
    // Fill the whole canvas (world + black HUD margins) dark. The world is
    // drawn at (0,0) over the top-left, leaving the right/bottom margins black.
    ctx.fillStyle = "#05080b";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

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
    // Clip to the world viewport, then apply the camera (pan + zoom).
    ctx.beginPath();
    ctx.rect(0, 0, WORLD_W, WORLD_H);
    ctx.clip();
    if (this.cam.zoom !== 1 || this.cam.x !== 0 || this.cam.y !== 0) {
      ctx.translate(this.cam.x, this.cam.y);
      ctx.scale(this.cam.zoom, this.cam.zoom);
    }
    if (this.shake > 0) {
      const s = this.shake * 6;
      ctx.translate((this.rng.next() - 0.5) * s, (this.rng.next() - 0.5) * s);
    }
    ctx.drawImage(this.world.bg, 0, this.world.minRow * TILE);

    this.drawBuildSpots(ctx);
    this.drawCastle(ctx);

    // napalm patches (on the ground, under the entities)
    if (this.firePatches.length > 0) {
      for (const f of this.firePatches) {
        const a = Math.min(1, (f.until - this.time) / 0.5) * 0.55;
        ctx.save();
        const g = ctx.createRadialGradient(f.x, f.y, 2, f.x, f.y, f.r);
        g.addColorStop(0, `rgba(255,170,60,${a})`);
        g.addColorStop(0.7, `rgba(230,90,30,${a * 0.5})`);
        g.addColorStop(1, "rgba(160,50,20,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // depth-sorted entities
    const items: { y: number; d: () => void }[] = [];
    for (const t of this.towers) items.push({ y: t.y, d: () => t.draw(ctx, this) });
    for (const e of this.enemies) items.push({ y: e.y, d: () => e.draw(ctx, this) });
    for (const s of this.soldiers) items.push({ y: s.y, d: () => s.draw(ctx, this) });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.d();

    for (const p of this.projectiles) p.draw(ctx, this);
    for (const f of this.fx) f.draw(ctx, this.assets);

    // placement preview
    this.drawPlacementPreview(ctx);

    // pad relocation preview
    this.drawMovingPreview(ctx);

    // range ring for the selected tower
    if (this.selectedTower) this.drawSelectedRange(ctx);

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
    const valid = !!s && !this.towerAt(s.c, s.r) && this.gold >= this.towerCost(this.placing);
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
    if (def.animated) {
      const a = this.assets.animatedBuilding(def.animated);
      drawSprite(ctx, this.assets, a, 0, x, y + 6, { scale: 0.9, alpha: 0.7 });
    } else {
      const b = asAsset(this.assets.building("blue", def.building));
      drawSprite(ctx, this.assets, b, 0, x, y + 6, { scale: 0.32, alpha: 0.7 });
    }
    ctx.restore();
  }

  private drawMovingPreview(ctx: CanvasRenderingContext2D): void {
    if (!this.movingSpot || !this.mouse.over) return;
    const pad = TILE * 0.82;

    // origin pad: dashed gold outline marking the pad being moved
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = "#ffd24a";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(this.movingSpot.x - pad / 2, this.movingSpot.y - pad / 2, pad, pad, 9);
    ctx.stroke();
    ctx.restore();

    // ghost pad on the hovered cell
    const cell = this.cellAtWorld(this.mouse.x, this.mouse.y);
    const isOrigin = !!cell && cell.c === this.movingSpot.c && cell.r === this.movingSpot.r;
    const valid =
      !!cell &&
      !isOrigin &&
      this.world.canRelocateTo(cell.c, cell.r) &&
      this.gold >= SPOT_MOVE_COST;
    const gx = cell ? cell.c * TILE + TILE / 2 : this.mouse.x;
    const gy = cell ? cell.r * TILE + TILE / 2 : this.mouse.y;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(gx - pad / 2, gy - pad / 2, pad, pad, 9);
    ctx.fillStyle = valid ? "rgba(127,224,127,0.30)" : "rgba(224,85,85,0.28)";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = valid ? "#7fe07f" : "#e05555";
    ctx.stroke();
    ctx.restore();

    // cost + cancel hint above the ghost
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "700 15px 'Segoe UI', sans-serif";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.65)";
    const label = valid ? `Move pad · ${SPOT_MOVE_COST}g` : "Move pad";
    ctx.strokeText(label, gx, gy - pad / 2 - 20);
    ctx.fillStyle = valid ? "#d8f5d8" : "#e8b8b8";
    ctx.fillText(label, gx, gy - pad / 2 - 20);
    ctx.font = "600 12px 'Segoe UI', sans-serif";
    ctx.strokeText("click a grass cell · right-click to cancel", gx, gy - pad / 2 - 5);
    ctx.fillStyle = "rgba(230,240,245,0.9)";
    ctx.fillText("click a grass cell · right-click to cancel", gx, gy - pad / 2 - 5);
    ctx.restore();
  }

  private drawSelectedRange(ctx: CanvasRenderingContext2D): void {
    const t = this.selectedTower;
    if (!t) return;
    const s = t.stats(this);
    ctx.save();
    ctx.globalAlpha = 0.13;
    ctx.fillStyle = "#8fd0ff";
    ctx.beginPath();
    ctx.arc(t.x, t.y - 10, s.range, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = "#8fd0ff";
    ctx.lineWidth = 2;
    ctx.stroke();
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
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
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
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = "#bfe6ef";
    ctx.font = "bold 28px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Tiny Siege", CANVAS_W / 2, CANVAS_H / 2 - 10);
    ctx.font = "16px 'Segoe UI', sans-serif";
    ctx.fillText("Loading…", CANVAS_W / 2, CANVAS_H / 2 + 24);
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
