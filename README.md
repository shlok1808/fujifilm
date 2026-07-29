# Fuji Recipe Lab

Upload a Fujifilm `.RAF` file and see how it looks under different film simulation
recipes — pick presets and compare them side by side, or drive the underlying
settings yourself and watch the photo re-render live.

Everything runs in your browser. No upload, no account, no server, and **no camera
required** — unlike X RAW STUDIO or tethered tools like Focal Click, this renders the
looks itself, so it works with bodies that have no in-camera RAW reprocessing.

Built for and verified against a **Fujifilm X-T1** (first-generation X-Trans II).

## How it works

```
.RAF ──┬─► embedded camera JPEG ────────► instant preview + ground-truth reference
       ├─► MakerNote ──────────────────► the recipe the shot was actually taken with
       └─► libraw-wasm (Web Worker) ───► linear scene-referred RGB
                                              │
                                    WebGL2 render graph (all params are uniforms)
                                              │
                              ┌───────────────┼───────────────┐
                           N-up compare   curtain slider   full-res export
```

The RAW is decoded **once**; every recipe after that is a GPU draw call. That is what
makes both the live sliders and the N-way comparison cheap.

Decode timings for a 16MP X-T1 frame (M1 MacBook, Chromium):

| path | settings | time | output |
|---|---|---|---|
| interactive preview | `halfSize` | **~180 ms** | 2467×1648 |
| export | full, `userQual: 12` | ~7 s | 4934×3296 |

X-Trans bins cleanly at half size, so the fast path costs no visible on-screen
quality. The slow demosaic is reserved for export.

## Ground truth

Every RAF embeds the camera's own JPEG rendering (1920×1280 on the X-T1). The app
reads the recipe the frame was shot with out of the MakerNote, renders *that* recipe,
and lets you hold a button to flip between our render and the camera's. That turns
"this is an approximation" from a disclaimer into something you can actually look at
— and it's the training data for the calibration path below.

## Accuracy, honestly

This is an emulation, not the camera's processor. Specifically:

- **Film simulation LUTs** are derived from Adobe's Fuji camera-matching profiles for
  an X-Trans IV body. Applied to X-Trans II files they are close, not exact.
- **Parameter mappings** (what "Highlight +1" or "Color −2" really does) are fitted
  approximations. Fujifilm doesn't publish these.
- **Dynamic Range is partly a capture-time decision.** DR400 works by underexposing
  two stops when the shutter fires. Starting from a RAF shot at DR100, the highlights
  simply were not recorded and no amount of processing invents them. The UI warns when
  you ask for more DR than the frame was shot with.
- **Noise reduction** will not match Fuji's, which is proprietary.

The fix for the first two is `tools/calibrate/` (planned): shoot RAW+JPEG pairs on the
X-T1 across every simulation and every parameter value, then derive LUTs and fit the
real parameter curves from your own sensor. That replaces guesses with measurements.

## Development

```bash
npm install
npm run dev
```

Verification scripts (need the dev server running):

```bash
node tools/smoke.mjs             # decode a real RAF end to end, screenshot it
node tools/orientation-check.mjs # assert the image isn't upside down
```

Both point at a local RAF path you'll want to change to your own file.

## Credits

Film simulation LUTs from [abpy/FujifilmCameraProfiles](https://github.com/abpy/FujifilmCameraProfiles),
used under CC BY-NC-SA 4.0 — see [NOTICE](NOTICE).

RAW decoding by [LibRaw](https://www.libraw.org/) via
[libraw-wasm](https://github.com/ybouane/LibRaw-Wasm).

"Fujifilm", "Provia", "Velvia", "Astia", "ACROS" and other simulation names are
trademarks of FUJIFILM Corporation, used here for identification only. This project is
not affiliated with or endorsed by Fujifilm.
