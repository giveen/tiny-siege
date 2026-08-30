// One-off verification for the Supply Crate economy + gacha roll.
// Run: npx esbuild scripts/verify_lootbox.ts --bundle --platform=node --outfile=/tmp/verify_lootbox.cjs && node /tmp/verify_lootbox.cjs
import { RNG } from "../src/rng";
import {
  GEARS,
  GEAR_BY_ID,
  LOOTBOX_COST,
  LOOTBOX_FORTUNE_MAX,
  LOOTBOX_FORTUNE_WEIGHTS,
  lootboxTierWeights,
  rollLootbox,
  TIER_MAX,
  makeGearDrop,
} from "../src/gear";
import { RELICS, cratesForWave, emptyMetaState, tickResearch, VICTORY_CRATES, VICTORY_RUNES } from "../src/meta";

let failures = 0;
const check = (name: string, ok: boolean, detail = ""): void => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
};

// --- crate currency curve -------------------------------------------------
check("cratesForWave(1) = 1", cratesForWave(1) === 1, `got ${cratesForWave(1)}`);
check("cratesForWave(4) = 1", cratesForWave(4) === 1, `got ${cratesForWave(4)}`);
check("cratesForWave(5) = 2", cratesForWave(5) === 2, `got ${cratesForWave(5)}`);
check("cratesForWave(10) = 3", cratesForWave(10) === 3, `got ${cratesForWave(10)}`);
check("cratesForWave(50) = 11", cratesForWave(50) === 11, `got ${cratesForWave(50)}`);
check("VICTORY_CRATES = 20", VICTORY_CRATES === 20);
check("VICTORY_RUNES unchanged (40)", VICTORY_RUNES === 40);

// full clear (waves 1..50) + victory bonus
const fullClear = Array.from({ length: 50 }, (_, i) => cratesForWave(i + 1)).reduce((a, b) => a + b, 0) + VICTORY_CRATES;
check("full clear banks >= 274 crates (>= 27 lootboxes)", fullClear >= 274, `got ${fullClear}`);

// --- lootbox constants + fortune ladder -----------------------------------
check("LOOTBOX_COST = 10", LOOTBOX_COST === 10);
for (let l = 0; l <= LOOTBOX_FORTUNE_MAX; l++) {
  const sum = LOOTBOX_FORTUNE_WEIGHTS[l].reduce((a, b) => a + b, 0);
  check(`fortune lvl ${l} weights sum to 100`, sum === 100, `got ${sum}`);
}
// ladder: T2 fixed at 20, T1 drains 10/level, T5 (re)gains from lvl 3
check("base (lvl 0) is T1 80 / T2 20, nothing above", JSON.stringify(LOOTBOX_FORTUNE_WEIGHTS[0]) === JSON.stringify([80, 20, 0, 0, 0]), JSON.stringify(LOOTBOX_FORTUNE_WEIGHTS[0]));
for (let l = 1; l <= LOOTBOX_FORTUNE_MAX; l++) {
  const [t1l, t2l, t3l, t4l, t5l] = LOOTBOX_FORTUNE_WEIGHTS[l];
  const [t1p, t2p, t3p, t4p, t5p] = LOOTBOX_FORTUNE_WEIGHTS[l - 1];
  check(`fortune lvl ${l}: T2 unchanged, only T1 shrinks`, t2l === t2p && t1l < t1p, `${t1p}→${t1l}, T2 ${t2l}`);
  const gained = (t3l - t3p) + (t4l - t4p) + (t5l - t5p);
  check(`fortune lvl ${l}: the 10% shift lands on T3+`, gained === t1p - t1l, `shifted ${gained}`);
}
check("T5 chance is non-decreasing along the ladder", LOOTBOX_FORTUNE_WEIGHTS.every((w, l) => l === 0 || w[4] >= LOOTBOX_FORTUNE_WEIGHTS[l - 1][4]));
// relic wiring: maxLevel matches the ladder, costs are steep and rising
const fortune = RELICS.find((r) => r.id === "fortune");
check("fortune relic exists with maxLevel = ladder length - 1", !!fortune && fortune.maxLevel === LOOTBOX_FORTUNE_MAX);
if (fortune) {
  const costs = Array.from({ length: fortune.maxLevel }, (_, l) => fortune.cost(l));
  check("fortune costs start at 80 and double per level", costs[0] === 80 && costs.every((c, i) => i === 0 || c === costs[i - 1] * 2), costs.join(", "));
  const H = 3_600_000;
  const durs = Array.from({ length: fortune.maxLevel }, (_, l) => fortune.research!(l));
  check("fortune research doubles from 1h", durs[0] === H && durs.every((d, i) => i === 0 || d === durs[i - 1] * 2), durs.map((d) => `${d / H}h`).join(", "));
}

// --- research tick (wall-clock auto-apply) ----------------------------------
{
  const HOUR = 3_600_000;
  const m = emptyMetaState();
  m.levels.fortune = 1;
  const now = Date.now();
  m.research = { id: "fortune", level: 2, startedAt: now, completesAt: now + HOUR };
  check("unfinished research stays pending", tickResearch(m, now) === false && m.levels.fortune === 1 && m.research !== null);
  check("expired research applies its level + clears", tickResearch(m, m.research!.completesAt + 1) === true && m.levels.fortune === 2 && m.research === null);
  check("tick is a no-op when idle", tickResearch(m, Date.now()) === false);
}

// --- roll distribution (base + max fortune) --------------------------------
const rng = new RNG(12345);
const N = 100000;
for (const level of [0, LOOTBOX_FORTUNE_MAX]) {
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let badDef = 0;
  let badUid = 0;
  const uids = new Set<string>();
  for (let i = 0; i < N; i++) {
    const inst = rollLootbox(rng, level);
    if (inst.tier < 1 || inst.tier > TIER_MAX) badDef++;
    if (!GEAR_BY_ID.has(inst.def)) badDef++;
    counts[inst.tier]++;
    if (uids.has(inst.uid)) badUid++;
    uids.add(inst.uid);
  }
  check(`[lvl ${level}] all rolled tiers in 1..5 + valid defs`, badDef === 0, `bad ${badDef}`);
  check(`[lvl ${level}] uids are unique`, badUid === 0, `dupes ${badUid}`);
  const want = lootboxTierWeights(level);
  for (let t = 1; t <= 5; t++) {
    const got = (100 * counts[t]) / N;
    check(`[lvl ${level}] tier ${t} rate ~${want[t]}%`, Math.abs(got - want[t]) < 0.5, `got ${got.toFixed(2)}%`);
  }
}

// every gear def is reachable in the uniform pick
const seen = new Set<string>();
for (let i = 0; i < 5000; i++) seen.add(rollLootbox(rng).def);
check(`every one of the ${GEARS.length} defs is reachable`, seen.size === GEARS.length, `${seen.size}/${GEARS.length}`);

// makeGearDrop still works (victory bonus path)
const v = makeGearDrop(5, rng);
check("makeGearDrop(5) is a T5 with valid def", v.tier === 5 && GEAR_BY_ID.has(v.def));

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
