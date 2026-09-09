/**
 * DOM accessibility bridge (Phases 0-2 of the UI-debt work).
 *
 * The game draws everything to a canvas, so screen readers, keyboard
 * users, and any future landing-page chrome have nothing in the DOM to
 * grab onto. This module adds a thin DOM layer *around* the canvas:
 *
 *  - a visually-hidden but focusable menu button group (Play, How to
 *    Play, Codex, Armory, Progress) with roving arrow-key focus — the
 *    keyboard twin of the canvas menu, and the hook a landing page
 *    reuses for its real "Play" button;
 *  - an aria-live region the game announces state changes into (wave
 *    starts, boon offers, run results, panel changes);
 *  - Phase 1: a real end-screen card (over/victory) with the run
 *    summary as selectable text plus Copy summary / Copy link (?seed=N)
 *    / Play again / Menu buttons, and a small in-run "copy seed" chip;
 *  - Phase 2: a visible landing hero (?landing) — title + Play over
 *    the attract loop.
 *
 * Browser-only by construction: main.ts calls initUiDom(); the module
 * itself touches no DOM at import time, so the headless sim's bundle
 * (which never initializes it) is unaffected and every call here is a
 * cheap no-op in the sim.
 */

interface Bridge {
  game: {
    screen: string;
    landing: boolean;
    startRun: () => void;
    toMenu: () => void;
    landingPlay: () => void;
    menuOpenPanel: (id: "help" | "codex" | "armory" | "progress") => void;
    menuPanelOpen: () => "help" | "codex" | "armory" | "progress" | null;
    setMenuFocus: (id: string | null) => void;
  };
  live: HTMLElement;
  nav: HTMLElement;
  playBtn: HTMLButtonElement;
  overlay: HTMLElement;
  chip: HTMLButtonElement;
  hero: HTMLElement | null;
}

let bridge: Bridge | null = null;

/** SR-only: removed from visual layout but still focusable/announced. */
const BASE_CSS = `
  .a11y-sr-only {
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
`;

const OVERLAY_CSS = `
  #end-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
    background: transparent; /* the canvas paints its own dim backdrop */
  }
  #end-overlay[hidden] { display: none; }
  .end-card {
    width: min(500px, 92vw);
    max-height: min(600px, 92vh);
    overflow-y: auto;
    background: rgba(4, 20, 26, 0.94);
    border: 2px solid #2a5563;
    border-radius: 10px;
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.6);
    padding: 22px 26px;
    font-family: "Segoe UI", system-ui, sans-serif;
    color: #eaf6ff;
    text-align: center;
    user-select: text; /* the summary is meant to be copied */
  }
  .end-card h1 {
    margin: 0 0 10px;
    font-size: 30px;
    font-weight: 900;
    letter-spacing: 1px;
  }
  .end-card .end-stats {
    margin: 0 0 14px;
    font-size: 15px;
    line-height: 1.55;
    color: #bfe6ef;
    white-space: pre-line;
  }
  .end-card pre {
    margin: 0 0 16px;
    padding: 10px 12px;
    background: #04121a;
    border: 1px solid #24424e;
    border-radius: 6px;
    font: 12px/1.5 ui-monospace, "Cascadia Mono", Consolas, monospace;
    color: #9fd8e8;
    text-align: left;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .end-card .end-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
  }
  .end-card button {
    width: 100%;
    max-width: 320px;
    padding: 9px 14px;
    border-radius: 8px;
    border: 2px solid #0a222b;
    font: 700 15px "Segoe UI", system-ui, sans-serif;
    cursor: pointer;
    background: #12333d;
    color: #eaf6ff;
  }
  .end-card button:hover { background: #17424f; }
  .end-card button:focus-visible { outline: 3px solid #ffd24a; outline-offset: 2px; }
  .end-card button.primary {
    background: #c98a2e;
    border-color: #7a4d12;
    color: #1a1206;
  }
  .end-card button.primary:hover { background: #e0a13a; }
  #seed-chip {
    position: fixed;
    z-index: 10;
    padding: 3px 9px;
    border-radius: 6px;
    border: 1px solid #2a5563;
    background: rgba(4, 20, 26, 0.85);
    color: #9fd8e8;
    font: 600 11px ui-monospace, "Cascadia Mono", Consolas, monospace;
    cursor: pointer;
  }
  #seed-chip[hidden] { display: none; }
  #seed-chip:focus-visible { outline: 2px solid #ffd24a; outline-offset: 1px; }
  #landing-hero {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    background: rgba(4, 20, 26, 0.55);
    font-family: "Segoe UI", system-ui, sans-serif;
    color: #eaf6ff;
    text-align: center;
    padding: 24px;
  }
  #landing-hero[hidden] { display: none; }
  #landing-hero h1 {
    margin: 0;
    font-size: clamp(40px, 9vw, 64px);
    font-weight: 900;
    letter-spacing: 2px;
    color: #ffd24a;
  }
  #landing-hero .lh-sub {
    font-size: clamp(16px, 3vw, 22px);
    font-weight: 600;
    color: #bfe6ef;
  }
  #landing-hero .lh-note {
    font-size: 14px;
    color: #8fb8c8;
    max-width: 360px;
    line-height: 1.5;
  }
  #landing-hero #landing-play {
    margin-top: 14px;
    padding: 14px 46px;
    border-radius: 10px;
    border: 2px solid #7a4d12;
    background: #c98a2e;
    color: #1a1206;
    font: 800 22px "Segoe UI", system-ui, sans-serif;
    cursor: pointer;
  }
  #landing-hero #landing-play:hover { background: #e0a13a; }
  #landing-hero #landing-play:focus-visible { outline: 3px solid #ffd24a; outline-offset: 3px; }
`;

/** Wire the DOM layer to a running game. Safe to call at most once. */
export function initUiDom(game: Bridge["game"]): void {
  if (bridge !== null || typeof document === "undefined") return;

  const style = document.createElement("style");
  style.textContent = BASE_CSS + OVERLAY_CSS;
  document.head.appendChild(style);

  const live = document.createElement("div");
  live.className = "a11y-sr-only";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");
  document.body.appendChild(live);

  // Menu button group: the keyboard/screen-reader twin of the canvas
  // menu. Visually hidden, but focusable — arrows rove between the
  // buttons, Enter/Space (native button activation) triggers the same
  // actions as the canvas buttons.
  const nav = document.createElement("nav");
  nav.id = "menu-nav";
  nav.className = "a11y-sr-only";
  nav.setAttribute("aria-label", "Main menu");
  document.body.appendChild(nav);

  const mkMenuBtn = (
    id: string,
    label: string,
    aria: string,
    act: () => void
  ): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.id = id === "play" ? "a11y-play" : `menu-${id}`;
    b.className = "a11y-sr-only";
    b.textContent = label;
    b.setAttribute("aria-label", aria);
    b.addEventListener("click", act);
    nav.appendChild(b);
    return b;
  };
  const playBtn = mkMenuBtn("play", "Play Tiny Siege", "Start a new run", () => {
    const g = bridge;
    if (!g) return;
    if (g.game.landing) g.game.landingPlay();
    else if (g.game.screen === "menu") g.game.startRun();
  });
  mkMenuBtn("help", "How to Play", "Open How to Play", () => bridge?.game.menuOpenPanel("help"));
  mkMenuBtn("codex", "The Codex", "Open The Codex", () => bridge?.game.menuOpenPanel("codex"));
  mkMenuBtn("armory", "The Armory", "Open The Armory", () => bridge?.game.menuOpenPanel("armory"));
  mkMenuBtn("progress", "Achievements and Missions", "Open Achievements and Missions", () =>
    bridge?.game.menuOpenPanel("progress")
  );

  // Roving focus: arrows move between the menu buttons (top level only —
  // while a sub-panel is open the arrows page it instead, so we let the
  // key bubble to the game's handler).
  nav.addEventListener("keydown", (e) => {
    const g = bridge;
    if (!g) return;
    if (g.game.screen !== "menu" || g.game.landing || g.game.menuPanelOpen() !== null) return;
    if (e.key !== "ArrowRight" && e.key !== "ArrowDown" && e.key !== "ArrowLeft" && e.key !== "ArrowUp") return;
    const list = [...nav.querySelectorAll<HTMLButtonElement>("button")];
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (i === -1) return;
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
    list[(i + dir + list.length) % list.length].focus();
    e.preventDefault();
  });

  const focusIdOf = (el: Element | null): string | null => {
    if (!el) return null;
    if (el.id === "a11y-play") return "start";
    if (el.id.startsWith("menu-")) return el.id.slice(5);
    return null;
  };
  nav.addEventListener("focusin", () => {
    const g = bridge;
    if (g) g.game.setMenuFocus(focusIdOf(document.activeElement));
  });
  nav.addEventListener("focusout", (e) => {
    const to = e.relatedTarget as Node | null;
    if (!to || !nav.contains(to)) {
      const g = bridge;
      if (g) g.game.setMenuFocus(null);
    }
  });

  const overlay = document.createElement("div");
  overlay.id = "end-overlay";
  overlay.hidden = true;
  document.body.appendChild(overlay);

  const chip = document.createElement("button");
  chip.type = "button";
  chip.id = "seed-chip";
  chip.hidden = true;
  document.body.appendChild(chip);

  bridge = { game, live, nav, playBtn, overlay, chip, hero: null };
  uiAnnounce("Tiny Siege loaded. Press the Play button to start a new run.");
}

/** Push a short state message into the live region (no-op in the sim). */
export function uiAnnounce(text: string): void {
  if (bridge === null) return;
  // Replace (don't append) so the region holds one current message; each
  // change is announced once by screen readers.
  bridge.live.textContent = text;
}

// ---------------------------------------------------------------- Phase 1

export interface EndScreenData {
  kind: "over" | "victory";
  wave: number;
  kills: number;
  best: number;
  towers: number;
  seed: number | null;
  /** Waves survived past the Siege (victory + endless). 0 for pre-siege. */
  endlessWave: number;
}

/** Human/shareable one-block summary of a finished run. */
export function runSummaryText(d: EndScreenData): string {
  const result =
    d.kind === "victory"
      ? `VICTORY — the Siege was broken${d.endlessWave > 0 ? ` (endless to wave ${d.endlessWave})` : ""}`
      : `The castle fell at wave ${d.wave}`;
  const lines = [
    "Tiny Siege — run summary",
    result,
    `Best: ${d.best} waves`,
    `Kills: ${d.kills}  ·  Towers: ${d.towers}`,
  ];
  if (d.seed != null) lines.push(`Seed: ${d.seed}`);
  lines.push(`Link: ${runLink(d.seed)}`);
  return lines.join("\n");
}

/** A reproducible link for this run (?seed=N is a product URL param). */
export function runLink(seed: number | null): string {
  const base =
    typeof location !== "undefined" ? location.origin + location.pathname : "";
  return seed == null ? base : `${base}?seed=${seed}`;
}

/** Show the end-screen card (over/victory). Idempotent per run. */
export function showEndScreen(d: EndScreenData): void {
  if (bridge === null) return;
  const { overlay } = bridge;

  overlay.innerHTML = "";
  const card = document.createElement("div");
  card.className = "end-card";

  const h1 = document.createElement("h1");
  h1.textContent = d.kind === "victory" ? "THE SIEGE IS BROKEN" : "THE CASTLE HAS FALLEN";
  h1.style.color = d.kind === "victory" ? "#ffd24a" : "#ff6a5a";
  card.appendChild(h1);

  const stats = document.createElement("p");
  stats.className = "end-stats";
  const survived = d.kind === "victory" ? "You won the run" : `You survived ${d.wave} waves`;
  const bestNote = d.wave >= d.best && d.wave > 0 ? "  ★ NEW BEST" : "";
  stats.textContent = `${survived}${bestNote}\n${d.kills} enemies slain · ${d.towers} towers built`;
  card.appendChild(stats);

  const pre = document.createElement("pre");
  pre.textContent = runSummaryText(d);
  card.appendChild(pre);

  const actions = document.createElement("div");
  actions.className = "end-actions";
  const mk = (label: string, primary: boolean, fn: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    if (primary) b.className = "primary";
    b.textContent = label;
    b.addEventListener("click", fn);
    return b;
  };
  actions.appendChild(mk("⚔  Play Again", true, () => bridge?.game.startRun()));
  actions.appendChild(mk("Main Menu", false, () => bridge?.game.toMenu()));
  actions.appendChild(mk("Copy summary", false, async () => {
    const ok = await copyText(runSummaryText(d));
    flash(actions, ok ? "Copied ✓" : "Copy failed");
    uiAnnounce(ok ? "Run summary copied to clipboard." : "Could not copy to clipboard.");
  }));
  actions.appendChild(
    mk("Copy link", false, async () => {
      const ok = await copyText(runLink(d.seed));
      flash(actions, ok ? "Copied ✓" : "Copy failed");
      uiAnnounce(ok ? "Reproducible run link copied." : "Could not copy to clipboard.");
    })
  );
  card.appendChild(actions);
  overlay.appendChild(card);
  overlay.hidden = false;
}

/** Hide the end-screen card (back to menu / new run). */
export function hideEndScreen(): void {
  if (bridge === null) return;
  bridge.overlay.hidden = true;
}

/** Show the in-run seed chip (copies a reproducible link on click). */
export function showSeedChip(seed: number): void {
  if (bridge === null) return;
  const { chip } = bridge;
  chip.textContent = `⧉ seed ${seed}`;
  chip.setAttribute("aria-label", `Copy link to replay seed ${seed}`);
  chip.hidden = false;
  positionChip();
  window.addEventListener("resize", positionChip);
  chip.onclick = async () => {
    const ok = await copyText(runLink(seed));
    const old = chip.textContent;
    chip.textContent = ok ? "Copied ✓" : "Copy failed";
    uiAnnounce(ok ? "Reproducible run link copied." : "Could not copy to clipboard.");
    setTimeout(() => {
      if (chip.textContent === "Copied ✓" || chip.textContent === "Copy failed") {
        chip.textContent = old;
      }
    }, 1200);
  };
}

export function hideSeedChip(): void {
  if (bridge === null) return;
  bridge.chip.hidden = true;
  window.removeEventListener("resize", positionChip);
}

/** Park the chip at the canvas' top-right corner (the HUD top bar). */
function positionChip(): void {
  const b = bridge; // capture: a call below would reset narrowing of `bridge`
  if (b === null || b.chip.hidden) return;
  const canvas = document.getElementById("game");
  if (!canvas) return;
  const r = canvas.getBoundingClientRect();
  const chip = b.chip;
  chip.style.left = `${r.right - chip.offsetWidth - 8}px`;
  chip.style.top = `${r.top + 8}px`;
}

// ---------------------------------------------------------------- Phase 2

/** Re-apply the focus ring from the current DOM focus (e.g. after a
 *  sub-panel closes while its opener button still holds focus). */
export function resyncMenuFocus(): void {
  if (bridge === null) return;
  const ae = document.activeElement;
  if (ae instanceof HTMLButtonElement && ae.id === "a11y-play") {
    bridge.game.setMenuFocus("start");
  } else if (ae instanceof HTMLButtonElement && ae.id.startsWith("menu-")) {
    bridge.game.setMenuFocus(ae.id.slice(5));
  } else {
    bridge.game.setMenuFocus(null);
  }
}

/** Show the landing hero (?landing): title + Play over the attract loop. */
export function showLandingHero(): void {
  if (bridge === null) return;
  if (!bridge.hero) {
    const hero = document.createElement("div");
    hero.id = "landing-hero";

    const h1 = document.createElement("h1");
    h1.textContent = "TINY SIEGE";
    hero.appendChild(h1);

    const sub = document.createElement("p");
    sub.className = "lh-sub";
    sub.textContent = "a tower-defense roguelite";
    hero.appendChild(sub);

    const note = document.createElement("p");
    note.className = "lh-note";
    note.textContent =
      "The demo bot is playing behind this. Watch the run, or take the controls.";
    hero.appendChild(note);

    const play = document.createElement("button");
    play.type = "button";
    play.id = "landing-play";
    play.textContent = "⚔  Play";
    play.setAttribute("aria-label", "Start your own run");
    play.addEventListener("click", () => bridge?.game.landingPlay());
    hero.appendChild(play);

    document.body.appendChild(hero);
    bridge.hero = hero;
  }
  bridge.hero.hidden = false;
  uiAnnounce("The demo is playing. Press Play to start your own run.");
}

export function hideLandingHero(): void {
  if (bridge?.hero) bridge.hero.hidden = true;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Non-secure context or blocked clipboard: legacy fallback.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function flash(container: HTMLElement, msg: string): void {
  uiAnnounce(msg);
  const first = container.querySelector("button.primary");
  if (!first) return;
  const old = first.textContent;
  first.textContent = msg;
  setTimeout(() => {
    if (first.textContent === msg) first.textContent = old;
  }, 1200);
}
