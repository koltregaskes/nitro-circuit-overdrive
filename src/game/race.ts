// Race simulation: arcade car physics, AI rivals, weapons, laps and positions.

import * as THREE from 'three';
import { CarStats } from './data';
import { BuiltTrack, Obstacle, nearestSample } from './track';
import { buildAnimalMesh, buildCarMesh, buildLorryMesh, buildMineMesh, buildMissileMesh } from './carmesh';
import { GhostLap } from './save';
import { DEBRIS_MODELS, WheelRig, buildCarFromModel, cloneScaled } from './models';

export interface RacerConfig {
  id: string;
  name: string;
  carNum: string;
  color: number;
  accent: number;
  model: string | null; // GLB model name; null = procedural box car
  isPlayer: boolean;
  skill: number;
  stats: CarStats;
  condition: number; // 0-100 (player only; AI = 100)
  items: { missile: number; mine: number };
}

export interface RaceResult {
  id: string;
  name: string;
  carNum: string;
  color: number;
  isPlayer: boolean;
  position: number;
  timeMs: number | null;
  estimated: boolean;
  bestLapMs: number | null;
  damageTaken: number;
}

export interface PlayerInput {
  throttle: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
  steerAxis: number | null; // analog override, + = left (gamepad)
  boost: boolean;
  fireMissile: boolean; // edge-triggered
  dropMine: boolean;    // edge-triggered
}

interface Racer {
  cfg: RacerConfig;
  mesh: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  heading: number;
  speed: number;
  sampleIdx: number;
  lap: number;
  lapStart: number;
  bestLapMs: number | null;
  progress: number;
  armour: number;
  maxArmour: number;
  damageTaken: number;
  boostMeter: number; // 0..1
  boosting: boolean;
  stun: number;
  spinDir: number;
  finished: boolean;
  finishTime: number | null;
  items: { missile: number; mine: number };
  offTrack: boolean;
  wrongWay: number;
  flame: THREE.Object3D | null;
  slip: number;      // oil-slick slide timer
  debrisCd: number;  // debris hit cooldown
  crash: number;     // crash-recovery timer (frozen + flashing while > 0)
  // animation rig (Phase 3 juice)
  wheels: WheelRig[];
  wheelSpin: number; // accumulated wheel roll angle
  prevSpeed: number; // for accel-derived suspension pitch
  bodyPitch: number; // smoothed nose-up/nose-down
  brakeLights: THREE.Object3D | null; // bright rear lamps, shown while braking
  // AI state
  aiOffset: number;
  aiBoostCd: number;
  aiItemCd: number;
  rubber: number;
}

interface Animal {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  hopT: number;
  fleeing: boolean;
  life: number;
}

interface LorryEvent {
  mesh: THREE.Group;
  phase: 'approach' | 'tip' | 'spill' | 'done';
  t: number;
  startPos: THREE.Vector3;
  crashPos: THREE.Vector3;
  baseIdx: number;
  side: number;
  headingY: number;
  spillT: number;
  spillCount: number;
}

interface Missile {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  heading: number;
  target: Racer | null;
  owner: Racer;
  life: number;
}

interface Mine {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  owner: Racer;
  armTime: number;
  ownerGrace: number;
}

interface Effect {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  grow: number;
  base: number; // base scale — size now lives on the transform, not the geometry
}

export interface HudState {
  position: number;
  racerCount: number;
  lap: number;
  laps: number;
  raceTimeMs: number;
  bestLapMs: number | null;
  speedKmh: number;
  gear: number;
  armourFrac: number;
  boostFrac: number;
  items: { missile: number; mine: number };
  countdown: number | null; // 3,2,1 or null
  message: string | null;
  wrongWay: boolean;
  board: { name: string; carNum: string; color: number; isPlayer: boolean }[];
  minimapDots: { x: number; y: number; color: number; isPlayer: boolean }[];
  finished: boolean;
}

export type RacePhase = 'countdown' | 'racing' | 'finished';
export type RaceMode = 'race' | 'timetrial' | 'elimination';

export interface RaceOptions {
  weapons?: boolean;
  mode?: RaceMode;
  /** AI cornering grip — difficulty scales this (see DIFFICULTY_TUNING). */
  latGrip?: number;
  /** Ghost lap to replay alongside the player (Time Trial only). */
  ghost?: { stride: number; frames: number[] } | null;
  /** Override the track's lap count (Elimination needs one lap per cull). */
  laps?: number;
}

/** Sampling stride for ghost recording — every Nth frame keeps the save small. */
export const GHOST_STRIDE = 3;

const GRID_COLORS_FALLBACK = 0x888888;

// Inward-facing gradient sky dome (art-of-rally look): horizon = fog colour so the
// dome, fog and ground edge all blend into one atmosphere.
//
// NOTE (measured 2026-07-21): with the current hard top-down ortho camera this dome
// is NOT visible in gameplay — the radius-900 ground disc fills the whole frame, so
// no horizon is ever on screen. Toggling `dome.visible` is pixel-identical. It is
// kept deliberately because it costs ~1 occluded draw call and Phase 5's free-camera
// photo mode WILL see it. The visible Phase-2 atmosphere comes from FogExp2 + the
// per-theme grade, not from this. Don't "fix" the look by tweaking the dome.
function makeSkyDome(top: THREE.Color, horizon: THREE.Color): THREE.Mesh {
  // radius sits the camera (which roams Â±~250 around origin) comfortably inside the
  // dome while staying within the ortho far plane (main.ts sets far=2200)
  const geo = new THREE.SphereGeometry(1200, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: top.clone() },
      bottomColor: { value: horizon.clone() },
      offset: { value: 120 },     // pushes the gradient midpoint above the horizon
      exponent: { value: 0.7 },
    },
    vertexShader: /* glsl */`
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
        gl_FragColor = vec4(mix(bottomColor, topColor, pow(max(h, 0.0), exponent)), 1.0);
      }
    `,
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.frustumCulled = false;
  return dome;
}

export class Race {
  readonly scene: THREE.Scene;
  readonly track: BuiltTrack;
  /** debug/testing: when true the player car is AI-driven */
  autopilot = false;
  /** camera shake trauma 0..1, read by the renderer */
  shakeTrauma = 0;
  // ONE unit sphere shared by every explosion/spark/dust/trail puff. Owned by the
  // race (not module-level) so dispose() frees it correctly and the next race builds
  // its own — a shared module constant would be disposed out from under race #2.
  // Materials stay per-puff because updateEffects fades opacity independently.
  private fxGeo = new THREE.SphereGeometry(1, 7, 6);
  // Skid marks: ONE InstancedMesh ring buffer. They used to be 150 individual meshes
  // = up to 150 draw calls, which was the single biggest draw-call cost in the game
  // (measured: 129 for the whole tunnel scene vs +150 for a full skid pool).
  private static readonly SKID_CAP = 160;
  private skidMesh!: THREE.InstancedMesh;
  private skidWrite = 0;      // monotonic; wraps into the ring via % SKID_CAP
  private skidDummy = new THREE.Object3D();
  private skidMat = new THREE.MeshBasicMaterial({ color: 0x14141a, transparent: true, opacity: 0.4, depthWrite: false });
  private racers: Racer[] = [];
  private missiles: Missile[] = [];
  private mines: Mine[] = [];
  private effects: Effect[] = [];
  private phase: RacePhase = 'countdown';
  private phaseTime = 0;
  private raceTime = 0;
  private message: string | null = null;
  private messageTime = 0;
  private finishedOrder: Racer[] = [];
  private onFinish: (results: RaceResult[]) => void;
  private player!: Racer;
  private sfx: (name: string, vol?: number) => void;
  private sun!: THREE.DirectionalLight;
  private weapons: boolean;
  private oilSlicks: { mesh: THREE.Mesh; pos: THREE.Vector3; radius: number }[] = [];
  private debris: { mesh: THREE.Object3D; pos: THREE.Vector3; radius: number }[] = [];
  private animals: Animal[] = [];
  private lorryEvt: LorryEvent | null = null;
  private obstacles: Obstacle[] = []; // race-local copy so the cached track stays pristine
  private nextEventAt = 16 + Math.random() * 12;
  private lorryDone = false;
  private lastCount = -1;
  // ---- Phase 4: modes ----
  private mode: RaceMode = 'race';
  private latGrip = 30;
  /** effective lap count for this race (may differ from the track default) */
  private laps = 3;
  /** Time Trial: pose samples of the current lap, committed if it's a new best. */
  private lapRecording: number[] = [];
  private lapFrame = 0;
  private bestLapFrames: number[] | null = null;
  private ghostMesh: THREE.Group | null = null;
  private ghostFrames: number[] | null = null;
  private ghostStride = GHOST_STRIDE;
  private eliminated = new Set<string>();
  private lastEliminationLap = 0;

  constructor(
    track: BuiltTrack,
    configs: RacerConfig[],
    onFinish: (results: RaceResult[]) => void,
    sfx: (name: string, vol?: number) => void,
    opts: RaceOptions = {}
  ) {
    this.weapons = opts.weapons ?? true;
    this.mode = opts.mode ?? 'race';
    this.latGrip = opts.latGrip ?? 30;
    this.laps = opts.laps ?? track.def.laps;
    if (this.mode !== 'race') this.weapons = false; // no weapons in TT/elimination
    if (this.mode === 'timetrial') this.nextEventAt = Infinity; // no hazards spoiling a hot lap
    this.track = track;
    this.obstacles = track.obstacles.map((o) => ({ pos: o.pos, radius: o.radius }));
    this.onFinish = onFinish;
    this.sfx = sfx;
    this.scene = new THREE.Scene();
    // sky dome + exponential fog, both keyed to the theme: the dome horizon equals
    // the fog colour so distance haze reads as one continuous atmosphere
    const theme = track.def.theme;
    const fog = new THREE.Color(theme.fog);
    this.scene.background = fog.clone(); // fallback where the dome is clipped
    this.scene.add(makeSkyDome(new THREE.Color(theme.skyTop), fog));
    this.scene.fog = new THREE.FogExp2(fog.getHex(), theme.fogDensity);
    this.scene.add(track.group);

    // per-theme lighting rig (NIGHT swaps the sun for cool moonlight)
    const L = theme.light;
    const ambient = new THREE.AmbientLight(L.ambient, L.ambientIntensity);
    this.scene.add(ambient);
    const hemi = new THREE.HemisphereLight(L.hemiSky, L.hemiGround, L.hemiIntensity);
    this.scene.add(hemi);
    // rim/back light opposite the sun: cool edge separation on car roofs and canopies
    const rim = new THREE.DirectionalLight(L.rim, L.rimIntensity);
    rim.position.set(-70, 60, -50);
    rim.castShadow = false;
    this.scene.add(rim);
    const sun = new THREE.DirectionalLight(L.sun, L.sunIntensity);
    // LOW raking sun (~22° elevation): long shadows and warm/cool separation are
    // where the reference gets its depth — the old 63° noon sun cast stubs and
    // "lit like a product turntable" (critic, iter 1)
    sun.position.set(130, 62, 85);
    sun.castShadow = true;
    // frustum widened for the long shadows the raking angle throws
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -95;
    sun.shadow.camera.right = 95;
    sun.shadow.camera.top = 95;
    sun.shadow.camera.bottom = -95;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 420;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;

    // everything in the track receives shadows; decor casts them (flagged in track.ts)
    track.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.receiveShadow = true;
    });

    configs.forEach((cfg, i) => {
      const slot = track.startPositions[i % track.startPositions.length];
      let mesh = cfg.model ? buildCarFromModel(cfg.model, cfg.color, cfg.carNum) : null;
      if (!mesh) {
        mesh = buildCarMesh(cfg.color, cfg.accent, cfg.carNum);
        mesh.scale.setScalar(1.25); // visual readability from the top-down camera
      }
      mesh.position.copy(slot.pos);
      // YXZ: heading (Y) first, then suspension pitch (X) and drift lean (Z) resolve
      // in the car's OWN axes rather than world axes
      mesh.rotation.order = 'YXZ';
      mesh.rotation.y = slot.heading;
      mesh.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
      });
      // night themes: headlight pools + dim tail lamps on every car (critic fix:
      // "a night racer where the cars don't glow is a daytime scene turned down")
      if (theme.night) {
        const hl = mesh.getObjectByName('headlights');
        if (hl) { hl.visible = true; hl.traverse((o) => { (o as THREE.Mesh).castShadow = false; }); }
        const tl = mesh.getObjectByName('taillights');
        if (tl) tl.visible = true;
      }
      // highlight ring under the player's car so it's always findable in the pack
      if (cfg.isPlayer) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(2.0, 2.5, 24),
          new THREE.MeshBasicMaterial({ color: 0x2de2e6, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.08;
        mesh.add(ring);
      }
      this.scene.add(mesh);
      const maxArmour = 70 + cfg.stats.armour * 8;
      const racer: Racer = {
        cfg, mesh,
        pos: slot.pos.clone(),
        vel: new THREE.Vector3(),
        heading: slot.heading,
        speed: 0,
        sampleIdx: nearestSample(track, slot.pos, 0, track.samples.length / 2),
        lap: 0,
        lapStart: 0,
        bestLapMs: null,
        progress: 0,
        armour: cfg.isPlayer ? maxArmour * Math.max(0.35, cfg.condition / 100) : maxArmour,
        maxArmour,
        damageTaken: 0,
        boostMeter: 1,
        boosting: false,
        stun: 0,
        spinDir: 1,
        finished: false,
        finishTime: null,
        items: this.weapons ? { ...cfg.items } : { missile: 0, mine: 0 },
        offTrack: false,
        wrongWay: 0,
        flame: mesh.getObjectByName('boostFlame') ?? null,
        slip: 0,
        debrisCd: 0,
        crash: 0,
        wheels: (mesh.userData.wheels as WheelRig[] | undefined) ?? [],
        wheelSpin: 0,
        prevSpeed: 0,
        bodyPitch: 0,
        brakeLights: mesh.getObjectByName('brakeLights') ?? null,
        aiOffset: (Math.random() - 0.5) * track.halfWidth * 0.8,
        aiBoostCd: 2 + Math.random() * 4,
        aiItemCd: 5 + Math.random() * 6,
        rubber: 1,
      };
      this.racers.push(racer);
      if (cfg.isPlayer) this.player = racer;
    });
    if (!this.player) this.player = this.racers[0];

    // skid ring buffer — one draw call for every tyre mark on the track
    const skidGeo = new THREE.PlaneGeometry(0.45, 1.1);
    skidGeo.rotateX(-Math.PI / 2); // lie flat on the road; instances then just yaw
    this.skidMesh = new THREE.InstancedMesh(skidGeo, this.skidMat, Race.SKID_CAP);
    this.skidMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.skidMesh.frustumCulled = false; // marks spread down the whole track
    this.skidMesh.count = 0;
    this.skidMesh.renderOrder = 1;       // draw over the road surface
    this.scene.add(this.skidMesh);

    // ghost car: translucent, non-colliding replay of the player's best lap
    if (opts.ghost && opts.ghost.frames.length >= 3) {
      this.ghostFrames = opts.ghost.frames;
      this.ghostStride = Math.max(1, opts.ghost.stride);
      const pcfg = configs.find((c) => c.isPlayer) ?? configs[0];
      const gm = (pcfg.model ? buildCarFromModel(pcfg.model, 0x8fe8ff, '--') : null)
        ?? buildCarMesh(0x8fe8ff, 0xffffff, '--');
      gm.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const src = Array.isArray(m.material) ? m.material[0] : m.material;
        const mat = (src as THREE.Material).clone() as THREE.MeshStandardMaterial;
        mat.transparent = true;
        mat.opacity = 0.34;
        mat.depthWrite = false;
        m.material = mat;
        m.castShadow = false;   // a ghost casting a shadow reads as a solid rival
        m.receiveShadow = false;
      });
      this.ghostMesh = gm;
      this.scene.add(gm);
    }

    // Time Trial is a clean hot-lap sandbox — no standing hazards
    const n = track.samples.length;
    if (this.mode !== 'timetrial') {
      for (let k = 0; k < 2; k++) {
        const idx = Math.floor(((k + 1) / 3 + Math.random() * 0.15) * n) % n;
        this.spawnOil(idx, (Math.random() - 0.5) * track.halfWidth * 1.1);
      }
    }
  }

  // ---------- hazards & live events ----------
  private spawnOil(sampleIdx: number, lateral: number): void {
    const s = this.track.samples[sampleIdx % this.track.samples.length];
    const pos = s.pos.clone().addScaledVector(s.normal, lateral);
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(2.3, 12),
      new THREE.MeshBasicMaterial({ color: 0x101218, transparent: true, opacity: 0.85 })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.random() * Math.PI;
    mesh.scale.set(1, 0.65 + Math.random() * 0.3, 1);
    mesh.position.copy(pos);
    mesh.position.y = 0.045;
    this.scene.add(mesh);
    this.oilSlicks.push({ mesh, pos, radius: 2.2 });
  }

  private spawnDebris(sampleIdx: number, lateral: number): void {
    const s = this.track.samples[sampleIdx % this.track.samples.length];
    const pos = s.pos.clone().addScaledVector(s.normal, lateral);
    const name = DEBRIS_MODELS[Math.floor(Math.random() * DEBRIS_MODELS.length)];
    let mesh: THREE.Object3D | null = cloneScaled(name, 1.6);
    if (!mesh) {
      const fallback = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.9, 0),
        new THREE.MeshLambertMaterial({ color: 0x4a4038 })
      );
      fallback.position.y = 0.4;
      fallback.scale.y = 0.55;
      fallback.castShadow = true;
      mesh = fallback;
    }
    mesh.position.x = pos.x;
    mesh.position.z = pos.z;
    mesh.rotation.y = Math.random() * Math.PI;
    this.scene.add(mesh);
    this.debris.push({ mesh, pos, radius: 1.7 });
  }

  private eventAnimal(): void {
    const n = this.track.samples.length;
    // spawn just ahead of the PLAYER so they actually witness it
    const s = this.track.samples[(this.player.sampleIdx + 34) % n];
    const side = Math.random() < 0.5 ? 1 : -1;
    const start = s.pos.clone().addScaledVector(s.normal, side * (this.track.halfWidth + 9));
    const mesh = buildAnimalMesh();
    mesh.position.copy(start);
    const dir = s.normal.clone().multiplyScalar(-side);
    mesh.rotation.y = Math.atan2(dir.x, dir.z);
    this.scene.add(mesh);
    this.animals.push({ mesh, pos: start, dir, speed: 6, hopT: 0, fleeing: false, life: 14 });
    this.message = 'âš  ANIMAL ON TRACK!';
    this.messageTime = 2.2;
    this.sfx('alert');
  }

  // Spawn a tanker that drives in from the verge, skids onto the track, tips over
  // and spills oil + debris — all animated. (updateLorry drives the phases.)
  private eventLorry(): void {
    this.lorryDone = true;
    const n = this.track.samples.length;
    // ahead of the player, close enough to watch it drive in, skid and tip
    const baseIdx = (this.player.sampleIdx + 48) % n;
    const s = this.track.samples[baseIdx];
    const side = Math.random() < 0.5 ? 1 : -1;
    // crash point sits across the racing line; truck starts well off the verge
    const crashPos = s.pos.clone().addScaledVector(s.normal, side * this.track.halfWidth * 0.25);
    crashPos.y = 1.1;
    const startPos = s.pos.clone().addScaledVector(s.normal, side * (this.track.halfWidth + 26));
    startPos.y = 1.1;
    const lorry = buildLorryMesh();
    lorry.position.copy(startPos);
    // face from start toward crash point
    const dir = crashPos.clone().sub(startPos).setY(0).normalize();
    const headingY = Math.atan2(dir.x, dir.z);
    lorry.rotation.y = headingY;
    lorry.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.castShadow = true; });
    this.scene.add(lorry);
    this.lorryEvt = {
      mesh: lorry, phase: 'approach', t: 0,
      startPos, crashPos, baseIdx, side, headingY, spillT: 0, spillCount: 0,
    };
    this.message = 'âš  RUNAWAY TANKER!';
    this.messageTime = 2.4;
    this.sfx('alert');
  }

  private updateLorry(dt: number): void {
    const L = this.lorryEvt;
    if (!L || L.phase === 'done') return;
    L.t += dt;
    if (L.phase === 'approach') {
      // ease in over 1.6s from verge to crash point, decelerating
      const k = Math.min(1, L.t / 1.6);
      const ease = 1 - (1 - k) * (1 - k);
      L.mesh.position.lerpVectors(L.startPos, L.crashPos, ease);
      L.mesh.position.y = 1.1;
      L.mesh.rotation.y = L.headingY;
      // a little wobble as it loses control near the end
      if (k > 0.7) L.mesh.rotation.y = L.headingY + Math.sin(L.t * 30) * 0.05 * (k - 0.7) / 0.3;
      if (k >= 1) { L.phase = 'tip'; L.t = 0; this.sfx('wreck'); this.spawnSparks(L.crashPos.clone()); }
    } else if (L.phase === 'tip') {
      // skid, spin and roll onto its side over 0.9s with a bounce + dust
      const k = Math.min(1, L.t / 0.9);
      const over = 1 - (1 - k) * (1 - k);
      L.mesh.rotation.z = L.side * 1.2 * over;
      L.mesh.rotation.y = L.headingY + L.side * 2.0 * over; // jackknife spin
      L.mesh.position.y = 1.1 + Math.sin(over * Math.PI) * 0.7;
      if (Math.random() < 0.5) this.spawnDust(L.crashPos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4)), 0xb0a89a, 1.0);
      if (k >= 1) { L.phase = 'spill'; L.t = 0; this.spawnExplosion(L.crashPos.clone(), 0xffc83d); this.addShake(0.6); }
    } else if (L.phase === 'spill') {
      // lay down oil slicks + debris progressively along the road
      L.spillT += dt;
      if (L.spillT > 0.25 && L.spillCount < 5) {
        L.spillT = 0;
        const off = L.spillCount;
        this.spawnOil(L.baseIdx + 2 + off * 3, (Math.random() - 0.5) * this.track.halfWidth * 1.3);
        if (off % 2 === 0) this.spawnDebris(L.baseIdx + 4 + off * 3, (Math.random() - 0.5) * this.track.halfWidth);
        if (L.spillCount === 0) this.sfx('oil');
        L.spillCount++;
      }
      if (L.spillCount >= 5) {
        L.phase = 'done';
        // the wreck itself is now a solid obstacle (race-local, not the cached track)
        this.obstacles.push({ pos: L.crashPos.clone().setY(0), radius: 3.4 });
      }
    }
  }

  private updateAnimals(dt: number): void {
    for (const a of this.animals) {
      a.life -= dt;
      a.hopT += dt;
      const speed = a.fleeing ? a.speed * 2.3 : a.speed;
      a.pos.addScaledVector(a.dir, speed * dt);
      a.mesh.position.copy(a.pos);
      a.mesh.position.y = Math.abs(Math.sin(a.hopT * 9)) * 0.5;
      a.mesh.rotation.y = Math.atan2(a.dir.x, a.dir.z);
      for (const r of this.racers) {
        if (a.fleeing) break;
        if (r.pos.distanceTo(a.pos) < 2.2) {
          // forgiving: the animal always survives and scampers off; car just slows
          a.fleeing = true;
          r.speed *= 0.4;
          if (r.cfg.isPlayer) this.sfx('animal');
        }
      }
    }
    this.animals = this.animals.filter((a) => {
      if (a.life <= 0) { this.scene.remove(a.mesh); return false; }
      return true;
    });
  }

  get currentPhase(): RacePhase { return this.phase; }
  get playerPos(): THREE.Vector3 { return this.player.pos; }
  get playerSpeedFrac(): number {
    return Math.min(1, Math.abs(this.player.speed) / this.maxSpeedOf(this.player));
  }
  get playerBoosting(): boolean { return this.player.boosting; }

  /** 0-1 tyre-slide amount for the player, used to drive the screech bus. */
  get playerSlip(): number {
    const r = this.player;
    if (r.crash > 0 || r.vel.lengthSq() < 1) return 0;
    const velHeading = Math.atan2(r.vel.x, r.vel.z);
    let s = velHeading - r.heading;
    while (s > Math.PI) s -= Math.PI * 2;
    while (s < -Math.PI) s += Math.PI * 2;
    // needs both a real slide angle and real speed before it squeals
    const speedFactor = Math.min(1, Math.abs(r.speed) / 18);
    const slide = Math.max(Math.abs(s) / 0.55, r.slip > 0 ? 0.8 : 0);
    return Math.min(1, slide) * speedFactor;
  }

  // ---------- derived stats ----------
  private maxSpeedOf(r: Racer): number {
    let v = 26 + r.cfg.stats.speed * 2.4;
    if (r.cfg.isPlayer) v *= 0.88 + 0.12 * (r.cfg.condition / 100);
    if (r.boosting) v *= 1.32 + r.cfg.stats.boost * 0.022;
    if (r.offTrack) v *= 0.78; // gentle arcade penalty — grass shaves speed, doesn't kill it
    if (!r.cfg.isPlayer) v *= r.cfg.skill * r.rubber;
    return v;
  }

  private accelOf(r: Racer): number {
    let a = 13 + r.cfg.stats.accel * 1.8;
    if (r.boosting) a *= 1.5;
    return a;
  }

  // ---------- main update ----------
  update(dt: number, input: PlayerInput, assist: boolean): void {
    this.phaseTime += dt;

    if (this.phase === 'countdown') {
      const c = Math.min(3, Math.max(1, Math.ceil(3.4 - this.phaseTime)));
      if (c !== this.lastCount) { this.lastCount = c; this.sfx('count'); }
      if (this.phaseTime >= 3.4) {
        this.phase = 'racing';
        this.message = 'GO!';
        this.messageTime = 1.0;
        this.sfx('go');
        for (const r of this.racers) r.lapStart = 0;
      }
    } else if (this.phase === 'racing') {
      this.raceTime += dt;
    }

    if (this.messageTime > 0) {
      this.messageTime -= dt;
      if (this.messageTime <= 0) this.message = null;
    }

    const racing = this.phase === 'racing';

    for (const r of this.racers) {
      if (this.eliminated.has(r.cfg.id)) continue; // culled: frozen and hidden
      const ctrl = r.cfg.isPlayer && !this.autopilot
        ? this.playerControls(r, input, racing)
        : this.aiControls(r, racing);
      this.stepRacer(r, ctrl, dt, assist && r.cfg.isPlayer);
      this.updateProgress(r);
    }

    // sun follows the player so the shadow camera stays tight and crisp
    const f = this.player.pos;
    this.sun.position.set(f.x + 130, 62, f.z + 85);
    this.sun.target.position.set(f.x, 0, f.z);

    // live events
    if (racing && this.raceTime >= this.nextEventAt) {
      this.nextEventAt = this.raceTime + 22 + Math.random() * 16;
      if (Math.random() < 0.55 || this.lorryDone) this.eventAnimal();
      else this.eventLorry();
    }
    this.updateAnimals(dt);
    this.updateLorry(dt);
    this.shakeTrauma = Math.max(0, this.shakeTrauma - dt * 1.6);

    this.resolveCarCollisions(dt);
    this.updateMissiles(dt);
    this.updateMines(dt);
    this.updateEffects(dt);
    if (this.mode === 'timetrial') this.updateTimeTrial(racing);
    this.checkFinishes();
  }

  // ---------- Time Trial: record the current lap, replay the stored ghost ----------
  private updateTimeTrial(racing: boolean): void {
    if (!racing) return;
    const p = this.player;
    // record: sample the pose every GHOST_STRIDE frames
    if (this.lapFrame % GHOST_STRIDE === 0) {
      this.lapRecording.push(p.pos.x, p.pos.z, p.heading);
    }
    // replay: walk the stored ghost at the same cadence, lerping between samples
    if (this.ghostMesh && this.ghostFrames) {
      const triples = this.ghostFrames.length / 3;
      const t = this.lapFrame / this.ghostStride;
      const i0 = Math.floor(t);
      if (i0 >= triples - 1) {
        this.ghostMesh.visible = false; // ghost already finished — it was quicker
      } else {
        const f = t - i0, a = i0 * 3, b = (i0 + 1) * 3;
        const g = this.ghostFrames;
        this.ghostMesh.visible = true;
        this.ghostMesh.position.set(
          g[a] + (g[b] - g[a]) * f, 0,
          g[a + 1] + (g[b + 1] - g[a + 1]) * f
        );
        // shortest-arc heading interpolation so the ghost doesn't spin at the wrap
        let dh = g[b + 2] - g[a + 2];
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        this.ghostMesh.rotation.y = g[a + 2] + dh * f;
      }
    }
    this.lapFrame++;
  }

  /** Called on a completed lap: keep the recording if it was the player's best. */
  private commitLapRecording(wasBest: boolean): void {
    if (wasBest && this.lapRecording.length >= 3) this.bestLapFrames = this.lapRecording.slice();
    this.lapRecording = [];
    this.lapFrame = 0;
  }

  /** Best-lap ghost captured this session, ready to persist. */
  bestGhost(): GhostLap | null {
    if (!this.bestLapFrames || this.player.bestLapMs === null) return null;
    return { timeMs: Math.round(this.player.bestLapMs), stride: GHOST_STRIDE, frames: this.bestLapFrames };
  }

  // ---------- controls ----------
  private playerControls(r: Racer, input: PlayerInput, racing: boolean) {
    if (!racing || r.finished || r.stun > 0) {
      return { throttle: r.finished ? 0.25 : 0, brake: 0, steer: 0, boost: false, missile: false, mine: false };
    }
    const digital = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    return {
      throttle: input.throttle ? 1 : 0,
      brake: input.brake ? 1 : 0,
      steer: input.steerAxis !== null && digital === 0 ? input.steerAxis : digital,
      boost: input.boost,
      missile: input.fireMissile,
      mine: input.dropMine,
    };
  }

  private aiControls(r: Racer, racing: boolean) {
    if (!racing || r.stun > 0) {
      return { throttle: 0, brake: 0, steer: 0, boost: false, missile: false, mine: false };
    }
    const track = this.track;
    const n = track.samples.length;

    // rubber band vs player
    const gap = (this.player.progress - r.progress) * track.totalLength;
    r.rubber = THREE.MathUtils.clamp(1 + gap * 0.0012, 0.92, 1.1);

    // steering target
    const lookahead = 8 + Math.abs(r.speed) * 0.5;
    const tIdx = (r.sampleIdx + Math.max(4, Math.round(lookahead / track.segLength))) % n;
    const ts = track.samples[tIdx];
    let offset = THREE.MathUtils.clamp(r.aiOffset, -track.halfWidth * 0.55, track.halfWidth * 0.55);

    // Obstacle avoidance: bias the target line laterally around anything solid sitting
    // near the road ahead (roadside props, bridge pillars, and above all the tanker
    // wreck, which lands ACROSS the racing line). Without this the AI drives straight
    // into it and — before the clear-respawn fix — could crash-loop forever.
    for (let k = 4; k < 28; k += 4) {
      const s2 = track.samples[(r.sampleIdx + k) % n];
      for (const o of this.obstacles) {
        const dx = o.pos.x - s2.pos.x, dz = o.pos.z - s2.pos.z;
        if (dx * dx + dz * dz > 100) continue; // not near the line at this point
        const oLat = dx * s2.normal.x + dz * s2.normal.z;
        const clearance = o.radius + 2.4;
        if (Math.abs(oLat - offset) < clearance) {
          // pass on whichever side keeps us closer to the middle of the road
          const left = oLat + clearance, right = oLat - clearance;
          offset = Math.abs(left) < Math.abs(right) ? left : right;
          offset = THREE.MathUtils.clamp(offset, -track.halfWidth * 0.88, track.halfWidth * 0.88);
        }
      }
    }
    const target = ts.pos.clone().add(ts.normal.clone().multiplyScalar(offset));
    const dx = target.x - r.pos.x, dz = target.z - r.pos.z;
    const desired = Math.atan2(dx, dz);
    let diff = desired - r.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const steer = THREE.MathUtils.clamp(diff / 0.3, -1, 1);

    // corner speed from curvature ahead
    let maxCurv = 0;
    for (let k = 4; k < 30; k += 4) {
      maxCurv = Math.max(maxCurv, track.samples[(r.sampleIdx + k) % n].curvature);
    }
    const latGrip = this.latGrip * r.cfg.skill;
    const cornerSpeed = maxCurv > 0.001 ? Math.sqrt(latGrip / maxCurv) : 999;
    const targetSpeed = Math.min(this.maxSpeedOf(r), cornerSpeed);

    const throttle = r.speed < targetSpeed ? 1 : 0;
    const brake = r.speed > targetSpeed * 1.18 ? 1 : 0;

    // boost on straights
    r.aiBoostCd -= 1 / 60;
    let boost = false;
    if (r.aiBoostCd <= 0 && maxCurv < 0.012 && r.boostMeter > 0.4) {
      boost = true;
      if (r.boostMeter < 0.1) r.aiBoostCd = 6 + Math.random() * 5;
    }

    // items
    r.aiItemCd -= 1 / 60;
    let missile = false, mine = false;
    if (r.aiItemCd <= 0) {
      const ahead = this.findTargetAhead(r, 70);
      if (ahead && r.items.missile > 0) {
        missile = true;
        r.aiItemCd = 8 + Math.random() * 8;
      } else if (r.items.mine > 0 && Math.random() < 0.3) {
        const behind = this.racers.some(
          (o) => o !== r && !o.finished && (r.progress - o.progress) * this.track.totalLength < 25 &&
                 (r.progress - o.progress) > 0
        );
        if (behind) { mine = true; r.aiItemCd = 10 + Math.random() * 8; }
        else r.aiItemCd = 3;
      } else {
        r.aiItemCd = 4;
      }
    }

    return { throttle, brake, steer, boost, missile, mine };
  }

  /**
   * Find a spot on the racing line that is clear of every solid obstacle, searching
   * forward along the track and trying a couple of lateral offsets at each step.
   * Falls back to the raw sample if the track is somehow fully blocked.
   */
  private clearRespawn(startIdx: number): { pos: THREE.Vector3; heading: number } {
    const n = this.track.samples.length;
    const hw = this.track.halfWidth;
    for (let step = 0; step < 40; step++) {
      const s = this.track.samples[(startIdx + step * 3) % n];
      for (const lat of [0, hw * 0.55, -hw * 0.55]) {
        const p = s.pos.clone().addScaledVector(s.normal, lat);
        let clear = true;
        for (const o of this.obstacles) {
          const dx = p.x - o.pos.x, dz = p.z - o.pos.z;
          const rr = o.radius + 2.2; // margin comfortably beyond the 1.0 collision pad
          if (dx * dx + dz * dz < rr * rr) { clear = false; break; }
        }
        if (clear) {
          p.y = 0;
          return { pos: p, heading: Math.atan2(s.tangent.x, s.tangent.z) };
        }
      }
    }
    const s = this.track.samples[startIdx % n];
    const pos = s.pos.clone();
    pos.y = 0;
    return { pos, heading: Math.atan2(s.tangent.x, s.tangent.z) };
  }

  // ---------- physics ----------
  private stepRacer(
    r: Racer,
    ctrl: { throttle: number; brake: number; steer: number; boost: boolean; missile: boolean; mine: boolean },
    dt: number,
    assist: boolean
  ): void {
    // crash recovery: frozen + flashing, then respawn on the track facing forward
    if (r.crash > 0) {
      r.crash -= dt;
      r.boosting = false;
      if (r.flame) r.flame.visible = false;
      r.mesh.visible = Math.floor(r.crash * 12) % 2 === 0;
      if (r.crash <= 0) {
        r.sampleIdx = nearestSample(this.track, r.pos, r.sampleIdx);
        // Respawn CLEAR of solid obstacles. Dropping the car back on the track centre
        // is not safe: the tanker wreck (radius 3.4) sits across the racing line, so a
        // centre respawn lands inside it and the car crashes again the moment it moves
        // — an infinite crash loop that permanently stalls the racer.
        const spawn = this.clearRespawn(r.sampleIdx);
        r.pos.copy(spawn.pos);
        r.heading = spawn.heading;
        r.vel.set(0, 0, 0);
        r.speed = 0;
        r.mesh.visible = true;
        r.mesh.position.copy(r.pos);
        r.mesh.rotation.set(0, r.heading, 0);
      }
      return;
    }

    // boost meter
    const wantBoost = ctrl.boost && r.boostMeter > 0.02 && r.stun <= 0 && !r.finished;
    r.boosting = wantBoost;
    if (wantBoost) {
      r.boostMeter = Math.max(0, r.boostMeter - dt * 0.4);
    } else {
      r.boostMeter = Math.min(1, r.boostMeter + dt * 0.07);
    }

    // weapons
    if (ctrl.missile && r.items.missile > 0 && this.phase === 'racing' && !r.finished) {
      r.items.missile--;
      this.fireMissile(r);
    }
    if (ctrl.mine && r.items.mine > 0 && this.phase === 'racing' && !r.finished) {
      r.items.mine--;
      this.dropMine(r);
    }

    // hazard timers
    if (r.slip > 0) r.slip -= dt;
    if (r.debrisCd > 0) r.debrisCd -= dt;
    for (const o of this.oilSlicks) {
      if (r.slip <= 0 && Math.abs(r.speed) > 6 && r.pos.distanceToSquared(o.pos) < o.radius * o.radius) {
        r.slip = 0.85;
        if (r.cfg.isPlayer) this.sfx('oil');
      }
    }
    for (const d of this.debris) {
      if (r.debrisCd <= 0 && r.pos.distanceToSquared(d.pos) < d.radius * d.radius) {
        r.debrisCd = 1.5;
        r.speed *= 0.55;
        this.applyDamage(r, 4, false);
        this.spawnSparks(r.pos.clone());
        if (r.cfg.isPlayer) this.sfx('bump', 0.6);
      }
    }
    // solid obstacles (trees, rocks, pillars, the tanker wreck): crash on contact
    if (Math.abs(r.speed) > 7) {
      for (const o of this.obstacles) {
        const dx = r.pos.x - o.pos.x, dz = r.pos.z - o.pos.z;
        const rr = o.radius + 1.0;
        if (dx * dx + dz * dz < rr * rr) { this.crashRacer(r); break; }
      }
    }
    if (r.crash > 0) return; // crashed this frame — freeze handled next frame

    // stun (spin-out)
    if (r.stun > 0) {
      r.stun -= dt;
      r.heading += r.spinDir * 7 * dt;
      r.speed *= Math.pow(0.25, dt);
    } else {
      const maxSpeed = this.maxSpeedOf(r);
      const accel = this.accelOf(r);
      r.speed += ctrl.throttle * accel * dt;
      r.speed -= ctrl.brake * 32 * dt;
      // natural drag
      r.speed -= r.speed * (r.offTrack ? 0.6 : 0.32) * dt;
      r.speed = THREE.MathUtils.clamp(r.speed, -8, maxSpeed);

      // steering: less effective at standstill, slightly reduced at top speed
      const stats = r.cfg.stats;
      let steerRate = (1.9 + stats.handling * 0.17 + (assist ? 0.35 : 0)) *
        THREE.MathUtils.clamp(Math.abs(r.speed) / 7, 0, 1) *
        (1 - 0.35 * Math.abs(r.speed) / 60);
      if (r.slip > 0) {
        steerRate *= 0.3;
        r.heading += (Math.random() - 0.5) * 2.2 * dt; // greasy wobble
      }
      r.heading += ctrl.steer * steerRate * dt * Math.sign(r.speed || 1);
    }

    // grip: velocity chases heading direction (drift)
    const dir = new THREE.Vector3(Math.sin(r.heading), 0, Math.cos(r.heading));
    const desiredVel = dir.multiplyScalar(r.speed);
    const grip = (assist ? 8.5 : 6.0) * (r.offTrack ? 0.85 : 1) * (r.slip > 0 ? 0.16 : 1);
    const t = 1 - Math.exp(-grip * dt);
    r.vel.lerp(desiredVel, t);
    r.pos.addScaledVector(r.vel, dt);

    // track relation
    r.sampleIdx = nearestSample(this.track, r.pos, r.sampleIdx);
    const s = this.track.samples[r.sampleIdx];
    const toCar = new THREE.Vector3().subVectors(r.pos, s.pos);
    const lateral = toCar.dot(s.normal);
    r.offTrack = Math.abs(lateral) > this.track.halfWidth + 1.0;

    // soft outer boundary
    const limit = this.track.halfWidth + 13;
    if (Math.abs(lateral) > limit) {
      const pull = (Math.abs(lateral) - limit) * 4;
      r.pos.addScaledVector(s.normal, -Math.sign(lateral) * pull * dt * 4);
      r.speed *= Math.pow(0.5, dt * 2);
    }
    // firm tunnel walls: hard track limit at the road edge so the pass is drivable
    const tun = this.track.def.tunnel;
    if (tun) {
      const frac = r.sampleIdx / this.track.samples.length;
      if (frac >= tun[0] && frac <= tun[1]) {
        const wall = this.track.halfWidth + 0.7;
        if (Math.abs(lateral) > wall) {
          r.pos.copy(s.pos).addScaledVector(s.normal, Math.sign(lateral) * wall);
          r.speed *= Math.pow(0.6, dt * 6);
          if (r.cfg.isPlayer && Math.abs(r.speed) > 16 && Math.random() < 0.3) this.spawnSparks(r.pos.clone());
        }
      }
    }

    // wrong way detection
    const fwd = r.vel.dot(s.tangent);
    if (fwd < -3 && !r.finished) r.wrongWay += dt;
    else r.wrongWay = 0;

    if (r.flame) r.flame.visible = r.boosting;
    if (r.brakeLights) r.brakeLights.visible = ctrl.brake > 0.3 && r.crash <= 0;

    // mesh transform
    r.mesh.position.copy(r.pos);
    // visual yaw includes a touch of drift slip
    const velHeading = r.vel.lengthSq() > 1 ? Math.atan2(r.vel.x, r.vel.z) : r.heading;
    let slip = velHeading - r.heading;
    while (slip > Math.PI) slip -= Math.PI * 2;
    while (slip < -Math.PI) slip += Math.PI * 2;
    r.mesh.rotation.y = r.heading + slip * 0.25;
    r.mesh.rotation.z = THREE.MathUtils.clamp(-slip * 0.3, -0.18, 0.18);

    // ---- suspension: accel squats the tail, braking dives the nose ----
    const accel = (Math.abs(r.speed) - Math.abs(r.prevSpeed)) / Math.max(dt, 1e-4);
    r.prevSpeed = r.speed;
    const targetPitch = THREE.MathUtils.clamp(-accel * 0.0032, -0.075, 0.075);
    // critically-damped-ish chase so it settles instead of oscillating
    r.bodyPitch += (targetPitch - r.bodyPitch) * Math.min(1, dt * 9);
    r.mesh.rotation.x = r.bodyPitch;

    // ---- wheels: roll by ground speed, steer the front pair ----
    if (r.wheels.length) {
      r.wheelSpin += (r.speed / r.wheels[0].radius) * dt;
      const steerAngle = THREE.MathUtils.clamp(ctrl.steer, -1, 1) * 0.42;
      for (const w of r.wheels) {
        w.obj.rotation.x = w.baseRotX + r.wheelSpin;
        if (w.front) w.obj.rotation.y = w.baseRotY + steerAngle;
        // squash the ride height slightly with pitch so the body visibly loads up
        w.obj.position.y = w.baseY - r.bodyPitch * (w.front ? -0.35 : 0.35);
      }
    }

    // juice (player only, for performance): skid marks when drifting, dust off-road/boosting
    if (r.cfg.isPlayer && !r.finished) {
      const speed = Math.abs(r.speed);
      if (!r.offTrack && r.crash <= 0 && (Math.abs(slip) > 0.32 || r.slip > 0) && speed > 14) {
        this.laySkid(r);
      }
      if (speed > 10 && r.offTrack && Math.random() < 0.6) {
        const back = new THREE.Vector3(Math.sin(r.heading), 0, Math.cos(r.heading)).multiplyScalar(-1.8);
        this.spawnDust(r.pos.clone().add(back), 0xc8b98a, 0.8);
      }
      // boost trail: hot exhaust plume behind the nitro flame, two puffs per frame
      // so it reads as a continuous streak at speed rather than dashes
      if (r.boosting && r.crash <= 0) {
        const back = new THREE.Vector3(Math.sin(r.heading), 0, Math.cos(r.heading)).multiplyScalar(-2.2);
        const lat = new THREE.Vector3(Math.cos(r.heading), 0, -Math.sin(r.heading));
        for (let k = 0; k < 2; k++) {
          const hot = [0xfff0a0, 0xffb347, 0xff6a2b][Math.floor(Math.random() * 3)];
          const jit = lat.clone().multiplyScalar((Math.random() - 0.5) * 0.7);
          this.spawnDust(r.pos.clone().add(back).add(jit), hot, 0.3 + Math.random() * 0.22);
        }
      }
    }
  }

  private updateProgress(r: Racer): void {
    const n = this.track.samples.length;
    const prevProg = r.progress;
    const frac = r.sampleIdx / n;

    // detect line crossing via wrap of sample index
    const prevIdx = Math.round((prevProg - Math.floor(prevProg + 1e-9)) * n) % n;
    if (prevIdx > n - 40 && r.sampleIdx < 40 && !r.finished) {
      // crossed start line forward
      r.lap++;
      if (this.phase === 'racing') {
        const lapMs = (this.raceTime - r.lapStart) * 1000;
        const isBest = lapMs > 4000 && (r.bestLapMs === null || lapMs < r.bestLapMs);
        if (isBest) r.bestLapMs = lapMs;
        r.lapStart = this.raceTime;
        if (this.mode === 'timetrial' && r.cfg.isPlayer) this.commitLapRecording(isBest);
        if (this.mode === 'elimination' && r.cfg.isPlayer) this.cullLastPlace(r.lap);
        if (r.cfg.isPlayer && r.lap < this.laps) {
          this.message = `LAP ${r.lap + 1} / ${this.laps}`;
          this.messageTime = 1.6;
          if (r.lap === this.laps - 1) {
            this.message = 'FINAL LAP!';
            this.sfx('finalLap');
          } else {
            this.sfx('lap');
          }
        }
      }
      if (r.lap >= this.laps && !r.finished) {
        r.finished = true;
        r.finishTime = this.raceTime;
        this.finishedOrder.push(r);
        if (r.cfg.isPlayer) this.sfx('finish');
      }
    } else if (prevIdx < 40 && r.sampleIdx > n - 40 && !r.finished) {
      // crossed backwards
      r.lap = Math.max(0, r.lap - 1);
    }
    r.progress = r.lap + frac;
  }

  /**
   * Elimination: when the leader starts a new lap, the racer in last place is out.
   * Never culls the player on the lap they'd otherwise win, and never empties the
   * grid — we always leave at least two cars running.
   */
  private cullLastPlace(lap: number): void {
    if (lap <= this.lastEliminationLap) return;
    this.lastEliminationLap = lap;
    const alive = this.racers.filter((r) => !this.eliminated.has(r.cfg.id) && !r.finished);
    if (alive.length <= 1) return; // last one standing — nothing left to cull
    const order = alive.slice().sort((a, b) => b.progress - a.progress);
    const doomed = order[order.length - 1];
    this.eliminated.add(doomed.cfg.id);
    doomed.mesh.visible = false;
    doomed.finished = true;
    doomed.finishTime = this.raceTime;
    // classify eliminated racers behind everyone still running
    this.finishedOrder.unshift(doomed);
    if (doomed.cfg.isPlayer) {
      this.message = 'âŒ ELIMINATED';
      this.messageTime = 2.4;
      this.sfx('wreck');
    } else {
      this.message = `${doomed.cfg.name} ELIMINATED`;
      this.messageTime = 1.8;
      this.sfx('alert');
    }
  }

  private resolveCarCollisions(dt: number): void {
    for (let i = 0; i < this.racers.length; i++) {
      for (let j = i + 1; j < this.racers.length; j++) {
        const a = this.racers[i], b = this.racers[j];
        if (this.eliminated.has(a.cfg.id) || this.eliminated.has(b.cfg.id)) continue;
        const delta = new THREE.Vector3().subVectors(b.pos, a.pos);
        delta.y = 0;
        const dist = delta.length();
        const minDist = 2.4;
        if (dist < minDist && dist > 0.001) {
          const pushDir = delta.clone().normalize();
          const overlap = minDist - dist;
          a.pos.addScaledVector(pushDir, -overlap * 0.5);
          b.pos.addScaledVector(pushDir, overlap * 0.5);
          const relVel = new THREE.Vector3().subVectors(b.vel, a.vel);
          const relSpeed = Math.abs(relVel.dot(pushDir));
          // bounce
          a.vel.addScaledVector(pushDir, -relSpeed * 0.3);
          b.vel.addScaledVector(pushDir, relSpeed * 0.3);
          if (relSpeed > 9) {
            this.applyDamage(a, 5, false);
            this.applyDamage(b, 5, false);
            this.spawnSparks(a.pos.clone().lerp(b.pos, 0.5));
            if (a.cfg.isPlayer || b.cfg.isPlayer) this.sfx('bump', 0.5);
          }
        }
      }
    }
  }

  // ---------- weapons ----------
  private findTargetAhead(r: Racer, range: number): Racer | null {
    let best: Racer | null = null;
    let bestGap = Infinity;
    for (const o of this.racers) {
      if (o === r || o.finished) continue;
      let gap = (o.progress - r.progress) * this.track.totalLength;
      if (gap < 1 || gap > range) continue;
      if (gap < bestGap) { bestGap = gap; best = o; }
    }
    return best;
  }

  private fireMissile(owner: Racer): void {
    const mesh = buildMissileMesh();
    const pos = owner.pos.clone().add(
      new THREE.Vector3(Math.sin(owner.heading), 0, Math.cos(owner.heading)).multiplyScalar(2.5)
    );
    pos.y = 0.7;
    mesh.position.copy(pos);
    mesh.rotation.y = owner.heading;
    this.scene.add(mesh);
    this.missiles.push({
      mesh, pos, heading: owner.heading,
      target: this.findTargetAhead(owner, 110),
      owner, life: 5,
    });
    this.sfx('missile');
  }

  private updateMissiles(dt: number): void {
    const SPEED = 58;
    for (const m of this.missiles) {
      m.life -= dt;
      if (m.target && !m.target.finished) {
        const dx = m.target.pos.x - m.pos.x;
        const dz = m.target.pos.z - m.pos.z;
        const desired = Math.atan2(dx, dz);
        let diff = desired - m.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        m.heading += THREE.MathUtils.clamp(diff, -3.2 * dt, 3.2 * dt);
      }
      m.pos.x += Math.sin(m.heading) * SPEED * dt;
      m.pos.z += Math.cos(m.heading) * SPEED * dt;
      m.mesh.position.copy(m.pos);
      m.mesh.rotation.y = m.heading;

      for (const r of this.racers) {
        if (r === m.owner) continue;
        if (r.pos.distanceTo(m.pos) < 2.2) {
          this.applyDamage(r, 35, true);
          this.spawnExplosion(m.pos.clone(), 0xff7b38);
          this.sfx('explosion');
          m.life = 0;
          break;
        }
      }
    }
    this.missiles = this.missiles.filter((m) => {
      if (m.life <= 0) { this.scene.remove(m.mesh); return false; }
      return true;
    });
  }

  private dropMine(owner: Racer): void {
    const mesh = buildMineMesh();
    const pos = owner.pos.clone().add(
      new THREE.Vector3(Math.sin(owner.heading), 0, Math.cos(owner.heading)).multiplyScalar(-3)
    );
    pos.y = 0;
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.mines.push({ mesh, pos, owner, armTime: 0.9, ownerGrace: 3 });
    this.sfx('mine');
  }

  private updateMines(dt: number): void {
    for (const mine of this.mines) {
      mine.armTime -= dt;
      mine.ownerGrace -= dt;
      if (mine.armTime > 0) continue;
      for (const r of this.racers) {
        if (r === mine.owner && mine.ownerGrace > 0) continue;
        if (r.pos.distanceTo(mine.pos) < 2.4) {
          this.applyDamage(r, 30, true);
          this.spawnExplosion(mine.pos.clone(), 0xffc83d);
          this.sfx('explosion');
          mine.armTime = 999; // mark consumed
          mine.ownerGrace = -1;
          (mine as { dead?: boolean } & Mine).dead = true;
          break;
        }
      }
    }
    this.mines = this.mines.filter((m) => {
      const dead = (m as { dead?: boolean } & Mine).dead;
      if (dead) { this.scene.remove(m.mesh); return false; }
      return true;
    });
  }

  // Hit a solid object: stop dead, spark/flash, then respawn on track after a beat.
  private crashRacer(r: Racer): void {
    if (r.crash > 0 || r.finished) return;
    r.crash = 1.5;
    r.speed = 0;
    r.vel.set(0, 0, 0);
    r.boosting = false;
    this.spawnExplosion(r.pos.clone(), 0xff5a3c);
    this.spawnSparks(r.pos.clone());
    for (let i = 0; i < 5; i++) this.spawnDust(r.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2)), 0xb0a89a, 0.9);
    this.applyDamage(r, 8, false);
    if (r.cfg.isPlayer) {
      this.sfx('wreck');
      this.addShake(0.9);
      this.message = 'ðŸ’¥ CRASH!';
      this.messageTime = 1.4;
    }
  }

  private applyDamage(r: Racer, amount: number, spin: boolean): void {
    if (r.finished) return;
    r.armour -= amount;
    r.damageTaken += amount;
    if (spin && r.stun <= 0) {
      r.stun = 1.1;
      r.spinDir = Math.random() < 0.5 ? -1 : 1;
    }
    if (r.armour <= 0) {
      // wrecked: longer spin, partial auto-repair (forgiving arcade rules)
      r.stun = 2.4;
      r.spinDir = Math.random() < 0.5 ? -1 : 1;
      r.armour = r.maxArmour * 0.4;
      this.spawnExplosion(r.pos.clone(), 0xff3838);
      if (r.cfg.isPlayer) this.sfx('wreck');
    }
  }

  // ---------- effects ----------
  private spawnExplosion(pos: THREE.Vector3, color: number): void {
    pos.y = 1;
    const mesh = new THREE.Mesh(
      this.fxGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 })
    );
    mesh.position.copy(pos);
    mesh.scale.setScalar(1);
    this.scene.add(mesh);
    this.effects.push({ mesh, life: 0.45, maxLife: 0.45, grow: 14, base: 1 });
    // shake the camera when the blast is near the player
    const d = this.player.pos.distanceTo(pos);
    if (d < 30) this.addShake(0.5 * (1 - d / 30));
  }

  private spawnSparks(pos: THREE.Vector3): void {
    pos.y = 0.8;
    const mesh = new THREE.Mesh(
      this.fxGeo,
      new THREE.MeshBasicMaterial({ color: 0xffd35c, transparent: true, opacity: 0.95 })
    );
    mesh.position.copy(pos);
    mesh.scale.setScalar(0.4);
    this.scene.add(mesh);
    this.effects.push({ mesh, life: 0.22, maxLife: 0.22, grow: 6, base: 0.4 });
  }

  private spawnDust(pos: THREE.Vector3, color: number, size = 0.7): void {
    const mesh = new THREE.Mesh(
      this.fxGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false })
    );
    mesh.position.copy(pos);
    mesh.position.y = 0.5;
    mesh.scale.setScalar(size);
    this.scene.add(mesh);
    this.effects.push({ mesh, life: 0.4 + Math.random() * 0.2, maxLife: 0.55, grow: 8, base: size });
  }

  // Lay a pair of tyre marks under the rear wheels into the instanced ring buffer.
  private laySkid(r: Racer): void {
    const back = new THREE.Vector3(Math.sin(r.heading), 0, Math.cos(r.heading)).multiplyScalar(-1.4);
    for (const side of [0.85, -0.85]) {
      const lat = new THREE.Vector3(Math.cos(r.heading), 0, -Math.sin(r.heading)).multiplyScalar(side);
      const dm = this.skidDummy;
      dm.position.copy(r.pos).add(back).add(lat);
      dm.position.y = 0.05;
      dm.rotation.set(0, r.heading, 0); // geometry is pre-laid flat, so yaw is enough
      dm.updateMatrix();
      this.skidMesh.setMatrixAt(this.skidWrite % Race.SKID_CAP, dm.matrix);
      this.skidWrite++;
    }
    // grow up to capacity, then keep overwriting oldest (ring)
    this.skidMesh.count = Math.min(this.skidWrite, Race.SKID_CAP);
    this.skidMesh.instanceMatrix.needsUpdate = true;
  }

  private addShake(amount: number): void {
    this.shakeTrauma = Math.min(1, this.shakeTrauma + amount);
  }

  private updateEffects(dt: number): void {
    for (const e of this.effects) {
      e.life -= dt;
      const f = 1 - e.life / e.maxLife;
      e.mesh.scale.setScalar(e.base * (1 + f * e.grow * 0.3));
      (e.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 * (1 - f));
    }
    this.effects = this.effects.filter((e) => {
      if (e.life <= 0) {
        this.scene.remove(e.mesh);
        // free the per-puff material; the geometry is shared (fxGeo) so leave it
        (e.mesh.material as THREE.Material).dispose();
        return false;
      }
      return true;
    });
  }

  // ---------- finishing ----------
  private sortedRacers(): Racer[] {
    return [...this.racers].sort((a, b) => {
      if (a.finished && b.finished) return (a.finishTime ?? 0) - (b.finishTime ?? 0);
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
  }

  private checkFinishes(): void {
    if (this.phase !== 'racing') return;
    // Elimination ends the moment one racer is left standing, even mid-lap
    if (this.mode === 'elimination') {
      const alive = this.racers.filter((r) => !this.eliminated.has(r.cfg.id));
      if (alive.length === 1 && !alive[0].finished) {
        alive[0].finished = true;
        alive[0].finishTime = this.raceTime;
        this.finishedOrder.push(alive[0]);
      }
    }
    if (this.player.finished) {
      this.phase = 'finished';
      // estimate finishing times for anyone still on track from their average pace,
      // so the player never has to wait for the AI to cross the line
      const entries = this.racers.map((r) => {
        let timeMs: number;
        let estimated = false;
        if (r.finished) {
          timeMs = (r.finishTime ?? 0) * 1000;
        } else {
          estimated = true;
          const remaining = Math.max(0, this.laps - r.progress) * this.track.totalLength;
          const avgSpeed = Math.max(8, (r.progress * this.track.totalLength) / Math.max(1, this.raceTime));
          timeMs = (this.raceTime + remaining / avgSpeed) * 1000;
        }
        return { r, timeMs, estimated };
      });
      entries.sort((a, b) => a.timeMs - b.timeMs);
      const results: RaceResult[] = entries.map((e, i) => ({
        id: e.r.cfg.id,
        name: e.r.cfg.name,
        carNum: e.r.cfg.carNum,
        color: e.r.cfg.color || GRID_COLORS_FALLBACK,
        isPlayer: e.r.cfg.isPlayer,
        position: i + 1,
        timeMs: e.timeMs,
        estimated: e.estimated,
        bestLapMs: e.r.bestLapMs,
        damageTaken: e.r.damageTaken,
      }));
      window.setTimeout(() => this.onFinish(results), 500);
    }
  }

  // ---------- HUD ----------
  hudState(): HudState {
    const order = this.sortedRacers();
    const playerRank = order.indexOf(this.player) + 1;
    let countdown: number | null = null;
    if (this.phase === 'countdown') {
      const remaining = 3.4 - this.phaseTime;
      countdown = Math.max(1, Math.ceil(remaining));
      if (this.phaseTime < 0.4) countdown = 3;
    }

    // minimap dots
    const t = this.track;
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const s of t.samples) {
      minX = Math.min(minX, s.pos.x); maxX = Math.max(maxX, s.pos.x);
      minZ = Math.min(minZ, s.pos.z); maxZ = Math.max(maxZ, s.pos.z);
    }
    const span = Math.max(maxX - minX, maxZ - minZ);
    const padX = (span - (maxX - minX)) / 2;
    const padZ = (span - (maxZ - minZ)) / 2;
    const minimapDots = this.racers.map((r) => ({
      x: (r.pos.x - minX + padX) / span,
      y: (r.pos.z - minZ + padZ) / span,
      color: r.cfg.color,
      isPlayer: r.cfg.isPlayer,
    }));

    return {
      position: playerRank,
      racerCount: this.racers.length,
      lap: Math.min(this.player.lap + 1, this.laps),
      laps: this.laps,
      raceTimeMs: this.raceTime * 1000,
      bestLapMs: this.player.bestLapMs,
      speedKmh: Math.round(Math.abs(this.player.speed) * 3.6),
      gear: Math.min(6, 1 + Math.floor(Math.abs(this.player.speed) / 9)),
      armourFrac: Math.max(0, this.player.armour / this.player.maxArmour),
      boostFrac: this.player.boostMeter,
      items: { ...this.player.items },
      countdown,
      message: this.message,
      wrongWay: this.player.wrongWay > 1.2,
      board: order.map((r) => ({
        name: r.cfg.name, carNum: r.cfg.carNum, color: r.cfg.color, isPlayer: r.cfg.isPlayer,
      })),
      minimapDots,
      finished: this.phase === 'finished',
    };
  }

  playerItemsRemaining(): { missile: number; mine: number } {
    return { ...this.player.items };
  }

  playerDamageTaken(): number {
    return this.player.damageTaken;
  }

  dispose(): void {
    // The track group is cached and reused across races (its instanced foliage shares
    // geometry/materials from the model cache). Detach it WITHOUT disposing so the next
    // race can re-add it; dispose only the per-race scene contents (cars, effects, etc).
    this.scene.remove(this.track.group);
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    });
  }
}
