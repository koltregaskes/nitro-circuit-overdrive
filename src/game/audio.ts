// Procedural WebAudio sound: engine loop + one-shot effects. No audio assets.

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  // separate buses so engine / SFX / music can be balanced independently
  private busEngine: GainNode | null = null;
  private busSfx: GainNode | null = null;
  private busMusic: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineSub: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private screechGain: GainNode | null = null;
  private screechSrc: AudioBufferSourceNode | null = null;
  volume = 0.6;
  mix = { engine: 1, sfx: 1, music: 1 };

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
        this.busEngine = this.ctx.createGain();
        this.busSfx = this.ctx.createGain();
        this.busMusic = this.ctx.createGain();
        this.busEngine.gain.value = this.mix.engine;
        this.busSfx.gain.value = this.mix.sfx;
        this.busMusic.gain.value = this.mix.music;
        for (const b of [this.busEngine, this.busSfx, this.busMusic]) b.connect(this.master);
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
    for (const a of this.samples.values()) a.volume = Math.min(1, v * this.mix.sfx * 1.2);
    if (this.musicGain && this.ctx) this.musicGain.gain.setTargetAtTime(0.18, this.ctx.currentTime, 0.1);
  }

  /** Per-bus balance, 0-1 each, applied on top of the master volume. */
  setMix(engine: number, sfx: number, music: number): void {
    this.mix = { engine, sfx, music };
    for (const a of this.samples.values()) a.volume = Math.min(1, this.volume * sfx * 1.2);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.busEngine?.gain.setTargetAtTime(engine, t, 0.05);
    this.busSfx?.gain.setTargetAtTime(sfx, t, 0.05);
    this.busMusic?.gain.setTargetAtTime(music, t, 0.05);
  }

  /** Tyre screech: a persistent filtered-noise loop whose gain tracks slip. */
  private startScreech(ctx: AudioContext): void {
    if (this.screechSrc || !this.busSfx) return;
    const len = Math.floor(ctx.sampleRate * 1.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 5;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(bp); bp.connect(g); g.connect(this.busSfx);
    src.start();
    this.screechSrc = src;
    this.screechGain = g;
  }

  /** 0 = silent, 1 = full slide. Called every frame from the sim. */
  setScreech(amount: number): void {
    if (!this.screechGain || !this.ctx) return;
    this.screechGain.gain.setTargetAtTime(
      Math.max(0, Math.min(1, amount)) * 0.16, this.ctx.currentTime, 0.06
    );
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
      a.volume = Math.min(1, this.volume * this.mix.sfx * 1.2);
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
    this.musicGain.gain.value = 0.18; // level lives on the music bus now
    this.musicGain.connect(this.busMusic ?? this.master);

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

  /**
   * Engine voice: a harmonic stack (not the old two-oscillator drone).
   *
   * A real engine's character comes from ORDERS — the fundamental plus strong
   * even harmonics — plus a resonant filter that opens with load, and above all
   * an RPM that sweeps and DROPS on each gearshift. A single fixed-ratio pair
   * mapped to speed can only ever sound like a hairdryer.
   */
  private engineParts: { osc: OscillatorNode; gain: GainNode; mult: number }[] = [];
  private engineFilter: BiquadFilterNode | null = null;
  private whineOsc: OscillatorNode | null = null;
  private whineGain: GainNode | null = null;
  private rpmSmooth = 0;

  startEngine(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.engineParts.length) return;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineGain.connect(this.busEngine ?? this.master);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    filter.Q.value = 6;              // resonance = throaty, not muffled
    filter.connect(this.engineGain);
    this.engineFilter = filter;

    // orders: sub, fundamental, 2nd (dominant in a V-engine), 3rd, 4th
    const spec: [number, OscillatorType, number][] = [
      [0.5, 'sine', 0.55],
      [1.0, 'sawtooth', 0.5],
      [2.0, 'square', 0.32],
      [3.0, 'sawtooth', 0.16],
      [4.0, 'square', 0.09],
    ];
    for (const [mult, type, level] of spec) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = 60 * mult;
      // a few cents of detune per order stops it sounding like an organ chord
      osc.detune.value = (mult * 7) % 11;
      const gain = ctx.createGain();
      gain.gain.value = level;
      osc.connect(gain);
      gain.connect(filter);
      osc.start();
      this.engineParts.push({ osc, gain, mult });
    }

    // turbo/nitro whine, silent until boosting
    const whine = ctx.createOscillator();
    whine.type = 'triangle';
    whine.frequency.value = 900;
    const wg = ctx.createGain();
    wg.gain.value = 0;
    whine.connect(wg);
    wg.connect(this.engineGain);
    whine.start();
    this.whineOsc = whine;
    this.whineGain = wg;

    this.startScreech(ctx);
  }

  stopEngine(): void {
    for (const p of this.engineParts) {
      try { p.osc.stop(); } catch { /* already stopped */ }
      p.osc.disconnect();
      p.gain.disconnect();
    }
    this.engineParts = [];
    this.rpmSmooth = 0;
    if (this.whineOsc) {
      try { this.whineOsc.stop(); } catch { /* already stopped */ }
      this.whineOsc.disconnect();
      this.whineOsc = null;
    }
    if (this.whineGain) { this.whineGain.disconnect(); this.whineGain = null; }
    if (this.engineFilter) { this.engineFilter.disconnect(); this.engineFilter = null; }
    this.engineOsc = null;
    this.engineSub = null;
    if (this.engineGain) { this.engineGain.disconnect(); this.engineGain = null; }
    if (this.screechSrc) {
      try { this.screechSrc.stop(); } catch { /* already stopped */ }
      this.screechSrc.disconnect();
      this.screechSrc = null;
    }
    if (this.screechGain) { this.screechGain.disconnect(); this.screechGain = null; }
  }

  /**
   * @param speedFrac 0..1 of top speed
   * @param boosting  nitro active
   * @param gear      1..6 — RPM resets each gear, which is what sells "engine"
   * @param throttle  0..1 load, opens the filter
   */
  updateEngine(speedFrac: number, boosting: boolean, gear = 1, throttle = 1): void {
    if (!this.engineParts.length || !this.engineGain || !this.ctx || !this.engineFilter) return;
    const t = this.ctx.currentTime;

    // RPM sweeps 0..1 WITHIN the current gear, so each shift drops the pitch and
    // climbs again — the single most important cue for a believable engine.
    const perGear = 1 / 6;
    const inGear = Math.min(1, Math.max(0, (speedFrac - (gear - 1) * perGear) / perGear));
    const rpm = 0.18 + inGear * 0.82;
    // smooth so shifts glide rather than click; fast attack, slower release
    this.rpmSmooth += (rpm - this.rpmSmooth) * (rpm > this.rpmSmooth ? 0.5 : 0.25);
    const r = this.rpmSmooth;

    const fundamental = 52 + r * 104 + (boosting ? 16 : 0);
    for (const p of this.engineParts) {
      p.osc.frequency.setTargetAtTime(fundamental * p.mult, t, 0.035);
    }
    // filter opens with revs AND load — closed throttle = engine braking burble
    this.engineFilter.frequency.setTargetAtTime(
      340 + r * 1500 + throttle * 520 + (boosting ? 700 : 0), t, 0.06
    );
    this.engineGain.gain.setTargetAtTime(
      0.085 + speedFrac * 0.13 + r * 0.04 + (boosting ? 0.05 : 0), t, 0.09
    );
    if (this.whineGain && this.whineOsc) {
      this.whineOsc.frequency.setTargetAtTime(700 + r * 1500, t, 0.08);
      this.whineGain.gain.setTargetAtTime(boosting ? 0.028 : 0, t, 0.12);
    }
  }

  /** One-shot tone with its own gain envelope. */
  private tone(
    ctx: AudioContext, type: OscillatorType, f0: number, f1: number,
    dur: number, peak: number, startAt = 0
  ): void {
    if (!this.master) return;
    const t = ctx.currentTime + startAt;
    const g = ctx.createGain();
    g.connect(this.busSfx ?? this.master);
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
    g.connect(this.busSfx ?? this.master);
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
