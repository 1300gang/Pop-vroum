// Reconstruction du volume voxel par union 2-sur-3 des 3 vues.
//
// Convention de coordonnées (CRITIQUE — ne pas changer sans concertation) :
//   grid[x][z][y]
//     x ∈ [0, 7] = avant-arrière (longueur, 8 cases)
//     z ∈ [0, 3] = gauche-droite (largeur, 4 cases)
//     y ∈ [0, 3] = bas-haut (hauteur, 4 cases)
//
// Convention des grilles d'entrée (produites par color-reader) :
//   face[z][row]    — vue de face,   z varie horizontalement, row=0 = haut de l'image
//   profile[x][row] — vue de profil, x varie horizontalement, row=0 = haut de l'image
//   top[x][z]       — vue de dessus, x varie horizontalement, z varie verticalement
//
// ATTENTION : row=0 dans l'image = HAUT du dessin = HAUT du véhicule = y=(DIM_Y-1) en voxel.
// La conversion se fait ici : y_voxel = (DIM_Y - 1) - row_image.
//
// Règle d'existence d'un voxel (x, z, y) :
//   au moins 2 des 3 vues correspondantes sont coloriées (non null).
//
// Couleur du voxel :
//   couleur majoritaire parmi les vues confirmantes ;
//   en cas d'égalité, on privilégie la face (vue la plus identitaire).

const DIM_X = 8;
const DIM_Z = 4;
const DIM_Y = 4;

let _onDebugResult = null;

/**
 * Construit le volume voxel à partir des 3 vues.
 * @param {{
 *   face:    Array<Array<string|null>>, // [z][y]
 *   profile: Array<Array<string|null>>, // [x][y]
 *   top:     Array<Array<string|null>>, // [x][z]
 * }} vues
 * @returns {Array<Array<Array<{color: string}|null>>>} grid[x][z][y]
 */
export function buildVoxelGrid({ face, profile, top }) {
  _verifierDimensions({ face, profile, top });

  const grid = [];
  let nbVoxels = 0;
  const compteurCouleurs = {};

  for (let x = 0; x < DIM_X; x++) {
    grid[x] = [];
    for (let z = 0; z < DIM_Z; z++) {
      grid[x][z] = [];
      for (let y = 0; y < DIM_Y; y++) {
        const row      = (DIM_Y - 1) - y; // row=0 image = haut dessin = y max voxel
        const cFace    = face[z]?.[row]    ?? null;
        const cProfile = profile[x]?.[row] ?? null;
        const cTop     = top[x]?.[z]       ?? null;

        const voxel = _resoudre(cFace, cProfile, cTop);
        grid[x][z][y] = voxel;

        if (voxel) {
          nbVoxels++;
          compteurCouleurs[voxel.color] = (compteurCouleurs[voxel.color] || 0) + 1;
        }
      }
    }
  }

  console.log('[voxel/builder]', nbVoxels, 'voxels —', _formaterCompteur(compteurCouleurs));

  if (_onDebugResult) {
    _onDebugResult({ grid, nbVoxels, compteurCouleurs, vues: { face, profile, top } });
  }
  return grid;
}

/**
 * Enregistre un callback appelé après chaque construction (pour debug-view).
 * @param {((data: object) => void) | null} cb
 */
export function onDebugResult(cb) {
  _onDebugResult = cb;
}

// Décide si un voxel existe et avec quelle couleur, à partir des 3 lectures.
// Règle : au moins 2 vues non null. Couleur majoritaire ; égalité → face.
function _resoudre(cFace, cProfile, cTop) {
  const confirmees = [cFace, cProfile, cTop].filter((c) => c !== null);
  if (confirmees.length < 2) return null;

  const compte = {};
  for (const c of confirmees) compte[c] = (compte[c] || 0) + 1;

  // Maximum
  let maxN = 0;
  for (const n of Object.values(compte)) if (n > maxN) maxN = n;

  // Si la face fait partie des couleurs au max, elle l'emporte (tie-break).
  if (cFace !== null && compte[cFace] === maxN) {
    return { color: cFace };
  }

  // Sinon, première couleur atteignant le max (cas où face est null/désaccord).
  for (const [c, n] of Object.entries(compte)) {
    if (n === maxN) return { color: c };
  }
  return null; // inatteignable
}

function _verifierDimensions({ face, profile, top }) {
  if (!face    || face.length    !== DIM_Z) throw new Error(`face: attendu ${DIM_Z} colonnes, reçu ${face?.length}`);
  if (!profile || profile.length !== DIM_X) throw new Error(`profile: attendu ${DIM_X} colonnes, reçu ${profile?.length}`);
  if (!top     || top.length     !== DIM_X) throw new Error(`top: attendu ${DIM_X} colonnes, reçu ${top?.length}`);
  if (face[0]?.length    !== DIM_Y) throw new Error(`face: attendu ${DIM_Y} lignes`);
  if (profile[0]?.length !== DIM_Y) throw new Error(`profile: attendu ${DIM_Y} lignes`);
  if (top[0]?.length     !== DIM_Z) throw new Error(`top: attendu ${DIM_Z} lignes`);
}

function _formaterCompteur(compteur) {
  const entries = Object.entries(compteur);
  if (entries.length === 0) return 'aucune couleur';
  return entries.map(([k, v]) => `${k}:${v}`).join(', ');
}
