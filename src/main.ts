import { Game } from "./game";
import { WORLD_W, WORLD_H } from "./config";

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
      (window.innerWidth - pad) / WORLD_W,
      (window.innerHeight - pad) / WORLD_H
    );
    const w = Math.max(320, Math.floor(WORLD_W * scale));
    const h = Math.max(200, Math.floor(WORLD_H * scale));
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  };
  window.addEventListener("resize", fit);
  window.addEventListener("orientationchange", fit);
  fit();

  const game = new Game(canvas);
  game
    .init()
    .then(() => {
      if (fallback) fallback.remove();
    })
    .catch((err) => {
      console.error(err);
      if (fallback)
        fallback.textContent = "Failed to load game assets.\n" + (err as Error).message;
    });

  window.addEventListener("beforeunload", () => game.destroy());
}
