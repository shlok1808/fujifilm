import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadRaf, type LoadedRaf } from './decode/decodeRaf';
import { Renderer } from './gpu/renderer';
import { downloadBlob, exportFullResolution } from './gpu/exportImage';
import { RECIPE_LIBRARY } from './data/recipes';
import {
  CAMERA_GEN_CAPS, DEFAULT_RECIPE, FILM_SIM_LABELS,
  type FilmSim, type Recipe,
} from './model/recipe';
import { parseRecipeText, recipeFromLocation, shareUrl } from './model/share';
import { ParamPanel } from './ui/ParamPanel';
import { CompareView, MAX_PANES, type ViewMode } from './ui/CompareView';
import './App.css';

export default function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const [renderer, setRenderer] = useState<Renderer | null>(null);

  const [raf, setRaf] = useState<LoadedRaf | null>(null);
  const [recipe, setRecipe] = useState<Recipe>(() => recipeFromLocation() ?? DEFAULT_RECIPE);
  const [mode, setMode] = useState<ViewMode>('single');
  const [compareIds, setCompareIds] = useState<string[]>(['lab-standard', 'fxw-xt1-classic-chrome']);
  /** compare saved recipes, or the same recipe across different film simulations */
  const [compareSource, setCompareSource] = useState<'recipes' | 'sims'>('sims');
  const [compareSims, setCompareSims] = useState<FilmSim[]>(
    ['provia', 'velvia', 'classic-chrome', 'astia'],
  );
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);

  const notify = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  }, []);

  // --- file loading ---------------------------------------------------------
  const openFile = useCallback(async (file: File) => {
    setError(null);
    setStatus(`Decoding ${file.name}…`);
    try {
      const t0 = performance.now();
      const loaded = await loadRaf(file);
      const ms = Math.round(performance.now() - t0);
      setRaf(loaded);
      // a shared link wins over the as-shot recipe, otherwise start from the frame
      if (!recipeFromLocation()) setRecipe(loaded.asShot ?? DEFAULT_RECIPE);
      setStatus(`${loaded.model} · ${loaded.preview.crop.width}×${loaded.preview.crop.height} preview · decoded in ${ms} ms`);
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
  // The canvas lives inside CompareView and only mounts once a file is loaded,
  // so the renderer is created against whichever canvas is currently present.
  useEffect(() => {
    if (!raf) return;
    const canvas = hostRef.current?.querySelector('canvas');
    if (!canvas) return;
    try {
      rendererRef.current ??= new Renderer(canvas);
      rendererRef.current.setImage(raf.preview);
      setRenderer(rendererRef.current);
      setRevision((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [raf]);

  useEffect(() => () => {
    rendererRef.current?.dispose();
    rendererRef.current = null;
  }, []);

  useEffect(() => { setRevision((n) => n + 1); }, [recipe]);

  // --- derived --------------------------------------------------------------
  const caps = raf ? CAMERA_GEN_CAPS[raf.cameraGen] : null;
  const simUnsupported = caps && !caps.sims.has(recipe.filmSim);

  const allRecipes = useMemo(
    () => [{ ...recipe, id: 'current', name: recipe.name === DEFAULT_RECIPE.name ? 'Current' : recipe.name }, ...RECIPE_LIBRARY],
    [recipe],
  );

  const maxPanes = mode === 'split' ? 2 : MAX_PANES;

  const paneRecipes = useMemo(() => {
    if (mode === 'single') return [recipe];

    // Comparing simulations keeps every one of your other settings fixed and
    // varies only the film simulation, which is the question people actually ask.
    const picked: Recipe[] = compareSource === 'sims'
      ? compareSims.map((sim) => ({
          ...recipe,
          filmSim: sim,
          id: `sim-${sim}`,
          name: FILM_SIM_LABELS[sim],
        }))
      : compareIds
          .map((id) => allRecipes.find((r) => r.id === id))
          .filter((r): r is Recipe => Boolean(r));

    if (picked.length < 2) {
      return compareSource === 'sims'
        ? [recipe, { ...recipe, filmSim: 'provia' as FilmSim, id: 'sim-provia', name: FILM_SIM_LABELS.provia }]
        : [recipe, RECIPE_LIBRARY[0]];
    }
    return picked.slice(0, maxPanes);
  }, [mode, compareSource, compareSims, compareIds, allRecipes, recipe, maxPanes]);

  const toggleCompare = (id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.length <= 2 ? prev : prev.filter((p) => p !== id);
      return prev.length >= maxPanes ? [...prev.slice(1), id] : [...prev, id];
    });
  };

  const toggleSim = (sim: FilmSim) => {
    setCompareSims((prev) => {
      if (prev.includes(sim)) return prev.length <= 2 ? prev : prev.filter((p) => p !== sim);
      return prev.length >= maxPanes ? [...prev.slice(1), sim] : [...prev, sim];
    });
  };

  // --- actions --------------------------------------------------------------
  const doExport = async () => {
    if (!raf) return;
    setBusy('Decoding at full resolution…');
    try {
      const blob = await exportFullResolution(raf.file, recipe, setBusy);
      downloadBlob(blob, `${raf.fileName.replace(/\.raf$/i, '')}_${recipe.filmSim}.jpg`);
      notify('Exported full-resolution JPEG');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const doShare = async () => {
    const url = shareUrl(recipe);
    history.replaceState(null, '', `#r=${url.split('#r=')[1]}`);
    try {
      await navigator.clipboard.writeText(url);
      notify('Share link copied');
    } catch {
      notify('Link is in the address bar');
    }
  };

  const doPaste = (text: string) => {
    const parsed = parseRecipeText(text);
    if (!parsed) { setError("Couldn't find any recipe settings in that text."); return; }
    setRecipe((r) => ({ ...r, ...parsed, id: 'pasted', name: 'Pasted recipe' }));
    setPasteOpen(false);
    notify('Recipe applied');
  };

  return (
    <div className="app" onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void openFile(f); }} onDragOver={(e) => e.preventDefault()}>
      <header>
        <div>
          <h1>Fuji Recipe Lab</h1>
          <p className="sub">Film simulation recipes rendered from your own RAF — no camera required.</p>
        </div>
        {raf && (
          <nav className="modes">
            {(['single', 'grid', 'split'] as ViewMode[]).map((m) => (
              <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
                {m === 'single' ? 'Single' : m === 'grid' ? 'Compare' : 'Slider'}
              </button>
            ))}
          </nav>
        )}
      </header>

      {error && <div className="error" onClick={() => setError(null)}>{error}</div>}
      {busy && <div className="busy">{busy}</div>}
      {toast && <div className="toast">{toast}</div>}

      <input
        ref={fileInputRef}
        type="file"
        accept=".raf,.RAF"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void openFile(f);
          e.target.value = ''; // allow re-picking the same file
        }}
      />

      {!raf && (
        <button className="dropzone" onClick={() => fileInputRef.current?.click()}>
          <strong>Drop a .RAF file here</strong>
          <span>or click to choose · everything stays in your browser</span>
        </button>
      )}

      {status && <div className="status">{status}</div>}

      {raf && (
        <div className="workspace">
          <div ref={hostRef}>
            <CompareView
              renderer={renderer}
              mode={mode}
              recipes={paneRecipes}
              revision={revision}
              referenceUrl={referenceUrl}
              onError={setError}
            />
            {mode !== 'single' && (
              <div className="picker-panel">
                <div className="picker-head">
                  <div className="segmented">
                    <button
                      className={compareSource === 'sims' ? 'on' : ''}
                      onClick={() => setCompareSource('sims')}
                    >
                      Film simulations
                    </button>
                    <button
                      className={compareSource === 'recipes' ? 'on' : ''}
                      onClick={() => setCompareSource('recipes')}
                    >
                      Saved recipes
                    </button>
                  </div>
                  <span className="picker-hint">
                    {mode === 'split'
                      ? 'pick two'
                      : `pick up to ${MAX_PANES} · ${paneRecipes.length} shown`}
                  </span>
                </div>

                <div className="picker">
                  {compareSource === 'sims'
                    ? (Object.keys(FILM_SIM_LABELS) as FilmSim[]).map((sim) => (
                        <button
                          key={sim}
                          className={compareSims.includes(sim) ? 'chip on' : 'chip'}
                          onClick={() => toggleSim(sim)}
                          title={caps && !caps.sims.has(sim)
                            ? `${FILM_SIM_LABELS[sim]} — not available on your ${raf.model}, rendered anyway`
                            : FILM_SIM_LABELS[sim]}
                        >
                          {FILM_SIM_LABELS[sim]}
                          {caps && !caps.sims.has(sim) && <em className="off-body">*</em>}
                        </button>
                      ))
                    : allRecipes.map((r) => (
                        <button
                          key={r.id}
                          className={compareIds.includes(r.id) ? 'chip on' : 'chip'}
                          onClick={() => toggleCompare(r.id)}
                          title={r.author ? `${r.name} — ${r.author}` : r.name}
                        >
                          {r.name}
                        </button>
                      ))}
                </div>

                {compareSource === 'sims' && (
                  <p className="picker-note">
                    Every pane keeps your current settings and changes only the simulation.
                    <em>*</em> marks looks your {raf.model} can't shoot in-camera.
                  </p>
                )}
              </div>
            )}
          </div>

          <aside>
            <div className="meta">
              <div className="meta-head">
                <div>
                  <div><b>{raf.model}</b> · firmware {raf.firmware}</div>
                  <div className="dim">{caps?.label} · {raf.fileName}</div>
                </div>
                <button className="ghost small" onClick={() => fileInputRef.current?.click()}>
                  Change photo
                </button>
              </div>
            </div>

            <div className="row">
              <button className="ghost" onClick={() => setPasteOpen((v) => !v)}>Paste recipe</button>
              <button className="ghost" onClick={doShare}>Share link</button>
            </div>

            {pasteOpen && (
              <textarea
                className="paste"
                autoFocus
                placeholder={'Paste a recipe, e.g.\n\nFilm Simulation: Classic Chrome\nDynamic Range: DR200\nWhite Balance: Auto, -1 Red & -1 Blue\nHighlight: +1\nShadow: +1\nColor: +2\nSharpness: 0\nNoise Reduction: -2'}
                onPaste={(e) => setTimeout(() => doPaste((e.target as HTMLTextAreaElement).value), 0)}
                onBlur={(e) => e.target.value && doPaste(e.target.value)}
              />
            )}

            <label className="field">
              <span>Film simulation</span>
              <select value={recipe.filmSim} onChange={(e) => setRecipe({ ...recipe, filmSim: e.target.value as FilmSim })}>
                {(Object.keys(FILM_SIM_LABELS) as FilmSim[]).map((s) => (
                  <option key={s} value={s}>
                    {FILM_SIM_LABELS[s]}{caps && !caps.sims.has(s) ? ' — not on this body' : ''}
                  </option>
                ))}
              </select>
            </label>
            {simUnsupported && (
              <p className="note">Your {raf.model} can't shoot this simulation in-camera — rendering it anyway.</p>
            )}

            <ParamPanel recipe={recipe} caps={caps} onChange={setRecipe} />

            <div className="row">
              <button className="reset" onClick={() => setRecipe(raf.asShot ?? DEFAULT_RECIPE)}>Reset to as-shot</button>
              <button className="primary" onClick={doExport} disabled={!!busy}>Export full size</button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
