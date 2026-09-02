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

  private pickMime(): string {
    const candidates = [
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
  }

  start(onAutoStop: () => void): void {
    if (this.recording) return;
    const stream = this.canvas.captureStream(30);
    const mimeType = this.pickMime();