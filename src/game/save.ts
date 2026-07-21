// Profile persistence via localStorage.

import { CARS, STARTING_CASH, STARTING_ITEMS, UpgradeId } from './data';

export interface CupState {
  cupIndex: number;                  // which cup in CUPS is being contested
  raceIndex: number;                 // next race to run within that cup
  points: Record<string, number>;    // racerId -> cup points ('player' for the player)
  lastResults: string[] | null;      // racer ids in finishing order of last race
  finished: boolean;
}

export type Quality = 'low' | 'medium' | 'high';
export type Difficulty = 'easy' | 'normal' | 'hard';

/** Difficulty knobs, applied to AI pace/grip and the per-race rival ramp. */
export const DIFFICULTY_TUNING: Record<Difficulty, { skill: number; ramp: number; rubber: number; latGrip: number }> = {
  easy:   { skill: 0.88, ramp: 0.28, rubber: 0.6, latGrip: 26 },
  normal: { skill: 1.00, ramp: 0.45, rubber: 1.0, latGrip: 30 },
  hard:   { skill: 1.09, ramp: 0.62, rubber: 1.3, latGrip: 34 },
};

export interface Settings {
  volume: number;       // 0-1
  zoom: number;         // 0.7 - 1.4 multiplier
  assist: boolean;      // steering/grip assist
  weapons: boolean;     // missiles/mines on or off
  quality: Quality;     // post-FX tier: low=bloom only, medium=+grade/vignette/grain, high=+GTAO/SMAA
  difficulty: Difficulty;
  showGhost: boolean;   // draw the best-lap ghost in Time Trial
}

/** A recorded Time Trial lap: player pose sampled every GHOST_STRIDE frames. */
export interface GhostLap {
  timeMs: number;
  stride: number;
  frames: number[]; // flat [x, z, heading] triples
}

export interface LeaderboardEntry {
  timeMs: number;
  carId: string;
  at: number; // epoch ms
}

export interface Profile {
  cash: number;
  totalEarned: number;                // lifetime winnings — gates cup unlocks
  ownedCars: string[];
  equipped: string;
  upgrades: Record<string, Record<UpgradeId, number>>;
  condition: number;                  // 0-100, repaired in shop
  items: { missile: number; mine: number };
  cup: CupState;
  cupsWon: string[];                  // cup ids the player has taken the title in
  settings: Settings;
  tutorialSeen: boolean;
  bestTimes: Record<string, number>;  // trackId -> best lap ms
  ownedLiveries: string[];
  liveries: Record<string, string>;   // carId -> livery id
  ghosts: Record<string, GhostLap>;   // `${carId}:${trackId}` -> best lap ghost
  leaderboards: Record<string, LeaderboardEntry[]>; // trackId -> top N
}

// v3: multi-cup progression, 12 cars/tracks, liveries, ghosts, leaderboards.
// Old v2 saves point at a cup shape that no longer exists, so start clean.
const KEY = 'nitro-circuit-overdrive-save-v3';

export const LEADERBOARD_SIZE = 5;

export function freshCup(cupIndex = 0): CupState {
  return { cupIndex, raceIndex: 0, points: {}, lastResults: null, finished: false };
}

export function freshProfile(): Profile {
  const starter = CARS[0].id;
  return {
    cash: STARTING_CASH,
    totalEarned: 0,
    ownedCars: [starter],
    equipped: starter,
    upgrades: { [starter]: { engine: 0, handling: 0, armour: 0, boost: 0 } },
    condition: 100,
    items: { ...STARTING_ITEMS },
    cup: freshCup(),
    cupsWon: [],
    settings: {
      volume: 0.6, zoom: 1.0, assist: true, weapons: true,
      quality: 'high', difficulty: 'normal', showGhost: true,
    },
    tutorialSeen: false,
    bestTimes: {},
    ownedLiveries: ['factory'],
    liveries: {},
    ghosts: {},
    leaderboards: {},
  };
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshProfile();
    const parsed = JSON.parse(raw) as Profile;
    // merge over fresh profile so new fields get defaults
    const fresh = freshProfile();
    return {
      ...fresh,
      ...parsed,
      items: { ...fresh.items, ...parsed.items },
      settings: { ...fresh.settings, ...parsed.settings },
      cup: { ...fresh.cup, ...parsed.cup },
      // records are objects/arrays — merge so a save written by an older build
      // that lacked them still loads with sane defaults instead of undefined
      ownedLiveries: parsed.ownedLiveries ?? fresh.ownedLiveries,
      liveries: { ...fresh.liveries, ...parsed.liveries },
      ghosts: { ...fresh.ghosts, ...parsed.ghosts },
      leaderboards: { ...fresh.leaderboards, ...parsed.leaderboards },
      cupsWon: parsed.cupsWon ?? fresh.cupsWon,
    };
  } catch {
    return freshProfile();
  }
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // storage unavailable (private mode etc) — game still playable, just not persistent
  }
}

export function resetProfile(): Profile {
  const p = freshProfile();
  saveProfile(p);
  return p;
}

export function ghostKey(carId: string, trackId: string): string {
  return `${carId}:${trackId}`;
}

/**
 * Insert a Time Trial lap into a track's leaderboard, keeping the top N ascending.
 * Returns the 1-based placing, or 0 if the lap didn't make the board.
 */
export function recordLap(p: Profile, trackId: string, entry: LeaderboardEntry): number {
  const board = p.leaderboards[trackId] ?? [];
  board.push(entry);
  board.sort((a, b) => a.timeMs - b.timeMs);
  board.length = Math.min(board.length, LEADERBOARD_SIZE);
  p.leaderboards[trackId] = board;
  const rank = board.indexOf(entry);
  return rank < 0 ? 0 : rank + 1;
}

export function carUpgrades(p: Profile, carId: string): Record<UpgradeId, number> {
  if (!p.upgrades[carId]) {
    p.upgrades[carId] = { engine: 0, handling: 0, armour: 0, boost: 0 };
  }
  return p.upgrades[carId];
}
