// Découpe de l'image redressée en zones distinctes (3 grilles + patch).
// Contrat : segment(imageData) → Promise<{ face, profile, top, patch }>
// Chaque valeur est un ImageData aux dimensions définies dans layout.json.

let _layoutCache   = null;
let _onDebugResult = null;

/**
 * Découpe l'image redressée en 4 zones selon layout.json.
 * @param {ImageData} imageData — image redressée (sortie de perspective.warp)
 * @returns {Promise<{ face: ImageData, profile: ImageData, top: ImageData, patch: ImageData }>}
 */
export async function segment(imageData) {
  const layout  = await _chargerLayout();
  const regions = layout.vehicleSheet.regions;

  console.log('[segmenter] Découpe de', imageData.width, '×', imageData.height,
    '— régions :', Object.keys(regions).join(', '));

  // Canvas temporaire pour pouvoir utiliser getImageData sur des sous-zones
  const canvas = document.createElement('canvas');
  canvas.width  = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(imageData, 0, 0);

  const result = {};

  for (const [nom, r] of Object.entries(regions)) {
    // Vérifier que la zone ne déborde pas de l'image
    const x = Math.max(0, Math.min(r.x, imageData.width));
    const y = Math.max(0, Math.min(r.y, imageData.height));
    const w = Math.min(r.w, imageData.width  - x);
    const h = Math.min(r.h, imageData.height - y);

    result[nom] = ctx.getImageData(x, y, w, h);
    console.log(`[segmenter]   ${nom} : ${w} × ${h} px (depuis ${x}, ${y})`);
  }

  if (_onDebugResult) _onDebugResult(result);
  return result;
}

/**
 * Enregistre un callback appelé après chaque segmentation pour le debug.
 * Reçoit { face: ImageData, profile: ImageData, top: ImageData, patch: ImageData }.
 * @param {((zones: object) => void) | null} cb
 */
export function onDebugResult(cb) {
  _onDebugResult = cb;
}

// Charge /config/layout.json une seule fois
async function _chargerLayout() {
  if (_layoutCache) return _layoutCache;
  const resp = await fetch('/config/layout.json');
  if (!resp.ok) throw new Error('Impossible de charger /config/layout.json');
  _layoutCache = await resp.json();
  return _layoutCache;
}
