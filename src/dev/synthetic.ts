/**
 * Dev-only synthetic camera: a canvas scene with a known pulse, breathing rate and vibration,
 * streamed through captureStream() so the whole pipeline can be exercised without a webcam.
 * Not part of the production bundle (gated on import.meta.env.DEV in main.ts).
 */
export interface SyntheticOptions {
  bpm?: number;
  breathsPerMin?: number;
  vibrationHz?: number;
  width?: number;
  height?: number;
  fps?: number;
}

export function createSyntheticStream(opts: SyntheticOptions = {}): { stream: MediaStream; stop: () => void } {
  const bpm = opts.bpm ?? 72;
  const breaths = opts.breathsPerMin ?? 15;
  const vib = opts.vibrationHz ?? 5;
  const W = opts.width ?? 640, H = opts.height ?? 480, fps = opts.fps ?? 30;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const t0 = performance.now();
  let timer = 0;

  // Static noise texture so the background isn't perfectly flat (codecs and cameras never are).
  const noise = document.createElement('canvas');
  noise.width = W; noise.height = H;
  const nctx = noise.getContext('2d')!;
  const img = nctx.createImageData(W, H);
  let seed = 1;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const v = 60 + ((seed >>> 16) % 20);