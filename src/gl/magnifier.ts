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