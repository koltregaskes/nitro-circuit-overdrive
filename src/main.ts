// Nitro Circuit Overdrive — bootstrap, state machine, camera and game loop.

import './style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { FilmPass } from 'three/examples/jsm/postprocessing/FilmPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';
import { HueSaturationShader } from 'three/examples/jsm/shaders/HueSaturationShader.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  CARS, PLAYER_CAR_NUM, PLAYER_NAME, RIVALS, TRACKS,
  cupAt, effectiveStats, liveryColors,
} from './game/data';
import {
  DIFFICULTY_TUNING, Profile, carUpgrades, ghostKey, loadProfile, recordLap,
  resetProfile, saveProfile,
} from './game/save';
import { buildTrack } from './game/track';
import { PlayerInput, Race, RaceMode, RaceResult, RacerConfig } from './game/race';
import { GameAudio } from './game/audio';
import { PLAYER_CAR_MODELS, RIVAL_MODELS, ensureModelsLoaded } from './game/models';
import { Hud } from './ui/hud';
import { Screens } from './ui/screens';

type GameState =
  | 'menu' | 'tournament' | 'garage' | 'settings' | 'race' | 'results'
  | 'modes' | 'leaderboards';

class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  consume(...codes: string[]): boolean {
    for (const c of codes) {
      if (this.pressed.has(c)) {
        this.pressed.delete(c);
        return true;
      }
    }
    return false;
  }

  endFrame(): void {
    this.pressed.clear();
  }
}

class Game {
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.OrthographicCamera;
  private profile: Profile;
  private audio = new GameAudio();
  private input = new Input();
  private screens: Screens;
  private hud: Hud;
  private state: GameState = 'menu';
  private race: Race | null = null;
  private paused = false;
  private tutorialActive = false;
  private raceItemSnapshot = { missile: 0, mine: 0 };
  private raceMode: RaceMode = 'race';
  private raceTrackId = '';
  private photo = false;
  private photoOffset = new THREE.Vector2();
  private photoZoom = 1;
  private camPos = new THREE.Vector3();
  private lastTime = performance.now();
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private gtaoPass: GTAOPass | null = null;
  private padPrev: boolean[] = [];
  private lastW = 0;
  private lastH = 0;
  private envMap: THREE.Texture | null = null;
  /** ?perf — log build timings and per-second draw-call/triangle counts */
  private readonly perf = new URLSearchParams(location.search).has('perf');
  private perfAcc = 0;
  private perfFrames = 0;

  constructor() {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    // cap pixel ratio at 1.5 — 4K/Retina at 2x quadruples fragment cost for little gain
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // filmic tone mapping = richer colour without blowing the highlights out
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    // soft studio environment → PBR car paint gets real reflections/highlights
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    // far plane reaches past the sky-dome radius (1200) so the dome, which is centred
    // on the world origin and encloses the roaming camera, is never clipped away
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2200);
    this.profile = loadProfile();
    this.audio.volume = this.profile.settings.volume;

    this.hud = new Hud(document.getElementById('hud')!);
    this.screens = new Screens(document.getElementById('screen')!, this.profile, {
      startNextRace: () => this.startNextRace(),
      toMenu: () => this.toState('menu'),
      toTournament: () => this.toState('tournament'),
      toGarage: () => this.toState('garage'),
      toSettings: () => this.toState('settings'),
      toModes: () => this.toState('modes'),
      toLeaderboards: () => this.toState('leaderboards'),
      startModeRace: (mode, trackId) => this.startModeRace(mode, trackId),
      resumeRace: () => this.setPaused(false),
      restartRace: () => this.restartRace(),
      quitRace: () => this.forfeitRace(),
      applySettings: () => this.applySettings(),
      sfx: (n) => this.handleSfx(n),
      profileReset: () => {
        this.profile = resetProfile();
        this.screens.setProfile(this.profile);
      },
    });

    // ?perf: the composer resets renderer.info between passes, so take manual control
    // and reset once per frame — counts then cover the scene AND every post pass.
    if (this.perf) {
      this.renderer.info.autoReset = false;
      console.log('[perf] enabled — build timings + 1s draw-call/triangle rollup');
    }

    // front-end mini-stages (garage turntable, podium) share the game's PMREM env
    this.screens.setEnvMap(this.envMap);

    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('pointerdown', () => this.audio.unlock(), { once: true });
    this.onResize();
    this.toState('menu');
    // start fetching the 44 GLBs during the menu so the first race isn't blocked on them
    void ensureModelsLoaded();
    requestAnimationFrame(() => this.loop());
  }

  private onResize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.lastW = w;
    this.lastH = h;
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    // root font-size scales the (rem-based) UI with the smaller viewport axis,
    // so menus stay proportional on any display without a fixed clipped stage
    const fs = Math.max(11, Math.min(20, Math.min(w / 95, h / 54)));
    document.documentElement.style.fontSize = fs + 'px';
    this.updateCameraFrustum();
  }

  private setupComposer(scene: THREE.Scene): void {
    this.disposeComposer();
    const w = window.innerWidth, h = window.innerHeight;
    const quality = this.profile.settings.quality;
    const grade = this.race?.track.def.theme.grade ?? { hue: 0, saturation: 0 };
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(scene, this.camera));

    // contact ambient occlusion (art-of-rally grounding) — HIGH quality only, it's
    // the priciest pass. Renders a G-buffer, so tune radius for the world scale.
    if (quality === 'high') {
      const gtao = new GTAOPass(scene, this.camera, w, h);
      gtao.output = GTAOPass.OUTPUT.Default;
      gtao.blendIntensity = 0.9;
      gtao.updateGtaoMaterial({ radius: 4.0, distanceExponent: 1.0, thickness: 1.0, scale: 1.0 });
      this.composer.addPass(gtao);
      this.gtaoPass = gtao;
    }

    // subtle bloom: only genuinely bright sources (headlights, nitro flames) glow
    // faintly. High threshold so the road/kerbs/ground do NOT glow.
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.18, 0.4, 0.95);
    this.composer.addPass(this.bloomPass);

    // medium+: cinematic grade — vignette, per-theme hue/sat push, fine film grain
    if (quality !== 'low') {
      const vignette = new ShaderPass(VignetteShader);
      vignette.uniforms.offset.value = 1.15;
      vignette.uniforms.darkness.value = 1.1;
      this.composer.addPass(vignette);

      const grading = new ShaderPass(HueSaturationShader);
      grading.uniforms.hue.value = grade.hue;
      grading.uniforms.saturation.value = grade.saturation;
      this.composer.addPass(grading);

      // FilmPass(intensity, grayscale) — keep grain barely-there
      this.composer.addPass(new FilmPass(0.18, false));
    }

    // edge AA to finish — HIGH only (SMAA is a full extra pass)
    if (quality === 'high') {
      this.composer.addPass(new SMAAPass(w, h));
    }

    this.composer.addPass(new OutputPass());
    this.composer.setSize(w, h);
  }

  private disposeComposer(): void {
    this.composer?.dispose();
    this.composer = null;
    this.bloomPass = null;
    this.gtaoPass = null;
  }

  /** Poll the first connected gamepad (standard/Xbox mapping). */
  private readPad(): {
    throttle: boolean; brake: boolean; steerAxis: number | null;
    boost: boolean; missile: boolean; mine: boolean; pauseEdge: boolean;
  } | null {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) { if (p && p.connected) { pad = p; break; } }
    if (!pad) return null;
    const now: boolean[] = [];
    for (let i = 0; i < pad.buttons.length; i++) now[i] = !!pad.buttons[i]?.pressed;
    const value = (i: number) => pad!.buttons[i]?.value ?? 0;
    const edge = (i: number) => !!now[i] && !this.padPrev[i];
    const stickX = pad.axes[0] ?? 0;
    const result = {
      throttle: value(7) > 0.12 || now[0],          // RT or A
      brake: value(6) > 0.12 || now[1],             // LT or B
      steerAxis: Math.abs(stickX) > 0.15 ? -stickX : null,
      boost: !!now[2],                              // X
      missile: edge(5),                             // RB
      mine: edge(4),                                // LB
      pauseEdge: edge(9),                           // Start
    };
    this.padPrev = now;
    return result;
  }

  private updateCameraFrustum(): void {
    const w = window.innerWidth, h = window.innerHeight;
    const aspect = w / h;
    // keep at least ~86 world units of horizontal view on narrow/portrait displays
    const base = 78 / this.profile.settings.zoom;
    const viewH = Math.max(base, (86 / this.profile.settings.zoom) / aspect);
    this.camera.left = -viewH * aspect / 2;
    this.camera.right = viewH * aspect / 2;
    this.camera.top = viewH / 2;
    this.camera.bottom = -viewH / 2;
    this.camera.updateProjectionMatrix();
  }

  private applySettings(): void {
    const s = this.profile.settings;
    this.audio.setVolume(s.volume);
    this.audio.setMix(1, s.volumeSfx, s.volumeMusic);
    this.updateCameraFrustum();
  }

  // ---------- photo mode ----------
  /** Freeze the sim and hand the camera to the player. */
  private togglePhotoMode(): void {
    if (this.state !== 'race' || !this.race) return;
    this.photo = !this.photo;
    if (this.photo) {
      this.photoOffset.set(0, 0);
      this.photoZoom = 1;
      this.hud.unmount();
      this.screens.showPhotoMode(() => this.togglePhotoMode(), () => this.capturePhoto());
    } else {
      this.screens.clear();
      this.hud.mount(this.race.track.minimap, this.profile.bestTimes[this.raceTrackId] ?? null);
    }
  }

  /** Save the current frame as a PNG download. */
  private capturePhoto(): void {
    if (this.composer) this.composer.render();
    else if (this.race) this.renderer.render(this.race.scene, this.camera);
    this.renderer.domElement.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nitro-${this.raceTrackId || 'shot'}-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, 'image/png');
  }

  /** Route a sound name: 'voice:x' plays an mp3 sample, else a procedural sfx. */
  private handleSfx(n: string): void {
    this.audio.unlock();
    if (n.startsWith('voice:')) { this.audio.playSample('vo-' + n.slice(6) + '.mp3'); return; }
    this.audio.play(n);
  }

  private toState(s: GameState): void {
    if ((this.state === 'race' || this.state === 'results') && s !== 'race') {
      this.audio.stopEngine();
      this.hud.unmount();
      this.disposeComposer();
      if (this.race) { this.race.dispose(); this.race = null; }
    }
    this.state = s;
    this.paused = false;
    // soft-lock guard: photo mode freezes the sim, so it must never survive a state
    // change — otherwise the next race boots with input frozen and no HUD
    this.photo = false;
    this.tutorialActive = false;
    // menu music plays on all front-end screens, off during the race
    this.audio.startMusic();
    switch (s) {
      case 'menu': this.screens.showMenu(); break;
      case 'tournament': this.screens.showTournament(); break;
      case 'garage': this.screens.showGarage(); break;
      case 'settings': this.screens.showSettings(); break;
      case 'modes': this.screens.showModes(); break;
      case 'leaderboards': this.screens.showLeaderboards(); break;
      default: break;
    }
  }

  // ---------- race lifecycle ----------
  private buildRacerConfigs(raceIndex: number, soloOnly = false): RacerConfig[] {
    const p = this.profile;
    const car = CARS.find((c) => c.id === p.equipped) ?? CARS[0];
    const stats = effectiveStats(car, carUpgrades(p, car.id));
    const paint = liveryColors(car, p.liveries[car.id]);
    const configs: RacerConfig[] = [{
      id: 'player', name: PLAYER_NAME, carNum: PLAYER_CAR_NUM,
      color: paint.color, accent: paint.accent,
      model: PLAYER_CAR_MODELS[car.id] ?? null,
      isPlayer: true, skill: 1,
      stats, condition: p.condition,
      items: { ...p.items },
    }];
    if (soloOnly) return configs; // Time Trial: just the player and their ghost
    // rivals scale up as the cup progresses; difficulty scales the ramp and skill
    const tune = DIFFICULTY_TUNING[p.settings.difficulty];
    const ramp = raceIndex * tune.ramp;
    for (const r of RIVALS) {
      configs.push({
        id: r.id, name: r.name, carNum: r.carNum, color: r.color, accent: r.accent,
        model: RIVAL_MODELS[r.id] ?? null,
        isPlayer: false, skill: r.skill * tune.skill,
        stats: {
          speed: 5.2 + ramp, accel: 5.6 + ramp, handling: 5.8 + ramp,
          armour: 5 + ramp, boost: 5 + ramp,
        },
        condition: 100,
        items: { missile: 2, mine: 1 },
      });
    }
    return configs;
  }

  private startNextRace(): void {
    void this.startNextRaceAsync();
  }

  /** Start a one-off Time Trial or Elimination race on a chosen track. */
  startModeRace(mode: RaceMode, trackId: string): void {
    const def = TRACKS.find((t) => t.id === trackId) ?? TRACKS[0];
    void this.startNextRaceAsync(mode, def.id);
  }

  private async startNextRaceAsync(mode: RaceMode = 'race', trackOverride?: string): Promise<void> {
    const p = this.profile;
    const cup = cupAt(p.cup.cupIndex);
    if (mode === 'race' && p.cup.finished) { this.toState('tournament'); return; }
    document.getElementById('screen')!.innerHTML =
      '<div class="screen-root"><div style="flex:1"></div><h2 class="cyan">LOADING…</h2><div style="flex:1"></div></div>';
    await ensureModelsLoaded();
    // let the browser paint the LOADING screen before the synchronous build blocks
    // (setTimeout, not rAF — rAF is throttled when the tab isn't focused)
    await new Promise<void>((r) => setTimeout(r, 32));
    this.raceMode = mode;
    const raceIndex = p.cup.raceIndex;
    const trackId = trackOverride ?? cup.trackIds[raceIndex];
    const trackDef = TRACKS.find((t) => t.id === trackId) ?? TRACKS[0];
    this.raceTrackId = trackDef.id;
    const tBuild = performance.now();
    const track = buildTrack(trackDef);
    const buildMs = performance.now() - tBuild;
    this.raceItemSnapshot = { ...p.items };

    const tRace = performance.now();
    const car = CARS.find((c) => c.id === p.equipped) ?? CARS[0];
    const ghost = mode === 'timetrial' && p.settings.showGhost
      ? (p.ghosts[ghostKey(car.id, trackDef.id)] ?? null)
      : null;
    this.race = new Race(
      track,
      this.buildRacerConfigs(raceIndex, mode === 'timetrial'),
      (results) => this.onRaceFinished(results),
      (n, v) => {
        this.audio.play(n, v);
        if (n === 'go') this.audio.playSample('vo-go.mp3');
        else if (n === 'finalLap') this.audio.playSample('vo-finallap.mp3');
      },
      {
        weapons: p.settings.weapons,
        mode,
        latGrip: DIFFICULTY_TUNING[p.settings.difficulty].latGrip,
        ghost: ghost ? { stride: ghost.stride, frames: ghost.frames } : null,
        // Elimination needs one lap per cull, so every rival can actually be knocked
        // out; the track's own lap count is usually shorter than the grid size.
        laps: mode === 'elimination' ? RIVALS.length + 1 : undefined,
      }
    );
    const raceMs = performance.now() - tRace;
    if (this.perf) {
      console.log(`[perf] ${trackDef.id}: buildTrack ${buildMs.toFixed(1)}ms · new Race ${raceMs.toFixed(1)}ms · quality ${p.settings.quality}`);
    }
    if (this.envMap) this.race.scene.environment = this.envMap;

    this.state = 'race';
    this.paused = false;
    this.photo = false;
    this.screens.clear();
    this.hud.mount(track.minimap, p.bestTimes[trackDef.id] ?? null);
    this.audio.unlock();
    this.audio.stopMusic();
    this.audio.startEngine();
    // snap camera to start and show real HUD values immediately
    this.camPos.copy(this.race.playerPos);
    this.hud.update(this.race.hudState());
    // pre-compile shaders + warm one frame so the countdown doesn't judder
    this.setupComposer(this.race.scene);
    this.camera.position.set(this.camPos.x, 110, this.camPos.z - 52);
    this.camera.lookAt(this.camPos.x, 0, this.camPos.z);
    this.renderer.compile(this.race.scene, this.camera);
    this.composer?.render();

    if (!p.tutorialSeen) {
      this.tutorialActive = true;
      this.screens.showTutorial(() => {
        this.tutorialActive = false;
        p.tutorialSeen = true;
        saveProfile(p);
      });
    }
  }

  private restartRace(): void {
    const p = this.profile;
    p.items = { ...this.raceItemSnapshot };
    if (this.race) { this.race.dispose(); this.race = null; }
    this.audio.stopEngine();
    this.hud.unmount();
    // restart the mode we're actually in — a Time Trial must not restart as a cup race
    if (this.raceMode === 'race') this.startNextRace();
    else this.startModeRace(this.raceMode, this.raceTrackId);
  }

  private forfeitRace(): void {
    const p = this.profile;
    // forfeit = classified last, no prize money
    const damage = this.race ? this.race.playerDamageTaken() : 0;
    if (this.race && p.settings.weapons) p.items = this.race.playerItemsRemaining();
    p.condition = Math.max(20, p.condition - damage * 0.2);
    const cup = cupAt(p.cup.cupIndex);
    if (this.raceMode !== 'race') {   // quitting a one-off mode doesn't touch the cup
      saveProfile(p);
      this.toState('modes');
      return;
    }
    p.cup.points['player'] = (p.cup.points['player'] ?? 0) + cup.pointsByPosition[5];
    for (let i = 0; i < RIVALS.length; i++) {
      p.cup.points[RIVALS[i].id] = (p.cup.points[RIVALS[i].id] ?? 0) + cup.pointsByPosition[i];
    }
    this.advanceCup();
    saveProfile(p);
    this.toState('tournament');
  }

  private onRaceFinished(results: RaceResult[]): void {
    const p = this.profile;
    const cup = cupAt(p.cup.cupIndex);
    const playerRes = results.find((r) => r.isPlayer)!;
    const trackId = this.raceTrackId;

    // best lap record applies in every mode
    if (playerRes.bestLapMs && (!p.bestTimes[trackId] || playerRes.bestLapMs < p.bestTimes[trackId])) {
      p.bestTimes[trackId] = Math.round(playerRes.bestLapMs);
    }

    if (this.raceMode === 'timetrial') {
      const car = CARS.find((c) => c.id === p.equipped) ?? CARS[0];
      let rank = 0;
      if (playerRes.bestLapMs) {
        rank = recordLap(p, trackId, {
          timeMs: Math.round(playerRes.bestLapMs), carId: car.id, at: Date.now(),
        });
        // keep the ghost only when this run beat the stored one
        const g = this.race?.bestGhost() ?? null;
        const key = ghostKey(car.id, trackId);
        if (g && (!p.ghosts[key] || g.timeMs < p.ghosts[key].timeMs)) p.ghosts[key] = g;
      }
      saveProfile(p);
      this.state = 'results';
      this.audio.stopEngine();
      this.screens.showTimeTrialResults(trackId, playerRes.bestLapMs, rank);
      return;
    }

    const points = cup.pointsByPosition[playerRes.position - 1] ?? 0;
    const cash = cup.cashByPosition[playerRes.position - 1] ?? 0;
    p.cash += cash;
    p.totalEarned += cash;

    if (this.raceMode === 'elimination') {
      // standalone mode — pays out but doesn't touch cup standings
      p.condition = Math.max(20, p.condition - playerRes.damageTaken * 0.2);
      saveProfile(p);
      this.state = 'results';
      this.audio.stopEngine();
      this.screens.showResults(results, 0, cash, false, 'elimination');
      return;
    }

    for (const r of results) {
      const key = r.isPlayer ? 'player' : r.id;
      p.cup.points[key] = (p.cup.points[key] ?? 0) + (cup.pointsByPosition[r.position - 1] ?? 0);
    }
    // damage carries over as condition loss (forgiving rate)
    p.condition = Math.max(20, p.condition - playerRes.damageTaken * 0.2);
    if (this.race && p.settings.weapons) p.items = this.race.playerItemsRemaining();
    const isLastRace = p.cup.raceIndex >= cup.trackIds.length - 1;
    this.advanceCup();
    saveProfile(p);

    this.state = 'results';
    this.audio.stopEngine();
    this.screens.showResults(results, points, cash, isLastRace);
  }

  private advanceCup(): void {
    const p = this.profile;
    const cup = cupAt(p.cup.cupIndex);
    p.cup.raceIndex++;
    if (p.cup.raceIndex >= cup.trackIds.length) {
      p.cup.finished = true;
      // champion bonus
      const standings = Object.entries(p.cup.points).sort((a, b) => b[1] - a[1]);
      if (standings.length && standings[0][0] === 'player') {
        p.cash += cup.winBonus;
        p.totalEarned += cup.winBonus;
        if (!p.cupsWon.includes(cup.id)) p.cupsWon.push(cup.id);
      }
    }
  }

  private setPaused(v: boolean): void {
    this.paused = v;
    if (v) this.screens.showPause();
    else this.screens.clear();
  }

  // ---------- loop ----------
  private loop(): void {
    requestAnimationFrame(() => this.loop());
    const now = performance.now();
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    dt = Math.min(dt, 0.05);
    this.tick(dt, false);
  }

  /** One frame. Exposed via window.__nitro for headless testing. */
  tick(dt: number, skipRender: boolean): void {
    // belt-and-braces: catch viewport changes the resize event misses
    if (window.innerWidth !== this.lastW || window.innerHeight !== this.lastH) {
      this.onResize();
    }

    if (this.state === 'race' && this.race) {
      const pad = this.readPad();
      // P toggles photo mode (sim frozen, free camera). Escape leaves it.
      if (this.input.consume('KeyP') && !this.tutorialActive && !this.paused) {
        this.togglePhotoMode();
      }
      if (this.photo) {
        this.updatePhotoCamera(dt);
        if (this.input.consume('Escape')) this.togglePhotoMode();
        if (!skipRender) {
          if (this.composer) this.composer.render();
          else this.renderer.render(this.race.scene, this.camera);
        }
        this.input.endFrame();
        return; // sim frozen: no physics, no HUD
      }
      if ((this.input.consume('Escape') || (pad?.pauseEdge ?? false)) && !this.tutorialActive) {
        this.setPaused(!this.paused);
      }
      if (!this.paused && !this.tutorialActive) {
        const pi: PlayerInput = {
          throttle: this.input.isDown('KeyW', 'ArrowUp') || (pad?.throttle ?? false),
          brake: this.input.isDown('KeyS', 'ArrowDown') || (pad?.brake ?? false),
          left: this.input.isDown('KeyA', 'ArrowLeft'),
          right: this.input.isDown('KeyD', 'ArrowRight'),
          steerAxis: pad?.steerAxis ?? null,
          boost: this.input.isDown('ShiftLeft', 'ShiftRight') || (pad?.boost ?? false),
          fireMissile: this.input.consume('KeyF') || (pad?.missile ?? false),
          dropMine: this.input.consume('KeyE') || (pad?.mine ?? false),
        };
        this.race.update(dt, pi, this.profile.settings.assist);
        this.audio.updateEngine(this.race.playerSpeedFrac, this.race.playerBoosting);
        this.audio.setScreech(this.race.playerSlip);
      }

      // camera follow (fixed world orientation, slight tilt for 2.5D readability)
      const target = this.race.playerPos;
      this.camPos.lerp(target, 1 - Math.exp(-5 * dt));
      this.camera.position.set(this.camPos.x, 110, this.camPos.z - 52);
      this.camera.lookAt(this.camPos.x, 0, this.camPos.z);
      // crash/impact screen shake
      const trauma = this.race.shakeTrauma;
      if (trauma > 0) {
        const s = trauma * trauma * 7;
        this.camera.position.x += (Math.random() - 0.5) * s;
        this.camera.position.z += (Math.random() - 0.5) * s;
      }
      if (!skipRender) {
        if (this.composer) this.composer.render();
        else this.renderer.render(this.race.scene, this.camera);
        if (this.perf) this.perfSample(dt);
      }
      this.hud.update(this.race.hudState());
    } else if (this.state === 'results' && this.race) {
      // keep rendering the finished scene behind the results overlay
      if (!skipRender) {
        if (this.composer) this.composer.render();
        else this.renderer.render(this.race.scene, this.camera);
      }
    }

    this.input.endFrame();
  }

  /** Photo mode: WASD/arrows pan, Q/E zoom, R recentres on the player. */
  private updatePhotoCamera(dt: number): void {
    if (!this.race) return;
    const pan = 42 * dt * this.photoZoom;
    if (this.input.isDown('KeyA', 'ArrowLeft')) this.photoOffset.x -= pan;
    if (this.input.isDown('KeyD', 'ArrowRight')) this.photoOffset.x += pan;
    if (this.input.isDown('KeyW', 'ArrowUp')) this.photoOffset.y -= pan;
    if (this.input.isDown('KeyS', 'ArrowDown')) this.photoOffset.y += pan;
    if (this.input.isDown('KeyQ')) this.photoZoom = Math.min(2.6, this.photoZoom + dt * 1.1);
    if (this.input.isDown('KeyE')) this.photoZoom = Math.max(0.35, this.photoZoom - dt * 1.1);
    if (this.input.consume('KeyR')) { this.photoOffset.set(0, 0); this.photoZoom = 1; }

    const t = this.race.playerPos;
    const cx = t.x + this.photoOffset.x;
    const cz = t.z + this.photoOffset.y;
    this.camera.position.set(cx, 110, cz - 52);
    this.camera.lookAt(cx, 0, cz);
    // widen/narrow the ortho box instead of dollying — keeps the 2.5D framing
    const w = window.innerWidth, h = window.innerHeight;
    const aspect = w / h;
    const base = (78 / this.profile.settings.zoom) * this.photoZoom;
    const viewH = Math.max(base, ((86 / this.profile.settings.zoom) * this.photoZoom) / aspect);
    this.camera.left = -viewH * aspect / 2;
    this.camera.right = viewH * aspect / 2;
    this.camera.top = viewH / 2;
    this.camera.bottom = -viewH / 2;
    this.camera.updateProjectionMatrix();
  }

  /** ?perf — roll up whole-frame draw calls/triangles once a second. */
  private perfSample(dt: number): void {
    const r = this.renderer.info.render;
    this.perfAcc += dt;
    this.perfFrames++;
    if (this.perfAcc >= 1) {
      const fps = (this.perfFrames / this.perfAcc).toFixed(0);
      console.log(`[perf] ${fps} fps · draw calls ${r.calls} · tris ${r.triangles}`);
      this.perfAcc = 0;
      this.perfFrames = 0;
    }
    this.renderer.info.reset(); // manual reset (autoReset disabled in the constructor)
  }

  /** Debug/test access for headless verification. */
  get debug() {
    return {
      state: this.state,
      race: this.race,
      profile: this.profile,
      renderer: this.renderer,
      tick: (dt: number, skipRender = true) => this.tick(dt, skipRender),
    };
  }
}

const game = new Game();
(window as unknown as Record<string, unknown>).__nitro = game;
