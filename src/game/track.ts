// Procedural track construction from a closed control-point loop.

import * as THREE from 'three';
import { TrackDef } from './data';
import { cloneByHeight, hasModel } from './models';

export interface TrackSample {
  pos: THREE.Vector3;
  tangent: THREE.Vector3;
  normal: THREE.Vector3;   // points to the LEFT of travel direction
  curvature: number;       // abs heading change per unit length (rad/m)
}

export interface Obstacle {
  pos: THREE.Vector3;
  radius: number;
}

export interface BuiltTrack {
  def: TrackDef;
  group: THREE.Group;
  samples: TrackSample[];
  totalLength: number;
  segLength: number;
  halfWidth: number;
  minimap: { x: number; y: number }[];
  startPositions: { pos: THREE.Vector3; heading: number }[];
  obstacles: Obstacle[]; // solid roadside props — cars crash into these
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SAMPLE_COUNT = 600;

// Tileable speckle-noise texture, generated in-code (no asset files).
function speckleTexture(base: number, light: number, dark: number, density = 1400): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#' + base.toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, size, size);
  const cols = ['#' + light.toString(16).padStart(6, '0'), '#' + dark.toString(16).padStart(6, '0')];
  for (let i = 0; i < density; i++) {
    ctx.fillStyle = cols[i % 2];
    ctx.globalAlpha = 0.06 + Math.random() * 0.18;
    const r = 0.6 + Math.random() * 2.2;
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function shade(color: number, f: number): number {
  const c = new THREE.Color(color).multiplyScalar(f);
  return c.getHex();
}

export function buildTrack(def: TrackDef, seed = 1337): BuiltTrack {
  const group = new THREE.Group();
  const rng = mulberry32(seed + def.id.length * 7919);

  const curvePoints = def.points.map(([x, z]) => new THREE.Vector3(x * def.scale, 0, z * def.scale));
  const curve = new THREE.CatmullRomCurve3(curvePoints, true, 'centripetal', 0.6);
  const pts = curve.getSpacedPoints(SAMPLE_COUNT);
  pts.pop(); // last point equals first

  const n = pts.length;
  const samples: TrackSample[] = [];
  let totalLength = 0;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const next = pts[(i + 1) % n];
    const tangent = next.clone().sub(prev).setY(0).normalize();
    const normal = new THREE.Vector3(tangent.z, 0, -tangent.x);
    samples.push({ pos: pts[i].clone(), tangent, normal, curvature: 0 });
    totalLength += next.distanceTo(pts[i]);
  }
  const segLength = totalLength / n;

  // curvature: heading delta across a lookahead window
  const K = 8;
  for (let i = 0; i < n; i++) {
    const a = samples[i].tangent;
    const b = samples[(i + K) % n].tangent;
    const angle = Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
    samples[i].curvature = angle / (K * segLength);
  }

  const halfWidth = def.width / 2;
  const theme = def.theme;

  // ---- ground plane ----
  const groundTex = speckleTexture(theme.ground, shade(theme.ground, 1.18), shade(theme.ground, 0.8));
  groundTex.repeat.set(90, 90);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(420, 40),
    new THREE.MeshLambertMaterial({ color: 0xffffff, map: groundTex })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  group.add(ground);

  // ground variation discs
  const discMat = new THREE.MeshLambertMaterial({ color: theme.groundAlt });
  for (let i = 0; i < 40; i++) {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(6 + rng() * 18, 14), discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set((rng() - 0.5) * 500, -0.03, (rng() - 0.5) * 500);
    group.add(disc);
  }

  // ---- road ribbon ----
  const roadTex = speckleTexture(theme.road, shade(theme.road, 1.25), shade(theme.road, 0.72), 2200);
  group.add(buildRibbon(samples, -halfWidth, halfWidth, 0.0, roadTex, segLength));
  // edge stripes (kerbs), alternating colors
  const stripeW = 0.9;
  group.add(buildKerb(samples, halfWidth, halfWidth + stripeW, theme.stripeA, theme.stripeB, 0.01));
  group.add(buildKerb(samples, -halfWidth - stripeW, -halfWidth, theme.stripeA, theme.stripeB, 0.01));
  // centre dashes
  group.add(buildDashes(samples, 0.25, 0xdedede, 0.012));

  // ---- start line ----
  group.add(buildStartLine(samples[0], halfWidth));

  // ---- decorations (also collect solid obstacles for collision) ----
  const obstacles: Obstacle[] = [];
  addDecor(group, samples, halfWidth, def, rng, obstacles);

  // ---- features: tunnel-through-mountain + bridges ----
  if (def.tunnel) {
    const i0 = Math.floor(def.tunnel[0] * n);
    const i1 = Math.floor(def.tunnel[1] * n);
    const seg = samples.slice(Math.min(i0, i1), Math.max(i0, i1));
    if (seg.length > 4) group.add(buildMountainPass(seg, halfWidth, def, rng));
  }
  for (const frac of def.bridges ?? []) {
    const s = samples[Math.floor(frac * n) % n];
    group.add(buildBridge(s, halfWidth));
    // bridge pillars are solid
    for (const side of [1, -1]) {
      obstacles.push({
        pos: s.pos.clone().addScaledVector(s.normal, side * (halfWidth + 4.5)),
        radius: 1.4,
      });
    }
  }

  // ---- minimap polyline (normalized) ----
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const s of samples) {
    minX = Math.min(minX, s.pos.x); maxX = Math.max(maxX, s.pos.x);
    minZ = Math.min(minZ, s.pos.z); maxZ = Math.max(maxZ, s.pos.z);
  }
  const spanX = maxX - minX, spanZ = maxZ - minZ;
  const span = Math.max(spanX, spanZ);
  const minimap = samples.filter((_, i) => i % 4 === 0).map((s) => ({
    x: (s.pos.x - minX + (span - spanX) / 2) / span,
    y: (s.pos.z - minZ + (span - spanZ) / 2) / span,
  }));

  // ---- start grid: 6 slots, 2 columns, just past the line (lap 1 starts at GO) ----
  const startPositions: { pos: THREE.Vector3; heading: number }[] = [];
  for (let slot = 0; slot < 6; slot++) {
    const fwd = 22 - Math.floor(slot / 2) * 7; // pole row farthest ahead
    const idx = Math.max(2, Math.round(fwd / segLength)) % n;
    const s = samples[idx];
    const side = (slot % 2 === 0 ? 1 : -1) * halfWidth * 0.45;
    const pos = s.pos.clone().add(s.normal.clone().multiplyScalar(side));
    pos.y = 0;
    const heading = Math.atan2(s.tangent.x, s.tangent.z);
    startPositions.push({ pos, heading });
  }

  return { def, group, samples, totalLength, segLength, halfWidth, minimap, startPositions, obstacles };
}

function buildRibbon(
  samples: TrackSample[], from: number, to: number, y: number,
  map: THREE.Texture, segLength: number
): THREE.Mesh {
  const n = samples.length;
  const positions = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const a = s.pos.clone().add(s.normal.clone().multiplyScalar(from));
    const b = s.pos.clone().add(s.normal.clone().multiplyScalar(to));
    positions.set([a.x, y + 0.02, a.z, b.x, y + 0.02, b.z], i * 6);
    const v = (i * segLength) / 14; // texture tile every ~14 world units
    uvs.set([0, v, 1, v], i * 4);
    const j = (i + 1) % n;
    indices.push(i * 2, i * 2 + 1, j * 2, j * 2, i * 2 + 1, j * 2 + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map, side: THREE.DoubleSide }));
}

function buildKerb(
  samples: TrackSample[], from: number, to: number, colA: number, colB: number, y: number
): THREE.Mesh {
  const n = samples.length;
  const positions = new Float32Array(n * 2 * 3);
  const colors = new Float32Array(n * 2 * 3);
  const indices: number[] = [];
  const ca = new THREE.Color(colA), cb = new THREE.Color(colB);
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const a = s.pos.clone().add(s.normal.clone().multiplyScalar(from));
    const b = s.pos.clone().add(s.normal.clone().multiplyScalar(to));
    positions.set([a.x, y + 0.02, a.z, b.x, y + 0.02, b.z], i * 6);
    const c = Math.floor(i / 5) % 2 === 0 ? ca : cb;
    colors.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);
    const j = (i + 1) % n;
    indices.push(i * 2, i * 2 + 1, j * 2, j * 2, i * 2 + 1, j * 2 + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
}

function buildDashes(samples: TrackSample[], halfW: number, color: number, y: number): THREE.Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const n = samples.length;
  let v = 0;
  for (let i = 0; i < n; i += 12) {
    for (let k = 0; k < 5 && i + k + 1 < n; k++) {
      const s0 = samples[(i + k) % n];
      const s1 = samples[(i + k + 1) % n];
      const a = s0.pos.clone().add(s0.normal.clone().multiplyScalar(halfW));
      const b = s0.pos.clone().add(s0.normal.clone().multiplyScalar(-halfW));
      const c = s1.pos.clone().add(s1.normal.clone().multiplyScalar(halfW));
      const d = s1.pos.clone().add(s1.normal.clone().multiplyScalar(-halfW));
      positions.push(a.x, y + 0.02, a.z, b.x, y + 0.02, b.z, c.x, y + 0.02, c.z, d.x, y + 0.02, d.z);
      indices.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
      v += 4;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
}

// Mountain pass: the road cuts through a rocky massif. Tall jagged rock masses
// flank both sides (reading as a mountain from above), with a stone portal arch
// at each end marking the tunnel mouth. The road itself stays open to the camera
// so the player's car is always visible — a cutaway, not a roofed box.
function buildMountainPass(
  seg: TrackSample[], halfWidth: number, def: TrackDef, rng: () => number
): THREE.Group {
  const g = new THREE.Group();
  const n = seg.length;
  // rocky earth tones, slightly tinted toward the theme so snow/desert read right
  const rockBase = new THREE.Color(0x6b6258).lerp(new THREE.Color(def.theme.ground), 0.25);
  const rockMat = new THREE.MeshLambertMaterial({ color: rockBase.getHex() });
  const rockDark = new THREE.MeshLambertMaterial({ color: rockBase.clone().multiplyScalar(0.7).getHex() });
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);

  const inner = halfWidth + 3.2; // rock face starts clear of the racing line

  // boulder masses along both walls; height swells toward the middle (mountain profile)
  for (let i = 1; i < n - 1; i += 2) {
    const s = seg[i];
    const t = i / (n - 1);
    const profile = Math.sin(t * Math.PI); // 0 at mouths, 1 mid-pass
    for (const side of [1, -1]) {
      const clusters = 2 + Math.floor(rng() * 2);
      for (let c = 0; c < clusters; c++) {
        const out = inner + c * (2.6 + rng() * 1.8);
        const h = (4 + profile * 10) * (0.7 + rng() * 0.6);
        const rock = new THREE.Mesh(rockGeo, rng() < 0.5 ? rockMat : rockDark);
        const w = 2.2 + rng() * 2.6;
        rock.scale.set(w, h, w);
        rock.position.copy(s.pos)
          .addScaledVector(s.normal, side * out)
          .addScaledVector(s.tangent, (rng() - 0.5) * 3);
        rock.position.y = h * 0.32;
        rock.rotation.set(rng(), rng() * Math.PI * 2, rng());
        rock.castShadow = true;
        rock.receiveShadow = true;
        g.add(rock);
      }
    }
  }

  // stone portal arch at each mouth so it reads clearly as "tunnel through the mountain"
  for (const s of [seg[0], seg[n - 1]]) {
    const arch = new THREE.Group();
    const angle = Math.atan2(s.normal.x, s.normal.z);
    for (const side of [1, -1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(2.2, 7, 2.2), rockDark);
      pillar.position.copy(s.pos).addScaledVector(s.normal, side * (halfWidth + 1.6));
      pillar.position.y = 3.5;
      pillar.castShadow = true;
      arch.add(pillar);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(halfWidth * 2 + 6, 2.2, 2.4), rockDark);
    lintel.position.copy(s.pos);
    lintel.position.y = 7.2;
    lintel.rotation.y = angle;
    lintel.castShadow = true;
    arch.add(lintel);
    g.add(arch);
  }
  return g;
}

// Decorative overpass crossing above the road.
function buildBridge(s: TrackSample, halfWidth: number): THREE.Group {
  const g = new THREE.Group();
  const deckMat = new THREE.MeshLambertMaterial({ color: 0x76808f });
  const span = halfWidth + 9;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.7, span * 2), deckMat);
  deck.position.copy(s.pos);
  deck.position.y = 4.8;
  deck.rotation.y = Math.atan2(s.normal.x, s.normal.z);
  deck.castShadow = true;
  g.add(deck);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.5, 0.3), deckMat);
  for (const off of [2.5, -2.5]) {
    const r = rail.clone();
    r.position.copy(s.pos).addScaledVector(s.tangent, off);
    r.position.y = 5.4;
    r.rotation.y = deck.rotation.y;
    g.add(r);
  }
  const pillarMat = new THREE.MeshLambertMaterial({ color: 0x5c6675 });
  for (const side of [1, -1]) {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 4.8, 8), pillarMat);
    pillar.position.copy(s.pos).addScaledVector(s.normal, side * (halfWidth + 4.5));
    pillar.position.y = 2.4;
    pillar.castShadow = true;
    g.add(pillar);
  }
  return g;
}

function buildStartLine(s: TrackSample, halfWidth: number): THREE.Group {
  const g = new THREE.Group();
  const cols = 8, rows = 2;
  const cw = (halfWidth * 2) / cols, ch = 1.0;
  const white = new THREE.MeshBasicMaterial({ color: 0xeeeeee });
  const black = new THREE.MeshBasicMaterial({ color: 0x111111 });
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(cw, ch), (r + c) % 2 === 0 ? white : black);
      quad.rotation.x = -Math.PI / 2;
      const lateral = -halfWidth + cw * (c + 0.5);
      const fwd = (r - 0.5) * ch;
      quad.position.copy(s.pos)
        .add(s.normal.clone().multiplyScalar(lateral))
        .add(s.tangent.clone().multiplyScalar(fwd));
      quad.position.y = 0.03;
      quad.rotation.z = -Math.atan2(s.tangent.x, s.tangent.z);
      g.add(quad);
    }
  }
  return g;
}

function addDecor(
  group: THREE.Group, samples: TrackSample[], halfWidth: number,
  def: TrackDef, rng: () => number, obstacles: Obstacle[]
): void {
  const theme = def.theme;
  const foliageMats = theme.foliage.map((c) => new THREE.MeshLambertMaterial({ color: c }));
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2e });
  const rockMat = new THREE.MeshLambertMaterial({ color: 0xa8a8a8 });

  const blobGeo = new THREE.IcosahedronGeometry(1, 0);
  const canopyGeo = new THREE.SphereGeometry(1, 7, 6);
  const coneGeo = new THREE.ConeGeometry(1, 2.4, 7);
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 1, 5);

  let bounds = 0;
  for (const s of samples) bounds = Math.max(bounds, Math.abs(s.pos.x), Math.abs(s.pos.z));
  bounds += 50;

  const clearance = halfWidth + 4.5;
  const placed: THREE.Vector3[] = [];

  let attempts = 0;
  while (placed.length < 140 && attempts < 2000) {
    attempts++;
    const p = new THREE.Vector3((rng() - 0.5) * 2 * bounds, 0, (rng() - 0.5) * 2 * bounds);
    // reject if too close to road (coarse check every 4th sample)
    let nearRoad = false;
    for (let i = 0; i < samples.length; i += 4) {
      const d2 = (samples[i].pos.x - p.x) ** 2 + (samples[i].pos.z - p.z) ** 2;
      if (d2 < clearance * clearance) { nearRoad = true; break; }
    }
    if (nearRoad) continue;
    let nearOther = false;
    for (const q of placed) {
      if (q.distanceToSquared(p) < 16) { nearOther = true; break; }
    }
    if (nearOther) continue;
    placed.push(p);

    const roll = rng();
    // record a solid collision volume (trees thinner than their canopy, rocks chunky)
    obstacles.push({ pos: p.clone(), radius: roll < 0.79 ? 1.3 : 1.5 });
    // prefer Kenney GLB models when loaded; fall back to procedural shapes
    const useModels = theme.trees.some((t) => hasModel(t));
    if (useModels) {
      const isTree = roll < 0.8;
      const pool = isTree ? theme.trees.filter(hasModel) : theme.rocks.filter(hasModel);
      if (pool.length > 0) {
        const name = pool[Math.floor(rng() * pool.length)];
        const height = isTree ? 5.5 + rng() * 4.5 : 0.9 + rng() * 1.6;
        const model = cloneByHeight(name, height);
        if (model) {
          model.position.copy(p);
          model.rotation.y = rng() * Math.PI * 2;
          group.add(model);
          continue;
        }
      }
    }
    if (roll < 0.78) {
      // tree: trunk + soft canopy cluster (or a conifer cone)
      const tree = new THREE.Group();
      const scale = 1.2 + rng() * 1.7;
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.scale.setScalar(scale);
      trunk.position.y = scale * 0.5;
      trunk.castShadow = true;
      tree.add(trunk);
      const mat = foliageMats[Math.floor(rng() * foliageMats.length)];
      if (rng() < 0.4) {
        const canopy = new THREE.Mesh(coneGeo, mat);
        canopy.scale.setScalar(scale);
        canopy.position.y = scale * 1.9;
        canopy.castShadow = true;
        tree.add(canopy);
      } else {
        const main = new THREE.Mesh(canopyGeo, mat);
        main.scale.set(scale, scale * 0.85, scale);
        main.position.y = scale * 1.7;
        main.castShadow = true;
        tree.add(main);
        const side = new THREE.Mesh(canopyGeo, mat);
        const ss = scale * (0.45 + rng() * 0.25);
        side.scale.set(ss, ss * 0.8, ss);
        side.position.set(scale * 0.6, scale * 1.35, scale * (rng() - 0.5) * 0.6);
        side.castShadow = true;
        tree.add(side);
      }
      tree.position.copy(p);
      tree.rotation.y = rng() * Math.PI * 2;
      group.add(tree);
    } else {
      const rock = new THREE.Mesh(blobGeo, rockMat);
      const s = 0.8 + rng() * 1.8;
      rock.scale.set(s, s * 0.55, s);
      rock.position.copy(p);
      rock.position.y = s * 0.2;
      rock.rotation.y = rng() * Math.PI * 2;
      rock.castShadow = true;
      group.add(rock);
    }
  }

  // trackside flags near corners
  const flagMat = new THREE.MeshLambertMaterial({ color: 0x7a3bd6 });
  const poleMat = new THREE.MeshLambertMaterial({ color: 0xdddddd });
  for (let i = 0; i < samples.length; i += 50) {
    const s = samples[i];
    if (s.curvature < 0.02) continue;
    const side = rng() < 0.5 ? 1 : -1;
    const flag = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 5), poleMat);
    pole.position.y = 2;
    pole.castShadow = true;
    flag.add(pole);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 2.6), flagMat);
    banner.position.set(0.5, 2.6, 0);
    banner.material.side = THREE.DoubleSide;
    flag.add(banner);
    flag.position.copy(s.pos).add(s.normal.clone().multiplyScalar(side * (halfWidth + 3)));
    group.add(flag);
  }
}

// Find nearest sample index to a position, searching locally around a hint.
export function nearestSample(
  track: BuiltTrack, pos: THREE.Vector3, hint: number, window = 30
): number {
  const n = track.samples.length;
  let best = hint, bestD = Infinity;
  for (let off = -window; off <= window; off++) {
    const i = (hint + off + n) % n;
    const s = track.samples[i];
    const d = (s.pos.x - pos.x) ** 2 + (s.pos.z - pos.z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
