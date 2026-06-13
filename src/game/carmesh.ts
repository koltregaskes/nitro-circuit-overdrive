// Procedural low-poly car mesh with a readable roof number.

import * as THREE from 'three';

export function buildCarMesh(color: number, accent: number, carNum: string): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x1c1f26 });
  const accentMat = new THREE.MeshLambertMaterial({ color: accent });

  // body — car points along +Z
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 3.4), bodyMat);
  body.position.y = 0.5;
  g.add(body);

  // nose wedge
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.35, 0.7), bodyMat);
  nose.position.set(0, 0.42, 1.95);
  g.add(nose);

  // cabin
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.45, 1.5), darkMat);
  cabin.position.set(0, 0.95, -0.25);
  g.add(cabin);

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

  // wheels
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 8);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const [x, z] of [[0.85, 1.15], [-0.85, 1.15], [0.85, -1.2], [-0.85, -1.2]]) {
    const w = new THREE.Mesh(wheelGeo, darkMat);
    w.position.set(x, 0.36, z);
    g.add(w);
  }

  // headlights
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff2b8 });
  for (const x of [0.55, -0.55]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.1), lightMat);
    l.position.set(x, 0.5, 2.28);
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
    new THREE.MeshLambertMaterial({ color: 0xd6582d })
  );
  cab.position.set(0, 1.0, 3.6);
  g.add(cab);
  const tank = new THREE.Mesh(
    new THREE.CylinderGeometry(1.3, 1.3, 5.5, 10),
    new THREE.MeshLambertMaterial({ color: 0xb8bec9 })
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
