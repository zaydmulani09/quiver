import { bandpassBiquad, biquadFilter, detrend, dominantFrequency, hann, resampleUniform } from './filters';
import { powerSpectrum } from './fft';
import { chrom, green, pos } from './pos';

export interface HeartRateReading {
  /** Smoothed beats-per-minute estimate, or null while locking on. */
  bpm: number | null;
  /** Raw (unsmoothed) BPM of the latest spectral peak. */
  rawBpm: number;
  /** 0..1 — how much to trust `bpm`. */
  confidence: number;
  /** Seconds of signal accumulated. */
  seconds: number;
  /** Pulse waveform for display (uniformly sampled, latest `fs * displaySeconds` samples). */
  waveform: Float64Array;
  /** Whether a beat peak was confirmed since the previous update. */
  beat: boolean;
}

export interface HeartRateOptions {
  fs?: number;             // uniform resample rate (Hz)
  windowSeconds?: number;  // analysis window
  displaySeconds?: number; // waveform length returned
  minBpm?: number;
  maxBpm?: number;
  posWindowSeconds?: number;
}

/**
 * Turns a stream of (time, meanR, meanG, meanB) skin samples into a heart-rate estimate.
 * Pipeline: uniform resample -> POS -> band-pass -> Hann -> FFT -> peak + SNR gate ->
 * temporal smoothing with a persistence rule so a single noisy spectrum cannot yank the number.
 */
export class HeartRateEstimator {
  private readonly fs: number;
  private readonly win: number;
  private readonly display: number;
  private readonly minHz: number;
  private readonly maxHz: number;
  private readonly posWin: number;
  private readonly nfft = 2048;

  private t: number[] = [];
  private r: number[] = [];
  private g: number[] = [];
  private b: number[] = [];

  private smoothed: number | null = null;
  private candidate: number | null = null;
  private candidateSince = 0;
  private lastBeatTime = -Infinity;
  private conf = 0;

  constructor(opts: HeartRateOptions = {}) {
    this.fs = opts.fs ?? 30;
    this.win = opts.windowSeconds ?? 10;
    this.display = opts.displaySeconds ?? 6;
    this.minHz = (opts.minBpm ?? 42) / 60;
    this.maxHz = (opts.maxBpm ?? 180) / 60;
    this.posWin = Math.round((opts.posWindowSeconds ?? 1.6) * this.fs);
  }

  reset(): void {
    this.t = []; this.r = []; this.g = []; this.b = [];
    this.smoothed = null; this.candidate = null; this.candidateSince = 0;
    this.lastBeatTime = -Infinity; this.conf = 0;
  }

  get seconds(): number {
    return this.t.length > 1 ? this.t[this.t.length - 1] - this.t[0] : 0;
  }

  push(time: number, r: number, g: number, b: number): void {
    if (this.t.length && time <= this.t[this.t.length - 1]) return;
    this.t.push(time); this.r.push(r); this.g.push(g); this.b.push(b);
    const cutoff = time - this.win - 1;
    let drop = 0;
    while (drop < this.t.length && this.t[drop] < cutoff) drop++;
    if (drop > 0) {
      this.t.splice(0, drop); this.r.splice(0, drop); this.g.splice(0, drop); this.b.splice(0, drop);
    }
  }

  update(): HeartRateReading {
    const seconds = this.seconds;
    const empty: HeartRateReading = { bpm: this.smoothed, rawBpm: 0, confidence: this.conf, seconds, waveform: new Float64Array(0), beat: false };
    if (seconds < 3 || this.t.length < this.posWin + 2) return empty;

    const R = resampleUniform(this.t, this.r, this.fs);
    const G = resampleUniform(this.t, this.g, this.fs);
    const B = resampleUniform(this.t, this.b, this.fs);
    const n = R.y.length;
    if (n < this.posWin + 2) return empty;

    const pulse = pos(R.y, G.y, B.y, this.posWin);
    const bp = bandpassBiquad(this.fs, this.minHz, this.maxHz);
    // Causal filtering keeps the newest samples clean (a zero-phase pass would smear the tail
    // with its reverse-direction transient); the ~140 ms group delay is imperceptible.
    const filtered = biquadFilter(detrend(pulse), bp);

    // Waveform for display: last `display` seconds, normalised to unit RMS.
    const dispN = Math.min(n, Math.round(this.display * this.fs));
    const waveform = new Float64Array(dispN);
    let rms = 0;
    for (let i = 0; i < dispN; i++) { const v = filtered[n - dispN + i]; waveform[i] = v; rms += v * v; }
    rms = Math.sqrt(rms / Math.max(1, dispN)) || 1;
    for (let i = 0; i < dispN; i++) waveform[i] /= rms;

    // Spectrum on the analysis window, gated by SNR.
    const w = hann(n);
    const windowed = new Float64Array(n);
    for (let i = 0; i < n; i++) windowed[i] = filtered[i] * w[i];
    const power = powerSpectrum(windowed, this.nfft);
    const lobe = Math.ceil((2 * this.nfft) / n);
    const { freq, snr } = dominantFrequency(power, this.fs, this.nfft, this.minHz, this.maxHz, lobe);
    const rawBpm = freq * 60;

    // Confidence: SNR mapped through a soft ramp, scaled by how much signal we have.
    const snrConf = Math.max(0, Math.min(1, (snr - 0.6) / 2.4));
    const timeConf = Math.max(0, Math.min(1, (seconds - 3) / 5));
    const confidence = snrConf * timeConf;

    // Smoothing with persistence: accept a big jump only if it holds for ~1.5 s.
    const now = this.t[this.t.length - 1];
    if (confidence > 0.25 && rawBpm > 0) {
      if (this.smoothed === null) {
        this.smoothed = rawBpm;
      } else if (Math.abs(rawBpm - this.smoothed) < 12) {
        this.smoothed += (rawBpm - this.smoothed) * 0.25;
        this.candidate = null;
      } else {
        if (this.candidate === null || Math.abs(rawBpm - this.candidate) > 8) {
          this.candidate = rawBpm;
          this.candidateSince = now;
        } else if (now - this.candidateSince > 1.5) {
          this.smoothed = rawBpm;
          this.candidate = null;
        }
      }
    }
    this.conf += (confidence - this.conf) * 0.3;

    // Beat detection on the filtered pulse: the newest confirmed local maximum in the last 0.6 s
    // that we have not reported yet.
    let beat = false;
    const guard = 2;
    const minGap = (1 / this.maxHz) * 0.9;
    let thresh = 0;
    for (let i = n - dispN; i < n; i++) thresh = Math.max(thresh, Math.abs(filtered[i]));
    thresh *= 0.35;
    for (let i = n - guard - 1; i > n - guard - Math.round(0.6 * this.fs) && i > 1; i--) {
      if (filtered[i] > thresh && filtered[i] > filtered[i - 1] && filtered[i] >= filtered[i + 1]) {
        const tPeak = R.t0 + i / this.fs;
        if (tPeak - this.lastBeatTime > minGap && this.conf > 0.2) {
          this.lastBeatTime = tPeak;
          beat = true;
        }
        break;
      }
    }

    return { bpm: this.conf > 0.3 ? this.smoothed : null, rawBpm, confidence: this.conf, seconds, waveform, beat };
  }
}
