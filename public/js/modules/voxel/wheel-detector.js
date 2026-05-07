// Détection automatique des positions des 4 roues d'un véhicule voxel.
//
// Conventions d'entrée (produites par color-reader, mêmes que voxel/builder.js) :
//   profile[x][row] — vue de profil (8×4),  x = avant-arrière, row=0 = haut image = haut véhicule
//   top[x][z]       — vue de dessus (8×4),  x = avant-arrière, z = gauche-droite
//
// Algorithme (cf. architecture.md §3) :
//   1) Sur la rangée du BAS du profil (row = DIM_Y-1 = 3 dans l'image), trouver le x
//      extrême arrière (premier x non null) et avant (dernier x non null).
//      Si la rangée est entièrement vide, fallback aux extrémités du volume (x=0 et x=7).
//   2) Sur la vue de dessus, à chaque x retenu, mesurer l'écartement en z :
//      [z_min, z_max] des cases coloriées de la colonne. Si la colonne est vide,
//      fallback à [0, 3] (largeur max).
//   3) Construire 4 roues à y = -0.3 (en coords voxel) pour qu'elles dépassent
//      légèrement sous le châssis lors du rendu.
//
// Direction : x bas = arrière, x haut = avant (cohérent avec le pseudocode).

const DIM_X  = 8;
const DIM_Z  = 4;
const DIM_Y  = 4;
const Y_ROUE = -0.3; // coords voxel : roues légèrement saillantes sous le châssis

let _onDebugResult = null;

/**
 * Détecte les 4 positions de roues.
 * @param {{
 *   profileGrid: Array<Array<string|null>>, // [x][y], 8×4
 *   topGrid:     Array<Array<string|null>>, // [x][z], 8×4
 * }} vues
 * @returns {Array<{x: number, y: number, z: number}>} 4 positions
 *   ordre : [arrière-gauche, arrière-droite, avant-gauche, avant-droite]
 */
export function detectWheels({ profileGrid, topGrid }) {
  _verifierDimensions(profileGrid, topGrid);

  const { backX, frontX, fallbackProfile } = _trouverAvantArriere(profileGrid);
  const [backLeft,  backRight,  fallbackBack]  = _trouverLargeurEnX(topGrid, backX);
  const [frontLeft, frontRight, fallbackFront] = _trouverLargeurEnX(topGrid, frontX);

  const roues = [
    { x: backX,  y: Y_ROUE, z: backLeft  },
    { x: backX,  y: Y_ROUE, z: backRight },
    { x: frontX, y: Y_ROUE, z: frontLeft },
    { x: frontX, y: Y_ROUE, z: frontRight },
  ];

  const fallbacks = [];
  if (fallbackProfile) fallbacks.push('profil-vide');
  if (fallbackBack)    fallbacks.push('top-arrière-vide');
  if (fallbackFront)   fallbacks.push('top-avant-vide');

  console.log('[wheel-detector] backX=' + backX, 'frontX=' + frontX,
    '— roues:', roues.map(r => `(${r.x},${r.z})`).join(' '),
    fallbacks.length ? `— fallbacks: ${fallbacks.join(', ')}` : '');

  if (_onDebugResult) {
    _onDebugResult({ wheels: roues, backX, frontX, fallbacks });
  }
  return roues;
}

/**
 * Enregistre un callback appelé après chaque détection (pour debug-view).
 * @param {((data: object) => void) | null} cb
 */
export function onDebugResult(cb) {
  _onDebugResult = cb;
}

// Détermine x_arrière et x_avant à partir de la rangée du bas du profil.
// row = DIM_Y-1 = 3 dans l'image (bas de l'image = bas du véhicule).
// Fallback : extrémités du volume si la rangée est entièrement vide.
function _trouverAvantArriere(profileGrid) {
  const bottomRow = profileGrid.map((col) => col[DIM_Y - 1]); // longueur DIM_X, indexé par x
  const filledX   = bottomRow
    .map((c, x) => (c !== null ? x : -1))
    .filter((x) => x >= 0);

  if (filledX.length === 0) {
    return { backX: 0, frontX: DIM_X - 1, fallbackProfile: true };
  }
  return {
    backX:  filledX[0],
    frontX: filledX[filledX.length - 1],
    fallbackProfile: false,
  };
}

// Pour un x donné, retourne [z_min, z_max, fallback?] sur la vue de dessus.
function _trouverLargeurEnX(topGrid, x) {
  const colonne = topGrid[x]; // longueur DIM_Z, indexé par z
  const filledZ = colonne
    .map((c, z) => (c !== null ? z : -1))
    .filter((z) => z >= 0);

  if (filledZ.length === 0) {
    return [0, DIM_Z - 1, true]; // fallback : largeur maximale
  }
  return [Math.min(...filledZ), Math.max(...filledZ), false];
}

function _verifierDimensions(profile, top) {
  if (!profile || profile.length !== DIM_X) throw new Error(`profileGrid: ${DIM_X} colonnes attendues`);
  if (!top     || top.length     !== DIM_X) throw new Error(`topGrid: ${DIM_X} colonnes attendues`);
  if (profile[0]?.length !== 4)              throw new Error(`profileGrid: 4 lignes attendues`);
  if (top[0]?.length     !== DIM_Z)          throw new Error(`topGrid: ${DIM_Z} lignes attendues`);
}
