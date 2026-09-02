/** Renders a 1200×630 share card: the BPM, the pulse trace, and how it was measured. */
export async function renderShareCard(bpm: number, waveform: Float64Array, siteUrl: string): Promise<Blob> {
  const W = 1200, H = 630;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  try { await document.fonts.load('italic 400 40px "Instrument Serif"'); await document.fonts.load('500 40px "Geist Mono"'); await document.fonts.load('400 40px "Geist"'); } catch { /* fallbacks are fine */ }

  ctx.fillStyle = '#0b0b0c';
  ctx.fillRect(0, 0, W, H);

  // Subtle vignette glow behind the number.
  const glow = ctx.createRadialGradient(300, 300, 20, 300, 300, 520);
  glow.addColorStop(0, 'rgba(255,77,77,0.22)');
  glow.addColorStop(1, 'rgba(255,77,77,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Wordmark.
  ctx.fillStyle = '#ff4d4d';
  ctx.beginPath(); ctx.arc(84, 84, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ededed';
  ctx.font = '400 44px "Instrument Serif", Georgia, serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('quiver', 104, 84);

  // Number.
  ctx.fillStyle = '#ffffff';
  ctx.font = '500 250px "Geist Mono", ui-monospace, monospace';
  ctx.textBaseline = 'alphabetic';
  const num = String(Math.round(bpm));
  ctx.fillText(num, 72, 400);
  const numW = ctx.measureText(num).width;