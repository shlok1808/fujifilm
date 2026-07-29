# Fuji Recipe Lab

Upload a Fujifilm `.RAF` file and see how it looks under different film simulation
recipes — pick presets and compare them side by side, or drive the underlying
settings yourself and watch the photo re-render live.

Three ways to look at a photo: a single live-adjustable render, an N-up **compare
grid** of up to four recipes, and a draggable **split slider** between two. All of it
runs in your browser — no upload, no account, no server, and **no camera
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

## Accuracy, measured

`tools/ground-truth.mjs` renders the recipe each frame was actually shot with and
compares it against that frame's own camera JPEG, in CIE76 dE:

| stage | mean dE |
|---|---|
| LUTs wired up, first measurement | 20.3 |
| after fixing the dynamic-range sign error | 15.0 |
| after cropping the masked sensor border | 13.9 |
| after fitting the DR midtone lift | **13.0** |

For scale: dE ≈ 2.3 is the just-noticeable threshold, under 5 reads as a close match,
over 10 is visibly different. **So this is in the right ballpark but not a faithful
reproduction** — the looks are plausible and clearly distinct from each other, and
brightness now matches the camera almost exactly (L\* bias ≈ 0), but regional colour
still drifts.

Two real bugs fell out of measuring rather than eyeballing:

- **Dynamic range had the wrong sign.** DR200/400 underexpose the sensor at capture;
  LibRaw then normalises raw to sensor saturation, which undoes exactly that. The
  decoded midtones therefore arrive *too bright*, not too dark. Sweeping exposure
  against the camera JPEG put the optimum at −1.00 stops on DR200 frames — precisely
  `log2(200/100)`.
- **The masked sensor border was never cropped.** LibRaw returns the full readout
  (4934×3296) rather than the nominal 4896×3262 in `raw_inset_crops`, leaving a dark
  strip along one edge.

What's still approximate:

- **Film simulation LUTs** come from Adobe's Fuji camera-matching profiles generated on
  an X-Trans **IV** body. Applied to X-Trans II files they are close, not exact — this
  is the largest remaining error term.
- **ACROS, Monochrome and Sepia have no LUT** in that pack, so they render through
  PROVIA plus a channel mixer. ACROS therefore shares PROVIA's tonality instead of its
  own distinctive curve.
- **Parameter mappings** (what "Highlight +1" or "Color −2" really does) are fitted, not
  measured. Fujifilm doesn't publish them.
- **Dynamic Range is partly a capture-time decision.** DR400 underexposes two stops when
  the shutter fires. Starting from a RAF shot at DR100, those highlights were never
  recorded and no processing invents them.
- **Noise reduction** will not match Fuji's, which is proprietary.

The fix for the first three is `tools/calibrate/` (planned): shoot RAW+JPEG pairs on the
X-T1 across every simulation and every parameter value, then derive LUTs and fit the
real parameter curves from your own sensor. That replaces guesses with measurements,
and should be the single biggest accuracy win available.

## Features

- **Single / Compare / Slider** views. The RAW is decoded once and every pane is a GPU
  draw call against that same texture, so a four-way comparison costs no more decoding
  than a single view.
- **Reads the recipe a frame was shot with** from the Fujifilm MakerNote and starts you
  there.
- **Hold to compare against the camera's own JPEG** — the honest reference.
- **Paste a recipe** in the format Fuji X Weekly and similar sites publish
  ("Highlight: +1", "Dynamic Range: DR200", …) and it is parsed into the sliders.
- **Share links** encode the recipe in the URL fragment, so settings travel without
  ever reaching a server.
- **Full-resolution JPEG export**, which re-decodes with the slow X-Trans demosaic.
- Parameters your body never had (Clarity, Grain, Color Chrome) are marked rather than
  hidden, and still render — so a modern X-Trans V recipe can be applied to an X-T1 file.

## Known limitations

- **Export is memory-hungry.** Rendering a 16MP frame uploads it as float RGBA, which
  needs a few hundred MB transiently. Fine on desktop; it may fail on older phones.
- **ACROS / Monochrome / Sepia** render through PROVIA plus a channel mixer, because the
  profile pack has no monochrome LUTs. See below.
- Recipes using simulations your camera lacks are rendered anyway, which is a feature,
  but they are approximations of approximations.

## Development

```bash
npm install
npm run dev
```

Verification scripts (need the dev server running):

```bash
node tools/smoke.mjs             # decode a real RAF end to end, screenshot it
node tools/orientation-check.mjs # assert the image isn't upside down
node tools/modes-check.mjs       # screenshot all three view modes
node tools/features-check.mjs    # paste, share round trip, full-res export
node tools/sim-compare.mjs       # confirm the simulations actually differ
node tools/ground-truth.mjs      # dE against the camera's own JPEG
```

Both point at a local RAF path you'll want to change to your own file.

## Deployment

Hosted on **Vercel** as a fully static site — there is no backend, no serverless
function and no environment config. Vercel auto-detects Vite, so no `vercel.json`
is needed:

| setting | value |
|---|---|
| framework preset | Vite |
| build command | `npm run build` |
| output directory | `dist` |

Either import the repo at [vercel.com/new](https://vercel.com/new), or from a clone:

```bash
npm i -g vercel
vercel login
vercel --prod
```

The `.wasm` decoder is content-hashed by Vite, so it is safe to cache immutably —
Vercel does this for `/assets/*` automatically. The app is single-threaded on
purpose, so it needs no `COOP`/`COEP` headers.

## Credits

Film simulation LUTs from [abpy/FujifilmCameraProfiles](https://github.com/abpy/FujifilmCameraProfiles),
used under CC BY-NC-SA 4.0 — see [NOTICE](NOTICE).

RAW decoding by [LibRaw](https://www.libraw.org/) via
[libraw-wasm](https://github.com/ybouane/LibRaw-Wasm).

"Fujifilm", "Provia", "Velvia", "Astia", "ACROS" and other simulation names are
trademarks of FUJIFILM Corporation, used here for identification only. This project is
not affiliated with or endorsed by Fujifilm.
