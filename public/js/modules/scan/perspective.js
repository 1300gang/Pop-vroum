// Redressement de perspective via PerspT (perspective-transform).
// Contrat : warp(imageData, coins) → Promise<ImageData>
// coins = { tl, tr, bl, br } avec { x, y } en pixels dans imageData
//
// Utilise perspective-transform (~4 Ko) au lieu d'OpenCV.js (~10 Mo WASM).
// Interpolation bilinéaire pour un rendu lisse.

let _layoutCache   = null;
let _onDebugResult = null;

/**
 * Redresse la perspective de imageData en utilisant les 4 coins fournis.
 * La taille de sortie est lue dans /config/layout.json selon sheetKey.
 * @param {ImageData} imageData
 * @param {{ tl, tr, bl, br }} coins
 * @param {string} [sheetKey='vehicleSheet'] — clé layout pour les dimensions de sortie
 * @returns {Promise<ImageData>}
 */
export async function warp(imageData, coins, sheetKey = 'vehicleSheet') {
  if (typeof PerspT === 'undefined') {
    throw new Error('PerspT non chargé — vérifier que perspective-transform.min.js est inclus.');
  }

  const layout = await _chargerLayout();
  const spec   = layout[sheetKey] ?? layout.vehicleSheet;
  const outW   = spec.width;
  const outH   = spec.height;

  console.log('[perspective] warp() — entrée :',
    imageData.width, '×', imageData.height, '→', outW, '×', outH);
  console.log('[perspective] coins :', JSON.stringify(coins));

  // Points source : centres des 4 QR codes (TL → TR → BR → BL, sens horaire)
  const srcFlat = [
    coins.tl.x, coins.tl.y,
    coins.tr.x, coins.tr.y,
    coins.br.x, coins.br.y,
    coins.bl.x, coins.bl.y,
  ];

  // Points destination : les 4 coins de l'image de sortie
  const dstFlat = [
    0,    0,
    outW, 0,
    outW, outH,
    0,    outH,
  ];

  const transform = PerspT(srcFlat, dstFlat);

  const input  = imageData.data;
  const srcW   = imageData.width;
  const srcH   = imageData.height;
  const output = new Uint8ClampedArray(outW * outH * 4);

  // Pour chaque pixel de sortie, trouver le pixel source correspondant
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const [srcX, srcY] = transform.transformInverse(x, y);

      // Vérifier que le pixel source est dans les limites
      if (srcX >= 0 && srcY >= 0 && srcX < srcW - 1 && srcY < srcH - 1) {
        const x1 = Math.floor(srcX);
        const y1 = Math.floor(srcY);
        const x2 = x1 + 1;
        const y2 = y1 + 1;
        const dx = srcX - x1;
        const dy = srcY - y1;

        const dstIdx = (y * outW + x) * 4;

        // Interpolation bilinéaire sur les 3 canaux RGB
        for (let c = 0; c < 3; c++) {
          const c1 = input[(y1 * srcW + x1) * 4 + c];
          const c2 = input[(y1 * srcW + x2) * 4 + c];
          const c3 = input[(y2 * srcW + x1) * 4 + c];
          const c4 = input[(y2 * srcW + x2) * 4 + c];

          output[dstIdx + c] = Math.round(
            c1 * (1 - dx) * (1 - dy) +
            c2 * dx * (1 - dy) +
            c3 * (1 - dx) * dy +
            c4 * dx * dy
          );
        }
        output[dstIdx + 3] = 255; // alpha opaque
      }
      // sinon : pixel noir transparent (valeur par défaut 0)
    }
  }

  const result = new ImageData(output, outW, outH);
  console.log('[perspective] ✓ Redressement terminé :', result.width, '×', result.height);

  if (_onDebugResult) _onDebugResult(result);
  return result;
}

/**
 * Enregistre un callback appelé après chaque warp pour debug-view.js.
 * @param {((result: ImageData) => void) | null} cb
 */
export function onDebugResult(cb) {
  _onDebugResult = cb;
}

/**
 * Enregistre un callback pour suivre le statut (conservé pour compatibilité).
 * Avec PerspT, pas de chargement asynchrone lourd — le statut est toujours 'ready'.
 * @param {(status: string) => void} cb
 */
export function onStatusChange(cb) {
  // PerspT est synchrone, pas de cycle de vie à suivre
}

/**
 * Retourne true si PerspT est disponible.
 */
export function isReady() {
  return typeof PerspT !== 'undefined';
}

// Charge /config/layout.json une seule fois
async function _chargerLayout() {
  if (_layoutCache) return _layoutCache;
  const resp = await fetch('/config/layout.json');
  if (!resp.ok) throw new Error('Impossible de charger /config/layout.json');
  _layoutCache = await resp.json();
  return _layoutCache;
}
