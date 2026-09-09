# Tiny Siege — Roadmap

_Ideas derived from competitive research (see [docs/research-competitors.md](docs/research-competitors.md) for
sources and full rationale). Ordered in recommended build sequence. Effort: S = days, M = ~1–2 weeks, L = weeks+._

---

## Phase 1 — Quick wins (clarity, juice, shareability)

### 1.1 Seeded, shareable runs — "The Same Island" (S)
- Surface the existing hidden `?seed` parameter: run-end screen shows the run's seed with a copyable
  link that reproduces the exact island, waves, and boon rolls.
- Add a **daily seed** (same island for everyone) with a local best-wave leaderboard.
- *Why:* web-native virality; mastery/score chasing; RNG seeding is already 80% built.

### 1.2 Wave intel, upgraded (S)
- Next-wave telegraph (already exists in `game.ts` as `nextWave`) shows trait icons per enemy:
  armored, flying, fast, heals, boss + weakness.
- A "Scouts" boon reveals the following wave too.
- *Why:* "fun is in certainty" (Slay the Spire); Kingdom Rush — the map asks a question, the build answers it.

### 1.3 Streaks, flawless waves, and a Chronicle run summary (S)
- Kill-streak tiers with escalating fanfare + bonus gold; "Flawless Wave" bonus when the castle is untouched.
- Run-end **Chronicle screen**: build in one line, generated build name (e.g. "The Cursed Cannonade"),
  key stats, near-miss callout ("Castle at 3 HP — 4 waves from glory"), plus the 1.1 share link.
- *Why:* Vampire Survivors feedback density; "no run ever wasted"; Kingdom Rush identity ("remember feelings").

### 1.4 Guided first run / practice wave (S–M)
- Scripted wave 1 (pawns only, generous gold), 3 contextual tooltips, an unlosable training wave.
- *Why:* PvZ onboarding benchmark; The Gate Must Stand's lack of onboarding is a top criticism of the closest comparable.

### 1.5 Attract mode on the landing (S)
- Ship the existing AI demo runs (`?demo&ff&seed`) as a looping "Watch a Siege" banner on the GitHub Pages homepage.
- *Why:* zero-install web games live or die on "understand it in 5 seconds from the landing page."

---

## Phase 2 — Run variety before the run

### 2.1 Commanders (pre-run character choice) (M)
- 3–4 commanders, each a different *kind* of defense; unlocked through the existing rune meta:
  - **The Archery Captain** — starts with a free Archer post; archer boons weighted higher.
  - **The Abbess** — Monasteries cost 30% less; starts with a free bless.
  - **The War Engineer** — first pad relocation free every wave; cannons pierce +1.
  - **The Scout** — sees the next *two* waves; +castle HP.
- Each with a portrait, one-line flavor, and a distinct first-minute feel.
- *Why:* the #1 replay hook in every survivors-like (VS 49 characters, Gate Must Stand 4 heroes,
  Monsters Are Coming city choice); funds via meta we already have; gives marketing a face.

### 2.2 Expedition modifiers — opt-in challenges for 2–3× runes (S–M)
- Before the run, opt into 0–3 modifiers: *No economy boons*, *Hardened foes* (+armor, +rewards),
  *Boss every 3rd wave*, *Mist* (range rings hidden), *One-Pad Wastes* (fewer pads),
  *Feral* (mantis/mushroom 2× faster). Each active modifier multiplies meta rewards.
- *Why:* VS challenges / StS ascension / MAC unlock-challenges convert "done with the game" into score chasing;
  cheap to build — wave-gen and boon weights are already parameterized.

---

## Phase 3 — Agency inside the wave (pick one first, then the other)

### 3.1 Siege Commands — active abilities with cooldowns (M)
- 1–2 commands usable *during* waves, chosen at run start or via boon:
  **Arrow Storm** (line damage + slow), **Field Repairs** (patch castle, brief tower boost),
  **Rally the Militia** (instant soldier burst), **Sunder** (strip armor on everything in range).
- Short cooldowns, dramatic VFX + sound.
- *Why:* Kingdom Rush heroes exist to give agency *inside* the plan, not replace it; VS active weapons are
  the drama of every stream clip; this is the near-miss moment ("saved the castle with 2s left on Rally").

### 3.2 Battlefield events — put the picks on the map (M)
- During waves, a timed event appears at a random map spot: **gold vein** (mine for gold, attracts a
  swarm), **supply crate** (pick 1 of 2 boons *now*, contextual to the build), **wounded soldier**
  (rescue for a bonus or lose him), **deserter camp** (a hostile unit shooting *your* towers — destroy it).
- *Why:* the direct answer to the "pick 1 of 3 is arbitrary" critique — choices coupled to state and
  position; Dome Keeper's "do something every second" busy-loop.

---

## Phase 4 — The signature feature

### 4.1 Tower Legendaries — upgrade tracks that *transform* (M–L)
- A tower at max level on all three tracks can **Ascend** (gold cost) into a Legendary form with a
  new behavior, not just bigger numbers:
  - Archer → **Eagle's Watch**: targets fliers, leaves a chilling wind field.
  - Lancer → **Phalanx**: rotating spear line, auto-chains to 3.
  - Cannon → **Dreadnought**: slow mega-shell that bounces 3×, leaves napalm.
  - Monastery → **Great Temple**: aura + a blessing nova every 10s.
  - Barracks → **Citadel**: soldiers hold a *wall* the enemies must break.
  - Wizard → **Archspire**: bolts chain between 4 foes.
- Art can start as tinted/upscaled existing sprites + new FX.
- *Why:* The Gate Must Stand's merge→ultimate is a headline feature of the closest comparable; turns
  end-of-run from "bigger numbers" into "my tower became something"; the most screenshot-able moment.

---

## Phase 5 — When the core is proven

### 5.1 Island variants (L)
- 2–3 path layouts: current winding path, a **T-fork** (enemies pick a branch per wave), a **double
  gate** (two castle entrances). Picked per run (or per seed).
- *Why:* MAC map choice, Kingdom Rush campaign variety; the T-fork turns wave intel into a prediction
  game ("will they come through the east gate?").

### 5.2 Weather / island mood per run (S–M, could pull forward)
- Per-run environmental state: **Fog** (range −10%, gold +15%), **Storm** (lightning strikes, arrows arc
  short), **Moonlit Night** (bosses stronger, castle +20 HP), **Dust Season** (beetles faster, fire
  burns twice as long). Announced on the start screen with an icon.
- *Why:* the cheapest run variety there is; pure atmosphere (Kingdom Rush identity).

### 5.3 Ghost sieges — async co-op (L)
- Record a run (deterministic from seed + boon picks); friends can **defend the same seed** and try to
  beat your wave count.
- *Why:* Bloons' co-op is cited as a master-differentiator; for a web game, async seed-duels get
  co-op retention without a server.

---

## Guardrails (from the research)

- **Keep the win at ~50 waves / 20–30 minutes.** Treat endless as the opt-in "one more" mode — the
  genre's reviewers punished 1-hour runs and praised endless-as-option.
- **Readability over complexity.** Every addition must survive "can the player parse it in a glance?"
- **Telegraph everything; show real numbers.** Never hide what a wave or a boon does.
- **Juice every addition.** If a new system doesn't produce feedback, it isn't done.
- **Distinctive take is the moat** — the survivor-hybrid genre is full of copycats; identity (Commanders,
  Chronicles, Legendaries) is what makes Tiny Siege *Tiny Siege*.

 ---

## Tooling — headless balance sim (built)

`npm run sim` plays seeded runs through the in-game demo bot in plain Node (no browser, no rendering;
the real simulation runs against a clean meta state). It answers the "needs a real playtest pass"
question for the endless knobs, and CI runs it on every push (artifact: console report + per-run JSON).
Details and flags are in the README.

**First findings (baseline, 50 seeds, fresh player):** the difficulty wall sits on the wave 5 / wave 10
boss waves — 100% of runs die by wave 10 (median 10, p90 11, best 15), with the castle at ~46% HP by
wave 10 start and nothing to recover it. Pre-leveled relics (level 3+) wipe out pre-siege deaths and keep
the castle at full health through wave 40, so the meta layer is currently *rescuing* a base curve that is
too harsh for a first-time player. Consequences to act on (order is a suggestion):

1. Soften the early base curve: gentler waves 4–9, a starting castle buffer, or a first-run handhold
   (1.4) that also softens the curve, not just the tutorial.
2. Revisit `ENDLESS_*` only after the base curve plays: the sim shows the endless knobs were never the
   early problem.
3. Keep the sim in CI so every balance change gets a before/after diff instead of a vibes check.

**Tuning pass (done):** the early wall was a *death spiral* (leaks never healed) plus a pacing mismatch
(armored heavies unlocked before any armor counter existed), not a raw-number problem — brute-force
levers (start gold, enemy HP slope, upgrade potency) all left the wall in place. The fixes, each A/B'd
with the sim: castle 100→125 + 5% mending per cleared wave (`CASTLE_REGEN_PCT`), boss armor pools
5→3, junkyard/shell families delayed to waves 7/10, and a guaranteed armor-counter boon at wave 10.
Result: the wave 5/10 walls are gone; the base-curve wall now sits on the **wave 15 boss** (median
15, p90 20, best 22; 88% pre-siege deaths), and level-3 relics still clear all pre-siege deaths —
the meta layer keeps its job. Item 2 (ENDLESS knobs) remains open; item 3 is live.

**Bug found by the sim:** the flying-enemy bob phase was seeded from the enemy `id`, a process-wide
counter — projectile homing/hit checks (which use `visualY`) therefore depended on how many entities
earlier runs in the same process had spawned. Fixed by deriving the phase from `pathDist`
(deterministic per run); the harness's determinism replay catches regressions of exactly this class.
