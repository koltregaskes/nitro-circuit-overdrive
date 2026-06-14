// Procedural WebAudio sound: engine loop + one-shot effects. No audio assets.

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineSub: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  volume = 0.6;

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
      } catch {
        this.ctx = null;
      }
    }
    // browsers create contexts suspended outside user gestures — always try to resume
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
    for (const a of this.samples.values()) a.volume = Math.min(1, v * 1.2);
    if (this.musicGain && this.ctx) this.musicGain.gain.setTargetAtTime(v * 0.18, this.ctx.currentTime, 0.1);
  }

  unlock(): void {
    this.ensure();
  }

  // ---- AI-generated voice/sfx samples (mp3 under public/audio) ----
  private samples = new Map<string, HTMLAudioElement>();

  playSample(file: string): void {
    try {
      let a = this.samples.get(file);
      if (!a) {
        a = new Audio(`${import.meta.env.BASE_URL}audio/${file}`);
        a.preload = 'auto';
        this.samples.set(file, a);
      }
      a.volume = Math.min(1, this.volume * 1.2);
      a.currentTime = 0;
      void a.play().catch(() => { /* autoplay gate — ignored */ });
    } catch { /* no audio */ }
  }

  // ---- procedural synthwave menu music loop (no external asset) ----
  private musicGain: GainNode | null = null;
  private musicTimer: number | null = null;

  startMusic(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.musicTimer !== null) return;
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.volume * 0.18;
    this.musicGain.connect(this.master);

    // Am–F–C–G vibe: bass roots + arpeggio over a 4-bar loop
    const roots = [110, 87.31, 130.81, 98];                 // A2 F2 C3 G2
    const arps = [
      [220, 261.63, 329.63], [174.61, 220, 261.63],
      [261.63, 329.63, 392], [196, 246.94, 293.66],
    ];
    let step = 0;
    const beat = 0.26;
    const tick = () => {
      if (!this.musicGain || !this.ctx) return;
      const bar = Math.floor(step / 4) % 4;
      const t = this.ctx.currentTime;
      if (step % 4 === 0) this.note(this.musicGain, 'triangle', roots[bar], beat * 4, 0.5);
      const arp = arps[bar];
      this.note(this.musicGain, 'sawtooth', arp[step % arp.length] * 2, beat * 0.9, 0.16);
      step++;
    };
    tick();
    this.musicTimer = window.setInterval(tick, beat * 1000);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) { clearInterval(this.musicTimer); this.musicTimer = null; }
    if (this.musicGain) {
      try { this.musicGain.disconnect(); } catch { /* already gone */ }
      this.musicGain = null;
    }
  }

  private note(dest: GainNode, type: OscillatorType, freq: number, dur: number, peak: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  startEngine(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.engineOsc) return;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    this.engineGain.connect(this.master);

    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 42;
    this.engineOsc.connect(filter);
    filter.connect(this.engineGain);
    this.engineOsc.start();

    // sub-octave square adds body
    this.engineSub = ctx.createOscillator();
    this.engineSub.type = 'square';
    this.engineSub.frequency.value = 21;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.5;
    this.engineSub.connect(subGain);
    subGain.connect(filter);
    this.engineSub.start();
  }

  stopEngine(): void {
    for (const osc of [this.engineOsc, this.engineSub]) {
      if (osc) {
        try { osc.stop(); } catch { /* already stopped */ }
        osc.disconnect();
      }
    }
    this.engineOsc = null;
    this.engineSub = null;
    if (this.engineGain) { this.engineGain.disconnect(); this.engineGain = null; }
  }

  updateEngine(speedFrac: number, boosting: boolean): void {
    if (!this.engineOsc || !this.engineSub || !this.engineGain || !this.ctx) return;
    const f = 42 + speedFrac * 130 + (boosting ? 38 : 0);
    this.engineOsc.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.05);
    this.engineSub.frequency.setTargetAtTime(f / 2, this.ctx.currentTime, 0.05);
    this.engineGain.gain.setTargetAtTime(0.1 + speedFrac * 0.16 + (boosting ? 0.05 : 0), this.ctx.currentTime, 0.1);
  }

  /** One-shot tone with its own gain envelope. */
  private tone(
    ctx: AudioContext, type: OscillatorType, f0: number, f1: number,
    dur: number, peak: number, startAt = 0
  ): void {
    if (!this.master) return;
    const t = ctx.currentTime + startAt;
    const g = ctx.createGain();
    g.connect(this.master);
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(ctx: AudioContext, dur: number, peak: number, filterFreq: number, startAt = 0): void {
    if (!this.master) return;
    const t = ctx.currentTime + startAt;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t);
  }

  play(name: string, vol = 1): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    switch (name) {
      case 'click':     this.tone(ctx, 'square', 620, 820, 0.07, 0.18 * vol); break;
      case 'buy':       this.tone(ctx, 'sine', 520, 1040, 0.18, 0.3 * vol); break;
      case 'deny':      this.tone(ctx, 'square', 200, 110, 0.2, 0.22 * vol); break;
      case 'count':     this.tone(ctx, 'sine', 440, 440, 0.18, 0.4 * vol); break;
      case 'go':        this.tone(ctx, 'sine', 660, 990, 0.45, 0.45 * vol); break;
      case 'lap':       this.tone(ctx, 'sine', 700, 940, 0.16, 0.32 * vol);
                        this.tone(ctx, 'sine', 940, 1180, 0.2, 0.28 * vol, 0.12); break;
      case 'missile':   this.noise(ctx, 0.45, 0.5 * vol, 2600); break;
      case 'mine':      this.tone(ctx, 'square', 300, 170, 0.14, 0.25 * vol); break;
      case 'explosion': this.noise(ctx, 0.7, 0.8 * vol, 900);
                        this.tone(ctx, 'sine', 120, 40, 0.5, 0.4 * vol); break;
      case 'bump':      this.noise(ctx, 0.16, 0.4 * vol, 1300); break;
      case 'wreck':     this.noise(ctx, 1.0, 0.8 * vol, 700);
                        this.tone(ctx, 'sawtooth', 220, 50, 0.8, 0.3 * vol); break;
      case 'oil':       this.tone(ctx, 'sine', 500, 180, 0.35, 0.3 * vol);
                        this.noise(ctx, 0.3, 0.25 * vol, 800); break;
      case 'animal':    this.tone(ctx, 'sine', 520, 780, 0.1, 0.3 * vol);
                        this.tone(ctx, 'sine', 780, 520, 0.12, 0.3 * vol, 0.1); break;
      case 'alert':     this.tone(ctx, 'square', 880, 880, 0.12, 0.3 * vol);
                        this.tone(ctx, 'square', 660, 660, 0.12, 0.3 * vol, 0.15); break;
      case 'finalLap':  this.tone(ctx, 'sine', 520, 780, 0.3, 0.4 * vol); break;
      case 'finish':    this.tone(ctx, 'sine', 523, 523, 0.18, 0.35 * vol);
                        this.tone(ctx, 'sine', 659, 659, 0.18, 0.35 * vol, 0.16);
                        this.tone(ctx, 'sine', 784, 784, 0.3, 0.4 * vol, 0.32); break;
      case 'fanfare':   this.tone(ctx, 'sine', 523, 523, 0.22, 0.4 * vol);
                        this.tone(ctx, 'sine', 659, 659, 0.22, 0.4 * vol, 0.18);
                        this.tone(ctx, 'sine', 784, 784, 0.22, 0.4 * vol, 0.36);
                        this.tone(ctx, 'sine', 1046, 1046, 0.6, 0.45 * vol, 0.54);
                        this.noise(ctx, 0.5, 0.2 * vol, 4000, 0.54); break;
      default: break;
    }
  }
}
