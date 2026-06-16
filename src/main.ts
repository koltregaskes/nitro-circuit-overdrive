// Nitro Circuit Overdrive — bootstrap, state machine, camera and game loop.

import './style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import {
  CARS, CUP, PLAYER_CAR_NUM, PLAYER_NAME, RIVALS, TRACKS, effectiveStats,
} from './game/data';
import { Profile, carUpgrades, loadProfile, resetProfile, saveProfile } from './game/save';
import { buildTrack } from './game/track';
import { PlayerInput, Race, RaceResult, RacerConfig } from './game/race';
import { GameAudio } from './game/audio';
import { PLAYER_CAR_MODELS, RIVAL_MODELS, ensureModelsLoaded } from './game/models';
import { Hud } from './ui/hud';
import { Screens } from './ui/screens';

type GameState = 'menu' | 'tournament' | 'garage' | 'settings' | 'race' | 'results';

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
  private camPos = new THREE.Vector3();
  private lastTime = performance.now();
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private padPrev: boolean[] = [];
  private lastW = 0;
  private lastH = 0;

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
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 600);
    this.profile = loadProfile();
    this.audio.volume = this.profile.settings.volume;

    this.hud = new Hud(document.getElementById('hud')!);
    this.screens = new Screens(document.getElementById('screen')!, this.profile, {
      startNextRace: () => this.startNextRace(),
      toMenu: () => this.toState('menu'),
      toTournament: () => this.toState('tournament'),
      toGarage: () => this.toState('garage'),
      toSettings: () => this.toState('settings'),
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

    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('pointerdown', () => this.audio.unlock(), { once: true });
    this.onResize();
    this.toState('menu');
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
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(scene, this.camera));
    // subtle bloom: only genuinely bright sources (headlights, nitro flames) glow
    // faintly. High threshold so the road/kerbs/ground do NOT glow.
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.18, 0.4, 0.95);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
    this.composer.setSize(w, h);
  }

  private disposeComposer(): void {
    this.composer?.dispose();
    this.composer = null;
    this.bloomPass = null;
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
    this.audio.setVolume(this.profile.settings.volume);
    this.updateCameraFrustum();
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
    this.tutorialActive = false;
    // menu music plays on all front-end screens, off during the race
    this.audio.startMusic();
    switch (s) {
      case 'menu': this.screens.showMenu(); break;
      case 'tournament': this.screens.showTournament(); break;
      case 'garage': this.screens.showGarage(); break;
      case 'settings': this.screens.showSettings(); break;
      default: break;
    }
  }

  // ---------- race lifecycle ----------
  private buildRacerConfigs(raceIndex: number): RacerConfig[] {
    const p = this.profile;
    const car = CARS.find((c) => c.id === p.equipped) ?? CARS[0];
    const stats = effectiveStats(car, carUpgrades(p, car.id));
    const configs: RacerConfig[] = [{
      id: 'player', name: PLAYER_NAME, carNum: PLAYER_CAR_NUM,
      color: car.color, accent: car.accent,
      model: PLAYER_CAR_MODELS[car.id] ?? null,
      isPlayer: true, skill: 1,
      stats, condition: p.condition,
      items: { ...p.items },
    }];
    // rivals scale up as the cup progresses
    const ramp = raceIndex * 0.45;
    for (const r of RIVALS) {
      configs.push({
        id: r.id, name: r.name, carNum: r.carNum, color: r.color, accent: r.accent,
        model: RIVAL_MODELS[r.id] ?? null,
        isPlayer: false, skill: r.skill,
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

  private async startNextRaceAsync(): Promise<void> {
    const p = this.profile;
    if (p.cup.finished) { this.toState('tournament'); return; }
    document.getElementById('screen')!.innerHTML =
      '<div class="screen-root"><div style="flex:1"></div><h2 class="cyan">LOADING…</h2><div style="flex:1"></div></div>';
    await ensureModelsLoaded();
    const raceIndex = p.cup.raceIndex;
    const trackDef = TRACKS.find((t) => t.id === CUP.trackIds[raceIndex]) ?? TRACKS[0];
    const track = buildTrack(trackDef);
    this.raceItemSnapshot = { ...p.items };

    this.race = new Race(
      track,
      this.buildRacerConfigs(raceIndex),
      (results) => this.onRaceFinished(results),
      (n, v) => {
        this.audio.play(n, v);
        if (n === 'go') this.audio.playSample('vo-go.mp3');
        else if (n === 'finalLap') this.audio.playSample('vo-finallap.mp3');
      },
      { weapons: p.settings.weapons }
    );

    this.state = 'race';
    this.paused = false;
    this.screens.clear();
    this.hud.mount(track.minimap, p.bestTimes[trackDef.id] ?? null);
    this.audio.unlock();
    this.audio.stopMusic();
    this.audio.startEngine();
    // snap camera to start and show real HUD values immediately
    this.camPos.copy(this.race.playerPos);
    this.hud.update(this.race.hudState());
    // pre-compile shaders and warm one frame so the countdown doesn't judder
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
    this.startNextRace();
  }

  private forfeitRace(): void {
    const p = this.profile;
    // forfeit = classified last, no prize money
    const damage = this.race ? this.race.playerDamageTaken() : 0;
    if (this.race && p.settings.weapons) p.items = this.race.playerItemsRemaining();
    p.condition = Math.max(20, p.condition - damage * 0.2);
    p.cup.points['player'] = (p.cup.points['player'] ?? 0) + CUP.pointsByPosition[5];
    for (let i = 0; i < RIVALS.length; i++) {
      p.cup.points[RIVALS[i].id] = (p.cup.points[RIVALS[i].id] ?? 0) + CUP.pointsByPosition[i];
    }
    this.advanceCup();
    saveProfile(p);
    this.toState('tournament');
  }

  private onRaceFinished(results: RaceResult[]): void {
    const p = this.profile;
    const playerRes = results.find((r) => r.isPlayer)!;
    const pos = playerRes.position;
    const points = CUP.pointsByPosition[pos - 1] ?? 0;
    const cash = CUP.cashByPosition[pos - 1] ?? 0;

    p.cash += cash;
    for (const r of results) {
      const key = r.isPlayer ? 'player' : r.id;
      p.cup.points[key] = (p.cup.points[key] ?? 0) + (CUP.pointsByPosition[r.position - 1] ?? 0);
    }
    // damage carries over as condition loss (forgiving rate)
    p.condition = Math.max(20, p.condition - playerRes.damageTaken * 0.2);
    if (this.race && p.settings.weapons) p.items = this.race.playerItemsRemaining();
    // best lap record
    const trackId = CUP.trackIds[p.cup.raceIndex];
    if (playerRes.bestLapMs && (!p.bestTimes[trackId] || playerRes.bestLapMs < p.bestTimes[trackId])) {
      p.bestTimes[trackId] = Math.round(playerRes.bestLapMs);
    }
    const isLastRace = p.cup.raceIndex >= CUP.trackIds.length - 1;
    this.advanceCup();
    saveProfile(p);

    this.state = 'results';
    this.audio.stopEngine();
    this.screens.showResults(results, points, cash, isLastRace);
  }

  private advanceCup(): void {
    const p = this.profile;
    p.cup.raceIndex++;
    if (p.cup.raceIndex >= CUP.trackIds.length) {
      p.cup.finished = true;
      // champion bonus
      const standings = Object.entries(p.cup.points).sort((a, b) => b[1] - a[1]);
      if (standings.length && standings[0][0] === 'player') {
        p.cash += CUP.winBonus;
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

  /** Debug/test access for headless verification. */
  get debug() {
    return {
      state: this.state,
      race: this.race,
      profile: this.profile,
      tick: (dt: number, skipRender = true) => this.tick(dt, skipRender),
    };
  }
}

const game = new Game();
(window as unknown as Record<string, unknown>).__nitro = game;
