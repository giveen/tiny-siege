// Tiny WebAudio SFX synth. No audio files — everything is generated.
// The context is created lazily on the first user gesture (browser autoplay policy).

type SfxName =
  | "shoot"
  | "spear"
  | "cannon"
  | "explosion"
  | "hit"
  | "die"
  | "coin"
  | "build"
  | "upgrade"
  | "sell"
  | "boon"
  | "castle"
  | "wave"
  | "over"
  | "click";

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled = true;

  /** Call from a user gesture to unlock audio. */
  unlock(): void {
    if (!this.ctx) {
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
      } catch {
        this.ctx = null;
      }
    }
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    when = 0,
    slideTo?: number
  ): void {
    if (!this.ctx || !this.master) return;
    const t = this.now() + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, gain: number, when = 0, lowpass = 1200): void {
    if (!this.ctx || !this.master) return;
    const t = this.now() + when;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = lowpass;
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur);
  }

  play(name: SfxName): void {
    if (!this.enabled || !this.ctx) return;
    switch (name) {
      case "shoot":
        this.tone(660, 0.08, "square", 0.12, 0, 320);
        break;
      case "spear":
        this.tone(420, 0.1, "sawtooth", 0.12, 0, 900);
        break;
      case "cannon":
        this.tone(120, 0.25, "sine", 0.35, 0, 50);
        this.noise(0.2, 0.2, 0, 800);
        break;
      case "explosion":
        this.noise(0.35, 0.4, 0, 1500);
        this.tone(90, 0.3, "sine", 0.3, 0, 40);
        break;
      case "hit":
        this.tone(220, 0.05, "square", 0.08, 0, 160);
        break;
      case "die":
        this.tone(300, 0.18, "triangle", 0.14, 0, 90);
        break;
      case "coin":
        this.tone(880, 0.06, "square", 0.1);
        this.tone(1320, 0.08, "square", 0.08, 0.05);
        break;
      case "build":
        this.tone(180, 0.12, "square", 0.18, 0, 120);
        this.noise(0.08, 0.12, 0, 600);
        break;
      case "upgrade":
        this.tone(440, 0.08, "square", 0.12);
        this.tone(660, 0.08, "square", 0.12, 0.07);
        this.tone(880, 0.1, "square", 0.12, 0.14);
        break;
      case "sell":
        this.tone(500, 0.1, "square", 0.12, 0, 260);
        break;
      case "boon":
        this.tone(523, 0.1, "triangle", 0.16);
        this.tone(659, 0.1, "triangle", 0.16, 0.08);
        this.tone(784, 0.16, "triangle", 0.16, 0.16);
        break;
      case "castle":
        this.tone(80, 0.5, "sine", 0.4, 0, 40);
        this.noise(0.4, 0.3, 0, 500);
        break;
      case "wave":
        this.tone(196, 0.2, "sawtooth", 0.16);
        this.tone(294, 0.2, "sawtooth", 0.16, 0.12);
        break;
      case "over":
        this.tone(392, 0.3, "sawtooth", 0.2, 0, 196);
        this.tone(196, 0.6, "sawtooth", 0.2, 0.25, 98);
        break;
      case "click":
        this.tone(520, 0.04, "square", 0.08);
        break;
    }
  }
}
