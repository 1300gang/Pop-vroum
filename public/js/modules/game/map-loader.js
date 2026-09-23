// Chargement dynamique de la map par colonnes de blocmaps.
//
// Instancie les meshes Three.js uniquement pour les colonnes proches
// du véhicule (±LOAD_MARGIN). Les colonnes éloignées sont libérées.
//
// RACE-F01 : culling frustum par bloc à l'intérieur des colonnes chargées.
// Les blocs hors frustum sont retirés de la scène (pas seulement cachés).
// Un buffer d'1 bloc autour du frustum est conservé pour éviter les pop-ins.
//
// Les blocs seed sont conçus pour un déplacement en Z. Comme les
// véhicules avancent désormais en +X, on applique une rotation 90° CW
// lors de la lecture des cellules :
//   cellule rotée (rx, rz) = original grid[BLOCK_SIZE-1-rx][rz]
//
// API publique :
//   init(scene, map, buildMeshFn)  — prépare le loader avec la map
//   update(vehicleX, camera?)      — charge/décharge les colonnes + culling frustum
//   getActiveBlocks()              — retourne les blocs chargés (pour collision)
//   dispose()                      — libère tout

import * as THREE from '../../lib/three.module.js';
import { BLOCK_SIZE } from './map-generator.js';

const LOAD_MARGIN = 2; // colonnes chargées = colonne courante ± LOAD_MARGIN

let _scene          = null;
let _map            = null;
let _buildMesh      = null;
let _renderDistance = Infinity; // SOLO-07 : distance Chebyshev max (en blocs)
let _loadedCols  = new Map(); // col → true (présence dans le pool chargé)
let _blockMeshes = new Map(); // `${col},${row}` → { group, sphere, inScene }
let _blocksByCol = new Map(); // col → [{ position, rotatedGrid }]

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

  // Pré-indexer les blocs par colonne + pré-calculer les grilles rotées
  _blocksByCol.clear();
  for (const bloc of map.blocks) {
    const col = bloc.col;
    if (!_blocksByCol.has(col)) _blocksByCol.set(col, []);

    // Plus aucune rotation ici : le pool est pivoté une fois au chargement
    // (map-generator.prepareBlockForGame). La rotation appliquée à ce stade
    // déplaçait les couloirs APRÈS l'assemblage et murait une liaison sur deux.
    _blocksByCol.get(col).push({
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

  const colMin = Math.max(0, currentCol - LOAD_MARGIN);
  const colMax = Math.min(_map.gridCols - 1, currentCol + LOAD_MARGIN);

  // Charger les colonnes nécessaires
  for (let col = colMin; col <= colMax; col++) {
    if (!_loadedCols.has(col)) {
      _chargerColonne(col);
    }
  }

  // Décharger les colonnes hors-portée (snapshot avant suppression pour éviter mutation pendant itération)
  const aDecharger = [];
  for (const col of _loadedCols.keys()) {
    if (col < colMin || col > colMax) aDecharger.push(col);
  }
  for (const col of aDecharger) _dechargerColonne(col);

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
 * Retourne les blocs actuellement chargés (pour la détection de collision).
 * Chaque bloc a { position: [wx, wz], grid: rotatedGrid }.
 * Inclut les blocs hors-frustum (la collision se base sur le pool chargé).
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
 * Retourne le nombre total de blocs chargés (pool colonnes ± LOAD_MARGIN).
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

  // RACE-F01 : construire un group par bloc (pas un group pour toute la colonne)
  // pour permettre le culling frustum individuel.
  for (const bloc of blocs) {
    const key = `${col},${bloc.row}`;
    if (_blockMeshes.has(key)) continue;

    const group  = _buildMesh([bloc], _map.blockScale);
    const sphere = _sphereDeBloc(bloc);

    // Ajout immédiat à la scène — le culling frustum l'enlèvera si nécessaire
    _scene.add(group);
    _blockMeshes.set(key, { group, sphere, inScene: true });
  }

  _loadedCols.set(col, true);
}

function _dechargerColonne(col) {
  const blocs = _blocksByCol.get(col);
  if (blocs) {
    for (const bloc of blocs) {
      const key = `${col},${bloc.row}`;
      const entry = _blockMeshes.get(key);
      if (!entry) continue;
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
  }
  _loadedCols.delete(col);
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
