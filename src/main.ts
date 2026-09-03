import { DEFAULT_PARAMS, Magnifier, type MagnifierParams, type ViewMode } from './gl/magnifier';
import { VideoSource } from './capture/camera';
import { CanvasRecorder, deliverFile } from './capture/recorder';
import { SkinSampler, type Roi } from './capture/skin';
import { HeartRateEstimator, type HeartRateReading } from './dsp/heartrate';
import { Waveform } from './ui/waveform';
import { renderShareCard } from './ui/card';

type ModeName = 'pulse' | 'breath' | 'vibration' | 'custom';
type AppState = 'idle' | 'starting' | 'live';

interface Preset {
  params: Partial<MagnifierParams>;
  alphaMax: number;
  hint: string;
  title: string;
  sub: string;
  tips: string;
}

const PRESETS: Record<ModeName, Preset> = {
  pulse: {
    params: { mode: 'color', alpha: 60, fLo: 0.7, fHi: 2.5, chromaAtt: 1, level: -1, lambdaC: 16 },
    alphaMax: 150,
    hint: 'face in the oval · hold still · even light',
    title: 'Heart rate',
    sub: 'from skin colour, no contact',
    tips: '<p><strong>Pulse</strong> amplifies colour at 0.7–2.5 Hz — the band a heartbeat lives in. Put your face in the oval, keep still, and give it eight seconds. Watch the flush sweep across your forehead and cheeks with every beat.</p><p>Try <strong>Signal</strong> view to see the blood-flow wave on its own.</p>',
  },
  breath: {
    params: { mode: 'motion', alpha: 20, fLo: 0.15, fHi: 0.8, chromaAtt: 0.1, lambdaC: 40, level: -1 },
    alphaMax: 60,
    hint: 'prop the camera up · it must not move',
    title: 'Breathing',
    sub: '0.15–0.8 Hz · 9–48 breaths / min',
    tips: '<p><strong>Breathing</strong> amplifies motion between 0.15 and 0.8 Hz. Point a <em>stationary</em> camera at a chest, a sleeping pet, or a baby from across the room. Any camera shake is amplified too — set the phone down.</p>',
  },
  vibration: {
    params: { mode: 'motion', alpha: 20, fLo: 2, fHi: 8, chromaAtt: 0.1, lambdaC: 20, level: -1 },
    alphaMax: 60,
    hint: 'prop the camera up · point at something humming',
    title: 'Vibration',
    sub: '2–8 Hz · machines, strings, structures',
    tips: '<p><strong>Vibration</strong> amplifies motion between 2 and 8 Hz. Point a still camera at a washing machine, a speaker cone, a guitar string, a table with a laptop on it, or a railing on a bridge.</p><p>At 30 fps anything above ~14 Hz aliases, so very fast vibration shows up at a lower frequency — still visible, just not to scale.</p>',
  },
  custom: {
    params: { ...DEFAULT_PARAMS },
    alphaMax: 150,
    hint: 'tune the band · you are the scientist',
    title: 'Custom',
    sub: 'every parameter exposed',
    tips: '<p><strong>Custom</strong> exposes the whole pipeline. <em>Colour</em> filters one blurred pyramid level and adds the band back (the original paper\'s Gaussian method). <em>Motion</em> filters every Laplacian level, clipping the gain per level by the spatial wavelength λc.</p>',
  },
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const app = $('app');
const stage = $('stage');
const video = $<HTMLVideoElement>('video');
const canvas = $<HTMLCanvasElement>('out');
const guide = $('guide');
const splitHandle = $('splitHandle');
const hero = $('hero');
const heroErr = $('heroErr');
const startBtn = $<HTMLButtonElement>('start');
const uploadBtn = $<HTMLButtonElement>('upload');
const fileInput = $<HTMLInputElement>('file');