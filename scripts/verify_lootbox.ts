// One-off verification for the Supply Crate economy + gacha roll.
// Run: npx esbuild scripts/verify_lootbox.ts --bundle --platform=node --outfile=/tmp/verify_lootbox.cjs && node /tmp/verify_lootbox.cjs
import { RNG } from "../src/rng";
import {
  GEARS,
  GEAR_BY_ID,
  LOOTBOX_COST,
  LOOTBOX_TIER_WEIGHTS,
  rollLootbox,
  TIER_MAX,
  makeGearDrop,
} from "../src/gear";
import { cratesForWave, VICTORY_CRATES, VICTORY_RUNES } from "../src/meta";

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

// --- lootbox constants ----------------------------------------------------
check("LOOTBOX_COST = 10", LOOTBOX_COST === 10);
const totalWeight = LOOTBOX_TIER_WEIGHTS.reduce((a, b) => a + b, 0);
check("tier weights sum to 100", totalWeight === 100, `got ${totalWeight}`);
check("weights are T1>T2>T3>T4>T5", LOOTBOX_TIER_WEIGHTS[1] > LOOTBOX_TIER_WEIGHTS[2] && LOOTBOX_TIER_WEIGHTS[2] > LOOTBOX_TIER_WEIGHTS[3] && LOOTBOX_TIER_WEIGHTS[3] > LOOTBOX_TIER_WEIGHTS[4] && LOOTBOX_TIER_WEIGHTS[4] > LOOTBOX_TIER_WEIGHTS[5]);

// --- roll distribution ----------------------------------------------------
const rng = new RNG(12345);
const N = 200000;
const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
let badDef = 0;
let badUid = 0;
const uids = new Set<string>();
for (let i = 0; i < N; i++) {
  const inst = rollLootbox(rng);
  if (inst.tier < 1 || inst.tier > TIER_MAX) badDef++;
  if (!GEAR_BY_ID.has(inst.def)) badDef++;
  counts[inst.tier]++;
  if (uids.has(inst.uid)) badUid++;
  uids.add(inst.uid);
}
check("all rolled tiers in 1..5", badDef === 0, `bad ${badDef}`);
check("all rolled defs exist in GEAR_BY_ID", badDef === 0);
check("uids are unique", badUid === 0, `dupes ${badUid}`);
for (let t = 1; t <= 5; t++) {
  const got = (100 * counts[t]) / N;
  const want = LOOTBOX_TIER_WEIGHTS[t];
  check(`tier ${t} rate ~${want}%`, Math.abs(got - want) < 0.5, `got ${got.toFixed(2)}%`);
}

// every gear def is reachable in the uniform pick
const seen = new Set<string>();
for (let i = 0; i < 5000; i++) seen.add(rollLootbox(rng).def);
check("every one of the 36 defs is reachable", seen.size === GEARS.length, `${seen.size}/${GEARS.length}`);

// makeGearDrop still works (victory bonus path)
const v = makeGearDrop(5, rng);
check("makeGearDrop(5) is a T5 with valid def", v.tier === 5 && GEAR_BY_ID.has(v.def));

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
