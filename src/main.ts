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
const hudRec = $('hudRec');
const recTime = $('recTime');
const hudHint = $('hudHint');
const hudFps = $('hudFps');
const toastEl = $('toast');
const alphaInput = $<HTMLInputElement>('alpha');
const alphaOut = $<HTMLOutputElement>('alphaOut');
const flipBtn = $<HTMLButtonElement>('flip');
const snapBtn = $<HTMLButtonElement>('snap');
const recordBtn = $<HTMLButtonElement>('record');
const stopBtn = $<HTMLButtonElement>('stop');
const customPanel = $('custom');
const bpmEl = $('bpm');
const heartEl = $('heart');
const waveCanvas = $<HTMLCanvasElement>('wave');
const confBar = $('confBar');
const statusEl = $('status');
const shareCardBtn = $<HTMLButtonElement>('shareCard');
const tipsEl = $('tips');
const vitalsTitle = $('vitalsTitle');
const vitalsSub = $('vitalsSub');

let magnifier: Magnifier | null = null;
let state: AppState = 'idle';
let mode: ModeName = 'pulse';
let view: ViewMode = 'magnified';
const source = new VideoSource(video);
const sampler = new SkinSampler(48);
const estimator = new HeartRateEstimator({ fs: 30, windowSeconds: 10, displaySeconds: 6 });
const waveform = new Waveform(waveCanvas);
const recorder = new CanvasRecorder(canvas, 15);
let roi: Roi = SkinSampler.defaultRoi(640, 480);
let lastReading: HeartRateReading | null = null;
let coverage = 0;
let fps = 0;
let lastFrameTime = -1;
let lastUpdate = 0;
let rvfcHandle = 0;
let usingRvfc = false;
let toastTimer = 0;

// ---------- boot -------------------------------------------------------------

function boot(): void {
  try {
    magnifier = new Magnifier(canvas);
  } catch (err) {
    showHeroError(`This browser can't run quiver: ${(err as Error).message}. Try a recent Chrome, Edge, Firefox or Safari.`);
    startBtn.disabled = true;
    uploadBtn.disabled = true;
    return;
  }
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); toast('Graphics context lost — restarting'); });
  canvas.addEventListener('webglcontextrestored', () => { magnifier = new Magnifier(canvas); applyMode(mode); applyView(view); });

  if (!VideoSource.supported) {
    startBtn.disabled = true;
    showHeroError('Camera access is not available here (this needs HTTPS or localhost). You can still load a video file.');
  }

  const params = new URLSearchParams(location.search);
  const m = params.get('mode');
  if (m && m in PRESETS) mode = m as ModeName;
  applyMode(mode);
  applyView('magnified');
  bindUi();
  sizeCanvas();
  requestAnimationFrame(tick);

  if (import.meta.env.DEV) {
    (window as unknown as { __quiver: unknown }).__quiver = { estimator, sampler, get magnifier() { return magnifier; }, get reading() { return lastReading; }, get coverage() { return coverage; }, get fps() { return fps; } };
    if (params.has('synthetic')) startSynthetic(Number(params.get('synthetic')) || 72);
  }
}

/** Dev-only: a canvas-generated "camera" with a known pulse so the pipeline can be tested headless. */
async function startSynthetic(bpm: number): Promise<void> {
  if (!magnifier) return;
  const { createSyntheticStream } = await import('./dev/synthetic');
  const { stream } = createSyntheticStream({ bpm });
  setState('starting');
  await source.startStream(stream, 'synthetic');
  magnifier.mirror = false;
  flipBtn.hidden = true;
  onSourceReady();
  setState('live');
  // Occluded windows throttle rAF/rVFC to a few Hz; drive the pipeline from a timer instead.
  cancelFrame();
  usingRvfc = true; // keep the rAF pump out of the way
  window.setInterval(() => {
    if (state !== 'live') return;
    if (video.currentTime !== lastPolledTime) { lastPolledTime = video.currentTime; processFrame(video.currentTime); }
    magnifier?.render();
    if (performance.now() - lastUpdate > 150) { lastUpdate = performance.now(); updateVitals(); }
    waveform.draw();
  }, 1000 / 60);
}

// ---------- UI wiring --------------------------------------------------------

function bindUi(): void {
  startBtn.addEventListener('click', () => startCamera());
  uploadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) startFile(f);
    fileInput.value = '';
  });
  stopBtn.addEventListener('click', stopAll);
  flipBtn.addEventListener('click', async () => {
    try {
      const info = await source.flip();
      if (magnifier) magnifier.mirror = info.facing === 'user';
      resetSignal();
      onSourceReady();
    } catch (err) { toast(describeCameraError(err)); }
  });

  for (const chip of document.querySelectorAll<HTMLButtonElement>('.chip[data-mode]')) {
    chip.addEventListener('click', () => applyMode(chip.dataset.mode as ModeName));
  }
  for (const seg of document.querySelectorAll<HTMLButtonElement>('.seg[data-view]')) {
    seg.addEventListener('click', () => applyView(seg.dataset.view as ViewMode));
  }
  for (const seg of document.querySelectorAll<HTMLButtonElement>('.seg[data-kind]')) {
    seg.addEventListener('click', () => {
      for (const s of document.querySelectorAll<HTMLButtonElement>('.seg[data-kind]')) s.setAttribute('aria-pressed', String(s === seg));
      magnifier?.setParams({ mode: seg.dataset.kind as 'color' | 'motion' });
      syncAlphaRange();
    });
  }

  alphaInput.addEventListener('input', () => {
    const a = Number(alphaInput.value);
    magnifier?.setParams({ alpha: a });
    alphaOut.value = `×${a}`;
    paintRange(alphaInput);
  });

  bindCustom('fLo', 'fLoOut', (v) => `${v.toFixed(2)} Hz`, (v) => ({ fLo: Math.min(v, (magnifier?.params.fHi ?? 10) - 0.05) }));
  bindCustom('fHi', 'fHiOut', (v) => `${v.toFixed(1)} Hz`, (v) => ({ fHi: Math.max(v, (magnifier?.params.fLo ?? 0) + 0.05) }));
  bindCustom('chroma', 'chromaOut', (v) => v.toFixed(2), (v) => ({ chromaAtt: v }));
  bindCustom('level', 'levelOut', (v) => (v < 0 ? 'auto' : `L${v}`), (v) => ({ level: v }));
  bindCustom('lambda', 'lambdaOut', (v) => `${v} px`, (v) => ({ lambdaC: v }));

  recordBtn.addEventListener('click', toggleRecord);
  snapBtn.addEventListener('click', snapshot);
  shareCardBtn.addEventListener('click', shareCard);

  // Compare slider: drag anywhere on the stage.
  let dragging = false;
  const setSplit = (clientX: number) => {
    const r = stage.getBoundingClientRect();
    const x = Math.min(0.98, Math.max(0.02, (clientX - r.left) / r.width));
    if (magnifier) magnifier.split = x;
    splitHandle.style.left = `${x * 100}%`;
  };
  stage.addEventListener('pointerdown', (e) => {
    if (view !== 'compare' || state !== 'live') return;
    dragging = true;
    stage.setPointerCapture(e.pointerId);
    setSplit(e.clientX);
  });
  stage.addEventListener('pointermove', (e) => { if (dragging) setSplit(e.clientX); });
  stage.addEventListener('pointerup', () => { dragging = false; });
  stage.addEventListener('pointercancel', () => { dragging = false; });

  // Drag & drop a video onto the stage.
  stage.addEventListener('dragover', (e) => { e.preventDefault(); });
  stage.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f && f.type.startsWith('video/')) startFile(f); else if (f) toast('Drop a video file');
  });

  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case '1': applyMode('pulse'); break;
      case '2': applyMode('breath'); break;
      case '3': applyMode('vibration'); break;
      case '4': applyMode('custom'); break;
      case 'v': case 'V': applyView(view === 'magnified' ? 'compare' : view === 'compare' ? 'signal' : 'magnified'); break;
      case 'r': case 'R': if (state === 'live') toggleRecord(); break;
      case 's': case 'S': if (state === 'live') snapshot(); break;
      case 'f': case 'F': if (state === 'live' && !flipBtn.hidden) flipBtn.click(); break;
      case 'Escape': if (state === 'live') stopAll(); break;
      case ' ': if (state === 'idle' && !startBtn.disabled) { e.preventDefault(); startCamera(); } break;
      default: return;
    }
  });

  window.addEventListener('resize', () => { sizeCanvas(); waveform.resize(); });
  new ResizeObserver(() => sizeCanvas()).observe(stage);
  document.addEventListener('visibilitychange', () => { if (document.hidden) lastFrameTime = -1; });
  window.addEventListener('pagehide', () => { if (recorder.recording) recorder.stop().catch(() => {}); });
}

function bindCustom(id: string, outId: string, fmt: (v: number) => string, toParams: (v: number) => Partial<MagnifierParams>): void {
  const input = $<HTMLInputElement>(id);
  const out = $<HTMLOutputElement>(outId);
  const apply = () => {
    const v = Number(input.value);
    magnifier?.setParams(toParams(v));
    out.value = fmt(v);
    paintRange(input);
  };
  input.addEventListener('input', apply);
  paintRange(input);
}

function paintRange(input: HTMLInputElement): void {
  const min = Number(input.min), max = Number(input.max), v = Number(input.value);
  input.style.setProperty('--fill', `${((v - min) / (max - min)) * 100}%`);
}

// ---------- modes & views ----------------------------------------------------

function applyMode(next: ModeName): void {
  mode = next;
  const preset = PRESETS[mode];
  app.dataset.mode = mode;
  for (const chip of document.querySelectorAll<HTMLButtonElement>('.chip[data-mode]')) chip.setAttribute('aria-selected', String(chip.dataset.mode === mode));
  customPanel.hidden = mode !== 'custom';
  hudHint.textContent = preset.hint;
  tipsEl.innerHTML = preset.tips;
  vitalsTitle.textContent = preset.title;
  vitalsSub.textContent = preset.sub;
  if (magnifier) {
    magnifier.setParams(preset.params);
    magnifier.reset();
  }
  syncAlphaRange();
  syncCustomInputs();
  resetSignal();
  waveform.color = getComputedStyle(app).getPropertyValue('--accent').trim() || '#ff4d4d';
  const url = new URL(location.href);
  if (mode === 'pulse') url.searchParams.delete('mode'); else url.searchParams.set('mode', mode);
  history.replaceState(null, '', url.pathname + (url.search || ''));
}

function syncAlphaRange(): void {
  const preset = PRESETS[mode];
  const p = magnifier?.params ?? DEFAULT_PARAMS;
  const max = mode === 'custom' ? (p.mode === 'motion' ? 60 : 150) : preset.alphaMax;
  alphaInput.max = String(max);
  alphaInput.value = String(Math.min(p.alpha, max));
  alphaOut.value = `×${alphaInput.value}`;
  paintRange(alphaInput);
}

function syncCustomInputs(): void {
  const p = magnifier?.params ?? DEFAULT_PARAMS;
  const set = (id: string, v: number) => { const el = $<HTMLInputElement>(id); el.value = String(v); el.dispatchEvent(new Event('input')); };
  for (const s of document.querySelectorAll<HTMLButtonElement>('.seg[data-kind]')) s.setAttribute('aria-pressed', String(s.dataset.kind === p.mode));
  set('fLo', p.fLo); set('fHi', p.fHi); set('chroma', p.chromaAtt); set('level', p.level); set('lambda', p.lambdaC);
}

function applyView(next: ViewMode): void {
  view = next;
  app.dataset.view = view;
  if (magnifier) magnifier.view = view;
  for (const seg of document.querySelectorAll<HTMLButtonElement>('.seg[data-view]')) seg.setAttribute('aria-pressed', String(seg.dataset.view === view));
  if (view === 'compare') {
    splitHandle.classList.add('labels');
    splitHandle.style.left = `${(magnifier?.split ?? 0.5) * 100}%`;
  }
}

// ---------- sources ----------------------------------------------------------

async function startCamera(): Promise<void> {
  if (state !== 'idle' || !magnifier) return;
  setState('starting');
  heroErr.hidden = true;
  try {
    const info = await source.startCamera('user');
    magnifier.mirror = info.facing === 'user';
    flipBtn.hidden = !info.canFlip;
    onSourceReady();
    setState('live');
    stage.focus({ preventScroll: true });
  } catch (err) {
    setState('idle');
    showHeroError(describeCameraError(err));
  }
}

async function startFile(file: File): Promise<void> {
  if (!magnifier) return;
  setState('starting');
  heroErr.hidden = true;
  try {
    await source.loadFile(file);
    magnifier.mirror = false;
    flipBtn.hidden = true;
    onSourceReady();
    setState('live');
    toast(`Playing ${file.name} on loop`);
  } catch (err) {
    setState('idle');
    showHeroError((err as Error).message || 'Could not play that file.');
  }
}

function onSourceReady(): void {
  const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
  stage.style.setProperty('--stage-ar', `${vw} / ${vh}`);
  roi = SkinSampler.defaultRoi(vw, vh);
  guide.style.setProperty('--guide-w', `${roi.rx * 200}%`);
  guide.style.setProperty('--guide-h', `${roi.ry * 200}%`);
  guide.style.top = `${roi.cy * 100}%`;
  sizeCanvas();
  resetSignal();
  lastFrameTime = -1;
  magnifier?.reset();
  scheduleFrame();
}

function stopAll(): void {
  if (recorder.recording) recorder.stop().catch(() => {});
  cancelFrame();
  source.stop();
  setState('idle');
  resetSignal();
  hudFps.textContent = '';
}

function setState(next: AppState): void {
  state = next;
  app.dataset.state = state;
  startBtn.disabled = state === 'starting' || !VideoSource.supported;
  startBtn.textContent = state === 'starting' ? 'Starting…' : 'Start camera';
  if (state !== 'live') { recordBtn.classList.remove('on'); hudRec.hidden = true; }
}

function resetSignal(): void {
  estimator.reset();
  lastReading = null;
  coverage = 0;
  waveform.clear();
  bpmEl.textContent = '--';
  bpmEl.classList.add('locking');
  confBar.style.width = '0%';
  shareCardBtn.disabled = true;
  guide.classList.remove('locked', 'faded');
  statusEl.textContent = state === 'live' ? (mode === 'pulse' ? 'Looking for skin in the oval…' : 'Keep the camera still.') : 'Start the camera to begin.';
}

// ---------- frame loop -------------------------------------------------------

function scheduleFrame(): void {
  cancelFrame();
  const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number };
  if (typeof v.requestVideoFrameCallback === 'function') {
    usingRvfc = true;
    rvfcHandle = v.requestVideoFrameCallback(onVideoFrame);
  } else {
    usingRvfc = false;
  }
}

function cancelFrame(): void {
  const v = video as HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void };
  if (usingRvfc && rvfcHandle && typeof v.cancelVideoFrameCallback === 'function') v.cancelVideoFrameCallback(rvfcHandle);
  rvfcHandle = 0;
}

function onVideoFrame(_now: number, meta: { mediaTime: number }): void {
  if (state !== 'live') return;
  processFrame(meta.mediaTime);
  rvfcHandle = (video as HTMLVideoElement & { requestVideoFrameCallback: (cb: (n: number, m: { mediaTime: number }) => void) => number }).requestVideoFrameCallback(onVideoFrame);
}

let lastPolledTime = -1;
function processFrame(mediaTime: number): void {
  if (!magnifier || video.readyState < 2) return;
  const dt = lastFrameTime < 0 ? 1 / 30 : mediaTime - lastFrameTime;
  if (dt <= 0) return;
  lastFrameTime = mediaTime;
  fps += ((1 / Math.max(dt, 1 / 120)) - fps) * 0.1;

  magnifier.process(video, dt);

  if (mode === 'pulse') {
    const s = sampler.sample(video, roi);
    if (s) {
      coverage += (s.coverage - coverage) * 0.2;
      if (s.coverage > 0.12) estimator.push(mediaTime, s.r, s.g, s.b);
    }
  }
}

function tick(now: number): void {
  requestAnimationFrame(tick);
  if (state === 'live') {
    // Fallback frame pump for browsers without requestVideoFrameCallback.
    if (!usingRvfc && video.currentTime !== lastPolledTime) {
      lastPolledTime = video.currentTime;
      processFrame(video.currentTime);
    }
    magnifier?.render();
    if (now - lastUpdate > 150) {
      lastUpdate = now;
      updateVitals();
      const { w, h } = magnifier?.processingSize ?? { w: 0, h: 0 };
      hudFps.textContent = fps > 0 ? `${fps.toFixed(0)} fps · ${w}×${h}` : '';