// Calibration des couleurs via le patch de référence.
// Contrat : calibrate(patchImageData) → Promise<{ red, green, blue, orange, violet, pink }>
// Chaque valeur est { h, s, l } — teinte mesurée dans les conditions réelles.
//
// Le patch est une bande horizontale avec 6 carrés de gauche à droite :
// rouge, vert, bleu, orange, violet, rose (ordre défini dans scan.json).

let _scanConfigCache = null;
let _onDebugResult   = null;

const ORDRE_COULEURS = ['red', 'green', 'blue', 'orange', 'violet', 'pink'];

/**
 * Lit les 6 carrés du patch et retourne les cibles HSL calibrées.
 * @param {ImageData} patchImageData — zone patch extraite par segmenter
 * @returns {Promise<{ red, green, blue, orange, violet, pink }>}
 */
export async function calibrate(patchImageData) {
  const config = await _chargerScanConfig();

  const w = patchImageData.width;
  const h = patchImageData.height;
  const zoneW = Math.floor(w / 6);

  console.log('[calibration] Patch :', w, '×', h, '— zone unitaire :', zoneW, 'px');

  // Créer un canvas temporaire pour extraire chaque zone
  const canvas = document.createElement('canvas');
  canvas.width  = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(patchImageData, 0, 0);

  const ratio     = config.centerSampleRatio ?? 0.6;
  const cibles    = {};
  const rapport   = []; // pour le debug

  for (let i = 0; i < 6; i++) {
    const nom    = ORDRE_COULEURS[i];
    const zoneX  = i * zoneW;

    // Zone centrale (ratio × dimensions) pour éviter les bords de carré
    const margeX = Math.floor(zoneW * (1 - ratio) / 2);
    const margeY = Math.floor(h     * (1 - ratio) / 2);
    const sx = zoneX + margeX;
    const sy = margeY;
    const sw = zoneW - margeX * 2;
    const sh = h     - margeY * 2;

    const pixels = ctx.getImageData(sx, sy, sw, sh);
    const hslMediane = _medianeHsl(pixels.data);

    const fallback = config.hslTargets[nom];

    if (hslMediane && hslMediane.s >= (config.minSaturation ?? 0.2)) {
      // La zone est suffisamment saturée — utiliser la valeur mesurée
      cibles[nom] = hslMediane;
      console.log(`[calibration]   ${nom} : H=${Math.round(hslMediane.h)}° S=${hslMediane.s.toFixed(2)} L=${hslMediane.l.toFixed(2)} (mesuré)`);
      rapport.push({ nom, hsl: hslMediane, source: 'mesuré' });
    } else {
      // Zone trop pâle / non coloriée — fallback sur scan.json
      cibles[nom] = fallback;
      console.warn(`[calibration]   ${nom} : saturation trop faible — fallback scan.json`);
      rapport.push({ nom, hsl: fallback, source: 'fallback' });
    }
  }

  if (_onDebugResult) _onDebugResult({ cibles, rapport, patchImageData });
  return cibles;
}

/**
 * Enregistre un callback appelé après chaque calibration pour le debug.
 * Reçoit { cibles, rapport, patchImageData }.
 * @param {((data: object) => void) | null} cb
 */
export function onDebugResult(cb) {
  _onDebugResult = cb;
}

// Calcule la médiane HSL d'un tableau de pixels RGBA
function _medianeHsl(data) {
  const hs = [];
  const ss = [];
  const ls = [];

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]     / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const { h, s, l } = _rgbToHsl(r, g, b);
    hs.push(h);
    ss.push(s);
    ls.push(l);
  }

  if (hs.length === 0) return null;

  // La médiane sur H nécessite une attention au wrap (0°/360°)
  return {
    h: _medianeCirculaire(hs),
    s: _mediane(ss),
    l: _mediane(ls),
  };
}

// Conversion RGB [0-1] → HSL (H en degrés [0-360], S et L en [0-1])
function _rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l   = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l }; // gris

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
    case g: h = ((b - r) / d + 2) / 6; break;
    default: h = ((r - g) / d + 4) / 6;
  }

  return { h: h * 360, s, l };
}

// Médiane classique sur un tableau de nombres
function _mediane(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid    = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Médiane circulaire pour la teinte (gère le wrap 0°/360°)
// Stratégie : convertir en vecteurs, calculer l'angle moyen
function _medianeCirculaire(angles) {
  let sinSum = 0;
  let cosSum = 0;
  for (const a of angles) {
    const rad = (a * Math.PI) / 180;
    sinSum += Math.sin(rad);
    cosSum += Math.cos(rad);
  }
  const angle = Math.atan2(sinSum / angles.length, cosSum / angles.length) * (180 / Math.PI);
  return angle < 0 ? angle + 360 : angle;
}

// Charge /config/scan.json une seule fois
async function _chargerScanConfig() {
  if (_scanConfigCache) return _scanConfigCache;
  const resp = await fetch('/config/scan.json');
  if (!resp.ok) throw new Error('Impossible de charger /config/scan.json');
  _scanConfigCache = await resp.json();
  return _scanConfigCache;
}
