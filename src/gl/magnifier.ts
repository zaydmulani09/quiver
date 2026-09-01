import { FRAG_COLLAPSE, FRAG_COLOR_BAND, FRAG_DISPLAY, FRAG_DOWN, FRAG_IIR, FRAG_LAPLACIAN, FRAG_TO_YIQ, VERT } from './shaders';

export type Mode = 'color' | 'motion';
export type ViewMode = 'magnified' | 'compare' | 'signal' | 'original';

export interface MagnifierParams {
  mode: Mode;
  /** Amplification factor α. */
  alpha: number;
  /** Temporal band, Hz. */
  fLo: number;
  fHi: number;
  /** Chrominance attenuation (1 = amplify colour fully, 0.1 = mostly luminance). */
  chromaAtt: number;
  /** Motion mode: spatial wavelength cutoff λc (px) — controls how much fine detail is amplified. */
  lambdaC: number;
  /** Colour mode: pyramid level to filter. -1 = auto (~32 px on the short side). */
  level: number;
}

export const DEFAULT_PARAMS: MagnifierParams = {
  mode: 'color', alpha: 60, fLo: 0.7, fHi: 2.5, chromaAtt: 1, lambdaC: 16, level: -1,
};

interface Target { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number }
interface Pair { a: WebGLTexture; b: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number }

const MAX_PROCESS_DIM = 640;

/**
 * Real-time Eulerian video magnification on WebGL2.
 *
 *   video ─► YIQ (≤640px) ─► Gaussian pyramid ─► [Laplacian bands]
 *        ─► per-level temporal IIR band-pass (two low-passes, MRT ping-pong)
 *        ─► gain per level (λ-clipped for motion) ─► collapse ─► "diff" texture
 *   display = full-res video + diff   (or compare / signal / original views)
 */
export class Magnifier {
  readonly gl: WebGL2RenderingContext;
  private programs = new Map<string, WebGLProgram>();
  private uniforms = new Map<string, Map<string, WebGLUniformLocation | null>>();
  private vao: WebGLVertexArrayObject;

  private videoTex: WebGLTexture;
  private videoW = 0;
  private videoH = 0;
  private procW = 0;
  private procH = 0;

  private g: Target[] = [];        // Gaussian levels
  private lap: Target[] = [];      // Laplacian levels (motion mode)
  private iir: Pair[][] = [];      // per level: [pingA, pingB] each holding lo1 & lo2
  private iirCur: number[] = [];   // which ping is current per level
  private collapse: Target[] = []; // per level collapse targets (motion)
  private diff: Target | null = null;
  private needsReset = true;

  params: MagnifierParams = { ...DEFAULT_PARAMS };
  view: ViewMode = 'magnified';
  split = 0.5;
  mirror = true;
  signalGain = 4;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    // RGBA16F render targets: covered by either extension (both are near-universal on WebGL2).
    const floatExt = gl.getExtension('EXT_color_buffer_float');
    const halfExt = gl.getExtension('EXT_color_buffer_half_float');
    if (!floatExt && !halfExt) throw new Error('Float render targets are not supported');

    for (const [name, frag] of Object.entries({ toYiq: FRAG_TO_YIQ, down: FRAG_DOWN, lap: FRAG_LAPLACIAN, iir: FRAG_IIR, collapse: FRAG_COLLAPSE, colorBand: FRAG_COLOR_BAND, display: FRAG_DISPLAY })) {
      const { prog, uniforms } = this.link(VERT, frag);
      this.programs.set(name, prog);
      this.uniforms.set(name, uniforms);
    }
    this.vao = gl.createVertexArray()!;
    this.videoTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  }

  get processingSize(): { w: number; h: number } { return { w: this.procW, h: this.procH }; }
  get levels(): number { return this.g.length; }

  setParams(p: Partial<MagnifierParams>): void {
    const prev = this.params;
    this.params = { ...prev, ...p };
    if (p.mode !== undefined && p.mode !== prev.mode) this.needsReset = true;
    if (p.level !== undefined && p.level !== prev.level) this.needsReset = true;
  }

  reset(): void { this.needsReset = true; }

  /** Feed one new video frame. `dt` is the time since the previous frame in seconds. */
  process(video: HTMLVideoElement, dt: number): void {
    const gl = this.gl;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return;
    if (vw !== this.videoW || vh !== this.videoH) this.allocate(vw, vh);

    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video);

    const clampedDt = Math.min(0.25, Math.max(1 / 120, dt));
    const r1 = 1 - Math.exp(-2 * Math.PI * this.params.fHi * clampedDt);
    const r2 = 1 - Math.exp(-2 * Math.PI * this.params.fLo * clampedDt);

    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    // 1. YIQ at processing resolution.
    this.draw('toYiq', this.g[0], () => this.bindTex('u_src', this.videoTex, 0));

    // 2. Gaussian pyramid.
    for (let i = 1; i < this.g.length; i++) {
      const src = this.g[i - 1];
      this.draw('down', this.g[i], (u) => {
        this.bindTex('u_src', src.tex, 0);
        gl.uniform2f(u.get('u_texel')!, 1 / src.w, 1 / src.h);
      });
    }

    const L = this.g.length;
    const reset = this.needsReset ? 1 : 0;
    this.needsReset = false;

    if (this.params.mode === 'color') {
      const k = this.colorLevel();
      this.iirStep(k, this.g[k].tex, r1, r2, reset);
      const gain = this.params.alpha;
      const cur = this.iir[k][this.iirCur[k]];
      this.draw('colorBand', this.diff!, (u) => {
        this.bindTex('u_lo1', cur.a, 0);
        this.bindTex('u_lo2', cur.b, 1);
        gl.uniform2f(u.get('u_size')!, cur.w, cur.h);
        gl.uniform3f(u.get('u_gain')!, gain, gain * this.params.chromaAtt, gain * this.params.chromaAtt);
      });
      return;
    }

    // 3. Laplacian bands.
    for (let i = 0; i < L - 1; i++) {
      this.draw('lap', this.lap[i], () => {
        this.bindTex('u_fine', this.g[i].tex, 0);
        this.bindTex('u_coarse', this.g[i + 1].tex, 1);
      });
    }
    // Coarsest "band" is the residual low-pass.
    // 4. Temporal filtering on the bands we amplify (skip finest & coarsest, as in the paper).
    const gains = this.motionGains();
    for (let i = 1; i < L - 1; i++) this.iirStep(i, this.lap[i].tex, r1, r2, reset);

    // 5. Collapse from coarse to fine, accumulating only the amplified band terms.
    let coarse: Target | null = null;
    for (let i = L - 2; i >= 0; i--) {
      const target = i === 0 ? this.diff! : this.collapse[i];
      const cur = this.iir[i] ? this.iir[i][this.iirCur[i]] : null;
      const gain = gains[i];
      const prevCoarse = coarse;
      this.draw('collapse', target, (u) => {
        gl.uniform1f(u.get('u_hasCoarse')!, prevCoarse ? 1 : 0);
        this.bindTex('u_coarse', prevCoarse ? prevCoarse.tex : this.g[0].tex, 0);
        this.bindTex('u_lo1', cur ? cur.a : this.g[0].tex, 1);