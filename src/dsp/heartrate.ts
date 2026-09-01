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