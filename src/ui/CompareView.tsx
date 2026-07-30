import { useCallback, useEffect, useRef, useState } from 'react';
import type { Renderer } from '../gpu/renderer';
import { loadLut } from '../gpu/lut';
import { recipeToParams } from '../model/params';
import type { Recipe } from '../model/recipe';

export type ViewMode = 'single' | 'grid' | 'split';

interface Props {
  renderer: Renderer | null;
  mode: ViewMode;
  /** single: [current]; grid: 2-4 recipes; split: exactly 2 */
  recipes: Recipe[];
  /** bumped by the parent to force a redraw */
  revision: number;
  /** the camera's own JPEG, shown on demand as a ground-truth reference */
  referenceUrl?: string | null;
  onError: (message: string) => void;
}

/** Grid shape for n panes, kept as square as possible. */
export function gridShape(n: number): { cols: number; rows: number } {
  if (n <= 1) return { cols: 1, rows: 1 };
  if (n === 2) return { cols: 2, rows: 1 };
  if (n <= 4) return { cols: 2, rows: 2 };
  if (n <= 6) return { cols: 3, rows: 2 };
  return { cols: 3, rows: 3 };
}

export const MAX_PANES = 9;

export function CompareView({ renderer, mode, recipes, revision, referenceUrl, onError }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(0.5);
  const [lutRevision, setLutRevision] = useState(0);
  const [showReference, setShowReference] = useState(false);
  const dragging = useRef(false);

  // Make sure every LUT this view needs is resident before drawing.
  useEffect(() => {
    let cancelled = false;
    const sims = [...new Set(recipes.map((r) => r.filmSim))];
    Promise.all(
      sims.map(async (sim) => {
        const pending = loadLut(sim);
        if (!pending) return;
        const lut = await pending;
        if (!cancelled) renderer?.uploadLut(sim, lut);
      }),
    )
      .then(() => { if (!cancelled) setLutRevision((n) => n + 1); })
      .catch((e) => { if (!cancelled) onError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [renderer, recipes, onError]);

  // Draw. Every pane reuses the one decoded texture, so this is N draw calls.
  useEffect(() => {
    const r = renderer;
    const canvas = canvasRef.current;
    if (!r || !canvas || recipes.length === 0) return;

    const { width: imgW, height: imgH } = r.outputSize;
    if (!imgW || !imgH) return;

    if (mode === 'grid' && recipes.length > 1) {
      const { cols, rows } = gridShape(recipes.length);
      // Each pane shows the whole frame, so cell height follows from the image
      // aspect and the column count — deriving it from `rows` instead would
      // squash the picture horizontally.
      const cellW = Math.round(imgW / cols);
      const cellH = Math.round(imgH / cols);
      canvas.width = cellW * cols;
      canvas.height = cellH * rows;
      r.clear();
      recipes.forEach((recipe, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        r.render(recipeToParams(recipe), {
          lutKey: recipe.filmSim,
          // WebGL viewports start at the bottom-left, the grid reads top-down
          viewport: {
            x: col * cellW,
            y: canvas.height - (row + 1) * cellH,
            width: cellW,
            height: cellH,
          },
        });
      });
      return;
    }

    if (mode === 'split' && recipes.length >= 2) {
      canvas.width = imgW;
      canvas.height = imgH;
      const x = Math.round(imgW * split);
      r.clear();
      r.render(recipeToParams(recipes[0]), {
        lutKey: recipes[0].filmSim,
        scissor: { x: 0, y: 0, width: x, height: imgH },
      });
      r.render(recipeToParams(recipes[1]), {
        lutKey: recipes[1].filmSim,
        scissor: { x, y: 0, width: imgW - x, height: imgH },
      });
      return;
    }

    canvas.width = imgW;
    canvas.height = imgH;
    r.render(recipeToParams(recipes[0]), { lutKey: recipes[0].filmSim });
  }, [renderer, mode, recipes, revision, split, lutRevision]);

  // --- split divider dragging ----------------------------------------------
  const updateSplit = useCallback((clientX: number) => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setSplit(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)));
  }, []);

  useEffect(() => {
    if (mode !== 'split') return;
    const move = (e: PointerEvent) => { if (dragging.current) updateSplit(e.clientX); };
    const up = () => { dragging.current = false; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [mode, updateSplit]);

  const { cols, rows } = gridShape(recipes.length);

  return (
    <div className="viewer" ref={wrapRef}>
      <canvas ref={canvasRef} />

      {mode === 'grid' && recipes.length > 1 && (
        <div className="grid-labels" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
          {recipes.map((r) => (
            <div key={r.id} className="cell-label"><span>{r.name}</span></div>
          ))}
        </div>
      )}

      {showReference && referenceUrl && (
        <img className="reference" src={referenceUrl} alt="camera JPEG" />
      )}
      {mode === 'single' && referenceUrl && (
        <button
          className="toggle"
          onPointerDown={() => setShowReference(true)}
          onPointerUp={() => setShowReference(false)}
          onPointerLeave={() => setShowReference(false)}
        >
          Hold to compare with camera JPEG
        </button>
      )}

      {mode === 'split' && recipes.length >= 2 && (
        <>
          <div className="split-handle" style={{ left: `${split * 100}%` }}
            onPointerDown={(e) => { dragging.current = true; updateSplit(e.clientX); e.preventDefault(); }}
          >
            <div className="grip" />
          </div>
          <div className="split-label left"><span>{recipes[0].name}</span></div>
          <div className="split-label right"><span>{recipes[1].name}</span></div>
        </>
      )}
    </div>
  );
}
