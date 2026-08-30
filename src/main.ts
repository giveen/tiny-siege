import { Game } from "./game";
import { CANVAS_W, CANVAS_H } from "./config";

const canvas = document.getElementById("game") as HTMLCanvasElement | null;
const fallback = document.getElementById("fallback");

if (!canvas) {
  if (fallback) fallback.textContent = "Missing canvas.";
} else {
  // Keep the canvas internal resolution fixed to the world; CSS scales it to
  // fit the viewport while preserving the 1024:640 aspect ratio.
  const fit = () => {
    const pad = 0;
    const scale = Math.min(
      (window.innerWidth - pad) / CANVAS_W,
      (window.innerHeight - pad) / CANVAS_H
    );
    const w = Math.max(320, Math.floor(CANVAS_W * scale));
    const h = Math.max(200, Math.floor(CANVAS_H * scale));
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  };
  window.addEventListener("resize", fit);
  window.addEventListener("orientationchange", fit);
  fit();

  const game = new Game(canvas);
  // dev handle for verification tools (stripped from production builds)
  if (import.meta.env.DEV) (window as any).__game = game;
  // The canvas now draws its own loading screen immediately (the loop starts
  // in the Game constructor), so retire the pre-JS splash — it would sit on
  // top of the canvas and double the title.
  if (fallback) fallback.remove();
  game
    .init()
    .catch((err) => {
      console.error(err);
      if (!fallback) return;
      // Re-show the splash and turn it into a failure card.
      fallback.innerHTML = "";
      const title = document.createElement("div");
      title.className = "fb-title";
      title.textContent = "TINY SIEGE";
      const msg = document.createElement("div");
      msg.className = "fb-loading";
      msg.style.animation = "none";
      msg.style.color = "#e0a5a5";
      msg.textContent = "Failed to load game assets.\n" + (err as Error).message;
      fallback.append(title, msg);
      document.body.appendChild(fallback);
    });

  window.addEventListener("beforeunload", () => game.destroy());
}
