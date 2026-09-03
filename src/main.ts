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