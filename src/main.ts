import { DEFAULT_PARAMS, Magnifier, type MagnifierParams, type ViewMode } from './gl/magnifier';
import { VideoSource } from './capture/camera';
import { CanvasRecorder, deliverFile } from './capture/recorder';
import { SkinSampler, type Roi } from './capture/skin';
import { HeartRateEstimator, type HeartRateReading } from './dsp/heartrate';
import { Waveform } from './ui/waveform';
import { renderShareCard } from './ui/card';
import { Overlay } from './ui/overlay';
import { Heartbeat } from './ui/heartbeat';

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

const SITE = 'quivercam.vercel.app';
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
const soundBtn = $<HTMLButtonElement>('sound');
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
const bpmRow = $('bpmRow');
const energyRow = $('energyRow');
const energyBar = $('energyBar');
const energyOut = $('energyOut');
const toolbar = $('toolbar');

let magnifier: Magnifier | null = null;
let state: AppState = 'idle';
let mode: ModeName = 'pulse';
let view: ViewMode = 'magnified';
const source = new VideoSource(video);
const sampler = new SkinSampler(48);
const estimator = new HeartRateEstimator({ fs: 30, windowSeconds: 10, displaySeconds: 6 });
const waveform = new Waveform(waveCanvas);
const overlay = new Overlay();
const heartbeat = new Heartbeat();
let displayedBpm: number | null = null;
let countUpFrom = 0;
let countUpStart = 0;
const recorder = new CanvasRecorder(overlay.canvas, 15);
let roi: Roi = SkinSampler.defaultRoi(640, 480);
let lastReading: HeartRateReading | null = null;
let coverage = 0;
let usingFallbackRoi = false;
const energyHistory = new Float64Array(180); // ~6 s at the vitals update rate
let energyIdx = 0;
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
    (window as unknown as { __quiver: unknown }).__quiver = { estimator, sampler, overlay, overlayState, get magnifier() { return magnifier; }, get reading() { return lastReading; }, get coverage() { return coverage; }, get fps() { return fps; } };
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
    if (recorder.recording) overlay.draw(canvas, overlayState());
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
  soundBtn.addEventListener('click', toggleSound);
  if (!Heartbeat.supported) soundBtn.hidden = true;
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
      case 'm': case 'M': if (state === 'live') toggleSound(); break;
      case 'Escape': if (state === 'live') stopAll(); break;
      case ' ': if (state === 'idle' && !startBtn.disabled) { e.preventDefault(); startCamera(); } break;
      default: return;
    }
  });

  window.addEventListener('resize', () => { sizeCanvas(); layoutGuide(); waveform.resize(); });
  new ResizeObserver(() => { sizeCanvas(); layoutGuide(); }).observe(stage);
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
  bpmRow.hidden = mode !== 'pulse';
  shareCardBtn.hidden = mode !== 'pulse';
  energyRow.hidden = mode === 'pulse';
  energyIdx = 0;
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
  stage.classList.toggle('portrait', vh > vw);
  roi = SkinSampler.defaultRoi(vw, vh);
  sizeCanvas();
  layoutGuide();
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
  startBtn.lastChild!.textContent = state === 'starting' ? ' Starting…' : ' Start camera';
  hero.inert = state === 'live';
  toolbar.inert = state !== 'live';
  customPanel.inert = state !== 'live';
  if (state !== 'live') { recordBtn.classList.remove('on'); hudRec.hidden = true; }
}

function resetSignal(): void {
  estimator.reset();
  lastReading = null;
  displayedBpm = null;
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
      // The skin box misses some complexions and lighting; fall back to the whole oval, and let the
      // spectral SNR gate decide whether there is a pulse in it.
      usingFallbackRoi = s.coverage <= 0.12;
      if (usingFallbackRoi) estimator.push(mediaTime, s.all.r, s.all.g, s.all.b);
      else estimator.push(mediaTime, s.r, s.g, s.b);
    }
  }
}

function paintBpm(now: number): void {
  if (displayedBpm === null) return;
  const k = Math.min(1, (now - countUpStart) / 700);
  const eased = 1 - Math.pow(1 - k, 3);
  bpmEl.textContent = String(Math.round(countUpFrom + (displayedBpm - countUpFrom) * eased));
}

async function toggleSound(): Promise<void> {
  if (heartbeat.enabled) {
    heartbeat.disable();
    soundBtn.classList.remove('on');
    soundBtn.setAttribute('aria-pressed', 'false');
    toast('Heartbeat sound off');
    return;
  }
  try {
    await heartbeat.enable();
    soundBtn.classList.add('on');
    soundBtn.setAttribute('aria-pressed', 'true');
    toast(mode === 'pulse' ? 'You will hear each beat as it is detected' : 'Sound plays in Pulse mode');
  } catch (err) { toast(`Sound unavailable: ${(err as Error).message}`); }
}

function tick(now: number): void {
  requestAnimationFrame(tick);
  paintBpm(now);
  if (state === 'live') {
    // Fallback frame pump for browsers without requestVideoFrameCallback.
    if (!usingRvfc && video.currentTime !== lastPolledTime) {
      lastPolledTime = video.currentTime;
      processFrame(video.currentTime);
    }
    magnifier?.render();
    if (recorder.recording) overlay.draw(canvas, overlayState());
    if (now - lastUpdate > 150) {
      lastUpdate = now;
      updateVitals();
      const { w, h } = magnifier?.processingSize ?? { w: 0, h: 0 };
      hudFps.textContent = fps > 0 ? `${fps.toFixed(0)} fps · ${w}×${h}` : '';
      if (recorder.recording) recTime.textContent = `${recorder.elapsed.toFixed(1)}s`;
    }
  }
  waveform.draw();
}

function updateVitals(): void {
  if (mode !== 'pulse') {
    const e = magnifier?.energy() ?? { mean: 0, peak: 0 };
    if (view === 'signal' && magnifier) {
      const target = Math.max(1, Math.min(30, 0.9 / Math.max(e.peak / 4, 0.03)));
      magnifier.signalGain += (target - magnifier.signalGain) * 0.2;
    }
    const level = Math.min(1, Math.max(e.mean * 8, e.peak * 0.8));
    energyHistory[energyIdx % energyHistory.length] = level;
    energyIdx++;
    const ordered = new Float64Array(Math.min(energyIdx, energyHistory.length));
    for (let i = 0; i < ordered.length; i++) ordered[i] = energyHistory[(energyIdx - ordered.length + i) % energyHistory.length] * 2.4 - 1.2;
    waveform.set(ordered);
    energyBar.style.width = `${Math.round(level * 100)}%`;
    energyOut.textContent = level < 0.05 ? 'still' : level < 0.35 ? 'subtle' : level < 0.7 ? 'strong' : 'saturated';
    statusEl.textContent = level >= 0.7
      ? 'A lot of motion in band — usually the camera moving. Set it down, or lower Amplify.'
      : level >= 0.05
        ? 'Amplifying motion in band. Keep the camera perfectly still.'
        : 'Nothing moving in this band yet. Point at a chest, a pet, a machine — and hold the camera still.';
    return;
  }
  if (view === 'signal' && magnifier) {
    const e = magnifier.energy();
    const target = Math.max(1, Math.min(30, 0.9 / Math.max(e.peak / 4, 0.03)));
    magnifier.signalGain += (target - magnifier.signalGain) * 0.2;
  }
  const r = estimator.update();
  lastReading = r;
  if (r.waveform.length) waveform.set(r.waveform);
  confBar.style.width = `${Math.round(r.confidence * 100)}%`;
  if (r.beat) {
    heartbeat.beat();
    waveform.beat();
    heartEl.classList.add('pop');
    bpmEl.classList.add('pop');
    setTimeout(() => { heartEl.classList.remove('pop'); bpmEl.classList.remove('pop'); }, 140);
  }
  // Once the pulse is locked, narrow the magnifier's temporal band around it so the visible
  // flush gets cleaner (less in-band noise) the longer you hold still.
  if (magnifier) {
    const base = PRESETS.pulse.params;
    if (r.bpm !== null && r.confidence >= 0.5) {
      const f = r.bpm / 60;
      magnifier.setParams({ fLo: Math.max(base.fLo!, f - 0.35), fHi: Math.min(base.fHi!, f + 0.35) });
    } else {
      magnifier.setParams({ fLo: base.fLo!, fHi: base.fHi! });
    }
  }
  if (r.bpm !== null) {
    if (displayedBpm === null) { countUpFrom = Math.max(30, r.bpm - 28); countUpStart = performance.now(); }
    displayedBpm = r.bpm;
    bpmEl.classList.toggle('locking', r.confidence < 0.4);
    if (usingFallbackRoi) guide.classList.remove('locked', 'faded');
    shareCardBtn.disabled = r.confidence < 0.4;
    guide.classList.toggle('locked', r.confidence >= 0.4);
    guide.classList.toggle('faded', r.confidence >= 0.4);
    statusEl.textContent = r.confidence >= 0.7 ? 'Locked. That is your pulse.' : r.confidence >= 0.4 ? 'Locked — hold still to sharpen it.' : 'Locking on… hold still.';
  } else {
    displayedBpm = null;
    bpmEl.textContent = '--';
    bpmEl.classList.add('locking');
    shareCardBtn.disabled = true;
    guide.classList.remove('locked', 'faded');
    const secs = Math.max(0, 8 - r.seconds);
    statusEl.textContent = usingFallbackRoi && r.seconds >= 4
      ? 'No skin found in the oval. Move your face into it, add light, or move closer.'
      : r.seconds < 8 ? `Reading… ${secs.toFixed(0)}s. Hold still, face the light.` : 'Weak signal. Move closer, add light, hold still.';
  }
}

// ---------- sharing ----------------------------------------------------------

async function toggleRecord(): Promise<void> {
  if (!CanvasRecorder.supported) { toast('Recording is not supported in this browser'); return; }
  if (recorder.recording) {
    recordBtn.classList.remove('on');
    hudRec.hidden = true;
    try {
      const { blob, ext } = await recorder.stop();
      const result = await deliverFile(blob, `quiver-${mode}-${stamp()}.${ext}`, 'quiver clip');
      toast(result === 'shared' ? 'Clip shared' : 'Clip saved to your downloads');
    } catch (err) { toast(`Could not save the clip: ${(err as Error).message}`); }
    return;
  }
  overlay.draw(canvas, overlayState());
  recorder.start(() => { toggleRecord(); });
  recordBtn.classList.add('on');
  hudRec.hidden = false;
  recTime.textContent = '0.0s';
}

function overlayState() {
  return {
    bpm: mode === 'pulse' && lastReading ? lastReading.bpm : null,
    confidence: lastReading?.confidence ?? 0,
    waveform: lastReading?.waveform ?? new Float64Array(0),
    modeLabel: mode === 'breath' ? 'breathing' : mode,
    alpha: magnifier?.params.alpha ?? 0,
    accent: getComputedStyle(app).getPropertyValue('--accent').trim() || '#ff4d4d',
    site: SITE,
  };
}

function snapshot(): void {
  magnifier?.render();
  overlay.draw(canvas, overlayState());
  overlay.canvas.toBlob(async (blob) => {
    if (!blob) { toast('Snapshot failed'); return; }
    const result = await deliverFile(blob, `quiver-${mode}-${stamp()}.png`, 'quiver snapshot');
    toast(result === 'shared' ? 'Snapshot shared' : 'Snapshot saved');
  }, 'image/png');
}

async function shareCard(): Promise<void> {
  if (!lastReading || lastReading.bpm === null) return;
  try {
    const blob = await renderShareCard(lastReading.bpm, lastReading.waveform, SITE);
    const result = await deliverFile(blob, `my-heart-rate-${Math.round(lastReading.bpm)}bpm.png`, `${Math.round(lastReading.bpm)} bpm, measured by a webcam`);
    toast(result === 'shared' ? 'Card shared' : 'Card saved to your downloads');
  } catch (err) { toast(`Could not make the card: ${(err as Error).message}`); }
}

// ---------- helpers ----------------------------------------------------------

/** Place the face oval over the video's rendered rectangle (which may be letterboxed inside the stage). */
function layoutGuide(): void {
  const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
  const rect = stage.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const va = vw / vh, sa = rect.width / rect.height;
  let w = rect.width, h = rect.height;
  if (sa > va) w = h * va; else h = w / va;
  const ox = (rect.width - w) / 2, oy = (rect.height - h) / 2;
  guide.style.left = `${ox + roi.cx * w}px`;
  guide.style.top = `${oy + roi.cy * h}px`;
  guide.style.width = `${roi.rx * 2 * w}px`;
  guide.style.height = `${roi.ry * 2 * h}px`;
}

function sizeCanvas(): void {
  const rect = stage.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.min(1920, Math.max(2, Math.round(rect.width * dpr)));
  const h = Math.min(1920, Math.max(2, Math.round(rect.height * dpr)));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function toast(msg: string): void {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 2600);
}

function showHeroError(msg: string): void {
  heroErr.textContent = msg;
  heroErr.hidden = false;
}

function describeCameraError(err: unknown): string {
  const e = err as DOMException;
  switch (e?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Camera access was blocked. Allow the camera in your browser\'s site settings and try again — or load a video file instead.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was found on this device. You can still load a video file.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera is busy in another app. Close it and try again.';
    case 'SecurityError':
      return 'Camera access needs a secure (HTTPS) page.';
    default:
      return `Could not start the camera${e?.message ? `: ${e.message}` : ''}.`;
  }
}

boot();
