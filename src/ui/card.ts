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
  ctx.fillStyle = '#8a8a93';
  ctx.font = '400 56px "Geist", system-ui, sans-serif';
  ctx.fillText('bpm', 72 + numW + 28, 400);

  // Caption.
  ctx.fillStyle = '#ededed';
  ctx.font = 'italic 400 46px "Instrument Serif", Georgia, serif';
  ctx.fillText('my heartbeat, measured by a webcam.', 72, 470);
  ctx.fillStyle = '#8a8a93';
  ctx.font = '400 26px "Geist", system-ui, sans-serif';
  ctx.fillText('No contact. No upload. Eulerian video magnification + rPPG, in the browser.', 72, 515);
  ctx.fillStyle = '#ff4d4d';
  ctx.font = '500 26px "Geist Mono", ui-monospace, monospace';
  ctx.fillText(siteUrl, 72, 566);

  // Pulse trace.
  const n = waveform.length;
  const x0 = 760, x1 = 1140, yMid = 300, amp = 70;
  if (n > 1) {
    ctx.strokeStyle = 'rgba(255,77,77,0.28)';
    ctx.lineWidth = 12; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const path = new Path2D();
    for (let i = 0; i < n; i++) {
      const x = x0 + (i / (n - 1)) * (x1 - x0);
      const y = yMid - Math.max(-1.6, Math.min(1.6, waveform[i])) * amp;
      if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
    }
    ctx.stroke(path);
    ctx.strokeStyle = '#ff4d4d';
    ctx.lineWidth = 3.5;
    ctx.stroke(path);
    ctx.fillStyle = '#ff4d4d';
    ctx.beginPath();
    ctx.arc(x1, yMid - Math.max(-1.6, Math.min(1.6, waveform[n - 1])) * amp, 7, 0, Math.PI * 2);
    ctx.fill();
  }

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
}
