import type { Game } from "./game";
import type { Assets } from "./assets";
import { asAsset } from "./assets";
import { drawSprite } from "./sprite";
import { TOWER_DEFS, TOWER_ORDER, MAX_LEVEL, upgradeCost } from "./tower";
import { RARITY_COLOR } from "./boons";
import { WORLD_W, WORLD_H } from "./config";
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
    const topH = 54;
    const btn = 42;
    const rightBtns: Rect[] = [0, 1, 2].map((i) => ({
      x: WORLD_W - 14 - (3 - i) * (btn + 8),
      y: 6,
      w: btn,
      h: btn,
    })); // [speed, pause, mute]

    // palette
    const palH = 78;
    const palY = WORLD_H - palH - 8;
    const n = TOWER_ORDER.length;
    const pad = 14;
    const gap = 10;
    const totalW = WORLD_W - pad * 2;
    const bw = (totalW - gap * (n - 1)) / n;
    const palette: Record<string, Rect> = {};
    TOWER_ORDER.forEach((t, i) => {
      palette[t] = { x: pad + i * (bw + gap), y: palY, w: bw, h: palH };
    });

    // selected tower panel
    let sel: { panel: Rect; upgrade: Rect; sell: Rect } | null = null;
    if (game.selectedTower && game.screen === "game" && game.wavePhase !== "boon") {
      const pw = 210;
      const ph = 150;
      let px = game.selectedTower.x + 40;
      let py = game.selectedTower.y - 90;
      px = Math.min(Math.max(8, px), WORLD_W - pw - 8);
      py = Math.min(Math.max(topH + 8, py), WORLD_H - palH - ph - 24);
      sel = {
        panel: { x: px, y: py, w: pw, h: ph },
        upgrade: { x: px + 10, y: py + ph - 52, w: pw - 20, h: 22 },
        sell: { x: px + 10, y: py + ph - 26, w: pw - 20, h: 22 },
      };
    }

    // start-wave button (build phase only)
    let startWave: Rect | null = null;
    if (game.wavePhase === "build" && game.screen === "game" && !game.paused) {
      startWave = { x: 468, y: 9, w: 186, h: 36 };
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

    return { topH, rightBtns, palette, sel, cards, startWave };
  }

  private layout(game: Game) {
    this.layoutCache = this.computeLayout(game);
    return this.layoutCache;
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

    // top bar
    this.panel(ctx, { x: 6, y: 4, w: WORLD_W - 12, h: L.topH - 4 }, 10);

    // castle hp
    const cfrac = game.castle.hp / game.castle.maxHp;
    this.bar(ctx, 18, 14, 190, 18, cfrac, cfrac > 0.5 ? "#6fe06f" : cfrac > 0.25 ? "#ffd24a" : "#e05555");
    ctx.save();
    ctx.fillStyle = "#eaf6ff";
    ctx.font = "700 12px 'Segoe UI', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`CASTLE  ${Math.max(0, Math.ceil(game.castle.hp))}/${game.castle.maxHp}`, 24, 24);
    ctx.restore();

    // gold
    const coin = this.assets.manifest.ui.icons[2];
    ctx.drawImage(this.assets.img(coin), 222, 12, 24, 24);
    ctx.save();
    ctx.fillStyle = "#ffd24a";
    ctx.font = "800 18px 'Segoe UI', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(fmt(game.gold), 252, 24);
    ctx.restore();

    // wave
    ctx.save();
    ctx.fillStyle = "#bfe6ef";
    ctx.font = "700 15px 'Segoe UI', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`Wave ${game.wave}`, 340, 22);
    if (game.wavePhase === "active") {
      ctx.font = "600 12px 'Segoe UI', sans-serif";
      ctx.fillStyle = "#8fb8c8";
      ctx.fillText(`${game.enemies.length + game.spawnQueue.length} foes`, 340, 38);
    } else if (game.wavePhase === "build") {
      ctx.font = "600 12px 'Segoe UI', sans-serif";
      ctx.fillStyle = "#8fb8c8";
      ctx.fillText(game.wave === 0 ? "place towers, then start" : "build phase", 340, 38);
    }
    ctx.restore();

    // right buttons
    const [sp, pa, mu] = L.rightBtns;
    this.button(ctx, sp, `${game.speed}×`, { active: game.speedIdx > 0, small: true });
    this.button(ctx, pa, game.paused ? "▶" : "❚❚", { small: true });
    this.button(ctx, mu, game.audioEnabled ? "♪" : "∅", { small: true });

    // Start Wave button (build phase)
    if (L.startWave) {
      const label = game.wave === 0 ? "⚔  Start Wave 1" : `⚔  Start Wave ${game.wave + 1}`;
      this.button(ctx, L.startWave, label, { bg: "#c98a2e", fg: "#1a1206", active: true });
    }

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

    // selected tower panel
    if (L.sel && game.selectedTower) {
      const t = game.selectedTower;
      const s = this.statsFor(game, t);
      const { panel, upgrade, sell } = L.sel;
      this.panel(ctx, panel, 8);
      ctx.save();
      ctx.textAlign = "left";
      ctx.fillStyle = "#ffd24a";
      ctx.font = "800 15px 'Segoe UI', sans-serif";
      ctx.fillText(`${TOWER_DEFS[t.type].name}  ·  Lv ${t.level}`, panel.x + 12, panel.y + 24);
      ctx.fillStyle = "#cfe6f0";
      ctx.font = "600 13px 'Segoe UI', sans-serif";
      let yy = panel.y + 46;
      if (t.type === "monastery") {
        ctx.fillText(`Buffs towers in range  ${Math.round(s.range)}`, panel.x + 12, yy);
        ctx.fillText(`+${Math.round(TOWER_DEFS[t.type].buffDmg * 100)}% dmg · +${Math.round(TOWER_DEFS[t.type].buffSpeed * 100)}% speed`, panel.x + 12, (yy += 17));
      } else {
        ctx.fillText(`Damage ${Math.round(s.damage)}   Rate ${s.rate.toFixed(1)}/s`, panel.x + 12, yy);
        yy += 17;
        ctx.fillText(`Range ${Math.round(s.range)}`, panel.x + 12, yy);
        if (t.type === "cannon") ctx.fillText(`Splash ${Math.round(s.splash)}`, panel.x + 12, (yy += 17));
        if (t.type === "lancer") ctx.fillText(`Pierce ${s.pierce}`, panel.x + 12, (yy += 17));
      }
      ctx.restore();

      if (t.level >= MAX_LEVEL) {
        this.button(ctx, upgrade, "MAX LEVEL", { bg: "#3a4a52", disabled: true });
      } else {
        const cost = upgradeCost(t.type, t.level);
        this.button(ctx, upgrade, `⬆ Upgrade  ${cost}g`, { active: true, disabled: game.gold < cost });
      }
      const refund = Math.round(t.totalInvested * 0.6);
      this.button(ctx, sell, `Sell  +${refund}g`, { bg: "#6e3038" });
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
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
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

    if (game.paused) return true;

    // right buttons
    const [sp, pa, mu] = L.rightBtns;
    if (inRect(p, sp)) {
      game.cycleSpeed();
      return true;
    }
    if (inRect(p, pa)) {
      game.togglePause();
      return true;
    }
    if (inRect(p, mu)) {
      game.toggleMute();
      return true;
    }

    // start wave
    if (L.startWave && inRect(p, L.startWave)) {
      game.startWave();
      return true;
    }

    // selected tower panel
    if (L.sel && game.selectedTower) {
      if (inRect(p, L.sel.upgrade)) {
        game.upgradeTower(game.selectedTower);
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
    const w = 260;
    const h = 60;
    return {
      start: { x: WORLD_W / 2 - w / 2, y: WORLD_H / 2 + 40, w, h } as Rect,
      help: { x: WORLD_W / 2 - w / 2, y: WORLD_H / 2 + 112, w, h } as Rect,
    };
  }

  drawMenu(game: Game, ctx: CanvasRenderingContext2D): void {
    // background: water + a decorative castle + title
    ctx.fillStyle = "#0a3540";
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    // subtle waves
    ctx.save();
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 6; i++) {
      ctx.strokeStyle = `rgba(120,190,205,${0.12 + i * 0.03})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x <= WORLD_W; x += 8) {
        const y = 120 + i * 70 + Math.sin(x * 0.03 + this.time(game) * 1.5 + i) * 6;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    // castle preview
    const castle = asAsset(this.assets.building("blue", "castle"));
    drawSprite(ctx, this.assets, castle, 0, WORLD_W / 2, 258, { scale: 1.05 });

    // title
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffd24a";
    ctx.font = "900 64px 'Segoe UI', sans-serif";
    ctx.fillText("TINY SIEGE", WORLD_W / 2, 120);
    ctx.fillStyle = "#bfe6ef";
    ctx.font = "600 20px 'Segoe UI', sans-serif";
    ctx.fillText("a tower-defense roguelite", WORLD_W / 2, 152);
    ctx.restore();

    const r = this.menuRects();
    this.button(ctx, r.start, "⚔  Start Siege", { bg: "#c98a2e", fg: "#1a1206", active: true });
    this.button(ctx, r.help, "How to Play", { small: true });

    // best
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#8fb8c8";
    ctx.font = "600 15px 'Segoe UI', sans-serif";
    ctx.fillText(`Best run: ${game.best} waves`, WORLD_W / 2, WORLD_H - 40);
    ctx.restore();

    if (game._showHelp) this.drawHelp(ctx);
  }

  private time(game: Game) {
    return game.time;
  }

  private drawHelp(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "#04141a";
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
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
    }
  }

  private overRects() {
    const w = 240;
    const h = 56;
    return {
      again: { x: WORLD_W / 2 - w / 2, y: WORLD_H / 2 + 90, w, h } as Rect,
      menu: { x: WORLD_W / 2 - w / 2, y: WORLD_H / 2 + 158, w, h } as Rect,
    };
  }

  drawOver(game: Game, ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = "#04141a";
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.restore();

    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#ff6a5a";
    ctx.font = "900 52px 'Segoe UI', sans-serif";
    ctx.fillText("THE CASTLE HAS FALLEN", WORLD_W / 2, WORLD_H / 2 - 90);
    ctx.fillStyle = "#eaf6ff";
    ctx.font = "700 26px 'Segoe UI', sans-serif";
    ctx.fillText(`You survived ${game.wave} waves`, WORLD_W / 2, WORLD_H / 2 - 20);
    ctx.fillStyle = "#bfe6ef";
    ctx.font = "600 18px 'Segoe UI', sans-serif";
    ctx.fillText(`${game.kills} enemies slain`, WORLD_W / 2, WORLD_H / 2 + 16);
    const isBest = game.wave >= game.best && game.wave > 0;
    ctx.fillStyle = isBest ? "#ffd24a" : "#8fb8c8";
    ctx.font = "700 18px 'Segoe UI', sans-serif";
    ctx.fillText(`${isBest ? "★ NEW BEST!  " : ""}Best: ${game.best} waves`, WORLD_W / 2, WORLD_H / 2 + 50);
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
}
