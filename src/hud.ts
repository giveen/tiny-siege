import type { Game } from "./game";
import type { Assets, StaticDef } from "./assets";
import { asAsset } from "./assets";
import { drawSprite } from "./sprite";
import { ENEMY_DEFS, enemyPreviewDef, type EnemyType } from "./enemy";
import type { UnitColor } from "./assets";
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
import { WORLD_W, WORLD_H, MARGIN_R, MARGIN_B, CANVAS_W, CANVAS_H } from "./config";
import { VICTORY_RUNES, RELICS, relicLevel } from "./meta";
import {
  GEAR_BY_ID,
  GEAR_SLOTS,
  SLOT_LABEL,
  TIER_COLORS,
  TIER_MAX,
  gearBonusText,
  gearUpgradeCost,
  scrapValue,
  type GearInstance,
  type GearSlot,
} from "./gear";
import type { TowerType } from "./types";
import { fmt } from "./util";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const inRect = (p: { x: number; y: number }, r: Rect) =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

export class Hud {
  assets: Assets;
  private layoutCache: ReturnType<Hud["computeLayout"]>;
  // Armory (menu) temp state
  private selectedGearUid: string | null = null;
  private armoryPage = 0;
  /** Public: the ?smith debug param jumps straight to the Blacksmith tab. */
  armoryTab: "vault" | "smith" = "vault";
  private smithPageRecycle = 0;
  private smithPageUpgrade = 0;

  constructor(assets: Assets) {
    this.assets = assets;
    this.layoutCache = null as unknown as ReturnType<Hud["computeLayout"]>;
  }

  // ------------------------------------------------------------- layout
  private computeLayout(game: Game) {
    // Right-margin info panel (off the map): castle HP, gold, wave, start-wave,
    // the telegraphed next-wave preview, and controls.
    const rp = { x: WORLD_W + 12, y: 12, w: MARGIN_R - 24, h: 528 };
    const ix = rp.x + 12;
    const iw = rp.w - 24;
    const castleHp = { x: ix, y: rp.y + 12, w: iw, h: 18 };
    const goldRect = { x: ix, y: rp.y + 42, w: iw, h: 26 };
    const waveRect = { x: ix, y: rp.y + 74, w: iw, h: 34 };
    const startWave = { x: ix, y: rp.y + 116, w: iw, h: 40 };
    const previewRect = { x: ix, y: rp.y + 164, w: iw, h: 150 };
    const speed = { x: ix, y: rp.y + 164 + 150 + 8, w: iw, h: 40 };
    const pause = { x: ix, y: speed.y + 48, w: iw, h: 40 };
    const mute = { x: ix, y: pause.y + 48, w: iw, h: 40 };
    const menu = { x: ix, y: mute.y + 48, w: iw, h: 40 };

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
      let px = t.x + 44;
      let py = t.y - ph / 2;
      px = Math.min(Math.max(8, px), WORLD_W - pw - 8);
      py = Math.min(Math.max(8, py), WORLD_H - ph - 8);
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

    return { rp, castleHp, goldRect, waveRect, startWave, previewRect, speed, pause, mute, menu, palette, sel, cards };
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
    ctx.save();
    ctx.textAlign = "left";
    ctx.fillStyle = "#8fd0ff";
    ctx.font = "700 11px 'Segoe UI', sans-serif";
    ctx.fillText("NEXT WAVE", r.x, r.y + 2);
    ctx.restore();

    if (game.wavePhase !== "build" || game.nextWave.length === 0) {
      ctx.save();
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(180,210,225,0.4)";
      ctx.font = "600 12px 'Segoe UI', sans-serif";
      ctx.fillText(game.wavePhase === "active" ? "…incoming…" : "—", r.x, r.y + 34);
      ctx.restore();
      return;
    }

    // Count enemies by type (keep a representative color per type).
    const counts: { type: EnemyType; color: UnitColor; n: number }[] = [];
    const seen = new Map<string, number>();
    for (const e of game.nextWave) {
      if (!seen.has(e.type)) {
        seen.set(e.type, counts.length);
        counts.push({ type: e.type, color: e.color, n: 0 });
      }
      counts[seen.get(e.type)!].n++;
    }

    // Chips sit below the title band; sprites anchor near the chip bottom so
    // tall foes (fliers) never reach the "NEXT WAVE" label.
    const chipW = r.w / 3;
    const rowStep = 43;
    counts.forEach((c, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const cx = r.x + col * chipW;
      const cy = r.y + 18 + row * rowStep;
      const def = enemyPreviewDef(this.assets, c.type, c.color);
      drawSprite(ctx, this.assets, def, 0, cx + 13, cy + 33, { scale: 0.45 });
      ctx.save();
      ctx.textAlign = "left";
      ctx.fillStyle = "#eaf6ff";
      ctx.font = "700 13px 'Segoe UI', sans-serif";
      ctx.fillText(`×${c.n}`, cx + 34, cy + 16);
      const trait = this.enemyTraits(c.type);
      if (trait) {
        ctx.fillStyle = trait.color;
        ctx.font = "600 9px 'Segoe UI', sans-serif";
        ctx.fillText(trait.label, cx + 34, cy + 30);
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
    opts: { bg?: string; fg?: string; active?: boolean; disabled?: boolean; small?: boolean } = {}
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
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
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
    // meta rune balance, right-aligned on the Wave line
    ctx.fillStyle = "#c58bff";
    ctx.font = "700 14px 'Segoe UI', sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`◆ ${game.meta.runes}`, L.waveRect.x + L.waveRect.w, L.waveRect.y + 14);
    ctx.restore();

    // start wave / status
    if (game.wavePhase === "build" && !game.paused) {
      this.button(ctx, L.startWave, `⚔  Wave ${game.wave + 1}`, { bg: "#c98a2e", fg: "#1a1206", active: true });
    } else {
      this.button(ctx, L.startWave, game.wavePhase === "active" ? "Waving…" : "—", { bg: "#22404e", disabled: true, small: true });
    }

    // telegraphed next-wave composition
    this.drawWavePreview(game, ctx, L.previewRect);

    // controls
    this.button(ctx, L.speed, `${game.speed}×  (F)`, { active: game.speedIdx > 0, small: true });
    this.button(ctx, L.pause, game.paused ? "▶  Resume" : "❚❚  Pause", { small: true });
    this.button(ctx, L.mute, game.audioEnabled ? "♪  Sound" : "∅  Muted", { small: true });
    this.button(ctx, L.menu, "⌂  Menu", { small: true });

    // palette
    for (const t of TOWER_ORDER) {
      const r = L.palette[t];
      const def = TOWER_DEFS[t];
      const unlocked = game.unlocked.has(t);
      const placing = game.placing === t;
      const afford = game.gold >= def.cost;
      this.panel(ctx, r, 8);
      if (placing) {
        ctx.save();
        this.roundRect(ctx, r, 8);
        ctx.strokeStyle = "#ffd24a";
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.restore();
      }
      // building icon
      const b = asAsset(this.assets.building("blue", def.building));
      drawSprite(ctx, this.assets, b, 0, r.x + 30, r.y + r.h - 16, { scale: 0.32, alpha: unlocked ? 1 : 0.35 });
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
        ctx.fillText(`${def.cost}  gold`, r.x + 60, r.y + 46);
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
        ctx.fillText(`Strike ${Math.round(ss.dmg)}   Muster ${ss.deploy.toFixed(1)}s   Up to ${ss.maxOut}`, panel.x + 12, panel.y + 44);
        ctx.fillStyle = "rgba(180,210,225,0.7)";
        ctx.font = "500 10px 'Segoe UI', sans-serif";
        ctx.fillText(`Soldier HP ${Math.round(ss.hp)} — holds the road against ground foes`, panel.x + 12, panel.y + 58);
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
          const cost = upgradeCost(t.type, u.track, lvl);
          this.button(ctx, u.rect, `⬆ ${label}  ${cost}g`, { active: true, disabled: game.gold < cost, small: true });
        }
      }

      // specialization section
      if (specUp && t.spec) {
        if (t.specLvl >= MAX_SPEC) {
          this.button(ctx, specUp, `⚑ ${sd?.name}  ·  L3 MAX`, { bg: "#3a4a52", disabled: true, small: true });
        } else {
          const cost = specUpgradeCost(t.type, t.specLvl);
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

    if (game.screen === "over") return this.handleOverClick(game, p);

    // boon modal takes priority
    if (game.wavePhase === "boon") {
      for (let i = 0; i < L.cards.length; i++) {
        if (inRect(p, L.cards[i]) && game.boonChoices[i]) {
          game.applyBoon(game.boonChoices[i]);
          return true;
        }
      }
      return true; // swallow clicks while modal open
    }

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

    // right panel (controls + start wave)
    if (inRect(p, L.rp)) {
      if (inRect(p, L.speed)) {
        game.cycleSpeed();
        return true;
      }
      if (inRect(p, L.mute)) {
        game.toggleMute();
        return true;
      }
      if (game.wavePhase === "build" && inRect(p, L.startWave)) {
        game.startWave();
        return true;
      }
      return true; // swallow clicks on the panel
    }

    // selected tower panel (per-stat upgrades + specialization)
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

    // palette
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

    // "start wave" hint area: clicking empty space while in build phase with no placement
    // does nothing (world interaction handles it). Return false so world handles it.
    return false;
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

    // best
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#8fb8c8";
    ctx.font = "600 15px 'Segoe UI', sans-serif";
    ctx.fillText(`Best run: ${game.best} waves`, CANVAS_W / 2, CANVAS_H - 40);
    ctx.restore();

    if (game._showArmory) this.drawArmory(game, ctx);
    else if (game._showCodex) this.drawCodex(game, ctx);
    else if (game._showHelp) this.drawHelp(ctx);
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
      "• Click a built tower to Upgrade or Sell it.",
      "• Survive the wave, then pick 1 of 3 random Boons (upgrades).",
      "• The island grows every 5 waves — new land, a longer route, more spots.",
      "• At +3 upgrades a tower can Specialize: pick one of three lines, then level it.",
      "• Barracks muster soldiers who march the road and hold it against ground foes.",
      "• Unlock new towers and stack powers to go deeper.",
      "• Every cleared wave banks ◆ runes (a lost run keeps them; winning the siege pays +40).",
      "• Spend runes in The Codex on relics that carry over between sieges.",
      "",
      "Keys: 1-5 build · Space start wave · P pause · F speed · M mute · Esc cancel",
      "",
      "Click anywhere to close.",
    ];
    ctx.font = "700 22px 'Segoe UI', sans-serif";
    let y = 120;
    for (const ln of lines) {
      ctx.fillStyle = ln.startsWith("HOW") ? "#ffd24a" : ln.startsWith("Keys") ? "#8fd0ff" : "#dcecf4";
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
    }
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
    ctx.fillText("The Minotaur assault is repelled.", CANVAS_W / 2, CANVAS_H / 2 - 42);
    ctx.fillStyle = "#bfe6ef";
    ctx.font = "600 18px 'Segoe UI', sans-serif";
    ctx.fillText(`${game.kills} enemies slain  ·  +${VICTORY_RUNES} ◆ banked`, CANVAS_W / 2, CANVAS_H / 2);
    ctx.fillStyle = "#c58bff";
    ctx.font = "700 18px 'Segoe UI', sans-serif";
    ctx.fillText(`Relic vault: ${game.meta.runes} ◆`, CANVAS_W / 2, CANVAS_H / 2 + 28);
    ctx.restore();

    const r = this.victoryRects();
    this.button(ctx, r.again, "⚔  Keep Defending (Endless)", { bg: "#c98a2e", fg: "#1a1206", active: true });
    this.button(ctx, r.menu, "Bank Runes & Menu", { small: true });
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
    const panel = { x: 536, y: 96, w: 960, h: 872 } as Rect;
    const header = { x: 576, y: 126, w: 880, h: 176 } as Rect;
    const rows = RELICS.map((r, i) => {
      const rect = { x: 576, y: 326 + i * 96, w: 880, h: 84 } as Rect;
      return {
        id: r.id,
        rect,
        buy: { x: rect.x + rect.w - 30 - 172, y: rect.y + 21, w: 172, h: 42 } as Rect,
      };
    });
    const close = { x: CANVAS_W / 2 - 110, y: 908, w: 220, h: 52 } as Rect;
    return { panel, header, rows, close };
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
    ctx.fillText("Spend runes on relics that carry over between sieges.", CANVAS_W / 2, L.header.y + 140);
    ctx.restore();

    for (const row of L.rows) {
      const relic = RELICS.find((r) => r.id === row.id)!;
      const lvl = relicLevel(game.meta, relic.id);
      const maxed = lvl >= relic.maxLevel;
      const cost = relic.cost(lvl);
      const canBuy = !maxed && game.meta.runes >= cost;
      const r = row.rect;

      // row — clean parchment fill (cropped center tile) + ink border
      this.uiCenter(ctx, u.paper_center ?? u.paper, r.x, r.y, r.w, r.h);
      ctx.save();
      ctx.strokeStyle = "rgba(58,42,24,0.4)";
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      ctx.restore();

      // relic icon (repurposed RPG icon pack art)
      const iconPath = relicIcons[relic.id];
      if (iconPath) {
        const im = this.assets.img(iconPath);
        if (im) ctx.drawImage(im, r.x + 16, r.y + 16, 52, 52);
      }

      ctx.save();
      ctx.textAlign = "left";
      ctx.fillStyle = "#3a2a18";
      ctx.font = "700 19px 'Segoe UI', sans-serif";
      ctx.fillText(relic.name, r.x + 84, r.y + 36);
      ctx.fillStyle = "#5a4632";
      ctx.font = "600 14px 'Segoe UI', sans-serif";
      ctx.fillText(relic.blurb, r.x + 84, r.y + 60);
      // current effect
      ctx.fillStyle = lvl > 0 ? "#8a5a10" : "rgba(58,42,24,0.45)";
      ctx.font = "700 15px 'Segoe UI', sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(lvl > 0 ? relic.effect(lvl) : "—", r.x + r.w - 216, r.y + 36);
      ctx.restore();

      // level pips
      ctx.save();
      for (let i = 0; i < relic.maxLevel; i++) {
        ctx.beginPath();
        ctx.arc(r.x + r.w - 320 + i * 18, r.y + 56, 5, 0, Math.PI * 2);
        ctx.fillStyle = i < lvl ? "#c98a2e" : "rgba(58,42,24,0.18)";
        ctx.fill();
      }
      ctx.restore();

      // buy button — teal 9-slice
      ctx.save();
      if (!canBuy) ctx.globalAlpha = 0.55;
      this.uiNine(ctx, u.buttons.sq_blue, row.buy.x, row.buy.y, row.buy.w, row.buy.h, 20, 12);
      ctx.globalAlpha = 1;
      ctx.textAlign = "center";
      ctx.fillStyle = "#0f2a33";
      ctx.font = "800 16px 'Segoe UI', sans-serif";
      ctx.fillText(maxed ? "MAX" : `Buy  ${cost} ◆`, row.buy.x + row.buy.w / 2, row.buy.y + row.buy.h / 2 + 6);
      ctx.restore();
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

  // ------------------------------------------------------------- armory
  private armoryLayout(game: Game) {
    const topY = 244;
    const close = { x: CANVAS_W / 2 - 110, y: 648, w: 220, h: 52 } as Rect;
    const vaultTab = { x: CANVAS_W / 2 - 210, y: 186, w: 200, h: 32 } as Rect;
    const smithTab = { x: CANVAS_W / 2 + 10, y: 186, w: 200, h: 32 } as Rect;

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
        y: topY + Math.floor(i / 2) * 84,
        w: 350,
        h: 74,
      } as Rect,
    }));
    // five tower columns (the Barracks column is empty until it has gear)
    const towerX0 = 830;
    const tw = 210;
    const tgap = 12;
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
        y: topY + Math.floor(i / 2) * 84,
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
        y: topY + Math.floor(i / 2) * 84,
        w: 490,
        h: 74,
      } as Rect,
    }));
    const uPrev = { x: 900, y: 576, w: 96, h: 44 } as Rect;
    const uNext = { x: 1400, y: 576, w: 96, h: 44 } as Rect;

    return {
      topY, close, vaultTab, smithTab,
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
      ctx.fillText(`${L.count} piece${L.count === 1 ? "" : "s"} in the vault · ${L.equippedCount} equipped`, CANVAS_W / 2, 146);
    } else {
      const label = `${game.meta.scrap} scrap`;
      const tw = this.txtW(label, "700 20px 'Segoe UI', sans-serif");
      const startX = CANVAS_W / 2 - (tw + 24) / 2;
      this.scrapIcon(ctx, startX, 129, 19);
      ctx.textAlign = "left";
      ctx.fillText(label, startX + 24, 146);
      ctx.textAlign = "center";
    }
    ctx.fillStyle = "#8fb8c8";
    ctx.font = "600 14px 'Segoe UI', sans-serif";
    ctx.fillText(
      this.armoryTab === "vault"
        ? "Enemies drop gear as you clear waves — deeper waves drop higher tiers. Click a piece, then click its slot to equip. It carries into every siege."
        : "Recycle spare gear for scrap, then spend scrap to upgrade pieces to higher tiers. Equipped pieces can be upgraded in place.",
      CANVAS_W / 2,
      172
    );
    ctx.restore();

    // tab buttons
    this.drawArmoryTab(ctx, L.vaultTab, "THE VAULT", this.armoryTab === "vault");
    this.drawArmoryTab(ctx, L.smithTab, "THE BLACKSMITH", this.armoryTab === "smith");

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
      ctx.textAlign = "left";
      ctx.fillStyle = "#eaf6ff";
      ctx.font = "700 17px 'Segoe UI', sans-serif";
      ctx.fillText(def.name, row.rect.x + 70, row.rect.y + 28);
      ctx.fillStyle = TIER_COLORS[row.inst.tier];
      ctx.font = "800 14px 'Segoe UI', sans-serif";
      ctx.fillText(
        `T${row.inst.tier}`,
        row.rect.x + 70 + this.txtW(def.name, "700 17px 'Segoe UI', sans-serif") + 10,
        row.rect.y + 28
      );
      ctx.fillStyle = "#9fd8a8";
      ctx.font = "700 13px 'Segoe UI', sans-serif";
      ctx.fillText(gearBonusText(def, row.inst.tier), row.rect.x + 70, row.rect.y + 50);
      ctx.fillStyle = "#8fb8c8";
      ctx.font = "600 12px 'Segoe UI', sans-serif";
      ctx.fillText(`${SLOT_LABEL[def.slot]} · ${TOWER_DEFS[def.tower].name}`, row.rect.x + 70 + this.txtW(gearBonusText(def, row.inst.tier), "700 13px 'Segoe UI', sans-serif") + 14, row.rect.y + 50);
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
        ctx.font = "700 16px 'Segoe UI', sans-serif";
        ctx.fillText(TOWER_DEFS[s.tower].name.toUpperCase(), x0, L.topY - 14);
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
        ctx.textAlign = "left";
        ctx.fillStyle = "#eaf6ff";
        ctx.font = "700 16px 'Segoe UI', sans-serif";
        ctx.fillText(def.name, s.rect.x + 78, s.rect.y + 34);
        ctx.fillStyle = TIER_COLORS[cur.tier];
        ctx.font = "800 13px 'Segoe UI', sans-serif";
        ctx.fillText(`T${cur.tier}`, s.rect.x + 78, s.rect.y + 56);
        ctx.fillStyle = "#9fd8a8";
        ctx.font = "700 13px 'Segoe UI', sans-serif";
        ctx.fillText(gearBonusText(def, cur.tier), s.rect.x + 108, s.rect.y + 56);
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
      ctx.font = "700 13px 'Segoe UI', sans-serif";
      ctx.fillText(gearBonusText(def, row.inst.tier), row.rect.x + 86, row.rect.y + 50);
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
      ctx.fillStyle = "#eaf6ff";
      ctx.font = "700 17px 'Segoe UI', sans-serif";
      ctx.fillText(def.name, row.rect.x + 70, row.rect.y + 28);
      ctx.fillStyle = TIER_COLORS[row.inst.tier];
      ctx.font = "800 14px 'Segoe UI', sans-serif";
      ctx.fillText(
        maxed ? `T${row.inst.tier} MAX` : `T${row.inst.tier} → T${row.inst.tier + 1}`,
        row.rect.x + 70 + this.txtW(def.name, "700 17px 'Segoe UI', sans-serif") + 16,
        row.rect.y + 28
      );
      ctx.fillStyle = "#9fd8a8";
      ctx.font = "700 13px 'Segoe UI', sans-serif";
      ctx.fillText(gearBonusText(def, row.inst.tier), row.rect.x + 70, row.rect.y + 50);
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
  private txtW(text: string, font: string): number {
    // Cheap approximation: ~0.52em per char for the Segoe UI weights we use.
    // The font string looks like "700 17px 'Segoe UI', sans-serif" — parse the
    // size off the "NNpx" part, not the leading weight.
    const m = /(\d+(?:\.\d+)?)px/.exec(font);
    const size = m ? parseFloat(m[1]) : 14;
    return text.length * size * 0.52;
  }

  handleArmoryClick(game: Game, p: { x: number; y: number }): boolean {
    const L = this.armoryLayout(game);
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
