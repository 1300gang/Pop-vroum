// Reconstruction du volume voxel depuis la feuille v2 "sandwich".
//
// Convention de coordonnées (IDENTIQUE à builder.js v1 — ne pas changer) :
//   grid[x][z][y]
//     x ∈ [0, 7] = avant-arrière (longueur, 8 lignes de grille)
//     z ∈ [0, 3] = gauche-droite (largeur, 4 colonnes de grille)
//     y ∈ [0, 3] = bas-haut (hauteur, 4 tranches)
//
// Mapping depuis la feuille sandwich :
//   slice_index  → y  (tranche 0 = DESSOUS, tranche 3 = DESSUS)
//   col_index    → z  (col 0 = gauche, col 3 = droite)
//   row_index    → x  inversé : x = (DIM_X - 1) - row_index
//                  row 0 = haut de la grille = AVANT du véhicule = x=7
//                  row 7 = bas  de la grille = ARRIÈRE            = x=0
//
// Algorithme : direct, sans union. Si la case est coloriée, le voxel existe.
//
// Note : la story S2-3 décrit x=cols et z=rows, ce qui inverse x/z par rapport
// à la convention globale. On respecte ici la convention v1 pour garantir la
// compatibilité avec wheel-detector, stats et renderer sans modification.

const DIM_X = 8; // avant-arrière
const DIM_Z = 4; // gauche-droite
const DIM_Y = 4; // bas-haut (nombre de tranches)

let _onDebugResult = null;

/**
 * Construit le volume voxel à partir des 4 tranches sandwich.
 * @param {{ slices: Array<Array<Array<string|null>>> }} param
 *   slices[sliceIndex][rowIndex][colIndex] = couleur | null
 *   sliceIndex 0 = DESSOUS (y=0), 3 = DESSUS (y=3)
 *   rowIndex   0 = haut grille = AVANT (x=7), 7 = bas = ARRIÈRE (x=0)
 *   colIndex   0 = gauche (z=0), 3 = droite (z=3)
 * @returns {Array<Array<Array<{color: string}|null>>>} grid[x][z][y]
 */
export function buildFromSandwich({ slices }) {
  _verifierDimensions(slices);

  // Initialisation : grille vide DIM_X × DIM_Z × DIM_Y
  const grid = [];
  for (let x = 0; x < DIM_X; x++) {
    grid[x] = [];
    for (let z = 0; z < DIM_Z; z++) {
      grid[x][z] = new Array(DIM_Y).fill(null);
    }
  }

  let nbVoxels = 0;
  const compteurCouleurs = {};

  slices.forEach((slice, sliceIndex) => {
    const y = sliceIndex; // tranche 0 = dessous = y=0

    slice.forEach((row, rowIndex) => {
      const x = (DIM_X - 1) - rowIndex; // row 0 = haut = avant = x=7

      row.forEach((color, colIndex) => {
        const z = colIndex; // col 0 = gauche = z=0

        if (color !== null) {
          grid[x][z][y] = { color };
          nbVoxels++;
          compteurCouleurs[color] = (compteurCouleurs[color] || 0) + 1;
        }
      });
    });
  });

  console.log('[voxel/builder-sandwich]', nbVoxels, 'voxels —', _formaterCompteur(compteurCouleurs));

  if (_onDebugResult) {
    _onDebugResult({ grid, nbVoxels, compteurCouleurs, slices });
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

function _verifierDimensions(slices) {
  if (!Array.isArray(slices) || slices.length !== DIM_Y) {
    throw new Error(`builder-sandwich: attendu ${DIM_Y} tranches, reçu ${slices?.length}`);
  }
  slices.forEach((slice, i) => {
    if (!Array.isArray(slice) || slice.length !== DIM_X) {
      throw new Error(`builder-sandwich: tranche ${i} : attendu ${DIM_X} lignes, reçu ${slice?.length}`);
    }
    slice.forEach((row, j) => {
      if (!Array.isArray(row) || row.length !== DIM_Z) {
        throw new Error(`builder-sandwich: tranche ${i}, ligne ${j} : attendu ${DIM_Z} colonnes, reçu ${row?.length}`);
      }
    });
  });
}

function _formaterCompteur(compteur) {
  const entries = Object.entries(compteur);
  if (entries.length === 0) return 'aucune couleur';
  return entries.map(([k, v]) => `${k}:${v}`).join(', ');
}
