// Page de test du jeu solo.
// Vérifie l'intégration map-generator + controls + physics + camera + skid,
// avec une voiture pilotée automatiquement de manière aléatoire (par défaut)
// pour valider que la map est traversable du départ à l'arrivée.

import * as THREE from '../lib/three.module.js';
import * as controls      from '../modules/game/controls.js';
import * as physics       from '../modules/game/physics.js';
import * as camera        from '../modules/game/camera.js';
import * as skid          from '../modules/game/skid.js';
import * as powers        from '../modules/game/powers.js';
import { loadPool, generate, BLOCK_SIZE } from '../modules/game/map-generator.js';

const CELL_TYPES = {
  null:     { color: 0x3a3a4a, height: 0.0 },   // route
  dur:      { color: 0x6b4f2a, height: 0.6 },   // mur dur
  ramp:     { color: 0xffb84d, height: 0.3 },   // rampe
  boost:    { color: 0x00d4ff, height: 0.05 },  // boost
  sticky:   { color: 0x88ff66, height: 0.05 },  // collant
};

// Stats véhicule par défaut (pas de scan en mode test).
const STATS_TEST = { speed: 0, grip: 1.2, accel: 2.5 };

// Pouvoirs de test : un peu de chaque pour vérifier les visuels.
const POWERS_TEST = { aspiration: 2, phares: 2, sillage: 2, shield: 2, attraction: 0, heal: 0 };

const CAR_ID = 'test-solo';
let _scene, _renderer, _cam, _carMesh, _carState, _map, _mapGroup, _powersHandle;
let _pool        = [];
let _aiActive    = true;
let _aiPlan      = { steering: 0, until: 0 };
let _arrivee     = false;
let _last        = performance.now();

const $ = (id) => document.getElementById(id);

async function init() {
  const canvas = $('canvas');

  // Scène
  _scene = new THREE.Scene();
  _scene.background = new THREE.Color(0x1a1a2e);
  _scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(20, 40, 10);
  _scene.add(dir);

  // Renderer
  _renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  _renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  _renderer.setSize(window.innerWidth, window.innerHeight, false);

  // Caméra
  _cam = camera.createCamera(window.innerWidth, window.innerHeight);

  // Modules
  await physics.init();
  controls.init(canvas);
  skid.init(_scene);

  // Voiture (cube stub — pas de voxel-vehicle scanné)
  const carGeo = new THREE.BoxGeometry(1.5, 1.0, 2.0);
  const carMat = new THREE.MeshStandardMaterial({ color: 0xff5e7a });
  _carMesh = new THREE.Mesh(carGeo, carMat);
  _carMesh.position.y = 0.5;
  _scene.add(_carMesh);

  // Pool de blocs
  _pool = await loadPool();
  console.log(`[test-game] ${_pool.length} blocs chargés`);

  // 1ʳᵉ génération
  await regenererMap();

  // UI
  $('regen').addEventListener('click', () => regenererMap());
  $('ai-toggle').addEventListener('change', (e) => {
    _aiActive = e.target.checked;
    $('mode').textContent = _aiActive ? 'auto-aléatoire' : 'manuel (ZQSD/flèches)';
  });

  window.addEventListener('resize', _onResize);

  _last = performance.now();
  requestAnimationFrame(boucle);
}

async function regenererMap() {
  _arrivee = false;
  $('banner').style.display = 'none';

  if (_mapGroup) {
    _scene.remove(_mapGroup);
    _mapGroup.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }

  _map = await generate(_pool, 1);
  $('map-name').textContent = `${_map.length} blocs (${_map.blocks.map((b) => b.name).join(' → ')})`;

  _mapGroup = _construireMeshMap(_map);
  _scene.add(_mapGroup);

  // Reset voiture sur le départ
  _carState = physics.createState({
    x:     _map.startPosition.x,
    z:     _map.startPosition.z,
    angle: _map.startPosition.angle,
  });

  // Pouvoirs
  if (_powersHandle) powers.dispose();
  await powers.init(_scene);
  _powersHandle = powers.createForVehicle(CAR_ID, POWERS_TEST);
}

function _construireMeshMap(map) {
  const group = new THREE.Group();

  // Sol global légèrement étendu autour
  const solGeo = new THREE.PlaneGeometry(map.worldExtent.width + 4, map.worldExtent.depth + 4);
  const solMat = new THREE.MeshStandardMaterial({ color: 0x2a2a3e });
  const sol = new THREE.Mesh(solGeo, solMat);
  sol.rotation.x = -Math.PI / 2;
  sol.position.set(map.worldExtent.width / 2, -0.01, map.worldExtent.depth / 2);
  group.add(sol);

  // Cellules
  for (const bloc of map.blocks) {
    const [bx, bz] = bloc.position;
    for (let gz = 0; gz < BLOCK_SIZE; gz++) {
      for (let gx = 0; gx < BLOCK_SIZE; gx++) {
        const cell = bloc.grid[gz][gx];
        const def  = CELL_TYPES[cell] ?? CELL_TYPES.null;
        if (def.height === 0) continue; // case route plate, déjà couverte par le sol
        const geo = new THREE.BoxGeometry(1, def.height, 1);
        const mat = new THREE.MeshStandardMaterial({ color: def.color });
        const m   = new THREE.Mesh(geo, mat);
        m.position.set(bx + gx + 0.5, def.height / 2, bz + gz + 0.5);
        group.add(m);
      }
    }
  }

  // Marqueur arrivée
  const finishGeo = new THREE.PlaneGeometry(BLOCK_SIZE, 1);
  const finishMat = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.7 });
  const finish = new THREE.Mesh(finishGeo, finishMat);
  finish.rotation.x = -Math.PI / 2;
  finish.position.set(map.worldExtent.width / 2, 0.02, map.finishPosition.z);
  group.add(finish);

  // Marqueur départ
  const startMat = new THREE.MeshBasicMaterial({ color: 0x66ff99, transparent: true, opacity: 0.5 });
  const start = new THREE.Mesh(finishGeo, startMat);
  start.rotation.x = -Math.PI / 2;
  start.position.set(map.worldExtent.width / 2, 0.02, 0.5);
  group.add(start);

  return group;
}

// ---- Pilote auto aléatoire ----
// Plan : tient un cap pendant un délai aléatoire (300-1200ms),
// alterne tout droit / virage léger gauche / virage léger droite.
// Si la voiture sort latéralement de la map, force un virage de retour.
function _aiInputs(now) {
  if (now > _aiPlan.until) {
    const r = Math.random();
    let s = 0;
    if      (r < 0.5) s =  0;
    else if (r < 0.75) s =  1;
    else               s = -1;
    _aiPlan = { steering: s, until: now + 300 + Math.random() * 900 };
  }

  // Correction si on sort de la voie (largeur = BLOCK_SIZE)
  const x = _carState.position.x;
  let s = _aiPlan.steering;
  if (x < 1.5)               s =  1;  // colle au mur gauche → tourne à droite
  else if (x > BLOCK_SIZE - 1.5) s = -1;  // colle au mur droit → tourne à gauche

  return { steering: s, braking: 0 };
}

function boucle(now) {
  const dt = Math.min(0.05, (now - _last) / 1000);
  _last = now;

  if (_carState && _map) {
    const inputs = _aiActive ? _aiInputs(now) : controls.getInputs();
    physics.tick(_carState, STATS_TEST, inputs, dt);

    // Skid : émettre depuis l'arrière du véhicule si dérapage (E03-S11)
    if (_carState.drifting && _carState.speed > 0.5) {
      const arriereX = _carState.position.x - Math.sin(_carState.angle) * 1.0;
      const arriereZ = _carState.position.z - Math.cos(_carState.angle) * 1.0;
      // Page legacy : velocity = angle du véhicule (pas de vrai vecteur velocity ici)
      const fakeVelocity = { x: Math.sin(_carState.angle) * _carState.speed,
                             z: Math.cos(_carState.angle) * _carState.speed };
      const v_lateral = Math.abs(inputs.steering) * _carState.speed * 0.5;
      skid.emit({ x: arriereX, z: arriereZ }, fakeVelocity, v_lateral);
    }
    skid.update();

    _carMesh.position.set(_carState.position.x, 0.5, _carState.position.z);
    _carMesh.rotation.y = _carState.angle;

    // Pouvoirs : update visuel + détection
    const vehicleView = [{
      id: CAR_ID,
      position: _carState.position,
      angle: _carState.angle,
      speed: _carState.speed,
      stats: { ...STATS_TEST },
    }];
    powers.update(vehicleView, dt);

    camera.update([_carState.position]);

    // HUD
    $('speed').textContent = _carState.speed.toFixed(1);
    $('pos').textContent   = `${_carState.position.x.toFixed(1)}, ${_carState.position.z.toFixed(1)}`;

    // Détection arrivée
    if (!_arrivee && _carState.position.z >= _map.finishPosition.z - 0.5) {
      _arrivee = true;
      $('banner').style.display = 'block';
      // Régénère automatiquement après 2.5s pour boucler le test
      setTimeout(() => { regenererMap(); }, 2500);
    }
  }

  _renderer.render(_scene, _cam);
  requestAnimationFrame(boucle);
}

function _onResize() {
  _renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.resize(window.innerWidth, window.innerHeight);
}

init().catch((err) => {
  console.error('[test-game] init failed', err);
  document.body.insertAdjacentHTML('beforeend',
    `<div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;padding:20px;border-radius:8px;color:#a00;max-width:600px;">
      <b>Erreur d'initialisation</b><br>${err.message}<br><br>
      <small>Le serveur est-il démarré ? <code>node server.js</code></small>
    </div>`);
});
