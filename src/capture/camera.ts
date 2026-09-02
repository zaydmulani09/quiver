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
