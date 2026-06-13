// In-race HUD: position, lap board, timer, minimap, items, speed, armour.

import { HudState } from '../game/race';
import { CUP } from '../game/data';

function fmtTime(ms: number | null): string {
  if (ms === null || !isFinite(ms)) return '--:--.---';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const t = Math.floor(ms % 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(t).padStart(3, '0')}`;
}

function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

export class Hud {
  private root: HTMLElement;
  private minimapCanvas!: HTMLCanvasElement;
  private trackPath: { x: number; y: number }[] = [];
  private els: Record<string, HTMLElement> = {};
  private lastBoardKey = '';
  private bestTrackMs: number | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  mount(trackPath: { x: number; y: number }[], bestTrackMs: number | null): void {
    this.trackPath = trackPath;
    this.bestTrackMs = bestTrackMs;
    this.root.innerHTML = `
      <div class="hud-top-left">
        <div class="hud-pos"><span id="h-pos">-</span><small> / <span id="h-count">6</span></small></div>
        <div class="hud-lap">LAP <span id="h-lap">1</span> / <span id="h-laps">3</span></div>
      </div>
      <div class="hud-board" id="h-board"></div>
      <div class="hud-top-right">
        <div class="hud-cup">${CUP.name} 🏆</div>
        <div class="hud-timer" id="h-timer">00:00.000</div>
        <div class="hud-best">BEST <span id="h-best">--:--.---</span></div>
      </div>
      <div class="hud-minimap"><canvas id="h-minimap" width="150" height="150"></canvas></div>
      <div class="hud-items">
        <div class="item-slot" id="slot-boost">
          <div class="icon">⚡</div><div class="label">Boost</div>
          <div class="statbar" id="h-boostbar"></div>
        </div>
        <div class="item-slot" id="slot-missile">
          <div class="icon">🚀</div><div class="label">Missile</div>
          <div class="count">x<span id="h-missiles">0</span></div>
        </div>
        <div class="item-slot" id="slot-mine">
          <div class="icon">💣</div><div class="label">Mine</div>
          <div class="count">x<span id="h-mines">0</span></div>
        </div>
      </div>
      <div class="hud-bottom-right">
        <div><span class="hud-speed"><span id="h-speed">0</span><small> KM/H</small></span><span class="hud-gear" id="h-gear">1</span></div>
        <div class="hud-armour">ARMOUR <div class="statbar" id="h-armourbar"></div></div>
      </div>
      <div class="hud-center">
        <div class="hud-countdown" id="h-countdown" style="display:none"></div>
        <div class="hud-message" id="h-message" style="display:none"></div>
        <div class="hud-wrong-way" id="h-wrongway" style="display:none">WRONG WAY!</div>
      </div>
    `;
    this.minimapCanvas = this.root.querySelector('#h-minimap') as HTMLCanvasElement;
    for (const id of ['h-pos', 'h-count', 'h-lap', 'h-laps', 'h-timer', 'h-best', 'h-board',
      'h-missiles', 'h-mines', 'h-speed', 'h-gear', 'h-countdown', 'h-message', 'h-wrongway',
      'h-boostbar', 'h-armourbar']) {
      this.els[id] = this.root.querySelector('#' + id) as HTMLElement;
    }
    // build segment bars
    this.els['h-boostbar'].innerHTML = '<i></i>'.repeat(4);
    this.els['h-armourbar'].innerHTML = '<i></i>'.repeat(5);
    if (this.bestTrackMs !== null) this.els['h-best'].textContent = fmtTime(this.bestTrackMs);
  }

  unmount(): void {
    this.root.innerHTML = '';
  }

  update(s: HudState): void {
    const e = this.els;
    e['h-pos'].textContent = String(s.position);
    e['h-count'].textContent = String(s.racerCount);
    e['h-lap'].textContent = String(s.lap);
    e['h-laps'].textContent = String(s.laps);
    e['h-timer'].textContent = fmtTime(s.raceTimeMs);
    const best = s.bestLapMs ?? this.bestTrackMs;
    e['h-best'].textContent = fmtTime(best ?? null);
    e['h-missiles'].textContent = String(s.items.missile);
    e['h-mines'].textContent = String(s.items.mine);
    e['h-speed'].textContent = String(s.speedKmh);
    e['h-gear'].textContent = String(s.gear);

    // segmented bars
    this.setBar(e['h-boostbar'], s.boostFrac, 4, true);
    this.setBar(e['h-armourbar'], s.armourFrac, 5, false);

    // countdown / messages
    if (s.countdown !== null) {
      e['h-countdown'].style.display = '';
      e['h-countdown'].textContent = String(s.countdown);
    } else {
      e['h-countdown'].style.display = 'none';
    }
    if (s.message) {
      e['h-message'].style.display = '';
      e['h-message'].textContent = s.message;
    } else {
      e['h-message'].style.display = 'none';
    }
    e['h-wrongway'].style.display = s.wrongWay ? '' : 'none';

    // standings board (rebuild only when order changes)
    const key = s.board.map((b) => b.carNum).join(',');
    if (key !== this.lastBoardKey) {
      this.lastBoardKey = key;
      e['h-board'].innerHTML = s.board.map((b, i) => `
        <div class="rowi ${b.isPlayer ? 'you' : ''}">
          <span>${i + 1}</span>
          <span class="car-num" style="background:${hex(b.color)}">${b.carNum}</span>
          <span>${b.name}</span>
        </div>`).join('');
    }

    this.drawMinimap(s);
  }

  private setBar(el: HTMLElement, frac: number, segs: number, cyan: boolean): void {
    const lit = Math.round(frac * segs);
    const items = el.children;
    for (let i = 0; i < items.length; i++) {
      items[i].className = i < lit ? (cyan ? 'on cyan-seg' : 'on') : '';
    }
  }

  private drawMinimap(s: HudState): void {
    const ctx = this.minimapCanvas.getContext('2d');
    if (!ctx) return;
    const W = this.minimapCanvas.width, H = this.minimapCanvas.height;
    const pad = 12;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    this.trackPath.forEach((p, i) => {
      const x = pad + p.x * (W - pad * 2);
      const y = pad + p.y * (H - pad * 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();

    for (const d of s.minimapDots) {
      const x = pad + d.x * (W - pad * 2);
      const y = pad + d.y * (H - pad * 2);
      ctx.beginPath();
      ctx.arc(x, y, d.isPlayer ? 6 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = d.isPlayer ? '#ff2975' : hex(d.color);
      ctx.fill();
      if (d.isPlayer) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }
}
