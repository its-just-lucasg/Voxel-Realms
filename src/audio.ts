/**
 * Procedural Web Audio Synthesizer for Footsteps, Block Mining, Placement & Water
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private bgmAudio: HTMLAudioElement | null = null;
  private tracks: string[] = ['/music/Above_the_Cloud_Line.mp3'];
  private currentTrackIdx = 0;
  private bgmStarted = false;
  public musicMuted = false;
  public musicVolume = 0.42;
  private pauseTimeout: number | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      // Auto-discover any tracks placed in public/music/
      fetch('/api/music-tracks')
        .then((r) => (r.ok ? r.json() : null))
        .then((list: string[] | null) => {
          if (Array.isArray(list) && list.length > 0) {
            this.tracks = list;
          }
        })
        .catch(() => {});
    }
  }

  public startMusicIfNeeded(): void {
    if (this.bgmStarted || this.musicMuted || this.tracks.length === 0) return;
    this.bgmStarted = true;
    this.playCurrentTrack();
  }

  private playCurrentTrack(): void {
    if (this.musicMuted || this.tracks.length === 0) return;
    if (this.pauseTimeout !== null) {
      window.clearTimeout(this.pauseTimeout);
      this.pauseTimeout = null;
    }

    if (!this.bgmAudio) {
      this.bgmAudio = new Audio();
      this.bgmAudio.volume = this.musicVolume;
      this.bgmAudio.addEventListener('ended', () => {
        // Short peaceful ambient pause (12 to 18 seconds) before playing the next track / looping
        const pauseMs = (12 + Math.random() * 6) * 1000;
        this.pauseTimeout = window.setTimeout(() => {
          this.currentTrackIdx = (this.currentTrackIdx + 1) % this.tracks.length;
          this.playCurrentTrack();
        }, pauseMs);
      });
    }

    this.bgmAudio.src = this.tracks[this.currentTrackIdx % this.tracks.length];
    this.bgmAudio.volume = this.musicVolume;
    this.bgmAudio.play().catch(() => {
      // Browser blocked autoplay before user gesture; will retry on next click
      this.bgmStarted = false;
    });
  }

  public toggleMusicMute(): boolean {
    this.musicMuted = !this.musicMuted;
    if (this.musicMuted) {
      if (this.pauseTimeout !== null) {
        window.clearTimeout(this.pauseTimeout);
        this.pauseTimeout = null;
      }
      this.bgmAudio?.pause();
    } else {
      this.bgmStarted = true;
      if (this.bgmAudio && this.bgmAudio.src && this.bgmAudio.currentTime > 0 && !this.bgmAudio.ended) {
        this.bgmAudio.play().catch(() => {});
      } else {
        this.playCurrentTrack();
      }
    }
    return !this.musicMuted;
  }

  private ensureContext(): AudioContext | null {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public playBlockBreak(type: 'grass' | 'stone' | 'wood' | 'sand' | 'glass' | 'water'): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    // Create short noise burst + pitched thud
    const bufferSize = Math.floor(ctx.sampleRate * 0.11);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.35));
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    const freqMap = {
      grass: 650,
      sand: 950,
      stone: 420,
      wood: 520,
      glass: 1850,
      water: 380,
    };
    filter.frequency.setValueAtTime(freqMap[type] * (0.9 + Math.random() * 0.2), now);
    filter.Q.setValueAtTime(1.8, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.005, now + 0.11);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);

    if (type === 'glass') {
      this.playTone(1600 + Math.random() * 400, 0.08, 'sine', 0.12);
    }
  }

  public playBlockPlace(type: 'grass' | 'stone' | 'wood' | 'sand' | 'glass' | 'water'): void {
    const baseFreq = {
      grass: 170,
      sand: 210,
      stone: 145,
      wood: 195,
      glass: 520,
      water: 240,
    }[type];
    this.playTone(baseFreq * (0.92 + Math.random() * 0.16), 0.075, 'triangle', 0.18);
  }

  public playFootstep(type: 'grass' | 'stone' | 'wood' | 'sand' | 'glass' | 'water'): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const bufferSize = Math.floor(ctx.sampleRate * 0.055);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3));
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(type === 'stone' ? 500 : type === 'water' ? 350 : 850, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.065, now);
    gain.gain.exponentialRampToValueAtTime(0.003, now + 0.055);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
  }

  public playUiClick(): void {
    this.playTone(620, 0.035, 'sine', 0.08);
  }

  public playPickupChime(): void {
    this.playTone(880 + Math.random() * 220, 0.09, 'sine', 0.14);
  }

  public playSwordSlash(): void {
    this.playTone(340, 0.11, 'triangle', 0.18);
  }

  public playFireballCast(): void {
    this.playTone(220, 0.22, 'sawtooth', 0.2);
  }

  public playBoarGrunt(): void {
    this.playTone(115 + Math.random() * 25, 0.18, 'sawtooth', 0.15);
  }

  public playWraithHiss(): void {
    this.playTone(540 + Math.random() * 140, 0.25, 'sine', 0.14);
  }

  public playExplosion(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const duration = 0.65;
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.28));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(260, now);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.45, now);
    gain.gain.exponentialRampToValueAtTime(0.005, now + duration);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
  }

  /**
   * Synthesizes a cute vibrato sheep "Baa!" bleat
   */
  public playSheepBaa(volumeScale = 1.0): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const duration = 0.42 + Math.random() * 0.12;
    const basePitch = 250 + Math.random() * 45;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(basePitch * 1.08, now);
    osc.frequency.linearRampToValueAtTime(basePitch, now + 0.12);
    osc.frequency.linearRampToValueAtTime(basePitch * 0.86, now + duration);

    // Vibrato LFO for realistic sheep bleat warble
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.setValueAtTime(22, now);
    lfoGain.gain.setValueAtTime(14, now);
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    // Nasal vocal formant filter
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(880, now);
    filter.Q.setValueAtTime(2.4, now);

    const gain = ctx.createGain();
    const peak = Math.min(0.18, 0.14 * volumeScale);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.04);
    gain.gain.setValueAtTime(peak * 0.85, now + duration * 0.65);
    gain.gain.exponentialRampToValueAtTime(0.002, now + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    lfo.start(now);
    osc.stop(now + duration);
    lfo.stop(now + duration);
  }

  private playTone(freq: number, duration: number, oscType: OscillatorType, volume: number): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = oscType;
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.65, now + duration);

    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.004, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }
}
