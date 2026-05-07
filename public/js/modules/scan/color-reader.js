// Lecture de la couleur dominante par case d'une grille.
// Contrat : readGrid(imageData, { cols, rows }, ciblesHSL) → string[][] | null[][]
//
// Pour chaque case, échantillonne les 60% centraux, calcule la HSL médiane,
// puis trouve la cible la plus proche par distance HSL pondérée (4*dH + dS + dL).
// Si saturation < minSaturation → case blanche (null).

let _scanConfigCache = null;
let _onDebugResult   = null;

/**
 * Lit la couleur de chaque case d'une grille.
 * @param {ImageData} imageData — image de la grille (face, profile ou top)
 * @param {{ cols: number, rows: number }} dims
 * @param {{ [couleur: string]: { h, s, l } }} ciblesHSL — cibles calibrées
 * @returns {Promise<Array<Array<string|null>>>} grille[col][row]
 */
export async function readGrid(imageData, dims, ciblesHSL) {
  const config = await _chargerScanConfig();

  const { cols, rows } = dims;
  const cellW = imageData.width  / cols;
  const cellH = imageData.height / rows;
  const ratio = config.centerSampleRatio ?? 0.6;
  const minSat = config.minSaturation ?? 0.2;
  const tolH   = config.tolerance.hue;
  const tolS   = config.tolerance.sat;
  const tolL   = config.tolerance.light;

  console.log('[color-reader] Grille', cols, '×', rows,
    '— case', Math.round(cellW), '×', Math.round(cellH), 'px');

  // Canvas temporaire pour extraire les pixels par case
  const canvas = document.createElement('canvas');
  canvas.width  = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(imageData, 0, 0);

  const grille  = [];
  const rapport = []; // pour le debug

  for (let col = 0; col < cols; col++) {
    grille[col] = [];
    for (let row = 0; row < rows; row++) {
      // Zone de la case
      const cx = col * cellW;
      const cy = row * cellH;

      // Échantillonnage 60% central (ignore les bords de feutre)
      const margeX = cellW * (1 - ratio) / 2;
      const margeY = cellH * (1 - ratio) / 2;
      const sx = Math.round(cx + margeX);
      const sy = Math.round(cy + margeY);
      const sw = Math.round(cellW * ratio);
      const sh = Math.round(cellH * ratio);

      const pixels = ctx.getImageData(sx, sy, sw, sh);
      const hsl = _medianeHsl(pixels.data);

      if (!hsl || hsl.s < minSat) {
        // Case blanche / non coloriée
        grille[col][row] = null;
        rapport.push({ col, row, hsl, couleur: null, raison: 'saturation' });
        continue;
      }

      // Trouver la cible la plus proche
      let meilleur = null;
      let distMin  = Infinity;

      for (const [nom, cible] of Object.entries(ciblesHSL)) {
        const dH = _distanceHue(hsl.h, cible.h) / 180; // normalisé [0-1]
        const dS = Math.abs(hsl.s - cible.s);
        const dL = Math.abs(hsl.l - cible.l);
        const dist = 4 * dH + dS + dL;

        if (dist < distMin) {
          distMin  = dist;
          meilleur = nom;
        }
      }

      // Vérifier que la distance est dans la tolérance
      const cible = ciblesHSL[meilleur];
      const dHabs = _distanceHue(hsl.h, cible.h);
      const inTol = dHabs <= tolH
                 && Math.abs(hsl.s - cible.s) <= tolS
                 && Math.abs(hsl.l - cible.l) <= tolL;

      if (inTol) {
        grille[col][row] = meilleur;
        rapport.push({ col, row, hsl, couleur: meilleur, dist: distMin });
      } else {
        grille[col][row] = null;
        rapport.push({ col, row, hsl, couleur: null, raison: 'hors tolérance', meilleureCorrespondance: meilleur, dist: distMin });
      }
    }
  }

  console.log('[color-reader] Résultat :', _compterCouleurs(grille, cols, rows));

  if (_onDebugResult) _onDebugResult({ grille, rapport, dims, imageData });
  return grille;
}

/**
 * Enregistre un callback appelé après chaque lecture pour le debug.
 * @param {((data: object) => void) | null} cb
 */
export function onDebugResult(cb) {
  _onDebugResult = cb;
}

// Conversion RGB [0-1] → HSL (H en degrés [0-360], S et L en [0-1])
function _rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l   = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l };

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

// Médiane HSL d'un tableau RGBA
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

  return {
    h: _moyenneCirculaire(hs),
    s: _mediane(ss),
    l: _mediane(ls),
  };
}

// Distance entre deux teintes sur le cercle [0-360]
function _distanceHue(h1, h2) {
  const d = Math.abs(h1 - h2);
  return d > 180 ? 360 - d : d;
}

// Médiane classique
function _mediane(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid    = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Moyenne circulaire pour la teinte (gère le wrap 0°/360°)
function _moyenneCirculaire(angles) {
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

// Compte les couleurs dans la grille pour le log
function _compterCouleurs(grille, cols, rows) {
  const compteur = {};
  let vides = 0;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const v = grille[c][r];
      if (v) compteur[v] = (compteur[v] || 0) + 1;
      else vides++;
    }
  }
  const parts = Object.entries(compteur).map(([k, v]) => `${k}:${v}`);
  parts.push(`vide:${vides}`);
  return parts.join(', ');
}

// Charge /config/scan.json une seule fois
async function _chargerScanConfig() {
  if (_scanConfigCache) return _scanConfigCache;
  const resp = await fetch('/config/scan.json');
  if (!resp.ok) throw new Error('Impossible de charger /config/scan.json');
  _scanConfigCache = await resp.json();
  return _scanConfigCache;
}
