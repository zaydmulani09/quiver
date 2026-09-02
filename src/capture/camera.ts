export type Facing = 'user' | 'environment';

export interface SourceInfo {
  kind: 'camera' | 'file';
  facing: Facing;
  label: string;
  canFlip: boolean;
}

/**
 * Owns the <video> element and whatever is feeding it: a camera stream or a local file.
 * Nothing here ever leaves the device — the video element is the only consumer.
 */
export class VideoSource {
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private objectUrl: string | null = null;
  private facing: Facing = 'user';
  private info: SourceInfo | null = null;

  constructor(video: HTMLVideoElement) {
    this.video = video;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.setAttribute('playsinline', '');
  }

  get current(): SourceInfo | null { return this.info; }

  static get supported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  async startCamera(facing: Facing = this.facing): Promise<SourceInfo> {
    this.stop();
    const constraints: MediaStreamConstraints = {
      audio: false,
      video: {
        facingMode: facing,
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 60 },
      },
    };
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      // Some desktop cameras reject facingMode outright; retry without it.
      if ((err as DOMException).name === 'OverconstrainedError') {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
      } else throw err;
    }
    this.stream = stream;
    this.facing = facing;
    this.video.srcObject = stream;
    await this.ready();
    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings();
    const actualFacing = (settings.facingMode as Facing | undefined) ?? facing;
    let canFlip = false;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      canFlip = devices.filter((d) => d.kind === 'videoinput').length > 1;
    } catch { /* enumeration unavailable — flipping stays disabled */ }
    this.info = { kind: 'camera', facing: actualFacing, label: track.label || 'Camera', canFlip };
    return this.info;
  }

  /** Feed an arbitrary MediaStream (used by the dev-only synthetic camera). */
  async startStream(stream: MediaStream, label: string): Promise<SourceInfo> {
    this.stop();
    this.stream = stream;
    this.video.srcObject = stream;
    await this.ready();
    this.info = { kind: 'camera', facing: 'environment', label, canFlip: false };
    return this.info;
  }

  async flip(): Promise<SourceInfo> {
    return this.startCamera(this.facing === 'user' ? 'environment' : 'user');
  }

  async loadFile(file: File): Promise<SourceInfo> {
    this.stop();
    this.objectUrl = URL.createObjectURL(file);
    this.video.srcObject = null;
    this.video.loop = true;
    this.video.src = this.objectUrl;
    await this.ready();
    this.info = { kind: 'file', facing: 'environment', label: file.name, canFlip: false };
    return this.info;
  }

  stop(): void {
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.video.srcObject = null;
    this.video.removeAttribute('src');
    this.video.loop = false;
    this.info = null;
  }

  private ready(): Promise<void> {
    const v = this.video;
    return new Promise((resolve, reject) => {
      const onMeta = () => {
        cleanup();
        v.play().then(resolve).catch(reject);
      };
      const onErr = () => { cleanup(); reject(new Error('Could not decode that video')); };
      const cleanup = () => { v.removeEventListener('loadedmetadata', onMeta); v.removeEventListener('error', onErr); };
      v.addEventListener('loadedmetadata', onMeta, { once: true });
      v.addEventListener('error', onErr, { once: true });
      if (v.readyState >= 1) onMeta();
    });
  }
}
