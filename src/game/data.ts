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
  // --- Phase 4 roster: the remaining Kenney silhouettes, so every body is playable ---
  {
    id: 'cab-12', name: 'Cab-12', tier: 1, price: 24000,
    color: 0xf2b33d, accent: 0x1a1a1a,
    base: { speed: 5.0, accel: 6.4, handling: 6.6, armour: 5.5, boost: 5.0 },
    blurb: 'Cheap, chuckable, surprisingly quick.',
  },
  {
    id: 'hauler', name: 'Hauler', tier: 2, price: 78000,
    color: 0x3f9e5a, accent: 0xf2f2f2,
    base: { speed: 6.2, accel: 5.4, handling: 5.2, armour: 9.0, boost: 6.0 },
    blurb: 'Wins arguments. Loses corners.',
  },
  {
    id: 'courier', name: 'Courier', tier: 2, price: 96000,
    color: 0xdd6b3a, accent: 0x2a2e38,
    base: { speed: 6.6, accel: 6.8, handling: 6.0, armour: 7.5, boost: 6.4 },
    blurb: 'Always on time. Never on line.',
  },
  {
    id: 'enforcer', name: 'Enforcer', tier: 3, price: 178000,
    color: 0x1c2740, accent: 0xe8e8e8,
    base: { speed: 8.0, accel: 7.8, handling: 7.2, armour: 8.5, boost: 7.0 },
    blurb: 'Pit manoeuvre as a lifestyle.',
  },
  {
    id: 'drifter', name: 'Drifter', tier: 4, price: 268000,
    color: 0x22b3a4, accent: 0xffe066,
    base: { speed: 8.6, accel: 8.2, handling: 9.4, armour: 6.0, boost: 8.2 },
    blurb: 'Sideways is the fast way.',
  },
  {
    id: 'apex', name: 'Apex', tier: 5, price: 540000,
    color: 0xf2f2f2, accent: 0xff2975,
    base: { speed: 9.8, accel: 9.4, handling: 8.8, armour: 7.0, boost: 9.6 },
    blurb: 'Qualifying trim, every lap.',
  },
];

/** Paint jobs, usable on any car. `color: null` = keep the car's factory colour. */
export interface LiverySpec {
  id: string;
  name: string;
  price: number;
  color: number | null;
  accent: number | null;
}

export const LIVERIES: LiverySpec[] = [
  { id: 'factory',  name: 'Factory',   price: 0,     color: null,     accent: null },
  { id: 'midnight', name: 'Midnight',  price: 12000, color: 0x14161f, accent: 0x2de2e6 },
  { id: 'ember',    name: 'Ember',     price: 14000, color: 0xd93a1e, accent: 0xffc83d },
  { id: 'arctic',   name: 'Arctic',    price: 14000, color: 0xe8f1f8, accent: 0x3a76c2 },
  { id: 'toxic',    name: 'Toxic',     price: 18000, color: 0x8ede2a, accent: 0x1a1a1a },
  { id: 'vapor',    name: 'Vapor',     price: 22000, color: 0xb14ae0, accent: 0x2de2e6 },
  { id: 'gold',     name: 'Gold Leaf', price: 40000, color: 0xe0b23a, accent: 0x1a1a1a },
];

/** Resolve a car's display colours through its selected livery. */
export function liveryColors(car: CarSpec, liveryId: string | undefined): { color: number; accent: number } {
  const lv = LIVERIES.find((l) => l.id === liveryId);
  return {
    color: lv?.color ?? car.color,
    accent: lv?.accent ?? car.accent,
  };
}

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

export interface ThemeLighting {
  sun: number;          // key light colour
  sunIntensity: number;
  ambient: number;
  ambientIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  rim: number;          // cool back light opposite the sun (edge separation)
  rimIntensity: number;
}

/** Cinematic grade (gauntlet iteration 1) — replaces the old weak hue/sat pass. */
export interface ThemeGrade {
  shadowTint: number;    // multiplied into darks (colour-script shadows, e.g. blue snow)
  highlightTint: number; // multiplied into brights (warm sun)
  saturation: number;    // 1 = neutral
  contrast: number;      // 1 = neutral, pivot 0.5
  tiltShift: number;     // 0..1 miniature-diorama blur strength
  exposure?: number;     // pre-grade multiplier (default 1) — pulls blown biomes down
}

/** Terrain + ground-cover parameters (gauntlet iteration 1). */
export interface ThemeEnvironment {
  relief: number;        // ground displacement amplitude in world units (0 = flat)
  landform: 'hills' | 'dunes' | 'drifts' | 'city';
  shoulder: number;      // scatter band width beyond the kerb, world units
  tuftColors: number[];  // ground-cover palette (per-instance jitter picks from these)
  tuftDensity: number;   // shoulder instances per 100 world units of track length
  /** Pull GLB foliage materials toward a harmony colour (fixes e.g. mint palms
   * clashing with ochre sand — GLB models carry their own baked colours). */
  foliageTint?: { color: number; amount: number };
  /** Kicked-up dust/spray colour — biome-specific motion evidence. */
  dust: number;
}

export interface TrackTheme {
  ground: number;
  groundAlt: number;
  road: number;
  stripeA: number;
  stripeB: number;
  foliage: number[];
  fog: number;
  skyTop: number;       // sky-dome zenith colour (horizon = fog colour)
  fogDensity: number;   // FogExp2 density
  grade: { hue: number; saturation: number }; // legacy — superseded by grade2
  grade2: ThemeGrade;
  env: ThemeEnvironment;
  night: boolean;       // nocturnal lighting rig
  light: ThemeLighting;
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
  ground: 0x678a4d, groundAlt: 0x597c43, road: 0x4a4a52,
  stripeA: 0xd9d9d9, stripeB: 0xc23b3b,
  foliage: [0xd97f30, 0xc9522e, 0xe0a832, 0x4d7a33, 0xb33b2e],
  fog: 0xbcc8a8,
  skyTop: 0x87b0dd, fogDensity: 0.0020,
  grade: { hue: 0.0, saturation: 0.12 },
  grade2: {
    shadowTint: 0x33502e, highlightTint: 0xfff2d2,
    saturation: 1.08, contrast: 1.11, tiltShift: 0.55,
  },
  env: {
    relief: 6, landform: 'hills', shoulder: 11,
    tuftColors: [0x67974a, 0x7fae54, 0x4f7d38, 0xd98a3a, 0xc9522e],
    tuftDensity: 34,
    dust: 0xcdbf9a,
  },
  night: false,
  light: {
    // golden-hour key + cool blue fill: warm/cool separation is the whole game
    sun: 0xffd9a0, sunIntensity: 2.6,
    ambient: 0xb8cdf5, ambientIntensity: 0.30,
    hemiSky: 0xcfe2ff, hemiGround: 0x5d6f42, hemiIntensity: 0.5,
    rim: 0x9ec8ff, rimIntensity: 0.55,
  },
  trees: ['tree_default_fall', 'tree_oak_fall', 'tree_detailed_fall', 'tree_simple_fall'],
  rocks: ['rock_smallA', 'stone_largeA'],
};

const DESERT: TrackTheme = {
  ground: 0xcf9a55, groundAlt: 0xc08c48, road: 0x5c554d,
  stripeA: 0xe8e3d4, stripeB: 0xc25b2e,
  // critic: mint-on-butterscotch collision — palms move to dusty olive/sage
  foliage: [0x7d8a4a, 0x93a058, 0x6e7a40],
  fog: 0xe6cf9f,
  skyTop: 0x93b8dd, fogDensity: 0.0016,
  grade: { hue: 0.01, saturation: 0.10 },
  grade2: {
    shadowTint: 0x4d3a54, highlightTint: 0xffe9bd,
    saturation: 1.08, contrast: 1.11, tiltShift: 0.5,
  },
  env: {
    relief: 9, landform: 'dunes', shoulder: 9,
    tuftColors: [0xb59a4e, 0xc9ae62, 0x8a8a4a, 0xa07a3e],
    tuftDensity: 20,
    foliageTint: { color: 0x7d8a4a, amount: 0.75 },
    dust: 0xdec08a,
  },
  night: false,
  light: {
    sun: 0xffce8a, sunIntensity: 2.8,
    ambient: 0xc4b8e8, ambientIntensity: 0.28, // cool violet fill vs hot sand
    hemiSky: 0xf0e0c8, hemiGround: 0x9a7a48, hemiIntensity: 0.42,
    rim: 0x9ec8ff, rimIntensity: 0.5,
  },
  trees: ['tree_palm', 'tree_palmShort', 'tree_palmTall'],
  rocks: ['rock_smallA', 'rock_smallB', 'stone_largeA', 'stone_largeB'],
};

const SNOW: TrackTheme = {
  // blue-grey field, NOT white: "snow is pale blue in shadow and warm white in
  // light" (critic) — value headroom lets sunlit crests and markings pop
  ground: 0xbfcfe2, groundAlt: 0xafc0d6, road: 0x515a66,
  stripeA: 0xe8e8e8, stripeB: 0x3a76c2,
  foliage: [0x2e5244, 0x3a6350, 0xcdd8e2],
  fog: 0xdde7f2,
  skyTop: 0x9fc4e8, fogDensity: 0.0007,
  grade: { hue: 0.0, saturation: 0.05 },
  // critic: snow is pale blue in shadow and warm white in light
  grade2: {
    shadowTint: 0x35507a, highlightTint: 0xfff3e0,
    saturation: 1.04, contrast: 1.10, tiltShift: 0.5,
    exposure: 0.72, // white-albedo biome: light stack must be pulled hard
  },
  // white fields need dark punctuation (ref: conifer masses against snow) —
  // dense pine-green scatter is what gives the biome its value range
  env: {
    relief: 5, landform: 'drifts', shoulder: 9,
    tuftColors: [0x24493c, 0x2e5244, 0x3a6350, 0x54708c],
    tuftDensity: 34,
    dust: 0xf2f7fc,
  },
  night: false,
  light: {
    sun: 0xffd9b0, sunIntensity: 2.7, // low warm sun raking across the snow
    ambient: 0x9fc0e8, ambientIntensity: 0.40, // blue sky fill = blue shadows
    hemiSky: 0xdcecff, hemiGround: 0x7a92b8, hemiIntensity: 0.42,
    rim: 0x8fb8ff, rimIntensity: 0.6,
  },
  trees: ['tree_pineDefaultA', 'tree_pineDefaultB', 'tree_pineRoundA', 'tree_pineTallA'],
  rocks: ['stone_largeA', 'stone_largeB'],
};

const NIGHT: TrackTheme = {
  ground: 0x252f47, groundAlt: 0x1f2839, road: 0x3d3d4d,
  stripeA: 0x9ad4e0, stripeB: 0xd44a8a,
  foliage: [0x2e7a88, 0x71337f, 0x255a70, 0x9a4a70],
  fog: 0x16202e,
  skyTop: 0x05070f, fogDensity: 0.0030,
  grade: { hue: 0.0, saturation: 0.04 },
  grade2: {
    shadowTint: 0x1a2440, highlightTint: 0xcfe0ff,
    saturation: 1.08, contrast: 1.12, tiltShift: 0.6,
  },
  env: {
    relief: 4, landform: 'city', shoulder: 9,
    tuftColors: [0x2e7a88, 0x71337f, 0x3a4a6a, 0x9a4a70],
    tuftDensity: 22,
    dust: 0x46558a,
  },
  night: true,
  light: {
    sun: 0x8fa8d9, sunIntensity: 0.85,       // moonlight
    ambient: 0x36486b, ambientIntensity: 0.34,
    hemiSky: 0x2c3c5c, hemiGround: 0x141b28, hemiIntensity: 0.38,
    rim: 0xd44a8a, rimIntensity: 0.7,        // neon-street magenta edge
  },
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
  // --- Phase 4 additions: wider mix of long straights, hairpins and fast sweepers ---
  {
    id: 'sunset-mile', name: 'Sunset Mile', subtitle: 'Coastal Straightaway',
    laps: 4, width: 12, scale: 1.5, difficulty: 'EASY',
    points: [
      [0, 0], [80, -6], [150, 4], [200, 40], [185, 85],
      [120, 96], [40, 88], [-40, 96], [-110, 80], [-140, 40],
      [-120, 0], [-60, -12],
    ],
    theme: DESERT,
  },
  {
    id: 'pine-hairpins', name: 'Pine Hairpins', subtitle: 'Forest Switchbacks',
    laps: 5, width: 9, scale: 1.25, difficulty: 'HARD',
    tunnel: [0.4, 0.5],
    points: [
      [0, 0], [50, -18], [78, 12], [40, 34], [78, 58],
      [40, 82], [80, 108], [30, 128], [-30, 118], [-64, 140],
      [-104, 112], [-70, 82], [-108, 56], [-72, 30], [-104, 2], [-52, -22],
    ],
    theme: FOREST,
  },
  {
    id: 'midnight-mall', name: 'Midnight Mall', subtitle: 'Neon Retail Park',
    laps: 5, width: 10, scale: 1.3, difficulty: 'MEDIUM',
    bridges: [0.3, 0.66],
    points: [
      [0, 0], [62, -14], [112, 16], [128, 62], [96, 104],
      [40, 116], [-16, 104], [-64, 120], [-108, 88], [-96, 42],
      [-124, 6], [-72, -20],
    ],
    theme: NIGHT,
  },
  {
    id: 'dune-sweep', name: 'Dune Sweep', subtitle: 'Open Desert Sweepers',
    laps: 5, width: 12, scale: 1.55, difficulty: 'EASY',
    points: [
      [0, 0], [72, -20], [138, 6], [168, 56], [140, 108],
      [76, 128], [8, 116], [-56, 130], [-124, 106], [-152, 54],
      [-128, 4], [-64, -18],
    ],
    theme: DESERT,
  },
  {
    id: 'icebreaker', name: 'Icebreaker', subtitle: 'Frozen Harbour',
    laps: 6, width: 9, scale: 1.35, difficulty: 'HARD',
    tunnel: [0.22, 0.34],
    bridges: [0.58],
    points: [
      [0, 0], [58, -20], [104, 4], [86, 46], [126, 74],
      [104, 118], [52, 106], [22, 140], [-34, 126], [-58, 84],
      [-104, 96], [-124, 50], [-82, 24], [-98, -16], [-46, -30],
    ],
    theme: SNOW,
  },
  {
    id: 'grand-overdrive', name: 'Grand Overdrive', subtitle: 'Championship Finale',
    laps: 7, width: 10, scale: 1.6, difficulty: 'HARD',
    tunnel: [0.5, 0.6],
    bridges: [0.18, 0.8],
    points: [
      [0, 0], [70, -16], [130, 10], [150, 58], [118, 100],
      [140, 142], [88, 168], [24, 150], [-30, 168], [-92, 146],
      [-118, 100], [-86, 62], [-130, 30], [-100, -14], [-44, -26],
    ],
    theme: NIGHT,
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

export interface CupDef {
  id: string;
  name: string;
  trackIds: string[];
  pointsByPosition: number[];
  cashByPosition: number[];
  winBonus: number;
  /** cash you must have earned in total before this cup unlocks (0 = always open) */
  unlockCash: number;
}

export const CUPS: CupDef[] = [
  {
    id: 'rookie', name: 'ROOKIE CUP',
    trackIds: ['sunset-mile', 'dockyard-dash', 'dune-sweep', 'forest-run'],
    pointsByPosition: [10, 8, 6, 4, 2, 1],
    cashByPosition: [4000, 2800, 2000, 1500, 1000, 700],
    winBonus: 15000,
    unlockCash: 0,
  },
  {
    id: 'street', name: 'STREET CUP',
    trackIds: ['canyon-run', 'midnight-mall', 'glacier-gate', 'pine-hairpins', 'neon-boulevard'],
    pointsByPosition: [10, 8, 6, 4, 2, 1],
    cashByPosition: [6000, 4200, 3000, 2200, 1500, 1000],
    winBonus: 25000,
    unlockCash: 40000,
  },
  {
    id: 'overdrive', name: 'OVERDRIVE CUP 2026',
    trackIds: ['icebreaker', 'frostbite-loop', 'canyon-run', 'pine-hairpins', 'neon-boulevard', 'grand-overdrive'],
    pointsByPosition: [12, 9, 7, 5, 3, 1],
    cashByPosition: [9000, 6500, 4800, 3400, 2400, 1600],
    winBonus: 50000,
    unlockCash: 140000,
  },
];

/** The cup a profile is currently contesting (clamped — save data may predate a cup). */
export function cupAt(index: number): CupDef {
  return CUPS[Math.min(Math.max(index, 0), CUPS.length - 1)];
}

export function cupUnlocked(cup: CupDef, totalEarned: number): boolean {
  return totalEarned >= cup.unlockCash;
}

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
