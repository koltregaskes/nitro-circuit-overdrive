// Procedural low-poly car mesh with a readable roof number.

import * as THREE from 'three';
import { attachWheelRig } from './models';

// Shared gradient texture for the ground-projected headlight pool (night themes).
// Bright at the car's nose, fading to nothing — additive, so it reads as light.
let beamTex: THREE.CanvasTexture | null = null;
function headlightBeamTexture(): THREE.CanvasTexture {
  if (beamTex) return beamTex;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 128, 0, 0);
  grad.addColorStop(0, 'rgba(255,244,214,0.85)');
  grad.addColorStop(0.55, 'rgba(255,240,200,0.28)');
  grad.addColorStop(1, 'rgba(255,238,190,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  // trapezoid: narrow at the car, spreading forward
  ctx.moveTo(22, 128); ctx.lineTo(42, 128); ctx.lineTo(64, 0); ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();
  beamTex = new THREE.CanvasTexture(c);
  return beamTex;
}

/**
 * Attach night-driving lights to any car: a ground-projected headlight pool
 * (name `headlights`, off by default — the race turns it on for night themes),
 * dim always-on tail lamps (`taillights`, night only) and bright brake lamps
 * (`brakeLights`, driven by the sim every frame).
 */
export function attachCarLights(car: THREE.Group, frontZ: number, rearZ: number, y = 0.5): void {
  const head = new THREE.Group();
  head.name = 'headlights';
  // sized to READ at gameplay zoom — the subtle version was invisible to a
  // fresh critic, and too-subtle-to-see equals absent
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(4.6, 10.5),
    new THREE.MeshBasicMaterial({
      map: headlightBeamTexture(), transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0, 0.07, frontZ + 5.4);
  head.add(pool);
  for (const x of [-0.5, 0.5]) {
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.12, 0.06),
      new THREE.MeshBasicMaterial({ color: 0xfff6cf })
    );
    lamp.position.set(x, y, frontZ + 0.04);
    head.add(lamp);
  }
  head.visible = false;
  car.add(head);

  const tail = new THREE.Group();
  tail.name = 'taillights';
  for (const x of [-0.5, 0.5]) {
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.1, 0.05),
      new THREE.MeshBasicMaterial({ color: 0x7a1420 })
    );
    lamp.position.set(x, y, rearZ - 0.03);
    tail.add(lamp);
  }
  tail.visible = false;
  car.add(tail);

  const brake = new THREE.Group();
  brake.name = 'brakeLights';
  for (const x of [-0.5, 0.5]) {
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.14, 0.07),
      new THREE.MeshBasicMaterial({ color: 0xff2431 })
    );
    lamp.position.set(x, y, rearZ - 0.05);
    brake.add(lamp);
  }
  brake.visible = false;
  car.add(brake);
}

/**
 * Real car silhouette: a side profile (bumper → bonnet → raked screen → roof →
 * fastback → boot) extruded across the car's width with a bevel, which is how a
 * car is actually modelled. Stacked boxes can never give wheel-arch flare, a
 * raked screen or a tapered nose — and under the new perspective camera those
 * are exactly the shapes the eye reads.
 */
function carBodyGeometry(): THREE.ExtrudeGeometry {
  const p = new THREE.Shape();
  p.moveTo(-2.18, 0.26);   // rear bumper, bottom
  p.lineTo(-2.20, 0.66);
  p.lineTo(-2.02, 0.88);   // boot lip
  p.lineTo(-1.20, 0.93);
  p.lineTo(-0.88, 1.32);   // rear screen → roof
  p.lineTo(0.12, 1.36);    // roof
  p.lineTo(0.66, 0.96);    // windscreen base
  p.lineTo(1.42, 0.88);    // bonnet
  p.lineTo(2.06, 0.76);
  p.lineTo(2.20, 0.58);    // nose
  p.lineTo(2.18, 0.26);    // front bumper, bottom
  p.lineTo(-2.18, 0.26);
  const geo = new THREE.ExtrudeGeometry(p, {
    depth: 1.66, bevelEnabled: true, bevelThickness: 0.07,
    bevelSize: 0.07, bevelSegments: 2, steps: 1,
  });
  // shape is authored in (z,y); extrusion runs along +Z → rotate into car space
  geo.rotateY(Math.PI / 2);
  geo.translate(0.83, 0, 0);
  geo.center();
  geo.translate(0, 0.81, 0);
  return geo;
}

export function buildCarMesh(color: number, accent: number, carNum: string): THREE.Group {
  const g = new THREE.Group();
  // clearcoat paint: a car reads as a car largely through its specular sheen
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color, metalness: 0.35, roughness: 0.28, clearcoat: 0.9, clearcoatRoughness: 0.12,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c1f26, flatShading: true, roughness: 0.7 });
  const accentMat = new THREE.MeshStandardMaterial({ color: accent, flatShading: true, roughness: 0.5 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0d1420, metalness: 0.1, roughness: 0.08, transmission: 0.55,
    transparent: true, opacity: 0.72, clearcoat: 1,
  });

  // body — car points along +Z
  const body = new THREE.Mesh(carBodyGeometry(), bodyMat);
  g.add(body);

  // greenhouse glass: raked windscreen + rear screen sitting in the profile
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.42, 0.72), glassMat);
  screen.position.set(0, 1.15, 0.44);
  screen.rotation.x = -0.62;
  g.add(screen);
  const rearScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.38, 0.6), glassMat);
  rearScreen.position.set(0, 1.14, -1.02);
  rearScreen.rotation.x = 0.72;
  g.add(rearScreen);
  for (const sx of [0.845, -0.845]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.42), glassMat);
    side.position.set(sx, 1.16, -0.36);
    side.rotation.y = Math.PI / 2;
    g.add(side);
  }

  // grille + front splitter
  const grille = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.22, 0.1), darkMat);
  grille.position.set(0, 0.62, 2.16);
  g.add(grille);

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
  const tex = new THREE.CanvasTexture(canvas);
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.95, 0.95),
    new THREE.MeshBasicMaterial({ map: tex })
  );
  plate.rotation.x = -Math.PI / 2;
  plate.rotation.z = Math.PI; // readable when car points down-screen toward camera... keep upright vs car forward
  plate.position.set(0, 1.19, -0.25);
  g.add(plate);

  // spoiler
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.4), accentMat);
  spoiler.position.set(0, 1.0, -1.65);
  g.add(spoiler);
  const strutL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.35, 0.15), darkMat);
  strutL.position.set(0.6, 0.8, -1.6);
  g.add(strutL);
  const strutR = strutL.clone();
  strutR.position.x = -0.6;
  g.add(strutR);

  // wheels — tyre + metallic rim + brake disc, named/rigged for the sim.
  // A wheel is the one part the eye checks for "is this a real car"; a flat
  // dark cylinder reads as a caster.
  const tyreGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.30, 16);
  tyreGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.32, 10);
  rimGeo.rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.325, 0.075, 0.44);
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x14161b, roughness: 0.95 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd4, metalness: 0.95, roughness: 0.25 });
  const wheels: THREE.Object3D[] = [];
  for (const [x, z] of [[0.86, 1.28], [-0.86, 1.28], [0.86, -1.32], [-0.86, -1.32]]) {
    const w = new THREE.Group();
    w.name = 'wheel';
    const tyre = new THREE.Mesh(tyreGeo, tyreMat);
    w.add(tyre);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    w.add(rim);
    // three spokes — they catch the light as the wheel spins, which is what
    // actually communicates rotation at speed
    for (let s = 0; s < 3; s++) {
      const spoke = new THREE.Mesh(spokeGeo, rimMat);
      spoke.rotation.x = (s / 3) * Math.PI;
      w.add(spoke);
    }
    w.position.set(x, 0.42, z);
    g.add(w);
    wheels.push(w);
  }
  attachWheelRig(g, wheels);

  // headlights — emissive so bloom picks them up at night
  const lightMat = new THREE.MeshStandardMaterial({
    color: 0xfff2b8, emissive: 0xfff0c0, emissiveIntensity: 1.4, roughness: 0.2,
  });
  for (const x of [0.55, -0.55]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.1), lightMat);
    l.position.set(x, 0.62, 2.2);
    g.add(l);
  }

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
  flame.position.set(0, 0.5, -2.45);
  flame.visible = false;
  g.add(flame);

  attachCarLights(g, 2.3, -1.75, 0.5);

  return g;
}

export function buildMissileMesh(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 1.4, 8),
    new THREE.MeshLambertMaterial({ color: 0xe8e8e8 })
  );
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.45, 8),
    new THREE.MeshLambertMaterial({ color: 0xd62828 })
  );
  tip.rotation.x = Math.PI / 2;
  tip.position.z = 0.9;
  g.add(tip);
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.18, 0.6, 6),
    new THREE.MeshBasicMaterial({ color: 0xffa838 })
  );
  flame.rotation.x = -Math.PI / 2;
  flame.position.z = -1.0;
  g.add(flame);
  return g;
}

export function buildAnimalMesh(): THREE.Group {
  const g = new THREE.Group();
  const fur = new THREE.MeshLambertMaterial({ color: 0xa8743a });
  const dark = new THREE.MeshLambertMaterial({ color: 0x6b4a26 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 1.3), fur);
  body.position.y = 0.75;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.55), fur);
  head.position.set(0, 1.2, 0.75);
  head.castShadow = true;
  g.add(head);
  for (const [x, z] of [[0.25, 0.45], [-0.25, 0.45], [0.25, -0.45], [-0.25, -0.45]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), dark);
    leg.position.set(x, 0.25, z);
    g.add(leg);
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.3), new THREE.MeshLambertMaterial({ color: 0xf2ecdc }));
  tail.position.set(0, 0.95, -0.75);
  g.add(tail);
  return g;
}

export function buildLorryMesh(): THREE.Group {
  const g = new THREE.Group();
  const cab = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 2.0, 2.4),
    new THREE.MeshStandardMaterial({ color: 0xd6582d, flatShading: true, roughness: 0.5 })
  );
  cab.position.set(0, 1.0, 3.6);
  g.add(cab);
  const tank = new THREE.Mesh(
    new THREE.CylinderGeometry(1.3, 1.3, 5.5, 10),
    new THREE.MeshStandardMaterial({ color: 0xb8bec9, flatShading: true, metalness: 0.5, roughness: 0.35 })
  );
  tank.rotation.x = Math.PI / 2;
  tank.position.set(0, 1.4, 0);
  g.add(tank);
  const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.4, 8);
  wheelGeo.rotateZ(Math.PI / 2);
  const dark = new THREE.MeshLambertMaterial({ color: 0x1c1f26 });
  for (const [x, z] of [[1.1, 3.4], [-1.1, 3.4], [1.1, -1.4], [-1.1, -1.4], [1.1, 0.2], [-1.1, 0.2]]) {
    const w = new THREE.Mesh(wheelGeo, dark);
    w.position.set(x, 0.5, z);
    g.add(w);
  }
  return g;
}

export function buildMineMesh(): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.65, 0.25, 8),
    new THREE.MeshLambertMaterial({ color: 0x3a3f4a })
  );
  base.position.y = 0.12;
  g.add(base);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0xc23b3b })
  );
  dome.position.y = 0.25;
  g.add(dome);
  return g;
}
