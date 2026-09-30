// Rendu 3D du véhicule voxel en Three.js.
//
// Entrée : véhicule JSON complet { grid, wheelPositions, stats, powers }
// Sortie : THREE.Group centré à l'origine, contenant voxels + roues
//
// Performances : géométries et matériaux partagés entre véhicules.
// Appeler disposeSharedResources() uniquement en fin de session.

import * as THREE from '../../lib/three.module.js';

// Correspondance nom de couleur → hex (cohérente avec les cibles HSL de scan.json)
const COLOR_HEX = {
  red:    0xe62020,
  green:  0x1fa830,
  blue:   0x1a52e0,
  orange: 0xf07418,
  violet: 0x7d2dc0,
  pink:   0xe882b9,
};

const WHEEL_HEX = 0x2a2a2a;

// Géométries partagées (immuables)
const _geoVoxel = new THREE.BoxGeometry(1, 1, 1);
const _geoWheel = new THREE.CylinderGeometry(0.52, 0.52, 0.3, 14);
// Axe du cylindre le long de Z (roues saillantes latéralement)
_geoWheel.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));

// Matériaux partagés par couleur (créés à la demande)
const _materials = {};
const _matWheel  = new THREE.MeshLambertMaterial({ color: WHEEL_HEX });

function _getMaterial(colorName) {
  if (!_materials[colorName]) {
    const hex = COLOR_HEX[colorName] ?? 0x888888;
    _materials[colorName] = new THREE.MeshLambertMaterial({ color: hex });
  }
  return _materials[colorName];
}

// Centre du volume voxel (8×4×4) utilisé pour ramener l'origine au milieu
const OFFSET_X = 3.5;
const OFFSET_Y = 1.5;
const OFFSET_Z = 1.5;

// Hauteur du pivot de roulis sous l'origine du véhicule, à peu près à l'essieu
// (les roues sont à -1.8). La caisse bascule autour de cette ligne.
const ROLL_PIVOT = 1.8;

let _onDebugResult = null;

/**
 * Construit le THREE.Group représentant le véhicule.
 * @param {{ grid, wheelPositions }} vehicle — véhicule JSON (sortie de builder + wheel-detector)
 * @returns {THREE.Group}
 */
export function buildVehicleGroup(vehicle) {
  const { grid, wheelPositions } = vehicle;
  const group = new THREE.Group();

  // La caisse est un sous-groupe distinct : elle seule s'incline sur la
  // suspension, les roues restent plaquées au sol. Son origine est descendue à
  // hauteur d'essieu pour que l'inclinaison se lise comme du roulis de caisse et
  // non comme une rotation autour du milieu du véhicule.
  const caisse = new THREE.Group();
  caisse.position.y = -ROLL_PIVOT;
  group.add(caisse);

  let nbVoxels = 0;

  // Voxels — décalés de ROLL_PIVOT pour compenser la descente de la caisse :
  // la position finale dans le monde est inchangée, seul le pivot bouge.
  for (let x = 0; x < 8; x++) {
    for (let z = 0; z < 4; z++) {
      for (let y = 0; y < 4; y++) {
        const v = grid[x]?.[z]?.[y];
        if (!v) continue;
        const mesh = new THREE.Mesh(_geoVoxel, _getMaterial(v.color));
        mesh.position.set(x - OFFSET_X, y - OFFSET_Y + ROLL_PIVOT, z - OFFSET_Z);
        caisse.add(mesh);
        nbVoxels++;
      }
    }
  }

  // Roues — décalées latéralement pour dépasser du bloc véhicule
  for (const w of wheelPositions) {
    const mesh = new THREE.Mesh(_geoWheel, _matWheel);
    const lateralOffset = w.z < OFFSET_Z ? -0.55 : 0.55;
    mesh.position.set(w.x - OFFSET_X, w.y - OFFSET_Y, w.z - OFFSET_Z + lateralOffset);
    group.add(mesh);
  }

  group.userData.caisse = caisse;
  group.userData.susp   = { roll: 0, rollVel: 0, pitch: 0, pitchVel: 0, squash: 0, squashVel: 0 };

  console.log('[voxel/renderer]', nbVoxels, 'voxels +', wheelPositions.length, 'roues');

  if (_onDebugResult) _onDebugResult({ group, nbVoxels });
  return group;
}

/**
 * Retire un groupe véhicule de sa scène parente.
 * Les géométries et matériaux étant partagés, ils ne sont pas détruits ici.
 * @param {THREE.Group} group
 */
export function disposeVehicleGroup(group) {
  if (group.parent) group.parent.remove(group);
  group.clear();
}

// ---- Roulis de caisse sur suspension ----

/**
 * Incline la caisse sur sa suspension. Les roues ne bougent pas.
 *
 * Deux changements par rapport à la version précédente, tirés de l'observation
 * de PAKO :
 *   - seule la caisse bascule (sous-groupe créé par buildVehicleGroup), les
 *     roues restent plaquées au sol ;
 *   - l'inclinaison suit un ressort amorti au lieu d'un lerp vers une cible
 *     binaire. C'est le dépassement du ressort qui donne la sensation de masse,
 *     et une voiture qui tourne fort sans déraper penche déjà — l'ancienne
 *     version ne réagissait qu'une fois le drapeau `drifting` levé.
 *
 * Cette fonction ne touche plus à la rotation du groupe parent : le tangage
 * (décollage, chute) y est géré par la page appelante, et les deux se
 * disputaient la même propriété à chaque frame.
 *
 * L'axe dépend de l'orientation du mesh :
 *  - axis='z' (défaut) : pages où rotation.y = angle - PI/2 (véhicule face +Z)
 *  - axis='x' : pages où rotation.y = -angle (véhicule face +X, test-solo)
 *
 * @param {THREE.Group} group    — groupe véhicule issu de buildVehicleGroup
 * @param {number}      vLateral — vitesse latérale (v_lateral de decompose())
 * @param {number}      dt       — deltaTime en secondes
 * @param {string}      axis     — 'z' (défaut) ou 'x'
 * @param {object}      [consts] — /config/gameplay.json → physics
 */
export function applyRoll(group, vLateral, dt, axis = 'z', consts = null) {
  const caisse = group.userData.caisse;
  const susp   = group.userData.susp;
  const cfg    = consts ?? {};

  const gain = cfg.rollGain      ?? 0.05;
  const maxi = cfg.rollMax       ?? 0.30;
  const k    = cfg.rollStiffness ?? 90;
  const c    = cfg.rollDamping   ?? 9;

  const signe = axis === 'x' ? 1 : -1;
  const cible = Math.max(-maxi, Math.min(maxi, signe * vLateral * gain));

  // Ressort amorti explicite. Le pas est borné : sur une frame longue, intégrer
  // un ressort raide en Euler diverge et la caisse part en vrille.
  const pas = Math.min(dt, 0.033);
  susp.rollVel += (-k * (susp.roll - cible) - c * susp.rollVel) * pas;
  susp.roll    += susp.rollVel * pas;

  if (axis === 'x') caisse.rotation.x = susp.roll;
  else              caisse.rotation.z = susp.roll;
}

// ---- Tangage et écrasement de caisse ----

/**
 * Tangage longitudinal : la caisse se cabre à l'accélération et plonge au
 * freinage (transfert de charge). Même ressort amorti que le roulis — c'est le
 * léger dépassement qui fait sentir la masse. En l'air, retour à plat : le
 * tangage de vol est géré par la page sur le groupe parent.
 *
 * @param {THREE.Group} group      — groupe véhicule issu de buildVehicleGroup
 * @param {number}      accelLong  — accélération longitudinale lissée (u/s², > 0 = accélère)
 * @param {number}      dt
 * @param {string}      axis       — même convention que applyRoll
 * @param {object}      [consts]   — /config/gameplay.json → physics
 */
export function applyPitch(group, accelLong, dt, axis = 'z', consts = null) {
  const caisse = group.userData.caisse;
  const susp   = group.userData.susp;
  const cfg    = consts ?? {};

  const gain = cfg.pitchGain     ?? 0.012;
  const maxi = cfg.pitchMax      ?? 0.12;
  const k    = cfg.rollStiffness ?? 90;
  const c    = cfg.rollDamping   ?? 9;

  const cible = Math.max(-maxi, Math.min(maxi, accelLong * gain));

  const pas = Math.min(dt, 0.033);
  susp.pitchVel += (-k * (susp.pitch - cible) - c * susp.pitchVel) * pas;
  susp.pitch    += susp.pitchVel * pas;

  // L'avant du véhicule est +X local : une rotation positive autour de Z le lève
  if (axis === 'x') caisse.rotation.z = susp.pitch;
  else              caisse.rotation.x = -susp.pitch;
}

/**
 * Coup d'écrasement à la réception d'un saut : donne une vitesse d'écrasement
 * au ressort, que applySquash() fait ensuite osciller et retomber.
 * @param {THREE.Group} group
 * @param {number}      impact — vitesse verticale d'impact (tickVertical().impact)
 * @param {object}      [consts]
 */
export function kickSquash(group, impact, consts = null) {
  const susp = group.userData.susp;
  const cfg  = consts ?? {};
  susp.squashVel += Math.abs(impact) * (cfg.squashGain ?? 0.3);
}

/**
 * Écrasement / étirement de caisse (squash & stretch) sur ressort amorti.
 * Écrasée, la caisse s'aplatit et s'élargit ; au rebond elle s'étire un peu.
 * Le volume reste à peu près constant pour que ça se lise comme de l'élasticité
 * et pas comme un changement de taille.
 * @param {THREE.Group} group
 * @param {number}      dt
 * @param {object}      [consts]
 */
export function applySquash(group, dt, consts = null) {
  const caisse = group.userData.caisse;
  const susp   = group.userData.susp;
  const cfg    = consts ?? {};

  const maxi = cfg.squashMax       ?? 0.35;
  const k    = cfg.squashStiffness ?? 160;
  const c    = cfg.squashDamping   ?? 11;

  const pas = Math.min(dt, 0.033);
  susp.squashVel += (-k * susp.squash - c * susp.squashVel) * pas;
  susp.squash    += susp.squashVel * pas;
  susp.squash     = Math.max(-maxi, Math.min(maxi, susp.squash));

  const sy = 1 - susp.squash;
  const sh = 1 / Math.sqrt(Math.max(0.2, sy));   // compensation de volume
  caisse.scale.set(sh, sy, sh);
}

/**
 * Libère toutes les ressources partagées (fin de session complète).
 */
export function disposeSharedResources() {
  _geoVoxel.dispose();
  _geoWheel.dispose();
  for (const mat of Object.values(_materials)) mat.dispose();
  _matWheel.dispose();
  for (const key of Object.keys(_materials)) delete _materials[key];
}

/**
 * Enregistre un callback appelé après chaque build (pour debug-view).
 * @param {((data: object) => void) | null} cb
 */
export function onDebugResult(cb) {
  _onDebugResult = cb;
}

/**
 * Crée une mini-scène Three.js autonome avec rotation automatique et drag-to-orbit.
 * Glisser la souris (ou le doigt) pour orienter librement, y compris voir le dessous.
 * Utile pour la page de validation et le mode debug.
 * @param {HTMLCanvasElement} canvas
 * @returns {{ setGroup, stop, scene, camera, renderer }}
 */
export function createPreviewScene(canvas) {
  // clientWidth/clientHeight = 0 si le canvas est dans un élément caché (display:none)
  // → fallback sur les dimensions intrinsèques du canvas
  const w = canvas.clientWidth  || canvas.width  || 300;
  const h = canvas.clientHeight || canvas.height || 200;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(w, h);

  const scene = new THREE.Group(); // pas utilisé directement — on passe par threeScene
  const threeScene = new THREE.Scene();
  threeScene.background = new THREE.Color(0x1a1a2e);

  // Coordonnées sphériques de la caméra (rayon fixe, angles variables)
  const CAM_RADIUS = 14;
  let theta = 0.6;   // angle horizontal (autour de Y)
  let phi   = 1.0;   // angle vertical   (0=dessus, π=dessous)

  const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);

  function _updateCamera() {
    camera.position.set(
      CAM_RADIUS * Math.sin(phi) * Math.sin(theta),
      CAM_RADIUS * Math.cos(phi),
      CAM_RADIUS * Math.sin(phi) * Math.cos(theta),
    );
    camera.lookAt(0, 0, 0);
  }
  _updateCamera();

  // Éclairage : ambiante + 2 directionnelles (dessus + dessous pour voir le fond)
  threeScene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const dirTop = new THREE.DirectionalLight(0xffffff, 0.8);
  dirTop.position.set(4, 10, 6);
  threeScene.add(dirTop);
  const dirBot = new THREE.DirectionalLight(0xffffff, 0.3);
  dirBot.position.set(-4, -8, -6);
  threeScene.add(dirBot);

  let _group   = null;
  let _raf     = null;
  let _running = false;

  // Drag-to-orbit
  let _dragging = false;
  let _prevX = 0, _prevY = 0;
  let _autoRotate = true;

  canvas.style.cursor = 'grab';

  canvas.addEventListener('pointerdown', (e) => {
    _dragging    = true;
    _autoRotate  = false;
    _prevX       = e.clientX;
    _prevY       = e.clientY;
    canvas.style.cursor = 'grabbing';
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!_dragging) return;
    const dx = e.clientX - _prevX;
    const dy = e.clientY - _prevY;
    theta -= dx * 0.012;
    phi    = Math.max(0.05, Math.min(Math.PI - 0.05, phi + dy * 0.012));
    _prevX = e.clientX;
    _prevY = e.clientY;
    _updateCamera();
  });

  canvas.addEventListener('pointerup', () => {
    _dragging = false;
    canvas.style.cursor = 'grab';
  });

  function setGroup(group) {
    // Libère l'ancien : l'aperçu est reconstruit à chaque perte de voxels,
    // sans ça chaque choc laisserait ses géométries sur le GPU.
    if (_group) {
      threeScene.remove(_group);
      _group.traverse(o => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
    }
    _group = group;
    threeScene.add(_group);
  }

  function animate() {
    if (!_running) return;
    _raf = requestAnimationFrame(animate);
    if (_autoRotate) {
      theta += 0.008;
      _updateCamera();
    }
    renderer.render(threeScene, camera);
  }

  function stop() {
    _running = false;
    if (_raf) cancelAnimationFrame(_raf);
    renderer.dispose();
  }

  _running = true;
  animate();

  return { setGroup, stop, scene: threeScene, camera, renderer };
}
