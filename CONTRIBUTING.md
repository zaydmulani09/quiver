# Contributing to quiver

Thanks for looking under the hood. A few things that keep this project easy to work on:

- **Zero runtime dependencies is a feature.** The DSP (`src/dsp`) and the GL pipeline (`src/gl`) are hand-written so anyone can read them end to end. Please don't add a library to save twenty lines.
- **The estimator is testable without a camera.** `npm test` runs the FFT/filters/POS/estimator suite against synthetic skin-colour traces. If you change how the heart rate is found, add or adjust a synthetic-trace test that shows the improvement (see `tests/dsp.test.ts`).
- **Real-camera reports are gold.** If the lock is slow or wrong on your setup, open an issue with: browser + OS, camera, lighting, skin tone if you're comfortable sharing it, and the HUD line at the top-right of the video (`fps · size · method snrN`). A short clip recorded with the app's own Record button helps enormously.
- **Headless testing:** `npm run dev`, then open `http://localhost:5188/?synthetic=72` for a canvas-generated camera with a known 72 bpm pulse, a breathing chest and a 5 Hz wire. Add `&shake` to exercise the motion gate, `&face=0.3,0.55` to move the face.
- **Style:** TypeScript strict, no default exports, comments explain *why* (and cite the paper) rather than *what*.

Run `npm run build` (typecheck + Vite) and `npm test` before opening a PR.
