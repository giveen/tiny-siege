import { loadAssets, type Assets, asAsset } from "./assets";
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
  tracksFor,
  SPECS,
  SPEC_UNLOCK_COST,
  SPEC_UNLOCK_AT,
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
  tickResearch,
  type MetaState,
} from "./meta";
import {
  loadProgress,
  saveProgress,
  refreshMissions,
  bumpStat,
  setStatMax,
  achievementProgress,
  isAchievementClaimed,
  missionProgress,
  missionDef,
  canClaimLogin,
  claimLoginReward as claimLoginRewardProgress,
  ACHIEVEMENTS,
  type ProgressState,
} from "./progress";
import { flushPersist } from "./persist";
import {
  uiAnnounce,
  showEndScreen,
  hideEndScreen,
  showSeedChip,
  hideSeedChip,
  showLandingHero,
  hideLandingHero,
  resyncMenuFocus,
  type EndScreenData,
} from "./ui-dom";
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
  CASTLE_REGEN_PCT,
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

  // loading screen state
  /** "boot" = before manifest.json (pure vector art); "assets" = manifest in hand. */
  private loadPhase: "boot" | "assets" = "boot";
  private loadProgress = 0; // 0..1, meaningful once loadPhase === "assets"
  /** Early reference to the partially-populated Assets (set by the manifest hook). */
  private bootAssets: Assets | null = null;
  /** 1 → 0 fade used when arriving on the menu (loading / toMenu). */
  private screenFade = 0;
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
  firePatches: { x: number; y: number; r: number; until: number; dps: number; kind: "fire" | "poison" }[] = [];
  /** Drifting clouds over the map — purely atmospheric, no gameplay effect. */
  private clouds: { img: number; x: number; y: number; vx: number; scale: number; alpha: number }[] = [];
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

  /** Tilt-shift: below this zoom the diorama pass is skipped (crisp at 1×). */
  static readonly TILT_ZOOM_ON = 1.04;
  /** Tilt-shift: max depth-of-field blur (canvas px) at CAM_ZOOM_MAX. */
  static readonly TILT_BLUR_PX = 7;
  /** Offscreen tilt-shift buffers (scene + masked blur), created lazily. */
  private tilt: { scene: HTMLCanvasElement; blur: HTMLCanvasElement } | null = null;

  // intermission boons
  boonChoices: Boon[] = [];

  // demo / attract mode (enabled via ?demo or ?start in the URL)
  demo = false;
  autoStart = false;
  /** Landing-page mode (?landing, kept in production): the attract loop
   *  plays behind a visible title + Play hero until the player takes over. */
  landing = false;
  /** ?stage=N — start the island already grown to stage N (verification). */
  debugStage = 0;
  /** ?burn[=N] — archer arrows ignite (verification). */
  debugBurn = 0;
  rngSeed: number | null = null;
  /** Seed actually driving the current run (set in startRun); null before the first run. */
  runSeed: number | null = null;
  private demoBuildTimer = 0;
  private demoBoonTimer = 0;
  private demoPhaseSteps = 0;
  /** Attract-mode loop: seconds until a finished demo run restarts. */
  private demoOverTimer = 4;
  /** World stage the demo bot last saw — gates pad relocation after growth. */
  private demoLastStage = 0;

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
    const assets = await loadAssets("assets/", {
      onManifest: (a) => {
        this.loadPhase = "assets";
        this.bootAssets = a;
      },
      onProgress: (done, total) => {
        this.loadProgress = total > 0 ? done / total : 0;
      },
    });
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
    this.screenFade = 1; // fade in from the loading backdrop

    const params = new URLSearchParams(location.search);
    // Product URL params (kept in production): ?seed=N makes a run
    // reproducible for bug reports; ?demo plays the attract-mode bot
    // (the landing-page showcase). Everything else is a development tool
    // (verification jumps, free gold/crates/gear, synthesized clicks) and
    // is ignored by the production bundle.
    const seedParam = params.get("seed");
    if (seedParam && !Number.isNaN(parseInt(seedParam, 10))) this.rngSeed = parseInt(seedParam, 10);
    this.demo = params.has("demo");
    // ?landing — landing-page mode: the attract loop plays behind a visible
    // title + Play hero (a product param like ?demo; kept in production).
    if (params.has("landing")) {
      this.landing = true;
      this.demo = true;
    }
    // `import.meta.env` is undefined in the headless sim's plain-rolldown
    // bundle (no Vite define), so optional-chain through it.
    const dev = import.meta.env?.DEV ?? false;
    let ffSeconds = 0; // ?ff=N fast-forward target (dev only)
    if (dev) {
      this.autoStart = params.has("start");
      // ?stage=N — start the island already grown to stage N (verification)
      const stageParam = parseInt(params.get("stage") ?? "", 10);
      if (!Number.isNaN(stageParam)) this.debugStage = Math.max(0, Math.min(9, stageParam));
      // ?burn[=N] — archer arrows ignite for N dps (verification)
      const burnParam = params.get("burn");
      if (burnParam !== null) this.debugBurn = burnParam === "" ? 8 : Math.max(0, parseFloat(burnParam) || 0);
      if ((this.debugStage > 0 || this.debugBurn > 0) && !this.autoStart && !this.demo) this.startRun();
      ffSeconds = parseFloat(params.get("ff") ?? "0") || 0;
    }
    if (this.autoStart || this.demo) this.startRun();

    if (dev) {
      // ?buildall — place one of every tower type (verification / dev tool)
      if (params.has("buildall")) {
        this.startRun();
        this.unlocked = new Set(TOWER_ORDER);
        this.gold = 9999;
        const spots = [...this.world.buildSpots];
        this.rng.shuffle(spots);
        const types: TowerType[] = [...TOWER_ORDER];
        for (let i = 0; i < types.length && i < spots.length; i++) this.buildTower(types[i], spots[i]);
        for (let i = 0; i < 3; i++) {
          const e = new Enemy(this, "rat", 3);
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
          const e = new Enemy(this, t, 6);
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

    if (this.landing) showLandingHero();
  }

  // ------------------------------------------------- menu keyboard (Phase 2)

  /** Which menu sub-panel is open (null = top-level menu). */
  menuPanelOpen(): "help" | "codex" | "armory" | "progress" | null {
    if (this._showHelp) return "help";
    if (this._showCodex) return "codex";
    if (this._showArmory) return "armory";
    if (this._showProgress) return "progress";
    return null;
  }

  /** Open a menu sub-panel from the DOM layer (mirrors the canvas buttons). */
  menuOpenPanel(id: "help" | "codex" | "armory" | "progress"): void {
    if (this.screen !== "menu") return;
    // Mirrors the canvas routing: while a sub-panel is open, the top-level
    // menu buttons are not reachable, so ignore further open requests.
    if (this.menuPanelOpen() !== null) return;
    this.hud.menuFocus = null;
    this.hud.openPanel(this, id);
    this.sfx("click");
    const titles = {
      help: "How to Play",
      codex: "The Codex",
      armory: "The Armory",
      progress: "Achievements and Missions",
    } as const;
    uiAnnounce(`${titles[id]} opened. Arrows page, PageUp/PageDown switch tabs, Escape closes.`);
  }

  /** Close the open menu sub-panel (Escape / DOM). Resyncs the focus ring. */
  closeMenuPanel(): void {
    if (this.screen !== "menu" || this.menuPanelOpen() === null) return;
    this.hud.closePanel(this);
    this.sfx("click");
    resyncMenuFocus();
    uiAnnounce("Back to the menu.");
  }

  /** Focus-ring mirror from the DOM menu buttons (set by the a11y layer). */
  setMenuFocus(id: string | null): void {
    const ok =
      this.screen === "menu" && !this.landing && this.menuPanelOpen() === null;
    this.hud.menuFocus =
      ok && (id === "start" || id === "help" || id === "codex" || id === "armory" || id === "progress") ? id : null;
  }

  /** Landing hero "Play": dismiss the hero and start a fresh human run. */
  landingPlay(): void {
    if (!this.landing) return;
    this.landing = false;
    hideLandingHero();
    this.demo = false;
    this.startRun();
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

    // Real-time research finishes on the wall clock, even while playing.
    tickResearch(this.meta, Date.now());

    this.handleInput();

    if (this.screen === "game" && !this.paused) {
      const sdt = dt * this.speed;
      this.simTime(sdt);
      this.update(sdt);
    } else {
      // still tick light animations (menu / paused / over)
      this.time += dt;
      this.fxTick(dt, false);
      // Attract mode loops: after a finished demo run, start a fresh one.
      if (this.demo && (this.screen === "over" || this.screen === "victory")) {
        this.demoOverTimer -= dt;
        if (this.demoOverTimer <= 0) {
          this.demoOverTimer = 4;
          this.rngSeed = null; // vary the next attract run
          this.startRun();
        }
      }
    }

    if (this.screenFade > 0) this.screenFade = Math.max(0, this.screenFade - dt * 2.5);

    this.render();
    this.raf = requestAnimationFrame(this.frame);
  };

  // ---------------------------------------------------------------- run
  startRun(): void {
    this.rng = this.rngSeed != null ? new RNG(this.rngSeed) : new RNG();
    // The seed actually driving this run (URL seed or the RNG's random
    // draw) — ?seed=N in a link replays it exactly.
    this.runSeed = this.rng.seed;
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
    this.clouds = Array.from({ length: 10 }, () => this.respawnCloud(this.rng.range(-WORLD_W * 0.2, WORLD_W * 1.2)));
    this.spawnQueue = [];
    this.placing = null;
    this.movingSpot = null;
    this.selectedTower = null;
    this.wavePhase = "build";
    this.paused = false;
    this.speedIdx = 0;
    // Demo bot state must not leak across runs (attract mode restarts).
    this.demoPhaseSteps = 0;
    this.demoBuildTimer = 0;
    this.demoBoonTimer = 0;
    this.demoLastStage = 0;
    // Pre-generate the first wave so its composition is telegraphed during build.
    this.nextWave = generateWave(1, this.rng);
    this.screen = "game";
    uiAnnounce("Run started. Build towers, then start the wave.");
    this.audio.unlock();
    this.audio.music("forest");
    this.sfx("wave");
    bumpStat(this.progress, "runsPlayed");
    hideEndScreen();
    if (!this.demo && this.runSeed != null) showSeedChip(this.runSeed);
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

    // napalm/poison patches: burn (or poison) enemies standing in them.
    // Fire patches only reach the ground; poison clouds drift up and tick fliers too.
    if (this.firePatches.length > 0) {
      for (const f of this.firePatches) {
        for (const e of this.enemies) {
          if (e.dead || (e.flying && f.kind === "fire")) continue;
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
    this.cloudTick(dt);

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

    // demo / attract mode: an in-game bot plays the run (it also drives the
    // headless balance harness, scripts/balance_sim.ts).
    if (this.demo && this.screen === "game") {
      if (this.wavePhase === "build") {
        this.demoBuildTimer -= dt;
        if (this.demoBuildTimer <= 0) {
          this.demoBuildTimer = 0.25;
          const acted = this.demoThink();
          this.demoPhaseSteps = acted ? this.demoPhaseSteps + 1 : 0;
          // Start when nothing left to buy — or after a planning budget, so
          // the intermission can never soft-lock (e.g. no free pads left).
          if (!acted || this.demoPhaseSteps >= 48) this.startWave();
        }
      } else if (this.wavePhase === "boon") {
        this.demoBoonTimer -= dt;
        if (this.demoBoonTimer <= 0 && this.boonChoices.length > 0) {
          this.demoBoonTimer = 0.8;
          this.applyBoon(this.demoPickBoon());
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

  /** One bot decision: the best spend of gold this tick. Expansion first —
   *  a new tower is worth more than an upgrade until the roster is full —
   *  then the strongest upgrades. Keeps a small gold reserve so the wave
   *  that just started can't bankrupt the board. Returns true if it spent. */
  private demoThink(): boolean {
    const reserve = 20;
    const counts = new Map<TowerType, number>();
    for (const t of this.towers) counts.set(t.type, (counts.get(t.type) ?? 0) + 1);
    // 1) Support: a monastery beside the DPS makes every hit cheaper.
    if (
      this.unlocked.has("monastery") &&
      this.gold >= this.towerCost("monastery") + reserve &&
      (counts.get("monastery") ?? 0) < 2 &&
      this.towers.length - (counts.get("monastery") ?? 0) >= 2
    ) {
      const spot = this.demoSpotNear(this.towers.filter((t) => t.type !== "monastery"));
      if (spot) return this.buildTower("monastery", spot);
    }
    // 2) Expand: the best affordable tower type, up to sensible caps.
    //    Front line first — pads nearest the spawn cover the section of the
    //    growing route that towers can least reach from below.
    const caps: Array<[TowerType, number]> = [
      ["archer", 4],
      ["cannon", 3],
      ["lancer", 2],
      ["ballista", 2],
      ["wizard", 2],
      ["alchemist", 2],
      ["barracks", 1],
    ];
    for (const [type, cap] of caps) {
      if (!this.unlocked.has(type)) continue;
      if ((counts.get(type) ?? 0) >= cap) continue;
      if (this.gold < this.towerCost(type) + reserve) continue;
      const spots = this.world.buildSpots
        .filter((s) => !this.towerAt(s.c, s.r))
        .sort((a, b) => b.r - a.r);
      if (spots.length === 0) return false; // no room left — nothing to build
      return this.buildTower(type, spots[0]);
    }
    // 3) When the island grows, drag a spare back-line pad up into the new
    //    front band so fresh towers can cover the new section of the route.
    if (this.demoRelocate(reserve)) return true;
    // 4) Deep runs: specialize and push spec levels (Sunder / Ironbreaker to
    //    L3 is the real answer to armored foes).
    if (this.demoSpecialize(reserve)) return true;
    // 5) Roster fully developed: upgrade the strongest towers — power that
    //    scales the rest of the run.
    const upg = this.demoBestUpgrade();
    if (upg) {
      this.upgradeTower(upg.t, upg.track);
      return true;
    }
    return false;
  }

  /** Specialize ready towers and level key spec lines. True if it spent. */
  private demoSpecialize(reserve: number): boolean {
    const specPick = (t: Tower): string | null => {
      switch (t.type) {
        case "archer":
          return "volley";
        case "lancer":
          return this.wave >= 8 ? "sunder" : "charge";
        case "cannon":
          return "cluster";
        case "monastery":
          return "chant";
        case "barracks":
          return "harden";
        case "wizard":
          return "frost";
        case "alchemist":
          return "virulence";
        case "ballista":
          return "ironbreaker";
      }
    };
    for (const t of this.towers) {
      if (t.spec !== null || t.totalUpgrades < SPEC_UNLOCK_AT) continue;
      const pick = specPick(t);
      if (!pick) continue;
      if (this.gold < SPEC_UNLOCK_COST + reserve) continue;
      this.specializeTower(t, pick);
      return true;
    }
    // Spec lines that matter most get their levels pushed to max: the armor
    // strikers, then crowd control, then anything else specialized.
    const order = (t: Tower): number => {
      if (t.spec === "sunder" || t.spec === "ironbreaker") return 0;
      if (t.spec === "frost" || t.spec === "chant" || t.spec === "harden") return 1;
      return 2;
    };
    for (const t of [...this.towers].filter((t) => t.spec !== null).sort((a, b) => order(a) - order(b))) {
      if (t.specLvl >= MAX_SPEC) continue;
      if (this.gold < specUpgradeCost(t.type, t.specLvl) + reserve) continue;
      this.upgradeSpec(t);
      return true;
    }
    return false;
  }

  /** After the island grows, relocate the back-most empty pad to the first
   *  free grass cell in the new front band. */
  private demoRelocate(reserve: number): boolean {
    if (this.world.stage < 1 || this.world.stage <= this.demoLastStage) return false;
    this.demoLastStage = this.world.stage;
    if (this.towers.length < 5) return false;
    if (this.gold < SPOT_MOVE_COST + reserve) return false;
    const frontRow = this.world.minRow;
    // Victim: the back-most empty pad, a few rows behind the front.
    let victim: BuildSpot | null = null;
    for (const s of [...this.world.buildSpots].sort((a, b) => a.r - b.r)) {
      if (this.towerAt(s.c, s.r)) continue;
      if (s.r - frontRow < 3) continue;
      victim = s;
      break;
    }
    if (!victim) return false;
    for (let r = frontRow; r < frontRow + 8 && r <= victim.r; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!this.world.canRelocateTo(c, r)) continue;
        this.gold -= SPOT_MOVE_COST;
        this.world.moveSpot(victim, c, r);
        this.addText(victim.x, victim.y - 30, `-${SPOT_MOVE_COST}g`, "#ffd24a");
        return true;
      }
    }
    return false;
  }

  /** Best affordable upgrade: damage-first on DPS towers, with a per-level
   *  penalty that spreads investment across the roster instead of maxing
   *  one tower. */
  private demoBestUpgrade(): { t: Tower; track: UpgradeTrack } | null {
    let best: { t: Tower; track: UpgradeTrack; score: number } | null = null;
    for (const t of this.towers) {
      for (const track of tracksFor(t.type)) {
        const lvl = t.upg[track];
        if (lvl >= MAX_UPGRADE) continue;
        if (this.gold < this.upgradeCostFor(t, track, lvl)) continue;
        const w = track === "damage" ? 1 : track === "rate" ? 0.7 : 0.45;
        const support = t.type === "monastery" || t.type === "barracks" ? 0.85 : 1;
        const score = w * support + t.totalUpgrades * 0.06 - lvl * 0.25;
        if (!best || score > best.score) best = { t, track, score };
      }
    }
    if (!best) return null;
    return { t: best.t, track: best.track };
  }

  /** Empty pad closest to the given towers' centroid (for support builds). */
  private demoSpotNear(targets: Tower[]): BuildSpot | null {
    const spots = this.world.buildSpots.filter((s) => !this.towerAt(s.c, s.r));
    if (spots.length === 0) return null;
    if (targets.length === 0) return this.rng.pick(spots);
    const cx = targets.reduce((a, t) => a + t.x, 0) / targets.length;
    const cy = targets.reduce((a, t) => a + t.y, 0) / targets.length;
    let best = spots[0];
    let bd = Infinity;
    for (const s of spots) {
      const d = Math.hypot(s.x - cx, s.y - cy);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  /** State-aware boon choice: roster first, stat boons deep in the run,
   *  heals when the castle is hurt, cursed gold only when comfortably alive. */
  private demoPickBoon(): Boon {
    let best = this.boonChoices[0];
    let bs = this.demoBoonScore(best);
    for (const b of this.boonChoices) {
      const s = this.demoBoonScore(b);
      if (s > bs) {
        bs = s;
        best = b;
      }
    }
    return best;
  }

  private demoBoonScore(b: Boon): number {
    if (b.id.startsWith("unlock_")) return this.wave < 12 ? 10 : 3;
    const hurt = 1 - this.castle.hp / this.castle.maxHp;
    if (b.id === "repair" || b.id === "reinforce") return 1 + hurt * 8;
    if (b.id === "cursed_gold") return hurt < 0.45 ? 2.5 : -10;
    if (b.id === "adrenaline") return 1.5;
    if (["war_chest", "bounty", "mint", "tax"].includes(b.id)) return 2.5;
    // Stat boons (damage / speed / range / special) pay off more as the run deepens.
    return 3 + this.wave * 0.05;
  }

  private fxTick(dt: number, sim: boolean): void {
    for (const f of this.fx) f.update(dt * (sim ? 1 : 1));
    this.fx = this.fx.filter((f) => !f.done);
  }

  /** A fresh drifting cloud entering from `x` — reused both to seed the run
   *  and to recycle one that's drifted off the right edge. Sized so every
   *  cloud reads at roughly the same on-screen scale regardless of which of
   *  the 8 source images (88px to 495px wide) got picked. */
  private respawnCloud(x: number): { img: number; x: number; y: number; vx: number; scale: number; alpha: number } {
    const defs = this.assets.manifest.clouds;
    const img = this.rng.int(0, defs.length - 1);
    const scale = this.rng.range(220, 420) / defs[img].size[0];
    return {
      img,
      x,
      y: this.rng.range(this.world.minRow * TILE, WORLD_H),
      vx: this.rng.range(8, 22),
      scale,
      alpha: this.rng.range(0.4, 0.65),
    };
  }

  private cloudTick(dt: number): void {
    for (const c of this.clouds) {
      c.x += c.vx * dt;
      if (c.x > WORLD_W + 300) Object.assign(c, this.respawnCloud(-300));
    }
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
    uiAnnounce(
      this.wave % 5 === 0
        ? `Wave ${this.wave}. A boss approaches.`
        : `Wave ${this.wave}.`
    );
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
    // Base castle mending (no relic needed): a small rampart repair after
    // every wave so early leaks don't ratchet a fresh run into a death
    // spiral. Stacks under the Menders relic; negligible vs late-wave leaks.
    const baseMend = Math.round(this.castle.maxHp * CASTLE_REGEN_PCT);
    const mended = this.healCastle(baseMend);
    if (mended > 0) this.addText(this.castle.x, this.castle.y - 60, `+${mended} castle`, "#8fd0ff");

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
    uiAnnounce("Wave cleared. Choose a boon.");
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
    flushPersist(); // the victory bank is the run's headline — persist now
    uiAnnounce("Victory! The Siege is broken.");
    hideSeedChip();
    if (!this.demo) this.showEndCard("victory");
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
  /** Spend runes to level up a relic (research relics start a real-time
   *  research instead). Returns true if it succeeded. */
  buyRelic(id: string): boolean {
    const relic = RELICS.find((r) => r.id === id);
    if (!relic) return false;
    if (this.meta.research) return false; // one research at a time
    if (!relicPrereqMet(this.meta, id)) return false;
    const lvl = relicLevel(this.meta, id);
    if (lvl >= relic.maxLevel) return false;
    const cost = relic.cost(lvl);
    if (this.meta.runes < cost) return false;
    this.meta.runes -= cost;
    if (relic.research) {
      const now = Date.now();
      this.meta.research = { id, level: lvl + 1, startedAt: now, completesAt: now + relic.research(lvl) };
    } else {
      this.meta.levels[id] = lvl + 1;
    }
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
    const inst = rollLootbox(this.rng, relicLevel(this.meta, "fortune"));
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
    const e = new Enemy(this, entry.type, this.wave, !!entry.elite);
    // apply risky enemy HP buff
    e.maxHp = Math.round(e.maxHp * this.buffs.enemyHpMult);
    e.hp = e.maxHp;
    this.enemies.push(e);
    if (entry.type === "boss") this.addText(e.x, e.y - 40, "BOSS!", "#ff6a5a");
    else if (entry.elite) this.addText(e.x, e.y - 30, "ELITE", "#ffd24a");
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
    setStatMax(this.progress, "bestEndlessWave", Math.max(0, this.wave - SIEGE_WAVE));
    flushPersist(); // this run's runes/crates/stats are final — persist now
    uiAnnounce(`The castle has fallen. You survived ${this.wave} waves.`);
    hideSeedChip();
    if (!this.demo) this.showEndCard("over");
  }

  // ---------------------------------------------------------------- combat
  damageEnemy(e: Enemy, amount: number, kind: "physical" | "burn" | "magic", armorIgnore = 0): void {
    if (e.dead) return;
    const { hpLost, shattered } = e.takeDamage(this, amount, kind, armorIgnore);
    if (kind === "burn") {
      // DoT ticks accumulate; Enemy.update shows the burn total every 0.5s.
      e.dotAccum += hpLost;
      return;
    }
    const x = e.x + (this.rng.next() - 0.5) * 16;
    if (hpLost <= 0) {
      // The whole hit was stripped from the armor pool: show the points
      // absorbed in steel so the player can see the pool working.
      this.addText(x, e.y - 24, String(Math.round(amount)), "#9fb6c9");
    } else {
      const col = kind === "magic" ? "#c58bff" : "#ffffff";
      this.addText(x, e.y - 24, String(Math.max(1, Math.round(hpLost))), col);
    }
    if (shattered) {
      this.addText(e.x, e.y - 34, "SHATTER", "#dcecfb");
      this.sfx("spear");
    }
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
    // Elite kill: a chance at a bonus Supply Crate, so the endless tail keeps
    // feeding the meta-progression loop instead of just gold.
    if (e.elite && this.rng.chance(0.25)) {
      this.meta.crates += 1;
      saveMeta(this.meta);
      this.addText(e.x, e.y - 34, "+1 crate", "#d2a24c");
    }
    // Toxic Sludge & co: burst into a corrosive puddle on death, poisoning any
    // other foes still standing in it — a small bonus for killing one in a cluster.
    if (e.def.puddle) {
      this.spawnSplashFx(e.x, e.y - 6);
      this.addFirePatch(e.x, e.y, 30, 2.5, 8, "poison");
    }
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

  /** A lingering ground effect: napalm (grounded foes only) or poison (also fliers). */
  addFirePatch(x: number, y: number, r: number, dur: number, dps: number, kind: "fire" | "poison" = "fire"): void {
    this.firePatches.push({ x, y, r, until: this.time + dur, dps, kind });
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
  /** Alchemist flask: arcs to a point like a cannonball, but its splash also
   *  reaches fliers and it leaves a poison cloud rather than a napalm patch. */
  spawnFlask(x: number, y: number, tx: number, ty: number, damage: number, splash: number, speed: number, mods: SpecMods = {}): void {
    const a = Math.atan2(ty - y, tx - x);
    this.projectiles.push(new Projectile("flask", x, y, a, speed, damage, { tx, ty, splash, mods }));
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
  /** Shatter pool broken: cold steel sparks + a ring at the foe. */
  spawnShatterFx(x: number, y: number): void {
    const f = this.mkFx("fire", x, y, 0.35, 0.8);
    f.attach(this.assets.manifest.fx.kenney_sparks, 40);
    f.tint = "#bfe3ff";
    this.mkFx("ring", x, y, 0.35, 0.5, { color: "#9fd0ff" });
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
    if (this.input.key("Equal") && !this._ziKey) this.zoomStep(1);
    if (this.input.key("Minus") && !this._zoKey) this.zoomStep(-1);
    if (this.input.key("Escape") && !this._eKey) this.cancelAction();
    // Menu keyboard controls (Phase 2): Escape closes an open sub-panel;
    // arrow keys page its list; PageUp/PageDown switch its tabs.
    if (this.screen === "menu" && this.menuPanelOpen() !== null) {
      if (this.input.key("Escape") && !this._eKey) this.closeMenuPanel();
      if (this.input.key("ArrowRight") && !this._arrowRKey) this.hud.panelPage(this, 1);
      if (this.input.key("ArrowLeft") && !this._arrowLKey) this.hud.panelPage(this, -1);
      if (this.input.key("ArrowDown") && !this._arrowDKey) this.hud.panelPage(this, 1);
      if (this.input.key("ArrowUp") && !this._arrowUKey) this.hud.panelPage(this, -1);
      if (this.input.key("PageDown") && !this._pgDnKey) {
        const msg = this.hud.panelTab(this, 1);
        if (msg) {
          this.sfx("click");
          uiAnnounce(msg);
        }
      }
      if (this.input.key("PageUp") && !this._pgUpKey) {
        const msg = this.hud.panelTab(this, -1);
        if (msg) {
          this.sfx("click");
          uiAnnounce(msg);
        }
      }
    }
    if (this.input.key("Space") && !this._spaceKey && this.screen === "game" && !this.paused && this.wavePhase === "build")
      this.startWave();
    const numMap: Record<string, TowerType> = {
      Digit1: "archer",
      Digit2: "lancer",
      Digit3: "cannon",
      Digit4: "monastery",
      Digit5: "barracks",
      Digit6: "wizard",
      Digit7: "alchemist",
      Digit8: "ballista",
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
    this._ziKey = this.input.key("Equal");
    this._zoKey = this.input.key("Minus");
    this._eKey = this.input.key("Escape");
    this._spaceKey = this.input.key("Space");
    this._arrowLKey = this.input.key("ArrowLeft");
    this._arrowRKey = this.input.key("ArrowRight");
    this._arrowUKey = this.input.key("ArrowUp");
    this._arrowDKey = this.input.key("ArrowDown");
    this._pgUpKey = this.input.key("PageUp");
    this._pgDnKey = this.input.key("PageDown");

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
  _ziKey = false;
  _zoKey = false;
  _arrowLKey = false;
  _arrowRKey = false;
  _arrowUKey = false;
  _arrowDKey = false;
  _pgUpKey = false;
  _pgDnKey = false;
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

  /** One-step zoom around the viewport center — HUD buttons and ＋ / − keys. */
  zoomStep(dir: 1 | -1): void {
    if (this.screen !== "game") return;
    this.zoomAt(WORLD_W / 2, WORLD_H / 2, -320 * dir);
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
    this.screenFade = 1;
    this.placing = null;
    this.movingSpot = null;
    this.selectedTower = null;
    this.paused = false;
    flushPersist(); // settle any pending rune/crate/stat writes before the menu
    hideEndScreen();
    hideSeedChip();
    hideLandingHero();
    uiAnnounce("Back to the menu.");
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
      if (this.screenFade > 0) {
        ctx.fillStyle = `rgba(10,53,64,${this.screenFade})`; // #0a3540 — the menu backdrop
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      }
      return;
    }

    // world — through the tilt-shift pass when zoomed in, direct otherwise
    if (this.cam.zoom > Game.TILT_ZOOM_ON) this.renderTiltShift(ctx);
    else this.drawWorld(ctx);

    // HUD (screen space, always crisp)
    this.hud.draw(this, ctx);

    if (this.paused) this.drawPauseOverlay(ctx);
  }

  /**
   * Everything that lives in world space (clip + camera transform + island).
   * Rendered straight to the main canvas at 1× zoom, or into the tilt-shift
   * scene buffer when zoomed in.
   */
  private drawWorld(ctx: CanvasRenderingContext2D): void {
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
    this.drawClouds(ctx);

    this.drawBuildSpots(ctx);
    this.drawCastle(ctx);

    // napalm / poison patches (on the ground, under the entities)
    if (this.firePatches.length > 0) {
      for (const f of this.firePatches) {
        const a = Math.min(1, (f.until - this.time) / 0.5) * 0.55;
        ctx.save();
        const g = ctx.createRadialGradient(f.x, f.y, 2, f.x, f.y, f.r);
        if (f.kind === "poison") {
          g.addColorStop(0, `rgba(140,220,90,${a})`);
          g.addColorStop(0.7, `rgba(80,160,60,${a * 0.5})`);
          g.addColorStop(1, "rgba(40,100,40,0)");
        } else {
          g.addColorStop(0, `rgba(255,170,60,${a})`);
          g.addColorStop(0.7, `rgba(230,90,30,${a * 0.5})`);
          g.addColorStop(1, "rgba(160,50,20,0)");
        }
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
  }

  /**
   * Tilt-shift "diorama" pass: the world is rendered once into an offscreen
   * buffer, then re-composited with a blurred copy masked to the top/bottom
   * bands (feathered). At 1× zoom nothing is blurred; the depth of field
   * grows with cam.zoom until it peaks at CAM_ZOOM_MAX — the island starts
   * reading as a miniature model the more you zoom in.
   */
  private renderTiltShift(ctx: CanvasRenderingContext2D): void {
    let t = this.tilt;
    if (!t) {
      t = { scene: document.createElement("canvas"), blur: document.createElement("canvas") };
      for (const c of [t.scene, t.blur]) {
        c.width = WORLD_W;
        c.height = WORLD_H;
      }
      this.tilt = t;
    }
    const s =
      (this.cam.zoom - Game.CAM_ZOOM_MIN) / (Game.CAM_ZOOM_MAX - Game.CAM_ZOOM_MIN);

    // 1. world into the scene buffer (same clip + camera as the direct path)
    const sc = t.scene.getContext("2d")!;
    sc.clearRect(0, 0, WORLD_W, WORLD_H);
    this.drawWorld(sc);

    // 2. crisp scene as the base
    ctx.drawImage(t.scene, 0, 0);
    if (s <= 0.01) return;

    // 3. blurred copy of the scene
    const bc = t.blur.getContext("2d")!;
    bc.globalCompositeOperation = "source-over";
    bc.clearRect(0, 0, WORLD_W, WORLD_H);
    bc.fillStyle = "#05080b"; // so the blur samples the dark frame, not transparency
    bc.fillRect(0, 0, WORLD_W, WORLD_H);
    bc.filter = `blur(${(Game.TILT_BLUR_PX * s).toFixed(1)}px)`;
    bc.drawImage(t.scene, 0, 0);
    bc.filter = "none";

    // 4. feathered depth-of-field mask: blurred at top/bottom, sharp in the middle
    const h = WORLD_H;
    const bandHalf = h * 0.5 * (1 - 0.5 * s); // sharp band half-height: 50% → 25%
    const feather = h * 0.14;
    bc.globalCompositeOperation = "destination-in";
    const g = bc.createLinearGradient(0, 0, 0, h);
    const top = h / 2 - bandHalf;
    const bot = h / 2 + bandHalf;
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(Math.max(0, (top - feather) / h), "rgba(255,255,255,1)");
    g.addColorStop(Math.min(1, (top + feather) / h), "rgba(255,255,255,0)");
    g.addColorStop(Math.max(0, (bot - feather) / h), "rgba(255,255,255,0)");
    g.addColorStop(Math.min(1, (bot + feather) / h), "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,1)");
    bc.fillStyle = g;
    bc.fillRect(0, 0, WORLD_W, WORLD_H);
    bc.globalCompositeOperation = "source-over";

    // 5. the masked blur on top of the crisp base
    ctx.drawImage(t.blur, 0, 0);
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

    // cost + cancel hint above the ghost — unless that would push it past the
    // island's current top edge (a pad near the newest growth band), in which
    // case it's drawn below instead so it never gets clipped off-screen.
    const topBound = this.world.minRow * TILE;
    const below = gy - pad / 2 - topBound < 40;
    const y1 = below ? gy + pad / 2 + 24 : gy - pad / 2 - 20;
    const y2 = below ? gy + pad / 2 + 40 : gy - pad / 2 - 5;
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "700 15px 'Segoe UI', sans-serif";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.65)";
    const label = valid ? `Move pad · ${SPOT_MOVE_COST}g` : "Move pad";
    ctx.strokeText(label, gx, y1);
    ctx.fillStyle = valid ? "#d8f5d8" : "#e8b8b8";
    ctx.fillText(label, gx, y1);
    ctx.font = "600 12px 'Segoe UI', sans-serif";
    ctx.strokeText("click a grass cell · right-click to cancel", gx, y2);
    ctx.fillStyle = "rgba(230,240,245,0.9)";
    ctx.fillText("click a grass cell · right-click to cancel", gx, y2);
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

  private drawClouds(ctx: CanvasRenderingContext2D): void {
    for (const c of this.clouds) {
      const def = this.assets.manifest.clouds[c.img];
      const img = this.assets.img(def.image);
      const w = def.size[0] * c.scale;
      const h = def.size[1] * c.scale;
      ctx.save();
      ctx.globalAlpha = c.alpha;
      ctx.drawImage(img, c.x - w / 2, c.y - h / 2, w, h);
      ctx.restore();
    }
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

  /** Garrison tips, cycled on the loading screen (4s each). */
  private static readonly LOADING_TIPS = [
    "Space starts the wave — don't sit on your gold.",
    "The island grows every 5 waves. So does the horde.",
    "Drag to pan · wheel to zoom — the whole island is yours.",
    "Barracks soldiers march the road and hold it against ground foes.",
    `Relocate an empty pad for ${SPOT_MOVE_COST}g — right-click to cancel.`,
    "At +3 upgrades a tower can Specialize: pick a line, then level it.",
    "Cleared waves bank ◆ runes — spend them in The Codex.",
  ];

  /**
   * Loading screen — deliberately the menu's own backdrop (same sea, waves,
   * title and castle position), so when the assets land the menu's castle and
   * buttons materialize in place with no layout jump. Two phases:
   *  - "boot":   no manifest yet — pure vector art (placeholder castle, an
   *              indeterminate bar)
   *  - "assets": manifest in hand — the real castle sprite as soon as its
   *              image arrives, and a true-percentage progress bar.
   */
  private drawLoading(ctx: CanvasRenderingContext2D): void {
    const t = this.time;
    const W = CANVAS_W;
    const H = CANVAS_H;

    // sea — identical to the menu backdrop
    ctx.fillStyle = "#0a3540";
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 6; i++) {
      ctx.strokeStyle = `rgba(120,190,205,${0.12 + i * 0.03})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 8) {
        const y = 120 + i * 70 + Math.sin(x * 0.03 + t * 1.5 + i) * 6;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    // castle — real sprite once its image has loaded, vector placeholder before.
    // Drawn UNDER the title, exactly like the menu (text frontmost).
    const a = this.bootAssets;
    if (a && a.has(a.manifest.buildings["blue"]["castle"].image)) {
      const castle = asAsset(a.building("blue", "castle"));
      drawSprite(ctx, a, castle, 0, W / 2, 258, { scale: 1.05 });
    } else {
      this.drawCastlePlaceholder(ctx, W / 2, 258);
    }

    // title — same placement and styling as the menu
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffd24a";
    ctx.font = "900 64px 'Segoe UI', sans-serif";
    ctx.fillText("TINY SIEGE", W / 2, 120);
    ctx.fillStyle = "#bfe6ef";
    ctx.font = "600 20px 'Segoe UI', sans-serif";
    ctx.fillText("a tower-defense roguelite", W / 2, 152);
    ctx.restore();

    this.drawLoadingBar(ctx, W / 2, 330, t);
    this.drawLoadingTip(ctx, W / 2, H - 40, t);
  }

  /**
   * Blocky vector stand-in for the castle, shown only until the real sprite
   * lands. Shares the menu castle's anchor (bottom-center at the given point)
   * and its 327×218 footprint (the 312×208 sprite at scale 1.05), with the
   * same layering as the menu (drawn under the title), so the swap is seamless.
   * Local coords: origin at the bottom-center, y negative up.
   */
  private drawCastlePlaceholder(ctx: CanvasRenderingContext2D, cx: number, baseY: number): void {
    ctx.save();
    ctx.translate(Math.round(cx), Math.round(baseY));
    const blk = (x0: number, y0: number, x1: number, y1: number, c: string) => {
      ctx.fillStyle = c;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    };
    const STONE = "#46647f";
    const STONE_LT = "#5d7f9e";
    const WOOD = "#b98a4e";
    const WOOD_DK = "#8a6234";
    const TEAL = "#4ec9d8";
    const GATE = "#14212e";

    // stone base (bottom 40%, like the sprite) with gate
    blk(-163, -113, 163, 0, STONE);
    blk(-163, -113, 163, -105, STONE_LT);
    blk(-26, -55, 26, 0, GATE);
    blk(-18, -63, 18, -55, GATE);

    // corner towers, top aligned with the crenellation band
    for (const s of [-1, 1]) {
      const x0 = s === -1 ? -163 : 112;
      const x1 = s === -1 ? -112 : 163;
      blk(x0, -200, x1, -113, STONE_LT);
      blk(s === -1 ? -163 : 150, -200, s === -1 ? -150 : 163, -113, STONE); // outer shade
    }

    // wooden palisade between the towers, sitting on the base
    blk(-112, -188, 112, -113, WOOD);
    blk(-112, -125, 112, -113, WOOD_DK);

    // crenellation row across the very top: stone band + merlons + teal trim
    blk(-163, -200, 163, -192, STONE);
    for (let i = 0; i < 12; i++) blk(-158 + i * 27, -218, -142 + i * 27, -200, STONE_LT);
    for (let i = 0; i < 12; i++) blk(-158 + i * 27, -218, -142 + i * 27, -214, TEAL);
    ctx.restore();
  }

  /** Progress bar under the castle: indeterminate sweep while booting, true % once assets stream in. */
  private drawLoadingBar(ctx: CanvasRenderingContext2D, cx: number, y: number, t: number): void {
    const w = 320;
    const h = 20;
    const x = cx - w / 2;

    ctx.save();
    // frame + track (button-palette gold/dark so it reads as game UI)
    ctx.fillStyle = "#1a1206";
    ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
    ctx.fillStyle = "#0d2b36";
    ctx.fillRect(x, y, w, h);

    if (this.loadPhase === "assets") {
      const p = this.loadProgress;
      if (p > 0) {
        const fw = Math.max(4, Math.floor(w * p));
        ctx.fillStyle = "#c98a2e";
        ctx.fillRect(x, y, fw, h);
        ctx.fillStyle = "#ffd24a";
        ctx.fillRect(x, y, fw, Math.round(h * 0.4));
      }
      // shimmering head on the fill
      if (p > 0 && p < 1) {
        const hx = x + w * p;
        const g = 0.5 + 0.5 * Math.sin(t * 8);
        ctx.fillStyle = `rgba(255,235,170,${0.25 + 0.45 * g})`;
        ctx.fillRect(hx - 3, y, 6, h);
      }
    } else {
      // indeterminate: a gold segment sweeps left→right, wrapping
      const seg = 90;
      const k = (t * 0.5) % 1;
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      const sx = x - seg + k * (w + seg);
      ctx.fillStyle = "#c98a2e";
      ctx.fillRect(sx, y, seg, h);
      ctx.fillStyle = "#ffd24a";
      ctx.fillRect(sx, y, seg, Math.round(h * 0.4));
    }
    ctx.restore();

    // caption
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#8fb8c8";
    ctx.font = "600 14px 'Segoe UI', sans-serif";
    const label =
      this.loadPhase === "assets"
        ? `Stocking the armory… ${Math.floor(this.loadProgress * 100)}%`
        : "Raising the banners…";
    ctx.fillText(label, cx, y + h + 24);
    ctx.restore();
  }

  /** Rotating garrison tip, fading in/out at each 4s boundary. */
  private drawLoadingTip(ctx: CanvasRenderingContext2D, cx: number, y: number, t: number): void {
    const tips = Game.LOADING_TIPS;
    const idx = Math.floor(t / 4) % tips.length;
    const inTip = (t % 4) / 4;
    const a = Math.max(0, Math.min(1, inTip / 0.125, (1 - inTip) / 0.125));
    ctx.save();
    ctx.globalAlpha = a * 0.9;
    ctx.fillStyle = "#8fb8c8";
    ctx.font = "500 15px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(tips[idx], cx, y);
    ctx.restore();
  }

  /** Build the DOM end-screen card's data from this run's final state. */
  private showEndCard(kind: "over" | "victory"): void {
    const d: EndScreenData = {
      kind,
      wave: this.wave,
      kills: this.kills,
      best: this.best,
      towers: this.towers.length,
      seed: this.runSeed,
      endlessWave: Math.max(0, this.wave - SIEGE_WAVE),
    };
    showEndScreen(d);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    hideEndScreen();
    hideSeedChip();
    hideLandingHero();
    this.input.destroy();
  }
}

// keep reference so bundlers don't tree-shake the pool (used by HUD for tooltips)
export { BOONS };
export const towerOrder = TOWER_ORDER;
export type { EnemyType };
