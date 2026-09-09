import { Game } from "./game";
import type { Assets, StaticDef } from "./assets";
import { asAsset } from "./assets";
import { drawSprite, tintedImage } from "./sprite";
import { ENEMY_DEFS, enemyPreviewDef, type EnemyType } from "./enemy";
import {
  TOWER_DEFS,
  TOWER_ORDER,
  MAX_UPGRADE,
  upgradeCost,
  tracksFor,
  trackLabel,
  SPECS,
  SPEC_UNLOCK_COST,
  SPEC_UNLOCK_AT,
  MAX_SPEC,
  specUpgradeCost,
  type UpgradeTrack,
} from "./tower";
import { RARITY_COLOR } from "./boons";
import { WORLD_W, WORLD_H, MARGIN_R, MARGIN_B, CANVAS_W, CANVAS_H, SPOT_MOVE_COST, SIEGE_WAVE, ENDLESS_ELITE_INTERVAL, ARMOR_POINT_VALUE, ARMOR_UNLOCK_WAVE } from "./config";
import { VICTORY_RUNES, VICTORY_CRATES, RELICS, RELIC_BRANCHES, relicLevel, relicPrereqMet, relicPrereqOf, fmtDuration } from "./meta";
import {
  ACHIEVEMENTS,
  LOGIN_REWARDS,
  achievementProgress,
  isAchievementClaimed,
  missionProgress,
  missionDef,
  canClaimLogin,
  hasClaimable,
  todayKey,
  isYesterday,
  type MissionInstance,
  type MissionDef,
  type ProgressTab,
  type Reward,
} from "./progress";
import {
  GEAR_BY_ID,
  GEAR_SLOTS,
  SLOT_LABEL,
  TIER_COLORS,
  TIER_MAX,
  LOOTBOX_COST,
  lootboxOddsText,
  gearBonusText,
  gearPercent,
  gearUpgradeCost,
  nextLockedStat,
  scrapValue,
  statLabel,
  type GearInstance,
  type GearSlot,
} from "./gear";
import type { TowerType } from "./types";
import { fmt } from "./util";

interface TipLine {
  t: string;
  c?: string;
  b?: boolean;
}
interface Tip {
  title: string;
  accent?: string;
  lines: TipLine[];
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type HudLayout = ReturnType<Hud["computeLayout"]>;

const inRect = (p: { x: number; y: number }, r: Rect) =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

export class Hud {
  assets: Assets;
  private layoutCache: ReturnType<Hud["computeLayout"]>;
  // Armory (menu) temp state
  /** Public: the DOM armory (ui-panels) shares this selection state. */
  selectedGearUid: string | null = null;
  private armoryPage = 0;
  /** Public: the ?smith debug param jumps straight to the Blacksmith tab. */
  armoryTab: "vault" | "smith" = "vault";
  /** Top-level menu button to draw a focus ring around (DOM keyboard focus). */
  menuFocus: "start" | "help" | "codex" | "armory" | "progress" | null = null;
  /** Phase 3: which canvas panel the DOM layer (ui-panels) renders instead. */
  suppressedPanel: "help" | "codex" | "progress" | "armory" | null = null;
  private smithPageRecycle = 0;
  private smithPageUpgrade = 0;
  /** Last opened Supply Crate, shown in a reveal overlay until dismissed.
   *  Public: the DOM armory (ui-panels) renders the same reveal. */
  crateReveal: GearInstance | null = null;
  // Progress (menu) temp state
  progressTab: ProgressTab = "ach";
  private progressAchPage = 0;
  /** Next-wave preview chips drawn this frame (canvas space) for hover tips. */
  private previewChips: { rect: Rect; type: EnemyType; n: number; elite: boolean }[] = [];

  constructor(assets: Assets) {
    this.assets = assets;
    this.layoutCache = null as unknown as ReturnType<Hud["computeLayout"]>;
  }

  // ------------------------------------------------------------- layout
  private computeLayout(game: Game) {
    // Right-margin info panel (off the map): castle HP, gold, wave, start-wave,
    // the telegraphed next-wave preview, and controls.
    const rp = { x: WORLD_W + 12, y: 12, w: MARGIN_R - 24, h: 736 };
    const ix = rp.x + 12;
    const iw = rp.w - 24;
    const castleHp = { x: ix, y: rp.y + 12, w: iw, h: 18 };
    const goldRect = { x: ix, y: rp.y + 42, w: iw, h: 26 };
    const waveRect = { x: ix, y: rp.y + 74, w: iw, h: 34 };
    const startWave = { x: ix, y: rp.y + 116, w: iw, h: 40 };
    const previewRect = { x: ix, y: rp.y + 164, w: iw, h: 322 };
    const speed = { x: ix, y: rp.y + 164 + 322 + 8, w: iw, h: 40 };
    const pause = { x: ix, y: speed.y + 48, w: iw, h: 40 };
    const mute = { x: ix, y: pause.y + 48, w: iw, h: 40 };
    const menu = { x: ix, y: mute.y + 48, w: iw, h: 40 };
    // touch-friendly zoom step buttons (no wheel needed), split across the row
    const zw = (iw - 8) / 2;
    const zoomOut = { x: ix, y: menu.y + 48, w: zw, h: 40 };
    const zoomIn = { x: ix + zw + 8, y: menu.y + 48, w: zw, h: 40 };

    // bottom-margin palette (off the map), aligned to the map width
    const palH = 88;
    const palY = WORLD_H + (MARGIN_B - palH) / 2;
    const n = TOWER_ORDER.length;
    const pad = 14;
    const gap = 10;
    const totalW = WORLD_W - pad * 2;
    const bw = (totalW - gap * (n - 1)) / n;
    const palette: Record<string, Rect> = {};
    TOWER_ORDER.forEach((t, i) => {
      palette[t] = { x: pad + i * (bw + gap), y: palY, w: bw, h: palH };
    });

    // selected tower panel — per-stat upgrade tracks + specialization (clamped to the world)
    let sel:
      | {
          panel: Rect;
          upgrades: { track: UpgradeTrack; rect: Rect }[];
          specChoose: { specId: string; rect: Rect }[];
          specUp: Rect | null;
          specHint: Rect | null;
          sell: Rect;
        }
      | null = null;
    if (game.selectedTower && game.screen === "game" && game.wavePhase !== "boon") {
      const t = game.selectedTower;
      const tracks = tracksFor(t.type);
      const pw = 240, ppad = 10, btnH = 24, btnGap = 5;
      const headH = 66;
      // specialization section: 3 choice rows, 1 upgrade row, or a hint line
      const specSection = t.spec
        ? 1
        : t.specReady
          ? SPECS[t.type].length
          : 0;
      const hintH = !t.spec && !t.specReady ? 16 : 0;
      const ph = headH + tracks.length * (btnH + btnGap) + specSection * (btnH + btnGap) + hintH + btnH + 16;
      // The panel is drawn in screen space, so anchor it to the tower's
      // on-screen position (world -> canvas through the camera).
      const z = game.cam.zoom,
        cx = game.cam.x,
        cy = game.cam.y;
      let px = t.x * z + cx + 44;
      let py = t.y * z + cy - ph / 2;
      px = Math.min(Math.max(8, px), CANVAS_W - pw - 8);
      py = Math.min(Math.max(8, py), CANVAS_H - ph - 8);
      const upgrades = tracks.map((track, i) => ({
        track,
        rect: { x: px + ppad, y: py + headH + i * (btnH + btnGap), w: pw - ppad * 2, h: btnH },
      }));
      let y = py + headH + tracks.length * (btnH + btnGap);
      const specChoose: { specId: string; rect: Rect }[] = [];
      let specUp: Rect | null = null;
      let specHint: Rect | null = null;
      if (t.spec) {
        specUp = { x: px + ppad, y, w: pw - ppad * 2, h: btnH };
        y += btnH + btnGap;
      } else if (t.specReady) {
        for (const s of SPECS[t.type]) {
          specChoose.push({ specId: s.id, rect: { x: px + ppad, y, w: pw - ppad * 2, h: btnH } });
          y += btnH + btnGap;
        }
      } else {
        specHint = { x: px + ppad, y, w: pw - ppad * 2, h: hintH };
        y += hintH;
      }
      const sell = { x: px + ppad, y: py + ph - btnH - 8, w: pw - ppad * 2, h: btnH };
      sel = { panel: { x: px, y: py, w: pw, h: ph }, upgrades, specChoose, specUp, specHint, sell };
    }

    // boon modal cards
    let cards: Rect[] = [];
    if (game.wavePhase === "boon" && game.screen === "game") {
      const cw = 200;
      const ch = 250;
      const gapC = 18;
      const total = cw * 3 + gapC * 2;
      const x0 = (WORLD_W - total) / 2;
      const y0 = (WORLD_H - ch) / 2 - 10;
      cards = [0, 1, 2].map((i) => ({ x: x0 + i * (cw + gapC), y: y0, w: cw, h: ch }));
    }

    return { rp, castleHp, goldRect, waveRect, startWave, previewRect, speed, pause, mute, menu, zoomOut, zoomIn, palette, sel, cards };
  }

  private layout(game: Game) {
    this.layoutCache = this.computeLayout(game);
    return this.layoutCache;
  }

  /** A short counter-trait tag for the wave preview (so threats are legible). */
  private enemyTraits(type: EnemyType): { label: string; color: string } | null {
    const base = ENEMY_DEFS[type];
    if (base.flying) return { label: "flying", color: "#8fd0ff" };
    if (base.armor) return { label: "armored", color: "#c9d6e2" };
    if (base.healer) return { label: "heals", color: "#9ff0ff" };
    if (base.speed >= 90) return { label: "fast", color: "#ffd24a" };
    return null;
  }

  /** Telegraph the next wave's enemy mix so a leak is a legible build choice. */
  private drawWavePreview(game: Game, ctx: CanvasRenderingContext2D, r: Rect): void {
    this.previewChips = [];
    // Inner box so the preview reads as its own section of the right panel.
    ctx.save();
    this.roundRect(ctx, r, 8);
    ctx.fillStyle = "rgba(8, 16, 24, 0.55)";
    ctx.fill();
    ctx.strokeStyle = "rgba(140, 190, 220, 0.25)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // Count by type (remembering elite entries); sorted by abundance.
    const counts: { type: EnemyType; n: number; elite: boolean }[] = [];
    const seen = new Map<EnemyType, number>();
    for (const e of game.nextWave) {
      const i = seen.get(e.type);
      if (i === undefined) {
        seen.set(e.type, counts.length);
        counts.push({ type: e.type, n: 1, elite: !!e.elite });
      } else {
        counts[i].n++;
        if (e.elite) counts[i].elite = true;
      }
    }
    counts.sort((a, b) => b.n - a.n);
    const total = game.nextWave.length;

    ctx.save();
    ctx.textAlign = "left";
    ctx.fillStyle = "#8fd0ff";
    ctx.font = "700 12px 'Segoe UI', sans-serif";
    ctx.fillText("NEXT WAVE", r.x + 10, r.y + 19);
    if (total > 0 && game.wavePhase === "build") {
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(220,240,255,0.7)";
      ctx.font = "700 12px 'Segoe UI', sans-serif";
      // When more types exist than fit in the grid, say so up top.
      ctx.fillText(counts.length > 8 ? `${total} foes · ${counts.length} types` : `${total} foes`, r.x + r.w - 10, r.y + 19);
    }
    ctx.restore();

    if (game.wavePhase !== "build" || total === 0) {
      ctx.save();
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(180,210,225,0.45)";
      ctx.font = "600 12px 'Segoe UI', sans-serif";
      ctx.fillText(
        game.wavePhase === "active" ? `…${game.enemies.length + game.spawnQueue.length} foes left…` : "—",
        r.x + 10,
        r.y + 46,
      );
      ctx.restore();
      return;
    }

    const boss = counts.find((c) => c.type === "boss") ?? null;
    const regular = counts.filter((c) => c.type !== "boss");
    const padX = 8;
    let y = r.y + 30;

    // Boss callout: gold-bordered, big sprite, always visible — the single
    // most important piece of the telegraph.
    if (boss) {
      const h = 56;
      const bossRect = { x: r.x + padX, y, w: r.w - padX * 2, h };
      this.previewChips.push({ rect: bossRect, type: "boss", n: boss.n, elite: false });
      ctx.save();
      this.roundRect(ctx, bossRect, 6);
      ctx.fillStyle = "rgba(255, 210, 74, 0.10)";
      ctx.fill();
      ctx.strokeStyle = "#ffd24a";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
      drawSprite(ctx, this.assets, enemyPreviewDef(this.assets, "boss"), 0, r.x + padX + 36, y + h - 8, {
        scale: 0.65,
      });
      ctx.save();
      ctx.textAlign = "left";
      ctx.fillStyle = "#ffd24a";
      ctx.font = "700 15px 'Segoe UI', sans-serif";
      ctx.fillText(`BOSS  ×${boss.n}`, r.x + padX + 70, y + 25);
      ctx.fillStyle = "rgba(255,226,140,0.8)";
      ctx.font = "600 10px 'Segoe UI', sans-serif";
      ctx.fillText("huge — focus fire", r.x + padX + 70, y + 42);
      ctx.restore();
      y += h + 6;
    }

    // 2-column chip grid for the regular types (larger sprites than before).
    const chipW = (r.w - padX * 2 - 6) / 2;
    const chipH = 52;
    const shown = regular.slice(0, 8);
    shown.forEach((c, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const cx = r.x + padX + col * (chipW + 6);
      const cy = y + row * (chipH + 4);
      this.previewChips.push({ rect: { x: cx, y: cy, w: chipW, h: chipH }, type: c.type, n: c.n, elite: c.elite });
      ctx.save();
      this.roundRect(ctx, { x: cx, y: cy, w: chipW, h: chipH }, 6);
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.fill();
      ctx.restore();
      drawSprite(ctx, this.assets, enemyPreviewDef(this.assets, c.type), 0, cx + 30, cy + chipH - 8, { scale: 0.7 });
      ctx.save();
      ctx.textAlign = "right";
      ctx.fillStyle = "#eaf6ff";
      ctx.font = "700 15px 'Segoe UI', sans-serif";
      ctx.fillText(`×${c.n}`, cx + chipW - 8, cy + 21);
      const trait = this.enemyTraits(c.type);
      const ty = cy + 39;
      if (c.elite) {
        ctx.fillStyle = "#ff9c9c";
        ctx.font = "600 10px 'Segoe UI', sans-serif";
        const tw = trait ? this.txtW(trait.label, "600 10px 'Segoe UI', sans-serif") : 0;
        ctx.fillText("elite", cx + chipW - 8 - tw - 4, ty);
      }
      if (trait) {
        ctx.fillStyle = trait.color;
        ctx.font = "600 10px 'Segoe UI', sans-serif";
        ctx.fillText(trait.label, cx + chipW - 8, ty);
      }
      ctx.restore();
    });
  }

  // ------------------------------------------------------------- helpers
  private roundRect(ctx: CanvasRenderingContext2D, r: Rect, rad: number): void {
    const { x, y, w, h } = r;
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  private panel(ctx: CanvasRenderingContext2D, r: Rect, rad = 8): void {
    ctx.save();
    this.roundRect(ctx, r, rad);
    ctx.fillStyle = "rgba(10,26,34,0.92)";
    ctx.fill();
    ctx.strokeStyle = "rgba(150,200,220,0.35)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  private button(
    ctx: CanvasRenderingContext2D,
    r: Rect,
    label: string,
    opts: { bg?: string; fg?: string; active?: boolean; disabled?: boolean; small?: boolean; icon?: { key: string; tint?: string } } = {}
  ): void {
    ctx.save();
    const bg = opts.disabled ? "rgba(60,70,80,0.7)" : opts.active ? "#e8b23c" : opts.bg ?? "#1f4a5e";
    this.roundRect(ctx, r, 7);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = opts.active ? "#fff0c0" : "rgba(150,200,220,0.4)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = opts.disabled ? "rgba(200,210,220,0.5)" : opts.fg ?? "#eaf6ff";
    ctx.font = `${opts.small ? "600 12px" : "700 15px"} 'Segoe UI', sans-serif`;
    ctx.textBaseline = "middle";

    // Optional white icon (Kenney) to the left of the label, laid out as one
    // centered row: [icon][gap][label].
    let img: HTMLCanvasElement | HTMLImageElement | null = null;
    if (opts.icon) {
      const path = this.assets.icon(opts.icon.key);
      if (path) img = tintedImage(this.assets, path, opts.icon.tint ?? (opts.disabled ? "rgba(200,210,220,0.5)" : "#eaf6ff"));
    }
    const cy = r.y + r.h / 2;
    if (img) {
      const labelW = ctx.measureText(label).width;
      const iconW = Math.min(r.h - 8, 18);
      const gap = 6;
      const totalW = iconW + gap + labelW;
      const x0 = r.x + r.w / 2 - totalW / 2;
      ctx.drawImage(img, x0, cy - iconW / 2, iconW, iconW);
      ctx.textAlign = "left";
      ctx.fillText(label, x0 + iconW + gap, cy + 1);
    } else {
      ctx.textAlign = "center";
      ctx.fillText(label, r.x + r.w / 2, cy + 1);
    }
    ctx.restore();
  }

  private bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frac: number, color: string): void {
    ctx.save();
    this.roundRect(ctx, { x, y, w, h }, h / 2);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
    ctx.restore();
    ctx.save();
    this.roundRect(ctx, { x, y, w, h }, h / 2);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------- in-game HUD
  draw(game: Game, ctx: CanvasRenderingContext2D): void {
    const L = this.layout(game);

    if (game.screen === "over") {
      this.drawOver(game, ctx);
      return;
    }
    if (game.screen === "victory") {
      this.drawVictory(game, ctx);
      return;
    }

    // right-side panel
    this.panel(ctx, L.rp, 10);

    // castle hp
    const cfrac = game.castle.hp / game.castle.maxHp;
    this.bar(ctx, L.castleHp.x, L.castleHp.y, L.castleHp.w, L.castleHp.h, cfrac, cfrac > 0.5 ? "#6fe06f" : cfrac > 0.25 ? "#ffd24a" : "#e05555");
    ctx.save();
    ctx.fillStyle = "#eaf6ff";
    ctx.font = "700 11px 'Segoe UI', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`CASTLE ${Math.max(0, Math.ceil(game.castle.hp))}/${game.castle.maxHp}`, L.castleHp.x + 4, L.castleHp.y + 9);
    ctx.restore();

    // gold
    const coin = this.assets.manifest.ui.icons[2];
    ctx.drawImage(this.assets.img(coin), L.goldRect.x, L.goldRect.y + 2, 22, 22);
    ctx.save();
    ctx.fillStyle = "#ffd24a";
    ctx.font = "800 17px 'Segoe UI', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(fmt(game.gold), L.goldRect.x + 28, L.goldRect.y + 13);
    ctx.restore();

    // wave
    ctx.save();
    ctx.fillStyle = "#bfe6ef";
    ctx.font = "700 15px 'Segoe UI', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`Wave ${game.wave}`, L.waveRect.x, L.waveRect.y + 8);
    if (game.wave > SIEGE_WAVE) {
      const waveW = this.txtW(`Wave ${game.wave}`, "700 15px 'Segoe UI', sans-serif");
      ctx.fillStyle = "#ffd24a";
      ctx.font = "800 10px 'Segoe UI', sans-serif";
      ctx.fillText("ENDLESS", L.waveRect.x + waveW + 8, L.waveRect.y + 8);
    }
    ctx.font = "600 11px 'Segoe UI', sans-serif";
    ctx.fillStyle = "#8fb8c8";
    const sub =
      game.wavePhase === "active"
        ? `${game.enemies.length + game.spawnQueue.length} foes`
        : game.wavePhase === "build"
          ? game.wave === 0
            ? "build & start"
            : "build phase"
          : "";
    ctx.fillText(sub, L.waveRect.x, L.waveRect.y + 25);
    // meta rune + crate balances, right-aligned on the Wave line
    ctx.fillStyle = "#c58bff";
    ctx.font = "700 14px 'Segoe UI', sans-serif";
    ctx.textAlign = "right";
    const rightX = L.waveRect.x + L.waveRect.w;
    ctx.fillText(`◆ ${game.meta.runes}`, rightX, L.waveRect.y + 14);
    const runeW = this.txtW(`◆ ${game.meta.runes}`, "700 14px 'Segoe UI', sans-serif");
    ctx.fillStyle = "#d2a24c";
    const crateX = rightX - runeW - 24;
    this.crateIcon(ctx, crateX - this.txtW(String(game.meta.crates), "700 14px 'Segoe UI', sans-serif") - 4, L.waveRect.y + 8, 14);
    ctx.fillText(`${game.meta.crates}`, crateX, L.waveRect.y + 14);
    ctx.restore();

    // start wave / status
    if (game.wavePhase === "build" && !game.paused) {
      this.button(ctx, L.startWave, `⚔  Wave ${game.wave + 1}`, { bg: "#c98a2e", fg: "#1a1206", active: true });
    } else {
      this.button(ctx, L.startWave, game.wavePhase === "active" ? "Waving…" : "—", { bg: "#22404e", disabled: true, small: true });
    }

    // telegraphed next-wave composition
    this.drawWavePreview(game, ctx, L.previewRect);

    // controls (Kenney white icons, tinted to the label color)
    this.button(ctx, L.speed, `${game.speed}×  (F)`, { active: game.speedIdx > 0, small: true, icon: { key: "fast_forward" } });
    this.button(ctx, L.pause, game.paused ? "Resume" : "Pause", {
      small: true,
      icon: game.paused ? undefined : { key: "pause" },
    });
    this.button(ctx, L.mute, game.audioEnabled ? "Sound" : "Muted", {
      small: true,
      icon: { key: game.audioEnabled ? "music_on" : "music_off" },
    });
    this.button(ctx, L.menu, "Menu", { small: true, icon: { key: "home" } });
    this.button(ctx, L.zoomOut, "Zoom Out", { small: true, icon: { key: "zoom_out" }, disabled: game.cam.zoom <= Game.CAM_ZOOM_MIN + 1e-3 });
    this.button(ctx, L.zoomIn, "Zoom In", { small: true, icon: { key: "zoom_in" }, disabled: game.cam.zoom >= Game.CAM_ZOOM_MAX - 1e-3 });

    // palette
    for (const t of TOWER_ORDER) {
      const r = L.palette[t];
      const def = TOWER_DEFS[t];
      const unlocked = game.unlocked.has(t);
      const placing = game.placing === t;
      const cost = game.towerCost(t);
      const afford = game.gold >= cost;
      this.panel(ctx, r, 8);
      if (placing) {
        ctx.save();
        this.roundRect(ctx, r, 8);
        ctx.strokeStyle = "#ffd24a";
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.restore();
      }
      // building icon (animated for the wizard tower)
      if (def.animated) {
        const a = this.assets.animatedBuilding(def.animated);
        drawSprite(ctx, this.assets, a, 0, r.x + 30, r.y + r.h - 14, { scale: 0.7, alpha: unlocked ? 1 : 0.35 });
      } else {
        const b = asAsset(this.assets.building("blue", def.building));
        drawSprite(ctx, this.assets, b, 0, r.x + 30, r.y + r.h - 16, { scale: 0.32, alpha: unlocked ? 1 : 0.35 });
      }
      // name + cost
      ctx.save();
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = unlocked ? "#eaf6ff" : "rgba(200,210,220,0.5)";
      ctx.font = "700 13px 'Segoe UI', sans-serif";
      ctx.fillText(def.name, r.x + 60, r.y + 26);
      ctx.font = "600 13px 'Segoe UI', sans-serif";
      if (!unlocked) {
        ctx.fillStyle = "#8fb8c8";
        ctx.fillText("🔒 Locked", r.x + 60, r.y + 46);
      } else {
        ctx.fillStyle = afford ? "#ffd24a" : "#e07a5a";
        ctx.fillText(`${cost}  gold`, r.x + 60, r.y + 46);
      }
      ctx.fillStyle = "rgba(180,210,225,0.7)";
      ctx.font = "500 10px 'Segoe UI', sans-serif";
      ctx.fillText(def.desc.slice(0, 26), r.x + 60, r.y + 62);
      // gear pip: how many Armory pieces this tower type currently wears
      const gearCount = GEAR_SLOTS.filter((sl) => game.equippedFor(t, sl)).length;
      if (gearCount > 0) {
        ctx.fillStyle = "#c58bff";
        ctx.font = "800 13px 'Segoe UI', sans-serif";
        ctx.textAlign = "right";
        ctx.fillText(`⚙ ${gearCount}`, r.x + r.w - 10, r.y + 26);
      }
      ctx.restore();
    }

    // selected tower panel — per-stat upgrades
    if (L.sel && game.selectedTower) {
      const t = game.selectedTower;
      const s = this.statsFor(game, t);
      const { panel, upgrades, specChoose, specUp, specHint, sell } = L.sel;
      this.panel(ctx, panel, 8);
      ctx.save();
      ctx.textAlign = "left";
      ctx.fillStyle = "#ffd24a";
      ctx.font = "800 15px 'Segoe UI', sans-serif";
      const total = t.totalUpgrades;
      const sd = t.specDef();
      ctx.fillText(
        `${TOWER_DEFS[t.type].name}${total > 0 ? `  ·  +${total}` : ""}${sd ? `  ·  ${sd.name}` : ""}`,
        panel.x + 12,
        panel.y + 22
      );
      ctx.fillStyle = "#cfe6f0";
      ctx.font = "600 12px 'Segoe UI', sans-serif";
      if (t.type === "monastery") {
        ctx.fillText(`Aura ${Math.round(s.range)}   Bless +${Math.round(t.buffPower(game) * 100)}%`, panel.x + 12, panel.y + 44);
        ctx.fillStyle = "rgba(180,210,225,0.7)";
        ctx.font = "500 10px 'Segoe UI', sans-serif";
        ctx.fillText("Dmg & fire-rate buff to towers in aura", panel.x + 12, panel.y + 58);
      } else if (t.type === "barracks") {
        const ss = t.soldierStats(game);
        ctx.fillText(
          `Strike ${Math.round(ss.dmg)}   Armor ${ss.armor}   Muster ${ss.deploy.toFixed(1)}s   Up to ${ss.maxOut}`,
          panel.x + 12,
          panel.y + 44
        );
        ctx.fillStyle = "rgba(180,210,225,0.7)";
        ctx.font = "500 10px 'Segoe UI', sans-serif";
        ctx.fillText(
          `Soldier HP ${Math.round(ss.hp)} — ${ss.patrol > 0 ? `patrols ±${ss.patrol}px of the road` : "holds the road against ground foes"}`,
          panel.x + 12,
          panel.y + 58
        );
      } else {
        ctx.fillText(`Dmg ${Math.round(s.damage)}   Rate ${s.rate.toFixed(1)}/s   Range ${Math.round(s.range)}`, panel.x + 12, panel.y + 44);
        if (t.type === "cannon") {
          ctx.fillStyle = "rgba(180,210,225,0.7)";
          ctx.font = "500 10px 'Segoe UI', sans-serif";
          ctx.fillText(`Splash ${Math.round(s.splash)}`, panel.x + 12, panel.y + 58);
        } else if (t.type === "lancer") {
          ctx.fillStyle = "rgba(180,210,225,0.7)";
          ctx.font = "500 10px 'Segoe UI', sans-serif";
          ctx.fillText(`Pierce ${s.pierce}`, panel.x + 12, panel.y + 58);
        }
      }
      ctx.restore();

      for (const u of upgrades) {
        const lvl = t.upg[u.track];
        const label = trackLabel(t.type, u.track);
        if (lvl >= MAX_UPGRADE) {
          this.button(ctx, u.rect, `${label}  ·  MAX`, { bg: "#3a4a52", disabled: true, small: true });
        } else {
          const cost = Math.round(upgradeCost(t.type, u.track, lvl) * game.metaCostMult);
          this.button(ctx, u.rect, `⬆ ${label}  ${cost}g`, { active: true, disabled: game.gold < cost, small: true });
        }
      }

      // specialization section
      if (specUp && t.spec) {
        if (t.specLvl >= MAX_SPEC) {
          this.button(ctx, specUp, `⚑ ${sd?.name}  ·  L3 MAX`, { bg: "#3a4a52", disabled: true, small: true });
        } else {
          const cost = Math.round(specUpgradeCost(t.type, t.specLvl) * game.metaCostMult);
          this.button(ctx, specUp, `⚑ ${sd?.name} → L${t.specLvl + 1}  ${cost}g`, { active: true, disabled: game.gold < cost, small: true });
        }
      } else {
        for (const sc of specChoose) {
          const sdef = SPECS[t.type].find((x) => x.id === sc.specId);
          this.button(ctx, sc.rect, `⚑ ${sdef?.name}  ${SPEC_UNLOCK_COST}g`, { active: true, disabled: game.gold < SPEC_UNLOCK_COST, small: true });
        }
        if (specHint) {
          ctx.save();
          ctx.fillStyle = "rgba(180,210,225,0.65)";
          ctx.font = "500 10px 'Segoe UI', sans-serif";
          ctx.textAlign = "left";
          ctx.fillText(`Unlocks at +${SPEC_UNLOCK_AT} upgrades — then pick a line`, specHint.x + 2, specHint.y + 11);
          ctx.restore();
        }
      }

      const refund = Math.round(t.totalInvested * 0.6);
      this.button(ctx, sell, `Sell  +${refund}g`, { bg: "#6e3038", small: true });
    }

    // boon modal
    if (game.wavePhase === "boon" && L.cards.length > 0) {
      this.drawBoonModal(game, ctx, L.cards);
    }

    // tooltips go on top of everything
    this.drawTooltip(game, ctx);
  }

  private statsFor(game: Game, t: Game["towers"][number]) {
    return t.stats(game);
  }

  private drawBoonModal(game: Game, ctx: CanvasRenderingContext2D, cards: Rect[]): void {
    ctx.save();
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = "#04141a";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "#ffd24a";
    ctx.font = "800 30px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Wave cleared! Choose a boon", WORLD_W / 2, WORLD_H / 2 - 150);
    ctx.fillStyle = "#bfe6ef";
    ctx.font = "600 15px 'Segoe UI', sans-serif";
    ctx.fillText("Pick one to keep for the rest of this run.", WORLD_W / 2, WORLD_H / 2 - 122);
    ctx.restore();

    const choices = game.boonChoices;
    for (let i = 0; i < cards.length; i++) {
      const boon = choices[i];
      if (!boon) continue;
      const r = cards[i];
      const rc = RARITY_COLOR[boon.rarity];
      // card
      this.panel(ctx, r, 10);
      ctx.save();
      this.roundRect(ctx, r, 10);
      ctx.strokeStyle = rc;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
      // avatar icon
      const av = this.assets.manifest.ui.avatars[boon.icon % this.assets.manifest.ui.avatars.length];
      const aimg = this.assets.img(av);
      ctx.save();
      ctx.globalAlpha = 0.95;
      const aw = 84;
      ctx.drawImage(aimg, r.x + r.w / 2 - aw / 2, r.y + 18, aw, aw);
      ctx.restore();
      // name
      ctx.save();
      ctx.textAlign = "center";
      ctx.fillStyle = rc;
      ctx.font = "800 17px 'Segoe UI', sans-serif";
      ctx.fillText(boon.name, r.x + r.w / 2, r.y + 128);
      ctx.fillStyle = "#eaf6ff";
      ctx.font = "500 13px 'Segoe UI', sans-serif";
      this.wrapText(ctx, boon.desc, r.x + r.w / 2, r.y + 150, r.w - 24, 17);
      ctx.fillStyle = rc;
      ctx.font = "700 12px 'Segoe UI', sans-serif";
      ctx.fillText(boon.rarity.toUpperCase(), r.x + r.w / 2, r.y + r.h - 20);
      ctx.restore();
    }
  }

  private wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number): void {
    const words = text.split(" ");
    let line = "";
    let yy = y;
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, yy);
        line = w;
        yy += lh;
      } else line = test;
    }
    ctx.fillText(line, x, yy);
  }

  // ------------------------------------------------------------- clicks
  handleClick(game: Game, p: { x: number; y: number }): boolean {
    const L = this.layout(game);

    if (game.screen === "over") return this.handleGameOverClick(game, p);

    // boon modal takes priority
    if (game.wavePhase === "boon") return this.handleBoonClick(game, p, L);

    // pause toggle and menu work even while paused
    if (this.handlePauseMenuClick(game, p, L)) return true;

    // right panel (controls + start wave)
    if (this.handleRightPanelClick(game, p, L)) return true;

    // selected tower panel (per-stat upgrades + specialization)
    if (game.selectedTower && L.sel) return this.handleTowerPanelClick(game, p, L);

    // palette
    if (this.handlePaletteClick(game, p, L)) return true;

    // "start wave" hint area: clicking empty space while in build phase with no placement
    // does nothing (world interaction handles it). Return false so world handles it.
    return false;
  }

  private handleGameOverClick(game: Game, p: { x: number; y: number }): boolean {
    return this.handleOverClick(game, p);
  }

  private handleBoonClick(game: Game, p: { x: number; y: number }, L: HudLayout): boolean {
    for (let i = 0; i < L.cards.length; i++) {
      if (inRect(p, L.cards[i]) && game.boonChoices[i]) {
        game.applyBoon(game.boonChoices[i]);
        return true;
      }
    }
    return true; // swallow clicks while modal open
  }

  private handlePauseMenuClick(game: Game, p: { x: number; y: number }, L: HudLayout): boolean {
    // pause toggle and menu work even while paused
    if (inRect(p, L.pause)) {
      game.togglePause();
      return true;
    }
    if (inRect(p, L.menu)) {
      game.toMenu();
      return true;
    }
    if (game.paused) return true;
    return false;
  }

  private handleRightPanelClick(game: Game, p: { x: number; y: number }, L: HudLayout): boolean {
    if (inRect(p, L.rp)) {
      if (inRect(p, L.speed)) {
        game.cycleSpeed();
        return true;
      }
      if (inRect(p, L.mute)) {
        game.toggleMute();
        return true;
      }
      if (inRect(p, L.zoomIn)) {
        game.zoomStep(1);
        return true;
      }
      if (inRect(p, L.zoomOut)) {
        game.zoomStep(-1);
        return true;
      }
      if (game.wavePhase === "build" && inRect(p, L.startWave)) {
        game.startWave();
        return true;
      }
      return true; // swallow clicks on the panel
    }
    return false;
  }

  private handleTowerPanelClick(game: Game, p: { x: number; y: number }, L: ReturnType<Hud["computeLayout"]>): boolean {
    if (L.sel && game.selectedTower) {
      for (const u of L.sel.upgrades) {
        if (inRect(p, u.rect)) {
          game.upgradeTower(game.selectedTower, u.track);
          return true;
        }
      }
      for (const sc of L.sel.specChoose) {
        if (inRect(p, sc.rect)) {
          game.specializeTower(game.selectedTower, sc.specId);
          return true;
        }
      }
      if (L.sel.specUp && inRect(p, L.sel.specUp)) {
        game.upgradeSpec(game.selectedTower);
        return true;
      }
      if (inRect(p, L.sel.sell)) {
        game.sellTower(game.selectedTower);
        return true;
      }
      if (inRect(p, L.sel.panel)) return true;
    }
    return false;
  }

  private handlePaletteClick(game: Game, p: { x: number; y: number }, L: ReturnType<Hud["computeLayout"]>): boolean {
    for (const t of TOWER_ORDER) {
      if (inRect(p, L.palette[t])) {
        if (game.unlocked.has(t)) {
          game.setPlacing(game.placing === t ? null : t);
        } else {
          game.sfx("click");
        }
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------- tooltips
  // Hover explanations so every button, row, tower and foe answers
  // "what is this and what does it do?" before you click it.
  private tooltipAt(game: Game, p: { x: number; y: number }): Tip | null {
    if (game.screen === "menu") {
      if (game._showCodex) return this.tipCodex(game, p);
      if (game._showArmory) return this.tipArmory(game, p);
      const M = this.menuRects();
      if (inRect(p, M.start))
        return {
          title: "Start Siege",
          accent: "#f0c060",
          lines: [
            { t: `Clear all ${SIEGE_WAVE} waves to win the campaign.`, c: "#cfe3f5" },
            { t: "Between waves pick a Boon; surviving banks runes and supply crates." },
          ],
        };
      if (inRect(p, M.codex))
        return {
          title: "Relic Codex",
          lines: [
            { t: "Permanent upgrades bought with runes.", c: "#cfe3f5" },
            { t: "Each run you earn runes for how far you got — spend them here." },
          ],
        };
      if (inRect(p, M.armory))
        return {
          title: "The Armory",
          lines: [
            { t: "Gear banked from your runs.", c: "#cfe3f5" },
            { t: "Open Supply Crates to win gear, then equip pieces on tower types — they boost every one of those towers." },
          ],
        };
      if (inRect(p, M.help))
        return { title: "How to Play", lines: [{ t: "Towers, boons, gear and relics in brief." }] };
      return null;
    }
    if (game.screen !== "game") return null;

    const L = this.layout(game);

    // next-wave preview: hovering a chip explains that enemy type
    for (const c of this.previewChips) {
      if (inRect(p, c.rect)) return this.previewChipTip(game, c.type, c.n, c.elite);
    }

    // boon modal: hovering a card explains it
    if (game.wavePhase === "boon") {
      for (let i = 0; i < L.cards.length; i++) {
        const b = game.boonChoices[i];
        if (b && inRect(p, L.cards[i]))
          return { title: b.name, accent: RARITY_COLOR[b.rarity], lines: [{ t: b.desc, c: "#cfe3f5" }] };
      }
      return null;
    }

    if (inRect(p, L.pause)) return { title: "Pause", lines: [{ t: "Freeze the action. Your build keeps waiting." }] };
    if (inRect(p, L.menu))
      return { title: "Menu", lines: [{ t: "Leave to the main menu — this run ends.", c: "#e08a8a" }] };
    if (inRect(p, L.speed)) return { title: "Speed", lines: [{ t: `Cycle game speed — now ${game.speedIdx + 1}×.` }] };
    if (inRect(p, L.mute)) return { title: "Sound", lines: [{ t: "Toggle sound effects." }] };
    if (inRect(p, L.zoomIn))
      return { title: "Zoom in", lines: [{ t: "Step the camera closer (＋ key too). The diorama blur deepens as you zoom." }] };
    if (inRect(p, L.zoomOut))
      return { title: "Zoom out", lines: [{ t: "Step the camera back (− key too). At 1× the whole island stays in focus." }] };
    if (game.wavePhase === "build" && inRect(p, L.startWave))
      return {
        title: `Send wave ${game.wave + 1}`,
        accent: "#f0c060",
        lines: [{ t: "Start the next wave now — or keep building first." }],
      };

    // palette buttons: full description + stats (the card text is short on space)
    for (const t of TOWER_ORDER) {
      if (!inRect(p, L.palette[t])) continue;
      const d = TOWER_DEFS[t];
      const lines: TipLine[] = [];
      if (game.unlocked.has(t)) {
        lines.push({ t: `${game.towerCost(t)} gold to build`, c: "#e8c96a" });
        lines.push({ t: d.desc, c: "#8fa8bd" });
        lines.push({ t: this.baseStatLine(t, d), c: "#cfe3f5" });
      } else {
        lines.push({ t: "Locked.", c: "#7d93a8" });
        lines.push({ t: "Recruit it permanently with the Old Guard relic in the Codex." });
      }
      return { title: d.name, lines };
    }

    // selected-tower panel: what each upgrade button buys
    if (L.sel && game.selectedTower) {
      const tw = game.selectedTower;
      for (const u of L.sel.upgrades) {
        if (!inRect(p, u.rect)) continue;
        const lvl = tw.upg[u.track];
        const cost = Math.round(upgradeCost(tw.type, u.track, lvl) * game.metaCostMult);
        const desc =
          tw.type === "monastery"
            ? u.track === "damage"
              ? "+30% blessing power per level (tower damage)."
              : u.track === "rate"
                ? "+20% blessing power per level (tower speed)."
                : "+12% aura radius per level."
            : tw.type === "barracks"
              ? u.track === "damage"
                ? "+30% soldier HP, +20% strike, +1 armor per level."
                : u.track === "rate"
                  ? "-8% muster time per level, and +1 soldier to the cap."
                  : "Soldiers patrol ±60px more of the road per level."
              : u.track === "damage"
                ? "+30% damage per level."
                : u.track === "rate"
                  ? "+20% attack speed per level."
                  : "+12% range per level.";
        return {
          title: `${trackLabel(tw.type, u.track)}  L${lvl} → L${lvl + 1}`,
          lines: [
            { t: `Cost: ${cost} gold`, c: "#e8c96a" },
            { t: desc, c: "#cfe3f5" },
          ],
        };
      }
      for (const sc of L.sel.specChoose) {
        if (!inRect(p, sc.rect)) continue;
        const s = SPECS[tw.type].find((x) => x.id === sc.specId);
        if (s)
          return {
            title: s.name,
            accent: s.color,
            lines: [
              { t: s.blurb, c: "#cfe3f5" },
              { t: "Choose this specialization line (one-time choice).", c: "#8fa8bd" },
            ],
          };
      }
      if (L.sel.specUp && inRect(p, L.sel.specUp)) {
        const cost = specUpgradeCost(tw.type, tw.specLvl);
        return {
          title: "Upgrade specialization",
          lines: [
            { t: `Cost: ${cost} gold`, c: "#e8c96a" },
            { t: `Raise your specialization to L${tw.specLvl + 1} of ${MAX_SPEC}.`, c: "#cfe3f5" },
          ],
        };
      }
      if (inRect(p, L.sel.sell))
        return {
          title: "Sell tower",
          lines: [
            { t: `Refund ${Math.round(tw.totalInvested * 0.6)} gold (60% of everything spent).`, c: "#e08a8a" },
          ],
        };
      if (inRect(p, L.sel.panel)) return this.towerTip(game, tw);
    }

    // world hover: towers, foes, the castle (world-space mouse)
    if (game.mouse.over) {
      const tower = game.towers.find((t) => Math.hypot(t.x - game.mouse.x, t.y - game.mouse.y) < 34);
      if (tower) return this.towerTip(game, tower);
      const enemy = game.enemies.find((e) => Math.hypot(e.x - game.mouse.x, e.y - game.mouse.y) < 26);
      if (enemy) return this.enemyTip(enemy);
      if (Math.hypot(game.castle.x - game.mouse.x, game.castle.y - game.mouse.y) < 110)
        return {
          title: "Your Castle",
          accent: "#9fd8a8",
          lines: [
            { t: `HP ${Math.ceil(game.castle.hp)} / ${game.castle.maxHp}`, c: "#9fd8a8" },
            { t: "Foes that reach it deal damage. If it falls, the run ends.", c: "#e08a8a" },
          ],
        };
    }
    return null;
  }

  /** Plain-text stat summary for a tower type's base definition. */
  private baseStatLine(t: TowerType, d: (typeof TOWER_DEFS)[TowerType]): string {
    if (t === "barracks") return `soldier: ${d.damage} strike · 60 HP · musters every ${Math.round(1 / d.rate)}s`;
    const bits: string[] = [];
    if (d.damage > 0) bits.push(`damage ${d.damage}`);
    if (d.rate > 0) bits.push(`${d.rate.toFixed(2)}/s`);
    if (d.range > 0) bits.push(`range ${d.range}`);
    if (d.splash > 0) bits.push(`splash ${d.splash}px`);
    if (d.pierce > 0) bits.push(`pierce ${d.pierce + 1}`);
    if (d.buffDmg > 0) bits.push(`bless +${Math.round(d.buffDmg * 100)}% damage`);
    if (d.buffSpeed > 0) bits.push(`+${Math.round(d.buffSpeed * 100)}% speed`);
    return bits.join(" · ") || "—";
  }

  private towerTip(game: Game, t: Game["towers"][number]): Tip {
    const s = t.stats(game);
    const lines: TipLine[] = [];
    const upgTotal = t.upg.damage + t.upg.rate + t.upg.range;
    lines.push({ t: `${upgTotal} upgrade${upgTotal === 1 ? "" : "s"}${t.spec ? ` · spec L${t.specLvl}` : ""}`, c: "#8fa8bd" });
    if (t.type === "monastery")
      lines.push({ t: `Blesses nearby towers: +${Math.round(s.buffDmg * 100)}% damage, +${Math.round(s.buffSpeed * 100)}% speed`, c: "#cfe3f5" });
    else if (t.type === "barracks") {
      const ss = t.soldierStats(game);
      lines.push({ t: `Soldier: ${ss.dmg.toFixed(0)} strike · ${ss.hp.toFixed(0)} HP · armor ${ss.armor}`, c: "#cfe3f5" });
      lines.push({ t: `Up to ${ss.maxOut} out, one every ${ss.deploy.toFixed(1)}s${ss.patrol ? ` · patrols ±${ss.patrol}px` : ""}`, c: "#cfe3f5" });
    } else {
      const bits: string[] = [`${s.damage.toFixed(0)} damage`];
      if (s.rate > 0) bits.push(`${s.rate.toFixed(2)}/s`);
      bits.push(`${s.range.toFixed(0)} range`);
      if (s.splash > 0) bits.push(`splash ${s.splash.toFixed(0)}`);
      if (s.pierce > 0) bits.push(`pierce ${s.pierce + 1}`);
      lines.push({ t: bits.join(" · "), c: "#cfe3f5" });
    }
    // equipped armory gear, per slot
    for (const slot of GEAR_SLOTS) {
      const g = game.equippedFor(t.type, slot);
      if (g) {
        const def = GEAR_BY_ID.get(g.def);
        if (def) lines.push({ t: `${SLOT_LABEL[slot]}: ${def.name} T${g.tier} — ${gearBonusText(def, g.tier)}`, c: "#c58bff" });
      }
    }
    lines.push({ t: "Click to select — upgrade, specialize, sell.", c: "#7d93a8" });
    return { title: t.def.name, accent: "#dceeff", lines };
  }

  private enemyTip(e: Game["enemies"][number]): Tip {
    const lines: TipLine[] = [
      { t: `HP ${Math.ceil(e.hp)} / ${e.maxHp}`, c: "#9fd8a8" },
      { t: `worth ${e.reward} gold`, c: "#e8c96a" },
    ];
    if (e.flying) lines.push({ t: "Flies — cannons can't hit it.", c: "#8fa8bd" });
    if (e.def.healer) lines.push({ t: "Heals nearby foes.", c: "#ff8a8a" });
    if (e.armorMax > 0)
      lines.push({ t: `Armor ${Math.ceil(e.armor)} / ${e.armorMax} — must be stripped before HP.`, c: "#9fb6c9" });
    if (e.def.type === "boss") lines.push({ t: "Boss — slow, huge, and angry.", c: "#ffce5a" });
    return { title: e.displayName, accent: "#ffd24a", lines };
  }

  /** Next-wave preview chip hover: what to expect from this type in the coming wave. */
  private previewChipTip(game: Game, type: EnemyType, n: number, elite: boolean): Tip {
    const d = ENEMY_DEFS[type];
    const lines: TipLine[] = [
      { t: `×${n} in the next wave`, c: "#8fa8bd" },
      { t: `~${d.hp} HP · ${d.speed} speed · worth ${d.reward} gold`, c: "#9fd8a8" },
    ];
    if (d.armor) {
      const pts = d.armor * ARMOR_POINT_VALUE;
      const w = game.wave + 1;
      if (w < ARMOR_UNLOCK_WAVE)
        lines.push({ t: `Armored type — but armor only arrives from wave ${ARMOR_UNLOCK_WAVE}`, c: "#9fb6c9" });
      else if (type === "boss" || elite) lines.push({ t: `Armor ${pts} pts — shatters before HP`, c: "#9fb6c9" });
      else lines.push({ t: `May arrive armored: ${pts} pts shatter pool`, c: "#9fb6c9" });
    }
    if (d.flying) lines.push({ t: "Flies — cannons can't hit it.", c: "#8fa8bd" });
    if (d.healer) lines.push({ t: "Heals nearby foes.", c: "#ff8a8a" });
    if (d.puddle) lines.push({ t: "Death leaves a toxic puddle on the path.", c: "#b08aff" });
    if (type === "boss") lines.push({ t: "Boss — slow, huge, and angry.", c: "#ffce5a" });
    if (elite) lines.push({ t: "Elite — tougher and pays more.", c: "#ff9c9c" });
    return { title: d.name, accent: type === "boss" ? "#ffd24a" : "#dceeff", lines };
  }

  private tipCodex(game: Game, p: { x: number; y: number }): Tip | null {
    const L = this.codexLayout();
    for (const row of L.rows) {
      if (!inRect(p, row.rect)) continue;
      const def = RELICS.find((r) => r.id === row.id)!;
      const lvl = relicLevel(game.meta, row.id);
      const job = game.meta.research;
      const lines: TipLine[] = [{ t: def.blurb, c: "#8fa8bd" }];
      if (lvl > 0) lines.push({ t: `Now: ${def.effect(lvl)}`, c: "#9fd8a8", b: true });
      if (job && job.id === def.id) {
        const rem = Math.max(0, job.completesAt - Date.now());
        lines.push({ t: `Researching level ${job.level}: ${def.effect(job.level)}`, c: "#cfe3f5" });
        lines.push({ t: `Finishes in ${fmtDuration(rem)} — it applies automatically, even while you're away.`, c: "#e8c96a" });
      } else if (job) {
        lines.push({ t: "Wait — another research is still in progress (one at a time).", c: "#e08a8a" });
      } else if (lvl < def.maxLevel) {
        const cost = def.cost(lvl);
        const afford = game.meta.runes >= cost;
        lines.push({ t: `Next: ${def.effect(lvl + 1)}`, c: "#cfe3f5" });
        const dur = def.research ? ` · ${fmtDuration(def.research(lvl))} of research` : "";
        lines.push({ t: afford ? `Cost: ${cost} runes${dur}` : `Cost: ${cost} runes${dur} — not enough`, c: afford ? "#e8c96a" : "#e08a8a" });
      } else lines.push({ t: "Fully upgraded.", c: "#9fd8a8" });
      return { title: def.name, accent: "#dceeff", lines };
    }
    return null;
  }

  private tipArmory(game: Game, p: { x: number; y: number }): Tip | null {
    const L = this.armoryLayout(game);
    const vault = this.armoryTab === "vault";

    // Supply Crate purchase (both tabs)
    if (inRect(p, L.crateBtn)) {
      const fortune = relicLevel(game.meta, "fortune");
      const fortuneMax = RELICS.find((r) => r.id === "fortune")!.maxLevel;
      const job = game.meta.research;
      const lines: TipLine[] = [
        { t: `One random gear piece for ${LOOTBOX_COST} crates.`, c: "#cfe3f5" },
        { t: `Tier odds: ${lootboxOddsText(fortune)}.`, c: "#8fa8bd" },
      ];
      if (job && job.id === "fortune") {
        lines.push({ t: `Level ${job.level} research finishes in ${fmtDuration(Math.max(0, job.completesAt - Date.now()))} — the odds improve then.`, c: "#e8c96a" });
      } else if (fortune < fortuneMax) {
        lines.push({ t: `Raise the higher-tier odds with Crate Fortune (lvl ${fortune}/${fortuneMax}) in the Codex — research takes real time.`, c: "#8fa8bd" });
      } else {
        lines.push({ t: "Crate Fortune is fully upgraded — the best odds you'll ever roll.", c: "#8fa8bd" });
      }
      lines.push({ t: "Earn crates by clearing waves — they bank between runs.", c: "#8fa8bd" });
      return { title: "Supply Crate", accent: "#d2a24c", lines };
    }

    // vault tab: banked pieces
    if (vault) {
      for (const row of L.rows) {
        if (!inRect(p, row.rect)) continue;
        const def = GEAR_BY_ID.get(row.inst.def)!;
        return {
          title: `${def.name}  T${row.inst.tier}`,
          accent: TIER_COLORS[row.inst.tier],
          lines: [
            { t: `Bonus: ${gearBonusText(def, row.inst.tier)}`, c: "#9fd8a8", b: true },
            { t: `Boosts every ${TOWER_DEFS[def.tower].name}.`, c: "#cfe3f5" },
            { t: "Click the piece, then one of its tower's slots to equip.", c: "#8fa8bd" },
          ],
        };
      }
      // slot cards
      for (const s of L.slots) {
        if (!inRect(p, s.rect)) continue;
        const cur = game.equippedFor(s.tower, s.slot);
        if (cur) {
          const def = GEAR_BY_ID.get(cur.def)!;
          return {
            title: `${def.name}  T${cur.tier}`,
            accent: TIER_COLORS[cur.tier],
            lines: [
              { t: `Bonus: ${gearBonusText(def, cur.tier)}`, c: "#9fd8a8", b: true },
              { t: "Equipped on all " + TOWER_DEFS[s.tower].name + "s.", c: "#cfe3f5" },
              { t: "Click it to unequip back to the vault.", c: "#8fa8bd" },
            ],
          };
        }
        return {
          title: `${SLOT_LABEL[s.slot]} — empty`,
          lines: [{ t: `Slot for ${TOWER_DEFS[s.tower].name}s.`, c: "#cfe3f5" }, { t: "Select a piece in the vault, then this slot.", c: "#8fa8bd" }],
        };
      }
      return null;
    }

    // smith tab: recycle rows + upgrade rows
    for (const row of L.rRows) {
      if (!inRect(p, row.rect)) continue;
      const def = GEAR_BY_ID.get(row.inst.def)!;
      return {
        title: `${def.name}  T${row.inst.tier}`,
        accent: TIER_COLORS[row.inst.tier],
        lines: [
          { t: `Bonus: ${gearBonusText(def, row.inst.tier)}`, c: "#9fd8a8" },
          { t: `Recycle for ${scrapValue(row.inst)} scrap.`, c: "#e8c96a" },
        ],
      };
    }
    for (const row of L.uRows) {
      if (!inRect(p, row.rect)) continue;
      const def = GEAR_BY_ID.get(row.inst.def)!;
      const maxed = row.inst.tier >= TIER_MAX;
      return {
        title: `${def.name}  T${row.inst.tier}`,
        accent: TIER_COLORS[row.inst.tier],
        lines: maxed
          ? [{ t: "Max tier — this piece is as strong as it gets.", c: "#9fd8a8" }]
          : [
              { t: `T${row.inst.tier} → T${row.inst.tier + 1}: ${gearBonusText(def, row.inst.tier)} → ${gearBonusText(def, row.inst.tier + 1)}`, c: "#cfe3f5" },
              { t: `Cost: ${gearUpgradeCost(row.inst)} scrap`, c: "#e8c96a" },
            ],
      };
    }
    return null;
  }

  /** Draw the hover tooltip (topmost). */
  private drawTooltip(game: Game, ctx: CanvasRenderingContext2D): void {
    const p = game.mouseCanvas;
    if (p.x <= 0 && p.y <= 0) return;
    const tip = this.tooltipAt(game, p);
    if (!tip) return;
    const F = "'Segoe UI', sans-serif";
    const pad = 10, titleH = 18, lineH = 16;
    ctx.save();
    ctx.font = `700 13px ${F}`;
    let w = this.txtW(tip.title, `700 13px ${F}`) + pad * 2;
    for (const l of tip.lines) {
      ctx.font = `${l.b ? 700 : 500} 12px ${F}`;
      w = Math.max(w, this.txtW(l.t, `${l.b ? 700 : 500} 12px ${F}`) + pad * 2);
    }
    const h = pad + titleH + tip.lines.length * lineH;
    let x = p.x + 16, y = p.y + 20;
    if (x + w > CANVAS_W - 6) x = p.x - w - 14;
    if (y + h > CANVAS_H - 6) y = p.y - h - 14;
    x = Math.min(Math.max(6, x), CANVAS_W - w - 6);
    y = Math.min(Math.max(6, y), CANVAS_H - h - 6);
    ctx.fillStyle = "rgba(7,17,26,0.94)";
    ctx.strokeStyle = "rgba(110,190,240,0.4)";
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = tip.accent ?? "#dceeff";
    ctx.font = `700 13px ${F}`;
    ctx.fillText(tip.title, x + pad, y + pad + 9);
    tip.lines.forEach((l, i) => {
      ctx.fillStyle = l.c ?? "#b6cbdd";
      ctx.font = `${l.b ? 700 : 500} 12px ${F}`;
      ctx.fillText(l.t, x + pad, y + pad + titleH + 4 + i * lineH);
    });
    ctx.restore();
  }

  // ------------------------------------------------------------- menu / over
  private menuRects() {
    const w = 300;
    const h = 58;
    return {
      start: { x: CANVAS_W / 2 - w / 2, y: CANVAS_H / 2 + 10, w, h } as Rect,
      help: { x: CANVAS_W / 2 - w / 2, y: CANVAS_H / 2 + 78, w, h } as Rect,
      codex: { x: CANVAS_W / 2 - w / 2, y: CANVAS_H / 2 + 146, w, h } as Rect,
      armory: { x: CANVAS_W / 2 - w / 2, y: CANVAS_H / 2 + 214, w, h } as Rect,
      progress: { x: CANVAS_W / 2 - w / 2, y: CANVAS_H / 2 + 282, w, h } as Rect,
    };
  }

  drawMenu(game: Game, ctx: CanvasRenderingContext2D): void {
    // background: water + a decorative castle + title
    ctx.fillStyle = "#0a3540";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    // subtle waves
    ctx.save();
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 6; i++) {
      ctx.strokeStyle = `rgba(120,190,205,${0.12 + i * 0.03})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x <= CANVAS_W; x += 8) {
        const y = 120 + i * 70 + Math.sin(x * 0.03 + this.time(game) * 1.5 + i) * 6;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    // castle preview
    const castle = asAsset(this.assets.building("blue", "castle"));
    drawSprite(ctx, this.assets, castle, 0, CANVAS_W / 2, 258, { scale: 1.05 });

    // title
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffd24a";
    ctx.font = "900 64px 'Segoe UI', sans-serif";
    ctx.fillText("TINY SIEGE", CANVAS_W / 2, 120);
    ctx.fillStyle = "#bfe6ef";
    ctx.font = "600 20px 'Segoe UI', sans-serif";
    ctx.fillText("a tower-defense roguelite", CANVAS_W / 2, 152);
    ctx.restore();

    const r = this.menuRects();
    this.button(ctx, r.start, "⚔  Start Siege", { bg: "#c98a2e", fg: "#1a1206", active: true });
    this.button(ctx, r.help, "How to Play", { small: true });
    this.button(ctx, r.codex, `◆  The Codex   (${game.meta.runes})`, { small: true });
    this.button(ctx, r.armory, `⚙  The Armory   (${game.meta.gear.owned.length})`, { small: true });
    this.button(ctx, r.progress, "🏆  Achievements & Missions", { small: true });
    if (hasClaimable(game.progress)) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(r.progress.x + r.progress.w - 14, r.progress.y + 10, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#ff6a5a";
      ctx.fill();
      ctx.strokeStyle = "#1a1206";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    // Keyboard focus ring: mirrors DOM focus on the menu-nav buttons
    // (Phase 2). Suppressed while a sub-panel or the landing hero is up.
    if (
      this.menuFocus &&
      !game._showHelp &&
      !game._showCodex &&
      !game._showArmory &&
      !game._showProgress &&
      !game.landing
    ) {
      const fr = r[this.menuFocus];
      ctx.save();
      ctx.strokeStyle = "#ffd24a";
      ctx.lineWidth = 3;
      this.roundRect(ctx, { x: fr.x - 6, y: fr.y - 6, w: fr.w + 12, h: fr.h + 12 } as Rect, 12);
      ctx.stroke();
      ctx.restore();
    }

    // best
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#8fb8c8";
    ctx.font = "600 15px 'Segoe UI', sans-serif";
    ctx.fillText(`Best run: ${game.best} waves`, CANVAS_W / 2, CANVAS_H - 40);
    ctx.restore();

    if (game._showArmory && this.suppressedPanel !== "armory") this.drawArmory(game, ctx);
    else if (game._showCodex && this.suppressedPanel !== "codex") this.drawCodex(game, ctx);
    else if (game._showProgress && this.suppressedPanel !== "progress") this.drawProgress(game, ctx);
    else if (game._showHelp && this.suppressedPanel !== "help") this.drawHelp(ctx);

    // tooltips go on top of everything (menu + codex + armory)
    this.drawTooltip(game, ctx);
  }

  private time(game: Game) {
    return game.time;
  }

  private drawHelp(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "#04141a";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = "#eaf6ff";
    ctx.textAlign = "left";
    const lines = [
      "HOW TO PLAY",
      "",
      "• Enemies march from the top toward your castle.",
      "• Click a tower in the bottom bar, then click a green spot to build.",
      `• Click an empty pad to relocate it to any grass cell for ${SPOT_MOVE_COST}g (right-click cancels).`,
      "• Click a built tower to Upgrade or Sell it.",
      "• Survive the wave, then pick 1 of 3 random Boons (upgrades).",
      "• The island grows every 5 waves — new land, a longer route, more spots.",
      "• At +3 upgrades a tower can Specialize: pick one of three lines, then level it.",
      "• Barracks muster soldiers who march the road and hold it against ground foes.",
      "• Unlock new towers and stack powers to go deeper.",
      "• Every cleared wave banks ◆ runes and supply crates (a lost run keeps them; winning pays +40 ◆ / +20 crates).",
      "• Spend runes in The Codex on relics (Crate Fortune research shifts Supply Crate odds — each level takes real time) — and open crates in the Armory for gear.",
      "",
      "Keys: 1-8 build · Space start wave · P pause · F speed · M mute · ＋/− zoom · Esc cancel",
      "Mouse: drag the map to slide around · wheel or the side-panel ＋/− buttons to zoom",
      "",
      "Click anywhere to close.",
    ];
    ctx.font = "700 22px 'Segoe UI', sans-serif";
    let y = 120;
    for (const ln of lines) {
      ctx.fillStyle =
        ln.startsWith("HOW") ? "#ffd24a" : ln.startsWith("Keys") || ln.startsWith("Mouse") ? "#8fd0ff" : "#dcecf4";
      ctx.fillText(ln, 120, y);
      y += 30;
    }
    ctx.restore();
  }

  handleMenuClick(game: Game, p: { x: number; y: number }): void {
    if (game._showArmory) {
      this.handleArmoryClick(game, p);
      return;
    }
    if (game._showCodex) {
      this.handleCodexClick(game, p);
      return;
    }
    if (game._showProgress) {
      this.handleProgressClick(game, p);
      return;
    }
    if (game._showHelp) {
      game._showHelp = false;
      game.sfx("click");
      return;
    }
    const r = this.menuRects();
    if (inRect(p, r.start)) {
      game.startRun();
      return;
    }
    if (inRect(p, r.help)) {
      game._showHelp = true;
      game.sfx("click");
      return;
    }
    if (inRect(p, r.codex)) {
      game._showCodex = true;
      game.sfx("click");
      return;
    }
    if (inRect(p, r.armory)) {
      game._showArmory = true;
      this.selectedGearUid = null;
      this.armoryPage = 0;
      this.armoryTab = "vault";
      this.smithPageRecycle = 0;
      this.smithPageUpgrade = 0;
      game.sfx("click");
      return;
    }
    if (inRect(p, r.progress)) {
      game._showProgress = true;
      this.progressTab = "ach";
      this.progressAchPage = 0;
      game.sfx("click");
    }
  }

  // ------------------------------------------------- menu keyboard (Phase 2)

  /** Open a menu sub-panel. Mirrors handleMenuClick's open branches so the
   *  DOM/keyboard entry points behave exactly like canvas clicks. */
  openPanel(game: Game, id: "help" | "codex" | "armory" | "progress"): void {
    if (id === "help") {
      game._showHelp = true;
    } else if (id === "codex") {
      game._showCodex = true;
    } else if (id === "armory") {
      game._showArmory = true;
      this.selectedGearUid = null;
      this.armoryPage = 0;
      this.armoryTab = "vault";
      this.smithPageRecycle = 0;
      this.smithPageUpgrade = 0;
    } else {
      game._showProgress = true;
      this.progressTab = "ach";
      this.progressAchPage = 0;
    }
  }

  /** Close whichever menu sub-panel is open (Escape / DOM "close"). */
  closePanel(game: Game): void {
    if (game._showHelp) {
      game._showHelp = false;
    } else if (game._showCodex) {
      game._showCodex = false;
    } else if (game._showArmory) {
      game._showArmory = false;
      this.selectedGearUid = null;
      this.crateReveal = null;
    } else if (game._showProgress) {
      game._showProgress = false;
    }
  }

  /** Page the open panel's primary list (arrow keys). No-op where the panel
   *  has no paging (help, codex, or a non-achievements progress tab). */
  panelPage(game: Game, dir: 1 | -1): void {
    if (game._showArmory) {
      const L = this.armoryLayout(game);
      if (this.armoryTab === "smith") {
        // Arrows page the Recycle list; the Upgrade list keeps its own paging.
        this.smithPageRecycle = Math.min(L.rPages - 1, Math.max(0, this.smithPageRecycle + dir));
      } else {
        this.armoryPage = Math.min(L.pages - 1, Math.max(0, this.armoryPage + dir));
      }
    } else if (game._showProgress && this.progressTab === "ach") {
      const L = this.progressLayout(game);
      this.progressAchPage = Math.min(L.achPages - 1, Math.max(0, this.progressAchPage + dir));
    }
  }

  /** Cycle the open panel's tabs (PageUp/PageDown). Returns an announceable
   *  message when the tab changed, else null. */
  panelTab(game: Game, dir: 1 | -1): string | null {
    if (game._showArmory) {
      const next = this.armoryTab === "vault" ? (dir > 0 ? "smith" : "vault") : dir > 0 ? "vault" : "smith";
      if (next === this.armoryTab) return null;
      this.armoryTab = next;
      this.selectedGearUid = null;
      this.crateReveal = null;
      return next === "vault" ? "Armory: Vault tab" : "Armory: Blacksmith tab";
    }
    if (game._showProgress) {
      const order: { id: ProgressTab; label: string }[] = [
        { id: "ach", label: "Achievements" },
        { id: "daily", label: "Daily" },
        { id: "weekly", label: "Weekly" },
        { id: "bounty", label: "Bounty" },
        { id: "rewards", label: "Rewards" },
      ];
      const i = order.findIndex((t) => t.id === this.progressTab);
      const n = order[(i + dir + order.length) % order.length];
      if (n.id === this.progressTab) return null;
      this.progressTab = n.id;
      this.progressAchPage = 0;
      return `${n.label} tab`;
    }
    return null;
  }

  private overRects() {
    const w = 240;
    const h = 56;
    return {
      again: { x: CANVAS_W / 2 - w / 2, y: CANVAS_H / 2 + 90, w, h } as Rect,
      menu: { x: CANVAS_W / 2 - w / 2, y: CANVAS_H / 2 + 158, w, h } as Rect,
    };
  }

  drawOver(game: Game, ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = "#04141a";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.restore();

    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#ff6a5a";
    ctx.font = "900 52px 'Segoe UI', sans-serif";
    ctx.fillText("THE CASTLE HAS FALLEN", CANVAS_W / 2, CANVAS_H / 2 - 90);
    ctx.fillStyle = "#eaf6ff";
    ctx.font = "700 26px 'Segoe UI', sans-serif";
    ctx.fillText(`You survived ${game.wave} waves`, CANVAS_W / 2, CANVAS_H / 2 - 20);
    ctx.fillStyle = "#bfe6ef";
    ctx.font = "600 18px 'Segoe UI', sans-serif";
    ctx.fillText(`${game.kills} enemies slain`, CANVAS_W / 2, CANVAS_H / 2 + 16);
    const isBest = game.wave >= game.best && game.wave > 0;
    ctx.fillStyle = isBest ? "#ffd24a" : "#8fb8c8";
    ctx.font = "700 18px 'Segoe UI', sans-serif";
    ctx.fillText(`${isBest ? "★ NEW BEST!  " : ""}Best: ${game.best} waves`, CANVAS_W / 2, CANVAS_H / 2 + 50);
    if (game.wave > SIEGE_WAVE) {
      ctx.fillStyle = "#ffd24a";
      ctx.font = "600 14px 'Segoe UI', sans-serif";
      ctx.fillText(`${game.wave - SIEGE_WAVE} waves survived past the Siege`, CANVAS_W / 2, CANVAS_H / 2 + 76);
    }
    ctx.restore();

    const r = this.overRects();
    this.button(ctx, r.again, "⚔  Play Again", { bg: "#c98a2e", fg: "#1a1206", active: true });
    this.button(ctx, r.menu, "Main Menu", { small: true });
  }

  handleOverClick(game: Game, p: { x: number; y: number }): boolean {
    const r = this.overRects();
    if (inRect(p, r.again)) {
      game.startRun();
      return true;
    }
    if (inRect(p, r.menu)) {
      game.screen = "menu";
      game._showHelp = false;
      game.sfx("click");
      return true;
    }
    return true;
  }

  // ------------------------------------------------------------- victory
  private victoryRects() {
    const w = 320;
    const h = 58;
    return {
      again: { x: CANVAS_W / 2 - w / 2, y: CANVAS_H / 2 + 60, w, h } as Rect,
      menu: { x: CANVAS_W / 2 - w / 2, y: CANVAS_H / 2 + 132, w, h } as Rect,
    };
  }

  private drawVictory(game: Game, ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = "#0a1a10";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.restore();

    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffd24a";
    ctx.font = "900 52px 'Segoe UI', sans-serif";
    ctx.fillText("THE SIEGE IS BROKEN!", CANVAS_W / 2, CANVAS_H / 2 - 90);
    ctx.fillStyle = "#eaf6ff";
    ctx.font = "700 22px 'Segoe UI', sans-serif";
    ctx.fillText("The full boss assault is repelled.", CANVAS_W / 2, CANVAS_H / 2 - 42);
    ctx.fillStyle = "#bfe6ef";
    ctx.font = "600 18px 'Segoe UI', sans-serif";
    ctx.fillText(`${game.kills} enemies slain  ·  +${VICTORY_RUNES} ◆  ·  +${VICTORY_CRATES} crates banked`, CANVAS_W / 2, CANVAS_H / 2);
    ctx.fillStyle = "#c58bff";
    ctx.font = "700 18px 'Segoe UI', sans-serif";
    ctx.fillText(`Relic vault: ${game.meta.runes} ◆  ·  ${game.meta.crates} crates`, CANVAS_W / 2, CANVAS_H / 2 + 28);
    ctx.restore();

    const r = this.victoryRects();
    this.button(ctx, r.again, "⚔  Keep Defending (Endless)", { bg: "#c98a2e", fg: "#1a1206", active: true });
    this.button(ctx, r.menu, "Bank Runes & Menu", { small: true });

    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#8fb8c8";
    ctx.font = "600 13px 'Segoe UI', sans-serif";
    ctx.fillText(
      `No end past here — the island stops growing, but Elite reinforcements join every ${ENDLESS_ELITE_INTERVAL} waves.`,
      CANVAS_W / 2,
      r.menu.y + r.menu.h + 30
    );
    ctx.restore();
  }

  handleVictoryClick(game: Game, p: { x: number; y: number }): boolean {
    const r = this.victoryRects();
    if (inRect(p, r.again)) {
      game.continueEndless();
      game.sfx("click");
      return true;
    }
    if (inRect(p, r.menu)) {
      game.screen = "menu";
      game._showHelp = false;
      game.sfx("click");
      return true;
    }
    return true;
  }

  // ------------------------------------------------------------- codex (meta)
  private codexLayout() {
    const panel = { x: 446, y: 80, w: 1140, h: 860 } as Rect;
    const header = { x: 486, y: 108, w: 1060, h: 176 } as Rect;
    // One column per research branch, its nodes stacked top-to-bottom in
    // prerequisite order — node i unlocks once node i-1 is maxed.
    const colW = 255,
      colGap = 16,
      rowH = 88,
      rowGap = 10,
      x0 = 470,
      y0 = 328;
    const branchHeaders: { name: string; x: number; y: number }[] = [];
    const rows: { id: string; branchId: string; rect: Rect; buy: Rect }[] = [];
    RELIC_BRANCHES.forEach((branch, col) => {
      const colX = x0 + col * (colW + colGap);
      branchHeaders.push({ name: branch.name, x: colX + colW / 2, y: y0 - 22 });
      branch.nodeIds.forEach((id, row) => {
        const rect = { x: colX, y: y0 + row * (rowH + rowGap), w: colW, h: rowH } as Rect;
        rows.push({
          id,
          branchId: branch.id,
          rect,
          buy: { x: rect.x + rect.w - 100, y: rect.y + rect.h - 34, w: 92, h: 28 } as Rect,
        });
      });
    });
    const close = { x: CANVAS_W / 2 - 110, y: 828, w: 220, h: 52 } as Rect;
    return { panel, header, branchHeaders, rows, close };
  }

  /**
   * Stretch just the center tile of a 3×3 UI sheet (clean parchment fill —
   * good for small rows where the burnt edge bands would dominate).
   */
  private uiCenter(ctx: CanvasRenderingContext2D, def: StaticDef, x: number, y: number, w: number, h: number): void {
    const img = this.assets.img(def.image);
    if (!img) {
      ctx.fillStyle = "#0c1c26";
      ctx.fillRect(x, y, w, h);
      return;
    }
    ctx.drawImage(img, x, y, w, h);
  }

  /**
   * Nine-slice one of the 3×3 UI sheets (banner / paper / buttons).
   * Corner tiles get a fixed target size; edges and center stretch.
   */
  private uiNine(
    ctx: CanvasRenderingContext2D,
    def: StaticDef,
    x: number,
    y: number,
    w: number,
    h: number,
    cw: number,
    ch: number
  ): void {
    const img = this.assets.img(def.image);
    if (!img) {
      ctx.fillStyle = "#0c1c26";
      ctx.fillRect(x, y, w, h);
      return;
    }
    const sx = [0, Math.round(img.width / 3), Math.round((2 * img.width) / 3), img.width];
    const sy = [0, Math.round(img.height / 3), Math.round((2 * img.height) / 3), img.height];
    const dx = [x, x + cw, x + w - cw, x + w];
    const dy = [y, y + ch, y + h - ch, y + h];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        ctx.drawImage(
          img,
          sx[c], sy[r], sx[c + 1] - sx[c], sy[r + 1] - sy[r],
          dx[c], dy[r], dx[c + 1] - dx[c], dy[r + 1] - dy[r]
        );
      }
    }
  }

  private drawCodex(game: Game, ctx: CanvasRenderingContext2D): void {
    const L = this.codexLayout();
    const u = this.assets.manifest.ui;
    const relicIcons = this.assets.manifest.relic_icons ?? {};

    // backdrop
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = "#06121a";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.restore();

    // panel — plain center fill, then the sheet's corner brackets + edge
    // accents placed at native size (the tiles are discrete, not 9-slice)
    this.uiCenter(ctx, u.paper_special_center ?? u.paper_special, L.panel.x, L.panel.y, L.panel.w, L.panel.h);
    const place = (def: StaticDef | undefined, x: number, y: number) => {
      if (!def) return;
      const im = this.assets.img(def.image);
      if (im) ctx.drawImage(im, x, y);
    };
    const tw = (def: StaticDef | undefined) => def?.size[0] ?? 0;
    const th = (def: StaticDef | undefined) => def?.size[1] ?? 0;
    const P = L.panel;
    place(u.ps_corner_tl, P.x, P.y);
    place(u.ps_corner_tr, P.x + P.w - tw(u.ps_corner_tr), P.y);
    place(u.ps_corner_bl, P.x, P.y + P.h - th(u.ps_corner_bl));
    place(u.ps_corner_br, P.x + P.w - tw(u.ps_corner_br), P.y + P.h - th(u.ps_corner_br));
    place(u.ps_edge_t, P.x + (P.w - tw(u.ps_edge_t)) / 2, P.y);
    place(u.ps_edge_b, P.x + (P.w - tw(u.ps_edge_b)) / 2, P.y + P.h - th(u.ps_edge_b));
    place(u.ps_edge_l, P.x, P.y + (P.h - th(u.ps_edge_l)) / 2);
    place(u.ps_edge_r, P.x + P.w - tw(u.ps_edge_r), P.y + (P.h - th(u.ps_edge_r)) / 2);

    // header — parchment
    this.uiNine(ctx, u.banner_slots, L.header.x, L.header.y, L.header.w, L.header.h, 64, 56);

    // header text (dark ink on parchment)
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#4a2f14";
    ctx.font = "900 38px 'Segoe UI', sans-serif";
    ctx.fillText("THE CODEX", CANVAS_W / 2, L.header.y + 66);
    ctx.fillStyle = "#6a3fa0";
    ctx.font = "800 22px 'Segoe UI', sans-serif";
    ctx.fillText(`◆ ${game.meta.runes}  runes`, CANVAS_W / 2, L.header.y + 106);
    ctx.fillStyle = "#5a4632";
    ctx.font = "600 14px 'Segoe UI', sans-serif";
    ctx.fillText("Spend runes on relics that carry over between sieges — research takes real time.", CANVAS_W / 2, L.header.y + 140);
    ctx.restore();

    // branch column headers
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#6a3fa0";
    ctx.font = "800 15px 'Segoe UI', sans-serif";
    for (const h of L.branchHeaders) ctx.fillText(h.name.toUpperCase(), h.x, h.y);
    ctx.restore();

    for (const row of L.rows) {
      const relic = RELICS.find((r) => r.id === row.id)!;
      const lvl = relicLevel(game.meta, relic.id);
      const maxed = lvl >= relic.maxLevel;
      const cost = relic.cost(lvl);
      const job = game.meta.research;
      const researching = !!job && job.id === relic.id;
      const unlocked = relicPrereqMet(game.meta, relic.id);
      const canBuy = unlocked && !maxed && !job && game.meta.runes >= cost;
      const r = row.rect;

      // row — clean parchment fill (cropped center tile) + ink border
      ctx.save();
      if (!unlocked) ctx.globalAlpha = 0.55;
      this.uiCenter(ctx, u.paper_center ?? u.paper, r.x, r.y, r.w, r.h);
      ctx.strokeStyle = "rgba(58,42,24,0.4)";
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      ctx.restore();

      ctx.save();
      if (!unlocked) ctx.globalAlpha = 0.55;

      // relic icon (repurposed RPG icon pack art)
      const iconPath = relicIcons[relic.id];
      if (iconPath) {
        const im = this.assets.img(iconPath);
        if (im) ctx.drawImage(im, r.x + 8, r.y + 8, 34, 34);
      }

      ctx.textAlign = "left";
      ctx.fillStyle = "#3a2a18";
      const ns = this.fitSize(relic.name, "700", 15, 11, r.w - 50 - 8);
      ctx.font = `700 ${ns}px 'Segoe UI', sans-serif`;
      ctx.fillText(relic.name, r.x + 50, r.y + 22);

      if (unlocked) {
        const effText = researching
          ? `Researching lvl ${job!.level} — ${fmtDuration(Math.max(0, job!.completesAt - Date.now()))} left`
          : lvl > 0
            ? relic.effect(lvl)
            : relic.blurb;
        ctx.fillStyle = researching ? "#b3541e" : lvl > 0 ? "#8a5a10" : "rgba(58,42,24,0.55)";
        const es = this.fitSize(effText, "600", 12, 9, r.w - 58);
        ctx.font = `600 ${es}px 'Segoe UI', sans-serif`;
        ctx.fillText(effText, r.x + 50, r.y + 42);

        // level pips
        for (let i = 0; i < relic.maxLevel; i++) {
          ctx.beginPath();
          ctx.arc(r.x + 54 + i * 13, r.y + 58, 4, 0, Math.PI * 2);
          ctx.fillStyle = i < lvl ? "#c98a2e" : "rgba(58,42,24,0.18)";
          ctx.fill();
        }
      } else {
        const prereq = relicPrereqOf(relic.id);
        ctx.fillStyle = "rgba(58,42,24,0.6)";
        const lockText = `🔒 Max ${prereq?.name ?? "prior relic"} to unlock`;
        const ls = this.fitSize(lockText, "600", 12, 9, r.w - 58);
        ctx.font = `600 ${ls}px 'Segoe UI', sans-serif`;
        ctx.fillText(lockText, r.x + 50, r.y + 46);
      }
      ctx.restore();

      // buy button — teal 9-slice
      if (unlocked) {
        ctx.save();
        if (!canBuy) ctx.globalAlpha = 0.55;
        this.uiNine(ctx, u.buttons.sq_blue, row.buy.x, row.buy.y, row.buy.w, row.buy.h, 16, 10);
        ctx.globalAlpha = 1;
        ctx.textAlign = "center";
        ctx.fillStyle = "#0f2a33";
        const label = maxed
          ? "MAX"
          : researching
            ? `${fmtDuration(Math.max(0, job!.completesAt - Date.now()))} left`
            : relic.research
              ? `Buy ${cost} ◆ · ${fmtDuration(relic.research(lvl))}`
              : `Buy ${cost} ◆`;
        ctx.font = `800 ${this.fitSize(label, "800", 14, 10, row.buy.w - 10)}px 'Segoe UI', sans-serif`;
        ctx.fillText(label, row.buy.x + row.buy.w / 2, row.buy.y + row.buy.h / 2 + 5);
        ctx.restore();
      }
    }

    // close
    this.uiNine(ctx, u.buttons.sq_blue, L.close.x, L.close.y, L.close.w, L.close.h, 24, 14);
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#0f2a33";
    ctx.font = "800 18px 'Segoe UI', sans-serif";
    ctx.fillText("Close", L.close.x + L.close.w / 2, L.close.y + L.close.h / 2 + 6);
    ctx.restore();
  }

  handleCodexClick(game: Game, p: { x: number; y: number }): boolean {
    const L = this.codexLayout();
    if (inRect(p, L.close)) {
      game._showCodex = false;
      game.sfx("click");
      return true;
    }
    for (const row of L.rows) {
      if (inRect(p, row.buy)) {
        if (game.buyRelic(row.id)) game.sfx("coin");
        else game.sfx("click");
        return true;
      }
    }
    return true;
  }

  // ------------------------------------------------------- progress screen
  private rewardText(r: Reward): string {
    const parts: string[] = [];
    if (r.runes) parts.push(`${r.runes} ◆`);
    if (r.crates) parts.push(`${r.crates} crate${r.crates === 1 ? "" : "s"}`);
    if (r.scrap) parts.push(`${r.scrap} scrap`);
    return parts.join(" · ");
  }

  /** Like button(), but shrinks the label to fit — reward pills vary a lot
   *  in length ("5 ◆" vs "60 ◆ · 15 crates · 30 scrap"). */
  private claimButton(ctx: CanvasRenderingContext2D, r: Rect, label: string, state: "ready" | "claimed" | "locked"): void {
    ctx.save();
    this.roundRect(ctx, r, 7);
    ctx.fillStyle = state === "ready" ? "#e8b23c" : state === "claimed" ? "rgba(111,224,111,0.16)" : "rgba(60,70,80,0.7)";
    ctx.fill();
    ctx.strokeStyle = state === "ready" ? "#fff0c0" : state === "claimed" ? "rgba(111,224,111,0.45)" : "rgba(150,200,220,0.4)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = state === "ready" ? "#1a1206" : state === "claimed" ? "#8fe08f" : "rgba(200,210,220,0.6)";
    const size = this.fitSize(label, "700", 13, 9, r.w - 14);
    ctx.font = `700 ${size}px 'Segoe UI', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
    ctx.restore();
  }

  private progressLayout(game: Game) {
    const panel = { x: 60, y: 64, w: CANVAS_W - 120, h: 648 } as Rect;
    const close = { x: CANVAS_W / 2 - 110, y: 648, w: 220, h: 52 } as Rect;

    const tabDefs: { id: ProgressTab; label: string }[] = [
      { id: "ach", label: "ACHIEVEMENTS" },
      { id: "daily", label: "DAILY" },
      { id: "weekly", label: "WEEKLY" },
      { id: "bounty", label: "BOUNTY" },
      { id: "rewards", label: "REWARDS" },
    ];
    const tabW = 190,
      tabGap = 12,
      tabY = 164,
      tabH = 32;
    const tabsTotalW = tabDefs.length * tabW + (tabDefs.length - 1) * tabGap;
    const tabX0 = CANVAS_W / 2 - tabsTotalW / 2;
    const tabs = tabDefs.map((t, i) => ({
      id: t.id,
      label: t.label,
      rect: { x: tabX0 + i * (tabW + tabGap), y: tabY, w: tabW, h: tabH } as Rect,
    }));

    const topY = 260;
    const rowW = CANVAS_W - 120 - 180;
    const rowX = (CANVAS_W - rowW) / 2;
    const rowH = 62,
      rowGap = 12;
    const rowRect = (i: number) => ({ x: rowX, y: topY + i * (rowH + rowGap), w: rowW, h: rowH } as Rect);
    const claimRect = (r: Rect) => ({ x: r.x + r.w - 216, y: r.y + (r.h - 34) / 2, w: 200, h: 34 } as Rect);

    const achPerPage = 4;
    const achPages = Math.max(1, Math.ceil(ACHIEVEMENTS.length / achPerPage));
    const achPage = Math.min(Math.max(0, this.progressAchPage), achPages - 1);
    const achRows = ACHIEVEMENTS.slice(achPage * achPerPage, (achPage + 1) * achPerPage).map((def, i) => {
      const rect = rowRect(i);
      return { def, rect, claim: claimRect(rect) };
    });
    const achPrev = { x: rowX, y: topY + achPerPage * (rowH + rowGap) + 4, w: 96, h: 40 } as Rect;
    const achNext = { x: rowX + rowW - 96, y: achPrev.y, w: 96, h: 40 } as Rect;

    const missionRows = (list: MissionInstance[]) =>
      list.map((inst, i) => {
        const rect = rowRect(i);
        return { inst, def: missionDef(inst.defId)!, rect, claim: claimRect(rect) };
      });
    const dailyRows = missionRows(game.progress.daily.missions);
    const weeklyRows = missionRows(game.progress.weekly.missions);
    const bountyRows = missionRows(game.progress.bounty);

    // rewards: a 7-cell login-streak calendar
    const cellW = 170,
      cellGap = 14;
    const cellsTotalW = 7 * cellW + 6 * cellGap;
    const cellX0 = (CANVAS_W - cellsTotalW) / 2;
    const cells = LOGIN_REWARDS.map((reward, i) => ({
      day: i + 1,
      reward,
      rect: { x: cellX0 + i * (cellW + cellGap), y: topY, w: cellW, h: 140 } as Rect,
    }));
    const claimLogin = { x: CANVAS_W / 2 - 130, y: topY + 172, w: 260, h: 52 } as Rect;

    return { panel, close, tabs, achRows, achPrev, achNext, achPage, achPages, dailyRows, weeklyRows, bountyRows, cells, claimLogin };
  }

  private drawProgress(game: Game, ctx: CanvasRenderingContext2D): void {
    const L = this.progressLayout(game);
    ctx.save();
    ctx.globalAlpha = 0.97;
    ctx.fillStyle = "#08131a";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.restore();

    ctx.save();
    this.roundRect(ctx, L.panel, 12);
    ctx.fillStyle = "#0c1c26";
    ctx.fill();
    ctx.strokeStyle = "rgba(180,210,225,0.2)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffd24a";
    ctx.font = "900 32px 'Segoe UI', sans-serif";
    ctx.fillText("ACHIEVEMENTS & MISSIONS", CANVAS_W / 2, 112);
    ctx.fillStyle = "#8fb8c8";
    ctx.font = "600 14px 'Segoe UI', sans-serif";
    const tab = this.progressTab;
    const subtitle =
      tab === "ach"
        ? "Lifetime goals — claim once, forever banked."
        : tab === "daily"
          ? "Resets every day. Unclaimed progress expires at reset."
          : tab === "weekly"
            ? "Resets every week. Unclaimed progress expires at reset."
            : tab === "bounty"
              ? "No reset — claim it, then go do it again."
              : "Come back once a day for a reward. Miss a day and the streak resets.";
    ctx.fillText(subtitle, CANVAS_W / 2, 138);
    ctx.restore();

    for (const t of L.tabs) this.drawArmoryTab(ctx, t.rect, t.label, tab === t.id);

    if (tab === "ach") this.drawAchievementRows(game, ctx, L);
    else if (tab === "rewards") this.drawRewardCells(game, ctx, L);
    else this.drawMissionRows(game, ctx, tab === "daily" ? L.dailyRows : tab === "weekly" ? L.weeklyRows : L.bountyRows);

    this.button(ctx, L.close, "Close", { small: true });
  }

  private drawAchievementRows(game: Game, ctx: CanvasRenderingContext2D, L: ReturnType<Hud["progressLayout"]>): void {
    for (const row of L.achRows) {
      const def = row.def;
      const cur = achievementProgress(game.progress, def);
      const claimed = isAchievementClaimed(game.progress, def.id);
      const complete = cur >= def.target;
      const r = row.rect;
      this.panel(ctx, r);
      ctx.save();
      ctx.textAlign = "left";
      ctx.fillStyle = "#eaf6ff";
      ctx.font = "700 16px 'Segoe UI', sans-serif";
      ctx.fillText(def.name, r.x + 16, r.y + 22);
      ctx.fillStyle = "#8fb8c8";
      ctx.font = "600 12px 'Segoe UI', sans-serif";
      ctx.fillText(def.desc, r.x + 16, r.y + 40);
      ctx.restore();

      const barW = r.w - 32 - 232;
      this.bar(ctx, r.x + 16, r.y + 46, barW, 9, cur / def.target, claimed ? "#6fe06f" : complete ? "#ffd24a" : "#4a90b8");
      ctx.save();
      ctx.textAlign = "right";
      ctx.fillStyle = "#cfe3f5";
      ctx.font = "600 11px 'Segoe UI', sans-serif";
      ctx.fillText(`${cur.toLocaleString()} / ${def.target.toLocaleString()}`, r.x + 16 + barW, r.y + 42);
      ctx.restore();

      const label = claimed ? "Claimed" : complete ? `Claim ${this.rewardText(def.reward)}` : this.rewardText(def.reward);
      this.claimButton(ctx, row.claim, label, claimed ? "claimed" : complete ? "ready" : "locked");
    }
    if (L.achPages > 1) {
      this.button(ctx, L.achPrev, "◀ Prev", { small: true, disabled: L.achPage === 0 });
      this.button(ctx, L.achNext, "Next ▶", { small: true, disabled: L.achPage >= L.achPages - 1 });
      ctx.save();
      ctx.textAlign = "center";
      ctx.fillStyle = "#8fb8c8";
      ctx.font = "600 13px 'Segoe UI', sans-serif";
      ctx.fillText(`Page ${L.achPage + 1} / ${L.achPages}`, CANVAS_W / 2, L.achPrev.y + 26);
      ctx.restore();
    }
  }

  private drawMissionRows(
    game: Game,
    ctx: CanvasRenderingContext2D,
    rows: { inst: MissionInstance; def: MissionDef; rect: Rect; claim: Rect }[]
  ): void {
    for (const row of rows) {
      const cur = missionProgress(game.progress, row.def, row.inst);
      const complete = cur >= row.def.amount;
      const r = row.rect;
      this.panel(ctx, r);
      ctx.save();
      ctx.textAlign = "left";
      ctx.fillStyle = "#eaf6ff";
      ctx.font = "700 16px 'Segoe UI', sans-serif";
      ctx.fillText(row.def.name, r.x + 16, r.y + 26);
      ctx.restore();

      const barW = r.w - 32 - 232;
      this.bar(ctx, r.x + 16, r.y + 38, barW, 9, cur / row.def.amount, row.inst.claimed ? "#6fe06f" : complete ? "#ffd24a" : "#4a90b8");
      ctx.save();
      ctx.textAlign = "right";
      ctx.fillStyle = "#cfe3f5";
      ctx.font = "600 11px 'Segoe UI', sans-serif";
      ctx.fillText(`${cur} / ${row.def.amount}`, r.x + 16 + barW, r.y + 34);
      ctx.restore();

      const label = row.inst.claimed ? "Claimed" : complete ? `Claim ${this.rewardText(row.def.reward)}` : this.rewardText(row.def.reward);
      this.claimButton(ctx, row.claim, label, row.inst.claimed ? "claimed" : complete ? "ready" : "locked");
    }
  }

  private drawRewardCells(game: Game, ctx: CanvasRenderingContext2D, L: ReturnType<Hud["progressLayout"]>): void {
    const streak = game.progress.login.streakDay;
    const claimable = canClaimLogin(game.progress);
    const nextDay = claimable ? (isYesterday(game.progress.login.lastClaimDate, todayKey()) ? (streak % 7) + 1 : 1) : streak;
    for (const cell of L.cells) {
      const isToday = claimable && cell.day === nextDay;
      const isPast = !isToday && cell.day <= streak;
      this.panel(ctx, cell.rect);
      if (isToday) {
        ctx.save();
        this.roundRect(ctx, cell.rect, 8);
        ctx.strokeStyle = "#ffd24a";
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      ctx.textAlign = "center";
      ctx.fillStyle = isPast ? "#6fe06f" : isToday ? "#ffd24a" : "#8fb8c8";
      ctx.font = "800 15px 'Segoe UI', sans-serif";
      ctx.fillText(cell.day === 7 ? "DAY 7 ★" : `DAY ${cell.day}`, cell.rect.x + cell.rect.w / 2, cell.rect.y + 26);
      ctx.fillStyle = "#eaf6ff";
      ctx.font = "700 14px 'Segoe UI', sans-serif";
      ctx.fillText(this.rewardText(cell.reward), cell.rect.x + cell.rect.w / 2, cell.rect.y + 56);
      if (isPast) {
        ctx.fillStyle = "#6fe06f";
        ctx.font = "700 20px 'Segoe UI', sans-serif";
        ctx.fillText("✓", cell.rect.x + cell.rect.w / 2, cell.rect.y + 92);
      }
      ctx.restore();
    }
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#8fb8c8";
    ctx.font = "600 14px 'Segoe UI', sans-serif";
    ctx.fillText(`Current streak: day ${streak || 0}`, CANVAS_W / 2, L.claimLogin.y - 20);
    ctx.restore();
    this.button(ctx, L.claimLogin, claimable ? "Claim Today's Reward" : "Already claimed today", {
      bg: "#c98a2e",
      fg: "#1a1206",
      active: claimable,
      disabled: !claimable,
    });
  }

  handleProgressClick(game: Game, p: { x: number; y: number }): boolean {
    const L = this.progressLayout(game);
    if (inRect(p, L.close)) {
      game._showProgress = false;
      game.sfx("click");
      return true;
    }
    for (const t of L.tabs) {
      if (inRect(p, t.rect)) {
        this.progressTab = t.id;
        this.progressAchPage = 0;
        game.sfx("click");
        return true;
      }
    }
    const tab = this.progressTab;
    if (tab === "ach") {
      if (L.achPages > 1) {
        if (inRect(p, L.achPrev)) {
          this.progressAchPage = Math.max(0, L.achPage - 1);
          game.sfx("click");
          return true;
        }
        if (inRect(p, L.achNext)) {
          this.progressAchPage = Math.min(L.achPages - 1, L.achPage + 1);
          game.sfx("click");
          return true;
        }
      }
      for (const row of L.achRows) {
        if (inRect(p, row.claim)) {
          if (game.claimAchievement(row.def.id)) game.sfx("coin");
          else game.sfx("click");
          return true;
        }
      }
    } else if (tab === "daily" || tab === "weekly" || tab === "bounty") {
      const rows = tab === "daily" ? L.dailyRows : tab === "weekly" ? L.weeklyRows : L.bountyRows;
      for (const row of rows) {
        if (inRect(p, row.claim)) {
          if (game.claimMission(tab, row.def.id)) game.sfx("coin");
          else game.sfx("click");
          return true;
        }
      }
    } else if (tab === "rewards") {
      if (inRect(p, L.claimLogin)) {
        if (game.claimLoginReward()) game.sfx("coin");
        else game.sfx("click");
        return true;
      }
    }
    return true;
  }

  // ------------------------------------------------------------- armory
  private armoryLayout(game: Game) {
    // topY starts low enough that the section labels (topY-14) clear the tab
    // row (164-196) and the hint line above them (baseline 216).
    const topY = 260;
    const close = { x: CANVAS_W / 2 - 110, y: 648, w: 220, h: 52 } as Rect;
    const vaultTab = { x: CANVAS_W / 2 - 210, y: 164, w: 200, h: 32 } as Rect;
    const smithTab = { x: CANVAS_W / 2 + 10, y: 164, w: 200, h: 32 } as Rect;
    // Supply Crate purchase, in the tab row (visible on both tabs).
    const crateBtn = { x: CANVAS_W / 2 + 240, y: 158, w: 230, h: 44 } as Rect;

    // The vault holds UNEQUIPPED pieces only — equipping moves a piece into
    // its slot (it returns to the vault when unequipped).
    const eqUids = new Set<string>();
    for (const t of TOWER_ORDER) for (const s of GEAR_SLOTS) {
      const u = game.meta.gear.equipped[t]?.[s];
      if (u) eqUids.add(u);
    }
    const sortGear = (a: GearInstance, b: GearInstance) => {
      const da = GEAR_BY_ID.get(a.def)!;
      const db = GEAR_BY_ID.get(b.def)!;
      if (da.tower !== db.tower) return TOWER_ORDER.indexOf(da.tower) - TOWER_ORDER.indexOf(db.tower);
      if (da.slot !== db.slot) return GEAR_SLOTS.indexOf(da.slot) - GEAR_SLOTS.indexOf(db.slot);
      return b.tier - a.tier;
    };
    const vaultList = game.meta.gear.owned
      .filter((o) => GEAR_BY_ID.has(o.def) && !eqUids.has(o.uid))
      .sort(sortGear);
    const upgradeList = game.meta.gear.owned.filter((o) => GEAR_BY_ID.has(o.def)).sort(sortGear);

    // ---- vault tab: 2x4 grid of banked pieces + tower slot columns ----
    const perPage = 8;
    const pages = Math.max(1, Math.ceil(vaultList.length / perPage));
    const page = Math.min(Math.max(0, this.armoryPage), pages - 1);
    const rows = vaultList.slice(page * perPage, (page + 1) * perPage).map((inst, i) => ({
      inst,
      rect: {
        x: 90 + (i % 2) * 360,
        y: topY + Math.floor(i / 2) * 80,
        w: 350,
        h: 74,
      } as Rect,
    }));
    // one column per tower type, sized to fit every tower inside the panel
    // (width adapts to TOWER_ORDER.length so adding a tower never overflows)
    const towerX0 = 830;
    const tgap = 8;
    const tw = Math.floor((CANVAS_W - 72 - towerX0 - (TOWER_ORDER.length - 1) * tgap) / TOWER_ORDER.length);
    const slots: { tower: TowerType; slot: GearSlot; rect: Rect }[] = [];
    TOWER_ORDER.forEach((t, i) => {
      const x = towerX0 + i * (tw + tgap);
      GEAR_SLOTS.forEach((s, j) => {
        slots.push({ tower: t, slot: s, rect: { x, y: topY + j * 100, w: tw, h: 88 } });
      });
    });
    const prev = { x: 90, y: 576, w: 96, h: 44 } as Rect;
    const next = { x: 450, y: 576, w: 96, h: 44 } as Rect;

    // ---- smith tab: recycle grid (left) + upgrade grid (right), 8/page ----
    const rPages = Math.max(1, Math.ceil(vaultList.length / perPage));
    const rPage = Math.min(Math.max(0, this.smithPageRecycle), rPages - 1);
    const rRows = vaultList.slice(rPage * perPage, (rPage + 1) * perPage).map((inst, i) => ({
      inst,
      rect: {
        x: 90 + (i % 2) * 360,
        y: topY + Math.floor(i / 2) * 80,
        w: 350,
        h: 74,
      } as Rect,
    }));
    const rPrev = { x: 90, y: 576, w: 96, h: 44 } as Rect;
    const rNext = { x: 450, y: 576, w: 96, h: 44 } as Rect;

    const uPages = Math.max(1, Math.ceil(upgradeList.length / perPage));
    const uPage = Math.min(Math.max(0, this.smithPageUpgrade), uPages - 1);
    const uRows = upgradeList.slice(uPage * perPage, (uPage + 1) * perPage).map((inst, i) => ({
      inst,
      rect: {
        x: 900 + (i % 2) * 500,
        y: topY + Math.floor(i / 2) * 80,
        w: 490,
        h: 74,
      } as Rect,
    }));
    const uPrev = { x: 900, y: 576, w: 96, h: 44 } as Rect;
    const uNext = { x: 1400, y: 576, w: 96, h: 44 } as Rect;

    return {
      topY, close, vaultTab, smithTab, crateBtn,
      rows, slots, prev, next, page, pages, count: vaultList.length, equippedCount: eqUids.size,
      rRows, rPrev, rNext, rPage, rPages,
      uRows, uPrev, uNext, uPage, uPages,
    };
  }

  private drawArmory(game: Game, ctx: CanvasRenderingContext2D): void {
    const L = this.armoryLayout(game);
    ctx.save();
    ctx.globalAlpha = 0.97;
    ctx.fillStyle = "#08131a";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.restore();

    // panel
    ctx.save();
    this.roundRect(ctx, { x: 60, y: 64, w: CANVAS_W - 120, h: 648 }, 12);
    ctx.fillStyle = "#0c1c26";
    ctx.fill();
    ctx.strokeStyle = "rgba(180,210,225,0.2)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // header
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffd24a";
    ctx.font = "900 34px 'Segoe UI', sans-serif";
    ctx.fillText("THE ARMORY", CANVAS_W / 2, 112);
    ctx.fillStyle = "#8fd0ff";
    ctx.font = "700 20px 'Segoe UI', sans-serif";
    if (this.armoryTab === "vault") {
      const label = `${L.count} piece${L.count === 1 ? "" : "s"} in the vault · ${L.equippedCount} equipped`;
      const tw = this.txtW(label, "700 20px 'Segoe UI', sans-serif");
      const startX = CANVAS_W / 2 - (tw + 40) / 2;
      this.crateIcon(ctx, startX, 129, 19);
      ctx.textAlign = "left";
      ctx.fillText(label, startX + 24, 146);
      ctx.fillStyle = "#d2a24c";
      ctx.fillText(` · ${game.meta.crates} crates`, startX + 24 + tw, 146);
      ctx.textAlign = "center";
    } else {
      const label = `${game.meta.scrap} scrap`;
      const tw = this.txtW(label, "700 20px 'Segoe UI', sans-serif");
      const crateLabel = ` · ${game.meta.crates} crates`;
      const cw = this.txtW(crateLabel, "700 20px 'Segoe UI', sans-serif");
      const startX = CANVAS_W / 2 - (tw + cw + 24) / 2;
      this.scrapIcon(ctx, startX, 129, 19);
      ctx.textAlign = "left";
      ctx.fillText(label, startX + 24, 146);
      ctx.fillStyle = "#d2a24c";
      ctx.fillText(crateLabel, startX + 24 + tw, 146);
      ctx.textAlign = "center";
    }
    ctx.fillStyle = "#8fb8c8";
    ctx.font = "600 14px 'Segoe UI', sans-serif";
    ctx.fillText(
      this.armoryTab === "vault"
        ? "Win gear by opening Supply Crates — clear waves to earn crates. Click a piece, then click its slot to equip. It carries into every siege."
        : "Recycle spare gear for scrap, then spend scrap to upgrade pieces to higher tiers. Equipped pieces can be upgraded in place.",
      CANVAS_W / 2,
      216
    );
    ctx.restore();

    // tab buttons + Supply Crate purchase (both tabs)
    this.drawArmoryTab(ctx, L.vaultTab, "THE VAULT", this.armoryTab === "vault");
    this.drawArmoryTab(ctx, L.smithTab, "THE BLACKSMITH", this.armoryTab === "smith");
    this.button(
      ctx,
      L.crateBtn,
      `Open Supply Crate  ·  ${LOOTBOX_COST}`,
      { active: game.meta.crates >= LOOTBOX_COST, disabled: game.meta.crates < LOOTBOX_COST, small: true, fg: "#1a1206" }
    );
    this.crateIcon(ctx, L.crateBtn.x + 12, L.crateBtn.y + L.crateBtn.h / 2 - 10, 20);

    if (this.armoryTab === "smith") {
      this.drawSmith(game, ctx, L);
      this.button(ctx, L.close, "Close", { small: true });
      return;
    }

    // "VAULT" label
    ctx.save();
    ctx.textAlign = "left";
    ctx.fillStyle = "#bfe6ef";
    ctx.font = "700 16px 'Segoe UI', sans-serif";
    ctx.fillText("VAULT", 90, L.topY - 14);
    ctx.restore();

    // vault rows
    const icons = game.assets.manifest.gear?.icons ?? {};
    for (const row of L.rows) {
      const def = GEAR_BY_ID.get(row.inst.def)!;
      const selected = this.selectedGearUid === row.inst.uid;

      ctx.save();
      this.roundRect(ctx, row.rect, 8);
      ctx.fillStyle = selected ? "rgba(255,210,74,0.12)" : "rgba(255,255,255,0.03)";
      ctx.fill();
      if (selected) {
        ctx.strokeStyle = "#ffd24a";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.restore();

      // icon
      const img = this.assets.img(icons[def.icon]);
      if (img) ctx.drawImage(img, row.rect.x + 12, row.rect.y + 15, 44, 44);

      ctx.save();
      // Name left, tier right-anchored so long names can never collide with it.
      const ns = this.fitSize(def.name, "700", 17, 13, row.rect.w - 70 - 48);
      ctx.textAlign = "left";
      ctx.fillStyle = "#eaf6ff";
      ctx.font = `700 ${ns}px 'Segoe UI', sans-serif`;
      ctx.fillText(def.name, row.rect.x + 70, row.rect.y + 28);
      ctx.fillStyle = TIER_COLORS[row.inst.tier];
      ctx.font = "800 14px 'Segoe UI', sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(`T${row.inst.tier}`, row.rect.x + row.rect.w - 12, row.rect.y + 28);
      // Bonus left, slot/tower right-anchored on the second line.
      ctx.textAlign = "left";
      ctx.fillStyle = "#9fd8a8";
      const bonusTxt = gearBonusText(def, row.inst.tier);
      const bs0 = this.fitSize(bonusTxt, "700", 13, 9, row.rect.w - 70 - 140);
      ctx.font = `700 ${bs0}px 'Segoe UI', sans-serif`;
      ctx.fillText(bonusTxt, row.rect.x + 70, row.rect.y + 50);
      ctx.fillStyle = "#8fb8c8";
      ctx.font = "600 12px 'Segoe UI', sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(`${SLOT_LABEL[def.slot]} · ${TOWER_DEFS[def.tower].name}`, row.rect.x + row.rect.w - 12, row.rect.y + 50);
      ctx.restore();
    }

    // pagination
    this.button(ctx, L.prev, "‹", { small: true, disabled: L.page === 0 });
    this.button(ctx, L.next, "›", { small: true, disabled: L.page >= L.pages - 1 });
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#8fb8c8";
    ctx.font = "600 14px 'Segoe UI', sans-serif";
    ctx.fillText(`${L.page + 1} / ${L.pages}`, (L.prev.x + L.next.x + L.next.w) / 2, L.prev.y + 28);
    ctx.restore();

    // tower columns
    for (const s of L.slots) {
      const x0 = s.rect.x;
      if (s.slot === GEAR_SLOTS[0]) {
        ctx.save();
        ctx.textAlign = "left";
        ctx.fillStyle = "#bfe6ef";
        const label = TOWER_DEFS[s.tower].name.toUpperCase();
        const size = this.fitSize(label, "700", 16, 10, s.rect.w);
        ctx.font = `700 ${size}px 'Segoe UI', sans-serif`;
        ctx.fillText(label, x0, L.topY - 14);
        ctx.restore();
      }
      const cur = game.equippedFor(s.tower, s.slot);
      const def = cur ? GEAR_BY_ID.get(cur.def) : null;

      ctx.save();
      this.roundRect(ctx, s.rect, 8);
      ctx.fillStyle = "rgba(255,255,255,0.03)";
      ctx.fill();
      // highlight slots compatible with the selected piece
      if (this.selectedGearUid) {
        const sel = game.meta.gear.owned.find((o) => o.uid === this.selectedGearUid);
        const selDef = sel ? GEAR_BY_ID.get(sel.def) : null;
        if (selDef && selDef.tower === s.tower && selDef.slot === s.slot) {
          ctx.strokeStyle = "rgba(255,210,74,0.8)";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
      ctx.restore();

      if (def && cur) {
        const img = this.assets.img(icons[def.icon]);
        if (img) ctx.drawImage(img, s.rect.x + 12, s.rect.y + 18, 52, 52);
        ctx.save();
        // Three text lines beside the icon: name (full width), tier, bonus.
        // The name gets the card's full remaining width so long names like
        // "Vanguard Cuirass" are never clipped; it shrinks only if needed.
        const tw = s.rect.w - 80;
        const ns = this.fitSize(def.name, "700", 14, 10, tw);
        ctx.textAlign = "left";
        ctx.fillStyle = "#eaf6ff";
        ctx.font = `700 ${ns}px 'Segoe UI', sans-serif`;
        ctx.fillText(def.name, s.rect.x + 72, s.rect.y + 32);
        ctx.fillStyle = TIER_COLORS[cur.tier];
        ctx.font = "800 13px 'Segoe UI', sans-serif";
        ctx.fillText(`T${cur.tier}`, s.rect.x + 72, s.rect.y + 54);
        ctx.fillStyle = "#9fd8a8";
        const bs = this.fitSize(gearBonusText(def, cur.tier), "700", 12, 9, tw);
        ctx.font = `700 ${bs}px 'Segoe UI', sans-serif`;
        ctx.fillText(gearBonusText(def, cur.tier), s.rect.x + 72, s.rect.y + 73);
        ctx.restore();
      } else {
        ctx.save();
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(180,210,225,0.4)";
        ctx.font = "600 14px 'Segoe UI', sans-serif";
        ctx.fillText(`${SLOT_LABEL[s.slot]} — empty`, s.rect.x + 24, s.rect.y + 50);
        ctx.restore();
      }
    }

    this.button(ctx, L.close, "Close", { small: true });

    // Supply Crate reveal, drawn last so it sits on top of everything.
    if (this.crateReveal) this.drawCrateReveal(game, ctx);
  }

  /** Gacha reveal for the last opened Supply Crate. */
  private drawCrateReveal(game: Game, ctx: CanvasRenderingContext2D): void {
    const inst = this.crateReveal;
    if (!inst) return;
    const def = GEAR_BY_ID.get(inst.def);
    if (!def) {
      this.crateReveal = null;
      return;
    }
    const W = 420;
    const H = 330;
    const x = CANVAS_W / 2 - W / 2;
    const y = CANVAS_H / 2 - H / 2 - 20;
    const tcolor = TIER_COLORS[inst.tier];

    ctx.save();
    ctx.globalAlpha = 0.78;
    ctx.fillStyle = "#05090d";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.restore();

    ctx.save();
    this.roundRect(ctx, { x, y, w: W, h: H }, 12);
    ctx.fillStyle = "#0c1c26";
    ctx.fill();
    ctx.strokeStyle = tcolor;
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.fillStyle = "#d2a24c";
    ctx.font = "800 20px 'Segoe UI', sans-serif";
    ctx.fillText("SUPPLY CRATE OPENED", x + W / 2, y + 38);

    if (inst.tier >= 4) {
      ctx.fillStyle = tcolor;
      ctx.font = "900 24px 'Segoe UI', sans-serif";
      ctx.fillText(inst.tier === 5 ? "★ LEGENDARY DROP ★" : "◆ RARE DROP ◆", x + W / 2, y + 68);
    }

    // icon
    const icons = game.assets.manifest.gear?.icons ?? {};
    const img = this.assets.img(icons[def.icon]);
    if (img) ctx.drawImage(img, x + W / 2 - 48, y + 84, 96, 96);

    ctx.fillStyle = "#eaf6ff";
    ctx.font = "800 24px 'Segoe UI', sans-serif";
    ctx.fillText(def.name, x + W / 2, y + 208);
    ctx.fillStyle = tcolor;
    ctx.font = "900 18px 'Segoe UI', sans-serif";
    ctx.fillText(`TIER ${inst.tier}  ·  ${SLOT_LABEL[def.slot]}`, x + W / 2, y + 236);
    ctx.fillStyle = "#9fd8a8";
    ctx.font = "700 16px 'Segoe UI', sans-serif";
    ctx.fillText(`${gearBonusText(def, inst.tier)} — boosts every ${TOWER_DEFS[def.tower].name}`, x + W / 2, y + 262);
    const locked = nextLockedStat(def, inst.tier);
    let bankedY = y + 296;
    if (locked) {
      ctx.fillStyle = "rgba(159,216,168,0.6)";
      ctx.font = "600 13px 'Segoe UI', sans-serif";
      ctx.fillText(
        `+${gearPercent(locked, locked.unlockTier)}% ${statLabel(def.tower, locked.stat)} unlocks at T${locked.unlockTier}`,
        x + W / 2,
        y + 282
      );
      bankedY = y + 314;
    }
    ctx.fillStyle = "#8fb8c8";
    ctx.font = "600 14px 'Segoe UI', sans-serif";
    ctx.fillText("Banked to your vault — equip it below.", x + W / 2, bankedY);
    ctx.restore();
  }

  private drawArmoryTab(ctx: CanvasRenderingContext2D, r: Rect, label: string, active: boolean): void {
    ctx.save();
    this.roundRect(ctx, r, 7);
    ctx.fillStyle = active ? "rgba(255,210,74,0.14)" : "rgba(255,255,255,0.04)";
    ctx.fill();
    ctx.strokeStyle = active ? "rgba(255,210,74,0.9)" : "rgba(180,210,225,0.25)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillStyle = active ? "#ffd24a" : "#8fb8c8";
    ctx.font = "800 15px 'Segoe UI', sans-serif";
    ctx.fillText(label, r.x + r.w / 2, r.y + 23);
    ctx.restore();
  }

  /** ui/icon_10 — the gear/cog from the UI pack, used as the scrap icon. */
  private scrapIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size = 16): boolean {
    const key = this.assets.manifest.ui.icons[9];
    if (!key) return false;
    const img = this.assets.img(key);
    if (!img) return false;
    ctx.drawImage(img, x, y, size, size);
    return true;
  }

  /** A small hand-drawn wooden supply crate (currency icon). */
  private crateIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size = 16): void {
    const s = size;
    ctx.save();
    // planks
    this.roundRect(ctx, { x, y, w: s, h: s }, 2);
    ctx.fillStyle = "#b07a3e";
    ctx.fill();
    ctx.strokeStyle = "#5f3f1c";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // diagonal brace
    ctx.beginPath();
    ctx.moveTo(x + 1.5, y + 1.5);
    ctx.lineTo(x + s - 1.5, y + s - 1.5);
    ctx.moveTo(x + s - 1.5, y + 1.5);
    ctx.lineTo(x + 1.5, y + s - 1.5);
    ctx.strokeStyle = "rgba(95,63,28,0.7)";
    ctx.lineWidth = 1;
    ctx.stroke();
    // nails
    ctx.fillStyle = "#3c2810";
    for (const [nx, ny] of [
      [x + 2, y + 2],
      [x + s - 3, y + 2],
      [x + 2, y + s - 3],
      [x + s - 3, y + s - 3],
    ]) {
      ctx.fillRect(nx, ny, 1.4, 1.4);
    }
    ctx.restore();
  }

  /** The Blacksmith tab: recycle banked pieces for scrap (left), upgrade any
   *  piece a tier (right). */
  private drawSmith(game: Game, ctx: CanvasRenderingContext2D, L: ReturnType<Hud["armoryLayout"]>): void {
    const icons = game.assets.manifest.gear?.icons ?? {};
    ctx.save();
    ctx.textAlign = "left";
    ctx.fillStyle = "#bfe6ef";
    ctx.font = "700 16px 'Segoe UI', sans-serif";
    ctx.fillText("RECYCLE — click a piece, then click it again", 90, L.topY - 14);
    ctx.fillText("UPGRADE — click a piece to raise its tier", 900, L.topY - 14);
    ctx.restore();

    for (const row of L.rRows) {
      const def = GEAR_BY_ID.get(row.inst.def)!;
      const selected = this.selectedGearUid === row.inst.uid;
      ctx.save();
      this.roundRect(ctx, row.rect, 8);
      ctx.fillStyle = selected ? "rgba(255,210,74,0.12)" : "rgba(255,255,255,0.03)";
      ctx.fill();
      if (selected) {
        ctx.strokeStyle = "#ffd24a";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.restore();

      const img = this.assets.img(icons[def.icon]);
      if (img) ctx.drawImage(img, row.rect.x + 12, row.rect.y + 15, 44, 44);
      ctx.save();
      ctx.textAlign = "left";
      ctx.fillStyle = "#eaf6ff";
      ctx.font = "700 17px 'Segoe UI', sans-serif";
      ctx.fillText(def.name, row.rect.x + 70, row.rect.y + 28);
      ctx.fillStyle = TIER_COLORS[row.inst.tier];
      ctx.font = "800 13px 'Segoe UI', sans-serif";
      ctx.fillText(`T${row.inst.tier}`, row.rect.x + 70, row.rect.y + 50);
      ctx.fillStyle = "#9fd8a8";
      const bonusTxt1 = gearBonusText(def, row.inst.tier);
      const bs1 = this.fitSize(bonusTxt1, "700", 13, 9, row.rect.w - 86 - 140);
      ctx.font = `700 ${bs1}px 'Segoe UI', sans-serif`;
      ctx.fillText(bonusTxt1, row.rect.x + 86, row.rect.y + 50);
      ctx.fillStyle = selected ? "#ffd24a" : "#8fb8c8";
      ctx.font = selected ? "800 13px 'Segoe UI', sans-serif" : "600 13px 'Segoe UI', sans-serif";
      ctx.textAlign = "right";
      if (selected) {
        ctx.fillText("click again to recycle", row.rect.x + row.rect.w - 12, row.rect.y + 28);
      } else {
        this.scrapIcon(ctx, row.rect.x + row.rect.w - 28, row.rect.y + 39);
        ctx.fillText(`recycle for ${scrapValue(row.inst)}`, row.rect.x + row.rect.w - 32, row.rect.y + 50);
      }
      ctx.restore();
    }

    for (const row of L.uRows) {
      const def = GEAR_BY_ID.get(row.inst.def)!;
      const maxed = row.inst.tier >= TIER_MAX;
      const cost = maxed ? 0 : gearUpgradeCost(row.inst);
      const affordable = !maxed && game.meta.scrap >= cost;
      ctx.save();
      this.roundRect(ctx, row.rect, 8);
      ctx.fillStyle = affordable ? "rgba(126,200,126,0.06)" : "rgba(255,255,255,0.03)";
      ctx.fill();
      if (!affordable) ctx.globalAlpha = 0.55;
      ctx.restore();

      const img = this.assets.img(icons[def.icon]);
      if (img) ctx.drawImage(img, row.rect.x + 12, row.rect.y + 15, 44, 44);
      ctx.save();
      if (!affordable) ctx.globalAlpha = 0.6;
      ctx.textAlign = "left";
      const prog = maxed ? `T${row.inst.tier} MAX` : `T${row.inst.tier} → T${row.inst.tier + 1}`;
      const ns = this.fitSize(def.name, "700", 17, 13, row.rect.w - 70 - this.txtW(prog, "800 14px 'Segoe UI', sans-serif") - 84);
      ctx.fillStyle = "#eaf6ff";
      ctx.font = `700 ${ns}px 'Segoe UI', sans-serif`;
      ctx.fillText(def.name, row.rect.x + 70, row.rect.y + 28);
      ctx.fillStyle = TIER_COLORS[row.inst.tier];
      ctx.font = "800 14px 'Segoe UI', sans-serif";
      ctx.fillText(prog, row.rect.x + 70 + this.txtW(def.name, `700 ${ns}px 'Segoe UI', sans-serif`) + 16, row.rect.y + 28);
      ctx.fillStyle = "#9fd8a8";
      const bonusTxt2 = gearBonusText(def, row.inst.tier);
      const bs2 = this.fitSize(bonusTxt2, "700", 13, 9, row.rect.w - 70 - 140);
      ctx.font = `700 ${bs2}px 'Segoe UI', sans-serif`;
      ctx.fillText(bonusTxt2, row.rect.x + 70, row.rect.y + 50);
      ctx.textAlign = "right";
      if (maxed) {
        ctx.fillStyle = "#8fb8c8";
        ctx.font = "800 14px 'Segoe UI', sans-serif";
        ctx.fillText("fully upgraded", row.rect.x + row.rect.w - 12, row.rect.y + 50);
      } else {
        this.scrapIcon(ctx, row.rect.x + row.rect.w - 28, row.rect.y + 38);
        ctx.fillStyle = affordable ? "#7ec87e" : "#8fb8c8";
        ctx.font = "800 14px 'Segoe UI', sans-serif";
        ctx.fillText(`${cost}`, row.rect.x + row.rect.w - 32, row.rect.y + 50);
      }
      ctx.restore();
    }

    this.button(ctx, L.rPrev, "‹", { small: true, disabled: L.rPage === 0 });
    this.button(ctx, L.rNext, "›", { small: true, disabled: L.rPage >= L.rPages - 1 });
    this.button(ctx, L.uPrev, "‹", { small: true, disabled: L.uPage === 0 });
    this.button(ctx, L.uNext, "›", { small: true, disabled: L.uPage >= L.uPages - 1 });
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#8fb8c8";
    ctx.font = "600 14px 'Segoe UI', sans-serif";
    ctx.fillText(`${L.rPage + 1} / ${L.rPages}`, (L.rPrev.x + L.rNext.x + L.rNext.w) / 2, L.rPrev.y + 28);
    ctx.fillText(`${L.uPage + 1} / ${L.uPages}`, (L.uPrev.x + L.uNext.x + L.uNext.w) / 2, L.uPrev.y + 28);
    ctx.restore();
  }

  /** Measure text width without disturbing the caller's font. */
  private _measureCtx: CanvasRenderingContext2D | null = null;
  private txtW(text: string, font: string): number {
    if (!this._measureCtx) this._measureCtx = document.createElement("canvas").getContext("2d");
    const c = this._measureCtx;
    if (!c) return text.length * 9; // conservative fallback
    c.font = font;
    return c.measureText(text).width;
  }

  /** Largest font size (>= min) at which `text` fits within maxW px. */
  private fitSize(text: string, weight: string, base: number, min: number, maxW: number): number {
    let size = base;
    while (size > min && this.txtW(text, `${weight} ${size}px 'Segoe UI', sans-serif`) > maxW) size -= 0.5;
    return size;
  }

  handleArmoryClick(game: Game, p: { x: number; y: number }): boolean {
    const L = this.armoryLayout(game);

    // The crate reveal swallows every click until dismissed.
    if (this.crateReveal) {
      this.crateReveal = null;
      game.sfx("click");
      return true;
    }

    // Supply Crate purchase (both tabs).
    if (inRect(p, L.crateBtn)) {
      const inst = game.buyLootbox();
      if (inst) {
        this.crateReveal = inst;
        this.selectedGearUid = null;
        this.armoryTab = "vault";
        game.sfx(inst.tier >= 4 ? "castle" : "boon");
      } else {
        game.sfx("click");
      }
      return true;
    }

    if (inRect(p, L.vaultTab)) {
      this.armoryTab = "vault";
      this.selectedGearUid = null;
      game.sfx("click");
      return true;
    }
    if (inRect(p, L.smithTab)) {
      this.armoryTab = "smith";
      this.selectedGearUid = null;
      game.sfx("click");
      return true;
    }
    if (inRect(p, L.close)) {
      game._showArmory = false;
      this.selectedGearUid = null;
      this.crateReveal = null;
      game.sfx("click");
      return true;
    }

    if (this.armoryTab === "smith") {
      if (inRect(p, L.rPrev)) {
        this.smithPageRecycle = Math.max(0, this.smithPageRecycle - 1);
        game.sfx("click");
        return true;
      }
      if (inRect(p, L.rNext)) {
        this.smithPageRecycle = Math.min(L.rPages - 1, this.smithPageRecycle + 1);
        game.sfx("click");
        return true;
      }
      if (inRect(p, L.uPrev)) {
        this.smithPageUpgrade = Math.max(0, this.smithPageUpgrade - 1);
        game.sfx("click");
        return true;
      }
      if (inRect(p, L.uNext)) {
        this.smithPageUpgrade = Math.min(L.uPages - 1, this.smithPageUpgrade + 1);
        game.sfx("click");
        return true;
      }
      // Recycle rows: select, then confirm on the second click.
      for (const row of L.rRows) {
        if (inRect(p, row.rect)) {
          if (this.selectedGearUid === row.inst.uid) {
            const gained = game.recycleGear(row.inst.uid);
            this.selectedGearUid = null;
            game.sfx(gained > 0 ? "coin" : "click");
          } else {
            this.selectedGearUid = row.inst.uid;
            game.sfx("click");
          }
          return true;
        }
      }
      // Upgrade rows: spend scrap, raise a tier.
      for (const row of L.uRows) {
        if (inRect(p, row.rect)) {
          const ok = game.upgradeGear(row.inst.uid);
          this.selectedGearUid = null;
          game.sfx(ok ? "boon" : "click");
          return true;
        }
      }
      this.selectedGearUid = null;
      return true;
    }

    if (inRect(p, L.prev)) {
      this.armoryPage = Math.max(0, this.armoryPage - 1);
      game.sfx("click");
      return true;
    }
    if (inRect(p, L.next)) {
      this.armoryPage = Math.min(L.pages - 1, this.armoryPage + 1);
      game.sfx("click");
      return true;
    }
    // Vault rows: select / deselect.
    for (const row of L.rows) {
      if (inRect(p, row.rect)) {
        this.selectedGearUid = this.selectedGearUid === row.inst.uid ? null : row.inst.uid;
        game.sfx("click");
        return true;
      }
    }
    // Slots: equip the selected piece if compatible, else unequip.
    for (const s of L.slots) {
      if (inRect(p, s.rect)) {
        if (this.selectedGearUid) {
          const sel = game.meta.gear.owned.find((o) => o.uid === this.selectedGearUid);
          const selDef = sel ? GEAR_BY_ID.get(sel.def) : null;
          if (selDef && selDef.tower === s.tower && selDef.slot === s.slot && sel) {
            game.equipGear(sel.uid, s.tower, s.slot);
            this.selectedGearUid = null;
            game.sfx("coin");
            return true;
          }
        }
        if (game.equippedFor(s.tower, s.slot)) {
          game.unequipGear(s.tower, s.slot);
          game.sfx("click");
        } else {
          game.sfx("click");
        }
        return true;
      }
    }
    // Anything else: deselect.
    this.selectedGearUid = null;
    return true;
  }
}
