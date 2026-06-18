// GLB model loading (Kenney CC0 packs) with caching and game-ready normalisation.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map<string, THREE.Group>();

/** Garage car id -> model file */
export const PLAYER_CAR_MODELS: Record<string, string> = {
  'rival-x': 'race',
  'kolt-47': 'sedan-sports',
  'vex-77': 'race-future',
  'hex-9': 'hatchback-sports',
  'nitrous': 'suv',
  'ghost': 'race-future',
};

/** Rival id -> model file */
export const RIVAL_MODELS: Record<string, string> = {
  hayes: 'race-future',
  sato: 'police',
  vargas: 'van',
  novak: 'hatchback-sports',
  park: 'taxi',
};

export const DEBRIS_MODELS = ['debris-tire', 'debris-bumper', 'debris-plate-a', 'debris-spoiler-a'];

const ALL_MODELS = [
  ...new Set([
    ...Object.values(PLAYER_CAR_MODELS),
    ...Object.values(RIVAL_MODELS),
    ...DEBRIS_MODELS,
    'delivery', 'cone',
    'tree_default_fall', 'tree_oak_fall', 'tree_detailed_fall', 'tree_simple_fall',
    'tree_pineDefaultA', 'tree_pineDefaultB', 'tree_pineRoundA', 'tree_pineTallA',
    'tree_palm', 'tree_palmShort', 'tree_palmTall',
    'tree_default_dark', 'tree_thin_dark', 'tree_oak_dark', 'tree_cone_dark',
    'rock_smallA', 'rock_smallB', 'stone_largeA', 'stone_largeB',
  ]),
];

let loadPromise: Promise<void> | null = null;

export function ensureModelsLoaded(): Promise<void> {
  if (!loadPromise) {
    loadPromise = Promise.all(
      ALL_MODELS.map((name) =>
        // BASE_URL keeps paths correct under a GitHub Pages subpath
        loader.loadAsync(`${import.meta.env.BASE_URL}models/${name}.glb`)
          .then((gltf) => { cache.set(name, gltf.scene); })
          .catch((err) => { console.warn(`model ${name} failed to load`, err); })
      )
    ).then(() => undefined);
  }
  return loadPromise;
}

export function hasModel(name: string): boolean {
  return cache.has(name);
}

function rawClone(name: string): THREE.Group | null {
  const src = cache.get(name);
  if (!src) return null;
  const clone = src.clone(true);
  // Object3D.clone shares geometry/material by reference; give each clone its own
  // so a race's dispose() never frees the shared cached source assets.
  clone.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry = m.geometry.clone();
      m.material = Array.isArray(m.material)
        ? m.material.map((mat) => mat.clone())
        : (m.material as THREE.Material).clone();
    }
  });
  return clone;
}

/**
 * Clone a model normalised for the game: centred at origin (x/z), resting on y=0,
 * uniformly scaled so its largest footprint axis equals `targetSize`, with the
 * long axis aligned to Z. All meshes cast/receive shadows.
 */
export function cloneScaled(name: string, targetSize: number, alignLongAxisToZ = false): THREE.Group | null {
  const obj = rawClone(name);
  if (!obj) return null;

  if (alignLongAxisToZ) {
    const pre = new THREE.Box3().setFromObject(obj);
    const preSize = pre.getSize(new THREE.Vector3());
    if (preSize.x > preSize.z) obj.rotation.y = Math.PI / 2;
  }

  const wrapper = new THREE.Group();
  wrapper.add(obj);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const footprint = Math.max(size.x, size.z);
  const s = footprint > 0.0001 ? targetSize / footprint : 1;
  obj.scale.setScalar(s);
  const box2 = new THREE.Box3().setFromObject(obj);
  const centre = box2.getCenter(new THREE.Vector3());
  obj.position.x -= centre.x;
  obj.position.z -= centre.z;
  obj.position.y -= box2.min.y;
  wrapper.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
  });
  return wrapper;
}

/** Tree/rock clone scaled by world height instead of footprint. */
export function cloneByHeight(name: string, targetHeight: number): THREE.Group | null {
  const obj = rawClone(name);
  if (!obj) return null;
  const wrapper = new THREE.Group();
  wrapper.add(obj);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const s = size.y > 0.0001 ? targetHeight / size.y : 1;
  obj.scale.setScalar(s);
  const box2 = new THREE.Box3().setFromObject(obj);
  const centre = box2.getCenter(new THREE.Vector3());
  obj.position.x -= centre.x;
  obj.position.z -= centre.z;
  obj.position.y -= box2.min.y;
  wrapper.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.castShadow = true; }
  });
  return wrapper;
}

/**
 * Build a game-ready racer car from a model: ~4.4 units long, facing +Z,
 * body tinted toward the racer colour, roof number plate, hidden boost flame.
 */
export function buildCarFromModel(name: string, color: number, carNum: string): THREE.Group | null {
  const car = cloneScaled(name, 4.4, true);
  if (!car) return null;

  // tint the body mesh (separate from wheels in Kenney car kit)
  const tint = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.25);
  car.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && /body/i.test(m.name)) {
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      mat.color = tint;
      mat.metalness = 0.55;   // glossy car paint that reflects the environment
      mat.roughness = 0.35;
      m.material = mat;
    }
  });

  const box = new THREE.Box3().setFromObject(car);

  // roof number plate
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f2f2f2';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#16181d';
  ctx.font = 'bold 44px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(carNum, 32, 36);
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(1.05, 1.05),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas) })
  );
  plate.rotation.x = -Math.PI / 2;
  plate.rotation.z = Math.PI;
  plate.position.set(0, box.max.y + 0.02, -0.1);
  car.add(plate);

  // boost flame (hidden until boosting)
  const flame = new THREE.Group();
  flame.name = 'boostFlame';
  const inner = new THREE.Mesh(
    new THREE.ConeGeometry(0.28, 1.6, 6),
    new THREE.MeshBasicMaterial({ color: 0xaee8ff, transparent: true, opacity: 0.95 })
  );
  inner.rotation.x = -Math.PI / 2;
  flame.add(inner);
  const outer = new THREE.Mesh(
    new THREE.ConeGeometry(0.42, 1.1, 6),
    new THREE.MeshBasicMaterial({ color: 0x3aa0ff, transparent: true, opacity: 0.6 })
  );
  outer.rotation.x = -Math.PI / 2;
  outer.position.z = 0.2;
  flame.add(outer);
  flame.position.set(0, 0.55, box.min.z - 0.55);
  flame.visible = false;
  car.add(flame);

  return car;
}
