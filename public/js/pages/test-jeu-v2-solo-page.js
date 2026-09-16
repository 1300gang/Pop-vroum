// Page de test jeu V2 solo.
// Génère un véhicule voxel aléatoire et permet de tester les mécaniques
// multijoueur avec des bots (faux joueurs à IA simple).

import * as THREE from '../lib/three.module.js';
import { buildVehicleGroup, createPreviewScene, applyRoll } from '../modules/voxel/renderer.js';
import { generateRandomVehicle, COULEUR_HEX, COULEUR_FR } from '../modules/voxel/random-vehicle.js';
import * as controls    from '../modules/game/controls.js';
import * as physics     from '../modules/game/physics.js';
import * as camera      from '../modules/game/camera.js';
import * as skid        from '../modules/game/skid.js';
import * as powers      from '../modules/game/powers.js';
import * as particles   from '../modules/game/particles.js';
import * as mapLoader   from '../modules/game/map-loader.js';
import * as bot         from '../modules/game/bot.js';
import { checkTerrain } from '../modules/game/collision.js';
import { loadPool, generate, BLOCK_SIZE, getSurfaceGrip } from '../modules/game/map-generator.js';

// ---- Constantes ----

const VEHICLE_SCALE = 0.28;

const ADJECTIFS = [
  'Grand', 'Petit', 'Fou', 'Chaud', 'Solide', 'Brillant',
  'Ultra', 'Turbo', 'Zinzin', 'Costaud', 'Sauvage', 'Mystérieux',
];
const NOMS = [
  'Bolide', 'Engin', 'Monstre', 'Fusée', 'Char', 'Tank',
  'Prototype', 'Truc', 'Zoïde', 'Bidule', 'Machin', 'Bazar',
];

const POUVOIR_INFO = {
  aspiration: { nom: 'Aspiration', couleur: '#ff3333', desc: 'triangle arrière' },
  phares:     { nom: 'Phares',     couleur: '#44ff44', desc: 'cône avant' },
  sillage:    { nom: 'Sillage',    couleur: '#3388ff', desc: 'trace au sol' },
  shield:     { nom: 'Bouclier',   couleur: '#ff8800', desc: 'protection avant' },
};

const CAR_ID          = 'joueur-v2';
const COHESION_RADIUS = 8; // doit correspondre à gameplay.json cohesion.radiusUnits

const TYPES_CELLULE = {
  null:   { couleur: 0x3a3a4a, hauteur: 0.0 },
  dur:    { couleur: 0x4a5060, hauteur: 0.6 },
  ramp:   { couleur: 0xffb84d, hauteur: 0.6 },
  boost:  { couleur: 0x00d4ff, hauteur: 0.05 },
  sticky: { couleur: 0x88ff66, hauteur: 0.05 },
};

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
let _nbBots           = 0;
let _botConfigs       = [];
let _vehiclePregenere = null; // véhicule choisi dans l'écran de démarrage

let _terrainState = { lastTerrain: null, onRamp: false, boostTimer: 0, rampTimer: 0 };

// ---- Physique V2 (E03-S01 → S04) ----
let _physConsts      = null;  // gameplay.json → physics
let _vehicleStatsCfg = null;  // gameplay.json → vehicleStats (base pour normalisation)
let _gripStat        = 0.5;   // valeur du slider (override grip_stat du véhicule)
let _arrowVelocity   = null;  // ArrowHelper bleu — direction velocity
let _arrowForward    = null;  // ArrowHelper orange — direction angle (forward)

const $ = id => document.getElementById(id);

// ---- Génération du véhicule aléatoire ----

function _nomAleatoire() {
  const adj = ADJECTIFS[Math.floor(Math.random() * ADJECTIFS.length)];
  const nom = NOMS[Math.floor(Math.random() * NOMS.length)];
  return `${adj} ${nom}`;
}

// Délègue au module random-vehicle.js
async function _creerVehicule() {
  return generateRandomVehicle(_nomAleatoire());
}

// ---- Mise à jour HUD bots ----

function _mettreAJourHUDBots() {
  const etats = bot.getStates();
  const botsHud = $('bots-hud');
  if (!botsHud) return;

  if (etats.length === 0) {
    botsHud.innerHTML = '';
    return;
  }

  botsHud.innerHTML = etats
    .map(b => `<span class="bot-dot" style="background:${b.couleur}" title="${b.nom}"></span>`)
    .join('');
}

// ---- Mise à jour HUD cohésion ----

function _mettreAJourCohesion(joueurPos) {
  const hudCohesion = $('hud-cohesion');
  if (!hudCohesion || _nbBots === 0) return;

  const total    = _nbBots;
  const enGroupe = bot.countEnCohesion(joueurPos);
  const pct      = total > 0 ? Math.round((enGroupe / total) * 100) : 0;

  $('cohesion-bar').style.width = pct + '%';
  $('cohesion-val').textContent = pct + ' %';
}

// ---- Mise à jour HUD ----

function _mettreAJourHUD() {
  if (!_vehicleData) return;
  const { nom, stats, powers: pw, parCouleur } = _vehicleData;

  $('nom-vehicule').textContent = nom;
  $('stat-speed').textContent   = stats.speed.toFixed(1);
  $('stat-grip').textContent    = stats.grip.toFixed(1);
  $('stat-accel').textContent   = stats.accel.toFixed(1);

  // parCouleur est fourni par random-vehicle.js ; fallback si absent
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
}

// ---- Construction des meshes de map (callback pour map-loader) ----

// Prisme triangulaire montant en +X (de x=0 bas à x=cs haut).
function _creerGeomRampX(h, cs) {
  const geo = new THREE.BufferGeometry();
  const v = new Float32Array([
    // Fond bas (y=0)
    0, 0, 0,    cs, 0, cs,   cs, 0, 0,
    0, 0, 0,    0,  0, cs,   cs, 0, cs,
    // Face haute (x=cs, verticale)
    cs, 0, 0,   cs, 0, cs,   cs, h, cs,
    cs, 0, 0,   cs, h, cs,   cs, h, 0,
    // Surface inclinée (de x=0,y=0 à x=cs,y=h)
    0, 0, 0,    cs, h, 0,    cs, h, cs,
    0, 0, 0,    cs, h, cs,   0,  0, cs,
    // Côté gauche (z=0, triangle)
    0, 0, 0,    cs, 0, 0,    cs, h, 0,
    // Côté droit (z=cs, triangle)
    0, 0, cs,   cs, h, cs,   cs, 0, cs,
  ]);
  geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Construit un THREE.Group pour une liste de blocs (une colonne).
 * Appelé par map-loader pour chaque colonne chargée.
 * @param {Array<object>} blocks — blocs avec grilles déjà rotées
 * @param {number} blockScale — taille monde d'une cellule
 * @returns {THREE.Group}
 */
function _construireMeshColonne(blocks, blockScale) {
  const group = new THREE.Group();
  const cs = blockScale;

  for (const bloc of blocks) {
    const [bx, bz] = bloc.position;
    for (let gz = 0; gz < BLOCK_SIZE; gz++) {
      for (let gx = 0; gx < BLOCK_SIZE; gx++) {
        const cell = bloc.grid[gz]?.[gx];
        const def  = TYPES_CELLULE[cell] ?? TYPES_CELLULE.null;
        if (def.hauteur === 0) continue;

        const mat = new THREE.MeshStandardMaterial({ color: def.couleur });
        let m;
        if (cell === 'ramp') {
          const geo = _creerGeomRampX(def.hauteur, cs);
          m = new THREE.Mesh(geo, mat);
          m.position.set(bx + gx * cs, 0, bz + gz * cs);
        } else {
          const geo = new THREE.BoxGeometry(cs, def.hauteur, cs);
          m = new THREE.Mesh(geo, mat);
          m.position.set(bx + gx * cs + cs / 2, def.hauteur / 2, bz + gz * cs + cs / 2);
        }
        group.add(m);
      }
    }
  }

  return group;
}

// ---- Sol de fond et lignes de départ/arrivée ----

function _construireSol(map) {
  const group = new THREE.Group();
  const { width, depth } = map.worldExtent;

  // Sol
  const solGeo = new THREE.PlaneGeometry(width + 8, depth + 8);
  const solMat = new THREE.MeshStandardMaterial({ color: 0x2a2a3e });
  const sol = new THREE.Mesh(solGeo, solMat);
  sol.rotation.x = -Math.PI / 2;
  sol.position.set(width / 2, -0.15, depth / 2);
  group.add(sol);

  // Ligne de départ (verte, bande verticale à x ≈ blocmapSize)
  const blocmapSize = BLOCK_SIZE * map.blockScale;
  const ligneGeo = new THREE.PlaneGeometry(1, depth);
  const departMat = new THREE.MeshBasicMaterial({ color: 0x66ff99, transparent: true, opacity: 0.5 });
  const depart = new THREE.Mesh(ligneGeo, departMat);
  depart.rotation.x = -Math.PI / 2;
  depart.position.set(blocmapSize, 0.02, depth / 2);
  group.add(depart);

  // Ligne d'arrivée (dorée)
  const arriveeMat = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.7 });
  const arrivee = new THREE.Mesh(ligneGeo.clone(), arriveeMat);
  arrivee.rotation.x = -Math.PI / 2;
  arrivee.position.set(map.finishPosition.x - blocmapSize / 2, 0.02, depth / 2);
  group.add(arrivee);

  return group;
}

// ---- Régénération de la map ----

async function _regenererMap() {
  $('banner').style.display = 'none';
  _arrivee = false;

  // Libérer l'ancienne map et les bots
  mapLoader.dispose();
  bot.dispose();

  if (_solGroup) {
    _scene.remove(_solGroup);
    _solGroup.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    _solGroup = null;
  }

  _map = await generate(_poolData);
  const blocmapSize = BLOCK_SIZE * _map.blockScale;
  $('map-info').textContent = `Map : ${_map.gridCols}×${_map.gridRows} (${blocmapSize}u/bloc)`;

  // Sol + lignes
  _solGroup = _construireSol(_map);
  _scene.add(_solGroup);

  // Charger les colonnes dynamiquement
  mapLoader.init(_scene, _map, _construireMeshColonne);
  mapLoader.update(_map.startPosition.x);

  _resetVoiture();

  // Informer le module powers de la position d'arrivée (pour les flèches)
  powers.setFinishPosition(_map.finishPosition.x, _map.finishPosition.z);

  // (Re)créer les bots
  if (_botConfigs.length > 0) {
    bot.init(_scene, _botConfigs, _map.startPosition, _map.finishPosition.x, COHESION_RADIUS);
    _mettreAJourHUDBots();
  }
}

// ---- Reset position voiture ----

function _resetVoiture() {
  if (!_map) return;
  _carState = physics.createState({
    x:     _map.startPosition.x,
    z:     _map.startPosition.z,
    angle: 0,  // V2 : angle 0 = face au +X (convention cos/sin de computeForces)
  });
  _arrivee      = false;
  _terrainState = { lastTerrain: null, onRamp: false, boostTimer: 0, rampTimer: 0 };
  $('banner').style.display = 'none';
}

// ---- Régénération du véhicule ----

async function _regenererVehicule() {
  $('btn-vehicule').disabled = true;

  _vehicleData = await _creerVehicule();

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

  $('btn-vehicule').disabled = false;
}

// ---- Initialisation ----

function _progression(pct, msg) {
  $('loading-bar').style.width = pct + '%';
  if (msg) $('loading-msg').textContent = msg;
}

// Lance l'initialisation après confirmation de l'écran de démarrage
async function init(nbBots) {
  _nbBots = nbBots;

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

  _cam = camera.createCamera(window.innerWidth, window.innerHeight);

  _preview = createPreviewScene($('preview'));

  await physics.init();

  // Charger les constantes physique V2 depuis gameplay.json
  const cfgPhys        = await fetch('/config/gameplay.json').then(r => r.json());
  _physConsts          = cfgPhys.physics;
  _vehicleStatsCfg     = cfgPhys.vehicleStats;

  // Flèches debug 3D : bleue = velocity, orange = forward (angle)
  _arrowVelocity = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 3, 0x4488ff, 0.5, 0.3
  );
  _arrowForward = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 2.5, 0xff8800, 0.4, 0.25
  );
  _scene.add(_arrowVelocity);
  _scene.add(_arrowForward);

  // Slider grip
  document.getElementById('slider-grip')?.addEventListener('input', e => {
    _gripStat = parseFloat(e.target.value);
    const el = document.getElementById('grip-val');
    if (el) el.textContent = _gripStat.toFixed(2);
  });

  controls.init(canvas);
  skid.init(_scene);
  particles.init(_scene);

  _progression(25, 'Chargement des blocs map…');
  _poolData = await loadPool();

  // Charger les configs bots si demandé
  if (_nbBots > 0) {
    _progression(40, `Chargement des ${_nbBots} bot(s)…`);
    _botConfigs = await bot.loadConfigs(_nbBots);
    // Afficher la jauge de cohésion
    const hudCoh = $('hud-cohesion');
    if (hudCoh) hudCoh.style.display = 'flex';
  }

  _progression(55, 'Génération du véhicule…');
  // Utilise le véhicule pré-généré depuis l'écran de démarrage si disponible
  _vehicleData = _vehiclePregenere ?? await _creerVehicule();
  _vehiclePregenere = null;

  _vehicleGroup = buildVehicleGroup(_vehicleData);
  _vehicleGroup.scale.set(VEHICLE_SCALE, VEHICLE_SCALE, VEHICLE_SCALE);
  _scene.add(_vehicleGroup);

  await powers.init(_scene);
  _powersHandle = powers.createForVehicle(CAR_ID, _vehicleData.powers);

  _preview.setGroup(buildVehicleGroup(_vehicleData));
  _mettreAJourHUD();

  // Ajouter la ligne bots dans le HUD gauche si besoin
  if (_nbBots > 0) {
    const sep = document.createElement('hr');
    sep.className = 'sep';
    const ligne = document.createElement('div');
    ligne.innerHTML = '<div style="opacity:0.6;font-size:11px;margin-bottom:3px">Bots</div><div id="bots-hud"></div>';
    const pouvoirs = $('pouvoirs');
    pouvoirs.parentNode.insertBefore(sep, pouvoirs.nextSibling);
    pouvoirs.parentNode.insertBefore(ligne, pouvoirs.nextSibling.nextSibling);
  }

  _progression(75, 'Génération de la map…');
  await _regenererMap();

  _progression(100, '');
  $('loading').style.display = 'none';

  $('btn-vehicule').addEventListener('click', _regenererVehicule);
  $('btn-map').addEventListener('click', _regenererMap);

  window.addEventListener('resize', () => {
    _renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.resize(window.innerWidth, window.innerHeight);
  });

  _last = performance.now();
  requestAnimationFrame(_boucle);
}

// ---- Écran de démarrage ----

// Affiche les stats du véhicule prévisualisé dans l'écran de démarrage
function _afficherAperçuVehicule(data) {
  $('demarrage-nom-vehicule').textContent = data.nom;

  // Pills de couleur
  const comptage = data.parCouleur ?? {};
  $('demarrage-couleurs').innerHTML = Object.entries(comptage)
    .sort((a, b) => b[1] - a[1])
    .map(([color, n]) =>
      `<span class="pill" style="background:${COULEUR_HEX[color]}">${COULEUR_FR[color]} ${n}</span>`
    ).join('');

  // Barres de stats (max théorique ~12)
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

async function _genererEtAfficher() {
  $('btn-reroll').disabled = true;
  $('btn-lancer').disabled = true;
  $('demarrage-nom-vehicule').textContent = 'Génération…';
  $('demarrage-couleurs').innerHTML = '';
  $('demarrage-stats').innerHTML    = '';

  try {
    _vehiclePregenere = await generateRandomVehicle(_nomAleatoire());
    _afficherAperçuVehicule(_vehiclePregenere);
  } finally {
    $('btn-reroll').disabled = false;
    $('btn-lancer').disabled = false;
  }
}

function _demarrerEcranDemarrage() {
  const slider    = $('slider-bots');
  const valLabel  = $('bots-val');
  const btnLancer = $('btn-lancer');
  const btnReroll = $('btn-reroll');

  // Slider bots
  slider.addEventListener('input', () => {
    valLabel.textContent = slider.value;
  });

  // Re-roll véhicule
  btnReroll.addEventListener('click', _genererEtAfficher);

  // Lancer
  btnLancer.addEventListener('click', () => {
    const nb = parseInt(slider.value, 10);
    $('ecran-demarrage').style.display = 'none';
    init(nb).catch(err => {
      console.error('[test-jeu-v2-solo] erreur init :', err);
      $('loading').style.display = 'flex';
      $('loading').innerHTML = `
        <div style="text-align:center;max-width:420px;padding:24px;background:rgba(200,0,0,0.2);border-radius:12px;">
          <div style="font-size:18px;font-weight:700;margin-bottom:10px;">Erreur au démarrage</div>
          <div style="font-size:14px;opacity:0.85;margin-bottom:14px;">${err.message}</div>
          <div style="font-size:12px;opacity:0.6;">Vérifier que le serveur tourne :<br><code>node server.js</code></div>
        </div>`;
    });
  });

  // Générer un premier véhicule dès l'affichage de l'écran
  _genererEtAfficher();
}

// ---- Helpers debug physique V2 ----

function _mettreAJourDebugPhys(dec, driftInfo = null) {
  const { v_forward, v_lateral } = dec;
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

function _mettreAJourFlechesDebug() {
  if (!_arrowVelocity || !_arrowForward || !_carState) return;
  const pos = new THREE.Vector3(_carState.position.x, 0.9, _carState.position.z);
  _arrowVelocity.position.copy(pos);
  _arrowForward.position.copy(pos);

  // Flèche bleue : direction et longueur proportionnelle à |velocity|
  const spd = _carState.speed;
  if (spd > 0.1) {
    _arrowVelocity.setDirection(
      new THREE.Vector3(_carState.velocity.x / spd, 0, _carState.velocity.z / spd)
    );
    _arrowVelocity.setLength(Math.min(6, spd * 0.18), 0.5, 0.3);
  }

  // Flèche orange : direction angle (forward), longueur fixe
  _arrowForward.setDirection(
    new THREE.Vector3(Math.cos(_carState.angle), 0, Math.sin(_carState.angle))
  );
  _arrowForward.setLength(2.5, 0.4, 0.25);
}

// ---- Boucle de jeu ----

function _boucle(now) {
  const dt = Math.min(0.05, (now - _last) / 1000);
  _last = now;

  if (_carState && _vehicleData && _vehicleGroup) {
    const inputs = controls.getInputs();

    // Mise à jour du chargement dynamique des colonnes
    mapLoader.update(_carState.position.x);

    // Terrain + collision (cellSize = blockScale)
    const activeBlocks = mapLoader.getActiveBlocks();
    const terrain = activeBlocks.length > 0
      ? checkTerrain(_carState.position, activeBlocks, _map.blockScale)
      : null;

    if (terrain) {
      const ts = _terrainState;
      if (terrain.softTerrain === 'boost' && ts.lastTerrain !== 'boost') ts.boostTimer = 1.5;
      if (terrain.softTerrain === 'ramp') {
        ts.onRamp = true;
      } else if (ts.onRamp) {
        ts.rampTimer = 1.0;
        ts.onRamp    = false;
      }
      ts.lastTerrain = terrain.softTerrain;
      ts.boostTimer  = Math.max(0, ts.boostTimer - dt);
      ts.rampTimer   = Math.max(0, ts.rampTimer  - dt);
    }

    // ---- Physique vectorielle V2 (E03-S01 → S08) ----
    if (_physConsts && _vehicleStatsCfg) {
      // Multiplicateur de grip selon surface (E03-S08) — centralisé dans map-generator
      const surfaceGrip = getSurfaceGrip(terrain?.softTerrain ?? null);

      // Multiplicateur vmax selon effets de terrain
      const vmaxMult = _terrainState.boostTimer > 0 ? 1.5
                     : _terrainState.rampTimer  > 0 ? 1.3
                     : terrain?.softTerrain === 'sticky' ? 0.5
                     : 1.0;

      // Stats normalisées : véhicule / base config, grip = stat intrinsèque du véhicule
      // (la surface est passée séparément à detectDrift pour rester découplée)
      const statsNorm = {
        speed_stat:  (_vehicleData.stats.speed / _vehicleStatsCfg.baseSpeed) * vmaxMult,
        grip_stat:   _gripStat,
        accel_stat:  _vehicleData.stats.accel / _vehicleStatsCfg.baseAccel,
      };

      // Throttle ∈ [-1, 1] : marche arrière -1, freinage -0.8, avance 1
      const throttle = inputs.reversing ? -1 : inputs.braking ? -0.8 : 1;

      if (terrain?.hardCollision) {
        // Rebond élastique sur mur (E03-S09)
        if (terrain.pushBack) {
          const bounced = physics.applyBounce(
            _carState.velocity, terrain.pushBack, _physConsts.restitution
          );
          _carState.velocity.x = bounced.x;
          _carState.velocity.z = bounced.z;
          _carState.speed      = Math.sqrt(bounced.x ** 2 + bounced.z ** 2);
          // Correction de position pour sortir du mur
          _carState.position.x += terrain.pushBack.x;
          _carState.position.z += terrain.pushBack.z;
          // Étincelles si on drifait au moment du choc (E03-S12 T-S12-3)
          if (_carState.drifting) {
            const pbLen = Math.sqrt(terrain.pushBack.x ** 2 + terrain.pushBack.z ** 2);
            if (pbLen > 0.001) {
              const wallNormal = { x: terrain.pushBack.x / pbLen, z: terrain.pushBack.z / pbLen };
              particles.emitSparks(
                { x: _carState.position.x, y: 0.3, z: _carState.position.z },
                wallNormal, 6
              );
            }
          }
        } else {
          _carState.velocity.x = 0;
          _carState.velocity.z = 0;
          _carState.speed      = 0;
        }
        _carState.drifting = false;
      } else {
        // Décomposition velocity (E03-S02) — avant les forces pour le drift
        const dec       = physics.decompose(_carState.velocity, _carState.angle);

        // Détection drift + grip courant (E03-S05 + S08 : surface_grip séparé)
        const driftInfo = physics.detectDrift(dec, _physConsts, statsNorm, surfaceGrip);
        _carState.drifting = driftInfo.is_drifting;

        // Forces → nouvelle velocity (E03-S03) avec grip drift si en dérapage
        const newV = physics.computeForces(
          _carState, { throttle }, statsNorm, dt, _physConsts, driftInfo.current_grip
        );
        _carState.velocity.x = newV.x;
        _carState.velocity.z = newV.z;

        // Rotation décorrélée avec oversteer en drift (E03-S04 + S06)
        const turn_rate = physics.computeTurnRate(inputs.steering, dec, driftInfo.is_drifting, _physConsts);
        _carState.angle += turn_rate * dt;

        // Position via velocity
        _carState.position.x += _carState.velocity.x * dt;
        _carState.position.z += _carState.velocity.z * dt;

        // Vitesse scalaire (pour HUD, particules, etc.)
        _carState.speed = driftInfo.v_speed;

        _mettreAJourDebugPhys(dec, driftInfo);
        _mettreAJourFlechesDebug();
      }
    }

    // Positionnement mesh — convention V2 : rotation.y = -angle (forward = cos/sin)
    _vehicleGroup.position.set(_carState.position.x, 0.4, _carState.position.z);
    _vehicleGroup.rotation.y = -_carState.angle;
    // Legacy : steerInput en proxy (v_lateral ~ -steering en physique V1)
    applyRoll(_vehicleGroup, _carState.drifting, -inputs.steering);

    // Skid orienté sur velocity réelle (E03-S11)
    if (_carState.drifting && _carState.speed > 0.5) {
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
    skid.update();

    // Poussière de drift (E03-S12 T-S12-1 / T-S12-2) — seuil v_speed > 5
    if (_carState.drifting && _carState.speed > 5 && Math.random() < 0.12) {
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

    // Mise à jour des bots
    if (_nbBots > 0) {
      bot.update(_carState.position, activeBlocks, _map.blockScale, dt);
      _mettreAJourHUDBots();
      _mettreAJourCohesion(_carState.position);
    }

    // Pouvoirs — inclure les bots dans la vue véhicule
    const botStates   = bot.getStates();
    const vehicleView = [
      {
        id:       CAR_ID,
        position: _carState.position,
        angle:    _carState.angle,
        speed:    _carState.speed,
        stats:    { ..._vehicleData.stats },
      },
      ...botStates.map(b => ({
        id:       b.id,
        position: b.position,
        angle:    b.angle,
        speed:    b.speed,
        stats:    b.stats,
      })),
    ];
    powers.update(vehicleView, dt);

    // Caméra — moyenne de tous les joueurs actifs
    const toutesPositions = [_carState.position, ...botStates.map(b => b.position)];
    camera.update(toutesPositions);

    // HUD
    $('speed-val').textContent = _carState.speed.toFixed(1);
    $('drift-label').style.display = _carState.drifting ? '' : 'none';

    // Détection arrivée (axe X)
    if (!_arrivee && _map && _carState.position.x >= _map.finishPosition.x - _map.blockScale * 2) {
      _arrivee = true;
      $('banner').style.display = 'block';
      setTimeout(() => _regenererMap(), 2500);
    }
  }

  _renderer.render(_scene, _cam);
  requestAnimationFrame(_boucle);
}

// ---- Démarrage ----

_demarrerEcranDemarrage();
