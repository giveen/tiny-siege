// Tiny WebAudio engine:
//  - SFX are real samples from the Free Fantasy SFX Pack (sound/sfx/*.ogg),
//    with the old WebAudio synth kept as a fallback for any missing sample.
//  - BGM loops (sound/music/*.ogg) with short crossfades between tracks.
// The AudioContext is created lazily on the first user gesture (autoplay policy).

const SFX_NAMES = [
  "shoot", "spear", "cannon", "explosion", "hit", "die", "coin",
  "build", "upgrade", "sell", "boon", "castle", "wave", "over",
] as const;

export type SfxName = (typeof SFX_NAMES)[number] | "click";

const MASTER_VOL = 0.55;
const MUSIC_VOL = 0.4;
const MUSIC_FADE = 0.18; // time constant for crossfades

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private musicSrc: AudioBufferSourceNode | null = null;
  private musicKey: string | null = null;
  private pendingMusic: string | null = null;
  private base = "assets/";
  enabled = true;

  setBase(base: string): void {
    this.base = base;
  }

  /** Call from a user gesture to unlock audio (creates context, loads samples). */
  unlock(): void {
    if (!this.ctx) {
      try {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.enabled ? MASTER_VOL : 0;
        this.master.connect(this.ctx.destination);
        this.musicBus = this.ctx.createGain();
        this.musicBus.gain.value = MUSIC_VOL;
        this.musicBus.connect(this.master);
      } catch {
        this.ctx = null;
      }
    }
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") {
      void this.ctx
        .resume()
        .then(() => this.maybeResumeMusic())
        .catch(() => {
          /* not allowed yet; next gesture retries */
        });
    }
    void this.loadSamples();
  }

  /** Start the requested music track now that the context is running. */
  private maybeResumeMusic(): void {
    if (!this.ctx || this.ctx.state !== "running") return;
    if (this.pendingMusic) {
      const k = this.pendingMusic;
      this.pendingMusic = null;
      this.startMusic(k);
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.master && this.ctx) {
      // One master fade mutes SFX + music together.
      this.master.gain.setTargetAtTime(on ? MASTER_VOL : 0, this.ctx.currentTime, 0.02);
    }
  }

  // ------------------------------------------------------------- samples
  private loading = false;
  private loaded = false;

  private async loadSamples(): Promise<void> {
    if (!this.ctx || this.loaded || this.loading) return;
    this.loading = true;
    const ctx = this.ctx;
    const paths: [string, string][] = [
      ...SFX_NAMES.map((n) => [n, this.base + "sound/sfx/" + n + ".ogg"] as [string, string]),
      ["music_forest", this.base + "sound/music/forest.ogg"],
      ["music_cave", this.base + "sound/music/cave.ogg"],
    ];
    let allOk = true;
    await Promise.all(
      paths.map(async ([key, url]) => {
        try {
          const res = await fetch(url);
          if (!res.ok) {
            allOk = false;
            return;
          }
          const buf = await ctx.decodeAudioData(await res.arrayBuffer());
          this.buffers.set(key, buf);
        } catch {
          allOk = false; // sample missing -> synth fallback
        }
      })
    );
    this.loading = false;
    if (allOk) this.loaded = true; // retry on next unlock if anything failed
    // If a track was requested before the context ran, start it now (if running).
    this.maybeResumeMusic();
  }

  // ------------------------------------------------------------- sfx
  /** Play an SFX sample (slight pitch variation), synth fallback if missing. */
  play(name: SfxName): void {
    // No gesture yet: stay silent (and warning-free) until the context resumes.
    if (!this.enabled || !this.ctx || !this.master || this.ctx.state !== "running") return;
    const buf = this.buffers.get(name);
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = 0.97 + Math.random() * 0.06;
      src.connect(this.master);
      src.start();
      return;
    }
    this.synth(name);
  }

  // ------------------------------------------------------------- music
  /** Start (or switch to) a looping BGM track. Key: "forest" | "cave". */
  music(key: string): void {
    if (!this.ctx) {
      this.pendingMusic = key;
      this.musicKey = key;
      return;
    }
    this.startMusic(key);
  }

  stopMusic(): void {
    this.musicKey = null;
    this.pendingMusic = null;
    this.fadeOutCurrent();
  }

  private startMusic(key: string): void {
    if (key === this.musicKey && this.musicSrc) return;
    if (!this.ctx || this.ctx.state !== "running") {
      // Not allowed to start yet; unlock()/loadSamples() will retry.
      this.pendingMusic = key;
      this.musicKey = null;
      return;
    }
    const buf = this.buffers.get("music_" + key);
    if (!buf) {
      this.pendingMusic = key;
      this.musicKey = null;
      return;
    }
    this.musicKey = key;
    this.pendingMusic = null;
    const ctx = this.ctx!;
    this.fadeOutCurrent();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const fade = ctx.createGain();
    fade.gain.value = 0.0001;
    fade.gain.setTargetAtTime(1, ctx.currentTime, MUSIC_FADE);
    src.connect(fade);
    fade.connect(this.musicBus!);
    src.start();
    this.musicSrc = src;
  }

  private fadeOutCurrent(): void {
    const old = this.musicSrc;
    if (!old || !this.ctx || !this.musicBus) return;
    this.musicSrc = null;
    const fade = this.ctx.createGain();
    fade.gain.value = 1;
    fade.gain.setTargetAtTime(0.0001, this.ctx.currentTime, MUSIC_FADE);
    try {
      old.disconnect();
    } catch {
      /* already disconnected */
    }
    old.connect(fade);
    fade.connect(this.musicBus);
    window.setTimeout(() => {
      try {
        old.stop();
      } catch {
        /* already stopped */
      }
    }, 1200);
  }

  // ------------------------------------------------------------- synth fallback
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

  private synth(name: SfxName): void {
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
