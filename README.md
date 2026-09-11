# quiver

**Your webcam can see your heartbeat.**

quiver is a motion microscope that runs in the browser. It amplifies the invisible colour and motion changes in live video — blood pulsing through your face, a chest breathing across the room, a table trembling under a laptop fan — ×60 in real time, and measures your heart rate from your face without touching you.

Everything runs on your GPU. No server, no model, no upload. The page makes zero network requests after it loads.

**Live:** https://quivercam.vercel.app

---

## What it does

| Mode | What it amplifies | Band | Method |
| --- | --- | --- | --- |
| **Pulse** | Skin colour changes from blood volume | 0.7–2.5 Hz (narrows around your pulse once locked) | Gaussian / colour EVM, α = 60 |
| **Breathing** | Sub-pixel motion of a chest, a pet, a sleeping baby | 0.15–0.8 Hz | Laplacian / motion EVM, α = 20, λc = 40 |
| **Vibration** | Machines, strings, structures | 2–8 Hz | Laplacian / motion EVM, α = 20, λc = 20 |
| **Custom** | Anything — every parameter exposed | you pick | either |

Views: **Magnified**, **Compare** (draggable before/after split), **Signal** (the amplified band alone, as a signed heat map — you can watch the blood-flow wave sweep across a face).

Outputs: record a clip (MediaRecorder, up to 15 s, with the heartbeat audio if sound is on), save a snapshot, or share a heart-rate card. Recordings and snapshots carry a burned-in caption — the BPM, the pulse trace, the mode — so they explain themselves when posted. All written straight to your device.

Extras: **Sound** (M) plays a synthesised lub-dub on every detected beat (and a haptic tick on phones); the face ring animates while scanning and locks solid when the pulse is found; the visual band narrows around your pulse once locked.

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
- **Motion gate:** amplifying a moving scene only produces blurry ghosts (the band-pass of a moving edge is a smeared copy of it, ×50). A per-frame motion estimate — mean |Δ| of an 8×6 grid of block means (so sensor noise averages out), minus an adaptive floor — fades the gain toward 20 % the instant you or the camera move and eases it back over ~1.5 s of stillness; the HUD flips to *hold still*. In Pulse mode the flush is also confined to a feathered ellipse around the tracked face, so the background stays clean.

**Heart rate:** the oval slides onto your face by itself (skin-pixel centroid of a 64×48 downsample, eased every fourth frame — no face model, no download). Inside it, the mean colour of skin pixels (YCbCr skin box) is sampled at ~30 Hz from a 48×48 canvas, resampled onto a uniform grid, run through three rPPG projections in parallel — POS (Wang 2017), CHROM (de Haan 2013) and plain normalised green — each with a 1.6 s sliding window, a 4th-order band-pass (a 2nd-order one leaks head sway into the 42 bpm band edge), a Hann window and a 2048-point FFT. Whichever projection gives the cleanest spectrum wins (with hysteresis, so the waveform phase does not jump). The dominant peak between 42 and 180 bpm is the estimate. Confidence = spectral SNR (fundamental + 2nd-harmonic lobes over the rest of the band, calibrated so noise-only traces score < 0.3 and never show a number) × how long the peak has stayed put × time accumulated; a persistence rule keeps a single noisy spectrum from yanking the number. Once locked, the magnifier's visual band is narrowed to ±0.35 Hz around the detected pulse, so the flush gets cleaner the longer you hold still.

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
  ui/card.ts           share card renderer
  ui/overlay.ts        burned-in caption compositor for clips/snapshots
  ui/heartbeat.ts      synthesised lub-dub + haptics
  main.ts              app
tests/dsp.test.ts      vitest
```

Zero runtime dependencies. ~16 KB of JavaScript gzipped.

## Honest limits

- Remote PPG from a consumer webcam is typically within a few bpm of a chest strap in good, even light, and much worse in dim light, with head motion, with heavy makeup, or on very dark skin (less light gets back out). It is a toy that happens to be real science. Not a medical device.
- Motion modes amplify *any* motion in band, including camera shake. Put the phone down.
- At 30 fps anything above ~14 Hz aliases; fast vibration still shows, just not at its true frequency.

## Credits

**Made by [Zayd Mulani](https://github.com/zaydmulani09)** (@zaydmulani09) — building local-first AI tooling and dev infrastructure, shipping in public from New Jersey. Pair-programmed with Claude Code (Opus 5); every commit carries the co-author trailer.

quiver is an independent, from-scratch reimplementation of the published methods below, written in TypeScript/WebGL2 with zero runtime dependencies. None of MIT's reference code or sample footage is used (their release is licensed for non-commercial research only and the method is patented by MIT). quiver is free, non-commercial and educational.

Type: [Instrument Serif](https://github.com/Instrument/instrument-serif) by Rodrigo Fuenzalida & Instrument, and [Geist / Geist Mono](https://vercel.com/font) by Vercel — both SIL Open Font License. Deployed on Vercel.

### How to cite quiver

There is a [`CITATION.cff`](CITATION.cff) in the repo (GitHub renders a "Cite this repository" button from it). Plain text:

> Mulani, Z. (2026). *quiver: real-time Eulerian video magnification and remote photoplethysmography in the browser* (v1.0.0) [Software]. https://quivercam.vercel.app

## References

1. H.-Y. Wu, M. Rubinstein, E. Shih, J. Guttag, F. Durand, W. T. Freeman. **Eulerian Video Magnification for Revealing Subtle Changes in the World.** *ACM Transactions on Graphics* 31(4), SIGGRAPH 2012. [doi:10.1145/2185520.2185561](https://doi.org/10.1145/2185520.2185561) · [project page](https://people.csail.mit.edu/mrub/evm/)
2. W. Wang, A. C. den Brinker, S. Stuijk, G. de Haan. **Algorithmic Principles of Remote PPG.** *IEEE Transactions on Biomedical Engineering* 64(7):1479–1491, 2017. [doi:10.1109/TBME.2016.2609282](https://doi.org/10.1109/TBME.2016.2609282)
3. G. de Haan, V. Jeanne. **Robust Pulse Rate From Chrominance-Based rPPG.** *IEEE Transactions on Biomedical Engineering* 60(10):2878–2886, 2013. [doi:10.1109/TBME.2013.2266196](https://doi.org/10.1109/TBME.2013.2266196)
4. D. Chai, K. N. Ngan. **Face segmentation using skin-color map in videophone applications.** *IEEE Transactions on Circuits and Systems for Video Technology* 9(4):551–564, 1999. [doi:10.1109/76.767122](https://doi.org/10.1109/76.767122)

MIT licence.
