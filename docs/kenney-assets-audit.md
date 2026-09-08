# Kenney All-in-1 3.7.0 — Asset Audit for Tiny Siege

_Source: `/mnt/storage/Kenney Game Assets All-in-1 3.7.0` (purchased 2026)._

**License:** every pack is **CC0 1.0** (verified on the pack previews) — free for personal,
educational and commercial use, no permission required, credit optional. We can take whatever
we want with zero license friction.

**Style reference (the fit test):** the game is chunky top-down pixel art with heavy black
outlines (Tiny Swords) on flat teal water, with dark rounded canvas-drawn UI panels.
Two Kenney families fit:

- **Pixel family** (`Tiny *`, `RTS Medieval (Pixel)`, `Character Pack`, `UI Pixel Pack`,
  `Input Prompts Pixel`) — 16 px, same top-down orientation. Their strokes are lighter than
  Tiny Swords' outlines, so they read as "simpler sibling art" rather than a jolt.
- **Flat/tintable white family** (icon sets, particle/explosion packs) — no outline, but the
  game's *UI* is exactly that flat rounded style, and white silhouettes can be tinted to any
  game color. These are perfect for UI, FX, and icons; poor for in-world units.

What does **not** fit: all 3D kits, all isometric packs, the vector `Tower Defense` pack,
platformer/roguelike-dungeon packs (wrong camera), `Medieval Weapons` (3D models), and
`Foliage Pack`/`Background Elements` (flat vector — our terrain is already better than this).

---

## Tier 1 — do first: juice, sound, and icons (small, high payoff)

### 1. `Audio/Interface Sounds` (100 ogg, 1.4 MB) — UI polish
The single cheapest upgrade to game feel. The game currently has 13 SFX and a bare UI.
Candidates: `click_001..005`, `confirmation_001..004`, `error_001..008`, `drop_001..004`,
`back_001..004`, `glass_*`, `glitch_*`, `hover_*`.
**Wires into:** tower build/sell/upgrade, boon pick (confirmation), invalid-spot / can't-afford
(error), pause/speed/mute buttons, drop sound for gold pickups (we already have `coin.ogg`,
keep it).

### 2. `Audio/Impact Sounds` (130 ogg, 1.6 MB) — combat depth
14 impact families × heavy/medium/light × 5 variants: `impactBell`, `impactPlate`,
`impactMetal`, `impactPunch`, `impactWood`, `impactGlass`, `impactSoft`, `impactMining`,
`impactTin`, `impactGeneric`, `impactPlank`.
**Wires into:**
- **Shatter armor breaking** (the blue pool) — `impactPlate`/`impactMetal` = a signature sound
  for a signature mechanic.
- Cannon shell hits (`impactMetal_heavy`), boss/elite deaths (`impactPunch_heavy`),
  castle damage (`impactBell_heavy`), spear impact (`impactWood`).
Footsteps in the same folder (`footstep_grass_*`) are a nice ambient option for waves.

### 3. `Icons/Game Icons` + `Game Icons Expansion` (4.1 MB, white, tintable)
~400 flat monochrome icons in our UI's visual language: arrows, pause/play, info, gear, heart,
coin, medal, flag, question, plus, shield variants (the Expansion has **damage-state shields** —
ready-made armor icons), **refresh arrows (cooldown rings)**, clouds, gem, key, cross.
**Wires into (roadmap items):**
- **1.2 Wave intel** — per-enemy trait icons: shield=armored, winged/arrow=flying, bolt=fast,
  plus=heals, star=crown=boss, skull=weakness.
- **5.2 Weather** — cloud icons for Fog/Storm/Moonlit/Dust announcements.
- **3.1 Siege Commands** — command icons + cooldown indicator (expansion refresh arrows).
- Boon category icons, pause/speed/mute buttons, run-end stats (medal/flag/heart/coin).

### 4. `2D assets/Particle Pack` + `Explosion Pack` + `Smoke Particles` (15 MB + 0.5 MB + 6 MB)
White/neutral FX sprites: sparks, glints, rings, bursts, shockwaves, smoke puffs. Tintable.
Current `fx.ts` is circles and arcs only — these make every hit, coin, boon, and boss death
*feel* real (the "juice every addition" guardrail).
**Wires into:** hit sparks (per tower type), coin glints, boon-select burst, cannon blast
ring, boss death explosion, healer pulse, poison puddle shimmer.

### 5. `Audio/Music Jingles` + `Audio/Music Loops` (7.5 MB)
- **Jingles (Retro)**: 17 short loops — wave-clear fanfare, boon pick, boss warning stinger,
  run-end jingle.
- **Loops**: 19 named tracks + 5 retro. Standouts: `Game Over.ogg`, `Infinite Descent.ogg`
  (boss-wave theme), `Sad Town.ogg` (defeat screen), `Wacky Waiting.ogg` (between-wave
  tension). The `Audio.ts` crossfade engine already supports arbitrary track lists — adding
  tracks is config-only.

## Tier 2 — roadmap content

### 6. `2D assets/Character Pack` (2.8 MB) — Commanders (roadmap 2.1)
Layered top-down pixel characters (Face/Hair/Pants/Shirts/Shoes/Skin folders = mix-and-match
outfits). Pick 4 base characters, recolor, and they become **the Archery Captain, the Abbess,
the War Engineer, the Scout** with portraits + in-game stand-ins. Lighter outlines than Tiny
Swords, acceptable at portrait size; tinted/upscaled treatment per the 4.1 art strategy.

### 7. `Icons/Input Prompts Pixel` — Onboarding (roadmap 1.4)
Pixel keycap/mouse icons (WASD, arrows, click, space). Exactly what the 3 contextual
tooltips and the landing-page controls guide need.

### 8. `2D assets/RTS Medieval (Pixel)` — Castle + militia
16 px medieval top-down: castle walls/gates/flags in several colors, plus rows of recolorable
soldier units.
- **Rally the Militia** (3.1) — actual soldier sprites to burst from the castle.
- **Citadel legendary** (4.1) — wall segments the enemies must break.
- Between-wave castle upgrades (fortification boons get visible walls).

### 9. `2D assets/Medals` + `Ranks Pack` — Chronicle & leaderboard (1.3 / 1.1)
Medal tiers for wave milestones on the Chronicle screen; rank icons for the daily-seed local
leaderboard.

### 10. `Audio/Foley Sounds` (6 categories) — command foley
`Swords` (draw/swing for siege commands), `Woosh` (Arrow Storm), `Water` (poison puddles),
`Rocks` (shatter-armor crumble, alternate to the plate impacts), `Helmet`/`Plating`
(elite/boss arrival).

### 11. `2D assets/Flag Pack` — battlefield event markers (roadmap 3.2)
Flag sprites for gold vein / supply crate / wounded soldier / deserter camp callouts on the
map. Vector, but small and tintable — reads fine as a marker.

## Tier 3 — optional / experimental

| Pack | Use | Notes |
| ---- | --- | ----- |
| `UI assets/UI Pixel Pack`, `UI Pack` | real pixel panels/buttons if canvas-drawn UI gets unwieldy | our UI is already drawn; low priority |
| `2D assets/Rune Pack` | rune-meta slot visuals | vector, tintable |
| `2D assets/Emote Pack` | floating emotes over towers/enemies | cute, optional |
| `Audio/Synth Voice 1+2` | robot-voice boss taunts / commander quips | flavor |
| `Audio/Voiceover Pack` | human "level up / game over / congratulations" lines | audition `level_up.ogg`, `game_over.ogg` |
| `2D assets/Tiny Battle / Tiny Town / Tiny Dungeon / Tiny Farm` | spare tilesets, minimap tiles | simpler than our map; reference only |
| `2D assets/Tower Defense` (vector) | **ideas reference** for new tower types & Legendaries | art doesn't match in-world; steal concepts, not pixels |

## Pipeline notes

- Everything above is small: worst case ~20 MB of new files (particles). Selective copying
  only — the pipeline should never pull whole packs into the repo.
- **Audio:** copy chosen `.ogg` files into `public/assets/sound/sfx/` (or `music/`) and add
  names to `SFX_NAMES` in `src/audio.ts` — the WebAudio engine already handles loading,
  fallback, and crossfade.
- **Icons/FX:** extend `tools/build_assets.py` with a section that copies selected PNGs into
  `public/assets/icons/` (and `fx/`) and records them in `manifest.json`. White icons get
  tinted at draw time (offscreen canvas + `globalCompositeOperation = "source-in"` or
  `ctx.filter`); the `hud.ts` icon-drawing path already exists for gear/relic icons, so this
  follows an established pattern.
- Kenney packs include **Vector (SVG)** sources for the icon/FX packs — useful if we later want
  crisp 2×/retina icon variants without pixel-stretching.

## Suggested first pull (one sitting)

1. `Interface Sounds`: click 1-2, confirmation 1-2, error 1-3, drop 1, glass 1 → UI pass.
2. `Impact Sounds`: plate/metal/punch/bell heavy+medium, wood light, glass light → combat pass
   (shatter armor first — it's the signature mechanic and has no sound identity yet).
3. `Game Icons` + `Expansion`: shield set, refresh arrows, cloud set, pause/play/info/medal →
   wave-intel trait icons + weather icons (roadmap 1.2 / 5.2 unblocked).
4. `Particle Pack` + `Explosion Pack`: ~10 white FX sprites → hit/coin/boon/boss FX.
5. `Music Jingles (Retro)` + `Game Over.ogg` + one boss loop → event music.
