// Chargement dynamique de la map par blocmaps.
//
// Instancie les meshes Three.js uniquement pour les blocs proches du véhicule :
// un anneau de ±LOAD_MARGIN blocs en colonne ET en rangée (25 blocs au plus,
// quelle que soit la taille de la map). Les blocs éloignés sont libérés.
// Sans position Z (pages figées), repli sur des colonnes entières, comme avant.
//
// RACE-F01 : culling frustum par bloc à l'intérieur des blocs chargés.
// Les blocs hors frustum sont retirés de la scène (pas seulement cachés).
// Un buffer d'1 bloc autour du frustum est conservé pour éviter les pop-ins.
//
// Plus aucune rotation ici : le pool est pivoté une fois au chargement
// (map-generator.prepareBlockForGame).
//
// API publique :
//   init(scene, map, buildMeshFn)  — prépare le loader avec la map
//   update(vehicleX, camera?)      — charge/décharge les colonnes + culling frustum
//   getActiveBlocks()              — retourne les blocs chargés (pour collision)
//   dispose()                      — libère tout

import * as THREE from '../../lib/three.module.js';
import { BLOCK_SIZE } from './map-generator.js';

const LOAD_MARGIN = 2; // blocs chargés = bloc courant ± LOAD_MARGIN (en colonne et en rangée)

let _scene          = null;
let _map            = null;
let _buildMesh      = null;
let _renderDistance = Infinity; // SOLO-07 : distance Chebyshev max (en blocs)
let _blockMeshes = new Map(); // `${col},${row}` → { group, sphere, inScene, bloc }
let _blocksByKey = new Map(); // `${col},${row}` → bloc

// Réutilisés chaque frame pour éviter les allocations
const _frustum    = new THREE.Frustum();
const _projMatrix = new THREE.Matrix4();

/**
 * Initialise le loader.
 * @param {THREE.Scene} scene
 * @param {object} map — MapData de map-generator
 * @param {function} buildMeshFn — (blocks, blockScale) → THREE.Group
 */
export function init(scene, map, buildMeshFn, renderDistance = Infinity) {
  dispose();
  _scene          = scene;
  _map            = map;
  _buildMesh      = buildMeshFn;
  _renderDistance = renderDistance;

  // Pré-indexer les blocs par case
  _blocksByKey.clear();
  for (const bloc of map.blocks) {
    _blocksByKey.set(`${bloc.col},${bloc.row}`, {
      blockId:       bloc.blockId,
      name:          bloc.name,
      col:           bloc.col,
      row:           bloc.row,
      position:      bloc.position,
      grid:          bloc.grid,
      elevationGrid: bloc.elevationGrid ?? null,
    });
  }
}

/**
 * Calcule la sphère englobante d'un bloc pour le frustum culling.
 * Le rayon est légèrement supérieur à la demi-diagonale pour servir de buffer.
 * @param {object} bloc — { position: [wx, wz] }
 * @returns {THREE.Sphere}
 */
function _sphereDeBloc(bloc) {
  const bs = _map.blockScale ?? 2;
  const taille = BLOCK_SIZE * bs;
  const cx = bloc.position[0] + taille / 2;
  const cz = bloc.position[1] + taille / 2;
  // Rayon = demi-diagonale + 1 bloc de buffer (évite les pop-ins)
  const rayon = (taille * Math.SQRT2) / 2 + taille;
  return new THREE.Sphere(new THREE.Vector3(cx, 0, cz), rayon);
}

/**
 * Met à jour les colonnes chargées et applique le culling frustum + distance.
 * @param {number} vehicleX — position X monde du véhicule (ou barycentre)
 * @param {THREE.Camera} [camera] — si fourni, active le culling frustum (RACE-F01)
 * @param {number} [vehicleZ] — si fourni, active le culling Chebyshev (SOLO-07)
 */
export function update(vehicleX, camera, vehicleZ) {
  if (!_map || !_scene) return;

  const bs = _map.blockScale ?? 2;
  const blocmapSize = BLOCK_SIZE * bs;
  const currentCol = Math.floor(vehicleX / blocmapSize);
  const currentRow = vehicleZ !== undefined ? Math.floor(vehicleZ / blocmapSize) : -1;

  // L'anneau couvre au moins la distance de rendu : charger moins que ce qu'on
  // affiche ferait apparaître des trous en bord d'écran.
  const marge  = Number.isFinite(_renderDistance) ? Math.max(LOAD_MARGIN, _renderDistance) : LOAD_MARGIN;
  const colMin = Math.max(0, currentCol - marge);
  const colMax = Math.min(_map.gridCols - 1, currentCol + marge);
  // Sans Z connu : toutes les rangées (colonnes entières, ancien comportement)
  const rowMin = currentRow >= 0 ? Math.max(0, currentRow - marge) : 0;
  const rowMax = currentRow >= 0 ? Math.min(_map.gridRows - 1, currentRow + marge) : _map.gridRows - 1;

  // Charger les blocs de l'anneau
  for (let col = colMin; col <= colMax; col++) {
    for (let row = rowMin; row <= rowMax; row++) {
      const key = `${col},${row}`;
      if (!_blockMeshes.has(key) && _blocksByKey.has(key)) _chargerBloc(key);
    }
  }

  // Décharger ceux qui en sortent (liste figée avant suppression)
  const aDecharger = [];
  for (const [key, entry] of _blockMeshes) {
    const { col, row } = entry.bloc;
    if (col < colMin || col > colMax || row < rowMin || row > rowMax) aDecharger.push(key);
  }
  for (const key of aDecharger) _dechargerBloc(key);

  // RACE-F01 : culling frustum par bloc + SOLO-07 : distance Chebyshev
  const doCulling = camera || _renderDistance < Infinity;
  if (doCulling) {
    if (camera) {
      _projMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_projMatrix);
    }

    const doDistance = _renderDistance < Infinity && currentRow >= 0;

    for (const [key, entry] of _blockMeshes.entries()) {
      let visible = camera ? _frustum.intersectsSphere(entry.sphere) : true;

      // Distance de Chebyshev : max(|dx|, |dz|) ≤ RENDER_DISTANCE
      if (doDistance) {
        const sep = key.indexOf(',');
        const kc  = parseInt(key.slice(0, sep), 10);
        const kr  = parseInt(key.slice(sep + 1), 10);
        visible   = visible && Math.max(Math.abs(kc - currentCol), Math.abs(kr - currentRow)) <= _renderDistance;
      }

      if (visible && !entry.inScene) {
        _scene.add(entry.group);
        entry.inScene = true;
      } else if (!visible && entry.inScene) {
        _scene.remove(entry.group);
        entry.inScene = false;
      }
    }
  }
}

/**
 * Change la distance de rendu en blocs (Chebyshev). La page de jeu l'élargit
 * quand la caméra dézoome pour cadrer tout le groupe, sinon des trous
 * apparaîtraient en bord d'écran.
 * @param {number} n
 */
export function setRenderDistance(n) {
  _renderDistance = n;
}

/**
 * Retourne les blocs actuellement chargés (pour la détection de collision).
 * Chaque bloc a { position: [wx, wz], grid: rotatedGrid }.
 * Inclut les blocs hors-frustum (la collision se base sur le pool chargé).
 * @returns {Array<object>}
 */
export function getActiveBlocks() {
  const result = [];
  for (const entry of _blockMeshes.values()) result.push(entry.bloc);
  return result;
}

/**
 * Retourne le nombre de blocs actuellement dans la scène (utile pour mesurer le gain RACE-F01).
 * @returns {number}
 */
export function getVisibleBlockCount() {
  let n = 0;
  for (const entry of _blockMeshes.values()) {
    if (entry.inScene) n++;
  }
  return n;
}

/**
 * Retourne le nombre total de blocs chargés (anneau ± LOAD_MARGIN).
 * @returns {number}
 */
export function getLoadedBlockCount() {
  return _blockMeshes.size;
}

/**
 * Libère toutes les ressources.
 */
export function dispose() {
  for (const entry of _blockMeshes.values()) {
    if (entry.inScene && _scene) _scene.remove(entry.group);
    entry.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
        else o.material.dispose();
      }
    });
  }
  _blockMeshes.clear();
  _blocksByKey.clear();
  _scene    = null;
  _map      = null;
  _buildMesh = null;
}

// ---- Internes ----

function _chargerBloc(key) {
  const bloc   = _blocksByKey.get(key);
  // Un group par bloc, pour le culling frustum individuel (RACE-F01)
  const group  = _buildMesh([bloc], _map.blockScale);
  const sphere = _sphereDeBloc(bloc);

  // Ajout immédiat à la scène — le culling frustum l'enlèvera si nécessaire
  _scene.add(group);
  _blockMeshes.set(key, { group, sphere, inScene: true, bloc });
}

function _dechargerBloc(key) {
  const entry = _blockMeshes.get(key);
  if (!entry) return;
  if (entry.inScene) _scene.remove(entry.group);
  entry.group.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
      else o.material.dispose();
    }
  });
  _blockMeshes.delete(key);
}

// Correspondance direction après rotation 90° CW : N→E→S→O→N
const _DIR_CW = { N: 'E', E: 'S', S: 'O', O: 'N' };

/**
 * Rotation 90° horaire d'une grille 8×8.
 * Utilisée pour grid (string|null|object) ET pour elevationGrid (number).
 * Pour les cellules objets avec un champ `direction` (ex: rampe_pente), la direction
 * est aussi pivotée de 90° CW pour rester cohérente avec la nouvelle orientation.
 *
 * @param {Array<Array<any>>} grid — 8×8
 * @param {any} fillValue — valeur initiale des cellules (null pour grid, 0 pour elevationGrid)
 * @returns {Array<Array<any>>} — 8×8 rotée
 */
function _rotate90CW(grid, fillValue = null) {
  const n = grid.length; // 8
  const result = Array.from({ length: n }, () => Array(n).fill(fillValue));
  for (let gz = 0; gz < n; gz++) {
    for (let gx = 0; gx < n; gx++) {
      let cell = grid[gz][gx];
      // Pivote le champ direction des cellules objets (ex: rampe_pente)
      if (cell && typeof cell === 'object' && cell.direction) {
        cell = { ...cell, direction: _DIR_CW[cell.direction] ?? cell.direction };
      }
      // V4-02 : idem pour les rampes directionnelles en chaîne (ramp_n/s/e/o),
      // sinon leur sens de montée ne suit pas la rotation de la grille.
      if (typeof cell === 'string') {
        const m = /^ramp_([nseo])$/.exec(cell);
        if (m) cell = `ramp_${(_DIR_CW[m[1].toUpperCase()] ?? '').toLowerCase()}`;
      }
      result[gx][n - 1 - gz] = cell;
    }
  }
  return result;
}
