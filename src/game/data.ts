// Static game data: cars, tracks, rivals, economy, cup structure.

export type UpgradeId = 'engine' | 'handling' | 'armour' | 'boost';

export interface CarStats {
  speed: number;     // 0-10
  accel: number;     // 0-10
  handling: number;  // 0-10
  armour: number;    // 0-10
  boost: number;     // 0-10
}

export interface CarSpec {
  id: string;
  name: string;
  tier: number;
  price: number;       // 0 = starter car
  color: number;
  accent: number;
  base: CarStats;
  blurb: string;
}

export const CARS: CarSpec[] = [
  {
    id: 'rival-x', name: 'Rival-X', tier: 1, price: 0,
    color: 0xd62828, accent: 0xffffff,
    base: { speed: 5.5, accel: 6.0, handling: 6.0, armour: 5.0, boost: 5.5 },
    blurb: 'Dominate every corner.',
  },
  {
    id: 'kolt-47', name: 'Kolt-47', tier: 2, price: 60000,
    color: 0x1f5fd6, accent: 0xffffff,
    base: { speed: 7.0, accel: 6.5, handling: 6.5, armour: 6.0, boost: 6.5 },
    blurb: 'Balanced street weapon.',
  },
  {
    id: 'vex-77', name: 'Vex-77', tier: 3, price: 140000,
    color: 0x8526c9, accent: 0xf2c94c,
    base: { speed: 8.5, accel: 7.5, handling: 7.5, armour: 6.5, boost: 8.0 },
    blurb: 'Overdrive-grade machine.',
  },
  {
    id: 'hex-9', name: 'Hex-9', tier: 3, price: 210000,
    color: 0xe0992e, accent: 0x1a1a1a,
    base: { speed: 8.0, accel: 8.5, handling: 8.0, armour: 7.0, boost: 7.5 },
    blurb: 'Launch-tuned brawler.',
  },
  {
    id: 'nitrous', name: 'Nitrous', tier: 4, price: 320000,
    color: 0x2a2e38, accent: 0xff2975,
    base: { speed: 9.2, accel: 8.0, handling: 8.0, armour: 7.5, boost: 9.0 },
    blurb: 'Top-tier nitro monster.',
  },
  {
    id: 'ghost', name: 'Ghost', tier: 5, price: 480000,
    color: 0x101218, accent: 0x2de2e6,
    base: { speed: 9.6, accel: 9.0, handling: 9.2, armour: 8.0, boost: 9.4 },
    blurb: 'The legend. Unmatched.',
  },
];

export interface UpgradeSpec {
  id: UpgradeId;
  name: string;
  icon: string;
  maxLevel: number;
  baseCost: number;
}

export const UPGRADES: UpgradeSpec[] = [
  { id: 'engine',   name: 'Engine',   icon: '⚙️', maxLevel: 5, baseCost: 9000 },
  { id: 'handling', name: 'Handling', icon: '🎮', maxLevel: 5, baseCost: 7500 },
  { id: 'armour',   name: 'Armour',   icon: '🛡️', maxLevel: 5, baseCost: 8000 },
  { id: 'boost',    name: 'Boost',    icon: '⚡', maxLevel: 5, baseCost: 10000 },
];

export function upgradeCost(spec: UpgradeSpec, currentLevel: number): number {
  return Math.round(spec.baseCost * (1 + currentLevel * 0.65));
}

export const ITEM_PRICES = { missile: 2500, mine: 1800 };
export const REPAIR_PRICE_PER_PCT = 60; // cash per 1% condition

export interface TrackTheme {
  ground: number;
  groundAlt: number;
  road: number;
  stripeA: number;
  stripeB: number;
  foliage: number[];
  fog: number;
  trees: string[];  // GLB model names (see models.ts)
  rocks: string[];
}

export interface TrackDef {
  id: string;
  name: string;
  subtitle: string;
  laps: number;
  width: number;
  scale: number; // multiplier on control points (track length)
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  // closed loop control points (x, z) — y is up
  points: [number, number][];
  // decorative features as fractions of the lap (0..1)
  tunnel?: [number, number];
  bridges?: number[];
  theme: TrackTheme;
}

const FOREST: TrackTheme = {
  ground: 0x5d8a3c, groundAlt: 0x55803a, road: 0x4a4a52,
  stripeA: 0xd9d9d9, stripeB: 0xc23b3b,
  foliage: [0xd97f30, 0xc9522e, 0xe0a832, 0x4d7a33, 0xb33b2e],
  fog: 0xbcc8a8,
  trees: ['tree_default_fall', 'tree_oak_fall', 'tree_detailed_fall', 'tree_simple_fall'],
  rocks: ['rock_smallA', 'stone_largeA'],
};

const DESERT: TrackTheme = {
  ground: 0xc9954f, groundAlt: 0xbd8a46, road: 0x55514f,
  stripeA: 0xe8e3d4, stripeB: 0xc25b2e,
  foliage: [0x6f8a3a, 0x8aa04a, 0xb3793a],
  fog: 0xe3cfa3,
  trees: ['tree_palm', 'tree_palmShort', 'tree_palmTall'],
  rocks: ['rock_smallA', 'rock_smallB', 'stone_largeA', 'stone_largeB'],
};

const SNOW: TrackTheme = {
  ground: 0xdde6ee, groundAlt: 0xd2dde8, road: 0x4e545e,
  stripeA: 0xe8e8e8, stripeB: 0x3a76c2,
  foliage: [0x3d6647, 0x4a7a55, 0xcdd8e2],
  fog: 0xe8eef4,
  trees: ['tree_pineDefaultA', 'tree_pineDefaultB', 'tree_pineRoundA', 'tree_pineTallA'],
  rocks: ['stone_largeA', 'stone_largeB'],
};

const NIGHT: TrackTheme = {
  ground: 0x2e3a4a, groundAlt: 0x28333f, road: 0x3a3a44,
  stripeA: 0x9ad4e0, stripeB: 0xd44a8a,
  foliage: [0x3a8a99, 0x8a3a99, 0x2e6680, 0xb35980],
  fog: 0x16202e,
  trees: ['tree_default_dark', 'tree_thin_dark', 'tree_oak_dark', 'tree_cone_dark'],
  rocks: ['rock_smallA', 'rock_smallB'],
};

export const TRACKS: TrackDef[] = [
  {
    id: 'dockyard-dash', name: 'Dockyard Dash', subtitle: 'Harbor Circuit',
    laps: 4, width: 11, scale: 1.35, difficulty: 'EASY',
    bridges: [0.45],
    points: [
      [0, 0], [60, -8], [110, 10], [140, 55], [120, 100],
      [70, 110], [30, 90], [-20, 100], [-70, 85], [-90, 40],
      [-60, 5], [-30, 15],
    ],
    theme: DESERT,
  },
  {
    id: 'forest-run', name: 'Forest Run', subtitle: 'Woodland Circuit',
    laps: 5, width: 10, scale: 1.4,
    difficulty: 'EASY',
    tunnel: [0.56, 0.68],
    points: [
      [0, 0], [55, -15], [95, 15], [85, 60], [120, 95],
      [95, 140], [40, 130], [10, 95], [-40, 120], [-85, 95],
      [-75, 45], [-105, 10], [-70, -25], [-30, -10],
    ],
    theme: FOREST,
  },
  {
    id: 'glacier-gate', name: 'Glacier Gate', subtitle: 'Arctic Test Track',
    laps: 5, width: 10, scale: 1.4,
    difficulty: 'MEDIUM',
    tunnel: [0.3, 0.44],
    bridges: [0.7],
    points: [
      [0, 0], [70, -10], [100, 30], [70, 60], [110, 90],
      [90, 135], [30, 120], [-15, 140], [-60, 115], [-50, 70],
      [-95, 50], [-80, 5], [-35, -20],
    ],
    theme: SNOW,
  },
  {
    id: 'neon-boulevard', name: 'Neon Boulevard', subtitle: 'Night Street Circuit',
    laps: 6, width: 9, scale: 1.3,
    difficulty: 'HARD',
    tunnel: [0.62, 0.74],
    bridges: [0.22],
    points: [
      [0, 0], [50, -20], [90, 5], [75, 45], [115, 70],
      [95, 115], [45, 100], [25, 135], [-25, 125], [-45, 85],
      [-95, 95], [-110, 50], [-70, 25], [-85, -15], [-40, -30],
    ],
    theme: NIGHT,
  },
  {
    id: 'canyon-run', name: 'Canyon Run', subtitle: 'Desert Pass',
    laps: 5, width: 10, scale: 1.45,
    difficulty: 'MEDIUM',
    tunnel: [0.48, 0.6],
    points: [
      [0, 0], [65, -12], [105, 20], [88, 65], [120, 105],
      [100, 150], [45, 138], [12, 100], [-42, 128], [-92, 100],
      [-78, 52], [-112, 14], [-72, -22], [-32, -8],
    ],
    theme: DESERT,
  },
  {
    id: 'frostbite-loop', name: 'Frostbite Loop', subtitle: 'Alpine Sprint',
    laps: 6, width: 9, scale: 1.5,
    difficulty: 'HARD',
    bridges: [0.35, 0.72],
    points: [
      [0, 0], [55, -22], [98, 8], [80, 50], [122, 78],
      [100, 122], [48, 108], [28, 145], [-28, 132], [-50, 90],
      [-100, 100], [-118, 54], [-76, 28], [-90, -18], [-42, -32],
    ],
    theme: SNOW,
  },
];

export interface RivalDef {
  id: string;
  name: string;
  carNum: string;
  color: number;
  accent: number;
  skill: number; // ~0.8 - 1.05 multiplier on pace
}

export const RIVALS: RivalDef[] = [
  { id: 'hayes',  name: 'R. HAYES',  carNum: '01', color: 0x7a3bd6, accent: 0xffffff, skill: 1.0 },
  { id: 'sato',   name: 'K. SATO',   carNum: '33', color: 0xe8e8e8, accent: 0x222222, skill: 0.96 },
  { id: 'vargas', name: 'M. VARGAS', carNum: '08', color: 0x2d77d6, accent: 0xffffff, skill: 0.93 },
  { id: 'novak',  name: 'L. NOVAK',  carNum: '21', color: 0x35a84a, accent: 0xffffff, skill: 0.89 },
  { id: 'park',   name: 'J. PARK',   carNum: '66', color: 0xe09a2e, accent: 0x222222, skill: 0.85 },
];

export const PLAYER_CAR_NUM = '47';
export const PLAYER_NAME = 'YOU';

export const CUP = {
  name: 'OVERDRIVE CUP 2026',
  trackIds: ['dockyard-dash', 'forest-run', 'canyon-run', 'glacier-gate', 'frostbite-loop', 'neon-boulevard'],
  pointsByPosition: [10, 8, 6, 4, 2, 1],
  cashByPosition: [6000, 4200, 3000, 2200, 1500, 1000],
  winBonus: 25000, // cup winner bonus
};

export function effectiveStats(car: CarSpec, upg: Record<UpgradeId, number>): CarStats {
  return {
    speed: Math.min(10, car.base.speed + upg.engine * 0.5),
    accel: Math.min(10, car.base.accel + upg.engine * 0.3 + upg.boost * 0.1),
    handling: Math.min(10, car.base.handling + upg.handling * 0.5),
    armour: Math.min(10, car.base.armour + upg.armour * 0.5),
    boost: Math.min(10, car.base.boost + upg.boost * 0.5),
  };
}

export const STARTING_CASH = 12000;
export const STARTING_ITEMS = { missile: 2, mine: 1 };
