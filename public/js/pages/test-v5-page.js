// Page de test V5 — banc d'essai du game feel calibré.
// Lance une partie solo sans lobby ni Socket.io.
// Charge un véhicule depuis localStorage (popvroum_vehicles) ou génère un aléatoire.
// Raccourcis : R = nouvelle map, V = véhicule suivant, D = toggle overlay debug,
//              C = calibration, P = forme du virage.
//
// Copie de test-solo-v3.js au moment du passage en V5 : c'est cette page-ci qui
// évolue désormais, test-solo-v3 est figée comme référence de l'état précédent.

import * as THREE from '../lib/three.module.js';
import { buildVehicleGroup, createPreviewScene, applyRoll, applyPitch, kickSquash, applySquash } from '../modules/voxel/renderer.js';
import { generateRandomVehicle, generatePresetVehicle, PRESETS, COULEUR_HEX, COULEUR_FR } from '../modules/voxel/random-vehicle.js';
import * as controls    from '../modules/game/controls.js';
import * as physics     from '../modules/game/physics.js';
import * as camera      from '../modules/game/camera.js';
import * as skid        from '../modules/game/skid.js';
import * as powers      from '../modules/game/powers.js';
import * as powerFx     from '../modules/game/power-effects.js';
import * as bot         from '../modules/game/bot.js';
import { cohesionState } from '../modules/game/cohesion.js';
import * as cohesionView from '../modules/game/cohesion-view.js';
import * as particles   from '../modules/game/particles.js';
import * as trail       from '../modules/game/trail.js';
import * as movables    from '../modules/game/movables.js';
import * as mapLoader   from '../modules/game/map-loader.js';
import { buildFence, disposeFence } from '../modules/game/fence.js';
import { checkTerrain, boundsFromExtent, setConfig as setCollisionConfig, POLE_RADIUS_RATIO, CUBE_SIZE_RATIO } from '../modules/game/collision.js';
import { loadPool, generate, BLOCK_SIZE } from '../modules/game/map-generator.js';
import { resolveImpact } from '../modules/voxel/impact.js';
import { initMinimap, updateMinimap, disposeMinimap } from '../modules/game/minimap.js';
import { V4_TEST_BLOCKS, trouverSpawnRampe } from '../modules/game/test-blocks-v4.js';
import { construirePisteMesure, construirePisteEffets } from '../modules/game/test-track.js';
import { createTurnAnalyzer, sampleTurn, getTurnReport } from '../modules/game/turn-analyzer.js';
import { renderTurnPanel } from '../modules/game/turn-view.js';
import { buildNavGrid } from '../modules/game/navigation.js';
import { createVehicleSim, tickVehicle, bodyShape } from '../modules/game/vehicle-tick.js';

// Banc d'essai V4 (?v4=1) : remplace le pool de blocs par des blocs de test
// déterministes (rampes dans les 4 directions, plateaux, bosses).
const MODE_V4 = new URLSearchParams(location.search).has('v4');
// Pistes fixes : ?piste=1 → mesure des sauts, ?piste=effets → catalogue des effets
const _PARAM_PISTE = new URLSearchParams(location.search).get('piste');
const MODE_PISTE   = _PARAM_PISTE !== null;
const MODE_EFFETS  = _PARAM_PISTE === 'effets';
let _reperesPiste = [];

// ---- Constantes ----

// Taille monde d'un voxel du véhicule : physics.vehicleScale dans gameplay.json,
// réglable en direct (curseur « Taille du véhicule »). Elle vaut aussi pour les
// chocs : un véhicule plus gros trouve les couloirs plus étroits.
const ECHELLE_DEFAUT = 0.28;
const _echelle = () => _physConsts?.vehicleScale ?? ECHELLE_DEFAUT;
// Hauteur du centre du véhicule au-dessus du sol, proportionnelle à sa taille
// (0,4 u calé à l'origine pour l'échelle 0,28)
const _hauteurCaisse = () => 0.4 * _echelle() / ECHELLE_DEFAUT;

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

// État de simulation du joueur (vehicle-tick) ; _carState en est la voiture
let _sim = null;
let _dtFrame = 0;   // dt de la frame courante, pour les effets au taux par seconde

// Physique V2
let _physConsts      = null;
let _vehicleStatsCfg = null;
let _soloCfg         = {};
let _gripStat        = 1.6;  // stat normalisée (1 = aucun voxel vert)
let _arrowVelocity   = null;
let _arrowForward    = null;

// ---- Paramètres calibration (panel gauche) ----

let _speedStat       = 1.6;  // stat normalisée (1 = aucun voxel rouge)
let _accelStat       = 1.6;  // stat normalisée (1 = aucun voxel bleu)
let _punitivite      = 1.0;   // multiplicateur punitivité dommages (0.1–3.0)
let _vitesseMinCasse = 8.0;   // seuil de vitesse pour casse (0–20 m/s)
let _mapSize         = 20;    // taille de grille map (X et Y) — relue dans map.gridCols
let _clotureActive   = true;  // clôture aux bornes du monde (F)
let _fenceCfg        = null;  // config map.fence
let _fenceBounds     = null;  // bornes courantes, ou null si désactivée
let _fenceGroup      = null;  // parois translucides (visuel seul)
let _blocsVehicule   = 16;    // blocs cibles pour véhicule aléatoire
let _calibVisible    = false;
let _virageVisible   = false;
let _pouvoirsVisible = false;
let _cfgComplet      = null;  // gameplay.json entier : la section powers se règle à chaud
let _nbBots          = 0;     // faux joueurs — sans eux aucun pouvoir n'a de cible
let _effetsParCible  = {};    // sortie de foldEffects, rejouée par la frame suivante
let _playerPowerState = null;
// Ratios de voxels survivants par couleur (1 = intact). Les curseurs de
// calibration remplacent les stats du véhicule ; les dégâts, eux, doivent
// rester une dégradation par-dessus — sinon casser des voxels ne se sent pas.
let _degats = { speed: 1, grip: 1, accel: 1 };
let _detruit = false;
let _etatCohesion = null;
let _intentionsBots = false;  // lignes de visée des bots
let _analyseur       = createTurnAnalyzer();

const MASSE_PAR_BLOC = 25; // kg par voxel — 32 voxels × 25 = 800 kg

// Profils exprimés dans l'échelle réelle des stats normalisées (stat / base),
// celle que produisent les vrais véhicules : 1 = aucun voxel de la couleur.
// Ils valaient 0,1–1,0 avant, une plage que bandeStat() écrase entièrement sur
// son minimum — les profils ne changeaient donc rien non plus.
const PROFILS_CALIBRATION = {
  equilibre:  { speed: 2.0, grip: 2.0, accel: 2.0 },
  drift:      { speed: 3.5, grip: 1.1, accel: 3.0 },
  tank:       { speed: 1.4, grip: 6.5, accel: 1.4 },
  fusee:      { speed: 6.5, grip: 2.0, accel: 6.5 },
  savonnette: { speed: 2.5, grip: 1.0, accel: 2.5 },
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
let _navJoueur      = null;  // grille de navigation pour l'aide couloir
let _aideActive     = true;  // bascule G, pour comparer avec / sans
let _dernierVfwd    = 0;   // vitesse avant, pour le tangage de caisse
let _vfwdPrecedent  = 0;
let _accelLissee    = 0;
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

// ---- Clôture de map ----

// Recalcule bornes et parois pour la map courante. Les bornes servent à la
// collision, le groupe n'est que le rendu : les deux sont refaits ensemble pour
// qu'on ne puisse pas se retrouver avec un mur invisible ou une paroi inerte.
// Hors sujet sur les pistes de mesure (MODE_PISTE), larges d'un seul bloc :
// une clôture y brise les sauts qu'on cherche justement à mesurer.
function _majCloture() {
  disposeFence(_fenceGroup);
  _fenceGroup = null;

  const active = _clotureActive && !MODE_PISTE;
  _fenceBounds = active
    ? boundsFromExtent(_map?.worldExtent, { ..._fenceCfg, enabled: true })
    : null;

  if (_fenceBounds) {
    _fenceGroup = buildFence(_fenceBounds, _fenceCfg);
    if (_fenceGroup) _scene.add(_fenceGroup);
  }

  const btn = $('btn-cloture');
  if (btn) {
    btn.textContent = _clotureActive ? 'Clôture ✓ [F]' : 'Clôture ✗ [F]';
    btn.classList.toggle('actif', _clotureActive);
  }
}

function _toggleCloture() {
  _clotureActive = !_clotureActive;
  _majCloture();
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
  _navJoueur = buildNavGrid(_map);
  const blocmapSize = BLOCK_SIZE * _map.blockScale;
  $('map-info').textContent = MODE_EFFETS
    ? `Piste des effets — ${_map.gridCols} sections`
    : MODE_PISTE
    ? `Piste de mesure — ${_map.gridCols} blocs, 3 tremplins`
    : `Map : ${_map.gridCols}×${_map.gridRows} (${blocmapSize}u/bloc)` + (MODE_V4 ? ' — BANC V4' : '');

  _solGroup = _construireSol(_map);
  _scene.add(_solGroup);

  _majCloture();

  mapLoader.init(_scene, _map, _construireMeshColonne, _physConsts?.RENDER_DISTANCE ?? 3);
  const _initPos = _map.entry?.worldCenter ?? _map.startPosition;
  mapLoader.update(_initPos.x, _cam, _initPos.z ?? 0);

  // SOLO-06 : mini-carte — recréer après chaque nouvelle map
  if (_minimapInstance) disposeMinimap(_minimapInstance);
  _minimapInstance = MODE_PISTE ? null : initMinimap(_map, document.body);

  _resetVoiture();
  const fp = _map.exit?.worldCenter ?? _map.finishPosition;
  powers.setFinishPosition(fp.x, fp.z);
  await _creerBots(); // nouveau départ : les bots respawnent avec le joueur
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
        !checkTerrain({ x: c.x, z: c.z }, blocsCharges, _map.blockScale, 0, bodyShape(c.angle, _echelle()), _fenceBounds).hardCollision)
    : null;
  const spawn = spawnRampe
    ?? _map.entry?.spawnPositions?.[0]
    ?? _map.startPosition;
  _sim = createVehicleSim(spawn);
  _sim.degats = _degats;   // la voiture repart avec ses voxels en moins
  _carState   = _sim.car;
  _arrivee          = false;
  // La voiture est téléportée au départ : sans remise à zéro, ce saut de position
  // serait lu comme un virage absurde.
  _analyseur        = createTurnAnalyzer();
  $('banner').style.display = 'none';

  // Réinitialise les stats de session au départ
  _lapStart       = performance.now();
  _lapSpeedMax    = 0;
  _lapSpeedSum    = 0;
  _lapFrames      = 0;
  _lapVoxelsStart = _voxelsRestants;
}

// ---- Chargement ou génération d'un véhicule ----

async function _chargerVehicule(data, { statsDepuisVehicule = true } = {}) {
  // Les couleurs du véhicule donnent le point de départ des curseurs de
  // conduite (même calcul que le serveur : stat / base, 1 = aucun voxel). Les
  // curseurs restent là pour ajuster par-dessus.
  const vs = _vehicleStatsCfg;
  if (statsDepuisVehicule && vs && data.stats) {
    _speedStat = data.stats.speed / vs.baseSpeed;
    _gripStat  = data.stats.grip  / vs.baseGrip;
    _accelStat = data.stats.accel / vs.baseAccel;
    _syncSliders();
  }
  // Copie profonde de la grille et des stats d'origine (référence pour recalcStats)
  _vehicleData = {
    ...data,
    originalGrid:   data.grid.map(col => col.map(row => [...row])),
    originalStats:  { ...data.stats },
    // Référence pour recalcPowers : sans elle, un pouvoir déjà amoindri
    // servirait de base au calcul suivant et s'effondrerait en cascade.
    originalPowers: { ...(data.powers ?? {}) },
  };
  _degats  = { speed: 1, grip: 1, accel: 1 };
  _detruit = false;
  _voxelsTotal    = _compterVoxels(data.grid);
  _voxelsRestants = _voxelsTotal;
  _nbChocs        = 0;
  _dernierDeltaV  = 0;

  if (_vehicleGroup) {
    _scene.remove(_vehicleGroup);
    _vehicleGroup.clear();
  }
  _vehicleGroup = buildVehicleGroup(_vehicleData);
  _vehicleGroup.scale.setScalar(_echelle());
  _scene.add(_vehicleGroup);

  powers.dispose();
  await powers.init(_scene);
  powerFx.setConfig(_cfgComplet.powers);
  cohesionView.init(_scene, _cfgComplet.cohesion?.halo);
  _powersHandle     = powers.createForVehicle(CAR_ID, _vehicleData.powers);
  _playerPowerState = _powersHandle.powerState;
  await _creerBots();

  _preview.setGroup(buildVehicleGroup(_vehicleData));
  _mettreAJourHUD();
  // Le panneau affiche les points de couleur du véhicule : il se rebâtit avec lui
  if ($('pw-corps')) _construirePanneauPouvoirs();
  _resetVoiture();
}

// Reconstruit le mesh du véhicule après perte de voxels (RACE-D02)
function _mettreAJourMeshVehicule() {
  if (!_vehicleData) return;
  if (_vehicleGroup) {
    _scene.remove(_vehicleGroup);
    // clear() détache les enfants sans libérer leurs géométries : à raison d'une
    // reconstruction par choc, la mémoire GPU montait sans jamais redescendre.
    _vehicleGroup.traverse(o => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    _vehicleGroup.clear();
  }
  _vehicleGroup = buildVehicleGroup(_vehicleData);
  _vehicleGroup.scale.setScalar(_echelle());
  if (_carState) {
    _vehicleGroup.position.set(_carState.position.x, _hauteurCaisse(), _carState.position.z);
    _vehicleGroup.rotation.y = -_carState.angle;
  }
  _scene.add(_vehicleGroup);

  // L'aperçu du panneau montrait le véhicule intact quoi qu'il arrive : il
  // n'était reconstruit qu'au chargement d'un véhicule, jamais après un dégât.
  _preview?.setGroup(buildVehicleGroup(_vehicleData));

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

// ---- Mise en scène des événements de conduite ----

// Le module vehicle-tick fait avancer la voiture et raconte ce qui s'est passé ;
// ici on en tire les secousses, étincelles, poussières et relevés de debug.
function _mettreEnSceneEvenements(ev) {
  const terrain = ev.terrain;
  _dernierTerrain = terrain?.hardCollision ? 'mur' : (terrain?.softTerrain ?? null);

  if (ev.boostEntered)  camera.kick(-(_physConsts?.BOOST_ZOOM ?? 3));   // la vue se resserre : vitesse
  if (ev.stickyEntered) camera.kick(_physConsts?.STICKY_ZOOM ?? 2.5);   // la vue s'élargit : on s'enlise

  if (ev.landed) {
    camera.shake(ev.landed.impact * (_physConsts?.LANDING_SHAKE ?? 0.25));
    if (_effetsActifs) kickSquash(_vehicleGroup, ev.landed.impact, _physConsts);
    const reception = ev.landed.reception;
    _derniereReception = reception.perte > 0
      ? `${(reception.desalignement * 100).toFixed(0)} % de travers · −${(reception.perte * 100).toFixed(0)} % vitesse`
      : 'propre';
    if (_effetsActifs) {
      particles.emitLanding({ x: _carState.position.x, y: _carState.y + 0.1, z: _carState.position.z }, 8);
    }
  }

  _majEtatAide(ev.aide);

  const c = ev.contact;
  if (c) {
    // Étincelles de frottement : à chaque contact qui glisse le long de la paroi,
    // pas seulement en drift. Le nombre suit la durée de contact (taux par
    // seconde) pour ne pas dépendre du framerate.
    const seuil = _physConsts?.scrapeMinSpeed ?? 2.0;
    if (_effetsActifs && !c.pushingCube && c.tangentSpeed > seuil) {
      const attendu = (_physConsts?.scrapeSparkRate ?? 25) * _dtFrame * (c.tangentSpeed / seuil);
      const nb = Math.floor(attendu) + (Math.random() < attendu % 1 ? 1 : 0);
      if (nb > 0) particles.emitSparks(
        { x: _carState.position.x - c.normal.x * 0.5, y: 0.3,
          z: _carState.position.z - c.normal.z * 0.5 },
        c.normal, nb
      );
    }
    if (c.fresh && c.dmg.damaged) _encaisserChoc(c);
  }

  if (ev.poleBroken) ev.poleBroken.entry.mesh.visible = false;

  // Récompense de sortie de glisse (façon mini-turbo)
  if (ev.driftCharge?.libere && _effetsActifs) {
    camera.kick(-(_physConsts?.BOOST_ZOOM ?? 3) * 0.5 * ev.driftCharge.charge);
  }

  if (ev.dec) {
    _mettreAJourDebugPhys(ev.dec, ev.driftInfo);
    _mettreAJourFlechesDebug();
  }
}

// Choc endommageant : voxels arrachés, stats et pouvoirs recalculés, mesh rebâti
function _encaisserChoc(c) {
  // Seuil = vitesse min casse / punitivité : plus punitivité est élevé, plus ça casse tôt
  const res = resolveImpact(_vehicleData, c.dmg, _carState.angle, _vitesseMinCasse / _punitivite);
  if (!res) return;

  _degats      = res.degats;
  _sim.degats  = _degats;
  powers.removeVehicle(CAR_ID);
  _powersHandle     = powers.createForVehicle(CAR_ID, _vehicleData.powers);
  _playerPowerState = _powersHandle.powerState;

  _mettreAJourMeshVehicule();
  _mettreAJourHUD();
  _verifierDestruction();

  if (_effetsActifs) {
    // Mini-cubes de couleur pour chaque voxel arraché
    for (const rv of res.removedVoxels) {
      particles.emit(
        { x: _carState.position.x, y: 0.5 + rv.y * _echelle(), z: _carState.position.z },
        COULEUR_HEX[rv.color] ?? '#ffffff',
        1
      );
    }
    // Étincelles de dommage (plus intenses)
    particles.emitSparks({ x: _carState.position.x, y: 0.5, z: _carState.position.z }, c.normal, 12);
  }

  // Secousse proportionnelle à la vitesse d'impact
  camera.shake(c.dmg.deltaSpeed * 0.3);

  _nbChocs++;
  _dernierDeltaV = c.dmg.deltaSpeed;
  console.log(`[dommage] -${res.removedVoxels.length} voxels (Δv=${c.dmg.deltaSpeed.toFixed(1)} u/s)`);
}

// ---- Helpers debug physique ----

function _mettreAJourDebugPhys(dec, driftInfo = null) {
  const { v_forward, v_lateral } = dec;
  _dernierVlat = v_lateral;
  _dernierVfwd = v_forward;

  $('dbg-vx').textContent    = _carState.velocity.x.toFixed(2);
  $('dbg-vz').textContent    = _carState.velocity.z.toFixed(2);
  $('dbg-speed').textContent = _carState.speed.toFixed(2);
  $('dbg-vfwd').textContent  = v_forward.toFixed(2);
  $('dbg-vlat').textContent  = v_lateral.toFixed(2);
  $('dbg-angle').textContent = (_carState.angle * 180 / Math.PI % 360).toFixed(1) + '°';
  if (driftInfo) {
    // L'angle de dérive a remplacé la vitesse latérale absolue comme grandeur de
    // référence : c'est lui qu'on lit pour juger la conduite.
    $('dbg-threshold').textContent =
      `${driftInfo.slipDeg.toFixed(1)}° / ${driftInfo.drift_threshold.toFixed(0)}°`;
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
function _majEtatAide(aide = null) {
  const el = $('dbg-aide');
  if (!el) return;
  if (!_aideActive || !_physConsts?.steerAssist?.enabled) {
    el.textContent = 'OFF (G)'; el.style.color = '#888'; return;
  }
  el.style.color = '';
  el.textContent = aide
    ? `${aide.correction >= 0 ? '+' : ''}${aide.correction.toFixed(2)}  (G ${aide.gauche.toFixed(1)} / D ${aide.droite.toFixed(1)})`
    : 'ON (G)';
}

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

// Affiche la stat brute ET ce qu'elle produit réellement. Sans le second
// chiffre, rien ne signale que bandeStat() sature : on croyait régler alors que
// la valeur ne bougeait plus.
function _libelleStat(brut, unite, valeur) {
  return `${brut.toFixed(1)} → ${valeur.toFixed(1)} ${unite}`;
}

function _syncSliders() {
  const c = _physConsts;
  const poser = (idSl, idVal, valeur, texte) => {
    const sl = $(idSl);
    if (sl) sl.value = valeur;
    const el = $(idVal);
    if (el) el.textContent = texte;
  };

  if (c) {
    poser('sl-speed', 'val-speed', _speedStat, _libelleStat(_speedStat, 'u/s',
      c.vmaxGlobal * physics.bandeStat(_speedStat, c.speedStatMin, c.speedStatMax)));
    poser('sl-grip-cal', 'val-grip-cal', _gripStat, _libelleStat(_gripStat, 'u/s²',
      c.gripAccel * physics.bandeStat(_gripStat, c.gripStatMin, c.gripStatMax)));
    poser('sl-accel', 'val-accel', _accelStat, _libelleStat(_accelStat, 'u/s²',
      c.engineAccel * physics.bandeStat(_accelStat, c.accelStatMin, c.accelStatMax)));
  }

  // Plafonds : la valeur brute, et à côté ce que le véhicule courant en tire
  if (c) {
    const poserPlafond = (idSl, idVal, valeur, effectif, unite) => {
      const sl = $(idSl);
      if (sl) sl.value = valeur;
      const el = $(idVal);
      if (el) el.textContent = `${valeur.toFixed(1)} → ${effectif.toFixed(1)} ${unite}`;
    };
    poserPlafond('sl-vmax', 'val-vmax', c.vmaxGlobal,
      c.vmaxGlobal * physics.bandeStat(_speedStat, c.speedStatMin, c.speedStatMax), 'u/s');
    poserPlafond('sl-gripref', 'val-gripref', c.gripAccel,
      c.gripAccel * physics.bandeStat(_gripStat, c.gripStatMin, c.gripStatMax), 'u/s²');
    poserPlafond('sl-engine', 'val-engine', c.engineAccel,
      c.engineAccel * physics.bandeStat(_accelStat, c.accelStatMin, c.accelStatMax), 'u/s²');
  }

  // Sync avec le slider grip du relevé Physique V5 (onglet Mesures)
  const sg2 = $('slider-grip');
  if (sg2) sg2.value = _gripStat;
  const gv2 = $('grip-val');
  if (gv2) gv2.textContent = _gripStat.toFixed(2);
}

// Taille relative au réglage d'origine, et largeur du véhicule / largeur d'une case
function _majLibelleTaille() {
  const e   = _echelle();
  const sl  = $('sl-taille');
  if (sl) sl.value = e;
  const el  = $('val-taille');
  const cas = _map?.blockScale ?? _blockScaleConfig;
  if (el) el.textContent = `×${(e / ECHELLE_DEFAUT).toFixed(2)} · ${(4 * e).toFixed(2)} u / ${cas} u`;
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

// Calibration et forme du virage occupent le même tiroir : ouvrir l'un ferme l'autre.
// ---- Atelier : un seul dock, une page par sujet ----
//
// Les cinq bascules indépendantes d'avant (calibration, virage, pouvoirs,
// équilibrage, physique) pouvaient se recouvrir et s'annuler entre elles.
// Ici un seul état : l'onglet actif. Les booléens survivent parce que la boucle
// de rendu s'en sert pour ne calculer les courbes que si elles sont visibles.
let _ongletActif = 'vehicule';

function _activerOnglet(nom) {
  _ongletActif = nom;

  for (const b of document.querySelectorAll('.onglet')) {
    b.classList.toggle('actif', b.dataset.onglet === nom);
  }
  for (const v of document.querySelectorAll('.volet')) {
    v.classList.toggle('actif', v.id === `volet-${nom}`);
  }

  _calibVisible    = nom === 'physique';
  _virageVisible   = nom === 'virage';
  _pouvoirsVisible = nom === 'pouvoirs';
  _overlayVisible  = nom === 'mesures';

  if (_pouvoirsVisible) _majRelevePouvoirs();

  // Ouvrir un onglet sur un dock replié n'aurait rien montré
  _replierAtelier(false);
}

function _replierAtelier(replie) {
  $('atelier').classList.toggle('replie', replie);
}

function _basculerAtelier() {
  _replierAtelier(!$('atelier').classList.contains('replie'));
}

// Véhicules de référence : l'équilibrage a besoin de repères reproductibles,
// pas d'un tirage différent à chaque essai.
function _construireBoutonsPresets() {
  const hote = $('presets-btn');
  if (!hote) return;
  hote.innerHTML = '';

  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.className = 'profil-btn';
    b.style.width = '100%';
    b.style.marginBottom = '4px';
    b.textContent = p.nom;
    b.title = p.note;
    b.addEventListener('click', () => _chargerPreset(p.id));
    hote.appendChild(b);
  }
}

async function _chargerPreset(id) {
  try {
    _vehiclePregenere = await generatePresetVehicle(id);
    await _chargerVehicule(_vehiclePregenere);
    _vehiclePregenere = null;
    for (const b of $('presets-btn').querySelectorAll('button')) {
      b.classList.toggle('actif', b.textContent === _vehicleData?.nom);
    }
  } catch (err) {
    console.error('[preset] échec', err);
  }
}

// Les pouvoirs sont altruistes : ils ne s'appliquent qu'aux autres véhicules.
// Sans bots, la page ne peut donc rien en montrer — c'est tout l'objet de ces
// faux joueurs, qui subissent réellement les effets et en émettent aussi.
async function _creerBots() {
  bot.dispose();
  if (_nbBots === 0 || !_map) return;

  const configs = await bot.loadConfigs(_nbBots);
  bot.init(
    _scene, configs, _map.startPosition,
    (_map.exit?.worldCenter ?? _map.finishPosition).x,
    _cfgComplet.cohesion?.radiusUnits ?? 8, _cfgComplet,
  );
  // Vrais chemins à travers le labyrinthe au lieu d'un cap en ligne droite
  bot.setNavigation(_map, { bounds: _fenceBounds, plateauHeight: PLATEAU_HEIGHT });
  bot.setShowIntentions(_intentionsBots);

  // powers.js partage l'état des bots au lieu d'en créer un second : sinon le
  // dôme affiché et les PV réellement consommés divergeraient.
  for (const etat of bot.getStates()) {
    powers.removeVehicle(etat.id);
    powers.createForVehicle(etat.id, {}, etat.power);
  }
}

// ---- Calibrage des pouvoirs (tiroir « Pouvoirs [O] ») ----
//
// Ne sont exposés ici que les réglages qui ont un effet réel aujourd'hui :
// les quatre pouvoirs branchés. Violet (attraction) et rose (soin) ne sont pas
// implémentés — ils sont absents plutôt que représentés par des curseurs morts.
// La détection vient de power-effects.js, le module que le serveur utilise
// aussi : ce qui se règle ici se transpose tel quel en partie.

const PW_CURSEURS = [
  { grp: 'Rouge — Aspiration', cle: 'aspiration.boostStrength',  min: 1,    max: 2.5, pas: 0.05, forme: false, lbl: 'Force du boost (×vit)' },
  { grp: 'Rouge — Aspiration', cle: 'aspiration.offset',         min: 0,    max: 4,   pas: 0.1,  forme: true,  lbl: 'Départ derrière (u)' },
  { grp: 'Rouge — Aspiration', cle: 'aspiration.sizeBase',       min: 0.5,  max: 8,   pas: 0.1,  forme: true,  lbl: 'Longueur de base (u)' },
  { grp: 'Rouge — Aspiration', cle: 'aspiration.sizeParPoint',   min: 0,    max: 2,   pas: 0.05, forme: true,  lbl: 'Longueur par point' },
  { grp: 'Rouge — Aspiration', cle: 'aspiration.halfWidthRatio', min: 0.1,  max: 1.5, pas: 0.05, forme: true,  lbl: 'Évasement' },

  { grp: 'Vert — Phares',      cle: 'phares.gripBoost',          min: 1,    max: 2.5, pas: 0.05, forme: false, lbl: 'Gain d\'adhérence (×)' },
  { grp: 'Vert — Phares',      cle: 'phares.offset',             min: 0,    max: 4,   pas: 0.1,  forme: true,  lbl: 'Départ devant (u)' },
  { grp: 'Vert — Phares',      cle: 'phares.lengthBase',         min: 1,    max: 15,  pas: 0.5,  forme: true,  lbl: 'Portée de base (u)' },
  { grp: 'Vert — Phares',      cle: 'phares.lengthParPoint',     min: 0,    max: 3,   pas: 0.1,  forme: true,  lbl: 'Portée par point' },
  { grp: 'Vert — Phares',      cle: 'phares.radiusBase',         min: 0.2,  max: 8,   pas: 0.1,  forme: true,  lbl: 'Largeur de base (u)' },
  { grp: 'Vert — Phares',      cle: 'phares.radiusParPoint',     min: 0,    max: 2,   pas: 0.05, forme: true,  lbl: 'Largeur par point' },

  { grp: 'Bleu — Sillage',     cle: 'sillage.accelBoost',        min: 1,    max: 2.5, pas: 0.05, forme: false, lbl: 'Relance (×accél)' },
  { grp: 'Bleu — Sillage',     cle: 'sillage.lifetimeSec',       min: 0.5,  max: 10,  pas: 0.25, forme: false, lbl: 'Durée de vie (s)' },
  { grp: 'Bleu — Sillage',     cle: 'sillage.radiusBase',        min: 0.2,  max: 4,   pas: 0.1,  forme: true,  lbl: 'Rayon de base (u)' },
  { grp: 'Bleu — Sillage',     cle: 'sillage.radiusParPoint',    min: 0,    max: 1,   pas: 0.05, forme: true,  lbl: 'Rayon par point' },
  { grp: 'Bleu — Sillage',     cle: 'sillage.emitPeriodSec',     min: 0.05, max: 1,   pas: 0.05, forme: true,  lbl: 'Intervalle de dépôt (s)' },

  { grp: 'Orange — Bouclier',  cle: 'shield.absorption',         min: 0,    max: 1,   pas: 0.05, forme: false, lbl: 'Part du choc absorbée' },
  { grp: 'Orange — Bouclier',  cle: 'shield.domeMin',            min: 0.3,  max: 3,   pas: 0.1,  forme: true,  lbl: 'Rayon mini du dôme (u)' },
  { grp: 'Orange — Bouclier',  cle: 'shield.domeMax',            min: 0.5,  max: 5,   pas: 0.1,  forme: true,  lbl: 'Rayon maxi du dôme (u)' },
  { grp: 'Orange — Bouclier',  cle: 'shield.domeParPoint',       min: 0,    max: 0.4, pas: 0.01, forme: true,  lbl: 'Rayon par point' },
];

const PW_COULEURS = [
  { cle: 'aspiration', lbl: 'Aspiration (rouge)', couleur: '#ff6b6b' },
  { cle: 'phares',     lbl: 'Phares (vert)',      couleur: '#7ee787' },
  { cle: 'sillage',    lbl: 'Sillage (bleu)',     couleur: '#79b8ff' },
  { cle: 'shield',     lbl: 'Bouclier (orange)',  couleur: '#ffab70' },
];

const PW_NOM_EFFET = {
  aspiration_boost: 'aspiration',
  phares_grip:      'phares',
  sillage_accel:    'sillage',
};

const _pwLire   = cle => { const [a, b] = cle.split('.'); return _cfgComplet.powers[a][b]; };
const _pwEcrire = (cle, v) => { const [a, b] = cle.split('.'); _cfgComplet.powers[a][b] = v; };
const _pwId     = cle => cle.replace('.', '-');

function _construirePanneauPouvoirs() {
  const hote = $('pw-corps');
  hote.innerHTML = '';

  hote.insertAdjacentHTML('beforeend', `
    <div class="pw-note">Les pouvoirs ne s'appliquent qu'aux <i>autres</i> véhicules :
      sans bots, rien à voir.</div>
    <div class="cal-section">Bots</div>
    <div class="cal-row"><span class="cal-lbl">Nombre de bots</span>
      <span class="cal-val" id="v-nb-bots">${_nbBots}</span></div>
    <input type="range" id="s-nb-bots" min="0" max="4" step="1" value="${_nbBots}">
    <div class="pw-note">Profils : 1 rouge aspiration · 2 bleu sillage ·
      3 vert phares · 4 orange bouclier.</div>
    <label class="pw-note" style="display:flex;gap:6px;align-items:center;opacity:.8;cursor:pointer">
      <input type="checkbox" id="c-intentions" ${_intentionsBots ? 'checked' : ''}>
      Voir ce que visent les bots</label>
    <div class="pw-note">Vert : vers la sortie · jaune : revient vers toi ·
      bleu : t'attend · rouge : se dégage en marche arrière.</div>
    <div id="bots-modes"></div>

    <div class="cal-section">Pouvoirs actifs</div>
    <div id="pw-releve"><div class="fx-vide">—</div></div>

    <div class="cal-section">Mon véhicule — points par couleur</div>`);

  for (const c of PW_COULEURS) {
    const val = _vehicleData?.powers?.[c.cle] ?? 0;
    hote.insertAdjacentHTML('beforeend', `
      <div class="cal-row"><span class="cal-lbl" style="color:${c.couleur}">${c.lbl}</span>
        <span class="cal-val" id="v-pw-${c.cle}">${val.toFixed(1)}</span></div>
      <input type="range" id="s-pw-${c.cle}" min="0" max="15" step="0.5" value="${val}">`);
  }

  let groupe = null;
  for (const cur of PW_CURSEURS) {
    if (cur.grp !== groupe) {
      groupe = cur.grp;
      hote.insertAdjacentHTML('beforeend', `<div class="cal-section">${cur.grp}</div>`);
    }
    hote.insertAdjacentHTML('beforeend', `
      <div class="cal-row"><span class="cal-lbl">${cur.lbl}</span>
        <span class="cal-val" id="v-${_pwId(cur.cle)}">${_pwLire(cur.cle)}</span></div>
      <input type="range" id="s-${_pwId(cur.cle)}" min="${cur.min}" max="${cur.max}"
             step="${cur.pas}" value="${_pwLire(cur.cle)}">`);
  }

  hote.insertAdjacentHTML('beforeend', `
    <div class="cal-section">Outils</div>
    <button class="profil-btn" id="btn-pw-bouclier" style="width:100%">Recharger les boucliers</button>
    <button class="profil-btn" id="btn-pw-copier" style="width:100%;margin-top:5px">Copier le JSON « powers »</button>
    <button class="profil-btn" id="btn-pw-reset" style="width:100%;margin-top:5px">Rétablir le fichier</button>
    <div class="pw-note" id="pw-msg"></div>`);

  // ---- Écouteurs ----
  $('s-nb-bots').addEventListener('input', e => { $('v-nb-bots').textContent = e.target.value; });
  $('s-nb-bots').addEventListener('change', async e => {
    _nbBots = parseInt(e.target.value, 10);
    await _creerBots();
  });
  $('c-intentions').addEventListener('change', e => {
    _intentionsBots = e.target.checked;
    bot.setShowIntentions(_intentionsBots);
  });

  for (const c of PW_COULEURS) {
    $(`s-pw-${c.cle}`).addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      $(`v-pw-${c.cle}`).textContent = v.toFixed(1);
      _vehicleData.powers = { ..._vehicleData.powers, [c.cle]: v };
    });
    $(`s-pw-${c.cle}`).addEventListener('change', _rebatirPouvoirsJoueur);
  }

  for (const cur of PW_CURSEURS) {
    const el = $(`s-${_pwId(cur.cle)}`);
    el.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      $(`v-${_pwId(cur.cle)}`).textContent = v;
      _pwEcrire(cur.cle, v);
      powerFx.setConfig(_cfgComplet.powers); // forces et durées : effet immédiat
    });
    // Les formes sont figées dans l'état à sa création : seul un changement de
    // forme oblige à tout reconstruire, et on attend le relâchement.
    if (cur.forme) el.addEventListener('change', _rebatirPouvoirs);
  }

  $('btn-pw-bouclier').addEventListener('click', _rechargerBoucliers);

  $('btn-pw-copier').addEventListener('click', async () => {
    const json = JSON.stringify({ powers: _cfgComplet.powers }, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      $('pw-msg').textContent = 'Copié — à coller dans config/gameplay.json.';
    } catch {
      $('pw-msg').textContent = 'Copie refusée par le navigateur : JSON envoyé dans la console.';
      console.log(json);
    }
  });

  $('btn-pw-reset').addEventListener('click', async () => {
    _cfgComplet.powers = (await fetch('/config/gameplay.json').then(r => r.json())).powers;
    powerFx.setConfig(_cfgComplet.powers);
    for (const cur of PW_CURSEURS) {
      $(`s-${_pwId(cur.cle)}`).value       = _pwLire(cur.cle);
      $(`v-${_pwId(cur.cle)}`).textContent = _pwLire(cur.cle);
    }
    await _rebatirPouvoirs();
    $('pw-msg').textContent = 'Valeurs du fichier rétablies.';
  });
}

// Véhicule détruit : plus aucun voxel. Le seuil vit dans gameplay.json plutôt
// qu'en dur — à 0 il faut que la carrosserie soit entièrement arrachée.
function _verifierDestruction() {
  if (_detruit) return;
  const seuil = _physConsts?.GAME_OVER_VOXELS ?? 0;
  if (_voxelsRestants > seuil) return;

  _detruit = true;
  const b = $('banner');
  b.textContent = 'Véhicule détruit';
  b.style.background = 'rgba(255, 107, 107, 0.96)';
  b.style.display = 'block';
  _afficherResultatsSession();
  setTimeout(async () => {
    b.textContent = 'Arrivée !';
    b.style.background = '';
    b.style.display = 'none';
    // Repartir avec une épave n'aurait pas de sens : on restaure la carrosserie
    // depuis les copies d'origine prises au chargement.
    await _chargerVehicule({
      ..._vehicleData,
      grid:   _vehicleData.originalGrid.map(col => col.map(row => [...row])),
      stats:  { ..._vehicleData.originalStats },
      powers: { ..._vehicleData.originalPowers },
    }, { statsDepuisVehicule: false });   // même véhicule : on garde les réglages
    await _regenererMap();
  }, 2500);
}

function _rebatirPouvoirsJoueur() {
  powers.removeVehicle(CAR_ID); // sinon l'entrée s'empile : visuels ET détection en double
  _powersHandle     = powers.createForVehicle(CAR_ID, _vehicleData.powers ?? {});
  _playerPowerState = _powersHandle.powerState;
}

// Après un changement de forme, tous les états doivent être reconstruits.
async function _rebatirPouvoirs() {
  powerFx.setConfig(_cfgComplet.powers);
  bot.rebuildPowerStates();
  for (const etat of bot.getStates()) {
    powers.removeVehicle(etat.id);
    powers.createForVehicle(etat.id, {}, etat.power);
  }
  _rebatirPouvoirsJoueur();
}

// Le bouclier ne se recharge pas en partie (prd_pouvoirs.md §5), mais pour le
// régler il faut pouvoir le remettre à neuf sans relancer la page.
function _rechargerBoucliers() {
  const etats = [_playerPowerState, ...bot.getStates().map(b => b.power)];
  for (const st of etats) {
    if (!st?.shield) continue;
    st.shield.hp     = st.shield.hpMax;
    st.shield.active = true;
  }
}

const MODE_BOT = {
  sortie: 'vers la sortie', rejoindre: 'revient vers toi',
  attente: "t'attend", recul: 'se dégage',
};

function _majRelevePouvoirs() {
  const zm = $('bots-modes');
  if (zm) {
    zm.innerHTML = bot.getModes().map(m =>
      `<div class="fx-src">${m.nom} — ${MODE_BOT[m.mode] ?? m.mode}</div>`).join('');
  }
  const zone = $('pw-releve');
  if (!zone) return;

  const noms = { [CAR_ID]: 'Moi' };
  for (const b of bot.getStates()) noms[b.id] = b.nom;

  const lignes = [];
  for (const [cible, fx] of Object.entries(_effetsParCible)) {
    const muls = [];
    if (fx.speedMul !== 1) muls.push(`vit ×${fx.speedMul.toFixed(2)}`);
    if (fx.gripMul  !== 1) muls.push(`adh ×${fx.gripMul.toFixed(2)}`);
    if (fx.accelMul !== 1) muls.push(`acc ×${fx.accelMul.toFixed(2)}`);
    const src = [...new Set(fx.sources.map(
      x => `${PW_NOM_EFFET[x.effect] ?? x.effect} ← ${noms[x.sourceId] ?? x.sourceId}`))];
    lignes.push(`<div class="fx-ligne"><b>${noms[cible] ?? cible}</b> — ${muls.join(', ') || '—'}`
      + `<div class="fx-src">${src.join(' · ')}</div></div>`);
  }

  const sh = _playerPowerState?.shield;
  const bouclier = sh
    ? `<div class="fx-src">Mon bouclier : ${sh.active ? `${sh.hp.toFixed(1)} / ${sh.hpMax.toFixed(1)}` : 'détruit'}</div>`
    : '';

  zone.innerHTML = (lignes.length
    ? lignes.join('')
    : '<div class="fx-vide">Aucun pouvoir actif — ajoute des bots et rapproche-toi.</div>') + bouclier;
}

// Taille de map : les deux axes restent liés (le générateur procédural est carré).
// L'avertissement vient de mesures réelles, pas d'une estimation : au-delà d'une
// quinzaine de blocs la génération se compte en centaines de ms, et _addLoops()
// n'ajoute que gridSize/2 reconnexions — à 64 le labyrinthe devient quasi parfait
// (0,8 % de boucles), donc un seul chemin et des milliers d'impasses.
function _majTailleMap(taille) {
  _mapSize = taille;
  for (const axe of ['x', 'y']) {
    $(`sl-map-${axe}`).value        = taille;
    $(`val-map-${axe}`).textContent = taille;
  }

  const avert = $('avert-map');
  if (!avert) return;
  if (taille > 40) {
    avert.textContent = `${taille}×${taille} : génération lente (~1 s, parfois plusieurs), `
      + 'labyrinthe quasi sans boucle et traversée de plusieurs minutes.';
    avert.style.display = '';
  } else if (taille > 24) {
    avert.textContent = `${taille}×${taille} : génération plus lente et traversée longue `
      + '(plusieurs minutes).';
    avert.style.display = '';
  } else {
    avert.style.display = 'none';
  }
}

// Vitesse max du véhicule sur sol normal, sans effet de terrain : c'est la
// référence des pourcentages de vitesse (un boost peut donc dépasser 100 %).
function _vmaxNominale() {
  if (!_physConsts) return 1;
  return _physConsts.vmaxGlobal
    * physics.bandeStat(_speedStat, _physConsts.speedStatMin, _physConsts.speedStatMax);
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
  // Échelle calée sur la vraie vitesse max (+30 % pour les boosts). La valeur fixe
  // de 40 datait d'avant la division de la vitesse par deux : la courbe n'occupait
  // plus que le quart bas du graphique.
  const vmax = _vmaxNominale() * 1.3;
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
  const vlatMax = _vmaxNominale() * 0.5;   // même raison que vmax ci-dessus
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
  _cfgComplet      = cfgPhys;
  _physConsts      = cfgPhys.physics;
  setCollisionConfig(cfgPhys.physics); // WALL_TOP_LEVEL : sauter par-dessus les murs
  _vehicleStatsCfg = cfgPhys.vehicleStats;
  // Taille de map par défaut : la même que le multijoueur (map.gridCols)
  _majTailleMap(cfgPhys.map?.gridCols ?? _mapSize);
  _majLibelleTaille();
  _soloCfg         = cfgPhys.solo ?? {};
  _blockScaleConfig = cfgPhys.map?.blockScale ?? 2;
  _fenceCfg         = cfgPhys.map?.fence ?? {};
  _clotureActive    = _fenceCfg.enabled !== false;

  // Les curseurs du volant partent des valeurs de gameplay.json
  const rampe  = _physConsts.steerRampTime   ?? 0;
  const retour = _physConsts.steerReturnTime ?? 0;
  $('sl-steer-ramp').value          = rampe;
  $('val-steer-ramp').textContent   = `${rampe.toFixed(2)} s`;
  $('sl-steer-return').value        = retour;
  $('val-steer-return').textContent = `${retour.toFixed(2)} s`;

  // Les curseurs de dérapage partent des valeurs de gameplay.json
  const driftEnter = _physConsts.driftEnterDeg      ?? 16;
  const driftExit   = _physConsts.driftExitDeg       ?? 9;
  const driftBoost  = _physConsts.driftRotationBoost ?? 0.25;
  const yawDamp     = _physConsts.yawDamping         ?? 2.0;
  const turnLat     = _physConsts.turnLatAccel       ?? 20;
  const turnSpd     = _physConsts.turnSpeed          ?? 3.5;
  $('sl-drift-enter').value        = driftEnter;
  $('val-drift-enter').textContent = `${driftEnter.toFixed(0)}°`;
  $('sl-drift-exit').value         = driftExit;
  $('val-drift-exit').textContent  = `${driftExit.toFixed(0)}°`;
  $('sl-drift-boost').value        = driftBoost;
  $('val-drift-boost').textContent = driftBoost.toFixed(2);
  $('sl-yaw-damp').value           = yawDamp;
  $('val-yaw-damp').textContent    = yawDamp.toFixed(1);
  $('sl-turn-lat').value           = turnLat;
  $('val-turn-lat').textContent    = turnLat.toFixed(0);
  $('sl-turn-speed').value         = turnSpd;
  $('val-turn-speed').textContent  = turnSpd.toFixed(1);

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
  _construirePanneauPouvoirs();
  _construireBoutonsPresets();
  _syncSliders(); // libellés « brut → effet réel » corrects dès l'ouverture
  for (const b of document.querySelectorAll('.onglet')) {
    b.addEventListener('click', () => _activerOnglet(b.dataset.onglet));
  }
  $('btn-atelier').addEventListener('click', _basculerAtelier);
  _activerOnglet('vehicule');

  // Volant : réglage en direct, sans toucher à gameplay.json
  $('sl-steer-ramp').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (_physConsts) _physConsts.steerRampTime = v;
    $('val-steer-ramp').textContent = `${v.toFixed(2)} s`;
  });
  $('sl-steer-return').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (_physConsts) _physConsts.steerReturnTime = v;
    $('val-steer-return').textContent = `${v.toFixed(2)} s`;
  });

  // Dérapage : réglage en direct, sans toucher à gameplay.json
  $('sl-drift-enter').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (_physConsts) _physConsts.driftEnterDeg = v;
    $('val-drift-enter').textContent = `${v.toFixed(0)}°`;
  });
  $('sl-drift-exit').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (_physConsts) _physConsts.driftExitDeg = v;
    $('val-drift-exit').textContent = `${v.toFixed(0)}°`;
  });
  $('sl-drift-boost').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (_physConsts) _physConsts.driftRotationBoost = v;
    $('val-drift-boost').textContent = v.toFixed(2);
  });
  $('sl-yaw-damp').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (_physConsts) _physConsts.yawDamping = v;
    $('val-yaw-damp').textContent = v.toFixed(1);
  });
  $('sl-turn-lat').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (_physConsts) _physConsts.turnLatAccel = v;
    $('val-turn-lat').textContent = v.toFixed(0);
  });
  $('sl-turn-speed').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (_physConsts) _physConsts.turnSpeed = v;
    $('val-turn-speed').textContent = v.toFixed(1);
  });
  $('btn-auto-boucle').addEventListener('click', () => {
    _autoLoop = !_autoLoop;
    $('btn-auto-boucle').textContent = _autoLoop ? 'Auto ✓ [A]' : 'Auto [A]';
  });
  $('btn-cloture').addEventListener('click', _toggleCloture);

  // Sliders calibration — map
  // Map : l'affichage suit le glissement, la génération attend le relâchement.
  // Régénérer sur « input » était tenable jusqu'à 8 blocs ; à 64 (≈800 ms par
  // tirage, retries compris) traîner le curseur gelait l'onglet.
  for (const axe of ['x', 'y']) {
    $(`sl-map-${axe}`).addEventListener('input', e => {
      _majTailleMap(parseInt(e.target.value, 10));
    });
    $(`sl-map-${axe}`).addEventListener('change', () => _regenererMap());
  }

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

  // Taille du véhicule : mute _physConsts.vehicleScale, relu à chaque frame par
  // la collision (vehicle-tick) comme par le rendu
  $('sl-taille').addEventListener('input', e => {
    if (_physConsts) _physConsts.vehicleScale = parseFloat(e.target.value);
    _vehicleGroup?.scale.setScalar(_echelle());
    _majLibelleTaille();
  });

  // Plafonds globaux — mutent _physConsts, que la physique relit chaque frame
  for (const [idSl, cle] of [['sl-vmax', 'vmaxGlobal'],
                             ['sl-gripref', 'gripAccel'],
                             ['sl-engine', 'engineAccel']]) {
    $(idSl).addEventListener('input', e => {
      if (_physConsts) _physConsts[cle] = parseFloat(e.target.value);
      _syncSliders();
    });
  }

  // _syncSliders() recalcule tous les libellés, donc la valeur effective
  $('sl-speed').addEventListener('input', e => {
    _speedStat = parseFloat(e.target.value);
    _syncSliders();
  });
  $('sl-grip-cal').addEventListener('input', e => {
    _gripStat = parseFloat(e.target.value);
    _syncSliders();
  });
  $('sl-accel').addEventListener('input', e => {
    _accelStat = parseFloat(e.target.value);
    _syncSliders();
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
    _syncSliders();
  });

  // Raccourcis clavier RACE-H03
  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.key === 'r' || e.key === 'R') _regenererMap();
    if (e.key === 'v' || e.key === 'V') _vehiculeSuivant();
    if (e.key === 'd' || e.key === 'D') _activerOnglet('mesures');
    if (e.key === 'a' || e.key === 'A') {
      _autoLoop = !_autoLoop;
      $('btn-auto-boucle').textContent = _autoLoop ? 'Auto ✓ [A]' : 'Auto [A]';
    }
    if (e.key === 'c' || e.key === 'C') _activerOnglet('physique');
    if (e.key === 'e' || e.key === 'E') {
      _effetsActifs = !_effetsActifs;
      _majEtatEffets();
    }
    if (e.key === 'g' || e.key === 'G') {
      _aideActive = !_aideActive;
      _majEtatAide();
    }
    if (e.key === 'f' || e.key === 'F') _toggleCloture();
    if (e.key === 't' || e.key === 'T') trail.clear();
    if (e.key === 'p' || e.key === 'P') _activerOnglet('virage');
    if (e.key === 'o' || e.key === 'O') _activerOnglet('pouvoirs');
    if (e.key === 'Tab') { e.preventDefault(); _basculerAtelier(); }
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
  _dtFrame = dt;

  if (_carState && _vehicleData && _vehicleGroup) {
    const inputs = controls.getInputs();

    mapLoader.update(_carState.position.x, _cam, _carState.position.z);

    const activeBlocks = mapLoader.getActiveBlocks();

    if (_physConsts) {
      // Mode boucle automatique : steer aléatoire, accélération permanente
      if (_autoLoop) {
        _autoTimer -= dt;
        if (_autoTimer <= 0) {
          _autoSteer = (Math.random() - 0.5) * 2;
          _autoTimer = 0.5 + Math.random();
        }
      }
      const steerBrut = _autoLoop ? _autoSteer : inputs.steering;

      // Toute la conduite passe par le module partagé avec le serveur ; la page
      // ne fait plus que mettre en scène les événements qu'il raconte.
      const ev = tickVehicle(_sim, {
        steering:  steerBrut,
        braking:   !_autoLoop && inputs.braking,
        reversing: !_autoLoop && inputs.reversing,
      }, {
        blocks:        activeBlocks,
        blockScale:    _map.blockScale,
        bounds:        _fenceBounds,
        nav:           _navJoueur,
        consts:        _physConsts,
        plateauHeight: PLATEAU_HEIGHT,
        vehicleScale:  _echelle(),
        cubes:         _movableMeshes.values(),
        poles:         _poleMeshes,
      }, dt, {
        // Les curseurs de calibration remplacent les stats du véhicule
        stats:  { speed: _speedStat, grip: _gripStat, accel: _accelStat },
        fx:     _effetsParCible[CAR_ID],
        assist: _aideActive,
      });
      _mettreEnSceneEvenements(ev);

      // Forme du virage : échantillonnée à chaque frame, choc compris, pour que la
      // trajectoire mesurée soit continue. On passe l'entrée brute : le virage
      // commence quand le joueur appuie, rampe de volant incluse.
      sampleTurn(_analyseur, {
        dt,
        x:  _carState.position.x, z:  _carState.position.z,
        vx: _carState.velocity.x, vz: _carState.velocity.z,
        steer: steerBrut,
        vmax:  _vmaxNominale(),
      });
    }

    // V4 : la hauteur vient entièrement de la physique verticale (relief + vol)
    _vehicleGroup.position.set(
      _carState.position.x,
      _hauteurCaisse() + _carState.y,
      _carState.position.z,
    );
    _vehicleGroup.rotation.y = -_carState.angle;
    // SOLO-02 : axe 'x' car rotation.y = -angle ici (véhicule face +X, pas +Z)
    applyRoll(_vehicleGroup, _dernierVlat, dt, 'x', _physConsts);

    // Tangage de caisse : cabre à l'accélération, plonge au freinage. En l'air
    // la caisse revient à plat, le tangage de vol est porté par le groupe.
    const accelBrute = dt > 0 ? (_dernierVfwd - _vfwdPrecedent) / dt : 0;
    _vfwdPrecedent = _dernierVfwd;
    _accelLissee  += (accelBrute - _accelLissee) * (_physConsts?.pitchSmoothing ?? 0.15);
    applyPitch(_vehicleGroup, (_effetsActifs && !_carState.airborne) ? _accelLissee : 0, dt, 'x', _physConsts);
    applySquash(_vehicleGroup, dt, _physConsts);

    // Game feel : le capot se lève au décollage et pique en chute. Sans ça, une
    // voiture qui reste plate en l'air se lit comme un sol qui monte.
    const pitchCible = _carState.airborne
      ? Math.max(-0.5, Math.min(0.5, _carState.vy * (_physConsts?.PITCH_FACTOR ?? 0.12)))
      : 0;
    _vehicleGroup.rotation.z += (pitchCible - _vehicleGroup.rotation.z) * 0.25;

    trail.push(
      { x: _carState.position.x, y: _hauteurCaisse() + _carState.y, z: _carState.position.z },
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
        COULEUR_HEX[_vehicleData?.palette?.[0]] ?? '#c8b89a',
        1 + Math.floor(Math.random() * 2),
      );
    }
    particles.update(dt);

    // Les bots roulent avec la même physique et subissent les mêmes effets
    if (_nbBots > 0) {
      bot.update(_carState.position, mapLoader.getActiveBlocks(), _map.blockScale, dt, _effetsParCible);
    }

    const vehicleView = [
      {
        id:       CAR_ID,
        position: _carState.position,
        y:        _carState.y,          // les visuels de pouvoir suivent les sauts
        angle:    _carState.angle,
        speed:    _carState.speed,
        stats:    { ..._vehicleData.stats },
        power:    _playerPowerState,
      },
      ...bot.getStates().map(b => ({
        id:    b.id,   position: b.position, y: 0,
        angle: b.angle, speed:   b.speed,    power: b.power,
      })),
    ];
    _majLecturesV4();
    // powers.update() possède les traînées, rend les visuels et retourne les
    // effets détectés : une seule passe pour tout le monde.
    _effetsParCible = powerFx.foldEffects(powers.update(vehicleView, dt));
    if (_pouvoirsVisible) _majRelevePouvoirs();

    // Cohésion : un halo unique autour du groupe, qui enfle et rougit quand on
    // s'éparpille. La jauge seule restait abstraite.
    const rayonCoh = _cfgComplet.cohesion?.radiusUnits ?? 8;
    _etatCohesion  = cohesionState(vehicleView, rayonCoh);
    cohesionView.update(vehicleView, _etatCohesion, dt, rayonCoh);

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
    if (_calibVisible)  _renderCharts();
    if (_virageVisible) renderTurnPanel(getTurnReport(_analyseur));

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
      console.error('[test-v5] erreur init :', err);
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
