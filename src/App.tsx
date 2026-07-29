import { useCallback, useEffect, useRef, useState } from 'react';
import { loadRaf, type LoadedRaf } from './decode/decodeRaf';
import { Renderer } from './gpu/renderer';
import { loadLut } from './gpu/lut';
import { recipeToParams } from './model/params';
import {
  CAMERA_GEN_CAPS, DEFAULT_RECIPE, FILM_SIM_LABELS,
  type FilmSim, type Recipe,
} from './model/recipe';
import { ParamPanel } from './ui/ParamPanel';
import './App.css';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);

  const [raf, setRaf] = useState<LoadedRaf | null>(null);
  const [recipe, setRecipe] = useState<Recipe>(DEFAULT_RECIPE);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showReference, setShowReference] = useState(false);
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  // bumped whenever a LUT finishes loading, to retrigger the render effect
  const [lutReady, setLutReady] = useState(0);

  // --- file loading ---------------------------------------------------------
  const openFile = useCallback(async (file: File) => {
    setError(null);
    setStatus(`Decoding ${file.name}…`);
    try {
      const t0 = performance.now();
      const loaded = await loadRaf(file);
      const ms = Math.round(performance.now() - t0);

      setRaf(loaded);
      setRecipe(loaded.asShot ?? DEFAULT_RECIPE);
      setStatus(
        `${loaded.model} · ${loaded.preview.width}×${loaded.preview.height} preview · decoded in ${ms} ms`,
      );

      setReferenceUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return loaded.embeddedJpeg ? URL.createObjectURL(loaded.embeddedJpeg) : null;
      });
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // --- renderer lifecycle ---------------------------------------------------
  // The canvas only mounts once a file is loaded, so the renderer has to be
  // created here rather than in a mount-only effect.
  useEffect(() => {
    if (!raf || !canvasRef.current) return;
    try {
      rendererRef.current ??= new Renderer(canvasRef.current);
      const r = rendererRef.current;
      r.setImage(raf.preview);
      const { width, height } = r.outputSize;
      canvasRef.current.width = width;
      canvasRef.current.height = height;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [raf]);

  useEffect(() => () => {
    rendererRef.current?.dispose();
    rendererRef.current = null;
  }, []);

  // Load the LUT for the selected simulation. Cached, so switching back and
  // forth is instant after the first fetch.
  useEffect(() => {
    let cancelled = false;
    const pending = loadLut(recipe.filmSim);
    if (!pending) {
      rendererRef.current?.setLut(null);
      setLutReady((n) => n + 1);
      return;
    }
    pending
      .then((lut) => {
        if (cancelled) return;
        rendererRef.current?.setLut(lut);
        setLutReady((n) => n + 1);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, [recipe.filmSim]);

  // Re-render on every parameter change — this is the live path.
  useEffect(() => {
    const r = rendererRef.current;
    if (!r || !raf) return;
    r.render(recipeToParams(recipe));
  }, [recipe, raf, lutReady]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (file) void openFile(file);
    },
    [openFile],
  );

  const caps = raf ? CAMERA_GEN_CAPS[raf.cameraGen] : null;
  const simUnsupported = caps && !caps.sims.has(recipe.filmSim);

  return (
    <div className="app" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <header>
        <h1>Fuji Recipe Lab</h1>
        <p className="sub">
          Film simulation recipes rendered from your own RAF — no camera required.
        </p>
      </header>

      {error && <div className="error">{error}</div>}

      {!raf && (
        <label className="dropzone">
          <input
            type="file"
            accept=".raf,.RAF"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void openFile(f);
            }}
          />
          <strong>Drop a .RAF file here</strong>
          <span>or click to choose · everything stays in your browser</span>
        </label>
      )}

      {status && <div className="status">{status}</div>}

      {raf && (
        <div className="workspace">
          <div className="viewer">
            <canvas ref={canvasRef} />
            {showReference && referenceUrl && (
              <img className="reference" src={referenceUrl} alt="camera JPEG" />
            )}
            {referenceUrl && (
              <button
                className="toggle"
                onMouseDown={() => setShowReference(true)}
                onMouseUp={() => setShowReference(false)}
                onMouseLeave={() => setShowReference(false)}
              >
                Hold to compare with camera JPEG
              </button>
            )}
          </div>

          <aside>
            <div className="meta">
              <div>
                <b>{raf.model}</b> · firmware {raf.firmware}
              </div>
              <div className="dim">
                {caps?.label} · {raf.fileName}
              </div>
            </div>

            <label className="field">
              <span>Film simulation</span>
              <select
                value={recipe.filmSim}
                onChange={(e) => setRecipe({ ...recipe, filmSim: e.target.value as FilmSim })}
              >
                {(Object.keys(FILM_SIM_LABELS) as FilmSim[]).map((s) => (
                  <option key={s} value={s}>
                    {FILM_SIM_LABELS[s]}
                    {caps && !caps.sims.has(s) ? ' — not on this body' : ''}
                  </option>
                ))}
              </select>
            </label>
            {simUnsupported && (
              <p className="note">
                Your {raf.model} can't shoot this simulation in-camera — rendering it anyway.
              </p>
            )}

            <ParamPanel recipe={recipe} caps={caps} onChange={setRecipe} />

            <button className="reset" onClick={() => setRecipe(raf.asShot ?? DEFAULT_RECIPE)}>
              Reset to as-shot
            </button>
          </aside>
        </div>
      )}
    </div>
  );
}
