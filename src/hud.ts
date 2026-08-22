import type { Game } from "./game";
import type { Assets } from "./assets";
import { asAsset } from "./assets";
import { drawSprite } from "./sprite";
import { ENEMY_DEFS, enemyPreviewDef, type EnemyType } from "./enemy";
import type { UnitColor } from "./assets";
import { TOWER_DEFS, TOWER_ORDER, MAX_UPGRADE, upgradeCost, tracksFor, trackLabel, type UpgradeTrack } from "./tower";
import { RARITY_COLOR } from "./boons";
import { WORLD_W, WORLD_H, MARGIN_R, MARGIN_B, CANVAS_W, CANVAS_H } from "./config";
import { VICTORY_RUNES, RELICS, relicLevel } from "./meta";
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

  constructor(assets: Assets) {
    this.assets = assets;
    this.layoutCache = null as unknown as ReturnType<Hud["computeLayout"]>;
  }

  // ------------------------------------------------------------- layout
  private computeLayout(game: Game) {
    // Right-margin info panel (off the map): castle HP, gold, wave, start-wave,
    // the telegraphed next-wave preview, and controls.
    const rp = { x: WORLD_W + 12, y: 12, w: MARGIN_R - 24, h: 472 };
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

    // selected tower panel — per-stat upgrade tracks (clamped to the world)
    let sel: { panel: Rect; upgrades: { track: UpgradeTrack; rect: Rect }[]; sell: Rect } | null = null;
    if (game.selectedTower && game.screen === "game" && game.wavePhase !== "boon") {
      const t = game.selectedTower;
      const tracks = tracksFor(t.type);
      const pw = 240, ppad = 10, btnH = 24, btnGap = 5;
      const headH = 66;
      const ph = headH + tracks.length * (btnH + btnGap) + btnH + 16;
      let px = t.x + 44;
      let py = t.y - ph / 2;
      px = Math.min(Math.max(8, px), WORLD_W - pw - 8);
      py = Math.min(Math.max(8, py), WORLD_H - ph - 8);
      const upgrades = tracks.map((track, i) => ({
        track,
        rect: { x: px + ppad, y: py + headH + i * (btnH + btnGap), w: pw - ppad * 2, h: btnH },
      }));
      const sell = { x: px + ppad, y: py + ph - btnH - 8, w: pw - ppad * 2, h: btnH };
      sel = { panel: { x: px, y: py, w: pw, h: ph }, upgrades, sell };
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

    return { rp, castleHp, goldRect, waveRect, startWave, previewRect, speed, pause, mute, palette, sel, cards };
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
      ctx.restore();
    }

    // selected tower panel — per-stat upgrades
    if (L.sel && game.selectedTower) {
      const t = game.selectedTower;
      const s = this.statsFor(game, t);
      const { panel, upgrades, sell } = L.sel;
      this.panel(ctx, panel, 8);
      ctx.save();
      ctx.textAlign = "left";
      ctx.fillStyle = "#ffd24a";
      ctx.font = "800 15px 'Segoe UI', sans-serif";
      const total = t.totalUpgrades;
      ctx.fillText(`${TOWER_DEFS[t.type].name}${total > 0 ? `  ·  +${total}` : ""}`, panel.x + 12, panel.y + 22);
      ctx.fillStyle = "#cfe6f0";
      ctx.font = "600 12px 'Segoe UI', sans-serif";
      if (t.type === "monastery") {
        ctx.fillText(`Aura ${Math.round(s.range)}   Bless +${Math.round(t.buffPower() * 100)}%`, panel.x + 12, panel.y + 44);
        ctx.fillStyle = "rgba(180,210,225,0.7)";
        ctx.font = "500 10px 'Segoe UI', sans-serif";
        ctx.fillText("Dmg & fire-rate buff to towers in aura", panel.x + 12, panel.y + 58);
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

    // pause toggle works even while paused
    if (inRect(p, L.pause)) {
      game.togglePause();
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

    // selected tower panel (per-stat upgrades)
    if (L.sel && game.selectedTower) {
      for (const u of L.sel.upgrades) {
        if (inRect(p, u.rect)) {
          game.upgradeTower(game.selectedTower, u.track);
          return true;
        }
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
    const w = 280;
    const h = 58;
    return {
      start: { x: CANVAS_W / 2 - w / 2, y: CANVAS_H / 2 + 30, w, h } as Rect,
      help: { x: CANVAS_W / 2 - w / 2, y: CANVAS_H / 2 + 100, w, h } as Rect,
      codex: { x: CANVAS_W / 2 - w / 2, y: CANVAS_H / 2 + 170, w, h } as Rect,
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

    // best
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#8fb8c8";
    ctx.font = "600 15px 'Segoe UI', sans-serif";
    ctx.fillText(`Best run: ${game.best} waves`, CANVAS_W / 2, CANVAS_H - 40);
    ctx.restore();

    if (game._showCodex) this.drawCodex(game, ctx);
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
      "• Unlock new towers and stack powers to go deeper.",
      "",
      "Keys: 1-4 build · Space start wave · P pause · F speed · M mute · Esc cancel",
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
    const panelW = 920;
    const px = (CANVAS_W - panelW) / 2;
    const topY = 190;
    const rowH = 74;
    const bw = 168;
    const bh = 42;
    const rows = RELICS.map((r, i) => {
      const rowY = topY + i * rowH;
      return { id: r.id, rowY, buy: { x: px + panelW - 34 - bw, y: rowY + (rowH - bh) / 2, w: bw, h: bh } as Rect };
    });
    const close = { x: CANVAS_W / 2 - 110, y: topY + RELICS.length * rowH + 24, w: 220, h: 52 } as Rect;
    return { px, panelW, topY, rowH, rows, close };
  }

  private drawCodex(game: Game, ctx: CanvasRenderingContext2D): void {
    const L = this.codexLayout();
    ctx.save();
    ctx.globalAlpha = 0.97;
    ctx.fillStyle = "#08131a";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.restore();

    // panel
    ctx.save();
    this.roundRect(
      ctx,
      { x: L.px - 22, y: 64, w: L.panelW + 44, h: L.topY + L.rowH * RELICS.length - 64 + 40 },
      12
    );
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
    ctx.fillText("THE CODEX", CANVAS_W / 2, 112);
    ctx.fillStyle = "#c58bff";
    ctx.font = "700 20px 'Segoe UI', sans-serif";
    ctx.fillText(`◆ ${game.meta.runes}  runes`, CANVAS_W / 2, 146);
    ctx.fillStyle = "#8fb8c8";
    ctx.font = "600 14px 'Segoe UI', sans-serif";
    ctx.fillText("Spend runes on relics that carry over between sieges.", CANVAS_W / 2, 170);
    ctx.restore();

    for (const row of L.rows) {
      const relic = RELICS.find((r) => r.id === row.id)!;
      const lvl = relicLevel(game.meta, relic.id);
      const maxed = lvl >= relic.maxLevel;
      const cost = relic.cost(lvl);
      const canBuy = !maxed && game.meta.runes >= cost;

      ctx.save();
      this.roundRect(ctx, { x: L.px, y: row.rowY, w: L.panelW, h: L.rowH - 10 }, 8);
      ctx.fillStyle = "rgba(255,255,255,0.03)";
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.textAlign = "left";
      ctx.fillStyle = "#eaf6ff";
      ctx.font = "700 19px 'Segoe UI', sans-serif";
      ctx.fillText(relic.name, L.px + 24, row.rowY + 28);
      ctx.fillStyle = "#8fb8c8";
      ctx.font = "600 14px 'Segoe UI', sans-serif";
      ctx.fillText(relic.blurb, L.px + 24, row.rowY + 52);
      // current effect
      ctx.fillStyle = lvl > 0 ? "#ffd24a" : "rgba(180,210,225,0.4)";
      ctx.font = "700 15px 'Segoe UI', sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(lvl > 0 ? relic.effect(lvl) : "—", L.px + L.panelW - 230, row.rowY + 30);
      ctx.restore();

      // level pips
      ctx.save();
      for (let i = 0; i < relic.maxLevel; i++) {
        const pipX = L.px + L.panelW - 200 + i * 15;
        ctx.beginPath();
        ctx.arc(pipX, row.rowY + 52, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = i < lvl ? "#ffd24a" : "rgba(255,255,255,0.14)";
        ctx.fill();
      }
      ctx.restore();

      this.button(ctx, row.buy, maxed ? "MAX" : `Buy  ${cost} ◆`, {
        bg: canBuy ? "#c98a2e" : "#22404e",
        fg: canBuy ? "#1a1206" : "#8fb8c8",
        disabled: !canBuy,
        small: true,
      });
    }

    this.button(ctx, L.close, "Close", { small: true });
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
}
