/**
 * DOM accessibility bridge (Phase 0 of the UI-debt work).
 *
 * The game draws everything to a canvas, so screen readers, keyboard
 * users, and any future landing-page chrome have nothing in the DOM to
 * grab onto. This module adds a thin DOM layer *around* the canvas:
 *
 *  - a visually-hidden but focusable <button> that starts a run (Tab to
 *    it, Enter to play) — the future landing page can reuse it as the
 *    real "Play" button;
 *  - an aria-live region the game announces state changes into (wave
 *    starts, boon offers, run results).
 *
 * Browser-only by construction: main.ts calls initUiDom(); the module
 * itself touches no DOM at import time, so the headless sim's bundle
 * (which never initializes it) is unaffected and every announce() call
 * is a cheap no-op there.
 */

interface Bridge {
  game: { screen: string; startRun: () => void };
  live: HTMLElement;
  playBtn: HTMLButtonElement;
}

let bridge: Bridge | null = null;

/** SR-only: removed from visual layout but still focusable/announced. */
const HIDDEN_CSS = `
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

/** Wire the DOM layer to a running game. Safe to call at most once. */
export function initUiDom(game: Bridge["game"]): void {
  if (bridge !== null || typeof document === "undefined") return;

  const style = document.createElement("style");
  style.textContent = HIDDEN_CSS;
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

  bridge = { game, live, playBtn };
  uiAnnounce("Tiny Siege loaded. Press the Play button to start a new run.");
}

/** Push a short state message into the live region (no-op in the sim). */
export function uiAnnounce(text: string): void {
  if (bridge === null) return;
  // Replace (don't append) so the region holds one current message; each
  // change is announced once by screen readers.
  bridge.live.textContent = text;
}
