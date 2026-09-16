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

const CELL          = 1;     // taille d'une case (unités monde)
const FLOOR_H       = 0.15;
const WALL_H        = 1.5;
const RAMP_H        = 0.70;  // hauteur du sommet de la rampe
const PAD_H         = 0.12;
// Hauteur du sol de plateau (RACE-C01) — valeur miroir de config/layout.json PLATEAU_HEIGHT
const PLATEAU_HEIGHT = 0.5;
// Épaisseur du mur de transition entre élévation 0 et 1
const TRANSITION_THICK = 0.06;

const COULEURS = {
  floor:        0x888888,
  ramp:         0xb86010, // orange brûlé
  rampe_pente:  0xd07830, // orange pente douce
  rampe_bosse:  0xe8a020, // orange vif — bosse courte (RACE-C05)
  sticky:       0x2d8c50, // vert
  dur:          0x38384e, // gris bleu foncé
  boost:        0x1850d0, // bleu vif
  arrow:        0xffffff,
  plateau:      0x4a4a60, // sol de plateau
  transition:   0x555570, // mur de transition plateau
  // SOLO-04
  ramp_n:       0x8888dd,
  ramp_s:       0x8888dd,
  ramp_e:       0x8888dd,
  ramp_o:       0x8888dd,
  bump:         0xcc8844,
  movable:      0xff6644,
  pole:         0xeeeeee,
};

// ---- Table des comportements physiques ----

export const PHYSICS = {
  ramp:        { type: 'ramp',        launchBoost: 8.0,  launchAngle: 0.45 },
  rampe_pente: { type: 'rampe_pente', elevationTransition: true },
  rampe_bosse: { type: 'rampe_bosse', bump: true },
  sticky: { type: 'sticky', gripMultiplier: 0.22 },
  dur:    { type: 'dur',    impassable: true },
  boost:  { type: 'boost',  speedMultiplier: 2.0, duration: 1.5 },
  // SOLO-04
  ramp_n: { type: 'ramp_n', passable: true },
  ramp_s: { type: 'ramp_s', passable: true },
  ramp_e: { type: 'ramp_e', passable: true },
  ramp_o: { type: 'ramp_o', passable: true },
  bump:    { type: 'bump',    bump: true },
  movable: { type: 'movable', impassable: true, movable: true },
  pole:    { type: 'pole',    impassable: true, pole: true },
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
// Accepte l'ancien format string, { v, r } et le nouveau { type, direction, ... }

function _parseCase(cell) {
  if (!cell) return { v: null, r: 0, extra: null };
  if (typeof cell === 'string') return { v: cell, r: 0, extra: null };
  // Format rampe_pente : { type, direction, elevation_start, elevation_end }
  if (cell.type) return { v: cell.type, r: 0, extra: cell };
  return { v: cell.v ?? null, r: cell.r ?? 0, extra: null };
}

// ---- Callback debug ----

let _onDebug = null;

export function onDebugResult(cb) { _onDebug = cb; }

// ---- Fonction principale ----

/**
 * Construit le THREE.Group représentant un bloc map.
 * Supporte le champ optionnel `elevationGrid` (RACE-C01) :
 *   - les cellules à élévation 1 sont décalées de PLATEAU_HEIGHT vers le haut
 *   - des murs de transition sont ajoutés aux bords des plateaux
 *
 * @param {{ grid: Array<Array<string|null>>, elevationGrid?: Array<Array<number>> }} blockData
 * @returns {{ group: THREE.Group, physicsGrid: Array<Array<object|null>> }}
 */
export function buildBlock(blockData) {
  const { grid, elevationGrid } = blockData;
  if (!Array.isArray(grid)) throw new Error('block/builder : grid manquante');

  const group = new THREE.Group();
  const physicsGrid = [];
  const compteurs = { floor: 0, ramp: 0, sticky: 0, dur: 0, boost: 0 };

  for (let row = 0; row < grid.length; row++) {
    physicsGrid[row] = [];
    for (let col = 0; col < grid[row].length; col++) {
      const { v: symbole, r: rotation, extra } = _parseCase(grid[row][col]);
      physicsGrid[row][col] = PHYSICS[symbole] ?? null;

      const elevation = elevationGrid?.[row]?.[col] ?? 0;

      // Sol de plateau : cellule null à élévation 1 → plancher surélevé
      if (!symbole && elevation > 0) {
        const m = _meshPlateauFloor();
        m.position.set(col + 0.5, PLATEAU_HEIGHT * elevation + FLOOR_H / 2, row + 0.5);
        group.add(m);
        continue;
      }

      if (!symbole) continue; // null à élévation 0 = route, pas de mesh

      let mesh;
      if (symbole === 'rampe_pente' && extra) {
        mesh = _meshRampePente(extra.direction ?? 'E', extra.elevation_start ?? 0, extra.elevation_end ?? 1);
        mesh.position.set(col + 0.5, 0, row + 0.5);
      } else {
        mesh = _buildMesh(symbole);
        mesh.position.x = col + 0.5;
        mesh.position.z = row + 0.5;
        // Décalage vertical pour les cellules surélevées
        mesh.position.y += PLATEAU_HEIGHT * elevation;
        // Pour ramp : Math.PI corrige le miroir entre flèche UI et prisme natif.
        const baseRot = symbole === 'ramp' ? Math.PI : 0;
        mesh.rotation.y = baseRot + THREE.MathUtils.degToRad(rotation);
      }
      mesh.userData.blockSymbol = symbole;
      mesh.userData.blockRot    = rotation;
      mesh.userData.physics     = physicsGrid[row][col];
      group.add(mesh);

      compteurs[symbole ?? 'floor']++;
    }
  }

  // Murs de transition plateau (RACE-C02) : bords entre élévation 1 et 0
  if (elevationGrid) {
    _ajouterMursTransition(group, grid, elevationGrid);
  }

  _onDebug?.({ physicsGrid, compteurs, cellCount: grid.length * (grid[0]?.length ?? 0) });
  return { group, physicsGrid };
}

// ---- Meshes par symbole ----

function _buildMesh(symbole) {
  switch (symbole) {
    case 'ramp':        return _meshRamp();
    case 'rampe_bosse': return _meshRampeBosse();
    case 'sticky':      return _meshSticky();
    case 'dur':         return _meshDur();
    case 'boost':       return _meshBoost();
    // SOLO-04
    case 'ramp_n':  return _meshRampDir('N');
    case 'ramp_s':  return _meshRampDir('S');
    case 'ramp_e':  return _meshRampDir('E');
    case 'ramp_o':  return _meshRampDir('O');
    case 'bump':    return _meshBump();
    case 'movable': return _meshMovable();
    case 'pole':    return _meshPole();
    default:        return _meshFloor();
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

/**
 * Prisme incliné pour rampe_pente (RACE-C04).
 * Géométrie : un quadrilatère incliné de yLow à yHigh sur toute la cellule.
 * La direction détermine l'axe de montée :
 *   E = +X (vehicle direction), O = -X, S = +Z, N = -Z
 *
 * @param {'N'|'S'|'E'|'O'} direction
 * @param {number} elevStart — élévation de l'extrémité basse (0 ou 1)
 * @param {number} elevEnd   — élévation de l'extrémité haute (0 ou 1)
 */
function _meshRampePente(direction, elevStart, elevEnd) {
  const yLow  = elevStart * PLATEAU_HEIGHT;
  const yHigh = elevEnd   * PLATEAU_HEIGHT;
  const c = CELL / 2; // 0.5

  // Wedge : 6 sommets, même topologie que _geoRamp mais hauteurs paramétrées
  // Basse extrémité à -Z (avant), haute à +Z (arrière) = direction par défaut 'S'
  const pos = new Float32Array([
    -c, yLow,  -c,  // 0 avant-gauche-bas
     c, yLow,  -c,  // 1 avant-droit-bas
    -c, yLow,   c,  // 2 arrière-gauche (base)
     c, yLow,   c,  // 3 arrière-droit (base)
    -c, yHigh,  c,  // 4 arrière-gauche-haut
     c, yHigh,  c,  // 5 arrière-droit-haut
  ]);
  const idx = [
    0, 1, 3,  0, 3, 2,   // dessous
    0, 4, 5,  0, 5, 1,   // pente
    2, 3, 5,  2, 5, 4,   // arrière haut
    0, 2, 4,             // côté gauche
    1, 5, 3,             // côté droit
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const m = new THREE.Mesh(geo, _mat('rampe_pente'));

  // Rotation Y pour orienter selon la direction (low end vers la direction inverse)
  const rotY = direction === 'N' ? Math.PI
             : direction === 'E' ? -Math.PI / 2
             : direction === 'O' ?  Math.PI / 2
             : 0; // 'S' = par défaut
  m.rotation.y = rotY;
  return m;
}

/**
 * Bosse courte (RACE-C05) : tablette surélevée signalant une impulsion verticale.
 */
function _meshRampeBosse() {
  const bossH = 0.18;
  const geo = new THREE.BoxGeometry(CELL, bossH, CELL);
  const m   = new THREE.Mesh(geo, _mat('rampe_bosse'));
  m.position.y = bossH / 2;
  return m;
}

// SOLO-04 — rampe directionnelle : réutilise le prisme _geoRamp avec rotation Y
function _meshRampDir(dir) {
  const m = new THREE.Mesh(_geoRamp, _mat(`ramp_${dir.toLowerCase()}`));
  // _geoRamp monte vers +Z (direction 'S') par défaut — on pivote selon la cible
  // V4-02 : E/O étaient inversées
  m.rotation.y = dir === 'N' ?  Math.PI
               : dir === 'E' ?  Math.PI / 2
               : dir === 'O' ? -Math.PI / 2
               : 0; // S
  return m;
}

// SOLO-04 — bosse : demi-sphère plate
function _meshBump() {
  const geo = new THREE.SphereGeometry(0.42, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  const m   = new THREE.Mesh(geo, _mat('bump'));
  // m.position.y = 0 — la base de la demi-sphère est déjà à y=0
  return m;
}

// SOLO-04 — cube déplaçable
function _meshMovable() {
  const geo = new THREE.BoxGeometry(0.75, 0.75, 0.75);
  const m   = new THREE.Mesh(geo, _mat('movable'));
  m.position.y = 0.375;
  return m;
}

// SOLO-04 — poteau fin
function _meshPole() {
  const geo = new THREE.CylinderGeometry(0.06, 0.06, 2.0, 6);
  const m   = new THREE.Mesh(geo, _mat('pole'));
  m.position.y = 1.0;
  return m;
}

function _meshPlateauFloor() {
  const m = new THREE.Mesh(_geoFloor, _mat('plateau'));
  // position.y sera fixée par buildBlock
  return m;
}

// Ajoute les murs de transition aux bords des plateaux (RACE-C02).
// Un mur est créé sur chaque arête où une cellule à élévation 1 borde une cellule à élévation 0.
function _ajouterMursTransition(group, grid, elevationGrid) {
  const matTransition = _mat('transition');
  const n = grid.length; // 8

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const elev = elevationGrid[row]?.[col] ?? 0;
      if (elev === 0) continue;

      const voisins = [
        { dr: 0,  dc: -1, cote: 'gauche' },
        { dr: 0,  dc:  1, cote: 'droit'  },
        { dr: -1, dc:  0, cote: 'avant'  },
        { dr:  1, dc:  0, cote: 'arriere'},
      ];

      for (const { dr, dc, cote } of voisins) {
        const elevVoisin = elevationGrid[row + dr]?.[col + dc] ?? 0;
        if (elevVoisin >= elev) continue; // pas de transition vers le bas

        let geo, x, z;
        const h  = PLATEAU_HEIGHT * elev;
        const th = TRANSITION_THICK;

        switch (cote) {
          case 'gauche':
            geo = new THREE.BoxGeometry(th, h, CELL);
            x = col; z = row + 0.5; break;
          case 'droit':
            geo = new THREE.BoxGeometry(th, h, CELL);
            x = col + 1; z = row + 0.5; break;
          case 'avant':
            geo = new THREE.BoxGeometry(CELL, h, th);
            x = col + 0.5; z = row; break;
          case 'arriere':
            geo = new THREE.BoxGeometry(CELL, h, th);
            x = col + 0.5; z = row + 1; break;
        }

        const m = new THREE.Mesh(geo, matTransition);
        m.position.set(x, h / 2, z);
        group.add(m);
      }
    }
  }
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

// ---- Rotation de bloc (RACE-A03) ----

// Correspondance exits lors d'une rotation 90° CW : N→E→S→O→N
const _EXIT_CW = { N: 'E', E: 'S', S: 'O', O: 'N' };

/**
 * Pivote une grille 8×8 de 90° CW.
 * Formule : new[i][j] = old[7-j][i]
 */
function _rotateGrid90CW(grid) {
  const n = grid.length;
  const result = Array.from({ length: n }, () => Array(n).fill(null));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      result[i][j] = grid[n - 1 - j][i];
    }
  }
  return result;
}

/**
 * Tourne la direction intrinsèque d'une cellule de `steps` × 90° CW (V4-02).
 * Cellule string 'ramp_n'..'ramp_o' ou objet avec champ `direction`.
 * Autres cellules retournées telles quelles.
 */
function _rotateCellCW(cell, steps) {
  if (typeof cell === 'string') {
    const m = /^ramp_([nseo])$/.exec(cell);
    if (!m) return cell;
    let d = m[1].toUpperCase();
    for (let k = 0; k < steps; k++) d = _EXIT_CW[d];
    return `ramp_${d.toLowerCase()}`;
  }
  if (cell && typeof cell === 'object' && cell.direction) {
    let d = cell.direction;
    for (let k = 0; k < steps; k++) d = _EXIT_CW[d];
    return { ...cell, direction: d };
  }
  return cell;
}

/**
 * Retourne une copie du bloc pivoté de `steps` × 90° dans le sens horaire.
 * steps ∈ {0, 1, 2, 3}
 * Ne modifie pas le bloc source (fonction pure).
 *
 * @param {object} block — bloc JSON avec grid et exits optionnels
 * @param {number} steps — nombre de rotations 90° CW (0 = identique)
 * @returns {object} nouveau bloc pivoté
 */
export function rotateBlock(block, steps) {
  const s = ((steps % 4) + 4) % 4;
  let grid = block.grid.map(row => [...row]);
  for (let k = 0; k < s; k++) {
    grid = _rotateGrid90CW(grid);
  }
  // V4-02 : la rotation de grille ne fait que déplacer les cellules — il faut
  // aussi tourner leur direction intrinsèque (ramp_n/s/e/o, rampe_pente.direction),
  // sinon une rampe garde son orientation d'origine dans un bloc pivoté.
  grid = grid.map(row => row.map(cell => _rotateCellCW(cell, s)));

  // V4-03 : elevationGrid est une grille parallèle — même rotation que grid,
  // sinon le relief se désynchronise des cellules.
  let elevationGrid = block.elevationGrid;
  if (elevationGrid) {
    elevationGrid = elevationGrid.map(r => [...r]);
    for (let k = 0; k < s; k++) {
      elevationGrid = _rotateGrid90CW(elevationGrid);
    }
  }

  let exits;
  if (block.exits) {
    exits = [...block.exits];
    for (let k = 0; k < s; k++) {
      exits = exits.map(e => _EXIT_CW[e]);
    }
  } else {
    exits = detectExits(grid);
  }

  return { ...block, grid, elevationGrid, exits };
}

// ---- Détection automatique des exits (RACE-B01) ----

/**
 * Analyse les 4 bords d'une grille 8×8 et retourne les exits probables.
 * Préfère block.exits si présent (métadonnée manuelle prioritaire).
 * Une exit est détectée si au moins 1 des 3 cellules centrales du bord est non-null.
 *
 * @param {Array<Array<string|null>>} grid — grille 8×8
 * @returns {string[]} tableau d'exits détectées
 */
export function detectExits(grid) {
  const exits = [];
  // Nord  : grid[0][2], grid[0][3], grid[0][4]
  if (grid[0]?.[3] == null || grid[0]?.[4] == null) exits.push('N');
  // Sud   : couloir central (cols 3,4) en row 7
  if (grid[7]?.[3] == null || grid[7]?.[4] == null) exits.push('S');
  // Est   : couloir central (rows 3,4) en col 7
  if (grid[3]?.[7] == null || grid[4]?.[7] == null) exits.push('E');
  // Ouest : couloir central (rows 3,4) en col 0
  if (grid[3]?.[0] == null || grid[4]?.[0] == null) exits.push('O');
  return exits;
}

/**
 * Retourne les exits d'un bloc : utilise block.exits si présent, sinon détecte.
 *
 * @param {object} block — bloc JSON
 * @returns {string[]}
 */
export function getExits(block) {
  return block.exits ?? detectExits(block.grid);
}

// ---- Nettoyage ----

export function disposeSharedResources() {
  [_geoFloor, _geoWall, _geoRamp, _geoPad, _geoArrowBar, _geoArrowPt].forEach(g => g.dispose());
  Object.values(_mats).forEach(m => m.dispose());
}
