// Headless balance harness: plays N seeded runs through the game's own demo
// bot (the "attract mode" AI) and reports where runs die or run out of room
// to climb. This is the "real playtest pass" for the difficulty knobs in
// src/config.ts — run it after changing any balance constant and read the
// death-wave histogram + endless-depth distribution.
//
// The simulation is the real game code (game.ts update loop, towers,
// projectiles, waves, boons) with no rendering, no audio, and a fresh
// no-relic meta state per run, so the results describe the BASE curve.
//
// Usage (from the repo root):
//   npm run sim                                  # 50 seeds
//   npm run sim -- --seeds 20 --cap-seconds 900
//   npm run sim -- --seed-base 1000 --json out.json
// Args:
//   --seeds N        number of runs (default 50)
//   --seed-base N    first seed; run i uses seed N+i (default 7)
//   --cap-seconds N  max simulated game-seconds per run (default 1800)
//   --max-wave N     stop a run that is still alive at this wave (default 120)
//   --json PATH      also write machine-readable results

import "./browser_stubs";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Game } from "../src/game";
import { Assets, asAsset } from "../src/assets";
import { Sprite } from "../src/sprite";
import { Hud } from "../src/hud";
import { emptyMetaState, RELICS } from "../src/meta";
import { emptyProgress } from "../src/progress";
import { makeFakeCanvas } from "./browser_stubs";
import { SIEGE_WAVE } from "../src/config";

// `update()` is private in the browser code; the sim drives it directly.
type Steppable = { update(dt: number): void; frame(ts: number): void };

interface FakeImg {
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
}

/** Intrinsic PNG size (IHDR) — enough for the game's dimension-only reads. */
function pngSize(file: string): { w: number; h: number } | null {
  try {
    const b = readFileSync(file);
    if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  } catch {
    return null;
  }
}

/**
 * The headless Assets never loads images, but the sim's real code still reads
 * pixel dimensions in a few places (World scatters deco off the road using
 * sprite sizes; rendering-only reads never happen headless). Point every
 * manifest path at a fake image carrying the PNG's real dimensions.
 */
/** Recursively collect every "*.png" string anywhere in a nested structure. */
function collectPngPaths(o: unknown, out: Set<string>): void {
  if (typeof o === "string") {
    if (o.endsWith(".png")) out.add(o);
    return;
  }
  if (Array.isArray(o)) {
    for (const v of o) collectPngPaths(v, out);
    return;
  }
  if (o && typeof o === "object") for (const v of Object.values(o)) collectPngPaths(v, out);
}

function populateImageDims(assets: Assets, assetsRoot: string): void {
  const m = assets.manifest;
  const want = new Map<string, [number, number]>();
  const addCell = (frames: string[], cell: [number, number]) => {
    for (const f of frames) if (!want.has(f)) want.set(f, cell);
  };
  for (const color of Object.values(m.units))
    for (const unit of Object.values(color))
      for (const def of Object.values(unit)) addCell(def.frames, def.cell);
  for (const color of Object.values(m.buildings))
    for (const b of Object.values(color)) if (!want.has(b.image)) want.set(b.image, b.size);
  for (const def of Object.values(m.animatedBuildings)) addCell(def.frames, def.cell);
  const tile: [number, number] = [m.tileSize, m.tileSize];
  for (const p of [...m.tiles.grass.flat(), ...m.tiles.grass_var, ...Object.values(m.tiles.corners), m.tiles.water, m.tiles.waterfoam])
    if (!want.has(p)) want.set(p, tile);
  const d = m.deco;
  for (const p of [...d.tree, ...d.stump, ...d.bush, ...d.rock, ...d.duck, ...d.water_rock])
    if (!want.has(p)) want.set(p, [64, 64]);
  if (!want.has(d.sheep_idle.image)) want.set(d.sheep_idle.image, d.sheep_idle.size);
  if (!want.has(d.sheep_grass.image)) want.set(d.sheep_grass.image, d.sheep_grass.size);
  addCell(d.sheep_move.frames, d.sheep_move.cell);
  if (!want.has(d.goldstone.image)) want.set(d.goldstone.image, d.goldstone.size);
  for (const c of m.clouds) if (!want.has(c.image)) want.set(c.image, c.size);
  for (const def of Object.values(m.fx)) addCell(def.frames, def.cell);
  for (const def of Object.values(m.special)) addCell(def.frames, def.cell);

  // Catch-all: every PNG path anywhere in the manifest (UI buttons, gear,
  // relics, mission icons...) gets a fake with real dimensions, so no
  // sprite lookup can come back undefined.
  const all = new Set<string>();
  collectPngPaths(m, all);
  for (const [p, fb] of want) all.add(p);

  const imgs = (assets as unknown as { imgs: Map<string, FakeImg> }).imgs;
  for (const p of all) {
    const fallback = want.get(p) ?? [16, 16];
    const real = pngSize(path.join(assetsRoot, p));
    const [w, h] = real ? [real.w, real.h] : fallback;
    imgs.set(p, { width: w, height: h, naturalWidth: w, naturalHeight: h });
  }
}

// ---------------------------------------------------------------- args
interface Args {
  seeds: number;
  seedBase: number;
  capSeconds: number;
  maxWave: number;
  json: string | null;
  diagnose: boolean;
  /** Pre-level every relic to this value (0 = fresh player, no meta). */
  meta: number;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { seeds: 50, seedBase: 7, capSeconds: 1800, maxWave: 120, json: null, diagnose: false, meta: 0 };
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case "--diagnose":
        a.diagnose = true;
        break;
      case "--meta":
        a.meta = Math.max(0, parseInt(next(), 10) || 0);
        break;
      case "--seeds":
        a.seeds = Math.max(1, parseInt(next(), 10) || 1);
        break;
      case "--seed-base":
        a.seedBase = parseInt(next(), 10) || 0;
        break;
      case "--cap-seconds":
        a.capSeconds = Math.max(60, parseInt(next(), 10) || 1800);
        break;
      case "--max-wave":
        a.maxWave = Math.max(10, parseInt(next(), 10) || 120);
        break;
      case "--json":
        a.json = next() ?? null;
        break;
      default:
        console.error(`unknown arg: ${argv[i]}`);
        process.exit(2);
    }
  }
  return a;
}

// ---------------------------------------------------------------- run
interface WaveSample {
  wave: number;
  castleHpPct: number;
  gold: number;
  towers: number;
}

interface RunResult {
  seed: number;
  finalWave: number; // last wave in progress when the run ended
  ended: "died" | "cap" | "maxWave";
  reachedSiege: boolean;
  endlessDepth: number; // waves survived past the Siege (0 if never won)
  simSeconds: number;
  kills: number;
  boonsChosen: number;
  towersAtEnd: number;
  castleHpPctAtEnd: number;
  samples: WaveSample[];
  /** ms from the end screen to the attract-mode auto-restart (-1: n/a). */
  restartMs: number;
}

const DT = 1 / 30;

/** A fresh game wired for headless sim: real manifest + clean meta. */
function makeGame(assets: Assets, seed: number, metaLevel: number): Game {
  const g = new Game(makeFakeCanvas());
  g.assets = assets;
  // init() normally wires these after asset loading; the headless frame()
  // drive (attract-restart check) renders, so they must exist here too.
  const gw = g as unknown as { castleSprite: unknown; hud: unknown };
  gw.castleSprite = new Sprite(asAsset(assets.building("blue", "castle")));
  gw.hud = new Hud(assets);
  // Isolate runs: the stubbed localStorage would otherwise let one run's
  // banked runes/research leak into the next run's meta.
  g.meta = emptyMetaState();
  // Optional "experienced player": every relic pre-leveled uniformly.
  if (metaLevel > 0) {
    for (const r of RELICS) g.meta.levels[r.id] = Math.min(metaLevel, r.maxLevel);
  }
  g.progress = emptyProgress();
  g.best = 0;
  g.demo = true; // the in-game bot plays the run
  g.rngSeed = seed;
  g.startRun();
  return g;
}

/** End-of-run detail dump for --diagnose: who was on the board, what they
 *  carried, what was still alive when the run ended. */
function diagnoseRun(g: Game, res: RunResult): void {
  const line: string[] = [`\n--- diagnose seed ${res.seed} -> ${res.ended} at wave ${res.finalWave} (castle ${(100 * res.castleHpPctAtEnd).toFixed(0)}%)`];
  const boons = (g as unknown as { boonCounts: Record<string, number> }).boonCounts;
  const boonList = Object.entries(boons).map(([id, n]) => `${id}${n > 1 ? "x" + n : ""}`).join(", ");
  line.push(`  boons: ${boonList || "(none)"}`);
  const towers = g.towers.map((t) => {
    const u = t.upg;
    const spec = t.spec ? ` spec:${t.spec}${t.specLvl > 0 ? "L" + t.specLvl : ""}` : "";
    return `${t.type}(d${u.damage}r${u.rate}n${u.range}${spec})`;
  });
  line.push(`  towers: ${towers.join(" ") || "(none)"}`);
  if (res.ended === "died" && g.enemies.length > 0) {
    const near = [...g.enemies]
      .sort((a, b) => distCastle(g, a) - distCastle(g, b))
      .slice(0, 6)
      .map((e) => {
        const arm = e.armorMax > 0 ? ` armor${Math.ceil(e.armor)}/${e.armorMax}` : "";
        const fly = e.flying ? " fly" : "";
        return `${e.displayName} ${Math.round(e.hp)}/${Math.round(e.maxHp)}${arm}${fly} @${Math.round(distCastle(g, e))}px`;
      });
    line.push(`  survivors nearest castle: ${near.join(" | ")}`);
  }
  console.log(line.join("\n"));
}

function distCastle(g: Game, e: { x: number; y: number }): number {
  return Math.hypot(e.x - g.castle.x, e.y - g.castle.y);
}

function runOne(
  assets: Assets,
  seed: number,
  capSeconds: number,
  maxWave: number,
  metaLevel: number,
  diagnose: boolean
): { res: RunResult; g: Game } {
  const g = makeGame(assets, seed, metaLevel);
  const step = g as unknown as Steppable;
  const res: RunResult = {
    seed,
    finalWave: 0,
    ended: "cap",
    reachedSiege: false,
    endlessDepth: 0,
    simSeconds: 0,
    kills: 0,
    boonsChosen: 0,
    towersAtEnd: 0,
    castleHpPctAtEnd: 0,
    samples: [],
    restartMs: -1,
  };
  let t = 0;
  let lastWave = g.wave;
  while (t < capSeconds && g.wave < maxWave) {
    if (g.screen === "victory") {
      res.reachedSiege = true;
      g.continueEndless(); // keep defending, like a player at the win screen
    }
    if (g.screen !== "game") {
      res.ended = "died";
      break;
    }
    if (g.wave !== lastWave) {
      lastWave = g.wave;
      res.samples.push({
        wave: g.wave,
        castleHpPct: g.castle.hp / g.castle.maxHp,
        gold: g.gold,
        towers: g.towers.length,
      });
    }
    step.update(DT);
    t += DT;

    if (g.screen === "victory" && !res.reachedSiege) {
      res.reachedSiege = true;
      g.continueEndless();
    }
  }
  if (res.ended !== "died") res.ended = g.wave >= maxWave ? "maxWave" : "cap";
  // Read the original run's state first — the attract drive below restarts
  // the run and would reset wave/kills/towers.
  res.finalWave = g.wave;
  res.endlessDepth = Math.max(0, g.wave - SIEGE_WAVE);
  res.simSeconds = t;
  res.kills = g.kills;
  res.boonsChosen = Object.values(g["boonCounts" as keyof Game] as Record<string, number>).reduce((a, b) => a + b, 0);
  res.towersAtEnd = g.towers.length;
  res.castleHpPctAtEnd = g.castle.hp / g.castle.maxHp;
  if (diagnose) diagnoseRun(g, res);
  // Attract-mode restart: the frame() branch the browser runs but this
  // update() loop never sees. Drive the real frame() (including render,
  // no-op on the fake ctx) past the end screen and confirm a fresh run.
  if (g.demo && (g.screen === "over" || g.screen === "victory")) {
    let ts = 60000; // arbitrary monotonic base; lastTs is stale from before
    const t0 = ts;
    for (let i = 0; i < 45 * 30 && g.screen !== "game"; i++) {
      step.frame(ts);
      ts += 1000 / 30;
    }
    if (g.screen === "game") res.restartMs = Math.round(ts - t0);
  }
  return { res, g };
}

// ---------------------------------------------------------------- report
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[idx];
}

function histogram(values: number[], lo: number, span: number, hi: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let b = lo; b < hi; b += span) {
    out.push([b, values.filter((v) => v >= b && v < b + span).length]);
  }
  out.push([hi, values.filter((v) => v >= hi).length]);
  return out;
}

function printReport(results: RunResult[], args: Args, wallMs: number): void {
  const n = results.length;
  const L: string[] = [];
  const push = (s = "") => L.push(s);

  const curve =
    args.meta === 0 ? "base curve (fresh player: no relics/gear)" : `relics uniformly at level ${args.meta}`;
  push(`Tiny Siege balance sim — ${n} seed${n === 1 ? "" : "s"} (base ${args.seedBase}), ${curve}`);
  push(`dt=${DT} sim-seconds/run cap=${args.capSeconds}s, max-wave=${args.maxWave}, wall time ${(wallMs / 1000).toFixed(0)}s`);
  push();

  const died = results.filter((r) => r.ended === "died");
  const won = results.filter((r) => r.reachedSiege);
  const pre = died.filter((r) => r.finalWave < SIEGE_WAVE);
  const endless = died.filter((r) => r.finalWave >= SIEGE_WAVE);
  const still = results.filter((r) => r.ended !== "died");

  push(`Pre-siege deaths:  ${pre.length}/${n} (${Math.round((100 * pre.length) / n)}%)`);
  if (pre.length > 0) {
    const rows = histogram(pre.map((r) => r.finalWave), 1, 5, SIEGE_WAVE);
    push("  death wave:        " + rows.map(([b, c]) => `${b}-${b + 4}: ${c}`).join("  "));
  }
  push(`Siege cleared:     ${won.length}/${n} (${Math.round((100 * won.length) / n)}%)`);
  if (endless.length > 0) {
    const depths = endless.map((r) => r.endlessDepth).sort((a, b) => a - b);
    push(`Endless deaths:    ${endless.length} (median depth ${percentile(depths, 0.5)}, p90 ${percentile(depths, 0.9)})`);
    const rows = histogram(endless.map((r) => r.endlessDepth), 0, 10, Math.max(20, ...endless.map((r) => r.endlessDepth)));
    push("  depth past 50:     " + rows.map(([b, c]) => `${b}-${b + 9}: ${c}`).join("  "));
  }
  push(`Still alive at cap/maxWave: ${still.length}`);
  const deadRuns = results.filter((r) => r.ended === "died");
  if (deadRuns.length > 0) {
    const restarted = deadRuns.filter((r) => r.restartMs > 0);
    const ms = restarted.map((r) => r.restartMs).sort((a, b) => a - b);
    const med = ms.length ? percentile(ms, 0.5) : 0;
    push(`Attract auto-restart: ${restarted.length}/${deadRuns.length} end screens looped back (median ${Math.round(med)}ms)`);
  }
  push();

  const finals = results.map((r) => r.finalWave).sort((a, b) => a - b);
  push(`Final wave: min ${finals[0]}, median ${percentile(finals, 0.5)}, p90 ${percentile(finals, 0.9)}, max ${finals[finals.length - 1]}`);
  push(`Sim time:   median ${(percentile(results.map((r) => r.simSeconds).sort((a, b) => a - b), 0.5) / 60).toFixed(0)}m game time`);
  push();

  // Pressure curve: averaged across runs, sampled at each wave start.
  const waveAvg = new Map<number, { hp: number; gold: number; towers: number; n: number }>();
  for (const r of results) {
    for (const s of r.samples) {
      const a = waveAvg.get(s.wave) ?? { hp: 0, gold: 0, towers: 0, n: 0 };
      a.hp += s.castleHpPct;
      a.gold += s.gold;
      a.towers += s.towers;
      a.n++;
      waveAvg.set(s.wave, a);
    }
  }
  const marks = [5, 10, 15, 20, 25, 30, 35, 40, 45, SIEGE_WAVE, 60, 70, 80, 90, 100, 110, 120];
  push("Pressure by wave start (avg castle HP% / gold / towers across runs that reached it):");
  let line = "";
  for (const w of marks) {
    const a = waveAvg.get(w);
    if (!a || a.n === 0) continue;
    line += `  ${String(w).padStart(3)}: ${(100 * (a.hp / a.n)).toFixed(0).padStart(3)}%  ${String(Math.round(a.gold / a.n)).padStart(5)}g  ${String(Math.round(a.towers / a.n)).padStart(2)}t`;
    if (line.length > 60) {
      push(line);
      line = "";
    }
  }
  if (line) push(line);
  push();

  const lines = L.join("\n");
  console.log(lines);
  return lines;
}

// ---------------------------------------------------------------- main
function main(): void {
  const args = parseArgs(process.argv.slice(2));
  // Run from the repo root (sim_build.mjs sets the child's cwd there).
  const root = process.cwd();
  const assetsRoot = path.join(root, "public", "assets");
  const manifest = JSON.parse(readFileSync(path.join(assetsRoot, "manifest.json"), "utf8")) as Parameters<typeof Assets>[0];
  const assets = new Assets(manifest, "assets/"); // no image loading — the sim never draws
  populateImageDims(assets, assetsRoot); // but the sim does read pixel sizes

  const t0 = Date.now();
  const results: RunResult[] = [];
  for (let i = 0; i < args.seeds; i++) {
    const seed = args.seedBase + i;
    const { res: r } = runOne(assets, seed, args.capSeconds, args.maxWave, args.meta, args.diagnose);
    results.push(r);
    const tag = r.ended === "died" ? `died w${r.finalWave}` : `alive w${r.finalWave}`;
    process.stdout.write(`\r[${i + 1}/${args.seeds}] seed ${seed} -> ${tag}  `);
  }
  console.log();

  // Determinism guard: one seeded run must reproduce itself exactly.
  // (Game logic must never depend on process-level state: entity ids are a
  // process-wide counter, so nothing in the sim may use them for logic —
  // the flying-enemy bob used to, which made projectile homing depend on
  // how many entities earlier runs in the same process had spawned.)
  // --meta runs are strict too: the harness meta states never have an active
  // research job, so tickResearch's Date.now() is a no-op in the sim.
  const { res: again } = runOne(assets, args.seedBase, args.capSeconds, args.maxWave, args.meta, false);
  const first = results[0];
  const detOk =
    again.finalWave === first.finalWave &&
    again.kills === first.kills &&
    again.ended === first.ended;
  console.log(
    `Determinism check (seed ${args.seedBase} replayed): ${detOk ? "PASS" : `FAIL (first w${first.finalWave}/${first.kills}k/${first.ended} vs replay w${again.finalWave}/${again.kills}k/${again.ended})`}`
  );

  if (process.env.SIM_CHECK_STORAGE === "1") {
    const prog = localStorage.getItem("tinysiege.progress.v1");
    const meta = localStorage.getItem("tinysiege.meta.v1");
    console.log(
      `STORAGE probe: progress=${prog ? `${prog.length}B kills=${(JSON.parse(prog) as { stats: Record<string, number> }).stats.kills ?? "?"}` : "MISSING"} meta=${meta ? `${meta.length}B` : "MISSING"}`
    );
  }
  const wallMs = Date.now() - t0;
  printReport(results, args, wallMs);

  if (args.json) {
    writeFileSync(args.json, JSON.stringify({ args, deterministic: detOk, results }, null, 2));
    console.log(`JSON results -> ${args.json}`);
  }

  if (!detOk) process.exitCode = 1;
}

main();
