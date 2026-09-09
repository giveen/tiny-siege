// Achievements, daily/weekly/repeatable missions, and login rewards. All of
// this reads a shared bank of lifetime stat counters (bumped from Game as
// gameplay events happen) rather than each system tracking its own state —
// a mission's progress is just "how much has this stat moved since the
// mission was assigned." Stored separately from MetaState (meta.ts) under
// its own localStorage key so the two systems can evolve independently.

import type { RNG } from "./rng";
import { queuePersist } from "./persist";

export const PROGRESS_KEY = "tinysiege.progress.v1";

/** Tabs of the Achievements & Missions screen. */
export type ProgressTab = "ach" | "daily" | "weekly" | "bounty" | "rewards";

export interface Reward {
  runes?: number;
  crates?: number;
  scrap?: number;
}

export interface MissionInstance {
  defId: string;
  /** Snapshot of the tracked stat's value when this instance was assigned/re-armed. */
  base: number;
  claimed: boolean;
}

export interface ProgressState {
  stats: Record<string, number>;
  claimedAchievements: string[];
  daily: { dateKey: string; missions: MissionInstance[] };
  weekly: { weekKey: string; missions: MissionInstance[] };
  bounty: MissionInstance[];
  login: { lastClaimDate: string; streakDay: number };
}

export function emptyProgress(): ProgressState {
  return {
    stats: {},
    claimedAchievements: [],
    daily: { dateKey: "", missions: [] },
    weekly: { weekKey: "", missions: [] },
    bounty: [],
    login: { lastClaimDate: "", streakDay: 0 },
  };
}

export function loadProgress(): ProgressState {
  const state = emptyProgress();
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p.stats && typeof p.stats === "object") state.stats = p.stats;
      if (Array.isArray(p.claimedAchievements)) state.claimedAchievements = p.claimedAchievements;
      if (p.daily && typeof p.daily.dateKey === "string" && Array.isArray(p.daily.missions))
        state.daily = p.daily;
      if (p.weekly && typeof p.weekly.weekKey === "string" && Array.isArray(p.weekly.missions))
        state.weekly = p.weekly;
      if (Array.isArray(p.bounty)) state.bounty = p.bounty;
      if (p.login && typeof p.login.lastClaimDate === "string" && typeof p.login.streakDay === "number")
        state.login = p.login;
    }
  } catch {
    /* ignore */
  }
  return state;
}

/** Records `p` for the next batched write (see persist.ts) — never touches
 *  localStorage directly, so per-kill stat bumps stay cheap. The recorder
 *  reads the live object, so the flush persists the latest state. */
export function saveProgress(p: ProgressState): void {
  queuePersist(PROGRESS_KEY, () => JSON.stringify(p));
}

export function bumpStat(p: ProgressState, key: string, n = 1): void {
  p.stats[key] = (p.stats[key] ?? 0) + n;
  saveProgress(p);
}

/** For "best ever" stats (e.g. deepest endless run) rather than cumulative
 *  counters — only overwrites when the new value is higher. */
export function setStatMax(p: ProgressState, key: string, value: number): void {
  if (value > (p.stats[key] ?? 0)) {
    p.stats[key] = value;
    saveProgress(p);
  }
}

// ---------------------------------------------------------------- dates
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Local-calendar-day key, e.g. "2026-08-28". */
export function todayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** ISO-8601 week key, e.g. "2026-W35". */
export function isoWeekKey(d: Date = new Date()): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7; // Mon=1 .. Sun=7
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${pad2(week)}`;
}

function dateKeyToUTC(key: string): number {
  const [y, m, d] = key.split("-").map((s) => parseInt(s, 10));
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

/** Was `prevKey` the calendar day immediately before `nowKey`? */
export function isYesterday(prevKey: string, nowKey: string): boolean {
  if (!prevKey) return false;
  return dateKeyToUTC(nowKey) - dateKeyToUTC(prevKey) === 86400000;
}

// ---------------------------------------------------------------- achievements
export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  statKey: string;
  target: number;
  reward: Reward;
}

interface TierSpec {
  key: string;
  name: string;
  unit: string;
  targets: [number, number, number];
}

const TIER_REWARDS: [Reward, Reward, Reward] = [
  { runes: 5, crates: 1 },
  { runes: 20, crates: 5, scrap: 10 },
  { runes: 60, crates: 15, scrap: 30 },
];

const ACHIEVEMENT_TIERS: TierSpec[] = [
  { key: "kills", name: "Slayer", unit: "enemies slain", targets: [100, 1000, 10000] },
  { key: "bossKills", name: "Boss Hunter", unit: "bosses defeated", targets: [5, 25, 100] },
  { key: "wavesCleared", name: "Defender", unit: "waves cleared", targets: [50, 250, 1000] },
  { key: "sieges", name: "Conqueror", unit: "sieges won", targets: [1, 5, 20] },
  { key: "towersBuilt", name: "Architect", unit: "towers built", targets: [25, 150, 750] },
  { key: "relicsBought", name: "Scholar", unit: "relic levels purchased", targets: [10, 40, 100] },
  { key: "gearEquipped", name: "Quartermaster", unit: "gear pieces equipped", targets: [10, 50, 200] },
  { key: "cratesOpened", name: "Collector", unit: "Supply Crates opened", targets: [5, 25, 100] },
  { key: "goldEarned", name: "Treasurer", unit: "gold earned", targets: [5000, 50000, 500000] },
  { key: "bestEndlessWave", name: "Endless Warlord", unit: "waves survived past the Siege", targets: [10, 30, 75] },
];

const TIER_SUFFIX = ["I", "II", "III"];

export const ACHIEVEMENTS: AchievementDef[] = ACHIEVEMENT_TIERS.flatMap((t) =>
  t.targets.map((target, i) => ({
    id: `${t.key}_${i + 1}`,
    name: `${t.name} ${TIER_SUFFIX[i]}`,
    desc: `Reach ${target.toLocaleString()} ${t.unit}.`,
    statKey: t.key,
    target,
    reward: TIER_REWARDS[i],
  }))
);

export function achievementProgress(p: ProgressState, def: AchievementDef): number {
  return Math.min(def.target, p.stats[def.statKey] ?? 0);
}

export function isAchievementClaimed(p: ProgressState, id: string): boolean {
  return p.claimedAchievements.includes(id);
}

// ---------------------------------------------------------------- missions
export interface MissionDef {
  id: string;
  name: string;
  statKey: string;
  amount: number;
  reward: Reward;
}

export const MISSION_POOL_DAILY: MissionDef[] = [
  { id: "d_kills", name: "Slay 30 enemies", statKey: "kills", amount: 30, reward: { runes: 8, crates: 2 } },
  { id: "d_waves", name: "Clear 5 waves", statKey: "wavesCleared", amount: 5, reward: { runes: 8, crates: 2 } },
  { id: "d_towers", name: "Build 5 towers", statKey: "towersBuilt", amount: 5, reward: { runes: 8, crates: 2 } },
  { id: "d_boons", name: "Choose 3 boons", statKey: "boonsChosen", amount: 3, reward: { runes: 8, crates: 2 } },
  { id: "d_gold", name: "Earn 300 gold", statKey: "goldEarned", amount: 300, reward: { runes: 8, crates: 2 } },
  { id: "d_relics", name: "Purchase 1 relic level", statKey: "relicsBought", amount: 1, reward: { runes: 8, crates: 2 } },
  { id: "d_crates", name: "Open 1 Supply Crate", statKey: "cratesOpened", amount: 1, reward: { runes: 8, crates: 2 } },
  { id: "d_gear", name: "Equip 1 gear piece", statKey: "gearEquipped", amount: 1, reward: { runes: 8, crates: 2 } },
];

export const MISSION_POOL_WEEKLY: MissionDef[] = [
  { id: "w_kills", name: "Slay 200 enemies", statKey: "kills", amount: 200, reward: { runes: 40, crates: 8, scrap: 15 } },
  { id: "w_waves", name: "Clear 25 waves", statKey: "wavesCleared", amount: 25, reward: { runes: 40, crates: 8, scrap: 15 } },
  { id: "w_sieges", name: "Win 1 siege", statKey: "sieges", amount: 1, reward: { runes: 40, crates: 8, scrap: 15 } },
  { id: "w_towers", name: "Build 20 towers", statKey: "towersBuilt", amount: 20, reward: { runes: 40, crates: 8, scrap: 15 } },
  { id: "w_boons", name: "Choose 15 boons", statKey: "boonsChosen", amount: 15, reward: { runes: 40, crates: 8, scrap: 15 } },
  { id: "w_gold", name: "Earn 2,000 gold", statKey: "goldEarned", amount: 2000, reward: { runes: 40, crates: 8, scrap: 15 } },
  { id: "w_relics", name: "Purchase 3 relic levels", statKey: "relicsBought", amount: 3, reward: { runes: 40, crates: 8, scrap: 15 } },
  { id: "w_crates", name: "Open 3 Supply Crates", statKey: "cratesOpened", amount: 3, reward: { runes: 40, crates: 8, scrap: 15 } },
];

export const BOUNTY_POOL: MissionDef[] = [
  { id: "b_wave", name: "Clear 1 wave", statKey: "wavesCleared", amount: 1, reward: { runes: 2 } },
  { id: "b_kills", name: "Slay 20 enemies", statKey: "kills", amount: 20, reward: { runes: 3 } },
  { id: "b_towers", name: "Build 2 towers", statKey: "towersBuilt", amount: 2, reward: { crates: 1 } },
  { id: "b_boon", name: "Choose 1 boon", statKey: "boonsChosen", amount: 1, reward: { runes: 2 } },
];

export function missionProgress(p: ProgressState, def: MissionDef, inst: MissionInstance): number {
  return Math.min(def.amount, Math.max(0, (p.stats[def.statKey] ?? 0) - inst.base));
}

function rollInstances(p: ProgressState, pool: MissionDef[], rng: RNG, n: number): MissionInstance[] {
  const picks = rng.shuffle(pool).slice(0, n);
  return picks.map((d) => ({ defId: d.id, base: p.stats[d.statKey] ?? 0, claimed: false }));
}

/** Reroll daily/weekly missions if their calendar key has rolled over; seed
 *  bounties once. Safe to call repeatedly (e.g. on init and on returning to
 *  the menu) — it's a no-op once the keys already match. */
export function refreshMissions(p: ProgressState, rng: RNG): void {
  const dk = todayKey();
  if (p.daily.dateKey !== dk) {
    p.daily = { dateKey: dk, missions: rollInstances(p, MISSION_POOL_DAILY, rng, 3) };
    saveProgress(p);
  }
  const wk = isoWeekKey();
  if (p.weekly.weekKey !== wk) {
    p.weekly = { weekKey: wk, missions: rollInstances(p, MISSION_POOL_WEEKLY, rng, 3) };
    saveProgress(p);
  }
  if (p.bounty.length === 0) {
    p.bounty = BOUNTY_POOL.map((d) => ({ defId: d.id, base: p.stats[d.statKey] ?? 0, claimed: false }));
    saveProgress(p);
  }
}

export function missionDef(id: string): MissionDef | undefined {
  return (
    MISSION_POOL_DAILY.find((d) => d.id === id) ??
    MISSION_POOL_WEEKLY.find((d) => d.id === id) ??
    BOUNTY_POOL.find((d) => d.id === id)
  );
}

// ---------------------------------------------------------------- login rewards
export const LOGIN_REWARDS: Reward[] = [
  { runes: 5 },
  { crates: 2 },
  { runes: 10, scrap: 5 },
  { crates: 3 },
  { runes: 15 },
  { crates: 4, scrap: 5 },
  { runes: 40, crates: 10, scrap: 20 },
];

export function canClaimLogin(p: ProgressState): boolean {
  return p.login.lastClaimDate !== todayKey();
}

/** Advances the streak (or resets it on a missed day) and returns the reward
 *  granted for the now-claimed day. Caller is responsible for actually
 *  crediting the reward into MetaState. */
export function claimLoginReward(p: ProgressState): Reward {
  const today = todayKey();
  const streak = isYesterday(p.login.lastClaimDate, today) ? (p.login.streakDay % 7) + 1 : 1;
  p.login = { lastClaimDate: today, streakDay: streak };
  saveProgress(p);
  return LOGIN_REWARDS[streak - 1];
}

/** True if there's an achievement, mission, or login reward ready to claim
 *  (drives the menu button's notification badge). */
export function hasClaimable(p: ProgressState): boolean {
  if (canClaimLogin(p)) return true;
  for (const a of ACHIEVEMENTS) {
    if (isAchievementClaimed(p, a.id)) continue;
    if (achievementProgress(p, a) >= a.target) return true;
  }
  const lists = [p.daily.missions, p.weekly.missions, p.bounty];
  for (const list of lists) {
    for (const inst of list) {
      if (inst.claimed) continue;
      const def = missionDef(inst.defId);
      if (def && missionProgress(p, def, inst) >= def.amount) return true;
    }
  }
  return false;
}
