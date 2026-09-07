/** Records the output canvas to a video file via MediaRecorder. Stays on-device. */
export class CanvasRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private timer: number | null = null;
  readonly maxSeconds: number;

  constructor(private canvas: HTMLCanvasElement, maxSeconds = 15) {
    this.maxSeconds = maxSeconds;
  }

  static get supported(): boolean {
    return typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;
  }

  get recording(): boolean { return this.recorder?.state === 'recording'; }
  get elapsed(): number { return this.recording ? (performance.now() - this.startedAt) / 1000 : 0; }

  private pickMime(withAudio: boolean): string {
    const candidates = withAudio
      ? ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      : ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
  }

  start(onAutoStop: () => void, audio: MediaStreamTrack | null = null): void {
    if (this.recording) return;
    const stream = this.canvas.captureStream(30);
    if (audio) stream.addTrack(audio);
    const mimeType = this.pickMime(!!audio);
    this.recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 8_000_000 } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.recorder.start(250);
    this.startedAt = performance.now();
    this.timer = window.setTimeout(() => { if (this.recording) onAutoStop(); }, this.maxSeconds * 1000);
  }

  stop(): Promise<{ blob: Blob; ext: string }> {
    return new Promise((resolve, reject) => {
      const rec = this.recorder;
      if (!rec || rec.state === 'inactive') { reject(new Error('Not recording')); return; }
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      rec.onstop = () => {
        const type = rec.mimeType || 'video/webm';
        const blob = new Blob(this.chunks, { type });
        const ext = type.includes('mp4') ? 'mp4' : 'webm';
        for (const t of rec.stream.getTracks()) t.stop();
        this.recorder = null;
        resolve({ blob, ext });
      };
      rec.stop();
    });
  }
}

/** Save or share a blob. Uses the Web Share API when it can hand the file to another app. */
export async function deliverFile(blob: Blob, filename: string, title: string): Promise<'shared' | 'saved'> {
  const file = new File([blob], filename, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return 'shared';
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return 'shared';
      // fall through to download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'saved';
}
