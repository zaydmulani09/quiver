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