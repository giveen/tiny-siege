# ⚔️ Tiny Siege

**A tower-defense roguelite built with the [Tiny Swords](https://www.silverhaws.net/) asset pack.**

Defend your castle on a little grass island from endless, procedurally-generated waves of
tiny invaders. Build and upgrade towers, then pick from random **boons** between waves to
stack into a powerful — or delightfully cursed — run. How many waves can you survive?

![Tiny Siege screenshot](docs/screenshot.png)

## How to play

- Enemies march from the top of the island along the dirt path toward your castle.
- Pick a tower in the bottom bar (or press `1`–`4`), then click a green build spot to place it.
- Click a built tower to open its panel: **upgrade individual stats** (Damage, Fire Rate, Range —
  the Monastery upgrades its Blessing and Aura) or **Sell** it. A range ring shows its coverage.
- Hit **Start Wave** (or press `Space`) when you're ready.
- Clear the wave to earn gold, then choose **1 of 3 random boons** for the rest of the run.
- If the castle's health hits zero, the run ends. Your best wave count is saved locally.

### Towers

| Tower        | Cost | Role                                                        |
| ------------ | ---- | ----------------------------------------------------------- |
| Archer Post  | 50   | Rapid single-target arrows. Your workhorse.                 |
| Lance Tower  | 90   | Heavy spears that pierce a line of foes.                    |
| Cannon       | 120  | Slow shells that blast a whole cluster (splash damage).     |
| Monastery    | 100  | Blesses nearby towers with +damage and +attack speed.       |

New towers unlock through boons as you get deeper.

### Enemies

Over **100 distinct creatures** from the *PixelFlush — Pixel Monsters Mega Pack*, grouped into
themed **families** (scavengers, forest, abyss, junkyard, frost, undead, volcano, phantom, …).
Waves unlock a new family every couple of rounds, and within an unlocked family a random member is
picked per spawn — so every monster in the pack shows up across a run.

- **Bosses** — one every 5th wave (double every 15th, with healer escorts), each a random pick
  from a pool of fifteen of the pack's biggest monsters: Volcano Drake, Cave Troll, Frost Yeti,
  Skeletal Rat and Dust Elemental bosses, Giant Spider, Abyss Siren, Sandworm, Forest Nymph,
  Shell Tortoise, Volcano Drakling, Happy Blob, Forest Imp and Clockwork Behemoth. The Siege at
  wave 50 is a full boss assault.
- **Healers** — a rotating pool of menders that keep nearby foes topped up.
- **Per-enemy stats and shatter armor** — every spawn rolls its own base HP (and armor) around
  the type's base, so no two identical creatures are quite alike. Armor is a late-game layer:
  nothing is armored before wave 10, and from there the share of armored foes that arrive with
  a full shatter pool climbs each wave until it's universal (bosses and elites from wave 10 on
  always carry theirs). The pool — the blue bar — must be stripped to zero before any HP can be
  dealt; Sunder and Ironbreaker bolts pierce it.
- **Flyers and poison puddlers** — some creatures fly, and the toxic sludge bursts into a
  corrosive puddle that poisons other foes on death.

The map is a large island with a long winding path and **marked stone pads** — towers can only be
built on those pads.

### Boons (the roguelite layer)

Between waves you pick one of three random boons: extra gold, stronger towers, new tower
unlocks, castle fortification, and special or *risky* effects (like the cursed gold that pays
you more but hardens every enemy). Boons are weighted by rarity (common / rare / epic) and many
can stack, so no two runs feel the same.

### Controls

| Input             | Action                          |
| ----------------- | ------------------------------- |
| `1` `2` `3` `4`   | Select tower to build           |
| Click             | Build / select tower / confirm  |
| Right-click / `Esc`| Cancel placement / deselect     |
| `Space`           | Start the next wave             |
| `P`               | Pause                           |
| `F`               | Cycle game speed (1× / 2× / 3×) |
| `M`               | Mute / unmute                   |

> **Attract mode:** open the page with `?demo` to watch the game play itself, or `?demo&ff=60&seed=1`
> to fast-forward a deterministic run.

## Run it locally

```bash
npm install
npm run dev        # start the dev server (http://localhost:5173)
```

Other scripts:

```bash
npm run build      # typecheck + production build to dist/
npm run preview    # serve the production build
npm run typecheck  # tsc only
npm run assets     # regenerate the processed asset tree (needs Python 3 + PIL + numpy)
npm run sim        # headless balance sim (see below)
```

## Balance sim (headless playtesting)

`npm run sim` plays N seeded runs through the game's own demo bot **in plain Node** — no
browser, no rendering. It drives the real simulation (towers, projectiles, waves, boons,
map growth, pad relocation) with a clean meta state, and reports where runs die:

```bash
npm run sim                                  # 50 seeds, base curve (fresh player)
npm run sim -- --seeds 20 --meta 3           # relics pre-leveled to 3 ("experienced player")
npm run sim -- --seeds 3 --diagnose          # per-run detail: board, boons, survivors
npm run sim -- --json out.json               # machine-readable results (diffed in CI)
```

Output: death-wave histogram, Siege-clear rate, endless-depth distribution, a per-wave
pressure curve (avg castle HP / gold / towers at each wave start), a determinism check
(one seed is replayed and must reproduce exactly), and an attract-mode check (after each
finished run the harness drives the real `frame()` — the browser's RAF path, including
rendering against the stub canvas — and confirms the demo auto-restarts in ~4s).
Re-run it after touching any tuning constant in `src/config.ts`, and diff the JSON.

**Current baseline** (50 seeds, fresh player): 100% of runs die before the Siege — the
wall sits on the wave 5 / wave 10 boss waves (median death wave 10, p90 11, best 15),
with the castle already at ~46% HP by wave 10 start and nothing to recover it. Pre-leveled
relics (level 3+) remove all pre-Siege deaths and keep the castle at full health through
wave 40 — the meta layer is currently *rescuing* a base curve that is too hard for a
first-time player.

## Asset pipeline

The game ships with a **pre-processed** asset tree in `public/assets/` plus a `manifest.json`,
so the browser never has to slice sprite sheets at runtime. If you change the raw art, regenerate
with the pipeline:

```bash
pip install pillow numpy
npm run assets
```

`tools/build_assets.py` reads the raw `Tiny Swords (Free Pack)/` and `enemies/` art and:

- slices variable-width horizontal sprite sheets into normalized frames (bottom-aligned,
  centered) so every unit anchors at its feet;
- extracts the 64px autotile grass tiles;
- normalizes static art (buildings, UI, decorations) to content bboxes;
- emits `manifest.json` describing every asset.

## Hosting on GitHub Pages

A GitHub Actions workflow (`.github/workflows/deploy.yml`) builds the project and deploys
`dist/` to GitHub Pages on every push to `main`. Because the Vite config uses a relative base
(`base: './'`), the game runs correctly from any `/user/repo/` path.

Enable **Settings → Pages → Source: GitHub Actions** and push to `main`.

## Credits

- **Tiny Swords (Free Pack)** — Silverhaws (the base units, buildings, tiles, UI, and FX).
- Enemy monsters: *PixelFlush — Pixel Monsters Mega Pack* (PixelFlush, Sep 2023).
- Built with [Vite](https://vitejs.dev/) + TypeScript and a hand-rolled Canvas 2D engine.
