/**
 * DOM accessibility bridge (Phase 0+1 of the UI-debt work).
 *
 * The game draws everything to a canvas, so screen readers, keyboard
 * users, and any future landing-page chrome have nothing in the DOM to
 * grab onto. This module adds a thin DOM layer *around* the canvas:
 *
 *  - a visually-hidden but focusable <button> that starts a run (Tab to
 *    it, Enter to play) — the future landing page can reuse it as the
 *    real "Play" button;
 *  - an aria-live region the game announces state changes into (wave
 *    starts, boon offers, run results);
 *  - Phase 1: a real end-screen card (over/victory) with the run
 *    summary as selectable text plus Copy summary / Copy link (?seed=N)
 *    / Play again / Menu buttons, and a small in-run "copy seed" chip
 *    so a bug report can carry a reproducible link.
 *
 * Browser-only by construction: main.ts calls initUiDom(); the module
 * itself touches no DOM at import time, so the headless sim's bundle
 * (which never initializes it) is unaffected and every call here is a
 * cheap no-op in the sim.
 */

interface Bridge {
  game: { screen: string; startRun: () => void; toMenu: () => void };
  live: HTMLElement;
  playBtn: HTMLButtonElement;
  /** End-screen card container (hidden unless a run just ended). */
  overlay: HTMLElement;
  /** In-run "copy seed" chip (hidden unless a run is in progress). */
  chip: HTMLButtonElement;
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

  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.id = "a11y-play";
  playBtn.className = "a11y-sr-only";
  playBtn.textContent = "Play Tiny Siege";
  playBtn.setAttribute("aria-label", "Start a new run");
  // Only acts from the menu: tabbing to it mid-run must not restart the run.
  playBtn.addEventListener("click", () => {
    if (game.screen === "menu") game.startRun();
  });
  document.body.appendChild(playBtn);

  const overlay = document.createElement("div");
  overlay.id = "end-overlay";
  overlay.hidden = true;
  document.body.appendChild(overlay);

  const chip = document.createElement("button");
  chip.type = "button";
  chip.id = "seed-chip";
  chip.hidden = true;
  document.body.appendChild(chip);

  bridge = { game, live, playBtn, overlay, chip };
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
