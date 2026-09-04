# quiver

**Your webcam can see your heartbeat.**

quiver is a motion microscope that runs in the browser. It amplifies the invisible colour and motion changes in live video — blood pulsing through your face, a chest breathing across the room, a table trembling under a laptop fan — ×60 in real time, and measures your heart rate from your face without touching you.

Everything runs on your GPU. No server, no model, no upload. The page makes zero network requests after it loads.

**Live:** https://quiver.vercel.app

---

## What it does

| Mode | What it amplifies | Band | Method |
| --- | --- | --- | --- |
| **Pulse** | Skin colour changes from blood volume | 0.7–2.5 Hz (narrows around your pulse once locked) | Gaussian / colour EVM, α = 60 |
| **Breathing** | Sub-pixel motion of a chest, a pet, a sleeping baby | 0.15–0.8 Hz | Laplacian / motion EVM, α = 20, λc = 40 |
| **Vibration** | Machines, strings, structures | 2–8 Hz | Laplacian / motion EVM, α = 20, λc = 20 |
| **Custom** | Anything — every parameter exposed | you pick | either |

Views: **Magnified**, **Compare** (draggable before/after split), **Signal** (the amplified band alone, as a signed heat map — you can watch the blood-flow wave sweep across a face).

Outputs: record a clip (MediaRecorder, up to 15 s), save a snapshot, or share a heart-rate card. All written straight to your device.

## How it works

The pipeline is a real-time reimplementation of **Eulerian Video Magnification** (Wu, Rubinstein, Shih, Guttag, Durand & Freeman, MIT CSAIL, SIGGRAPH 2012) on WebGL2, plus **POS** remote photoplethysmography (Wang, den Brinker, Stuijk & de Haan, IEEE TBME 2017) for the number.

```
video ─► YIQ (≤ 640 px) ─► Gaussian pyramid ─► [Laplacian bands]
      ─► per-level temporal IIR band-pass (two first-order low-passes, MRT ping-pong, RGBA16F)
      ─► gain per level (λ-clipped for motion, as in the paper) ─► collapse ─► "diff" texture
display = full-resolution video + diff        (or compare / signal / original)
```

- **Colour mode** filters one blurred pyramid level (~32 px on the short side), band-passes every pixel in time, scales by α, bicubic-upsamples and adds the result back onto the *full-resolution* frame — so sharpness is preserved even though the temporal work happens at low resolution.
- **Motion mode** band-passes every Laplacian level, clips the gain per level with the paper's `α < λ/(8δ) − 1` rule (finest and coarsest levels get 0), and collapses the amplified bands back down.
- The temporal filter is the paper's real-time IIR variant: `lo1 += r1·(x − lo1)`, `lo2 += r2·(x − lo2)`, `band = lo1 − lo2`, with `r = 1 − exp(−2π·f·dt)` recomputed from the measured frame interval so the band stays correct when the camera drops frames.
- Frames are pulled with `requestVideoFrameCallback` so the filter is stepped exactly once per *video* frame, not per animation frame.

**Heart rate:** the mean colour of skin pixels inside the oval (YCbCr skin box) is sampled at ~30 Hz from a 48×48 canvas, resampled onto a uniform grid, run through POS with a 1.6 s window, band-passed, Hann-windowed and put through a 2048-point FFT. The dominant peak between 42 and 180 bpm is the estimate; its main-lobe-to-in-band-power ratio is the confidence, and a persistence rule keeps a single noisy spectrum from yanking the number. Once locked, the magnifier's visual band is narrowed to ±0.35 Hz around the detected pulse, so the flush gets cleaner the longer you hold still.

## Run it

```bash
npm install
npm run dev        # http://localhost:5188
npm test           # DSP unit tests (FFT, filters, POS, estimator lock-on)
npm run build      # dist/
```

Dev-only: `http://localhost:5188/?synthetic=72` starts a canvas-generated "camera" with a known 72 bpm pulse, a breathing chest and a 5 Hz wire, so the whole pipeline can be exercised headless. `tools/og.html` regenerates the Open Graph image and touch icon.

## Project layout

```
src/
  gl/shaders.ts        GLSL: YIQ conversion, pyramid, Laplacian, IIR (MRT), collapse, bicubic band, display
  gl/magnifier.ts      the WebGL2 pipeline
  dsp/fft.ts           radix-2 FFT
  dsp/filters.ts       biquad band-pass, detrend, Hann, resample, peak + SNR
  dsp/pos.ts           POS rPPG
  dsp/heartrate.ts     HeartRateEstimator
  capture/camera.ts    getUserMedia / file / stream source
  capture/skin.ts      skin-pixel colour sampler
  capture/recorder.ts  MediaRecorder + share/download
  ui/waveform.ts       pulse trace