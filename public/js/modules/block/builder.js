// Module block/builder — Story 6.1
//
// Convertit une grille de symboles (8×8) en THREE.Group prêt à intégrer dans
// la scène du jeu, et en une grille de comportements physiques parallèle.
//
// Convention spatiale :
//   grid[row][col] → position locale (col + 0.5, ?, row + 0.5) dans le group
//   col = axe X (largeur), row = axe Z (profondeur, sens de progression)
//   1 case = 1 unité monde
//
// Entrée  : { grid: Array<Array<Cell|null>> }
//   Cell = string ('ramp'|'sticky'|'dur'|'boost')     — format seed (r=0)
//        | { v: string, r: 0|90|180|270 }             — format éditeur avec rotation
// Sortie  : { group: THREE.Group, physicsGrid: Array<Array<PhysicsTile|null>> }
//
// PhysicsTile :
//   ramp   → { type: 'ramp',   launchBoost, launchAngle }
//   sticky → { type: 'sticky', gripMultiplier }
//   dur    → { type: 'dur',    impassable: true }
//   boost  → { type: 'boost',  speedMultiplier, duration }

import * as THREE from '../../lib/three.module.js';

// ---- Constantes visuelles ----

const CELL   = 1;    // taille d'une case (unités monde)
const FLOOR_H = 0.15;
const WALL_H  = 1.5;
const RAMP_H  = 0.70; // hauteur du sommet de la rampe
const PAD_H   = 0.12;

const COULEURS = {
  floor:  0x888888,
  ramp:   0xb86010, // orange brûlé
  sticky: 0x2d8c50, // vert
  dur:    0x38384e, // gris bleu foncé
  boost:  0x1850d0, // bleu vif
  arrow:  0xffffff,
};

// ---- Table des comportements physiques ----

export const PHYSICS = {
  ramp:   { type: 'ramp',   launchBoost: 8.0,  launchAngle: 0.45 },
  sticky: { type: 'sticky', gripMultiplier: 0.22 },
  dur:    { type: 'dur',    impassable: true },
  boost:  { type: 'boost',  speedMultiplier: 2.0, duration: 1.5 },
};

// ---- Géométries partagées ----

const _geoFloor = new THREE.BoxGeometry(CELL, FLOOR_H, CELL);
const _geoWall  = new THREE.BoxGeometry(CELL, WALL_H,  CELL);
const _geoPad   = new THREE.BoxGeometry(CELL, PAD_H,   CELL);

// Géométrie flèche boost
const _geoArrowBar = new THREE.BoxGeometry(0.08, PAD_H + 0.05, 0.46);
const _geoArrowPt  = new THREE.BoxGeometry(0.32, PAD_H + 0.05, 0.30);

// Prisme triangulaire (rampe) — montée de -Z (entrée, bas) vers +Z (sortie, haut)
// Winding CCW depuis l'extérieur, normales calculées via computeVertexNormals().
const _geoRamp = (() => {
  const H = RAMP_H;
  const c = CELL / 2; // 0.5
  // 6 sommets
  const pos = new Float32Array([
    -c, 0, -c,  // 0 avant-gauche-bas
     c, 0, -c,  // 1 avant-droit-bas
    -c, 0,  c,  // 2 arrière-gauche-bas
     c, 0,  c,  // 3 arrière-droit-bas
    -c, H,  c,  // 4 arrière-gauche-haut
     c, H,  c,  // 5 arrière-droit-haut
  ]);
  // Faces (CCW vu de l'extérieur) :
  //   bas     : 0,1,3 / 0,3,2
  //   pente   : 0,4,5 / 0,5,1
  //   arrière : 2,3,5 / 2,5,4
  //   gauche  : 0,2,4
  //   droit   : 1,5,3
  const idx = [
    0, 1, 3,  0, 3, 2,
    0, 4, 5,  0, 5, 1,
    2, 3, 5,  2, 5, 4,
    0, 2, 4,
    1, 5, 3,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
})();

// ---- Matériaux partagés ----

const _mats = {};

function _mat(key) {
  if (!_mats[key]) {
    _mats[key] = new THREE.MeshLambertMaterial({ color: COULEURS[key] ?? 0xcccccc });
  }
  return _mats[key];
}

// ---- Parser de case ----
// Accepte l'ancien format string ET le nouveau { v, r }

function _parseCase(cell) {
  if (!cell) return { v: null, r: 0 };
  if (typeof cell === 'string') return { v: cell, r: 0 };
  return { v: cell.v ?? null, r: cell.r ?? 0 };
}

// ---- Callback debug ----

let _onDebug = null;

export function onDebugResult(cb) { _onDebug = cb; }

// ---- Fonction principale ----

/**
 * Construit le THREE.Group représentant un bloc map.
 *
 * @param {{ grid: Array<Array<string|null>> }} blockData
 * @returns {{ group: THREE.Group, physicsGrid: Array<Array<object|null>> }}
 */
export function buildBlock(blockData) {
  const { grid } = blockData;
  if (!Array.isArray(grid)) throw new Error('block/builder : grid manquante');

  const group = new THREE.Group();
  const physicsGrid = [];
  const compteurs = { floor: 0, ramp: 0, sticky: 0, dur: 0, boost: 0 };

  for (let row = 0; row < grid.length; row++) {
    physicsGrid[row] = [];
    for (let col = 0; col < grid[row].length; col++) {
      const { v: symbole, r: rotation } = _parseCase(grid[row][col]);
      physicsGrid[row][col] = PHYSICS[symbole] ?? null;

      const mesh = _buildMesh(symbole);
      mesh.position.x = col + 0.5;
      mesh.position.z = row + 0.5;
      // La rotation Y change la direction du symbole (ramp / boost).
      // Pour ramp : Math.PI corrige le miroir entre flèche UI (↑ = +Z) et prisme natif (-Z→+Z).
      const baseRot = symbole === 'ramp' ? Math.PI : 0;
      mesh.rotation.y = baseRot + THREE.MathUtils.degToRad(rotation);
      mesh.userData.blockSymbol = symbole;
      mesh.userData.blockRot    = rotation;
      mesh.userData.physics     = physicsGrid[row][col];
      group.add(mesh);

      compteurs[symbole ?? 'floor']++;
    }
  }

  _onDebug?.({ physicsGrid, compteurs, cellCount: grid.length * (grid[0]?.length ?? 0) });
  return { group, physicsGrid };
}

// ---- Meshes par symbole ----

function _buildMesh(symbole) {
  switch (symbole) {
    case 'ramp':   return _meshRamp();
    case 'sticky': return _meshSticky();
    case 'dur':    return _meshDur();
    case 'boost':  return _meshBoost();
    default:       return _meshFloor();
  }
}

function _meshFloor() {
  const m = new THREE.Mesh(_geoFloor, _mat('floor'));
  m.position.y = FLOOR_H / 2;
  return m;
}

function _meshRamp() {
  // Le prisme triangulaire est nativement en pente (y=0 à l'avant, y=RAMP_H à l'arrière).
  // Pas de rotation.x nécessaire — la forme elle-même porte la direction.
  // La rotation.y dans buildBlock() pivote la rampe dans la direction souhaitée.
  const m = new THREE.Mesh(_geoRamp, _mat('ramp'));
  // position.y = 0 : les sommets sont déjà posés sur y=0 (sol)
  return m;
}

function _meshSticky() {
  const m = new THREE.Mesh(_geoPad, _mat('sticky'));
  m.position.y = PAD_H / 2;
  return m;
}

function _meshDur() {
  const m = new THREE.Mesh(_geoWall, _mat('dur'));
  m.position.y = WALL_H / 2;
  return m;
}

function _meshBoost() {
  const pad = new THREE.Mesh(_geoPad, _mat('boost'));
  pad.position.y = PAD_H / 2;
  pad.add(_buildArrow());
  return pad;
}

// Flèche blanche sur le pad boost, pointe vers +Z
function _buildArrow() {
  const g   = new THREE.Group();
  const mat = _mat('arrow');
  const dy  = PAD_H / 2 + 0.05;

  const bar = new THREE.Mesh(_geoArrowBar, mat);
  bar.position.set(0, dy, -0.05);

  const pt = new THREE.Mesh(_geoArrowPt, mat);
  pt.position.set(0, dy, 0.28);

  g.add(bar, pt);
  return g;
}

// ---- Nettoyage ----

export function disposeSharedResources() {
  [_geoFloor, _geoWall, _geoRamp, _geoPad, _geoArrowBar, _geoArrowPt].forEach(g => g.dispose());
  Object.values(_mats).forEach(m => m.dispose());
}
