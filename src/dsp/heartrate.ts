import { bandpassBiquad, biquadFilter, detrend, dominantFrequency, hann, resampleUniform } from './filters';
import { powerSpectrum } from './fft';
import { pos } from './pos';

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
