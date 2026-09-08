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
  /** Face centre as a fraction of the frame (default 0.5, 0.44). */
  faceX?: number;
  faceY?: number;
}

export function createSyntheticStream(opts: SyntheticOptions = {}): { stream: MediaStream; stop: () => void } {
  const bpm = opts.bpm ?? 72;
  const breaths = opts.breathsPerMin ?? 15;
  const vib = opts.vibrationHz ?? 5;
  const W = opts.width ?? 640, H = opts.height ?? 480, fps = opts.fps ?? 30;
  const fx = (opts.faceX ?? 0.5) * W, fy = (opts.faceY ?? 0.4375) * H;
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
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v + 4; img.data[i + 3] = 255;
  }
  nctx.putImageData(img, 0, 0);

  const draw = () => {
    const t = (performance.now() - t0) / 1000;
    ctx.drawImage(noise, 0, 0);

    // Chest: a shirt-coloured block that rises and falls ~0.7 px with breathing.
    const breath = Math.sin(2 * Math.PI * (breaths / 60) * t) * 0.7;
    ctx.fillStyle = '#3b4a6b';
    ctx.beginPath();
    ctx.roundRect(150, 330 - breath, 340, 200, 40);
    ctx.fill();

    // Face: skin whose green/red reflectance changes by a fraction of a percent with the pulse.
    const pulse = Math.sin(2 * Math.PI * (bpm / 60) * t);
    const r = 205 * (1 - 0.0025 * pulse), g = 152 * (1 - 0.0045 * pulse), b = 125 * (1 - 0.001 * pulse);
    ctx.fillStyle = `rgb(${r.toFixed(2)},${g.toFixed(2)},${b.toFixed(2)})`;
    ctx.beginPath();
    ctx.ellipse(fx, fy, 95, 125, 0, 0, Math.PI * 2);
    ctx.fill();
    // Eyes, brows, mouth (non-skin regions the mask should reject).
    ctx.fillStyle = '#2a1e1a';
    ctx.beginPath(); ctx.ellipse(285, 185, 13, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(355, 185, 13, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#7a3b3b';
    ctx.beginPath(); ctx.ellipse(320, 275, 26, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2a1e1a';
    ctx.fillRect(268, 165, 36, 5); ctx.fillRect(336, 165, 36, 5);

    // Vibrating wire on the right.
    const vx = 560 + Math.sin(2 * Math.PI * vib * t) * 0.35;
    ctx.strokeStyle = '#d8d8d8';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(vx, 40); ctx.lineTo(vx, 440); ctx.stroke();

  };
  // A timer rather than requestAnimationFrame so the scene keeps running at full rate even
  // when the tab is occluded (headless / background testing).
  timer = window.setInterval(draw, 1000 / fps);
  draw();
  const stream = canvas.captureStream(fps);
  return { stream, stop: () => { clearInterval(timer); for (const tr of stream.getTracks()) tr.stop(); } };
}
