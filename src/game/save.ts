// Profile persistence via localStorage.

import { CARS, STARTING_CASH, STARTING_ITEMS, UpgradeId } from './data';

export interface CupState {
  raceIndex: number;                 // next race to run (0-3)
  points: Record<string, number>;    // racerId -> cup points ('player' for the player)
  lastResults: string[] | null;      // racer ids in finishing order of last race
  finished: boolean;
}

export interface Settings {
  volume: number;       // 0-1
  zoom: number;         // 0.7 - 1.4 multiplier
  assist: boolean;      // steering/grip assist
  weapons: boolean;     // missiles/mines on or off
}

export interface Profile {
  cash: number;
  ownedCars: string[];
  equipped: string;
  upgrades: Record<string, Record<UpgradeId, number>>;
  condition: number;                  // 0-100, repaired in shop
  items: { missile: number; mine: number };
  cup: CupState;
  settings: Settings;
  tutorialSeen: boolean;
  bestTimes: Record<string, number>;  // trackId -> best lap ms
}

const KEY = 'nitro-circuit-overdrive-save-v1';

export function freshCup(): CupState {
  return { raceIndex: 0, points: {}, lastResults: null, finished: false };
}

export function freshProfile(): Profile {
  const starter = CARS[0].id;
  return {
    cash: STARTING_CASH,
    ownedCars: [starter],
    equipped: starter,
    upgrades: { [starter]: { engine: 0, handling: 0, armour: 0, boost: 0 } },
    condition: 100,
    items: { ...STARTING_ITEMS },
    cup: freshCup(),
    settings: { volume: 0.6, zoom: 1.0, assist: true, weapons: true },
    tutorialSeen: false,
    bestTimes: {},
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

export function carUpgrades(p: Profile, carId: string): Record<UpgradeId, number> {
  if (!p.upgrades[carId]) {
    p.upgrades[carId] = { engine: 0, handling: 0, armour: 0, boost: 0 };
  }
  return p.upgrades[carId];
}
