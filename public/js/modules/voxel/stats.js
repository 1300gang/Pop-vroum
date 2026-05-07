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
    for (let z = 0; z < grid[x].length; z++) {
      for (let y = 0; y < grid[x][z].length; y++) {
        const v = grid[x][z][y];
        if (v) comptage[v.color] = (comptage[v.color] || 0) + 1;
      }
    }
  }
  return comptage;
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
