// Page de test du jeu solo.
// Vérifie l'intégration map-generator + controls + physics + camera + skid,
// avec une voiture pilotée automatiquement de manière aléatoire (par défaut)
// pour valider que la map est traversable du départ à l'arrivée.
//
// Conduite : modèle vectoriel V5 (game feel calibré), même enchaînement que
// server/game-loop.js — decompose → detectDrift → computeForces → rampSteering
// → computeTurnRate. La page tournait sur l'ancien physics.tick() scalaire, qui
// n'existe plus : convention d'angle différente (forward = sin/cos) et dérapage
// qui ne se déclenchait jamais.

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

// Stats véhicule par défaut (pas de scan en mode test) — valeurs brutes façon
// voxel/stats.js, normalisées ensuite pour le pipeline de forces.
const STATS_TEST = { speed: 12.0, grip: 2.0, accel: 5.0 };

// Pouvoirs de test : un peu de chaque pour vérifier les visuels.
const POWERS_TEST = { aspiration: 2, phares: 2, sillage: 2, shield: 2, attraction: 0, heal: 0 };

const CAR_ID = 'test-solo';
let _scene, _renderer, _cam, _carMesh, _carState, _map, _mapGroup, _powersHandle;
let _poolData    = null;
let _physConsts  = null;
let _statsNorm   = null;
let _winRadius   = 4.0;
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

  const cfg   = await fetch('/config/gameplay.json').then(r => r.json());
  _physConsts = cfg.physics;
  _winRadius  = cfg.solo?.WIN_RADIUS ?? 4.0;
  const vs    = cfg.vehicleStats;
  _statsNorm  = {
    speed_stat: STATS_TEST.speed / vs.baseSpeed,
    grip_stat:  STATS_TEST.grip  / vs.baseGrip,
    accel_stat: STATS_TEST.accel / vs.baseAccel,
  };

  // Voiture (cube stub — pas de voxel-vehicle scanné). Long axe sur X : à angle 0
  // le véhicule pointe vers +X.
  const carGeo = new THREE.BoxGeometry(2.0, 1.0, 1.5);
  const carMat = new THREE.MeshStandardMaterial({ color: 0xff5e7a });
  _carMesh = new THREE.Mesh(carGeo, carMat);
  _carMesh.position.y = 0.5;
  _scene.add(_carMesh);

  // Pool de blocs
  _poolData = await loadPool();
  console.log(`[test-game] ${_poolData.pool.length} blocs chargés`);

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

  _map = await generate(_poolData);
  $('map-name').textContent = `${_map.blocks.length} blocs (${_map.gridCols}×${_map.gridRows})`;

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
// Près du bord de la map, on reprend la main et on braque vers l'arrivée.
function _aiInputs(now) {
  if (now > _aiPlan.until) {
    const r = Math.random();
    const s = r < 0.5 ? 0 : r < 0.75 ? 1 : -1;
    _aiPlan = { steering: s, until: now + 300 + Math.random() * 900 };
  }

  const { x, z }          = _carState.position;
  const { width, depth }  = _map.worldExtent;
  const auBord = x < 1.5 || z < 1.5 || x > width - 1.5 || z > depth - 1.5;

  return {
    steering: auBord ? _capVers(_map.finishPosition) : _aiPlan.steering,
    throttle: 1,
  };
}

// Braquage (-1 / 0 / 1) qui ramène le nez vers une cible.
function _capVers(cible) {
  const vise = Math.atan2(cible.z - _carState.position.z, cible.x - _carState.position.x);
  let ecart  = vise - _carState.angle;
  while (ecart >  Math.PI) ecart -= 2 * Math.PI;
  while (ecart < -Math.PI) ecart += 2 * Math.PI;
  return Math.abs(ecart) < 0.15 ? 0 : Math.sign(ecart);
}

function _inputsManuels() {
  const i = controls.getInputs();
  return {
    steering: i.steering,
    throttle: i.reversing ? -1 : i.braking ? -0.8 : 1,
  };
}

// Une frame de conduite — même enchaînement que server/game-loop.js.
function _tickConduite(inputs, dt) {
  const dec       = physics.decompose(_carState.velocity, _carState.angle);
  const driftInfo = physics.detectDrift(dec, _physConsts, _statsNorm, 1.0, _carState.drifting);
  _carState.drifting = driftInfo.is_drifting;

  const newV = physics.computeForces(
    _carState, { throttle: inputs.throttle }, _statsNorm, dt, _physConsts, driftInfo.lateralGrip
  );
  _carState.velocity.x = newV.x;
  _carState.velocity.z = newV.z;

  const steeringEff = physics.rampSteering(_carState, inputs.steering, dt, _physConsts);
  _carState.angle  += physics.computeTurnRate(steeringEff, dec, driftInfo, _physConsts) * dt;

  _carState.position.x += _carState.velocity.x * dt;
  _carState.position.z += _carState.velocity.z * dt;
  _carState.speed       = driftInfo.v_speed;

  physics.tickDriftCharge(_carState, dt, _physConsts);
}

function boucle(now) {
  const dt = Math.min(0.05, (now - _last) / 1000);
  _last = now;

  if (_carState && _map) {
    const inputs = _aiActive ? _aiInputs(now) : _inputsManuels();
    _tickConduite(inputs, dt);

    // Skid : émettre depuis l'arrière du véhicule si dérapage (E03-S11)
    if (_carState.drifting && _carState.speed > 0.5) {
      const dec = physics.decompose(_carState.velocity, _carState.angle);
      const spd = Math.max(0.01, _carState.speed);
      const nx  = _carState.velocity.x / spd;
      const nz  = _carState.velocity.z / spd;
      skid.emit(
        { x: _carState.position.x - nx * 0.6, z: _carState.position.z - nz * 0.6 },
        _carState.velocity,
        Math.abs(dec.v_lateral),
      );
    }
    skid.update();

    _carMesh.position.set(_carState.position.x, 0.5, _carState.position.z);
    _carMesh.rotation.y = -_carState.angle;

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
    const dxFin = _carState.position.x - _map.finishPosition.x;
    const dzFin = _carState.position.z - _map.finishPosition.z;
    if (!_arrivee && Math.hypot(dxFin, dzFin) <= _winRadius) {
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
