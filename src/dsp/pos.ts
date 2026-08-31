import { mean, std } from './filters';

/**
 * POS — "Plane-Orthogonal-to-Skin" remote photoplethysmography.
 * Wang, den Brinker, Stuijk & de Haan, IEEE TBME 2017.
 *
 * Input: uniformly sampled mean skin colour (R, G, B) traces.
 * Output: a pulse signal in which the blood-volume pulse is the dominant oscillation,
 * with specular reflections and intensity changes largely projected out.
 *
 * The algorithm slides a window of `winLen` samples (~1.6 s) over the traces, temporally
 * normalises each channel by its window mean, projects the normalised colour onto the
 * plane orthogonal to the skin tone (S1 = G - B, S2 = G + B - 2R), combines the two
 * projections with an alpha-tuned gain, and overlap-adds the mean-removed result.
 */
export function pos(r: ArrayLike<number>, g: ArrayLike<number>, b: ArrayLike<number>, winLen: number): Float64Array {
  const n = r.length;
  const h = new Float64Array(n);
  if (n < winLen) return h;
  const s1 = new Float64Array(winLen);
  const s2 = new Float64Array(winLen);
  for (let end = winLen - 1; end < n; end++) {
    const start = end - winLen + 1;
    const mr = mean(r, start, end + 1), mg = mean(g, start, end + 1), mb = mean(b, start, end + 1);
    if (mr === 0 || mg === 0 || mb === 0) continue;
    for (let k = 0; k < winLen; k++) {
      const rn = r[start + k] / mr, gn = g[start + k] / mg, bn = b[start + k] / mb;
      s1[k] = gn - bn;
      s2[k] = gn + bn - 2 * rn;
    }
    const sd2 = std(s2);
    const alpha = sd2 > 1e-9 ? std(s1) / sd2 : 0;
    let hm = 0;
    for (let k = 0; k < winLen; k++) hm += s1[k] + alpha * s2[k];
    hm /= winLen;
    for (let k = 0; k < winLen; k++) h[start + k] += s1[k] + alpha * s2[k] - hm;
  }
  return h;
}
