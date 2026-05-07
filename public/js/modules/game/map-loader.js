// Chargement dynamique de la map par colonnes de blocmaps.
//
// Instancie les meshes Three.js uniquement pour les colonnes proches
// du véhicule (±LOAD_MARGIN). Les colonnes éloignées sont libérées.
//
// Les blocs seed sont conçus pour un déplacement en Z. Comme les
// véhicules avancent désormais en +X, on applique une rotation 90° CW
// lors de la lecture des cellules :
//   cellule rotée (rx, rz) = original grid[BLOCK_SIZE-1-rx][rz]
//
// API publique :
//   init(scene, map, buildMeshFn)  — prépare le loader avec la map
//   update(vehicleX)               — charge/décharge les colonnes
//   getActiveBlocks()              — retourne les blocs chargés (pour collision)
//   dispose()                      — libère tout

import { BLOCK_SIZE } from './map-generator.js';

const LOAD_MARGIN = 2; // colonnes chargées = colonne courante ± LOAD_MARGIN

let _scene      = null;
let _map        = null;
let _buildMesh  = null;
let _loadedCols = new Map(); // col → THREE.Group
let _blocksByCol = new Map(); // col → [{ position, rotatedGrid }]

/**
 * Initialise le loader.
 * @param {THREE.Scene} scene
 * @param {object} map — MapData de map-generator
 * @param {function} buildMeshFn — (blocks, blockScale) → THREE.Group
 */
export function init(scene, map, buildMeshFn) {
  dispose();
  _scene     = scene;
  _map       = map;
  _buildMesh = buildMeshFn;

  // Pré-indexer les blocs par colonne + pré-calculer les grilles rotées
  _blocksByCol.clear();
  for (const bloc of map.blocks) {
    const col = bloc.col;
    if (!_blocksByCol.has(col)) _blocksByCol.set(col, []);

    const rotated = _rotate90CW(bloc.grid);
    _blocksByCol.get(col).push({
      blockId:  bloc.blockId,
      name:     bloc.name,
      col:      bloc.col,
      row:      bloc.row,
      position: bloc.position,
      grid:     rotated,
    });
  }
}

/**
 * Met à jour les colonnes chargées selon la position X du véhicule.
 * @param {number} vehicleX — position X monde du véhicule (ou barycentre)
 */
export function update(vehicleX) {
  if (!_map || !_scene) return;

  const bs = _map.blockScale ?? 2;
  const blocmapSize = BLOCK_SIZE * bs;
  const currentCol = Math.floor(vehicleX / blocmapSize);

  const colMin = Math.max(0, currentCol - LOAD_MARGIN);
  const colMax = Math.min(_map.gridCols - 1, currentCol + LOAD_MARGIN);

  // Charger les colonnes nécessaires
  for (let col = colMin; col <= colMax; col++) {
    if (!_loadedCols.has(col)) {
      _chargerColonne(col);
    }
  }

  // Décharger les colonnes hors-portée
  for (const [col, group] of _loadedCols) {
    if (col < colMin || col > colMax) {
      _dechargerColonne(col, group);
    }
  }
}

/**
 * Retourne les blocs actuellement chargés (pour la détection de collision).
 * Chaque bloc a { position: [wx, wz], grid: rotatedGrid }.
 * @returns {Array<object>}
 */
export function getActiveBlocks() {
  const result = [];
  for (const col of _loadedCols.keys()) {
    const blocs = _blocksByCol.get(col);
    if (blocs) result.push(...blocs);
  }
  return result;
}

/**
 * Libère toutes les ressources.
 */
export function dispose() {
  if (_loadedCols.size > 0) {
    for (const [col, group] of _loadedCols) {
      _dechargerColonne(col, group);
    }
  }
  _loadedCols.clear();
  _blocksByCol.clear();
  _scene    = null;
  _map      = null;
  _buildMesh = null;
}

// ---- Internes ----

function _chargerColonne(col) {
  const blocs = _blocksByCol.get(col);
  if (!blocs || blocs.length === 0) return;

  const group = _buildMesh(blocs, _map.blockScale);
  _scene.add(group);
  _loadedCols.set(col, group);
}

function _dechargerColonne(col, group) {
  _scene.remove(group);
  group.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
      else o.material.dispose();
    }
  });
  _loadedCols.delete(col);
}

/**
 * Rotation 90° horaire de la grille 8×8.
 * Original : grid[gz][gx], déplacement en +Z
 * Roté    : result[rx][rz] = grid[BLOCK_SIZE-1-rz][rx], déplacement en +X
 *
 * Vérification : la rangée d'entrée originale (gz=0) devient la colonne
 * gauche (rx=*, rz=0) après rotation — ce qui est l'entrée côté -X.
 *
 * @param {Array<Array<string|null>>} grid — 8×8
 * @returns {Array<Array<string|null>>} — 8×8 rotée
 */
function _rotate90CW(grid) {
  const n = grid.length; // 8
  const result = Array.from({ length: n }, () => Array(n).fill(null));
  for (let gz = 0; gz < n; gz++) {
    for (let gx = 0; gx < n; gx++) {
      // 90° CW : (gx, gz) → (n-1-gz, gx)
      result[gx][n - 1 - gz] = grid[gz][gx];
    }
  }
  return result;
}
