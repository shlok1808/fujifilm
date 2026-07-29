/**
 * Full-resolution export.
 *
 * The interactive path runs on a half-size decode (~180 ms). Export re-decodes
 * the same file at full resolution with the X-Trans-aware demosaic (~7 s), so
 * it happens on demand rather than up front.
 */

import { decodeFullResolution } from '../decode/decodeRaf';
import { Renderer } from './renderer';
import { loadLut } from './lut';
import { recipeToParams } from '../model/params';
import type { Recipe } from '../model/recipe';

export async function exportFullResolution(
  file: File,
  recipe: Recipe,
  onProgress?: (stage: string) => void,
): Promise<Blob> {
  onProgress?.('Decoding at full resolution…');
  const image = await decodeFullResolution(file);

  onProgress?.('Rendering…');
  const canvas = document.createElement('canvas');
  const renderer = new Renderer(canvas);
  try {
    renderer.setImage(image);
    const { width, height } = renderer.outputSize;
    canvas.width = width;
    canvas.height = height;

    const lut = await loadLut(recipe.filmSim);
    if (lut) renderer.setLut(await lut);
    renderer.render(recipeToParams(recipe));

    onProgress?.('Encoding JPEG…');
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.95),
    );
    if (!blob) throw new Error('Could not encode the exported image.');
    return blob;
  } finally {
    renderer.dispose();
    // free the backing store promptly — a full-res canvas is ~65 MB
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // revoke on the next tick so the click has definitely been handled
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
