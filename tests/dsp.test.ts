import { describe, expect, it } from 'vitest';
import { fft, powerSpectrum } from '../src/dsp/fft';
import { bandpassBiquad, detrend, dominantFrequency, filtfilt, resampleUniform } from '../src/dsp/filters';

describe('fft', () => {
  it('matches a naive DFT', () => {
    const n = 64;
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin(i * 0.3) + Math.cos(i * 1.1) * 0.5;
    const expRe = new Float64Array(n), expIm = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      for (let t = 0; t < n; t++) {
        const a = (-2 * Math.PI * k * t) / n;
        expRe[k] += re[t] * Math.cos(a);
        expIm[k] += re[t] * Math.sin(a);
      }
    }
    fft(re, im);
    for (let k = 0; k < n; k++) {
      expect(re[k]).toBeCloseTo(expRe[k], 8);
      expect(im[k]).toBeCloseTo(expIm[k], 8);
    }
  });

  it('finds a pure tone', () => {
    const fs = 30, nfft = 2048, f = 1.25;
    const sig = new Float64Array(300);
    for (let i = 0; i < sig.length; i++) sig[i] = Math.sin(2 * Math.PI * f * (i / fs));
    const p = powerSpectrum(sig, nfft);
    const { freq } = dominantFrequency(p, fs, nfft, 0.7, 3);
    expect(Math.abs(freq - f)).toBeLessThan(0.03);
  });
});

describe('filters', () => {
  it('bandpass keeps in-band, rejects out-of-band', () => {
    const fs = 30;
    const c = bandpassBiquad(fs, 0.7, 3);
    const inBand = new Float64Array(600), outBand = new Float64Array(600);
    for (let i = 0; i < 600; i++) {
      inBand[i] = Math.sin(2 * Math.PI * 1.3 * (i / fs));
      outBand[i] = Math.sin(2 * Math.PI * 0.1 * (i / fs));
    }
    const rms = (x: Float64Array) => Math.sqrt(x.slice(200).reduce((s, v) => s + v * v, 0) / 400);
    expect(rms(filtfilt(inBand, c))).toBeGreaterThan(0.5);
    expect(rms(filtfilt(outBand, c))).toBeLessThan(0.05);
  });

  it('detrend removes a ramp', () => {
    const x = Float64Array.from({ length: 100 }, (_, i) => 3 + 0.5 * i);
    const d = detrend(x);
    for (const v of d) expect(Math.abs(v)).toBeLessThan(1e-9);
  });

  it('resamples irregular timestamps to a uniform grid', () => {
    const t = [0, 0.03, 0.07, 0.1, 0.14, 0.2];
    const v = t.map((x) => x * 10);
    const { y } = resampleUniform(t, v, 50);
    expect(y.length).toBe(11);
    for (let i = 0; i < y.length; i++) expect(y[i]).toBeCloseTo((i / 50) * 10, 6);
  });
});

