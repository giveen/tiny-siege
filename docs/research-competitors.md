# Competitive Research: What Makes Similar Games Successful (and What That Means for Tiny Siege)

_Research date: 2026-08-23. Compiled from web research (sources linked per section) plus a review of
the current codebase (`src/`), so every idea below is checked against what Tiny Siege already has._

---

## 1. The comparison set

Tiny Siege sits at the intersection of three proven formulas:

| Formula | Exemplars | What Tiny Siege takes from it |
| --- | --- | --- |
| Classic lane tower defense | Kingdom Rush, Bloons TD 6, Plants vs. Zombies | Fixed path, pads, escalating waves, tower economy |
| Survivors-like / horde survival | Vampire Survivors, Brotato | Auto-combat escalation, pick-1-of-3, juice, meta unlocks |
| **Tower-survivors hybrid (hot genre, 2025–2026)** | The Gate Must Stand, Monsters Are Coming! Rock & Road, Achilles: Survivor, Dome Keeper, SWT: Survivor With Towers | Towers + auto-combat + roguelite run structure in one loop |

The hybrid is the important finding: **the exact fusion Tiny Siege plays is a live, publisher-backed
genre right now** — Raw Fury shipped Monsters Are Coming! Rock & Road (Nov 2025), The Gate Must Stand
launched June 2026 with a demo-first strategy, and a Steam curator tag for "Vampire Survivors genre
games" exists to funnel players. We're building in a validated lane, not a niche.

---

## 2. What the comparables say makes each game successful

### Classic TDs — Kingdom Rush & Bloons TD 6
From the TowerWard comparison and the r/gamedesign thread on avoiding repetitive loops:

- **Kingdom Rush wins on readability and identity.** Compact maps, obvious lanes, fixed pads, and a
  clear "the map asks a question, your layout is the answer." Its heroes/spells *support the plan
  without replacing it* — active tools for emergencies, not the strategy.
- **Bloons TD 6 wins on synergy depth and mastery.** The skill is reading *tower combinations and
  upgrade paths*, complexity introduced gradually so the surface stays casual. Co-op works because
  roles split naturally (damage vs. support vs. lane coverage).
- **Both avoid loop-repetition in opposite ways:** Bloons = identical waves, optimization is the
  player's build; Kingdom Rush = variable scripting, the map itself changes the puzzle.
- **Plants vs. Zombies** remains the onboarding benchmark: *comfort before challenge* — new plants,
  enemy types, and pressure are drip-fed so casuals never feel they're studying a manual.

### Why some TDs become classics (Medium, "Niko Game Journal")
The four recurring qualities of memorable TDs: **readability** (the battlefield must be parseable at a
glance), **gradual complexity**, **feedback/juice** (repetitive actions need constant reward signals),
and **identity/personality** — "players remember feelings more than numbers." Cohesive art, memorable
enemies, and atmosphere are what separate Kingdom Rush from a thousand forgettable mobile TDs.

### Slay the Spire — the pick-1-of-3 benchmark
The Rock Paper Shotgun interview with Mega Crit (the *Intents* system) is the single most relevant
design story:

- **"Fun lies in certainty."** The game telegraphs exactly what enemies will do next, with precise
  numbers. Hiding information was tested and rejected: veterans had memorized it anyway, and
  precise telegraphs *opened* the design space (cards whose effects depend on enemy intent, like
  Spot Weakness).
- Every system is a restatement of **risk vs. reward**; power = consistency = restraint (skipping
  bad cards and removing them is often the strongest move).
- The "reveal everything" principle made the game **streamable** — everything is visible at a glance.

### Vampire Survivors — the dopamine loop
From The Conversation (BAFTA analysis) and Nathan's Notions design breakdown:

- Minimal input (movement only) + auto-attacks = **flow state**; all cognitive load goes to
  positioning and build choice.
- **Multilayered rewards** (in-run gold, between-run upgrades, a long achievement list) so *no run
  ever feels wasted*.
- Pacing alternates **domination → tension** (elites, minion swarms) to keep players in flow.
- **Near-miss psychology** (the developer's gambling background): dying at 28:59 of a 30:00 run
  *feels* like an almost-win, driving the next run.
- **Huge, casino-grade feedback**: damage numbers, pitch-varied pickup sounds, gold-raining chest
  screens, glow/size/scale on champion enemies. The breakdown counts 40+ distinct feedback channels.
- Weapon **evolutions from specific combinations** reward build planning over raw stats.
- Commercial lesson: cheap, no intrusive ads, solo-dev scope, and *copycat risk is real* — a
  distinctive take is the moat.

### The tower-survivors hybrids (our direct genre)
- **The Gate Must Stand** (reviewed June 2026): playable hero + tavern-hired towers + fences you place
  to *funnel* enemies through your kill zones; level-ups split between hero/tower upgrades and active
  abilities; towers **merge** (drop one on another) into ultimate forms (38 of them). 53
  game-altering relics; 4 heroes with distinct playstyles. The review's verdict: **core loop is
  genuinely fun and "time vanishes," but** — slow start, 1-hour runs too long, chaotic UI, no
  onboarding, unclear ability text. Players in the comments: 10 hours sunk in; "I'd like to see an
  endless option."
- **Monsters Are Coming! Rock & Road** (Raw Fury, Nov 2025; Inverse: "I can't stop playing"):
  a constantly moving city — each stage starts with a **choice of city + map** (cities buff different
  tower types, change how you earn XP, or *mirror every tower you place*); 4 resources
  (wood/stone/gold/XP) with real **prioritization tension**; unlockable cities + **special challenges**
  (gather X wood, arrange towers in a specific configuration) keep repeated runs from feeling stale.
- **Achilles: Survivor** (Early Access 2025): Survivors-like + placing defensive structures at
  coin-purchased flag points; ~20-minute runs; miniboss every few minutes; permanent upgrade tokens
  between runs. Critic: possibly too easy (EA balancing).
- **Dome Keeper** (base-defense roguelite, still shipping console ports in late 2025): mine → build
  → defend → craft; the "busy loop" of *doing something with every second* (harvest, craft, place)
  is its hook.

**Consensus from the hybrids:** the winning formula is
**auto-combat spectacle + a real planning layer + run variety (choice before the run) + opt-in
endless + tight 20–30 minute runs**. The failures are slow starts, long runs, and opaque UI.

### The counterargument: Keith Burgun on pick-1-of-3
The most-cited critique of the pattern: a paused "pick 1 of 3" screen is *low-coupling* — either one
option is obviously best (the choice is trivial) or nothing couples to your build (the choice is
random). His fixes: **put powers in the game world** (you choose *where* to go for them, and state
informs the decision), **make enemies drop them**, or make options *trade-offs* rather than free
upgrades. We don't have to abolish pick-1-of-3 (it's the genre's language now) — but we can make
Tiny Siege's boon screen feel coupled to the run instead of arbitrary.

---

## 3. Cross-cutting success principles (the short list)

1. **Readability first.** If the battlefield can't be parsed in a glance, strategy dies. (KR, StS, classics)
2. **Fun is in certainty.** Telegraph enemy behavior and show real numbers; hide nothing. (StS)
3. **Gradual complexity.** Drip-feed enemy types, towers, and systems; never dump the manual. (BTD6, PvZ)
4. **Juice is the loop.** Dozens of small feedback channels per action, not a few big ones. (VS)
5. **No run is wasted.** Meta progression + near-miss endings + a long unlock/achievement list. (VS, GMS)
6. **Identity beats systems.** Named bosses, flavor, atmosphere — players remember feelings. (KR)
7. **Runs are 20–30 minutes; endless is opt-in.** 1-hour runs draw complaints; endless-as-option draws praise. (GMS comments, Achilles)
8. **Couple choices to state.** Pick options should interact with the player's build/position; free "obvious best" options waste the decision. (Burgun, StS synergy design)
9. **Run variety before the run.** A pre-run choice (hero, map, city, modifier) is the #1 replay hook in every successful survivors-like. (VS, MAC, GMS)
10. **Novelty is the moat.** Copycat risk is the genre's defining threat — a distinctive take is what makes players remember you. (VS post-mortem)

---

## 4. Gap analysis: Tiny Siege today vs. the comparables

**Already strong** (verified in code):
- Next-wave telegraph during build (`game.ts:129` — `nextWave` composition pre-generated).
- 6 tower types × 3 upgrade tracks × 3 levels (33 upgrade tracks — Bloons-tier depth per tower).
- 26 boons with rarity weights + risky/cursed options; per-tower gear (30 items, 3 slots, tiers).
- Meta: rune economy, relic tree with real-time research, supply crates, blacksmith recycling.
- Soldiers that fight *on the path* (unique vs. most comparables — it's a hybrid already).
- Relocatable build pads (SPOT_MOVE_COST) — a strategic layer rare even in KR.
- Endless mode after the Siege win; 1×/2×/3× speed; seeded runs (hidden `?seed` param).
- Attract/demo mode (`?demo&ff&seed`).

**Missing vs. the comparables:**
- **No pre-run choice** — every run starts identically (VS: 49 characters; MAC: city+map; GMS: 4 heroes).
- **No active player agency during waves** — it's fully passive once the wave starts (KR heroes, VS actives, GMS ability cooldowns are all a core part of the drama).
- **No opt-in difficulty/modifiers** for higher meta rewards (VS challenges, StS ascension, MAC special challenges).
- **No tower "ultimate" identity** — upgrades raise stats but never transform the tower (GMS merge→ultimate is a headliner).
- **No run differentiation on the map itself** — same island every run (MAC map variety).
- **Seed is hidden** — the infrastructure for shareable/deterministic runs exists but players can't see or use it.
- **No onboarding/tutorial** (PvZ benchmark; GMS was criticized exactly for this).
- **No run-summary "identity" moment** — the end screen is a score, not a story (KR personality; VS result screens).

---

## 5. New ideas, mapped to the research

Effort: S = days, M = ~1–2 weeks, L = weeks+. All scoped to the existing engine.

### Quick wins

**W1. Seeded, shareable runs — "The Same Island" (effort S)**
The RNG is already seedable from a URL param. Surface it: the run-end screen shows a **Seed** with a
copyable link that reproduces the exact island, waves, and boon rolls. Add a **daily seed** (same
island for everyone, best wave = local leaderboard). *Why:* web-native virality (share a link, a
friend challenges you), StS-style mastery ("my build beat island 20260823 at wave 61"), and the
infrastructure is 80% built.

**W2. Wave intel, upgraded (effort S)**
The next-wave telegraph exists — make it *complete*: trait icons per enemy (armored, flying,
fast, heals, boss + its weakness) so the build phase is a real "read the map, answer the question"
puzzle like Kingdom Rush. A "Scouts" boon reveals the following wave too. *Why:* "fun is in
certainty" (StS) + the KR lesson that the map should *ask a question*.

**W3. Streaks, flawless waves, and a Chronicle run summary (effort S)**
Kill-streak tiers with escalating fanfare + bonus gold; "Flawless Wave" bonus (castle untouched);
at run end, a **Chronicle screen**: your build in one line, a generated build name ("The Cursed
Cannonade"), key stats, the near-miss callout ("Castle at 3 HP, 4 waves from glory"), and the W1
share link. *Why:* VS feedback density + "no run ever wasted" + KR identity ("remember feelings").

**W4. Guided first run / practice wave (effort S–M)**
Script wave 1 (pawns only, generous gold), 3 contextual tooltips, and an unlosable "training wave"
that the castle can't die in. *Why:* PvZ onboarding is the genre's benchmark; GMS's lack of
onboarding is a top criticism of the closest comparable.

**W5. Attract mode on the landing (effort S)**
We already have AI-driven demo runs — ship them as a "Watch a Siege" banner on the GitHub Pages
homepage, looping. *Why:* zero-install web games live or die on "can I understand it in 5 seconds
from the landing page."

### Medium bets

**M1. Commanders (pre-run character choice) (effort M)**
3–4 commanders, each a different *kind* of defense, unlocked through the existing rune meta:
- **The Archery Captain** — starts with one free Archer post + arcy boons weighted higher.
- **The Abbess** — Monasteries cost 30% less; starts with a free bless.
- **The War Engineer** — first pad relocation free every wave; cannons pierce +1.
- **The Scout** — sees the next *two* waves; +castle HP.
Each commander is a full identity: portrait, one-line flavor, a distinct first-minute feel.
*Why:* #1 replay hook in every survivors-like (VS 49 chars, GMS 4 heroes, MAC cities); the meta
already exists to fund unlocks; it also gives marketing a face ("play as the Abbess").

**M2. Siege Commands — active abilities with cooldowns (effort M)**
1–2 commands usable *during* waves, chosen at run start or via boon: **Arrow Storm** (line damage +
slow), **Field Repairs** (patch castle, brief tower boost), **Rally the Militia** (instant soldier
burst), **Sunder** (armor strip on everything in range). Short cooldowns, dramatic VFX + sound.
*Why:* KR's heroes exist to give the player agency *inside* the plan ("they support the plan, they
don't replace it"); VS active weapons are the drama of every stream clip; it's also the near-miss
moment ("I saved the castle with 2 seconds left on Rally").

**M3. Expedition modifiers — opt-in challenges for 2–3× runes (effort S–M)**
Before the run, opt into 0–3 modifiers: *No economy boons*, *Hardened foes (+armor, +rewards)*,
*Boss every 3rd wave*, *Mist (range rings hidden)*, *One-Pad Wastes (fewer pads)*, *Feral (mantis/mushroom 2× faster)*. Each active modifier multiplies meta rewards. *Why:* VS challenges, StS
ascension, MAC unlock-challenges all exist to convert "done with the game" players into score
chasers; cheap to build since wave-gen and boon weights are already parameterized.

**M4. Battlefield events — put the picks on the map (effort M)**
During waves, a timed event appears at a random map spot and the player *moves to it*: **gold vein**
(mine for gold, but it attracts a swarm), **supply crate** (pick 1 of 2 boons *right now*, contextual
to your build), **wounded soldier** (rescue for a bonus or lose him), **deserter camp** (a hostile
unit is shooting *your* towers — destroy it or take the damage). *Why:* this is precisely Burgun's
critique of pick-1-of-3 answered — choices coupled to game state and position, not a paused
menu; it's also Dome Keeper's "do something every second" busy-loop, which is what keeps
auto-combat games from feeling like TV.

**M5. Weather / island mood per run (effort S–M)**
Per-run environmental state that changes the *feel* and a little of the math: **Fog** (range −10%,
gold +15%), **Storm** (occasional lightning strike — free damage, but arrows arc short), **Moonlit
Night** (bosses stronger, castle +20 HP), **Dust Season** (beetles faster, fire boons burn twice as
long). Announced on the start screen with an icon. *Why:* MAC's per-map "different mixes of
resources and spawns" — the cheapest possible run variety, and pure atmosphere (KR identity).

### Big bets

**B1. Tower Legendaries — upgrade tracks that *transform* (effort M–L)**
When a tower hits max level on all three tracks, it can **Ascend** (gold cost) into a Legendary
form with a new behavior, not just bigger numbers:
- Archer → **Eagle's Watch**: targets fliers, leaves a chilling wind field.
- Lancer → **Phalanx**: rotating spear line, auto-chains to 3.
- Cannon → **Dreadnought**: slow mega-shell that bounces 3×, leaves napalm.
- Monastery → **Great Temple**: aura + a blessing nova every 10s.
- Barracks → **Citadel**: soldiers hold a *wall* the enemies must break.
- Wizard → **Archspire**: bolts chain between 4 foes.
Art can start as tinted/upscaled existing sprites + new FX. *Why:* GMS's merge→ultimate is a
headline feature of the closest comparable; it turns the end of a run from "bigger numbers" into
"my tower became something"; it's the ultimate build fantasy and the most screenshot-able moment in
the game.

**B2. Island variants (effort L)**
2–3 path layouts (current winding path, a "T-fork" where the enemy picks a branch per wave, a
"double gate" with two castle entrances), picked per run (or per W1 seed). *Why:* MAC's map choice,
KR's campaign variety; the T-fork especially turns the wave preview (W2) into a real prediction
game — "will they come through the east gate?"

**B3. Ghost sieges — async co-op (effort L)**
Record a run (it's fully deterministic from seed + boon picks); a friend can **defend the same seed**
and try to beat your wave count. *Why:* Bloons' co-op is cited as a master-differentiator; for a
web game, async seed-duels get co-op's retention without a server.

---

## 6. Recommended sequence

1. **W1–W5** (one sprint): seed sharing, wave intel, streaks + Chronicle, tutorial, attract landing.
   All low-risk, all improve the existing loop's clarity and shareability.
2. **M1 + M3** (next): Commanders + modifiers. This is the "run variety before the run" hook the
   research says every successful survivors-like has — and it's the biggest gap we have.
3. **M2 or M4** (pick one): active commands if we want more drama/agency; battlefield events if we
   want more "always doing something." (Ideally both, staggered.)
4. **B1 Legendaries**: the signature feature — the thing screenshots and "my run" stories are made of.
5. **B2/B3**: when the core is proven; island variants first, ghost sieges when we have a community.

Pacing note from the research: keep the *win* at ~50 waves as the 20–30-minute target run, and treat
endless as the opt-in "one more" mode — the genre's reviewers punished 1-hour runs and praised
endless-as-option.

---

## 7. Sources

Read in full:
- TowerWard — *Kingdom Rush vs Bloons TD 6* (Apr 2026): https://towerward.com/blog/kingdom-rush-vs-bloons-td-6
- Niko Game Journal (Medium) — *Why Some Tower Defense Games Become Classics* (May 2026): https://medium.com/@nikogamejournal/why-some-tower-defense-games-become-classics-while-others-are-quickly-forgotten-1cf8610c9f5b
- GamingOnLinux — *'The Gate Must Stand' is total chaos* (Jun 2026, incl. player comments): https://www.gamingonlinux.com/2026/06/blending-vampire-survivors-and-tower-defense-the-gate-must-stand-is-total-chaos/
- Inverse — *Steam Just Added A Surprising Twist On 'Vampire Survivors'* on Monsters Are Coming! (Nov 2025): https://www.inverse.com/gaming/monsters-are-coming-tower-defense-survival
- GameSpew — *Achilles: Survivor puts a tower defence spin on the Survivors-like* (Jan 2025): https://www.gamespew.com/2025/01/achilles-survivor-early-access-impressions/
- GameWatcher — *Raw Fury sets release dates… Monsters Are Coming! Rock & Road / Dome Keeper Xbox port* (Oct 2025): https://www.gamewatcher.com/raw-fury-sets-routine-launch-for-december-tower-survivor-hybrid-monsters-are-coming-rock-and-road-coming-in-november
- Rock Paper Shotgun — *Why revealing all is the secret of Slay the Spire's success* (Mega Crit interview): https://www.rockpapershotgun.com/why-revealing-all-is-the-secret-of-slay-the-spires-success
- Keith Burgun — *"Pick 1 of 3" is a missed game design opportunity*: http://keithburgun.net/pick-1-of-3-is-a-missed-game-design-opportunity/
- The Conversation (Univ. of Portsmouth) — *Vampire Survivors: how developers used gambling psychology to create a BAFTA-winning game*: https://theconversation.com/vampire-survivors-how-developers-used-gambling-psychology-to-create-a-bafta-winning-game-203613
- Nathan's Notions — *Game Design Basics: Vampire Survivors* (feedback-channel breakdown, Jun 2025): https://nathansnotions.wordpress.com/2025/06/19/game-design-basics-vampire-survivors/

Seen in search results (not read in full):
- r/gamedesign — *Dealing with a repetitive game loop in tower defense* (BTD vs KR loop analysis): https://www.reddit.com/r/gamedesign/comments/1cntdju/dealing_with_a_repetitive_game_loop_in_tower/
- PCGamesN — *Monsters are Coming! Rock and Road* preview (Nov 2025): https://www.pcgamesn.com/monsters-are-coming-rock-and-road/preview
- Steam — *SWT: Survivor With Towers*: https://store.steampowered.com/app/3433250/SWT_Survivor_With_Towers/
- piened.com — *New roguelike turns Vampire Survivors into a tower defense game on wheels*: https://piened.com/new-roguelike-turns-vampire-survivors-into-a-tower-defense-game-on-wheels/
- r/roguelites — *Did Slay the Spire invent the "choose 1 out of 3" mechanic?*: https://www.reddit.com/r/roguelites/comments/18px8rs/did_slay_the_spire_invent_the_choose_1_out_of_3/
