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
        this.bindTex('u_lo2', cur ? cur.b : this.g[0].tex, 2);
        const g = cur ? gain : 0;
        gl.uniform3f(u.get('u_gain')!, g, g * this.params.chromaAtt, g * this.params.chromaAtt);
      });
      coarse = target;
    }
  }

  /** Draw the composite to the canvas. Safe to call every animation frame. */
  render(): void {
    const gl = this.gl;
    if (!this.diff) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); return; }
    const cw = this.canvas.width, ch = this.canvas.height;
    const va = this.videoW / this.videoH, ca = cw / ch;
    let sx = 1, sy = 1;
    if (ca > va) sx = va / ca; else sy = ca / va;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.bindVertexArray(this.vao);
    const prog = this.use('display');
    this.bindTex('u_video', this.videoTex, 0);
    this.bindTex('u_diff', this.diff.tex, 1);
    gl.uniform1i(prog.get('u_view')!, { magnified: 0, compare: 1, signal: 2, original: 3 }[this.view]);
    gl.uniform1f(prog.get('u_split')!, this.split);
    gl.uniform1f(prog.get('u_flip')!, this.mirror ? 1 : 0);
    gl.uniform2f(prog.get('u_scale')!, sx, sy);
    gl.uniform2f(prog.get('u_offset')!, (1 - sx) / 2, (1 - sy) / 2);
    gl.uniform1f(prog.get('u_signalGain')!, this.signalGain);
    gl.uniform2f(prog.get('u_canvas')!, cw, ch);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** The pyramid level used in colour mode. */
  colorLevel(): number {
    if (this.params.level >= 0) return Math.min(this.params.level, this.g.length - 1);
    const short = Math.min(this.procW, this.procH);
    const k = Math.round(Math.log2(short / 32));
    return Math.max(1, Math.min(this.g.length - 1, k));
  }

  /** Per-level amplification for motion mode, clipped by the λ rule from Wu et al. */
  private motionGains(): number[] {
    const L = this.g.length;
    const { alpha, lambdaC } = this.params;
    const gains = new Array<number>(L).fill(0);
    let lambda = Math.sqrt(this.procW * this.procW + this.procH * this.procH) / 3;
    const delta = lambdaC / 8 / (1 + alpha);
    for (let i = L - 1; i >= 0; i--) {
      const cur = (lambda / delta / 8 - 1) * 2;
      gains[i] = i === L - 1 || i === 0 ? 0 : Math.max(0, Math.min(alpha, cur));
      lambda /= 2;
    }
    return gains;
  }

  private iirStep(level: number, x: WebGLTexture, r1: number, r2: number, reset: number): void {
    const gl = this.gl;
    const pair = this.iir[level];
    const curIdx = this.iirCur[level];
    const cur = pair[curIdx];
    const next = pair[1 - curIdx];
    gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo);
    gl.viewport(0, 0, next.w, next.h);
    const u = this.use('iir');
    this.bindTex('u_x', x, 0);
    this.bindTex('u_lo1', cur.a, 1);
    this.bindTex('u_lo2', cur.b, 2);
    gl.uniform1f(u.get('u_r1')!, r1);
    gl.uniform1f(u.get('u_r2')!, r2);
    gl.uniform1f(u.get('u_reset')!, reset);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.iirCur[level] = 1 - curIdx;
  }

  private allocate(vw: number, vh: number): void {
    const gl = this.gl;
    this.dispose(false);
    this.videoW = vw; this.videoH = vh;
    const scale = Math.min(1, MAX_PROCESS_DIM / Math.max(vw, vh));
    this.procW = Math.max(16, Math.round(vw * scale));
    this.procH = Math.max(16, Math.round(vh * scale));

    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, vw, vh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    let w = this.procW, h = this.procH;
    while (Math.min(w, h) >= 8) {
      this.g.push(this.target(w, h));
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
    }
    const L = this.g.length;
    for (let i = 0; i < L; i++) {
      this.lap.push(this.target(this.g[i].w, this.g[i].h));
      this.collapse.push(this.target(this.g[i].w, this.g[i].h));
      this.iir.push([this.pair(this.g[i].w, this.g[i].h), this.pair(this.g[i].w, this.g[i].h)]);
      this.iirCur.push(0);
    }
    this.diff = this.target(this.procW, this.procH);
    this.needsReset = true;
  }

  dispose(all = true): void {
    const gl = this.gl;
    const kill = (t: Target) => { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); };
    this.g.forEach(kill); this.lap.forEach(kill); this.collapse.forEach(kill);
    for (const pr of this.iir) for (const p of pr) { gl.deleteTexture(p.a); gl.deleteTexture(p.b); gl.deleteFramebuffer(p.fbo); }
    if (this.diff) kill(this.diff);
    this.g = []; this.lap = []; this.collapse = []; this.iir = []; this.iirCur = []; this.diff = null;
    if (all) {
      gl.deleteTexture(this.videoTex);
      for (const p of this.programs.values()) gl.deleteProgram(p);
      gl.deleteVertexArray(this.vao);
    }
  }

  // ---- GL plumbing -------------------------------------------------------

  private texture(w: number, h: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private target(w: number, h: number): Target {
    const gl = this.gl;
    const tex = this.texture(w, h);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    this.checkFbo();
    return { tex, fbo, w, h };
  }

  private pair(w: number, h: number): Pair {
    const gl = this.gl;
    const a = this.texture(w, h), b = this.texture(w, h);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, a, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, b, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    this.checkFbo();
    return { a, b, fbo, w, h };
  }

  private checkFbo(): void {
    const gl = this.gl;
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Framebuffer incomplete: 0x' + status.toString(16));
  }

  private draw(name: string, target: Target, setup: (u: Map<string, WebGLUniformLocation | null>) => void): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.w, target.h);
    const u = this.use(name);
    setup(u);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private use(name: string): Map<string, WebGLUniformLocation | null> {
    this.gl.useProgram(this.programs.get(name)!);
    this.current = name;
    return this.uniforms.get(name)!;
  }
  private current = '';

  private bindTex(uniform: string, tex: WebGLTexture, unit: number): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.uniforms.get(this.current)!.get(uniform)!, unit);
  }

  private link(vs: string, fs: string): { prog: WebGLProgram; uniforms: Map<string, WebGLUniformLocation | null> } {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('Shader error: ' + gl.getShaderInfoLog(sh));
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Link error: ' + gl.getProgramInfoLog(prog));
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
    const map = new Map<string, WebGLUniformLocation | null>();
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i)!;
      map.set(info.name, gl.getUniformLocation(prog, info.name));
    }
    return { prog, uniforms: map };
  }
}
