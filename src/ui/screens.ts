// Menu / tournament / garage / settings / results / pause / tutorial screens.

import * as THREE from 'three';
import {
  CARS, CUPS, ITEM_PRICES, LIVERIES, PLAYER_CAR_NUM, PLAYER_NAME, REPAIR_PRICE_PER_PCT,
  RIVALS, TRACKS, TrackDef, UPGRADES, cupAt, cupUnlocked, effectiveStats, liveryColors,
  upgradeCost,
} from '../game/data';
import {
  Difficulty, Profile, carUpgrades, freshCup, resetProfile, saveProfile,
} from '../game/save';
import { RaceMode, RaceResult } from '../game/race';
import { PLAYER_CAR_MODELS, RIVAL_MODELS, buildCarFromModel } from '../game/models';
import { buildCarMesh } from '../game/carmesh';
import { MiniStage } from './ministage';

export interface ScreenActions {
  startNextRace(): void;
  toMenu(): void;
  toTournament(): void;
  toGarage(): void;
  toSettings(): void;
  toModes(): void;
  toLeaderboards(): void;
  startModeRace(mode: RaceMode, trackId: string): void;
  resumeRace(): void;
  restartRace(): void;
  quitRace(): void;
  applySettings(): void;
  sfx(name: string): void;
  profileReset(): void;
}

function money(n: number): string {
  return '$ ' + n.toLocaleString('en-US');
}

function fmtTime(ms: number | null): string {
  if (ms === null || !isFinite(ms)) return '—';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const t = Math.floor(ms % 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(t).padStart(3, '0')}`;
}

function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

function statbar(v: number, max = 10, segs = 10): string {
  const lit = Math.round((v / max) * segs);
  let out = '<span class="statbar">';
  for (let i = 0; i < segs; i++) out += `<i class="${i < lit ? 'on' : ''}"></i>`;
  return out + '</span>';
}

// lightweight track outline for preview canvases
const previewCache = new Map<string, { x: number; y: number }[]>();
export function previewPath(def: TrackDef): { x: number; y: number }[] {
  const cached = previewCache.get(def.id);
  if (cached) return cached;
  const curve = new THREE.CatmullRomCurve3(
    def.points.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal', 0.6
  );
  const pts = curve.getSpacedPoints(120);
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const span = Math.max(maxX - minX, maxZ - minZ);
  const path = pts.map((p) => ({
    x: (p.x - minX + (span - (maxX - minX)) / 2) / span,
    y: (p.z - minZ + (span - (maxZ - minZ)) / 2) / span,
  }));
  previewCache.set(def.id, path);
  return path;
}

function drawPreview(canvas: HTMLCanvasElement, def: TrackDef, color = '#cfd6e4'): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width, H = canvas.height, pad = 12;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  previewPath(def).forEach((p, i) => {
    const x = pad + p.x * (W - pad * 2), y = pad + p.y * (H - pad * 2);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.stroke();
}

function cupStandingRows(profile: Profile): { id: string; name: string; pts: number; isPlayer: boolean }[] {
  const rows = [
    { id: 'player', name: `${PLAYER_NAME} (#47)`, pts: profile.cup.points['player'] ?? 0, isPlayer: true },
    ...RIVALS.map((r) => ({
      id: r.id, name: `${r.name} (#${r.carNum})`, pts: profile.cup.points[r.id] ?? 0, isPlayer: false,
    })),
  ];
  rows.sort((a, b) => b.pts - a.pts);
  return rows;
}

export class Screens {
  private root: HTMLElement;
  private actions: ScreenActions;
  private profile: Profile;
  private stage: MiniStage | null = null;
  private envMap: THREE.Texture | null = null;

  constructor(root: HTMLElement, profile: Profile, actions: ScreenActions) {
    this.root = root;
    this.profile = profile;
    this.actions = actions;
  }

  setProfile(p: Profile): void { this.profile = p; }

  /** Share the game's PMREM environment so garage/podium cars get the same paint. */
  setEnvMap(tex: THREE.Texture | null): void { this.envMap = tex; }

  clear(): void {
    // dispose first: every screen calls clear(), so this is the single choke point
    // that guarantees at most ONE extra WebGL context is ever alive
    this.stage?.dispose();
    this.stage = null;
    this.root.innerHTML = '';
  }

  /** Build a car mesh for the front-end (GLB when available, procedural fallback). */
  private frontEndCar(model: string | null, color: number, accent: number, num: string): THREE.Group {
    const built = model ? buildCarFromModel(model, color, num) : null;
    if (built) return built;
    const proc = buildCarMesh(color, accent, num);
    proc.scale.setScalar(1.25);
    return proc;
  }

  /** Create the single MiniStage, plus a soft disc so cars don't float in space. */
  private makeStage(w: number, h: number): MiniStage {
    const stage = new MiniStage(w, h, this.envMap);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(3.4, 40),
      new THREE.MeshStandardMaterial({ color: 0x1d2130, roughness: 0.6, metalness: 0.2 })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -0.02;
    stage.scene.add(disc);
    this.stage = stage;
    return stage;
  }

  // Apply an AI-generated background image under a dark gradient for legibility.
  private applyBg(el: HTMLElement, file: string, topAlpha = 0.72, botAlpha = 0.9): void {
    const base = import.meta.env.BASE_URL;
    el.style.backgroundImage =
      `linear-gradient(rgba(8,10,18,${topAlpha}), rgba(8,10,18,${botAlpha})), url(${base}ui/${file})`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
  }

  private btn(label: string, cls: string, fn: () => void, disabled = false): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'btn ' + cls;
    b.innerHTML = label;
    b.disabled = disabled;
    b.addEventListener('click', () => { this.actions.sfx('click'); fn(); });
    return b;
  }

  private topbar(parent: HTMLElement, title: string): void {
    const p = this.profile;
    const bar = document.createElement('div');
    bar.className = 'topbar';
    bar.innerHTML = `
      <div class="game-logo">Nitro Circuit<span>Overdrive</span></div>
      <h2 style="font-size:26px">${title}</h2>
      <div class="stats">
        <span class="green">${money(p.cash)}</span>
        <span class="muted">CONDITION <span class="${p.condition < 50 ? 'pink' : 'cyan'}">${Math.round(p.condition)}%</span></span>
      </div>`;
    parent.appendChild(bar);
  }

  // ---------------- main menu ----------------
  showMenu(): void {
    this.clear();
    const div = document.createElement('div');
    div.className = 'screen-root';
    this.applyBg(div, 'menu-bg.png', 0.4, 0.82);
    div.innerHTML = `
      <div style="flex:1"></div>
      <div class="logo">Nitro Circuit<span class="sub">Overdrive</span></div>
      <div class="tagline">2.5D Arcade Racing — Vertical Slice</div>`;
    const list = document.createElement('div');
    list.className = 'menu-list';
    const cupDone = this.profile.cup.finished;
    const cupStarted = this.profile.cup.raceIndex > 0 && !cupDone;
    list.appendChild(this.btn(
      cupDone ? 'CUP RESULTS' : cupStarted ? 'CONTINUE TOURNAMENT ⟫' : 'START TOURNAMENT ⟫',
      'primary', () => cupDone ? this.showCupComplete() : this.actions.toTournament()
    ));
    list.appendChild(this.btn('SINGLE EVENTS', '', () => this.actions.toModes()));
    list.appendChild(this.btn('GARAGE & SHOP', '', () => this.actions.toGarage()));
    list.appendChild(this.btn('LEADERBOARDS', '', () => this.actions.toLeaderboards()));
    list.appendChild(this.btn('SETTINGS', '', () => this.actions.toSettings()));
    div.appendChild(list);
    const spacer = document.createElement('div');
    spacer.style.flex = '2';
    div.appendChild(spacer);
    const foot = document.createElement('div');
    foot.className = 'footer-keys';
    foot.innerHTML = `<span><span class="key">W A S D</span> drive</span>
      <span><span class="key">L SHIFT</span> boost</span>
      <span><span class="key pink">F</span> missile</span>
      <span><span class="key pink">E</span> mine</span>
      <span><span class="key">ESC</span> pause</span>`;
    div.appendChild(foot);
    this.root.appendChild(div);
  }

  // ---------------- tournament ----------------
  showTournament(): void {
    this.clear();
    const p = this.profile;
    const div = document.createElement('div');
    div.className = 'screen-root';
    this.applyBg(div, 'cup-bg.png');
    this.topbar(div, 'TOURNAMENT');

    const cup = cupAt(p.cup.cupIndex);
    const sub = document.createElement('div');
    sub.style.cssText = 'width:100%;max-width:1180px;margin-bottom:14px';
    const total = cup.trackIds.length;
    sub.innerHTML = `<h3 class="cyan">${cup.name} — RACE ${Math.min(p.cup.raceIndex + 1, total)} / ${total}</h3>`;
    div.appendChild(sub);

    // cup selector — switching cups resets that cup's standings, so confirm first
    const picker = document.createElement('div');
    picker.style.cssText = 'display:flex;gap:8px;width:100%;max-width:1180px;margin-bottom:12px;flex-wrap:wrap';
    CUPS.forEach((c, ci) => {
      const unlocked = cupUnlocked(c, p.totalEarned);
      const active = ci === p.cup.cupIndex;
      const won = p.cupsWon.includes(c.id);
      const b = this.btn(
        `${won ? '🏆 ' : unlocked ? '' : '🔒 '}${c.name}`,
        'small' + (active ? ' primary' : ''),
        () => {
          if (!unlocked) {
            alert(`Locked — earn ${money(c.unlockCash)} in total prize money to enter.\nYou have earned ${money(p.totalEarned)}.`);
            this.actions.sfx('deny');
            return;
          }
          if (active) return;
          if (p.cup.raceIndex > 0 && !p.cup.finished &&
              !confirm(`Switch to ${c.name}? Your current cup standings will be reset.`)) return;
          p.cup = freshCup(ci);
          saveProfile(p);
          this.actions.sfx('buy');
          this.showTournament();
        }
      );
      if (!unlocked) b.style.opacity = '0.55';
      picker.appendChild(b);
    });
    div.appendChild(picker);

    const grid = document.createElement('div');
    grid.className = 'race-grid';
    cup.trackIds.forEach((tid, i) => {
      const track = TRACKS.find((t) => t.id === tid)!;
      const card = document.createElement('div');
      const state = i < p.cup.raceIndex ? 'done' : i === p.cup.raceIndex ? 'current' : 'locked';
      card.className = `race-card ${state}`;
      card.innerHTML = `
        <div class="spread"><span class="num">0${i + 1}</span>
          <span class="muted" style="font-size:12px">${track.difficulty} · ${track.laps} LAPS</span></div>
        <div class="title-font" style="font-size:15px">${track.name}</div>
        <div class="muted" style="font-size:12px">${track.subtitle}</div>
        <canvas class="minimap-box" width="220" height="130" style="width:100%"></canvas>
        <div style="font-size:12px">${
          state === 'done' ? '<span class="green">✔ COMPLETE</span>'
          : state === 'current' ? '<span class="cyan">▶ UP NEXT</span>'
          : '<span class="muted">🔒 LOCKED</span>'
        }${p.bestTimes[tid] ? ` · <span class="gold">BEST ${fmtTime(p.bestTimes[tid])}</span>` : ''}</div>`;
      grid.appendChild(card);
      drawPreview(card.querySelector('canvas') as HTMLCanvasElement, track);
    });
    div.appendChild(grid);

    // standings + actions
    const lower = document.createElement('div');
    lower.style.cssText = 'display:flex;gap:18px;width:100%;max-width:1180px;margin-top:18px;align-items:flex-start';
    const standings = document.createElement('div');
    standings.className = 'panel';
    standings.style.flex = '1';
    standings.innerHTML = `<div class="section-title">CUP STANDINGS</div>
      <table class="standings-table">${cupStandingRows(p).map((r, i) => `
        <tr class="${r.isPlayer ? 'you' : ''}"><td>${i + 1}</td><td>${r.name}</td>
        <td style="text-align:right">${r.pts} PTS</td></tr>`).join('')}
      </table>`;
    lower.appendChild(standings);

    const side = document.createElement('div');
    side.style.cssText = 'display:flex;flex-direction:column;gap:10px;width:300px';
    if (!p.cup.finished) {
      const next = TRACKS.find((t) => t.id === cup.trackIds[p.cup.raceIndex])!;
      side.appendChild(this.btn(`▶ RACE: ${next.name.toUpperCase()}`, 'primary', () => this.actions.startNextRace()));
    }
    side.appendChild(this.btn('GARAGE & SHOP', '', () => this.actions.toGarage()));
    // always offer a clean restart from Race 1 (fixes "stuck mid-cup" / can't replay Race 1)
    if (p.cup.raceIndex > 0 || p.cup.finished) {
      side.appendChild(this.btn('↻ RESTART CUP (RACE 1)', 'small', () => {
        if (confirm('Restart the cup from Race 1? Cup points reset; cash & cars are kept.')) {
          p.cup = freshCup(p.cup.cupIndex);
          saveProfile(p);
          this.showTournament();
        }
      }));
    }
    side.appendChild(this.btn('BACK TO MENU', 'small', () => this.actions.toMenu()));
    if (p.condition < 60) {
      const warn = document.createElement('div');
      warn.className = 'panel';
      warn.innerHTML = `<span class="pink">⚠ Your car is at ${Math.round(p.condition)}% condition.</span>
        <span class="muted">Repair it in the garage — damage slows you down.</span>`;
      side.appendChild(warn);
    }
    lower.appendChild(side);
    div.appendChild(lower);
    this.root.appendChild(div);
  }

  // ---------------- garage / shop ----------------
  showGarage(): void {
    this.clear();
    const p = this.profile;
    const div = document.createElement('div');
    div.className = 'screen-root';
    this.applyBg(div, 'garage-bg.png');
    this.topbar(div, 'GARAGE');

    const car = CARS.find((c) => c.id === p.equipped)!;
    const upg = carUpgrades(p, car.id);
    const stats = effectiveStats(car, upg);

    const grid = document.createElement('div');
    grid.className = 'garage-grid';

    // left: stats
    const left = document.createElement('div');
    left.className = 'panel';
    left.innerHTML = `
      <h3 style="font-size:22px">${car.name} <span style="background:var(--pink);font-size:11px;padding:2px 8px;vertical-align:middle">TIER ${car.tier}</span></h3>
      <div class="muted" style="font-size:13px;margin-bottom:14px">${car.blurb}</div>
      ${(['speed', 'accel', 'handling', 'armour', 'boost'] as const).map((k) => `
        <div class="spread" style="margin-bottom:8px">
          <span style="font-size:12px;text-transform:uppercase;font-weight:700">${k}</span>
          ${statbar(stats[k])}
          <span class="pink" style="font-size:13px;font-weight:700">${stats[k].toFixed(1)}</span>
        </div>`).join('')}
      <div class="section-title" style="margin-top:14px">VEHICLE INFO</div>
      <div class="muted" style="font-size:12px;line-height:1.8">
        Condition <span class="${p.condition < 50 ? 'pink' : 'green'}">${Math.round(p.condition)}%</span><br>
        Items: ${p.items.missile} missiles · ${p.items.mine} mines
      </div>`;
    grid.appendChild(left);

    // centre: live 3D turntable of the equipped car
    const centre = document.createElement('div');
    centre.className = 'panel';
    centre.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px';
    const paint = liveryColors(car, p.liveries[car.id]);
    const glow = document.createElement('div');
    glow.style.cssText = `width:100%;border-radius:10px;background:
      radial-gradient(ellipse at 50% 65%, ${hex(paint.color)}33 0%, #11151f00 70%);
      display:flex;align-items:center;justify-content:center`;
    const stage = this.makeStage(340, 190);
    const pivot = new THREE.Group();
    pivot.add(this.frontEndCar(PLAYER_CAR_MODELS[car.id] ?? null, paint.color, paint.accent, PLAYER_CAR_NUM));
    stage.scene.add(pivot);
    stage.start((_dt, t) => {
      pivot.rotation.y = t * 0.55;                 // slow showroom spin
      pivot.position.y = Math.sin(t * 1.1) * 0.04; // barely-there float
    });
    glow.appendChild(stage.canvas);
    centre.appendChild(glow);
    const eq = document.createElement('div');
    eq.className = 'cyan';
    eq.style.fontWeight = '700';
    eq.textContent = '✔ EQUIPPED';
    centre.appendChild(eq);

    // --- livery picker: buy once, then applies to any car ---
    const lvTitle = document.createElement('div');
    lvTitle.className = 'section-title';
    lvTitle.style.marginTop = '4px';
    lvTitle.textContent = 'PAINT';
    centre.appendChild(lvTitle);
    const lvRow = document.createElement('div');
    lvRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;justify-content:center';
    const currentLivery = p.liveries[car.id] ?? 'factory';
    for (const lv of LIVERIES) {
      const owned = p.ownedLiveries.includes(lv.id);
      const active = lv.id === currentLivery;
      const sw = document.createElement('button');
      const swatch = lv.color ?? car.color;
      sw.title = owned ? lv.name : `${lv.name} — ${money(lv.price)}`;
      sw.style.cssText = `pointer-events:auto;width:30px;height:30px;border-radius:6px;cursor:pointer;
        background:${hex(swatch)};border:2px solid ${active ? '#2de2e6' : '#00000044'};
        opacity:${owned ? 1 : 0.45};position:relative`;
      if (!owned) sw.textContent = '🔒';
      sw.addEventListener('click', () => {
        if (!owned) {
          if (p.cash < lv.price) { this.actions.sfx('deny'); alert(`Not enough cash for ${lv.name} (${money(lv.price)}).`); return; }
          p.cash -= lv.price;
          p.ownedLiveries.push(lv.id);
          this.actions.sfx('buy');
        } else {
          this.actions.sfx('click');
        }
        p.liveries[car.id] = lv.id;
        saveProfile(p);
        this.showGarage();
      });
      lvRow.appendChild(sw);
    }
    centre.appendChild(lvRow);
    grid.appendChild(centre);

    // right: upgrades
    const right = document.createElement('div');
    right.className = 'panel';
    right.innerHTML = `<div class="section-title">UPGRADES</div>`;
    for (const spec of UPGRADES) {
      const lvl = upg[spec.id];
      const cost = upgradeCost(spec, lvl);
      const row = document.createElement('div');
      row.className = 'upgrade-row';
      row.innerHTML = `<span style="font-size:13px;font-weight:700">${spec.icon} ${spec.name.toUpperCase()}
        <span class="muted">LV ${lvl}/${spec.maxLevel}</span></span>`;
      const buy = this.btn(
        lvl >= spec.maxLevel ? 'MAX' : money(cost), 'small',
        () => {
          if (p.cash >= cost && lvl < spec.maxLevel) {
            p.cash -= cost;
            upg[spec.id]++;
            saveProfile(p);
            this.actions.sfx('buy');
            this.showGarage();
          } else {
            this.actions.sfx('deny');
          }
        },
        lvl >= spec.maxLevel || p.cash < cost
      );
      row.appendChild(buy);
      right.appendChild(row);
    }

    // shop items
    right.appendChild(Object.assign(document.createElement('div'), {
      className: 'section-title', textContent: 'SHOP', style: 'margin-top:14px',
    }));
    const shopRows: [string, string, number, () => void, boolean][] = [
      ['🚀 MISSILE x1', 'missile', ITEM_PRICES.missile, () => { p.items.missile++; }, p.cash < ITEM_PRICES.missile],
      ['💣 MINE x1', 'mine', ITEM_PRICES.mine, () => { p.items.mine++; }, p.cash < ITEM_PRICES.mine],
    ];
    for (const [label, , cost, apply, disabled] of shopRows) {
      const row = document.createElement('div');
      row.className = 'upgrade-row';
      row.innerHTML = `<span style="font-size:13px;font-weight:700">${label}</span>`;
      row.appendChild(this.btn(money(cost), 'small', () => {
        if (p.cash >= cost) {
          p.cash -= cost; apply(); saveProfile(p); this.actions.sfx('buy'); this.showGarage();
        } else this.actions.sfx('deny');
      }, disabled));
      right.appendChild(row);
    }
    // repair
    const repairCost = Math.round((100 - p.condition) * REPAIR_PRICE_PER_PCT);
    const repairRow = document.createElement('div');
    repairRow.className = 'upgrade-row';
    repairRow.innerHTML = `<span style="font-size:13px;font-weight:700">🔧 FULL REPAIR</span>`;
    repairRow.appendChild(this.btn(
      p.condition >= 99.5 ? 'OK' : money(repairCost), 'small',
      () => {
        if (p.condition < 99.5 && p.cash >= repairCost) {
          p.cash -= repairCost; p.condition = 100; saveProfile(p); this.actions.sfx('buy'); this.showGarage();
        } else this.actions.sfx('deny');
      },
      p.condition >= 99.5 || p.cash < repairCost
    ));
    right.appendChild(repairRow);
    grid.appendChild(right);
    div.appendChild(grid);

    // car cards
    const strip = document.createElement('div');
    strip.className = 'car-strip';
    for (const c of CARS) {
      const owned = p.ownedCars.includes(c.id);
      const card = document.createElement('div');
      card.className = 'car-card' + (c.id === p.equipped ? ' selected' : '');
      card.innerHTML = `
        <div class="swatch" style="background:linear-gradient(150deg, ${hex(c.color)}, #11151f)"></div>
        <div class="spread"><b style="font-style:italic">${c.name}</b>
          <span class="muted" style="font-size:11px">TIER ${c.tier}</span></div>
        <div style="font-size:12px;margin-top:4px">${
          c.id === p.equipped ? '<span class="cyan">✔ EQUIPPED</span>'
          : owned ? '<span class="green">OWNED — CLICK TO EQUIP</span>'
          : `<span class="gold">🔒 ${money(c.price)}</span>`}</div>`;
      card.addEventListener('click', () => {
        if (c.id === p.equipped) return;
        if (owned) {
          p.equipped = c.id;
          saveProfile(p);
          this.actions.sfx('click');
          this.showGarage();
        } else if (p.cash >= c.price) {
          p.cash -= c.price;
          p.ownedCars.push(c.id);
          p.equipped = c.id;
          carUpgrades(p, c.id);
          saveProfile(p);
          this.actions.sfx('buy');
          this.showGarage();
        } else {
          this.actions.sfx('deny');
        }
      });
      strip.appendChild(card);
    }
    div.appendChild(strip);

    const back = document.createElement('div');
    back.style.cssText = 'margin-top:18px;display:flex;gap:12px';
    back.appendChild(this.btn('⟪ BACK', 'small', () => this.actions.toMenu()));
    if (!p.cup.finished) {
      back.appendChild(this.btn('TOURNAMENT ⟫', 'small primary', () => this.actions.toTournament()));
    }
    div.appendChild(back);
    this.root.appendChild(div);
  }

  // ---------------- settings ----------------
  showSettings(): void {
    this.clear();
    const p = this.profile;
    const div = document.createElement('div');
    div.className = 'screen-root';
    this.topbar(div, 'SETTINGS');
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.style.cssText = 'width:480px;display:flex;flex-direction:column';

    const mkRow = (label: string, control: HTMLElement) => {
      const row = document.createElement('div');
      row.className = 'settings-row';
      const span = document.createElement('span');
      span.style.cssText = 'font-weight:700;font-size:14px';
      span.textContent = label;
      row.append(span, control);
      panel.appendChild(row);
    };

    const vol = document.createElement('input');
    vol.type = 'range'; vol.min = '0'; vol.max = '1'; vol.step = '0.05';
    vol.value = String(p.settings.volume);
    vol.addEventListener('input', () => {
      p.settings.volume = parseFloat(vol.value);
      saveProfile(p); this.actions.applySettings();
    });
    mkRow('MASTER VOLUME', vol);

    const sfxVol = document.createElement('input');
    sfxVol.type = 'range'; sfxVol.min = '0'; sfxVol.max = '1'; sfxVol.step = '0.05';
    sfxVol.value = String(p.settings.volumeSfx);
    sfxVol.addEventListener('input', () => {
      p.settings.volumeSfx = parseFloat(sfxVol.value);
      saveProfile(p); this.actions.applySettings();
    });
    mkRow('SFX VOLUME', sfxVol);

    const musVol = document.createElement('input');
    musVol.type = 'range'; musVol.min = '0'; musVol.max = '1'; musVol.step = '0.05';
    musVol.value = String(p.settings.volumeMusic);
    musVol.addEventListener('input', () => {
      p.settings.volumeMusic = parseFloat(musVol.value);
      saveProfile(p); this.actions.applySettings();
    });
    mkRow('MUSIC VOLUME', musVol);

    const zoom = document.createElement('input');
    zoom.type = 'range'; zoom.min = '0.7'; zoom.max = '1.4'; zoom.step = '0.05';
    zoom.value = String(p.settings.zoom);
    zoom.addEventListener('input', () => {
      p.settings.zoom = parseFloat(zoom.value);
      saveProfile(p); this.actions.applySettings();
    });
    mkRow('CAMERA ZOOM', zoom);

    const assist = document.createElement('input');
    assist.type = 'checkbox';
    assist.checked = p.settings.assist;
    assist.style.cssText = 'pointer-events:auto;width:20px;height:20px;accent-color:#ff2975';
    assist.addEventListener('change', () => {
      p.settings.assist = assist.checked;
      saveProfile(p); this.actions.applySettings();
    });
    mkRow('STEERING ASSIST', assist);

    const weapons = document.createElement('input');
    weapons.type = 'checkbox';
    weapons.checked = p.settings.weapons;
    weapons.style.cssText = 'pointer-events:auto;width:20px;height:20px;accent-color:#ff2975';
    weapons.addEventListener('change', () => {
      p.settings.weapons = weapons.checked;
      saveProfile(p); this.actions.applySettings();
    });
    mkRow('WEAPONS (MISSILES & MINES)', weapons);

    const quality = document.createElement('select');
    quality.style.cssText = 'pointer-events:auto;padding:4px 8px;font-weight:700;background:#12141c;color:#e8e8ee;border:1px solid #2de2e6;border-radius:6px';
    for (const [val, label] of [['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH']] as const) {
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = label;
      if (p.settings.quality === val) opt.selected = true;
      quality.appendChild(opt);
    }
    quality.addEventListener('change', () => {
      p.settings.quality = quality.value as typeof p.settings.quality;
      saveProfile(p); this.actions.applySettings();
    });
    mkRow('GRAPHICS QUALITY', quality);

    const diff = document.createElement('select');
    diff.style.cssText = 'pointer-events:auto;padding:4px 8px;font-weight:700;background:#12141c;color:#e8e8ee;border:1px solid #2de2e6;border-radius:6px';
    for (const [val, label] of [['easy', 'EASY'], ['normal', 'NORMAL'], ['hard', 'HARD']] as const) {
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = label;
      if (p.settings.difficulty === val) opt.selected = true;
      diff.appendChild(opt);
    }
    diff.addEventListener('change', () => {
      p.settings.difficulty = diff.value as Difficulty;
      saveProfile(p); this.actions.applySettings();
    });
    mkRow('DIFFICULTY', diff);

    const ghost = document.createElement('input');
    ghost.type = 'checkbox';
    ghost.checked = p.settings.showGhost;
    ghost.style.cssText = 'pointer-events:auto;width:20px;height:20px;accent-color:#ff2975';
    ghost.addEventListener('change', () => {
      p.settings.showGhost = ghost.checked;
      saveProfile(p); this.actions.applySettings();
    });
    mkRow('TIME TRIAL GHOST', ghost);

    const resetBtn = this.btn('RESET SAVE DATA', 'small', () => {
      if (confirm('Delete all progress and start fresh?')) {
        this.actions.profileReset();
        this.actions.sfx('deny');
        this.actions.toMenu();
      }
    });
    mkRow('DANGER ZONE', resetBtn);

    div.appendChild(panel);
    const back = document.createElement('div');
    back.style.marginTop = '18px';
    back.appendChild(this.btn('⟪ BACK', 'small', () => this.actions.toMenu()));
    div.appendChild(back);
    this.root.appendChild(div);
  }

  // ---------------- race results ----------------
  showResults(
    results: RaceResult[], pointsEarned: number, cashEarned: number,
    isLastRace: boolean, mode: RaceMode = 'race'
  ): void {
    this.clear();
    const div = document.createElement('div');
    div.className = 'screen-root overlay';
    const playerRow = results.find((r) => r.isPlayer)!;
    const won = playerRow.position === 1;
    const elim = mode === 'elimination';
    const heading = elim
      ? (won ? '🏆 LAST ONE STANDING!' : `ELIMINATED — P${playerRow.position}`)
      : (won ? '🏆 RACE WON!' : `RACE FINISHED — P${playerRow.position}`);
    div.innerHTML = `
      <div style="flex:0.5"></div>
      <h2 style="font-size:34px" class="${won ? 'gold trophy-pop' : 'cyan'}">${heading}</h2>
      <div class="muted" style="margin:6px 0 18px">${
        elim ? '' : `+${pointsEarned} cup points · `
      }<span class="green">${money(cashEarned)}</span> prize money</div>`;
    if (won) { this.confetti(div); this.actions.sfx('fanfare'); this.actions.sfx('voice:win'); }

    // podium: top-3 cars on blocks, slow camera arc behind the HTML overlay
    const top3 = results.slice(0, 3);
    if (top3.length) {
      const stage = this.makeStage(420, 190);
      const blockMat = new THREE.MeshStandardMaterial({ color: 0x424a5e, roughness: 0.7, flatShading: true });
      const H = [0.9, 0.62, 0.44];   // 1st / 2nd / 3rd block heights
      const X = [0, -2.0, 2.0];      // winner centre, runner-up left, third right
      for (const r of top3) {
        const i = Math.min(Math.max(r.position - 1, 0), 2);
        const h = H[i], x = X[i];
        const block = new THREE.Mesh(new THREE.BoxGeometry(1.5, h, 1.5), blockMat);
        block.position.set(x, h / 2, 0);
        stage.scene.add(block);
        const model = r.isPlayer
          ? (PLAYER_CAR_MODELS[this.profile.equipped] ?? null)
          : (RIVAL_MODELS[r.id] ?? null);
        const car = this.frontEndCar(model, r.color, 0xffffff, r.carNum);
        car.scale.multiplyScalar(0.42);
        car.position.set(x, h, 0);
        car.rotation.y = Math.PI; // nose toward the camera
        stage.scene.add(car);
      }
      stage.start((_dt, t) => {
        const a = Math.sin(t * 0.32) * 0.55;               // gentle arc, never full orbit
        stage.camera.position.set(Math.sin(a) * 7.6, 2.9 + Math.sin(t * 0.5) * 0.2, Math.cos(a) * 7.6);
        stage.camera.lookAt(0, 0.85, 0);
      });
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;justify-content:center;margin-bottom:12px';
      wrap.appendChild(stage.canvas);
      div.appendChild(wrap);
    }

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.style.width = '640px';
    const table = document.createElement('table');
    table.className = 'results-table';
    panel.appendChild(table);
    div.appendChild(panel);

    // rows trickle in one after another (estimated AI times marked with ≈)
    const timers: number[] = [];
    const addRow = (r: RaceResult) => {
      const tr = document.createElement('tr');
      tr.className = (r.isPlayer ? 'you ' : '') + 'row-reveal';
      tr.innerHTML = `
        <td style="font-weight:800;width:36px">${r.position}</td>
        <td><span class="car-num" style="background:${hex(r.color)};padding:1px 8px;border-radius:2px;font-weight:800;margin-right:8px">${r.carNum}</span>${r.name}</td>
        <td style="text-align:right">${r.estimated ? '≈ ' : ''}${fmtTime(r.timeMs)}</td>
        <td style="text-align:right" class="muted">${r.bestLapMs ? 'best ' + fmtTime(r.bestLapMs) : ''}</td>
        <td style="text-align:right;font-weight:700">+${cupAt(this.profile.cup.cupIndex).pointsByPosition[r.position - 1] ?? 0} pts</td>`;
      table.appendChild(tr);
    };
    results.forEach((r, i) => {
      const t = window.setTimeout(() => { addRow(r); this.actions.sfx('click'); }, 350 + i * 420);
      timers.push(t);
    });

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:12px;margin-top:20px';
    const skip = this.btn('SHOW ALL', 'small', () => {
      timers.forEach((t) => window.clearTimeout(t));
      table.innerHTML = '';
      results.forEach(addRow);
      skip.style.display = 'none';
    });
    actions.appendChild(skip);
    if (elim) {
      // standalone event — return to the events list, not the cup flow
      actions.appendChild(this.btn('EVENTS ⟫', 'primary', () => this.actions.toModes()));
      actions.appendChild(this.btn('MENU', '', () => this.actions.toMenu()));
    } else {
      actions.appendChild(this.btn(
        isLastRace ? 'CUP RESULTS ⟫' : 'CONTINUE ⟫', 'primary',
        () => isLastRace ? this.showCupComplete() : this.actions.toTournament()
      ));
      if (!isLastRace) {
        actions.appendChild(this.btn('GARAGE', '', () => this.actions.toGarage()));
      }
    }
    div.appendChild(actions);
    this.root.appendChild(div);
  }

  private confetti(parent: HTMLElement): void {
    const colors = ['#ff2975', '#2de2e6', '#ffc83d', '#2de66b', '#f6019d', '#fff'];
    for (let i = 0; i < 60; i++) {
      const c = document.createElement('i');
      c.className = 'confetti';
      c.style.left = Math.random() * 100 + '%';
      c.style.background = colors[i % colors.length];
      c.style.animationDelay = Math.random() * 2.2 + 's';
      c.style.animationDuration = 2.4 + Math.random() * 1.8 + 's';
      c.style.width = 6 + Math.random() * 6 + 'px';
      parent.appendChild(c);
    }
  }

  // ---------------- cup complete ----------------
  showCupComplete(): void {
    this.clear();
    const p = this.profile;
    const rows = cupStandingRows(p);
    const playerRank = rows.findIndex((r) => r.isPlayer) + 1;
    const div = document.createElement('div');
    div.className = 'screen-root';
    div.innerHTML = `
      <div style="flex:0.5"></div>
      <div style="font-size:64px" class="${playerRank === 1 ? 'trophy-pop' : ''}">${playerRank === 1 ? '🏆' : playerRank <= 3 ? '🥈' : '🏁'}</div>
      <h2 style="font-size:36px" class="${playerRank === 1 ? 'gold' : 'cyan'}">
        ${playerRank === 1 ? `${cupAt(this.profile.cup.cupIndex).name} CHAMPION!` : `CUP COMPLETE — P${playerRank}`}</h2>
      <div class="muted" style="margin:8px 0 20px">${
        playerRank === 1 ? `Winner bonus: <span class="green">${money(cupAt(this.profile.cup.cupIndex).winBonus)}</span>` : 'Better luck next season.'}</div>`;
    if (playerRank === 1) { this.confetti(div); this.actions.sfx('fanfare'); this.actions.sfx('voice:win'); }
    else this.actions.sfx('voice:lose');
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.style.width = '480px';
    panel.innerHTML = `<div class="section-title">FINAL STANDINGS</div>
      <table class="standings-table">${rows.map((r, i) => `
        <tr class="${r.isPlayer ? 'you' : ''}"><td>${i + 1}</td><td>${r.name}</td>
        <td style="text-align:right">${r.pts} PTS</td></tr>`).join('')}</table>`;
    div.appendChild(panel);
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:12px;margin-top:20px';
    // offer the next cup up if one is unlocked, else replay this one
    const nextIdx = Math.min(p.cup.cupIndex + 1, CUPS.length - 1);
    const nextCup = CUPS[nextIdx];
    const canAdvance = nextIdx !== p.cup.cupIndex && cupUnlocked(nextCup, p.totalEarned);
    actions.appendChild(this.btn(
      canAdvance ? `${nextCup.name} ⟫` : 'RACE THIS CUP AGAIN ⟫', 'primary',
      () => {
        p.cup = freshCup(canAdvance ? nextIdx : p.cup.cupIndex);
        saveProfile(p);
        this.actions.toTournament();
      }
    ));
    actions.appendChild(this.btn('MENU', '', () => this.actions.toMenu()));
    div.appendChild(actions);
    this.root.appendChild(div);
  }

  // ---------------- single events (Time Trial / Elimination) ----------------
  showModes(): void {
    this.clear();
    const p = this.profile;
    const div = document.createElement('div');
    div.className = 'screen-root';
    this.topbar(div, 'SINGLE EVENTS');

    const intro = document.createElement('div');
    intro.style.cssText = 'width:100%;max-width:1180px;margin-bottom:12px';
    intro.innerHTML = `<div class="muted" style="font-size:13px">
      <b class="cyan">TIME TRIAL</b> — solo hot laps, no weapons or hazards. Beats your ghost and writes the leaderboard.
      &nbsp;·&nbsp; <b class="pink">ELIMINATION</b> — last place is culled at the end of every lap.</div>`;
    div.appendChild(intro);

    const grid = document.createElement('div');
    grid.className = 'race-grid';
    for (const track of TRACKS) {
      const card = document.createElement('div');
      card.className = 'race-card current';
      const best = p.bestTimes[track.id];
      card.innerHTML = `
        <div class="spread"><span class="title-font" style="font-size:15px">${track.name}</span>
          <span class="muted" style="font-size:12px">${track.difficulty}</span></div>
        <div class="muted" style="font-size:12px">${track.subtitle} · ${track.laps} laps</div>
        <canvas class="minimap-box" width="220" height="130" style="width:100%"></canvas>
        <div style="font-size:12px">${best ? `<span class="gold">BEST ${fmtTime(best)}</span>` : '<span class="muted">no time set</span>'}</div>`;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;margin-top:8px';
      row.appendChild(this.btn('⏱ TIME TRIAL', 'small primary', () => this.actions.startModeRace('timetrial', track.id)));
      row.appendChild(this.btn('❌ ELIM', 'small', () => this.actions.startModeRace('elimination', track.id)));
      card.appendChild(row);
      grid.appendChild(card);
      drawPreview(card.querySelector('canvas') as HTMLCanvasElement, track);
    }
    div.appendChild(grid);

    const back = document.createElement('div');
    back.style.cssText = 'display:flex;gap:12px;margin-top:18px';
    back.appendChild(this.btn('LEADERBOARDS', 'small', () => this.actions.toLeaderboards()));
    back.appendChild(this.btn('⟪ BACK', 'small', () => this.actions.toMenu()));
    div.appendChild(back);
    this.root.appendChild(div);
  }

  // ---------------- leaderboards ----------------
  showLeaderboards(): void {
    this.clear();
    const p = this.profile;
    const div = document.createElement('div');
    div.className = 'screen-root';
    this.topbar(div, 'LEADERBOARDS');

    const grid = document.createElement('div');
    grid.className = 'race-grid';
    for (const track of TRACKS) {
      const board = p.leaderboards[track.id] ?? [];
      const card = document.createElement('div');
      card.className = 'race-card ' + (board.length ? 'current' : 'locked');
      const rows = board.length
        ? board.map((e, i) => {
            const car = CARS.find((c) => c.id === e.carId);
            return `<tr><td style="width:26px">${i + 1}</td>
              <td>${car ? car.name : e.carId}</td>
              <td style="text-align:right" class="${i === 0 ? 'gold' : ''}">${fmtTime(e.timeMs)}</td></tr>`;
          }).join('')
        : '<tr><td colspan="3" class="muted" style="font-size:12px">No laps recorded yet.</td></tr>';
      card.innerHTML = `
        <div class="title-font" style="font-size:15px">${track.name}</div>
        <div class="muted" style="font-size:12px">${track.subtitle}</div>
        <table class="standings-table" style="margin-top:6px">${rows}</table>`;
      const go = this.btn('⏱ SET A TIME', 'small', () => this.actions.startModeRace('timetrial', track.id));
      go.style.marginTop = '8px';
      card.appendChild(go);
      grid.appendChild(card);
    }
    div.appendChild(grid);

    const back = document.createElement('div');
    back.style.marginTop = '18px';
    back.appendChild(this.btn('⟪ BACK', 'small', () => this.actions.toMenu()));
    div.appendChild(back);
    this.root.appendChild(div);
  }

  // ---------------- time trial results ----------------
  showTimeTrialResults(trackId: string, bestLapMs: number | null, rank: number): void {
    this.clear();
    const p = this.profile;
    const track = TRACKS.find((t) => t.id === trackId);
    const board = p.leaderboards[trackId] ?? [];
    const div = document.createElement('div');
    div.className = 'screen-root overlay';
    const podium = rank === 1;
    div.innerHTML = `
      <div style="flex:0.5"></div>
      <div style="font-size:56px" class="${podium ? 'trophy-pop' : ''}">${podium ? '🏆' : rank ? '⏱' : '🏁'}</div>
      <h2 style="font-size:32px" class="${podium ? 'gold' : 'cyan'}">
        ${podium ? 'NEW TRACK RECORD!' : rank ? `LEADERBOARD P${rank}` : 'TIME TRIAL COMPLETE'}</h2>
      <div class="muted" style="margin:6px 0 18px">${track ? track.name : trackId} — best lap
        <span class="gold">${fmtTime(bestLapMs)}</span></div>`;
    if (podium) { this.confetti(div); this.actions.sfx('fanfare'); }

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.style.width = '460px';
    panel.innerHTML = `<div class="section-title">TOP LAPS</div>
      <table class="standings-table">${
        board.map((e, i) => {
          const car = CARS.find((c) => c.id === e.carId);
          const isThis = rank === i + 1;
          return `<tr class="${isThis ? 'you' : ''}"><td style="width:30px">${i + 1}</td>
            <td>${car ? car.name : e.carId}</td>
            <td style="text-align:right">${fmtTime(e.timeMs)}</td></tr>`;
        }).join('') || '<tr><td class="muted">No laps recorded.</td></tr>'
      }</table>`;
    div.appendChild(panel);

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:12px;margin-top:20px';
    actions.appendChild(this.btn('↻ RUN AGAIN', 'primary', () => this.actions.startModeRace('timetrial', trackId)));
    actions.appendChild(this.btn('EVENTS', '', () => this.actions.toModes()));
    actions.appendChild(this.btn('MENU', '', () => this.actions.toMenu()));
    div.appendChild(actions);
    this.root.appendChild(div);
  }

  // ---------------- photo mode ----------------
  showPhotoMode(onExit: () => void, onCapture: () => void): void {
    this.clear();
    const div = document.createElement('div');
    // no .overlay: the scene must stay fully visible behind the controls
    div.className = 'screen-root';
    div.style.cssText = 'justify-content:flex-end;pointer-events:none;background:none';
    const bar = document.createElement('div');
    bar.className = 'panel';
    bar.style.cssText = 'pointer-events:auto;margin-bottom:26px;display:flex;align-items:center;gap:16px';
    bar.innerHTML = `<span class="cyan" style="font-weight:800;font-style:italic">📷 PHOTO MODE</span>
      <span class="muted" style="font-size:12px">
        <span class="key">W A S D</span> pan ·
        <span class="key">Q</span>/<span class="key">E</span> zoom ·
        <span class="key">R</span> recentre ·
        <span class="key">ESC</span> exit</span>`;
    bar.appendChild(this.btn('⬇ SAVE PNG', 'small primary', onCapture));
    bar.appendChild(this.btn('EXIT', 'small', onExit));
    div.appendChild(bar);
    this.root.appendChild(div);
  }

  // ---------------- pause ----------------
  showPause(): void {
    this.clear();
    const div = document.createElement('div');
    div.className = 'screen-root overlay';
    div.innerHTML = `<div style="flex:1"></div><h2 style="font-size:34px">PAUSED</h2><div style="height:18px"></div>`;
    const list = document.createElement('div');
    list.className = 'menu-list';
    list.appendChild(this.btn('RESUME', 'primary', () => this.actions.resumeRace()));
    list.appendChild(this.btn('RESTART RACE', '', () => this.actions.restartRace()));
    list.appendChild(this.btn('QUIT RACE (FORFEIT)', '', () => this.actions.quitRace()));
    div.appendChild(list);
    const spacer = document.createElement('div');
    spacer.style.flex = '2';
    div.appendChild(spacer);
    this.root.appendChild(div);
  }

  // ---------------- tutorial cards ----------------
  showTutorial(onDone: () => void): void {
    const cards = [
      {
        title: 'WELCOME TO THE CIRCUIT',
        body: `Drive with <span class="key">W A S D</span> or <span class="key">ARROWS</span>.<br><br>
          Stay on the tarmac — grass is slow. The camera stays top-down so you can always
          read the track, corners and rivals.`,
      },
      {
        title: 'BOOST & FRONT MISSILES',
        body: `Use <b class="cyan">BOOST</b> to burst forward and <b class="pink">FRONT MISSILES</b>
          to hit racers ahead!<br><br>
          <span class="key">L SHIFT</span> BOOST<br>
          <span class="key pink">F</span> FRONT MISSILE`,
      },
      {
        title: 'MINES & ARMOUR',
        body: `<span class="key pink">E</span> drops a <b>MINE</b> behind you.<br><br>
          Damage drains your <b>ARMOUR</b> — hit zero and you spin out. Damage carries over
          after the race, so buy <b>REPAIRS</b> in the garage between races.`,
      },
    ];
    let idx = 0;
    const render = () => {
      this.clear();
      const wrap = document.createElement('div');
      wrap.className = 'tutorial-card';
      wrap.innerHTML = `
        <span class="tag">TUTORIAL ${idx + 1}/${cards.length}</span>
        <div class="body">
          <h3>${cards[idx].title}</h3>
          <div style="font-size:14px;line-height:1.7">${cards[idx].body}</div>
          <div style="margin-top:16px;text-align:right"></div>
        </div>`;
      const slot = wrap.querySelector('.body > div:last-child') as HTMLElement;
      slot.appendChild(this.btn(idx < cards.length - 1 ? 'NEXT ⟫' : 'GOT IT! ▶', 'primary small', () => {
        idx++;
        if (idx < cards.length) render();
        else { this.clear(); onDone(); }
      }));
      this.root.appendChild(wrap);
    };
    render();
  }
}
