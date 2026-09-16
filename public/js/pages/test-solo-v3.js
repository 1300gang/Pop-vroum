// Page de test solo V3 — RACE-H01 / H03 / H04
// Lance une partie solo sans lobby ni Socket.io.
// Charge un véhicule depuis localStorage (popvroum_vehicles) ou génère un aléatoire.
// Raccourcis : R = nouvelle map, V = véhicule suivant, D = toggle overlay debug.

import * as THREE from '../lib/three.module.js';
import { buildVehicleGroup, createPreviewScene, applyRoll } from '../modules/voxel/renderer.js';
import { generateRandomVehicle, COULEUR_HEX, COULEUR_FR } from '../modules/voxel/random-vehicle.js';
import * as controls    from '../modules/game/controls.js';
import * as physics     from '../modules/game/physics.js';
import * as camera      from '../modules/game/camera.js';
import * as skid        from '../modules/game/skid.js';
import * as powers      from '../modules/game/powers.js';
import * as particles   from '../modules/game/particles.js';
import * as trail       from '../modules/game/trail.js';
import * as movables    from '../modules/game/movables.js';
import * as mapLoader   from '../modules/game/map-loader.js';
import { checkTerrain, POLE_RADIUS_RATIO, CUBE_SIZE_RATIO } from '../modules/game/collision.js';
import { loadPool, generate, BLOCK_SIZE, getSurfaceGrip } from '../modules/game/map-generator.js';
import { applyImpactDamage } from '../modules/voxel/impact.js';
import { recalcStats }       from '../modules/voxel/stats.js';
import { initMinimap, updateMinimap, disposeMinimap } from '../modules/game/minimap.js';
import { V4_TEST_BLOCKS, trouverSpawnRampe } from '../modules/game/test-blocks-v4.js';
import { construirePisteMesure, construirePisteEffets } from '../modules/game/test-track.js';

// Banc d'essai V4 (?v4=1) : remplace le pool de blocs par des blocs de test
// déterministes (rampes dans les 4 directions, plateaux, bosses).
const MODE_V4 = new URLSearchParams(location.search).has('v4');
// Pistes fixes : ?piste=1 → mesure des sauts, ?piste=effets → catalogue des effets
const _PARAM_PISTE = new URLSearchParams(location.search).get('piste');
const MODE_PISTE   = _PARAM_PISTE !== null;
const MODE_EFFETS  = _PARAM_PISTE === 'effets';
let _reperesPiste = [];

// ---- Constantes ----

const VEHICLE_SCALE = 0.28;

// Carrosserie du véhicule pour les chocs : la grille voxel fait 8 × 4 cases
function _formeCarrosserie(angle) {
  return { angle, demiLongueur: 8 * VEHICLE_SCALE / 2, demiLargeur: 4 * VEHICLE_SCALE / 2 };
}
const CAR_ID        = 'joueur-solo-v3';

const ADJECTIFS = [
  'Grand', 'Petit', 'Fou', 'Chaud', 'Solide', 'Brillant',
  'Ultra', 'Turbo', 'Zinzin', 'Costaud', 'Sauvage', 'Mystérieux',
];
const NOMS = [
  'Bolide', 'Engin', 'Monstre', 'Fusée', 'Char', 'Tank',
  'Prototype', 'Truc', 'Zoïde', 'Bidule', 'Machin', 'Bazar',
];

const POUVOIR_INFO = {
  aspiration: { nom: 'Aspiration', couleur: '#ff3333' },
  phares:     { nom: 'Phares',     couleur: '#44ff44' },
  sillage:    { nom: 'Sillage',    couleur: '#3388ff' },
  shield:     { nom: 'Bouclier',   couleur: '#ff8800' },
};

const TYPES_CELLULE = {
  null:        { couleur: 0x3a3a4a, hauteur: 0.0  },
  dur:         { couleur: 0x4a5060, hauteur: 0.6  },
  boost:       { couleur: 0x00d4ff, hauteur: 0.05 },
  sticky:      { couleur: 0x88ff66, hauteur: 0.05 },
  rampe_bosse: { couleur: 0xe8a020, hauteur: 0.18 },  // RACE-C05
  // SOLO-04 : nouveaux éléments
  ramp_n:  { couleur: 0xaaaaff, hauteur: 0.5 },
  ramp_s:  { couleur: 0xaaaaff, hauteur: 0.5 },
  ramp_e:  { couleur: 0xaaaaff, hauteur: 0.5 },
  ramp_o:  { couleur: 0xaaaaff, hauteur: 0.5 },
  bump:    { couleur: 0xcc8844, hauteur: 0.3 },
  movable: { couleur: 0xff6644, hauteur: 1.0 },
  pole:    { couleur: 0xffffff, hauteur: 2.5 },
};

// Hauteur de plateau (RACE-C01) — miroir de config/layout.json PLATEAU_HEIGHT
const PLATEAU_HEIGHT      = 0.5;
const PLATEAU_FLOOR_H     = 0.15;
const PLATEAU_COULEUR_SOL = 0x444455;
const TRANSITION_THICK    = 0.06;

// ---- État global ----

let _scene, _renderer, _cam;
let _vehicleGroup = null;
let _vehicleData  = null;
let _carState     = null;
let _map          = null;
let _poolData     = null;
let _solGroup     = null;
let _preview      = null;
let _powersHandle = null;
let _last         = performance.now();
let _arrivee      = false;
let _minimapInstance = null;
let _blockScaleConfig = 2;   // unités monde par cellule (config map.blockScale)

// Véhicules depuis localStorage
let _vehiclesStockes  = [];  // tableau de données véhicule
let _vehicleIndex     = 0;   // index courant dans _vehiclesStockes
let _vehiclePregenere = null; // véhicule choisi dans l'écran de démarrage

// Comptage de voxels (total au chargement, restants après dommages futurs)
let _voxelsTotal    = 0;
let _voxelsRestants = 0;

let _terrainState     = { lastTerrain: null, onRamp: false, boostTimer: 0, rampTimer: 0 };
let _stuckTimer       = 0;   // durée continue en hardCollision (secondes)
let _autoReverseTimer = 0;   // durée restante de recul automatique (secondes)

const STUCK_THRESHOLD       = 0.4;  // secondes avant déclenchement du recul
const AUTO_REVERSE_DURATION = 0.8;  // secondes de recul automatique

// Physique V2
let _physConsts      = null;
let _vehicleStatsCfg = null;
let _soloCfg         = {};
let _gripStat        = 0.5;
let _arrowVelocity   = null;
let _arrowForward    = null;

// ---- Paramètres calibration (panel gauche) ----

let _speedStat       = 0.5;   // multiplicateur vitesse (0.1–1.0)
let _accelStat       = 0.5;   // multiplicateur accélération (0.1–1.0)
let _punitivite      = 1.0;   // multiplicateur punitivité dommages (0.1–3.0)
let _vitesseMinCasse = 8.0;   // seuil de vitesse pour casse (0–20 m/s)
let _mapSize         = 4;     // taille de grille map (partagée X et Y)
let _blocsVehicule   = 16;    // blocs cibles pour véhicule aléatoire
let _calibVisible    = false;

const MASSE_PAR_BLOC = 25; // kg par voxel — 32 voxels × 25 = 800 kg

const PROFILS_CALIBRATION = {
  equilibre:  { speed: 0.5, grip: 0.5, accel: 0.5 },
  drift:      { speed: 0.7, grip: 0.2, accel: 0.6 },
  tank:       { speed: 0.3, grip: 0.8, accel: 0.3 },
  fusee:      { speed: 1.0, grip: 0.4, accel: 1.0 },
  savonnette: { speed: 0.5, grip: 0.1, accel: 0.5 },
};

// ---- Mode boucle automatique ----

let _autoLoop      = false;
let _autoSteer     = 0;
let _autoTimer     = 0; // secondes avant le prochain changement de direction

// ---- Données graphiques canvas 2D (fenêtre glissante 5 s à ~60 fps) ----

const CHART_MAX   = 300; // 5 s × 60 fps
const _speedHist  = new Float32Array(CHART_MAX);
const _vlatHist   = new Float32Array(CHART_MAX);
let   _chartHead  = 0;   // pointeur circulaire

// ---- Résultats de session ----

let _lapStart       = 0;
let _lapSpeedMax    = 0;
let _lapSpeedSum    = 0;
let _lapFrames      = 0;
let _lapVoxelsStart = 0;

// Overlay debug RACE-H04
let _overlayVisible = false;
let _fpsSamples     = [];   // moyenne glissante sur 60 frames
let _dernierVlat    = 0;
let _dernierTerrain = null;  // type de surface sous le véhicule (lecture debug V4)
// Game feel : on met les effets en pause pour ne juger que la conduite (touche E)
let _effetsActifs      = false;
let _derniereReception = '—';
let _nbChocs        = 0;     // compteur de chocs endommageants (RACE-D01)
let _dernierDeltaV  = 0;     // dernier deltaSpeed enregistré

const $ = id => document.getElementById(id);

// ---- Helpers ----

function _nomAleatoire() {
  const adj = ADJECTIFS[Math.floor(Math.random() * ADJECTIFS.length)];
  const nom = NOMS[Math.floor(Math.random() * NOMS.length)];
  return `${adj} ${nom}`;
}

// Compte les voxels non-null dans une grille 4×4×8 (grid[x][z][y])
function _compterVoxels(grid) {
  if (!grid) return 0;
  let n = 0;
  for (const colX of grid) {
    for (const colZ of colX) {
      for (const voxel of colZ) {
        if (voxel !== null) n++;
      }
    }
  }
  return n;
}

// ---- Chargement des véhicules depuis localStorage ----

function _chargerVehiclesStockes() {
  try {
    const raw = localStorage.getItem('popvroum_vehicles');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ---- Mise à jour HUD principal ----

function _mettreAJourHUD() {
  if (!_vehicleData) return;
  const { nom, stats, powers: pw, parCouleur } = _vehicleData;

  $('nom-vehicule').textContent = nom;
  $('stat-speed').textContent   = stats.speed.toFixed(1);
  $('stat-grip').textContent    = stats.grip.toFixed(1);
  $('stat-accel').textContent   = stats.accel.toFixed(1);

  const comptage = parCouleur ?? {};
  $('couleurs').innerHTML = Object.entries(comptage)
    .sort((a, b) => b[1] - a[1])
    .map(([color, n]) =>
      `<span class="pill" style="background:${COULEUR_HEX[color]}">${COULEUR_FR[color]} ${n}</span>`
    ).join('');

  const maxPow = 15;
  const pouvoirsHtml = Object.entries(POUVOIR_INFO)
    .map(([key, info]) => {
      const val = pw[key] || 0;
      if (val === 0) return '';
      const pct = Math.min(100, (val / maxPow) * 100);
      return `<div class="pouvoir-ligne">
        <span class="pouvoir-dot" style="background:${info.couleur}"></span>
        <span style="min-width:70px">${info.nom}</span>
        <div class="pouvoir-barre-wrap">
          <div class="pouvoir-barre" style="width:${pct}%;background:${info.couleur}"></div>
        </div>
        <span style="opacity:0.7;font-size:11px;min-width:24px;text-align:right">${val.toFixed(1)}</span>
      </div>`;
    })
    .filter(Boolean)
    .join('');
  $('pouvoirs').innerHTML = pouvoirsHtml || '<div style="opacity:0.4;font-size:11px">Aucun pouvoir actif</div>';

  // Mise à jour poids dans le panel calibration
  const poidsEl = $('val-poids');
  if (poidsEl) poidsEl.textContent = (_voxelsTotal * MASSE_PAR_BLOC) + ' kg';
  const blocsEl = $('val-blocs');
  if (blocsEl) blocsEl.textContent = _voxelsTotal;
}

// ---- Overlay d'équilibrage RACE-H04 ----

function _toggleOverlay() {
  _overlayVisible = !_overlayVisible;
  $('overlay-debug').style.display = _overlayVisible ? 'block' : 'none';
}

function _mettreAJourOverlay(now) {
  if (!_overlayVisible || !_carState) return;

  // FPS : moyenne glissante 60 frames
  const dt = (now - _last) / 1000;
  const fps = dt > 0 ? 1 / dt : 0;
  _fpsSamples.push(fps);
  if (_fpsSamples.length > 60) _fpsSamples.shift();
  const fpsMoy = Math.round(_fpsSamples.reduce((a, b) => a + b, 0) / _fpsSamples.length);

  $('ov-speed').textContent  = _carState.speed.toFixed(2) + ' u/s';
  $('ov-vlat').textContent   = _dernierVlat.toFixed(2) + ' u/s';

  const driftEl = $('ov-drift');
  driftEl.textContent = _carState.drifting ? 'OUI' : 'NON';
  driftEl.className   = 'ov-val' + (_carState.drifting ? ' alerte' : '');

  $('ov-voxels').textContent = `${_voxelsRestants} / ${_voxelsTotal}`;
  $('ov-chocs').textContent  = _nbChocs > 0
    ? `${_nbChocs} (Δv: ${_dernierDeltaV.toFixed(1)} u/s)`
    : `0 (Δv: –)`;
  $('ov-fps').textContent    = fpsMoy;
  $('ov-blocs').textContent  = `${mapLoader.getVisibleBlockCount()} / ${mapLoader.getLoadedBlockCount()}`;
  $('ov-pos').textContent    = `(${_carState.position.x.toFixed(1)}, ${_carState.position.z.toFixed(1)})`;
}

// ---- Meshes spéciaux SOLO-04 (pole, movable) ----
// Poteaux : clé "${bx},${bz},${gz},${gx}" → { mesh, bloc, gz, gx } (ils ne bougent pas)
// Cubes    : clé = cellule-objet → { mesh, bloc, gz, gx, vx, vz, cellule } (ils changent de case)
const _poleMeshes    = new Map();
const _movableMeshes = new Map();

// ---- Construction des meshes de map ----

// SOLO-04 : rampe directionnelle centrée — montant vers +X par défaut (ramp_e)
// Prisme triangulaire centré sur l'origine ; rotation Y appliquée par l'appelant.
function _creerGeomRampCentree(h, cs) {
  const hx = cs / 2, hz = cs / 2;
  const geo = new THREE.BufferGeometry();
  const v = new Float32Array([
    -hx, 0,  -hz,   -hx, 0,   hz,
     hx, 0,  -hz,    hx, 0,   hz,
     hx, h,  -hz,    hx, h,   hz,
  ]);
  const idx = [
    0,2,3, 0,3,1,  // face du bas
    2,4,5, 2,5,3,  // surface inclinée
    1,3,5, 1,5,4,  // côté hz
    0,4,2,         // côté -hz (triangle)
    0,1,4, 1,5,4,  // côté hz (rectangle)
    0,1,4, 1,5,4,  // doublon ignoré par THREE mais on garde les tris utiles
  ];
  geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
  geo.setIndex([
    0,2,3, 0,3,1,
    2,4,5, 2,5,3,
    0,4,2,
    1,3,5, 1,5,4,
    0,1,4,
  ]);
  geo.computeVertexNormals();
  return geo;
}

function _creerGeomRampX(h, cs) {
  const geo = new THREE.BufferGeometry();
  const v = new Float32Array([
    0, 0, 0,    cs, 0, cs,   cs, 0, 0,
    0, 0, 0,    0,  0, cs,   cs, 0, cs,
    cs, 0, 0,   cs, 0, cs,   cs, h, cs,
    cs, 0, 0,   cs, h, cs,   cs, h, 0,
    0, 0, 0,    cs, h, 0,    cs, h, cs,
    0, 0, 0,    cs, h, cs,   0,  0, cs,
    0, 0, 0,    cs, 0, 0,    cs, h, 0,
    0, 0, cs,   cs, h, cs,   cs, 0, cs,
  ]);
  geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
  geo.computeVertexNormals();
  return geo;
}

function _construireMeshColonne(blocks, blockScale) {
  const group = new THREE.Group();
  const cs = blockScale;

  for (const bloc of blocks) {
    const [bx, bz] = bloc.position;
    const elevGrid = bloc.elevationGrid; // null si le bloc n'a pas d'élévation (rétrocompat)

    for (let gz = 0; gz < BLOCK_SIZE; gz++) {
      for (let gx = 0; gx < BLOCK_SIZE; gx++) {
        const rawCell   = bloc.grid[gz]?.[gx];
        // Support cellules objets (ex: rampe_pente) : extraire le type string
        const cellType  = !rawCell ? null : (typeof rawCell === 'object' ? rawCell.type : rawCell);
        const cell      = cellType; // alias pour lisibilité en dessous
        const elevation = elevGrid?.[gz]?.[gx] ?? 0;
        const yOffset   = elevation * PLATEAU_HEIGHT * cs;
        const def       = TYPES_CELLULE[cell] ?? TYPES_CELLULE.null;

        // Cellule rampe_pente (objet) : rendu en prisme incliné
        if (cellType === 'rampe_pente' && typeof rawCell === 'object') {
          const { direction = 'E', elevation_start = 0, elevation_end = 1 } = rawCell;
          const yLow  = elevation_start * PLATEAU_HEIGHT * cs;
          const yHigh = elevation_end   * PLATEAU_HEIGHT * cs;
          const c     = cs / 2;
          const pos   = new Float32Array([
            -c, yLow,  -c,  -c, yLow,   c,   c, yLow,  -c,   c, yLow,   c,
            -c, yHigh,  c,   c, yHigh,  c,
          ]);
          const idx = [0,2,3, 0,3,1, 0,4,5, 0,5,2, 1,3,5, 1,5,4, 0,1,4, 2,5,3];
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
          geo.setIndex(idx);
          geo.computeVertexNormals();
          const mat = new THREE.MeshStandardMaterial({ color: 0xd07830 });
          const m   = new THREE.Mesh(geo, mat);
          // V4-02 : le prisme monte vers +Z (Sud) par défaut — E et O étaient inversées
          const rotY = direction === 'N' ? Math.PI
                     : direction === 'E' ?  Math.PI / 2
                     : direction === 'O' ? -Math.PI / 2
                     : 0;
          m.rotation.y = rotY;
          m.position.set(bx + gx * cs + cs / 2, 0, bz + gz * cs + cs / 2);
          group.add(m);
          continue;
        }

        // Sol surélevé : cellule vide (route) sur plateau
        if (!cell && elevation > 0) {
          const geo = new THREE.BoxGeometry(cs, PLATEAU_FLOOR_H * cs, cs);
          const mat = new THREE.MeshStandardMaterial({ color: PLATEAU_COULEUR_SOL });
          const m   = new THREE.Mesh(geo, mat);
          m.position.set(
            bx + gx * cs + cs / 2,
            yOffset + (PLATEAU_FLOOR_H * cs) / 2,
            bz + gz * cs + cs / 2,
          );
          group.add(m);
          continue;
        }

        if (def.hauteur === 0) continue; // cellule vide à élévation 0, pas de mesh

        const mat = new THREE.MeshStandardMaterial({ color: def.couleur });
        let m;
        if (cell === 'ramp_n' || cell === 'ramp_s' || cell === 'ramp_e' || cell === 'ramp_o') {
          // SOLO-04 : rampe directionnelle — prisme centré + rotation Y
          const geo = _creerGeomRampCentree(def.hauteur * cs, cs);
          m = new THREE.Mesh(geo, mat);
          // V4-02 : ramp_n/ramp_s étaient inversées (la base monte vers +X = Est)
          const rotY = cell === 'ramp_o' ? Math.PI
                     : cell === 'ramp_n' ?  Math.PI / 2
                     : cell === 'ramp_s' ? -Math.PI / 2
                     : 0; // ramp_e
          m.rotation.y = rotY;
          m.position.set(bx + gx * cs + cs / 2, yOffset, bz + gz * cs + cs / 2);
        } else if (cell === 'rampe_bosse') {
          // RACE-C05 : ralentisseur bombé, en travers de la piste — sans mesh
          // dédié il s'affichait comme une dalle plate qu'on croyait inerte.
          const geo = new THREE.SphereGeometry(cs * 0.5, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2);
          m = new THREE.Mesh(geo, mat);
          m.scale.set(1, 0.42, 0.55);
          m.position.set(bx + gx * cs + cs / 2, yOffset, bz + gz * cs + cs / 2);
        } else if (cell === 'bump') {
          // SOLO-04 : bosse — demi-sphère aplatie
          const geo = new THREE.SphereGeometry(cs * 0.45, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
          m = new THREE.Mesh(geo, mat);
          m.position.set(bx + gx * cs + cs / 2, yOffset, bz + gz * cs + cs / 2);
        } else if (cell === 'movable') {
          // SOLO-04 : cube déplaçable — même empreinte au sol que son collider
          const geo = new THREE.BoxGeometry(cs * CUBE_SIZE_RATIO, cs * 1.15, cs * CUBE_SIZE_RATIO);
          m = new THREE.Mesh(geo, mat);
          // La cellule devient un objet qui porte la position réelle du cube :
          // collision.js vise le cube là où il est, pas au centre de sa case.
          const cellule = (typeof rawCell === 'object' && Number.isFinite(rawCell.x))
            ? rawCell
            : { type: 'movable', x: bx + gx * cs + cs / 2, z: bz + gz * cs + cs / 2 };
          bloc.grid[gz][gx] = cellule;
          m.position.set(cellule.x, yOffset + cs * 0.575, cellule.z);
          // Clé = la cellule elle-même. Un cube qui a changé de case puis dont la
          // colonne est rechargée ne doit pas créer une seconde entrée pour le même
          // objet : deux entrées se disputeraient sa position et son collider.
          _movableMeshes.set(cellule, { mesh: m, bloc, gz, gx, vx: 0, vz: 0, cellule });
        } else if (cell === 'pole') {
          // SOLO-04 : poteau fin
          const geo = new THREE.CylinderGeometry(
            cs * POLE_RADIUS_RATIO, cs * POLE_RADIUS_RATIO, def.hauteur * cs, 6,
          );
          m = new THREE.Mesh(geo, mat);
          m.position.set(bx + gx * cs + cs / 2, yOffset + (def.hauteur * cs) / 2, bz + gz * cs + cs / 2);
          const key = `${bx},${bz},${gz},${gx}`;
          _poleMeshes.set(key, { mesh: m, bloc, gz, gx });
        } else {
          const geo = new THREE.BoxGeometry(cs, def.hauteur * cs, cs);
          m = new THREE.Mesh(geo, mat);
          m.position.set(
            bx + gx * cs + cs / 2,
            yOffset + (def.hauteur * cs) / 2,
            bz + gz * cs + cs / 2,
          );
        }
        group.add(m);
      }
    }

    // Murs de transition plateau (RACE-C02) : bords entre élévation 1 et 0
    if (elevGrid) {
      for (let gz = 0; gz < BLOCK_SIZE; gz++) {
        for (let gx = 0; gx < BLOCK_SIZE; gx++) {
          const elev = elevGrid[gz]?.[gx] ?? 0;
          if (elev === 0) continue;

          const h = elev * PLATEAU_HEIGHT * cs;
          const voisins = [
            { dz: 0,  dx: -1, cote: 'gauche'  },
            { dz: 0,  dx:  1, cote: 'droit'   },
            { dz: -1, dx:  0, cote: 'avant'   },
            { dz:  1, dx:  0, cote: 'arriere' },
          ];

          for (const { dz, dx, cote } of voisins) {
            const elevV = elevGrid[gz + dz]?.[gx + dx] ?? 0;
            if (elevV >= elev) continue;

            const th  = TRANSITION_THICK * cs;
            const mat = new THREE.MeshStandardMaterial({ color: 0x555570 });
            let geo, wx, wz;

            switch (cote) {
              case 'gauche':
                geo = new THREE.BoxGeometry(th, h, cs);
                wx = bx + gx * cs; wz = bz + gz * cs + cs / 2; break;
              case 'droit':
                geo = new THREE.BoxGeometry(th, h, cs);
                wx = bx + (gx + 1) * cs; wz = bz + gz * cs + cs / 2; break;
              case 'avant':
                geo = new THREE.BoxGeometry(cs, h, th);
                wx = bx + gx * cs + cs / 2; wz = bz + gz * cs; break;
              case 'arriere':
                geo = new THREE.BoxGeometry(cs, h, th);
                wx = bx + gx * cs + cs / 2; wz = bz + (gz + 1) * cs; break;
            }

            const m = new THREE.Mesh(geo, mat);
            m.position.set(wx, h / 2, wz);
            group.add(m);
          }
        }
      }
    }
  }

  return group;
}

// V4-04 : label posé à plat au sol (texture canvas — pas de chargeur de police,
// donc rien à télécharger : le jeu doit tourner hors ligne en atelier).
function _creerLabelSol(texte, couleurCss, blocmapSize) {
  const canvas  = document.createElement('canvas');
  canvas.width  = 512;
  canvas.height = 128;

  const ctx = canvas.getContext('2d');
  ctx.fillStyle    = couleurCss;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  // Réduit la police jusqu'à ce que le texte tienne : les noms de section
  // ("RAMPE + PLATEAU") sont bien plus longs qu'un simple repère chiffré.
  let taille = 84;
  do {
    ctx.font = `bold ${taille}px system-ui, -apple-system, sans-serif`;
    if (ctx.measureText(texte).width <= canvas.width * 0.92) break;
    taille -= 4;
  } while (taille > 16);

  ctx.fillText(texte, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const largeur = blocmapSize * 0.75;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(largeur, largeur / 4),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  // Le départ est orienté vers l'Est (angle 0) : le texte se lit dans ce sens.
  mesh.rotation.z = -Math.PI / 2;
  return mesh;
}

function _construireSol(map) {
  const group = new THREE.Group();
  const { width, depth } = map.worldExtent;
  const blocmapSize = BLOCK_SIZE * map.blockScale;

  const solGeo = new THREE.PlaneGeometry(width + 8, depth + 8);
  const solMat = new THREE.MeshStandardMaterial({ color: 0x2a2a3e });
  const sol = new THREE.Mesh(solGeo, solMat);
  sol.rotation.x = -Math.PI / 2;
  sol.position.set(width / 2, -0.15, depth / 2);
  group.add(sol);

  // SOLO-05 : dalle départ (coin 0,0) et arrivée (coin W-1,H-1)
  const blocGeo    = new THREE.PlaneGeometry(blocmapSize, blocmapSize);
  const entryPos   = map.entry?.worldCenter ?? { x: blocmapSize * 0.5, z: blocmapSize * 0.5 };
  const exitPos    = map.exit?.worldCenter  ?? map.finishPosition;

  const departMat = new THREE.MeshBasicMaterial({ color: 0x66ff99, transparent: true, opacity: 0.35 });
  const depart    = new THREE.Mesh(blocGeo, departMat);
  depart.rotation.x = -Math.PI / 2;
  depart.position.set(entryPos.x, 0.02, entryPos.z);
  group.add(depart);

  const arriveeMat = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.45 });
  const arrivee    = new THREE.Mesh(blocGeo.clone(), arriveeMat);
  arrivee.rotation.x = -Math.PI / 2;
  arrivee.position.set(exitPos.x, 0.02, exitPos.z);
  group.add(arrivee);

  // Piste de mesure : traits + distances au sol après chaque tremplin, pour
  // lire d'un coup d'œil la portée d'un saut.
  for (const repere of _reperesPiste) {
    if (repere.type === 'section' || repere.type === 'note') {
      const estSection = repere.type === 'section';
      const label = _creerLabelSol(
        repere.label,
        estSection ? '#ffd88a' : '#8fa6bd',
        blocmapSize * (estSection ? 1.15 : 0.8),
      );
      label.position.set(repere.x, 0.05, repere.z);
      group.add(label);
      continue;
    }

    // Repère de distance : un trait en travers de la piste + sa valeur
    const trait = new THREE.Mesh(
      new THREE.PlaneGeometry(0.15, blocmapSize * 0.8),
      new THREE.MeshBasicMaterial({ color: 0x6688aa, transparent: true, opacity: 0.5 }),
    );
    trait.rotation.x = -Math.PI / 2;
    trait.position.set(repere.x, 0.03, repere.z);
    group.add(trait);

    const chiffre = _creerLabelSol(repere.label, '#88aacc', blocmapSize * 0.35);
    chiffre.position.set(repere.x, 0.04, repere.z + blocmapSize * 0.32);
    group.add(chiffre);
  }

  // V4-04 : labels au sol pour que les participant·es repèrent les deux zones
  const labelDepart = _creerLabelSol('DÉPART', '#8effb8', blocmapSize);
  labelDepart.position.set(entryPos.x, 0.05, entryPos.z);
  group.add(labelDepart);

  const labelArrivee = _creerLabelSol('ARRIVÉE', '#ffe29a', blocmapSize);
  labelArrivee.position.set(exitPos.x, 0.05, exitPos.z);
  group.add(labelArrivee);

  return group;
}

// ---- Régénération de la map (raccourci R) ----

async function _regenererMap() {
  $('banner').style.display = 'none';
  _arrivee = false;

  mapLoader.dispose();

  if (_solGroup) {
    _scene.remove(_solGroup);
    _solGroup.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material?.map) o.material.map.dispose();  // textures canvas des labels
      if (o.material) o.material.dispose();
    });
    _solGroup = null;
  }

  _poleMeshes.clear();
  _movableMeshes.clear();
  if (MODE_PISTE) {
    const piste   = MODE_EFFETS
      ? construirePisteEffets(_blockScaleConfig)
      : construirePisteMesure(_blockScaleConfig);
    _map          = piste.map;
    _reperesPiste = piste.reperes;
  } else {
  _map = await generate(_poolData, { gridSize: _mapSize });
  // Banc V4 : une map tirée au hasard peut ne contenir que des blocs de bosses.
  // On retire tant qu'aucune rampe n'est présente, sinon le banc perd son objet.
  for (let essai = 0; MODE_V4 && essai < 5 && !trouverSpawnRampe(_map); essai++) {
    _map = await generate(_poolData, { gridSize: _mapSize });
  }
  }
  trail.clear();
  const blocmapSize = BLOCK_SIZE * _map.blockScale;
  $('map-info').textContent = MODE_EFFETS
    ? `Piste des effets — ${_map.gridCols} sections`
    : MODE_PISTE
    ? `Piste de mesure — ${_map.gridCols} blocs, 3 tremplins`
    : `Map : ${_map.gridCols}×${_map.gridRows} (${blocmapSize}u/bloc)` + (MODE_V4 ? ' — BANC V4' : '');

  _solGroup = _construireSol(_map);
  _scene.add(_solGroup);

  mapLoader.init(_scene, _map, _construireMeshColonne, _physConsts?.RENDER_DISTANCE ?? 3);
  const _initPos = _map.entry?.worldCenter ?? _map.startPosition;
  mapLoader.update(_initPos.x, _cam, _initPos.z ?? 0);

  // SOLO-06 : mini-carte — recréer après chaque nouvelle map
  if (_minimapInstance) disposeMinimap(_minimapInstance);
  _minimapInstance = MODE_PISTE ? null : initMinimap(_map, document.body);

  _resetVoiture();
  const fp = _map.exit?.worldCenter ?? _map.finishPosition;
  powers.setFinishPosition(fp.x, fp.z);
}

function _resetVoiture() {
  if (!_map) return;
  // SOLO-05 : premier point de spawn dans le bloc départ.
  // Banc V4 : on spawne au pied d'une rampe, face à la montée.
  // Banc V4 : recherche dans les blocs tels que les voit la collision (déjà
  // pivotés par map-loader), carrosserie entière libre — calculé sur les grilles
  // d'origine, le départ tombait dans un mur presque à chaque tirage.
  const blocsCharges = mapLoader.getActiveBlocks();
  const spawnRampe   = MODE_V4 && !MODE_PISTE
    ? trouverSpawnRampe({ blockScale: _map.blockScale, blocks: blocsCharges }, c =>
        !checkTerrain({ x: c.x, z: c.z }, blocsCharges, _map.blockScale, 0, _formeCarrosserie(c.angle)).hardCollision)
    : null;
  const spawn = spawnRampe
    ?? _map.entry?.spawnPositions?.[0]
    ?? _map.startPosition;
  _carState = physics.createState({
    x:     spawn.x,
    z:     spawn.z,
    angle: spawn.angle ?? 0,
  });
  _arrivee          = false;
  _terrainState     = { lastTerrain: null, onRamp: false, boostTimer: 0, rampTimer: 0 };
  _stuckTimer       = 0;
  _autoReverseTimer = 0;
  $('banner').style.display = 'none';

  // Réinitialise les stats de session au départ
  _lapStart       = performance.now();
  _lapSpeedMax    = 0;
  _lapSpeedSum    = 0;
  _lapFrames      = 0;
  _lapVoxelsStart = _voxelsRestants;
}

// ---- Chargement ou génération d'un véhicule ----

async function _chargerVehicule(data) {
  // Copie profonde de la grille et des stats d'origine (référence pour recalcStats)
  _vehicleData = {
    ...data,
    originalGrid:  data.grid.map(col => col.map(row => [...row])),
    originalStats: { ...data.stats },
  };
  _voxelsTotal    = _compterVoxels(data.grid);
  _voxelsRestants = _voxelsTotal;
  _nbChocs        = 0;
  _dernierDeltaV  = 0;

  if (_vehicleGroup) {
    _scene.remove(_vehicleGroup);
    _vehicleGroup.clear();
  }
  _vehicleGroup = buildVehicleGroup(_vehicleData);
  _vehicleGroup.scale.set(VEHICLE_SCALE, VEHICLE_SCALE, VEHICLE_SCALE);
  _scene.add(_vehicleGroup);

  powers.dispose();
  await powers.init(_scene);
  _powersHandle = powers.createForVehicle(CAR_ID, _vehicleData.powers);

  _preview.setGroup(buildVehicleGroup(_vehicleData));
  _mettreAJourHUD();
  _resetVoiture();
}

// Reconstruit le mesh du véhicule après perte de voxels (RACE-D02)
function _mettreAJourMeshVehicule() {
  if (!_vehicleData) return;
  if (_vehicleGroup) {
    _scene.remove(_vehicleGroup);
    _vehicleGroup.clear();
  }
  _vehicleGroup = buildVehicleGroup(_vehicleData);
  _vehicleGroup.scale.set(VEHICLE_SCALE, VEHICLE_SCALE, VEHICLE_SCALE);
  if (_carState) {
    _vehicleGroup.position.set(_carState.position.x, 0.4, _carState.position.z);
    _vehicleGroup.rotation.y = -_carState.angle;
  }
  _scene.add(_vehicleGroup);
  _voxelsRestants = _compterVoxels(_vehicleData.grid);
}

// Cycle parmi les véhicules stockés (raccourci V)
async function _vehiculeSuivant() {
  $('btn-vehicule').disabled = true;

  if (_vehiclesStockes.length > 0) {
    _vehicleIndex = (_vehicleIndex + 1) % _vehiclesStockes.length;
    await _chargerVehicule(_vehiclesStockes[_vehicleIndex]);
  } else {
    // Aucun véhicule en localStorage : génère un aléatoire
    const data = await generateRandomVehicle(_nomAleatoire());
    await _chargerVehicule(data);
  }

  $('btn-vehicule').disabled = false;
}

// ---- Effets visuels SOLO-04 (pole, movable) ----

function _appliquerEffetSpecial(type, deltaV, velocityImpact) {
  if (!_carState) return;
  const pos = _carState.position;

  if (type === 'pole') {
    // Détruire le poteau le plus proche si deltaV > seuil
    const seuil = _physConsts?.POLE_BREAK_THRESHOLD ?? 5.0;
    // deltaV vaut undefined quand le choc n'a pas causé de dégât : sans ce
    // garde-fou la comparaison est fausse et le poteau cassait au moindre frôlement.
    if (!Number.isFinite(deltaV) || deltaV < seuil) return;
    let closest = null, distMin = Infinity;
    for (const [key, entry] of _poleMeshes) {
      const mx = entry.mesh.position.x;
      const mz = entry.mesh.position.z;
      const d  = Math.sqrt((mx - pos.x) ** 2 + (mz - pos.z) ** 2);
      if (d < distMin && d < _map.blockScale * 2) { distMin = d; closest = { key, entry }; }
    }
    if (closest) {
      closest.entry.mesh.visible = false;
      // Retirer la cellule de la grille → le prochain checkTerrain passe au travers
      closest.entry.bloc.grid[closest.entry.gz][closest.entry.gx] = null;
      _poleMeshes.delete(closest.key);
    }
  } else if (type === 'movable') {
    // Déplacer le cube déplaçable dans la direction du pushBack
    let closest = null, distMin = Infinity;
    for (const [, entry] of _movableMeshes) {
      const mx = entry.mesh.position.x;
      const mz = entry.mesh.position.z;
      const d  = Math.sqrt((mx - pos.x) ** 2 + (mz - pos.z) ** 2);
      if (d < distMin && d < _map.blockScale * 2) { distMin = d; closest = entry; }
    }
    if (closest) {
      // Direction imposée : du véhicule vers le cube. Déduite de la vitesse du
      // véhicule, elle renvoyait le cube en arrière dès qu'un rebond l'inversait.
      const direction = {
        x: closest.mesh.position.x - pos.x,
        z: closest.mesh.position.z - pos.z,
      };
      const vitesse = velocityImpact
        ? Math.sqrt(velocityImpact.x ** 2 + velocityImpact.z ** 2)
        : _carState.speed;
      // Le choc donne l'impulsion ; une voiture qui reste collée pousse au pas
      movables.pousser(closest, direction, vitesse,
        _physConsts?.CUBE_PUSH ?? 0.55, _physConsts?.CUBE_PUSH_CONTINU ?? 4);
    }
    return closest;   // l'appelant cale la voiture sur ce cube
  }
  return null;
}

// ---- Helpers debug physique ----

function _mettreAJourDebugPhys(dec, driftInfo = null) {
  const { v_forward, v_lateral } = dec;
  _dernierVlat = v_lateral;

  $('dbg-vx').textContent    = _carState.velocity.x.toFixed(2);
  $('dbg-vz').textContent    = _carState.velocity.z.toFixed(2);
  $('dbg-speed').textContent = _carState.speed.toFixed(2);
  $('dbg-vfwd').textContent  = v_forward.toFixed(2);
  $('dbg-vlat').textContent  = v_lateral.toFixed(2);
  $('dbg-angle').textContent = (_carState.angle * 180 / Math.PI % 360).toFixed(1) + '°';
  if (driftInfo) {
    $('dbg-threshold').textContent = driftInfo.drift_threshold.toFixed(2);
  }
  const el = $('dbg-drift');
  el.textContent = _carState.drifting ? 'OUI' : 'NON';
  el.style.color = _carState.drifting ? '#ff6b6b' : '#44ff99';

}

// V4 : lectures de revue (terrain, hauteur, vol, réception), rafraîchies à CHAQUE
// frame. Elles vivaient dans _mettreAJourDebugPhys, qui n'est appelée qu'en
// l'absence de choc : « mur » ne s'affichait donc jamais pendant une collision.
function _majLecturesV4() {
  $('dbg-elevation').textContent = _carState.elevation.toFixed(2);
  $('dbg-terrain').textContent   = _dernierTerrain ?? '—';

  const vy = $('dbg-vy');
  vy.textContent = _carState.airborne
    ? `EN L'AIR (vy ${_carState.vy.toFixed(1)})`
    : 'au sol';
  vy.style.color = _carState.airborne ? '#ffd166' : '';

  $('dbg-reception').textContent = _derniereReception;
}

// Game feel : les effets sont coupés par défaut pour ne juger que la conduite.
function _majEtatEffets() {
  const el = $('dbg-effets');
  if (!el) return;
  el.textContent   = _effetsActifs ? 'ON' : 'OFF (E)';
  el.style.color   = _effetsActifs ? '' : '#888';
}

function _mettreAJourFlechesDebug() {
  if (!_arrowVelocity || !_arrowForward || !_carState) return;
  const pos = new THREE.Vector3(_carState.position.x, 0.9, _carState.position.z);
  _arrowVelocity.position.copy(pos);
  _arrowForward.position.copy(pos);

  const spd = _carState.speed;
  if (spd > 0.1) {
    _arrowVelocity.setDirection(
      new THREE.Vector3(_carState.velocity.x / spd, 0, _carState.velocity.z / spd)
    );
    _arrowVelocity.setLength(Math.min(6, spd * 0.18), 0.5, 0.3);
  }

  _arrowForward.setDirection(
    new THREE.Vector3(Math.cos(_carState.angle), 0, Math.sin(_carState.angle))
  );
  _arrowForward.setLength(2.5, 0.4, 0.25);
}

// ---- Calibration : sync des sliders ↔ variables ----

function _syncSliders() {
  const set = (id, v, dec = 2) => {
    const el = $(id);
    if (el) el.textContent = v.toFixed(dec);
  };
  const sv = id => { const el = $(id); if (el) el.value = _speedStat; };
  const gv = id => { const el = $(id); if (el) el.value = _gripStat; };
  const av = id => { const el = $(id); if (el) el.value = _accelStat; };

  sv('sl-speed');      set('val-speed',    _speedStat);
  gv('sl-grip-cal');   set('val-grip-cal', _gripStat);
  av('sl-accel');      set('val-accel',    _accelStat);

  // Sync avec le slider grip du panel debug physique existant
  const sg2 = $('slider-grip');
  if (sg2) sg2.value = _gripStat;
  const gv2 = $('grip-val');
  if (gv2) gv2.textContent = _gripStat.toFixed(2);
}

function _appliquerProfil(key) {
  const p = PROFILS_CALIBRATION[key];
  if (!p) return;
  _speedStat = p.speed;
  _gripStat  = p.grip;
  _accelStat = p.accel;
  _syncSliders();
  document.querySelectorAll('.profil-btn').forEach(b => {
    b.classList.toggle('actif', b.dataset.profil === key);
  });
}

function _toggleCalibration() {
  _calibVisible = !_calibVisible;
  $('panel-calibration').classList.toggle('visible', _calibVisible);
  $('panel-charts').classList.toggle('visible', _calibVisible);
  $('btn-calibration').textContent = _calibVisible ? 'Calibration ✓ [C]' : 'Calibration [C]';
}

// ---- Graphiques canvas 2D ----

function _renderCharts() {
  const csSpeed = $('chart-speed');
  const csVlat  = $('chart-vlat');
  const csVie   = $('chart-vie');
  if (!csSpeed || !csVlat || !csVie) return;

  // Courbe vitesse longitudinale
  const ctxS = csSpeed.getContext('2d');
  const w = csSpeed.width, h = csSpeed.height;
  ctxS.clearRect(0, 0, w, h);
  ctxS.strokeStyle = '#4488ff';
  ctxS.lineWidth = 1.5;
  ctxS.beginPath();
  const vmax = 40;
  for (let i = 0; i < CHART_MAX; i++) {
    const idx = (_chartHead + i) % CHART_MAX;
    const x = (i / (CHART_MAX - 1)) * w;
    const y = h - Math.min(1, _speedHist[idx] / vmax) * h;
    i === 0 ? ctxS.moveTo(x, y) : ctxS.lineTo(x, y);
  }
  ctxS.stroke();

  // Courbe v_lateral (dérapage)
  const ctxV = csVlat.getContext('2d');
  const wv = csVlat.width, hv = csVlat.height;
  ctxV.clearRect(0, 0, wv, hv);
  ctxV.strokeStyle = '#ff6b6b';
  ctxV.lineWidth = 1.5;
  ctxV.beginPath();
  const vlatMax = 15;
  for (let i = 0; i < CHART_MAX; i++) {
    const idx = (_chartHead + i) % CHART_MAX;
    const x = (i / (CHART_MAX - 1)) * wv;
    const y = hv - Math.min(1, Math.abs(_vlatHist[idx]) / vlatMax) * hv;
    i === 0 ? ctxV.moveTo(x, y) : ctxV.lineTo(x, y);
  }
  ctxV.stroke();

  // Jauge de vie (blocs restants / initiaux)
  const ctxL = csVie.getContext('2d');
  ctxL.clearRect(0, 0, csVie.width, csVie.height);
  const ratio = _voxelsTotal > 0 ? _voxelsRestants / _voxelsTotal : 1;
  const col   = ratio > 0.6 ? '#66ff99' : ratio > 0.3 ? '#ffd166' : '#ff4444';
  ctxL.fillStyle = 'rgba(255,255,255,0.08)';
  ctxL.fillRect(0, 0, csVie.width, csVie.height);
  ctxL.fillStyle = col;
  ctxL.fillRect(0, 0, csVie.width * ratio, csVie.height);
}

// ---- Résultats de session ----

function _afficherResultatsSession() {
  const now     = performance.now();
  const lapSecs = (now - _lapStart) / 1000;
  const vitMoy  = _lapFrames > 0 ? (_lapSpeedSum / _lapFrames) : 0;
  const perdus  = _lapVoxelsStart - _voxelsRestants;

  const el = $('sess-temps');
  if (!el) return;
  $('sess-temps').textContent  = lapSecs.toFixed(1) + ' s';
  $('sess-vitmax').textContent = _lapSpeedMax.toFixed(1) + ' u/s';
  $('sess-vitmoy').textContent = vitMoy.toFixed(1) + ' u/s';
  $('sess-voxels').textContent = perdus;

  $('panel-session').classList.add('visible');
  setTimeout(() => $('panel-session').classList.remove('visible'), 2500);

  // Réinitialise pour le prochain tour
  _lapStart       = now;
  _lapSpeedMax    = 0;
  _lapSpeedSum    = 0;
  _lapFrames      = 0;
  _lapVoxelsStart = _voxelsRestants;
}

// ---- Progression de chargement ----

function _progression(pct, msg) {
  $('loading-bar').style.width = pct + '%';
  if (msg) $('loading-msg').textContent = msg;
}

// ---- Initialisation principale ----

async function init() {
  $('loading').style.display = 'flex';
  _progression(10, 'Création de la scène…');

  const canvas = $('jeu');

  _scene = new THREE.Scene();
  _scene.background = new THREE.Color(0x1a1a2e);
  _scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(20, 40, 10);
  _scene.add(dir);

  _renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  _renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  _renderer.setSize(window.innerWidth, window.innerHeight, false);

  _cam     = camera.createCamera(window.innerWidth, window.innerHeight);
  _preview = createPreviewScene($('preview'));

  await physics.init();

  const cfgPhys    = await fetch('/config/gameplay.json').then(r => r.json());
  _physConsts      = cfgPhys.physics;
  _vehicleStatsCfg = cfgPhys.vehicleStats;
  _soloCfg         = cfgPhys.solo ?? {};
  _blockScaleConfig = cfgPhys.map?.blockScale ?? 2;

  // Les curseurs de saut partent des valeurs de gameplay.json
  $('sl-bump').value        = _physConsts.BUMP_IMPULSE ?? 5;
  $('val-bump').textContent = (_physConsts.BUMP_IMPULSE ?? 5).toFixed(1);
  $('sl-launch').value        = _physConsts.RAMP_LAUNCH_FACTOR ?? 1;
  $('val-launch').textContent = (_physConsts.RAMP_LAUNCH_FACTOR ?? 1).toFixed(2);
  $('sl-grav').value        = _physConsts.GRAVITY ?? 18;
  $('val-grav').textContent = (_physConsts.GRAVITY ?? 18).toFixed(0);
  $('sl-pente').value        = _physConsts.SLOPE_GRAVITY_FACTOR ?? 0.35;
  $('val-pente').textContent = (_physConsts.SLOPE_GRAVITY_FACTOR ?? 0.35).toFixed(2);

  _arrowVelocity = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 3, 0x4488ff, 0.5, 0.3
  );
  _arrowForward = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 2.5, 0xff8800, 0.4, 0.25
  );
  _scene.add(_arrowVelocity);
  _scene.add(_arrowForward);

  $('slider-grip')?.addEventListener('input', e => {
    _gripStat = parseFloat(e.target.value);
    const el  = $('grip-val');
    if (el) el.textContent = _gripStat.toFixed(2);
  });

  controls.init(canvas);
  skid.init(_scene);
  particles.init(_scene);
  trail.init(_scene);

  _progression(30, 'Chargement des blocs map…');
  _poolData = await loadPool();
  if (MODE_V4) _poolData = { ..._poolData, pool: V4_TEST_BLOCKS };

  _progression(60, 'Chargement du véhicule…');
  // Utilise le véhicule pré-choisi dans l'écran de démarrage
  await _chargerVehicule(_vehiclePregenere);
  _vehiclePregenere = null;

  _progression(80, 'Génération de la map…');
  await _regenererMap();

  _progression(100, '');
  $('loading').style.display = 'none';

  // Boutons HUD droite
  $('btn-vehicule').addEventListener('click', _vehiculeSuivant);
  $('btn-map').addEventListener('click', _regenererMap);
  $('btn-debug-toggle').addEventListener('click', _toggleOverlay);
  $('btn-calibration').addEventListener('click', _toggleCalibration);
  $('btn-auto-boucle').addEventListener('click', () => {
    _autoLoop = !_autoLoop;
    $('btn-auto-boucle').textContent = _autoLoop ? 'Auto ✓ [A]' : 'Auto [A]';
  });

  // Sliders calibration — map
  $('sl-map-x').addEventListener('input', e => {
    _mapSize = parseInt(e.target.value, 10);
    $('val-map-x').textContent = _mapSize;
    $('sl-map-y').value        = _mapSize;
    $('val-map-y').textContent = _mapSize;
    _regenererMap();
  });
  $('sl-map-y').addEventListener('input', e => {
    _mapSize = parseInt(e.target.value, 10);
    $('val-map-y').textContent = _mapSize;
    $('sl-map-x').value        = _mapSize;
    $('val-map-x').textContent = _mapSize;
    _regenererMap();
  });

  // Slider blocs véhicule (mise à jour du slider uniquement — génère un véhicule aléatoire)
  $('sl-blocs').addEventListener('change', async e => {
    _blocsVehicule = parseInt(e.target.value, 10);
    $('val-blocs').textContent = _blocsVehicule;
    // Génère un nouveau véhicule aléatoire si aucun véhicule stocké
    if (_vehiclesStockes.length === 0) await _vehiculeSuivant();
  });

  // Sliders physique
  // Curseurs de saut : on écrit directement dans _physConsts, tout le pipeline
  // vertical lit ces valeurs à chaque frame.
  $('sl-bump').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (_physConsts) _physConsts.BUMP_IMPULSE = v;
    $('val-bump').textContent = v.toFixed(1);
  });
  $('sl-launch').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (_physConsts) _physConsts.RAMP_LAUNCH_FACTOR = v;
    $('val-launch').textContent = v.toFixed(2);
  });
  $('sl-grav').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (_physConsts) _physConsts.GRAVITY = v;
    $('val-grav').textContent = v.toFixed(0);
  });
  // 0 = les pentes ne freinent pas, 1 = gravité réelle (rampes quasi infranchissables lentement)
  $('sl-pente').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (_physConsts) _physConsts.SLOPE_GRAVITY_FACTOR = v;
    $('val-pente').textContent = v.toFixed(2);
  });

  $('sl-speed').addEventListener('input', e => {
    _speedStat = parseFloat(e.target.value);
    $('val-speed').textContent = _speedStat.toFixed(2);
  });
  $('sl-grip-cal').addEventListener('input', e => {
    _gripStat = parseFloat(e.target.value);
    $('val-grip-cal').textContent = _gripStat.toFixed(2);
    // Sync avec le slider debug physique existant
    const sg2 = $('slider-grip');
    if (sg2) sg2.value = _gripStat;
    const gv2 = $('grip-val');
    if (gv2) gv2.textContent = _gripStat.toFixed(2);
  });
  $('sl-accel').addEventListener('input', e => {
    _accelStat = parseFloat(e.target.value);
    $('val-accel').textContent = _accelStat.toFixed(2);
  });
  $('sl-punit').addEventListener('input', e => {
    _punitivite = parseFloat(e.target.value);
    $('val-punit').textContent = _punitivite.toFixed(1);
  });
  $('sl-vminc').addEventListener('input', e => {
    _vitesseMinCasse = parseFloat(e.target.value);
    $('val-vminc').textContent = _vitesseMinCasse.toFixed(1);
  });

  // Boutons profils prédéfinis
  document.querySelectorAll('.profil-btn').forEach(btn => {
    btn.addEventListener('click', () => _appliquerProfil(btn.dataset.profil));
  });

  // Sync du slider grip existant (debug physique) vers calibration
  $('slider-grip')?.addEventListener('input', e => {
    _gripStat = parseFloat(e.target.value);
    const gc = $('sl-grip-cal');
    if (gc) gc.value = _gripStat;
    const vc = $('val-grip-cal');
    if (vc) vc.textContent = _gripStat.toFixed(2);
  });

  // Raccourcis clavier RACE-H03
  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.key === 'r' || e.key === 'R') _regenererMap();
    if (e.key === 'v' || e.key === 'V') _vehiculeSuivant();
    if (e.key === 'd' || e.key === 'D') _toggleOverlay();
    if (e.key === 'a' || e.key === 'A') {
      _autoLoop = !_autoLoop;
      $('btn-auto-boucle').textContent = _autoLoop ? 'Auto ✓ [A]' : 'Auto [A]';
    }
    if (e.key === 'c' || e.key === 'C') _toggleCalibration();
    if (e.key === 'e' || e.key === 'E') {
      _effetsActifs = !_effetsActifs;
      _majEtatEffets();
    }
    if (e.key === 't' || e.key === 'T') trail.clear();
  });

  window.addEventListener('resize', () => {
    _renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.resize(window.innerWidth, window.innerHeight);
  });

  _majEtatEffets();

  _last = performance.now();
  requestAnimationFrame(_boucle);
}

// ---- Boucle de jeu ----

function _boucle(now) {
  // Mise à jour de l'overlay avant de mettre à jour _last
  _mettreAJourOverlay(now);

  const dt = Math.min(0.05, (now - _last) / 1000);
  _last = now;

  if (_carState && _vehicleData && _vehicleGroup) {
    const inputs = controls.getInputs();

    mapLoader.update(_carState.position.x, _cam, _carState.position.z);

    const activeBlocks = mapLoader.getActiveBlocks();
    const terrain = activeBlocks.length > 0
      ? checkTerrain(_carState.position, activeBlocks, _map.blockScale, _carState.elevation,
          _formeCarrosserie(_carState.angle))
      : null;

    _dernierTerrain = terrain?.hardCollision ? 'mur' : (terrain?.softTerrain ?? null);

    if (terrain) {
      const ts = _terrainState;
      if (terrain.softTerrain === 'boost' && ts.lastTerrain !== 'boost') {
        ts.boostTimer = 1.5;
        camera.kick(-(_physConsts?.BOOST_ZOOM ?? 3));   // la vue se resserre : sensation de vitesse
      }
      if (terrain.softTerrain === 'sticky' && ts.lastTerrain !== 'sticky') {
        camera.kick(_physConsts?.STICKY_ZOOM ?? 2.5);   // la vue s'élargit : on s'enlise
      }
      // RACE-C05 : entrée sur bosse → impulsion verticale
      if (terrain.softTerrain === 'rampe_bosse' && ts.lastTerrain !== 'rampe_bosse') {
        physics.applyBump(_carState, _physConsts.BUMP_IMPULSE ?? 2.0, _carState.speed, _physConsts);
      }
      // SOLO-04 : bosse directionnelle — même impulsion
      if (terrain.softTerrain === 'bump' && ts.lastTerrain !== 'bump') {
        physics.applyBump(_carState, _physConsts.BUMP_IMPULSE ?? 2.0, _carState.speed, _physConsts);
      }
      ts.lastTerrain = terrain.softTerrain;
      ts.boostTimer  = Math.max(0, ts.boostTimer - dt);
      ts.rampTimer   = Math.max(0, ts.rampTimer  - dt);

    }

    // V4 : physique verticale — la voiture épouse le relief, décolle quand le
    // sol se dérobe, et retombe sous la gravité. Hors de tout bloc, solCible = 0
    // donc elle retombe naturellement au niveau du sol.
    const uniteElevation = PLATEAU_HEIGHT * (_map?.blockScale ?? 1);
    const solCible       = (terrain?.elevationTarget ?? 0) * uniteElevation;
    const surRampe = terrain?.softTerrain === 'rampe_pente'
      || terrain?.softTerrain === 'ramp_n' || terrain?.softTerrain === 'ramp_s'
      || terrain?.softTerrain === 'ramp_e' || terrain?.softTerrain === 'ramp_o';

    const vertical = physics.tickVertical(_carState, solCible, dt, _physConsts, surRampe);
    // checkTerrain raisonne en niveaux : en vol, la voiture survole les plateaux
    // plus bas qu'elle au lieu d'être bloquée par leur bordure.
    _carState.elevation = _carState.y / uniteElevation;

    if (vertical.landed) {
      camera.shake((vertical.impact ?? 0) * (_physConsts?.LANDING_SHAKE ?? 0.25));
      const reception = physics.applyLandingPenalty(_carState, _physConsts);
      _derniereReception = reception.perte > 0
        ? `${(reception.desalignement * 100).toFixed(0)} % de travers · −${(reception.perte * 100).toFixed(0)} % vitesse`
        : 'propre';
      if (_effetsActifs) {
        particles.emitLanding({ x: _carState.position.x, y: _carState.y + 0.1, z: _carState.position.z }, 8);
      }
    }

    if (_physConsts && _vehicleStatsCfg) {
      const surfaceGrip = getSurfaceGrip(terrain?.softTerrain ?? null);

      // ---- Recul automatique si bloqué dans un mur ----
      if (_autoReverseTimer > 0) {
        _autoReverseTimer -= dt;
        if (_autoReverseTimer <= 0) _stuckTimer = 0;
      } else if (terrain?.hardCollision) {
        _stuckTimer += dt;
        if (_stuckTimer > STUCK_THRESHOLD) {
          _autoReverseTimer = AUTO_REVERSE_DURATION;
          _stuckTimer       = 0;
        }
      } else {
        _stuckTimer = 0;
      }
      const isAutoReversing = _autoReverseTimer > 0;

      const vmaxMult = _terrainState.boostTimer > 0 ? 1.5
                     : terrain?.softTerrain === 'sticky' ? 0.5
                     : 1.0;

      // Les sliders de calibration remplacent directement les stats normalisées
      const statsNorm = {
        speed_stat:  _speedStat * 2 * vmaxMult,
        grip_stat:   _gripStat,
        accel_stat:  _accelStat * 2,
      };

      // Mode boucle automatique : steer aléatoire, accélération permanente
      if (_autoLoop) {
        _autoTimer -= dt;
        if (_autoTimer <= 0) {
          _autoSteer = (Math.random() - 0.5) * 2;
          _autoTimer = 0.5 + Math.random();
        }
      }

      // V4 game feel : en l'air, plus aucune force du sol. Les pneus ne peuvent
      // ni pousser ni rattraper la glisse, et le volant ne répond plus — la
      // trajectoire est balistique, figée au décollage.
      // Une petite bosse ne doit pas figer le pilotage : on ne coupe les forces
      // du sol qu'au-delà d'une vraie hauteur de décollage.
      const enVol = _carState.airborne
        && _carState.hauteurSol > (_physConsts?.AIR_CONTROL_MIN_HEIGHT ?? 0.25);

      const steeringEff = enVol ? 0 : (_autoLoop ? _autoSteer : inputs.steering);
      const throttle = enVol             ? 0
                     : isAutoReversing   ? -1
                     : (!_autoLoop && inputs.reversing)  ? -1
                     : (!_autoLoop && inputs.braking)    ? -0.8
                     : 1;

      // En mode recul automatique on bypasse le bloc collision pour laisser
      // computeForces établir la velocity arrière — sinon elle est annulée chaque frame.
      if (terrain?.hardCollision && !isAutoReversing) {
        // Pousser un cube n'est ni un rebond ni un blocage : la voiture le suit.
        const pousseCube = terrain.hardCellType === 'movable';
        if (terrain.pushBack) {
          const velocityBefore = { x: _carState.velocity.x, z: _carState.velocity.z };
          const pbLen = Math.sqrt(terrain.pushBack.x ** 2 + terrain.pushBack.z ** 2);
          const wallNormal = pbLen > 0.001
            ? { x: terrain.pushBack.x / pbLen, z: terrain.pushBack.z / pbLen }
            : null;

          // Contre un mur : rebond. Contre un cube : on le pousse d'abord, puis la
          // voiture cale sa vitesse sur la sienne au lieu de rebondir dessus.
          const bounced = pousseCube
            ? movables.suivreCube(
                _carState.velocity, terrain.pushBack,
                _appliquerEffetSpecial('movable', undefined, velocityBefore),
              )
            : physics.applyBounce(_carState.velocity, terrain.pushBack, _physConsts.restitution);
          _carState.velocity.x = bounced.x;
          _carState.velocity.z = bounced.z;
          _carState.speed      = Math.sqrt(bounced.x ** 2 + bounced.z ** 2);
          _carState.position.x += terrain.pushBack.x;
          _carState.position.z += terrain.pushBack.z;

          if (wallNormal) {
            if (_effetsActifs && _carState.drifting) {
              particles.emitSparks(
                { x: _carState.position.x, y: 0.3, z: _carState.position.z },
                wallNormal, 6
              );
            }

            // RACE-D01 : vérification du seuil de dommage
            const dmg = physics.checkDamage(
              velocityBefore, bounced, wallNormal, _carState.position
            );
            if (dmg.damaged && _vehicleData?.grid && _vehicleData.originalGrid) {
              // RACE-D02 : raycasting et retrait des voxels
              // Seuil = vitesse min casse / punitivité : plus punitivité est élevé, plus ça casse tôt
              const effectiveThreshold = _vitesseMinCasse / _punitivite;
              const { newGrid, removedVoxels } = applyImpactDamage(
                _vehicleData.grid,
                { ...dmg, vehicleAngle: _carState.angle, DAMAGE_THRESHOLD: effectiveThreshold }
              );
              if (removedVoxels.length > 0) {
                _vehicleData.grid = newGrid;

                // RACE-D03 : mise à jour des stats proportionnellement aux voxels restants
                const recalc = recalcStats(newGrid, _vehicleData.originalGrid);
                _vehicleData.stats = {
                  speed: _vehicleData.originalStats.speed * recalc.stats.speed,
                  grip:  _vehicleData.originalStats.grip  * recalc.stats.grip,
                  accel: _vehicleData.originalStats.accel * recalc.stats.accel,
                };

                _mettreAJourMeshVehicule();
                _mettreAJourHUD();

                // Mini-cubes de couleur pour chaque voxel arraché (Story 4.3)
                for (const rv of (_effetsActifs ? removedVoxels : [])) {
                  const hex = COULEUR_HEX[rv.color] ?? '#ffffff';
                  particles.emit(
                    { x: _carState.position.x, y: 0.5 + rv.y * VEHICLE_SCALE, z: _carState.position.z },
                    hex,
                    1
                  );
                }

                // Étincelles de dommage (plus intenses)
                if (_effetsActifs) particles.emitSparks(
                  { x: _carState.position.x, y: 0.5, z: _carState.position.z },
                  wallNormal, 12
                );

                // Story 7.3 : screen shake proportionnel à la vitesse d'impact
                camera.shake(dmg.deltaSpeed * 0.3);

                _nbChocs++;
                _dernierDeltaV = dmg.deltaSpeed;
                console.log(`[dommage] -${removedVoxels.length} voxels (Δv=${dmg.deltaSpeed.toFixed(1)} u/s)`);
              }
            }

            // SOLO-04 : poteau cassé si le choc est fort (le cube est poussé plus haut)
            if (terrain.hardCellType === 'pole') {
              _appliquerEffetSpecial('pole', dmg.deltaSpeed, velocityBefore);
            }
          }
        } else {
          _carState.velocity.x = 0;
          _carState.velocity.z = 0;
          _carState.speed      = 0;
        }

        // Appliquer la velocity rebondie à la position pour sortir du mur.
        // Sans ça le véhicule reste bloqué : la position n'est corrigée que par
        // pushBack (minuscule) et la velocity rebondie n'est jamais utilisée.
        _carState.position.x += _carState.velocity.x * dt;
        _carState.position.z += _carState.velocity.z * dt;

        // Amortissement par frame contre un mur pour éviter les oscillations —
        // pas en poussant un cube, sinon la voiture ne le suivrait jamais.
        if (!pousseCube) {
          _carState.velocity.x *= 0.92;
          _carState.velocity.z *= 0.92;
        }
        _carState.speed = Math.sqrt(_carState.velocity.x ** 2 + _carState.velocity.z ** 2);

        _carState.drifting = false;
      } else {
        // Pas de collision (ou auto-reverse actif : on laisse les forces s'appliquer)
        // Si auto-reverse en collision : pousser hors du mur avant d'appliquer les forces
        if (isAutoReversing && terrain?.hardCollision && terrain.pushBack) {
          _carState.position.x += terrain.pushBack.x * 2;
          _carState.position.z += terrain.pushBack.z * 2;
        }

        const dec       = physics.decompose(_carState.velocity, _carState.angle);
        const driftInfo = physics.detectDrift(dec, _physConsts, statsNorm, surfaceGrip);
        _carState.drifting = enVol ? false : driftInfo.is_drifting;

        // Adhérence nulle en vol : aucune correction latérale, la voiture
        // conserve exactement l'élan qu'elle avait en quittant le sol.
        const newV = physics.computeForces(
          _carState, { throttle }, statsNorm, dt, _physConsts,
          enVol ? 0 : driftInfo.current_grip,
        );
        _carState.velocity.x = newV.x;
        _carState.velocity.z = newV.z;

        // La pente agit sur le vecteur vitesse : on freine en montant, on
        // accélère en descendant.
        physics.applySlopeGravity(
          _carState, terrain?.rampe, PLATEAU_HEIGHT * (_map?.blockScale ?? 1), dt, _physConsts,
        );

        // Boost / collant : agissent sur la vitesse réelle, pas sur un plafond
        // qu'on n'atteint jamais.
        if (_terrainState.boostTimer > 0) {
          const a = (_physConsts?.BOOST_ACCEL ?? 14) * dt;
          _carState.velocity.x += Math.cos(_carState.angle) * a;
          _carState.velocity.z += Math.sin(_carState.angle) * a;
        }
        if (terrain?.softTerrain === 'sticky') {
          const k = Math.max(0, 1 - (_physConsts?.STICKY_DRAG ?? 1.6) * dt);
          _carState.velocity.x *= k;
          _carState.velocity.z *= k;
        }

        const turn_rate = physics.computeTurnRate(steeringEff, dec, driftInfo.is_drifting, _physConsts);
        _carState.angle += turn_rate * dt;

        _carState.position.x += _carState.velocity.x * dt;
        _carState.position.z += _carState.velocity.z * dt;
        _carState.speed = driftInfo.v_speed;

        _mettreAJourDebugPhys(dec, driftInfo);
        _mettreAJourFlechesDebug();
      }
    }

    // V4 : la hauteur vient entièrement de la physique verticale (relief + vol)
    _vehicleGroup.position.set(
      _carState.position.x,
      0.4 + _carState.y,
      _carState.position.z,
    );
    _vehicleGroup.rotation.y = -_carState.angle;
    // SOLO-02 : axe 'x' car rotation.y = -angle ici (véhicule face +X, pas +Z)
    applyRoll(_vehicleGroup, _carState.drifting, _dernierVlat, 'x');

    // Game feel : le capot se lève au décollage et pique en chute. Sans ça, une
    // voiture qui reste plate en l'air se lit comme un sol qui monte.
    const pitchCible = _carState.airborne
      ? Math.max(-0.5, Math.min(0.5, _carState.vy * (_physConsts?.PITCH_FACTOR ?? 0.12)))
      : 0;
    _vehicleGroup.rotation.z += (pitchCible - _vehicleGroup.rotation.z) * 0.25;

    trail.push(
      { x: _carState.position.x, y: 0.4 + _carState.y, z: _carState.position.z },
      _carState.airborne,
    );

    if (_effetsActifs && _carState.drifting && _carState.speed > 0.5) {
      const spd = _carState.speed;
      const nx  = _carState.velocity.x / spd;
      const nz  = _carState.velocity.z / spd;
      const dec = physics.decompose(_carState.velocity, _carState.angle);
      skid.emit(
        { x: _carState.position.x - nx * 0.6, z: _carState.position.z - nz * 0.6 },
        _carState.velocity,
        Math.abs(dec.v_lateral)
      );
    }
    // Un cube qui franchit la frontière de son bloc passe dans le bloc voisin
    const tailleBlocCubes = BLOCK_SIZE * _map.blockScale;
    movables.tick(_movableMeshes.values(), dt, _map.blockScale, _physConsts, (x, z) =>
      mapLoader.getActiveBlocks().find(b =>
        x >= b.position[0] && x < b.position[0] + tailleBlocCubes &&
        z >= b.position[1] && z < b.position[1] + tailleBlocCubes) ?? null);
    skid.update();

    if (_effetsActifs && _carState.drifting && _carState.speed > 5 && Math.random() < 0.12) {
      const spd = _carState.speed;
      const nx  = _carState.velocity.x / spd;
      const nz  = _carState.velocity.z / spd;
      particles.emitDust(
        { x: _carState.position.x - nx * 0.7, y: 0.15, z: _carState.position.z - nz * 0.7 },
        _carState.velocity,
        '#c8b89a',
        1 + Math.floor(Math.random() * 2),
      );
    }
    particles.update(dt);

    const vehicleView = [{
      id:       CAR_ID,
      position: _carState.position,
      y:        _carState.y,          // les visuels de pouvoir suivent les sauts
      angle:    _carState.angle,
      speed:    _carState.speed,
      stats:    { ..._vehicleData.stats },
    }];
    _majLecturesV4();
    powers.update(vehicleView, dt);

    camera.update([{ x: _carState.position.x, z: _carState.position.z, y: _carState.y }]);

    // SOLO-06 : mise à jour mini-carte
    if (_minimapInstance) updateMinimap(_minimapInstance, [{
      id:       CAR_ID,
      position: _carState.position,
      isLocal:  true,
    }]);

    $('speed-val').textContent = _carState.speed.toFixed(1);
    $('drift-label').style.display = _carState.drifting ? '' : 'none';

    // Enregistrement données graphiques (buffer circulaire)
    _speedHist[_chartHead] = _carState.speed;
    _vlatHist[_chartHead]  = _dernierVlat;
    _chartHead = (_chartHead + 1) % CHART_MAX;

    // Stats de session
    if (_carState.speed > _lapSpeedMax) _lapSpeedMax = _carState.speed;
    _lapSpeedSum += _carState.speed;
    _lapFrames++;

    // Rendu graphiques si le panel est visible
    if (_calibVisible) _renderCharts();

    // SOLO-05 : arrivée = distance au centre du bloc arrivée (coin W-1,H-1)
    if (!_arrivee && _map) {
      const ep   = _map.exit?.worldCenter ?? _map.finishPosition;
      const win  = _soloCfg?.WIN_RADIUS ?? 4.0;
      const dist = Math.hypot(_carState.position.x - ep.x, _carState.position.z - ep.z);
      if (dist < win) {
        _arrivee = true;
        $('banner').style.display = 'block';
        _afficherResultatsSession();
        setTimeout(() => _regenererMap(), 2500);
      }
    }
  }

  _renderer.render(_scene, _cam);
  requestAnimationFrame(_boucle);
}

// ---- Écran de démarrage ----

function _afficherAperçuVehicule(data) {
  $('demarrage-nom-vehicule').textContent = data.nom;

  const comptage = data.parCouleur ?? {};
  $('demarrage-couleurs').innerHTML = Object.entries(comptage)
    .sort((a, b) => b[1] - a[1])
    .map(([color, n]) =>
      `<span class="pill" style="background:${COULEUR_HEX[color]}">${COULEUR_FR[color]} ${n}</span>`
    ).join('');

  const MAX_STAT = 12;
  const stats = [
    { label: 'Vitesse',      val: data.stats.speed },
    { label: 'Adhérence',    val: data.stats.grip  },
    { label: 'Accélération', val: data.stats.accel },
  ];
  $('demarrage-stats').innerHTML = stats.map(s => `
    <div class="demarrage-stat-ligne">
      <span class="demarrage-stat-label">${s.label}</span>
      <div class="demarrage-stat-barre-wrap">
        <div class="demarrage-stat-barre" style="width:${Math.min(100, (s.val / MAX_STAT) * 100).toFixed(0)}%"></div>
      </div>
      <span class="demarrage-stat-val">${s.val.toFixed(1)}</span>
    </div>`).join('');
}

async function _genererOuChargerVehicule() {
  $('btn-reroll').disabled = true;
  $('btn-lancer').disabled = true;
  $('demarrage-nom-vehicule').textContent = 'Chargement…';
  $('demarrage-couleurs').innerHTML = '';
  $('demarrage-stats').innerHTML    = '';

  try {
    if (_vehiclesStockes.length > 0) {
      // Utilise le véhicule courant dans le cycle
      _vehiclePregenere = _vehiclesStockes[_vehicleIndex];
      $('source-vehicule').textContent =
        `Véhicule ${_vehicleIndex + 1}/${_vehiclesStockes.length} depuis localStorage`;
    } else {
      _vehiclePregenere = await generateRandomVehicle(_nomAleatoire());
      $('source-vehicule').textContent = 'Véhicule généré aléatoirement (localStorage vide)';
    }
    _afficherAperçuVehicule(_vehiclePregenere);
  } finally {
    $('btn-reroll').disabled = false;
    $('btn-lancer').disabled = false;
  }
}

async function _rerollVehicule() {
  if (_vehiclesStockes.length > 0) {
    _vehicleIndex = (_vehicleIndex + 1) % _vehiclesStockes.length;
  }
  await _genererOuChargerVehicule();
}

function _demarrerEcranDemarrage() {
  _vehiclesStockes = _chargerVehiclesStockes();
  _vehicleIndex    = 0;

  $('btn-reroll').addEventListener('click', _rerollVehicule);

  $('btn-lancer').addEventListener('click', () => {
    $('ecran-demarrage').style.display = 'none';
    init().catch(err => {
      console.error('[test-solo-v3] erreur init :', err);
      $('loading').style.display = 'flex';
      $('loading').innerHTML = `
        <div style="text-align:center;max-width:420px;padding:24px;background:rgba(200,0,0,0.2);border-radius:12px;">
          <div style="font-size:18px;font-weight:700;margin-bottom:10px;">Erreur au démarrage</div>
          <div style="font-size:14px;opacity:0.85;margin-bottom:14px;">${err.message}</div>
          <div style="font-size:12px;opacity:0.6;">Vérifier que le serveur tourne :<br><code>node server.js</code></div>
        </div>`;
    });
  });

  _genererOuChargerVehicule();
}

// ---- Démarrage ----

_demarrerEcranDemarrage();
