// Menu / tournament / garage / settings / results / pause / tutorial screens.

import * as THREE from 'three';
import {
  CARS, CUP, ITEM_PRICES, PLAYER_NAME, REPAIR_PRICE_PER_PCT, RIVALS, TRACKS,
  TrackDef, UPGRADES, effectiveStats, upgradeCost,
} from '../game/data';
import { Profile, carUpgrades, freshCup, resetProfile, saveProfile } from '../game/save';
import { RaceResult } from '../game/race';

export interface ScreenActions {
  startNextRace(): void;
  toMenu(): void;
  toTournament(): void;
  toGarage(): void;
  toSettings(): void;
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

  constructor(root: HTMLElement, profile: Profile, actions: ScreenActions) {
    this.root = root;
    this.profile = profile;
    this.actions = actions;
  }

  setProfile(p: Profile): void { this.profile = p; }

  clear(): void { this.root.innerHTML = ''; }

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
    list.appendChild(this.btn('GARAGE & SHOP', '', () => this.actions.toGarage()));
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

    const sub = document.createElement('div');
    sub.style.cssText = 'width:100%;max-width:1180px;margin-bottom:14px';
    sub.innerHTML = `<h3 class="cyan">${CUP.name} — RACE ${Math.min(p.cup.raceIndex + 1, 4)} / 4</h3>`;
    div.appendChild(sub);

    const grid = document.createElement('div');
    grid.className = 'race-grid';
    CUP.trackIds.forEach((tid, i) => {
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
      const next = TRACKS.find((t) => t.id === CUP.trackIds[p.cup.raceIndex])!;
      side.appendChild(this.btn(`▶ RACE: ${next.name.toUpperCase()}`, 'primary', () => this.actions.startNextRace()));
    }
    side.appendChild(this.btn('GARAGE & SHOP', '', () => this.actions.toGarage()));
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

    // centre: car visual
    const centre = document.createElement('div');
    centre.className = 'panel';
    centre.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px';
    centre.innerHTML = `
      <div style="width:80%;height:140px;border-radius:10px;background:
        linear-gradient(160deg, ${hex(car.color)} 0%, #11151f 130%);
        display:flex;align-items:center;justify-content:center;
        box-shadow:0 0 40px ${hex(car.color)}44">
        <span style="font-size:64px;font-weight:900;font-style:italic;color:#fff;text-shadow:2px 2px 0 #0008">47</span>
      </div>
      <div class="cyan" style="font-weight:700">✔ EQUIPPED</div>`;
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
    mkRow('SOUND VOLUME', vol);

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
  showResults(results: RaceResult[], pointsEarned: number, cashEarned: number, isLastRace: boolean): void {
    this.clear();
    const div = document.createElement('div');
    div.className = 'screen-root overlay';
    const playerRow = results.find((r) => r.isPlayer)!;
    const won = playerRow.position === 1;
    div.innerHTML = `
      <div style="flex:0.5"></div>
      <h2 style="font-size:34px" class="${won ? 'gold trophy-pop' : 'cyan'}">
        ${won ? '🏆 RACE WON!' : `RACE FINISHED — P${playerRow.position}`}
      </h2>
      <div class="muted" style="margin:6px 0 18px">+${pointsEarned} cup points · <span class="green">${money(cashEarned)}</span> prize money</div>`;
    if (won) { this.confetti(div); this.actions.sfx('fanfare'); this.actions.sfx('voice:win'); }
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
        <td style="text-align:right;font-weight:700">+${CUP.pointsByPosition[r.position - 1] ?? 0} pts</td>`;
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
    actions.appendChild(this.btn(
      isLastRace ? 'CUP RESULTS ⟫' : 'CONTINUE ⟫', 'primary',
      () => isLastRace ? this.showCupComplete() : this.actions.toTournament()
    ));
    if (!isLastRace) {
      actions.appendChild(this.btn('GARAGE', '', () => this.actions.toGarage()));
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
        ${playerRank === 1 ? `${CUP.name} CHAMPION!` : `CUP COMPLETE — P${playerRank}`}</h2>
      <div class="muted" style="margin:8px 0 20px">${
        playerRank === 1 ? `Winner bonus: <span class="green">${money(CUP.winBonus)}</span>` : 'Better luck next season.'}</div>`;
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
    actions.appendChild(this.btn('START NEW CUP ⟫', 'primary', () => {
      p.cup = freshCup();
      saveProfile(p);
      this.actions.toTournament();
    }));
    actions.appendChild(this.btn('MENU', '', () => this.actions.toMenu()));
    div.appendChild(actions);
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
