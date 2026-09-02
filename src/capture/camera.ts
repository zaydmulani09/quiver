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