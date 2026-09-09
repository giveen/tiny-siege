/**
 * Static screens as real DOM (Phase 3 of the UI-debt work).
 *
 * The canvas panels for Help / Codex / Progress were drawn in a fixed
 * 1024×640 logical space: the Codex panel (1140 wide) and the bottom of
 * the Progress panel (close button, page buttons) were clipped off-canvas
 * and simply unusable. These screens are static or low-frequency — they
 * do not need 60 fps — so they live in styled DOM that fits the actual
 * viewport: copyable text, native scroll, per-item keyboard focus.
 *
 * The game stays the source of truth: `game.menuPanelOpen()` decides
 * which panel is open, and `uiPanelsSync()` (called from the game frame)
 * shows/hides/rebuilds the DOM to match. Actions (buy relic, claim, tab
 * switch) call the same game methods the canvas handlers use, and the
 * next frame's sync re-renders the changed rows. The canvas twin of a
 * DOM panel is suppressed via `hud.suppressedPanel`.
 *
 * Browser-only by construction: no DOM at import time; the sim's bundle
 * (which never calls initUiPanels) treats every export as a no-op.
 * The Armory stays canvas for now (its select→confirm and crate-reveal
 * interactions are the last slice).
 */

import type { Game } from "./game";
import {
  GEAR_BY_ID,
  GEAR_SLOTS,
  LOOTBOX_COST,
  SLOT_LABEL,
  TIER_COLORS,
  TIER_MAX,
  gearBonusText,
  gearPercent,
  gearUpgradeCost,
  nextLockedStat,
  scrapValue,
  statLabel,
  type GearInstance,
} from "./gear";
import { TOWER_DEFS, TOWER_ORDER } from "./tower";
import type { TowerType } from "./types";
import {
  RELICS,
  RELIC_BRANCHES,
  relicLevel,
  relicPrereqMet,
  type Relic,
} from "./meta";
import {
  ACHIEVEMENTS,
  LOGIN_REWARDS,
  canClaimLogin,
  isAchievementClaimed,
  isYesterday,
  missionDef,
  missionProgress,
  todayKey,
  type ProgressTab,
  type Reward,
} from "./progress";
import { resyncMenuFocus, uiAnnounce } from "./ui-dom";

type PanelId = "help" | "codex" | "progress" | "armory";

interface PanelState {
  game: Game;
  overlay: HTMLElement;
  root: HTMLElement;
  shown: PanelId | null;
  sig: string;
}

let state: PanelState | null = null;

const PANEL_CSS = `
  #panel-overlay {
    position: fixed;
    inset: 0;
    z-index: 15;
    background: rgba(4, 14, 20, 0.96);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px;
  }
  #panel-overlay[hidden] { display: none; }
  .pp {
    position: relative;
    width: min(1040px, 96vw);
    height: min(860px, 94vh);
    display: flex;
    flex-direction: column;
    background: #0c1c26;
    border: 2px solid rgba(180, 210, 225, 0.22);
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55);
    color: #eaf6ff;
    font-family: "Segoe UI", system-ui, sans-serif;
    user-select: text;
  }
  .pp-head {
    padding: 18px 22px 12px;
    text-align: center;
    border-bottom: 1px solid rgba(180, 210, 225, 0.14);
  }
  .pp-head h2 {
    margin: 0;
    font-size: 30px;
    font-weight: 900;
    letter-spacing: 1px;
    color: #ffd24a;
    outline: none;
  }
  .pp-runes {
    margin-top: 6px;
    font: 800 18px ui-monospace, "Cascadia Mono", Consolas, monospace;
    color: #b48ce0;
  }
  .pp-note {
    margin: 8px 0 0;
    font-size: 13px;
    color: #8fb8c8;
  }
  .pp-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 18px 22px;
    overscroll-behavior: contain;
  }
  .pp-foot {
    display: flex;
    justify-content: center;
    gap: 10px;
    padding: 12px;
    border-top: 1px solid rgba(180, 210, 225, 0.14);
  }
  .pp button {
    padding: 8px 16px;
    border-radius: 8px;
    border: 2px solid #0a222b;
    background: #12333d;
    color: #eaf6ff;
    font: 700 14px "Segoe UI", system-ui, sans-serif;
    cursor: pointer;
  }
  .pp button:hover { background: #17424f; }
  .pp button:focus-visible { outline: 3px solid #ffd24a; outline-offset: 2px; }
  .pp button[disabled] {
    opacity: 0.55;
    cursor: default;
    background: #0d2530;
  }
  .pp button.gold {
    background: #c98a2e;
    border-color: #7a4d12;
    color: #1a1206;
  }
  .pp button.gold:hover { background: #e0a13a; }
  .pp button.claimed {
    background: rgba(111, 224, 111, 0.14);
    border-color: rgba(111, 224, 111, 0.4);
    color: #8fe08f;
  }

  /* ---- help ---------------------------------------------------------- */
  .help-body { max-width: 720px; margin: 0 auto; }
  .help-body ul {
    margin: 14px 0;
    padding-left: 22px;
    display: grid;
    gap: 9px;
    font-size: 15px;
    line-height: 1.45;
    color: #dcecf4;
  }
  .help-keys {
    display: grid;
    gap: 6px;
    padding: 12px 14px;
    background: #0a1822;
    border: 1px solid #1d3a48;
    border-radius: 8px;
    font-size: 14px;
    color: #8fd0ff;
  }
  .help-close {
    margin-top: 16px;
    text-align: center;
    font-size: 13px;
    color: #8fb8c8;
  }

  /* ---- codex --------------------------------------------------------- */
  .codex-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(235px, 1fr));
    gap: 18px;
  }
  .branch h3 {
    margin: 0 0 10px;
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 1.5px;
    color: #b48ce0;
    text-align: center;
  }
  .relic {
    display: flex;
    gap: 10px;
    padding: 10px;
    margin-bottom: 10px;
    background: #10242f;
    border: 1px solid rgba(180, 210, 225, 0.16);
    border-radius: 10px;
  }
  .relic.locked { opacity: 0.55; }
  .relic-icon {
    width: 44px;
    height: 44px;
    flex: 0 0 44px;
    object-fit: contain;
    background: #0a1822;
    border: 1px solid #1d3a48;
    border-radius: 8px;
  }
  .relic-main { flex: 1; min-width: 0; }
  .relic-name {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    font-size: 15px;
    font-weight: 800;
  }
  .relic-lvl {
    font: 700 11px ui-monospace, "Cascadia Mono", Consolas, monospace;
    color: #8fb8c8;
    white-space: nowrap;
  }
  .relic-blurb { margin-top: 2px; font-size: 12px; color: #8fb8c8; }
  .relic-effect { margin-top: 4px; font-size: 12px; color: #9fd8a8; }
  .relic-buy {
    width: 100%;
    margin-top: 8px;
    padding: 6px 8px;
    font-size: 13px;
  }

  /* ---- progress ------------------------------------------------------ */
  .tabbar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
    padding: 10px 0 16px;
  }
  .tabbar button.active {
    background: #c98a2e;
    border-color: #7a4d12;
    color: #1a1206;
  }
  .plist {
    display: grid;
    gap: 10px;
    max-width: 780px;
    margin: 0 auto;
  }
  .prow {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 4px 14px;
    align-items: center;
    padding: 10px 14px;
    background: #10242f;
    border: 1px solid rgba(180, 210, 225, 0.14);
    border-radius: 10px;
  }
  .prow-name { font-size: 15px; font-weight: 800; }
  .prow-desc { grid-column: 1; font-size: 12px; color: #8fb8c8; }
  .prow-claim { grid-column: 2; grid-row: 1 / span 3; }
  .pbar {
    height: 9px;
    background: #0a1822;
    border-radius: 5px;
    overflow: hidden;
  }
  .pbar > div {
    height: 100%;
    background: #4a90b8;
  }
  .prow-nums {
    grid-column: 1;
    font: 600 11px ui-monospace, "Cascadia Mono", Consolas, monospace;
    color: #cfe3f5;
  }
  .streak {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
    gap: 10px;
    max-width: 900px;
    margin: 0 auto 18px;
  }
  .scell {
    padding: 12px 8px;
    text-align: center;
    background: #10242f;
    border: 1px solid rgba(180, 210, 225, 0.14);
    border-radius: 10px;
    font-size: 13px;
  }
  .scell.today { border: 3px solid #ffd24a; }
  .scell.past { border-color: rgba(111, 224, 111, 0.5); }
  .scell .day { font-weight: 800; }
  .scell.past .day { color: #6fe06f; }
  .scell.today .day { color: #ffd24a; }
  .scell .rw { margin-top: 4px; color: #eaf6ff; }
  .scell .ok { margin-top: 4px; color: #6fe06f; font-weight: 700; }
  .streak-foot { text-align: center; color: #8fb8c8; font-size: 14px; }
  .streak-btn { display: block; margin: 12px auto 0; }

  /* ---- armory -------------------------------------------------------- */
  .armory-bar { align-items: center; }
  .armory-bar .gold { margin-left: auto; }
  .armory-section {
    margin: 14px 0 10px;
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 1px;
    color: #bfe6ef;
  }
  .gear-list { margin-bottom: 8px; }
  .grow {
    display: grid;
    grid-template-columns: 44px 1fr auto auto auto;
    gap: 2px 10px;
    align-items: center;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.03);
    border: 2px solid transparent;
    border-radius: 10px;
    cursor: pointer;
  }
  .grow:hover { background: rgba(255, 255, 255, 0.06); }
  .grow.selected {
    background: rgba(255, 210, 74, 0.12);
    border-color: #ffd24a;
  }
  .grow.dim { opacity: 0.55; }
  .gear-icon {
    width: 44px;
    height: 44px;
    object-fit: contain;
    background: #0a1822;
    border: 1px solid #1d3a48;
    border-radius: 8px;
  }
  .grow-name {
    grid-column: 2;
    grid-row: 1;
    font-size: 15px;
    font-weight: 800;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .grow-tier {
    grid-column: 3;
    grid-row: 1 / span 2;
    align-self: center;
    font: 800 13px ui-monospace, "Cascadia Mono", Consolas, monospace;
  }
  .grow-bonus {
    grid-column: 4;
    grid-row: 1 / span 2;
    align-self: center;
    font-size: 12px;
    font-weight: 700;
    color: #9fd8a8;
    white-space: nowrap;
  }
  .grow-sub {
    grid-column: 2;
    grid-row: 2;
    font-size: 12px;
    color: #8fb8c8;
  }
  .grow-hint {
    grid-column: 5;
    grid-row: 1 / span 2;
    align-self: center;
    justify-self: end;
    font-size: 12px;
    color: #8fb8c8;
    white-space: nowrap;
  }
  .grow-hint.sel-hint { color: #ffd24a; font-weight: 700; }
  .grow-hint.dim { color: #5d7482; }
  .grow-btn {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
  .grow-btn:focus-visible {
    position: static;
    width: auto;
    height: auto;
    padding: 6px 12px;
    margin: 0;
    overflow: visible;
    clip: auto;
    white-space: normal;
    clip-path: inset(0);
    border: 2px solid #ffd24a;
    border-radius: 8px;
    background: #12333d;
    color: #eaf6ff;
    font: 700 13px "Segoe UI", system-ui, sans-serif;
    cursor: pointer;
    justify-self: end;
    grid-column: 5;
    grid-row: 1 / span 2;
    align-self: center;
  }
  .slotcols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 10px;
  }
  .slotcol h4 {
    margin: 0 0 6px;
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 1px;
    color: #bfe6ef;
  }
  .slotcell {
    display: grid;
    grid-template-columns: 44px 1fr;
    gap: 2px 8px;
    align-items: center;
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    margin-bottom: 8px;
    text-align: left;
    background: rgba(255, 255, 255, 0.03);
    border: 2px solid rgba(180, 210, 225, 0.12);
    border-radius: 10px;
    color: #eaf6ff;
    font-family: inherit;
    cursor: pointer;
  }
  .slotcell .gear-icon { grid-row: 1 / span 3; }
  .slotcell .slot-name {
    font-size: 13px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .slotcell.filled { border-color: rgba(180, 210, 225, 0.25); }
  .slotcell.compatible {
    border-color: #ffd24a;
    background: rgba(255, 210, 74, 0.08);
  }
  .slotcell:focus-visible { outline: 3px solid #ffd24a; outline-offset: 2px; }
  .smithgrid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 18px;
  }
  @media (min-width: 860px) {
    .smithgrid { grid-template-columns: 1fr 1fr; }
  }

  /* Supply Crate reveal */
  .reveal {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: rgba(5, 9, 13, 0.92);
    border-radius: 12px;
    cursor: pointer;
    text-align: center;
    padding: 20px;
  }
  .reveal-title {
    font: 800 20px "Segoe UI", system-ui, sans-serif;
    letter-spacing: 1px;
    color: #d2a24c;
  }
  .reveal-rare { font-size: 22px; font-weight: 900; color: #ffd24a; }
  .reveal-icon {
    width: 96px;
    height: 96px;
    border-radius: 12px;
    margin: 6px 0;
  }
  .reveal-name { font-size: 24px; font-weight: 800; }
  .reveal-tier { font-size: 18px; font-weight: 900; }
  .reveal-bonus { font-size: 15px; font-weight: 700; color: #9fd8a8; }
  .reveal-locked { font-size: 13px; color: rgba(159, 216, 168, 0.7); }
  .reveal-foot { margin-top: 8px; font-size: 14px; color: #8fb8c8; }
`;

/** Initialize the panel layer. Call once, alongside initUiDom. */
export function initUiPanels(game: Game): void {
  if (state !== null || typeof document === "undefined") return;

  const style = document.createElement("style");
  style.textContent = PANEL_CSS;
  document.head.appendChild(style);

  const overlay = document.createElement("div");
  overlay.id = "panel-overlay";
  overlay.hidden = true;
  const root = document.createElement("div");
  root.className = "pp";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  overlay.appendChild(root);
  document.body.appendChild(overlay);

  // One delegated listener survives innerHTML rebuilds.
  overlay.addEventListener("click", (e) => {
    const s = state;
    if (!s) return;
    const t = e.target as HTMLElement;
    // Click on the backdrop (outside the card) closes any panel.
    if (t === overlay) {
      s.game.closeMenuPanel();
      return;
    }
    const el = t.closest<HTMLElement>("[data-action]");
    if (!el) return;
    const g = s.game;
    const act = el.dataset.action;
    const arg = el.dataset.arg ?? "";
    if (act === "close") {
      g.closeMenuPanel();
    } else if (act === "buy-relic" && arg) {
      if (g.buyRelic(arg)) g.sfx("coin");
      else g.sfx("click");
      uiAnnounce(`Purchase attempted: ${arg}`);
    } else if (act === "tab" && arg) {
      g.hud.progressTab = arg as ProgressTab;
      g.sfx("click");
    } else if (act === "claim-ach" && arg) {
      if (g.claimAchievement(arg)) {
        g.sfx("coin");
        uiAnnounce("Achievement reward claimed.");
      } else g.sfx("click");
    } else if (act === "claim-mission") {
      const sep = arg.indexOf(":");
      if (sep < 1) return;
      const kind = arg.slice(0, sep);
      const defId = arg.slice(sep + 1);
      if (g.claimMission(kind as "daily" | "weekly" | "bounty", defId)) {
        g.sfx("coin");
        uiAnnounce("Mission reward claimed.");
      } else g.sfx("click");
    } else if (act === "claim-login") {
      if (g.claimLoginReward()) {
        g.sfx("coin");
        uiAnnounce("Daily reward claimed.");
      } else g.sfx("click");
    } else if (act === "armory-tab" && arg) {
      g.hud.armoryTab = arg === "smith" ? "smith" : "vault";
      g.hud.selectedGearUid = null;
      g.hud.crateReveal = null;
      g.sfx("click");
    } else if (act === "buy-crate") {
      const inst = g.buyLootbox();
      if (inst) {
        g.hud.crateReveal = inst;
        g.hud.selectedGearUid = null;
        g.hud.armoryTab = "vault";
        g.sfx(inst.tier >= 4 ? "castle" : "boon");
        uiAnnounce(`Supply crate opened: ${GEAR_BY_ID.get(inst.def)?.name ?? "gear"}.`);
      } else {
        g.sfx("click");
      }
    } else if (act === "dismiss-reveal") {
      g.hud.crateReveal = null;
      g.sfx("click");
    } else if (act === "select-piece" && arg) {
      // Vault: select / deselect a banked piece.
      g.hud.selectedGearUid = g.hud.selectedGearUid === arg ? null : arg;
      g.sfx("click");
    } else if (act === "recycle-pick" && arg) {
      // Smith: first click selects, second confirms the recycle.
      if (g.hud.selectedGearUid === arg) {
        const gained = g.recycleGear(arg);
        g.hud.selectedGearUid = null;
        g.sfx(gained > 0 ? "coin" : "click");
        if (gained > 0) uiAnnounce(`Recycled for ${gained} scrap.`);
      } else {
        g.hud.selectedGearUid = arg;
        g.sfx("click");
      }
    } else if (act === "upgrade-pick" && arg) {
      const ok = g.upgradeGear(arg);
      g.hud.selectedGearUid = null;
      g.sfx(ok ? "boon" : "click");
      if (ok) uiAnnounce("Gear upgraded.");
    } else if (act === "slot") {
      const sep = arg.indexOf(":");
      if (sep < 1) return;
      const tower = arg.slice(0, sep) as TowerType;
      const slot = arg.slice(sep + 1) as (typeof GEAR_SLOTS)[number];
      let equippedNow = false;
      if (g.hud.selectedGearUid) {
        const sel = g.meta.gear.owned.find((o) => o.uid === g.hud.selectedGearUid);
        const selDef = sel ? GEAR_BY_ID.get(sel.def) : null;
        if (sel && selDef && selDef.tower === tower && selDef.slot === slot) {
          g.equipGear(sel.uid, tower, slot);
          g.hud.selectedGearUid = null;
          g.sfx("coin");
          uiAnnounce(`Equipped ${selDef.name} on the ${TOWER_DEFS[tower].name}.`);
          equippedNow = true;
        }
      }
      if (!equippedNow) {
        if (g.equippedFor(tower, slot)) {
          g.unequipGear(tower, slot);
          g.sfx("click");
        } else {
          g.sfx("click");
        }
      }
    }
    // Re-render now: actions change the data the panel shows, and the
    // frame-driven sync may be seconds away on a throttled tab.
    if (act !== "close") uiPanelsSync();
  });

  state = { game, overlay, root, shown: null, sig: "" };
}

/** Reconcile the DOM panels with the game's menu state. Cheap no-op. */
export function uiPanelsSync(): void {
  const s = state;
  if (!s) return;
  const g = s.game;

  const open: PanelId | null = g.menuPanelOpen();
  const domOpen: PanelId | null = open; // all four panels render in DOM

  // Suppress the canvas twin of the panel the DOM renders (armory stays canvas).
  g.hud.suppressedPanel = domOpen;

  if (g.screen !== "menu" || domOpen === null) {
    if (s.shown !== null) hidePanel(s);
    return;
  }

  if (s.shown !== domOpen) {
    s.shown = domOpen;
    s.sig = "";
    rebuild(s, domOpen);
    s.overlay.hidden = false;
    // Land keyboard/SR focus on the panel heading.
    s.root.querySelector<HTMLElement>(".pp-head h2")?.focus();
    return;
  }

  const sig = signature(s);
  if (sig !== s.sig) {
    s.sig = sig;
    rebuild(s, domOpen);
  } else {
    updateCountdowns(s);
  }
}

function hidePanel(s: PanelState): void {
  s.shown = null;
  s.sig = "";
  s.overlay.hidden = true;
  resyncMenuFocus();
}

function signature(s: PanelState): string {
  const g = s.game;
  if (s.shown === "codex") {
    const r = g.meta.research;
    return `c|${g.meta.runes}|${r ? `${r.id}:${r.level}` : "-"}`;
  }
  if (s.shown === "progress") {
    const g = s.game;
    const m = (list: { claimed: boolean }[]) => list.map((x) => (x.claimed ? 1 : 0)).join("");
    return (
      `p|${g.hud.progressTab}|` +
      `${g.progress.claimedAchievements.join(",")}|` +
      `${m(g.progress.daily.missions)}|${m(g.progress.weekly.missions)}|${m(g.progress.bounty)}|` +
      `${g.progress.login.streakDay}|${canClaimLogin(g.progress)}`
    );
  }
  if (s.shown === "armory") {
    const g = s.game;
    const owned = g.meta.gear.owned
      .filter((o) => GEAR_BY_ID.has(o.def))
      .map((o) => `${o.uid}:${o.def}:${o.tier}`)
      .join(",");
    let eq = "";
    for (const t of TOWER_ORDER)
      for (const sl of GEAR_SLOTS) eq += `${t}${sl}:${g.meta.gear.equipped[t]?.[sl] ?? ""};`;
    return (
      `a|${g.hud.armoryTab}|${g.meta.crates}|${g.meta.scrap}|${owned}|${eq}|` +
      `${g.hud.selectedGearUid ?? "-"}|${g.hud.crateReveal ? g.hud.crateReveal.uid : "-"}`
    );
  }
  return "help";
}

function rebuild(s: PanelState, id: PanelId): void {
  const g = s.game;
  s.root.innerHTML = "";
  if (id === "help") buildHelp(s, g);
  else if (id === "codex") buildCodex(s, g);
  else if (id === "progress") buildProgress(s, g);
  else buildArmory(s, g);

  // The Supply Crate reveal sits on top of the armory panel.
  if (id === "armory" && g.hud.crateReveal) buildCrateReveal(s, g);
}

// ------------------------------------------------------------------ help

function buildHelp(s: PanelState, g: Game): void {
  void s;
  void g;
  const el = (tag: string, cls: string | null, html: string): HTMLElement => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    n.innerHTML = html;
    return n;
  };
  const lines = [
    "Enemies march from the top toward your castle.",
    "Click a tower in the bottom bar, then click a green spot to build.",
    "Click an empty pad to relocate it to any grass cell for 60g (right-click cancels).",
    "Click a built tower to Upgrade or Sell it.",
    "Survive the wave, then pick 1 of 3 random Boons (upgrades).",
    "The island grows every 5 waves — new land, a longer route, more spots.",
    "At +3 upgrades a tower can Specialize: pick one of three lines, then level it.",
    "Barracks muster soldiers who march the road and hold it against ground foes.",
    "Unlock new towers and stack powers to go deeper.",
    "Every cleared wave banks ◆ runes and supply crates (a lost run keeps them; winning pays +40 ◆ / +20 crates).",
    "Spend runes in The Codex on relics (Crate Fortune research shifts Supply Crate odds — each level takes real time) — and open crates in the Armory for gear.",
  ];
  const body = el("div", "help-body", "");
  const head = el("div", "pp-head", "");
  const h2 = document.createElement("h2");
  h2.textContent = "HOW TO PLAY";
  h2.setAttribute("tabindex", "-1");
  head.appendChild(h2);
  s.root.appendChild(head);

  const scroll = el("div", "pp-scroll", "");
  scroll.appendChild(body);
  const ul = document.createElement("ul");
  for (const ln of lines) {
    const li = document.createElement("li");
    li.textContent = ln;
    ul.appendChild(li);
  }
  body.appendChild(ul);

  const keys = el(
    "div",
    "help-keys",
    ""
  );
  for (const ln of [
    "Keys: 1-8 build · Space start wave · P pause · F speed · M mute · ＋/− zoom · Esc cancel/close panels",
    "Menu keyboard: arrows move between menu buttons; in a panel, arrows page, PageUp/PageDown switch tabs, Esc closes.",
    "Mouse: drag the map to slide around · wheel to zoom",
  ]) {
    const p = document.createElement("p");
    p.style.margin = "0";
    p.textContent = ln;
    keys.appendChild(p);
  }
  body.appendChild(keys);

  const note = el(
    "div",
    "help-close",
    "Close with Esc, the button below, or by clicking outside the panel."
  );
  body.appendChild(note);
  s.root.appendChild(scroll);

  const foot = el("div", "pp-foot", "");
  const close = document.createElement("button");
  close.type = "button";
  close.dataset.action = "close";
  close.textContent = "Close";
  foot.appendChild(close);
  s.root.appendChild(foot);
}

// ------------------------------------------------------------------ codex

function rewardText(r: Reward): string {
  const parts: string[] = [];
  if (r.runes) parts.push(`${r.runes} ◆`);
  if (r.crates) parts.push(`${r.crates} crate${r.crates === 1 ? "" : "s"}`);
  if (r.scrap) parts.push(`${r.scrap} scrap`);
  return parts.join(" · ");
}

function fmtRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function buildCodex(s: PanelState, g: Game): void {
  const head = document.createElement("div");
  head.className = "pp-head";
  const h2 = document.createElement("h2");
  h2.textContent = "THE CODEX";
  h2.setAttribute("tabindex", "-1");
  head.appendChild(h2);
  const runes = document.createElement("div");
  runes.className = "pp-runes";
  runes.textContent = `◆ ${g.meta.runes} runes`;
  head.appendChild(runes);
  const note = document.createElement("p");
  note.className = "pp-note";
  note.textContent =
    "Spend runes on relics that carry over between sieges. Research takes real time — it completes while you're away.";
  head.appendChild(note);
  s.root.appendChild(head);

  const scroll = document.createElement("div");
  scroll.className = "pp-scroll";
  const grid = document.createElement("div");
  grid.className = "codex-grid";
  const icons = g.assets.manifest.relic_icons ?? {};

  for (const branch of RELIC_BRANCHES) {
    const sec = document.createElement("section");
    sec.className = "branch";
    const h3 = document.createElement("h3");
    h3.textContent = branch.name.toUpperCase();
    sec.appendChild(h3);

    for (const id of branch.nodeIds) {
      const relic = RELICS.find((r) => r.id === id);
      if (!relic) continue;
      sec.appendChild(buildRelicCard(s, g, relic, icons[id]));
    }
    grid.appendChild(sec);
  }
  scroll.appendChild(grid);
  s.root.appendChild(scroll);

  const foot = document.createElement("div");
  foot.className = "pp-foot";
  const close = document.createElement("button");
  close.type = "button";
  close.dataset.action = "close";
  close.textContent = "Close";
  foot.appendChild(close);
  s.root.appendChild(foot);
}

function buildRelicCard(
  s: PanelState,
  g: Game,
  relic: Relic,
  iconSrc: string | undefined
): HTMLElement {
  const lvl = relicLevel(g.meta, relic.id);
  const maxed = lvl >= relic.maxLevel;
  const cost = relic.cost(lvl);
  const job = g.meta.research;
  const researching = !!job && job.id === relic.id;
  const unlocked = relicPrereqMet(g.meta, relic.id);
  const canBuy = unlocked && !maxed && !job && g.meta.runes >= cost;

  const card = document.createElement("div");
  card.className = "relic" + (unlocked ? "" : " locked");

  const icon = document.createElement("img");
  icon.className = "relic-icon";
  icon.alt = "";
  if (iconSrc) icon.src = iconSrc;
  else icon.remove();
  card.appendChild(icon);

  const main = document.createElement("div");
  main.className = "relic-main";

  const name = document.createElement("div");
  name.className = "relic-name";
  const nameSpan = document.createElement("span");
  nameSpan.textContent = relic.name;
  const lvlSpan = document.createElement("span");
  lvlSpan.className = "relic-lvl";
  lvlSpan.textContent = `LVL ${lvl}/${relic.maxLevel}`;
  name.appendChild(nameSpan);
  name.appendChild(lvlSpan);
  main.appendChild(name);

  const blurb = document.createElement("div");
  blurb.className = "relic-blurb";
  blurb.textContent = relic.blurb;
  main.appendChild(blurb);

  const effect = document.createElement("div");
  effect.className = "relic-effect";
  effect.textContent =
    lvl > 0 ? `Now: ${relic.effect(lvl)}` : `Next: ${relic.effect(1)}`;
  main.appendChild(effect);

  const buy = document.createElement("button");
  buy.type = "button";
  buy.className = "relic-buy";
  if (maxed) {
    buy.textContent = "Maxed out";
    buy.disabled = true;
  } else if (researching && job) {
    buy.textContent = `Researching… ${fmtRemaining(job.completesAt - Date.now())}`;
    buy.disabled = true;
    const cd = document.createElement("span");
    cd.dataset.cd = relic.id;
    cd.style.display = "none";
    main.appendChild(cd);
  } else if (!unlocked) {
    buy.textContent = "Locked — max the relic above first";
    buy.disabled = true;
  } else if (job) {
    buy.textContent = "Another research in progress";
    buy.disabled = true;
  } else {
    buy.dataset.action = "buy-relic";
    buy.dataset.arg = relic.id;
    buy.textContent = canBuy ? `Research · ${cost} ◆` : `Need ${cost} ◆`;
    if (!canBuy) buy.disabled = true;
    if (relic.research) buy.title = "Researches in real time";
  }
  main.appendChild(buy);
  card.appendChild(main);
  void s;
  return card;
}

/** Per-frame countdown refresh without rebuilding (focus-safe). */
function updateCountdowns(s: PanelState): void {
  const job = s.game.meta.research;
  if (!job) return;
  const el = s.root.querySelector<HTMLElement>(`[data-cd="${job.id}"]`);
  if (el) el.textContent = fmtRemaining(job.completesAt - Date.now());
}

// ---------------------------------------------------------------- progress

const TAB_DEFS: { id: ProgressTab; label: string; note: string }[] = [
  { id: "ach", label: "Achievements", note: "Lifetime goals — claim once, forever banked." },
  { id: "daily", label: "Daily", note: "Resets every day. Unclaimed progress expires at reset." },
  { id: "weekly", label: "Weekly", note: "Resets every week. Unclaimed progress expires at reset." },
  { id: "bounty", label: "Bounty", note: "No reset — claim it, then go do it again." },
  { id: "rewards", label: "Rewards", note: "Come back once a day for a reward. Miss a day and the streak resets." },
];

function buildProgress(s: PanelState, g: Game): void {
  const tab = g.hud.progressTab;
  const head = document.createElement("div");
  head.className = "pp-head";
  const h2 = document.createElement("h2");
  h2.textContent = "ACHIEVEMENTS & MISSIONS";
  h2.setAttribute("tabindex", "-1");
  head.appendChild(h2);
  const note = document.createElement("p");
  note.className = "pp-note";
  note.textContent = TAB_DEFS.find((t) => t.id === tab)?.note ?? "";
  head.appendChild(note);
  s.root.appendChild(head);

  const scroll = document.createElement("div");
  scroll.className = "pp-scroll";

  const tabbar = document.createElement("div");
  tabbar.className = "tabbar";
  tabbar.setAttribute("role", "tablist");
  for (const t of TAB_DEFS) {
    const b = document.createElement("button");
    b.type = "button";
    if (t.id === tab) b.className = "active";
    b.dataset.action = "tab";
    b.dataset.arg = t.id;
    b.textContent = t.label;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", t.id === tab ? "true" : "false");
    tabbar.appendChild(b);
  }
  scroll.appendChild(tabbar);

  if (tab === "ach") {
    const list = document.createElement("div");
    list.className = "plist";
    for (const def of ACHIEVEMENTS) {
      const cur = Math.min(def.target, g.progress.stats[def.statKey] ?? 0);
      const claimed = isAchievementClaimed(g.progress, def.id);
      const complete = cur >= def.target;
      const row = document.createElement("div");
      row.className = "prow";
      row.appendChild(text("div", "prow-name", def.name));
      // Enabled only while the goal is complete and unclaimed.
      const claim = claimBtn(
        claimed ? "Claimed" : complete ? `Claim ${rewardText(def.reward)}` : rewardText(def.reward),
        claimed ? "claimed" : complete ? "gold" : "",
        { action: "claim-ach", arg: def.id }
      );
      claim.disabled = !(complete && !claimed);
      row.appendChild(claim);
      const desc = text("div", "prow-desc", def.desc);
      row.appendChild(desc);
      const bar = document.createElement("div");
      bar.className = "pbar";
      const fill = document.createElement("div");
      fill.style.width = `${Math.min(100, (cur / def.target) * 100)}%`;
      fill.style.background = claimed ? "#6fe06f" : complete ? "#ffd24a" : "#4a90b8";
      bar.appendChild(fill);
      row.appendChild(bar);
      row.appendChild(text("div", "prow-nums", `${cur.toLocaleString()} / ${def.target.toLocaleString()}`));
      list.appendChild(row);
    }
    scroll.appendChild(list);
  } else if (tab === "rewards") {
    const streak = g.progress.login.streakDay;
    const claimable = canClaimLogin(g.progress);
    const nextDay = claimable
      ? isYesterday(g.progress.login.lastClaimDate, todayKey())
        ? (streak % 7) + 1
        : 1
      : streak;
    const grid = document.createElement("div");
    grid.className = "streak";
    LOGIN_REWARDS.forEach((rw, i) => {
      const day = i + 1;
      const isToday = claimable && day === nextDay;
      const isPast = !isToday && day <= streak;
      const cell = document.createElement("div");
      cell.className = "scell" + (isToday ? " today" : isPast ? " past" : "");
      const d = text("div", "day", day === 7 ? `DAY ${day} ★` : `DAY ${day}`);
      cell.appendChild(d);
      cell.appendChild(text("div", "rw", rewardText(rw)));
      if (isPast) cell.appendChild(text("div", "ok", "✓"));
      grid.appendChild(cell);
    });
    scroll.appendChild(grid);
    const foot2 = text("div", "streak-foot", `Current streak: day ${streak || 0}`);
    scroll.appendChild(foot2);
    const claim = document.createElement("button");
    claim.type = "button";
    claim.className = "streak-btn " + (claimable ? "gold" : "");
    claim.dataset.action = "claim-login";
    claim.textContent = claimable ? "Claim Today's Reward" : "Already claimed today";
    claim.disabled = !claimable;
    scroll.appendChild(claim);
  } else {
    const list = document.createElement("div");
    list.className = "plist";
    const missions =
      tab === "daily" ? g.progress.daily.missions : tab === "weekly" ? g.progress.weekly.missions : g.progress.bounty;
    if (missions.length === 0) {
      list.appendChild(text("p", "streak-foot", "No missions yet — reset or play to get some."));
    }
    for (const inst of missions) {
      const def = missionDef(inst.defId);
      if (!def) continue;
      const cur = missionProgress(g.progress, def, inst);
      const complete = cur >= def.amount;
      const row = document.createElement("div");
      row.className = "prow";
      row.appendChild(text("div", "prow-name", def.name));
      const claim = claimBtn(
        inst.claimed ? "Claimed" : complete ? `Claim ${rewardText(def.reward)}` : rewardText(def.reward),
        inst.claimed ? "claimed" : complete ? "gold" : "",
        { action: "claim-mission", arg: `${tab}:${def.id}` }
      );
      claim.disabled = !(complete && !inst.claimed);
      row.appendChild(claim);
      const bar = document.createElement("div");
      bar.className = "pbar";
      const fill = document.createElement("div");
      fill.style.width = `${Math.min(100, (cur / def.amount) * 100)}%`;
      fill.style.background = inst.claimed ? "#6fe06f" : complete ? "#ffd24a" : "#4a90b8";
      bar.appendChild(fill);
      row.appendChild(bar);
      row.appendChild(text("div", "prow-nums", `${cur} / ${def.amount}`));
      list.appendChild(row);
    }
    scroll.appendChild(list);
  }
  s.root.appendChild(scroll);

  const foot = document.createElement("div");
  foot.className = "pp-foot";
  const close = document.createElement("button");
  close.type = "button";
  close.dataset.action = "close";
  close.textContent = "Close";
  foot.appendChild(close);
  s.root.appendChild(foot);
}

function text(tag: string, cls: string, content: string): HTMLElement {
  const n = document.createElement(tag);
  n.className = cls;
  n.textContent = content;
  return n;
}

// ------------------------------------------------------------------ armory

/** Shared: an icon <img> for a gear def (drops the node when no icon). */
function gearIcon(g: Game, def: { icon: string }): HTMLImageElement | null {
  const icons = g.assets.manifest.gear?.icons ?? {};
  const src = icons[def.icon];
  if (!src) return null;
  const img = document.createElement("img");
  img.className = "gear-icon";
  img.alt = "";
  img.src = src;
  return img;
}

function gearRow(
  g: Game,
  inst: GearInstance,
  right: HTMLElement,
  action: { action: string; arg: string },
  selected: boolean,
  disabled: boolean
): HTMLElement {
  const def = GEAR_BY_ID.get(inst.def)!;
  const row = document.createElement("div");
  // The whole row is clickable (canvas parity); the inner button is the
  // keyboard/screen-reader path. The delegated handler resolves the
  // nearest [data-action], so both targets fire exactly one action.
  row.dataset.action = action.action;
  row.dataset.arg = action.arg;
  row.className = "grow" + (selected ? " selected" : "") + (disabled ? " dim" : "");
  const icon = gearIcon(g, def);
  if (icon) row.appendChild(icon);
  row.appendChild(text("div", "grow-name", def.name));
  const tier = text("span", "grow-tier", `T${inst.tier}`);
  tier.style.color = TIER_COLORS[inst.tier] ?? "#c9d6e2";
  const bonus = text("div", "grow-bonus", gearBonusText(def, inst.tier));
  row.appendChild(text("div", "grow-sub", `${SLOT_LABEL[def.slot]} · ${TOWER_DEFS[def.tower].name}`));
  row.appendChild(tier);
  row.appendChild(bonus);
  row.appendChild(right);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "grow-btn";
  btn.dataset.action = action.action;
  btn.dataset.arg = action.arg;
  btn.disabled = disabled;
  const verb =
    action.action === "recycle-pick" ? "Recycle" : action.action === "upgrade-pick" ? "Upgrade" : "Select";
  btn.setAttribute("aria-label", `${verb} ${def.name} (tier ${inst.tier})`);
  row.appendChild(btn);
  return row;
}

function buildArmory(s: PanelState, g: Game): void {
  const vault = g.hud.armoryTab === "vault";
  const head = document.createElement("div");
  head.className = "pp-head";
  const h2 = document.createElement("h2");
  h2.textContent = "THE ARMORY";
  h2.setAttribute("tabindex", "-1");
  head.appendChild(h2);

  const eqCount = new Set<string>();
  for (const t of TOWER_ORDER) for (const sl of GEAR_SLOTS) {
    const u = g.meta.gear.equipped[t]?.[sl];
    if (u) eqCount.add(u);
  }
  const vaultCount = g.meta.gear.owned.filter(
    (o) => GEAR_BY_ID.has(o.def) && !eqCount.has(o.uid)
  ).length;
  const status = text(
    "div",
    "pp-runes",
    vault
      ? `◆ ${vaultCount} piece${vaultCount === 1 ? "" : "s"} in the vault · ${eqCount.size} equipped  ·  ▣ ${g.meta.crates} crates`
      : `⚙ ${g.meta.scrap} scrap  ·  ▣ ${g.meta.crates} crates`
  );
  head.appendChild(status);
  const note = document.createElement("p");
  note.className = "pp-note";
  note.textContent = vault
    ? "Win gear by opening Supply Crates — clear waves to earn crates. Click a piece, then click its slot to equip. It carries into every siege."
    : "Recycle spare gear for scrap (click a piece, then click it again), then spend scrap to upgrade pieces to higher tiers. Equipped pieces can be upgraded in place.";
  head.appendChild(note);
  s.root.appendChild(head);

  const scroll = document.createElement("div");
  scroll.className = "pp-scroll";

  const tabBar = document.createElement("div");
  tabBar.className = "tabbar armory-bar";
  for (const [id, label] of [
    ["vault", "The Vault"],
    ["smith", "The Blacksmith"],
  ] as const) {
    const b = document.createElement("button");
    b.type = "button";
    if (id === g.hud.armoryTab) b.className = "active";
    b.dataset.action = "armory-tab";
    b.dataset.arg = id;
    b.textContent = label;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", id === g.hud.armoryTab ? "true" : "false");
    tabBar.appendChild(b);
  }
  const crate = document.createElement("button");
  crate.type = "button";
  crate.className = "gold";
  crate.dataset.action = "buy-crate";
  crate.textContent = `▣ Open Supply Crate · ${LOOTBOX_COST} crates`;
  crate.disabled = g.meta.crates < LOOTBOX_COST;
  tabBar.appendChild(crate);
  scroll.appendChild(tabBar);

  const sortGear = (a: GearInstance, b: GearInstance) => {
    const da = GEAR_BY_ID.get(a.def)!;
    const db = GEAR_BY_ID.get(b.def)!;
    if (da.tower !== db.tower) return TOWER_ORDER.indexOf(da.tower) - TOWER_ORDER.indexOf(db.tower);
    if (da.slot !== db.slot) return GEAR_SLOTS.indexOf(da.slot) - GEAR_SLOTS.indexOf(db.slot);
    return b.tier - a.tier;
  };
  const vaultList = g.meta.gear.owned
    .filter((o) => GEAR_BY_ID.has(o.def) && !eqCount.has(o.uid))
    .sort(sortGear);
  const upgradeList = g.meta.gear.owned.filter((o) => GEAR_BY_ID.has(o.def)).sort(sortGear);
  const sel = g.hud.selectedGearUid;
  const selDef = sel ? GEAR_BY_ID.get(g.meta.gear.owned.find((o) => o.uid === sel)?.def ?? "") : null;

  if (vault) {
    const list = document.createElement("div");
    list.className = "plist gear-list";
    if (vaultList.length === 0) {
      list.appendChild(text("p", "streak-foot", "The vault is empty — open Supply Crates to win gear."));
    }
    for (const inst of vaultList) {
      const def = GEAR_BY_ID.get(inst.def)!;
      const hint =
        sel === inst.uid
          ? text("span", "grow-hint", "selected — click a matching slot")
          : text("span", "grow-hint", `equips on the ${TOWER_DEFS[def.tower].name}`);
      list.appendChild(gearRow(g, inst, hint, { action: "select-piece", arg: inst.uid }, sel === inst.uid, false));
    }
    scroll.appendChild(list);

    const loadout = text("div", "armory-section", "TOWER LOADOUTS");
    scroll.appendChild(loadout);
    const cols = document.createElement("div");
    cols.className = "slotcols";
    for (const t of TOWER_ORDER) {
      const col = document.createElement("div");
      col.className = "slotcol";
      col.appendChild(text("h4", "", TOWER_DEFS[t].name));
      for (const sl of GEAR_SLOTS) {
        const cur = g.equippedFor(t, sl);
        const def = cur ? GEAR_BY_ID.get(cur.def) : null;
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className =
          "slotcell" +
          (cur ? " filled" : "") +
          (selDef && selDef.tower === t && selDef.slot === sl ? " compatible" : "");
        cell.dataset.action = "slot";
        cell.dataset.arg = `${t}:${sl}`;
        if (cur && def) {
          const icon = gearIcon(g, def);
          if (icon) cell.appendChild(icon);
          cell.appendChild(text("div", "slot-name", def.name));
          const tier = text("span", "grow-tier", `T${cur.tier}`);
          tier.style.color = TIER_COLORS[cur.tier] ?? "#c9d6e2";
          cell.appendChild(tier);
          cell.appendChild(text("div", "grow-bonus", gearBonusText(def, cur.tier)));
          cell.setAttribute("aria-label", `${SLOT_LABEL[sl]}: ${def.name} — click to unequip`);
        } else {
          cell.textContent = `${SLOT_LABEL[sl]} — empty`;
          cell.setAttribute("aria-label", `${SLOT_LABEL[sl]}: empty${selDef && selDef.tower === t && selDef.slot === sl ? ", click to equip selected" : ""}`);
        }
        col.appendChild(cell);
      }
      cols.appendChild(col);
    }
    scroll.appendChild(cols);
  } else {
    const grid = document.createElement("div");
    grid.className = "smithgrid";

    const rec = document.createElement("div");
    rec.appendChild(text("div", "armory-section", "RECYCLE — click a piece, then click it again"));
    for (const inst of vaultList) {
      const right =
        sel === inst.uid
          ? text("span", "grow-hint sel-hint", "click again to recycle")
          : text("span", "grow-hint", `recycle for ${scrapValue(inst)} ⚙`);
      rec.appendChild(
        gearRow(
          g,
          inst,
          right,
          { action: "recycle-pick", arg: inst.uid },
          sel === inst.uid,
          false
        )
      );
    }
    if (vaultList.length === 0) rec.appendChild(text("p", "streak-foot", "Nothing to recycle."));
    grid.appendChild(rec);

    const up = document.createElement("div");
    up.appendChild(text("div", "armory-section", "UPGRADE — spend scrap to raise a tier"));
    for (const inst of upgradeList) {
      const maxed = inst.tier >= TIER_MAX;
      const cost = maxed ? 0 : gearUpgradeCost(inst);
      const affordable = !maxed && g.meta.scrap >= cost;
      const prog = maxed ? `T${inst.tier} MAX` : `T${inst.tier} → T${inst.tier + 1}`;
      const right = maxed
        ? text("span", "grow-hint", "fully upgraded")
        : text("span", "grow-hint" + (affordable ? "" : " dim"), `⚙ ${cost}`);
      const row = gearRow(
        g,
        inst,
        right,
        { action: "upgrade-pick", arg: inst.uid },
        false,
        maxed
      );
      const name = row.querySelector(".grow-name") as HTMLElement;
      name.appendChild(document.createTextNode(`  ${prog}`));
      up.appendChild(row);
    }
    if (upgradeList.length === 0) up.appendChild(text("p", "streak-foot", "No gear yet — open Supply Crates first."));
    grid.appendChild(up);
    scroll.appendChild(grid);
  }
  s.root.appendChild(scroll);

  const foot = document.createElement("div");
  foot.className = "pp-foot";
  const close = document.createElement("button");
  close.type = "button";
  close.dataset.action = "close";
  close.textContent = "Close";
  foot.appendChild(close);
  s.root.appendChild(foot);
}

/** Supply Crate gacha reveal — covers the panel until dismissed. */
function buildCrateReveal(s: PanelState, g: Game): void {
  const inst = g.hud.crateReveal;
  if (!inst) return;
  const def = GEAR_BY_ID.get(inst.def);
  if (!def) {
    g.hud.crateReveal = null;
    return;
  }
  const tcolor = TIER_COLORS[inst.tier] ?? "#c9d6e2";
  const reveal = document.createElement("div");
  reveal.className = "reveal";
  reveal.dataset.action = "dismiss-reveal";
  reveal.setAttribute("role", "dialog");
  reveal.setAttribute("aria-label", "Supply crate opened");

  reveal.appendChild(text("div", "reveal-title", "SUPPLY CRATE OPENED"));
  if (inst.tier >= 4) {
    reveal.appendChild(text("div", "reveal-rare", inst.tier === 5 ? "★ LEGENDARY DROP ★" : "◆ RARE DROP ◆"));
  }
  const icon = gearIcon(g, def);
  if (icon) {
    icon.className = "gear-icon reveal-icon";
    reveal.appendChild(icon);
  }
  reveal.appendChild(text("div", "reveal-name", def.name));
  const tierline = text("div", "reveal-tier", `TIER ${inst.tier}  ·  ${SLOT_LABEL[def.slot]}`);
  tierline.style.color = tcolor;
  reveal.appendChild(tierline);
  reveal.appendChild(
    text("div", "reveal-bonus", `${gearBonusText(def, inst.tier)} — boosts every ${TOWER_DEFS[def.tower].name}`)
  );
  const locked = nextLockedStat(def, inst.tier);
  if (locked) {
    reveal.appendChild(
      text(
        "div",
        "reveal-locked",
        `+${gearPercent(locked, locked.unlockTier)}% ${statLabel(def.tower, locked.stat)} unlocks at T${locked.unlockTier}`
      )
    );
  }
  reveal.appendChild(text("div", "reveal-foot", "Banked to your vault — click anywhere to continue."));
  s.root.appendChild(reveal);
}

function claimBtn(label: string, cls: string, action: { action: string; arg: string } | null): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "prow-claim " + cls;
  b.textContent = label;
  if (action) {
    b.dataset.action = action.action;
    b.dataset.arg = action.arg;
  }
  return b;
}
