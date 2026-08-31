/**
 * In-place iterative radix-2 FFT. `re` and `im` must have power-of-two length.
 * Plain typed-array implementation — fast enough for 2048-point spectra at ~4 Hz.
 */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n !== im.length || (n & (n - 1)) !== 0) throw new Error('fft: length must be a power of two');

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const tRe = re[b] * curRe - im[b] * curIm;
        const tIm = re[b] * curIm + im[b] * curRe;
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nRe;
      }
    }
  }
}

/** Power spectrum (|X|^2) of a real signal, zero-padded to `nfft`. Returns bins 0..nfft/2. */
export function powerSpectrum(signal: ArrayLike<number>, nfft: number): Float64Array {
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  const n = Math.min(signal.length, nfft);
  for (let i = 0; i < n; i++) re[i] = signal[i];
  fft(re, im);
  const half = nfft >> 1;
  const out = new Float64Array(half + 1);
  for (let i = 0; i <= half; i++) out[i] = re[i] * re[i] + im[i] * im[i];
  return out;
}
