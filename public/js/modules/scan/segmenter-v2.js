// Découpe de l'image redressée en 4 tranches + patch (feuille sandwich v2).
// Contrat : segment(imageData) → Promise<{ slices: ImageData[], patch: ImageData }>
//
// Les coordonnées sont lues dans layout.vehicleSheetV2.
// Chaque slice est extraite au même y (les 4 grilles sont côte à côte sur la même rangée).
// L'index de la slice dans le tableau correspond au y voxel (0=dessous, 3=dessus).

let _layoutCache   = null;
let _onDebugResult = null;

/**
 * Découpe l'image redressée en 4 tranches + patch.
 * @param {ImageData} imageData — sortie de perspective.warp(..., 'vehicleSheetV2')
 * @returns {Promise<{ slices: ImageData[], patch: ImageData }>}
 */
export async function segment(imageData) {
  const layout = await _chargerLayout();
  const spec   = layout.vehicleSheetV2;

  console.log('[segmenter-v2] Découpe de', imageData.width, '×', imageData.height,
    '— spec :', spec.width, '×', spec.height);

  const canvas = document.createElement('canvas');
  canvas.width  = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(imageData, 0, 0);

  // Facteurs d'échelle si l'image ne correspond pas exactement aux specs
  const sx = imageData.width  / spec.width;
  const sy = imageData.height / spec.height;

  const slices = spec.slices.map((s, i) => {
    const x = Math.max(0, Math.round(s.x * sx));
    const y = Math.max(0, Math.round(s.y * sy));
    const w = Math.min(Math.round(s.w * sx), imageData.width  - x);
    const h = Math.min(Math.round(s.h * sy), imageData.height - y);
    console.log(`[segmenter-v2]   slice ${i} (${s.label}) : ${w}×${h} px depuis (${x}, ${y})`);
    return ctx.getImageData(x, y, w, h);
  });

  const px = Math.max(0, Math.round(spec.patch.x * sx));
  const py = Math.max(0, Math.round(spec.patch.y * sy));
  const pw = Math.min(Math.round(spec.patch.w * sx), imageData.width  - px);
  const ph = Math.min(Math.round(spec.patch.h * sy), imageData.height - py);
  const patch = ctx.getImageData(px, py, pw, ph);
  console.log(`[segmenter-v2]   patch : ${pw}×${ph} px depuis (${px}, ${py})`);

  const result = { slices, patch };
  if (_onDebugResult) _onDebugResult(result);
  return result;
}

/**
 * Enregistre un callback appelé après chaque segmentation pour le debug.
 * @param {((result: object) => void) | null} cb
 */
export function onDebugResult(cb) {
  _onDebugResult = cb;
}

async function _chargerLayout() {
  if (_layoutCache) return _layoutCache;
  const resp = await fetch('/config/layout.json');
  if (!resp.ok) throw new Error('Impossible de charger /config/layout.json');
  _layoutCache = await resp.json();
  return _layoutCache;
}
