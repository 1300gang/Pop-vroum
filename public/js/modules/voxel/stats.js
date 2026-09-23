// Calcul des caractéristiques et pouvoirs du véhicule à partir du volume voxel.
//
// Correspondance couleur → stat / pouvoir (cf. PRD §E09-E14) :
//   rouge  → vitesse (stat)  + aspiration (pouvoir : triangle arrière)
//   vert   → adhérence (stat) + phares (pouvoir : faisceau avant)
//   bleu   → accélération (stat) + sillage (pouvoir : trace au sol)
//   orange → bouclier (pouvoir : protection frontale)
//   violet → attraction (pouvoir : champ de cohésion)
//   rose   → soin (pouvoir : aura de régénération)
//
// Les coefficients sont tous externalisés dans /config/gameplay.json.

let _configCache = null;
let _onDebugResult = null;

/**
 * Calcule les stats et pouvoirs à partir de la grille voxel.
 * @param {Array<Array<Array<{color: string}|null>>>} grid — grid[x][z][y], 8×4×4
 * @returns {Promise<{ stats: object, powers: object }>}
 */
export async function computeStats(grid) {
  const config = await _chargerConfig();
  const vs = config.vehicleStats;
  const pw = config.powers;

  const comptage = _compterVoxels(grid);

  const stats = {
    speed: vs.baseSpeed + (comptage.red    || 0) * vs.speedPerRedVoxel,
    grip:  vs.baseGrip  + (comptage.green  || 0) * vs.gripPerGreenVoxel,
    accel: vs.baseAccel + (comptage.blue   || 0) * vs.accelPerBlueVoxel,
  };

  const powers = {
    aspiration: (comptage.red    || 0) * pw.aspiration.magnitudePerRedVoxel,
    phares:     (comptage.green  || 0) * pw.phares.magnitudePerGreenVoxel,
    sillage:    (comptage.blue   || 0) * pw.sillage.magnitudePerBlueVoxel,
    shield:     (comptage.orange || 0) * pw.shield.magnitudePerOrangeVoxel,
    attraction: (comptage.violet || 0) * pw.attraction.magnitudePerVioletVoxel,
    heal:       (comptage.pink   || 0) * pw.heal.magnitudePerPinkVoxel,
  };

  console.log('[voxel/stats] comptage :', _formaterComptage(comptage));
  console.log('[voxel/stats] stats :', JSON.stringify(stats));
  console.log('[voxel/stats] powers :', JSON.stringify(powers));

  if (_onDebugResult) {
    _onDebugResult({ stats, powers, comptage });
  }
  return { stats, powers };
}

/**
 * Enregistre un callback appelé après chaque calcul (pour debug-view).
 * @param {((data: object) => void) | null} cb
 */
export function onDebugResult(cb) {
  _onDebugResult = cb;
}

// Parcourt grid[x][z][y] et retourne { couleur: nombre } pour les voxels non null.
function _compterVoxels(grid) {
  const comptage = {};
  for (let x = 0; x < grid.length; x++) {
    for (let z = 0; z < (grid[x]?.length ?? 0); z++) {
      for (let y = 0; y < (grid[x][z]?.length ?? 0); y++) {
        const v = grid[x][z][y];
        if (v) comptage[v.color] = (comptage[v.color] || 0) + 1;
      }
    }
  }
  return comptage;
}

// ---- Recalcul après dommages (RACE-D03) ----

const _POWER_COLORS = ['red', 'green', 'blue', 'orange', 'violet', 'pink'];

/**
 * Recalcule les stats et les pouvoirs actifs après perte de voxels.
 * Les stats sont des ratios [0, 1] (0 = plus aucun voxel de cette couleur).
 *
 * @param {Array} newGrid      — grille mise à jour après impact (grid[x][z][y])
 * @param {Array} originalGrid — grille originale au chargement du véhicule
 * @returns {{ stats: {speed,grip,accel}, activePowers: string[], lostPowers: string[] }}
 */
export function recalcStats(newGrid, originalGrid) {
  const newCounts  = _compterVoxels(newGrid);
  const origCounts = _compterVoxels(originalGrid);

  // Ratio par couleur : 0 si couleur disparue, 1 si intacte, proportionnel sinon
  const ratio = (color) => {
    const orig = origCounts[color] || 0;
    if (orig === 0) return 1.0;
    return Math.max(0, Math.min(1, (newCounts[color] || 0) / orig));
  };

  const stats = {
    speed: ratio('red'),
    grip:  ratio('green'),
    accel: ratio('blue'),
  };

  const activePowers = _POWER_COLORS.filter(c => (newCounts[c] || 0) > 0);
  const lostPowers   = _POWER_COLORS.filter(
    c => (origCounts[c] || 0) > 0 && (newCounts[c] || 0) === 0
  );

  return { stats, activePowers, lostPowers };
}

// Couleur → pouvoir, même correspondance que computeStats().
const _POWER_PAR_COULEUR = {
  red:    'aspiration',
  green:  'phares',
  blue:   'sillage',
  orange: 'shield',
  violet: 'attraction',
  pink:   'heal',
};

/**
 * Recalcule les valeurs de pouvoir après perte de voxels.
 *
 * Perdre du bleu doit affaiblir le sillage, perdre de l'orange le bouclier, etc.
 * Chaque pouvoir est ramené au prorata des voxels de sa couleur encore en place.
 *
 * @param {Array} newGrid        — grille après impact (grid[x][z][y])
 * @param {Array} originalGrid   — grille au chargement
 * @param {object} originalPowers — pouvoirs calculés au chargement
 * @returns {object} pouvoirs restants, mêmes clés que l'original
 */
export function recalcPowers(newGrid, originalGrid, originalPowers = {}) {
  const neufs = _compterVoxels(newGrid);
  const orig  = _compterVoxels(originalGrid);

  const restants = {};
  for (const [couleur, pouvoir] of Object.entries(_POWER_PAR_COULEUR)) {
    const base = originalPowers[pouvoir] ?? 0;
    const o    = orig[couleur] ?? 0;
    restants[pouvoir] = o === 0
      ? base
      : base * Math.max(0, Math.min(1, (neufs[couleur] ?? 0) / o));
  }
  return restants;
}

function _formaterComptage(comptage) {
  const total = Object.values(comptage).reduce((s, n) => s + n, 0);
  if (total === 0) return 'aucun voxel';
  return Object.entries(comptage).map(([k, v]) => `${k}:${v}`).join(', ')
    + ` (total:${total})`;
}

async function _chargerConfig() {
  if (_configCache) return _configCache;
  const resp = await fetch('/config/gameplay.json');
  if (!resp.ok) throw new Error('Impossible de charger /config/gameplay.json');
  _configCache = await resp.json();
  return _configCache;
}
