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

let _onDebugResult = null;

/**
 * Construit le THREE.Group représentant le véhicule.
 * @param {{ grid, wheelPositions }} vehicle — véhicule JSON (sortie de builder + wheel-detector)
 * @returns {THREE.Group}
 */
export function buildVehicleGroup(vehicle) {
  const { grid, wheelPositions } = vehicle;
  const group = new THREE.Group();
  let nbVoxels = 0;

  // Voxels
  for (let x = 0; x < 8; x++) {
    for (let z = 0; z < 4; z++) {
      for (let y = 0; y < 4; y++) {
        const v = grid[x]?.[z]?.[y];
        if (!v) continue;
        const mesh = new THREE.Mesh(_geoVoxel, _getMaterial(v.color));
        mesh.position.set(x - OFFSET_X, y - OFFSET_Y, z - OFFSET_Z);
        group.add(mesh);
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

// ---- Roll visuel en dérapage (E03-S13) ----

/**
 * Applique une inclinaison Z au mesh du véhicule pour renforcer la sensation de drift.
 * À appeler chaque frame après avoir mis à jour rotation.y.
 *
 *   rollAngle = drifting ? -steerInput × 0.3 : 0
 *   group.rotation.z = lerp(group.rotation.z, rollAngle, 0.1)
 *
 * L'interpolation lerp assure un retour progressif à 0 en sortie de drift (T-S13-2).
 *
 * @param {THREE.Group} group       — groupe voxel du véhicule
 * @param {boolean}     drifting    — état de dérapage courant
 * @param {number}      steerInput  — entrée de virage ∈ [-1, 1]
 */
export function applyRoll(group, drifting, steerInput) {
  const rollAngle = drifting ? -steerInput * 0.3 : 0;
  group.rotation.z = THREE.MathUtils.lerp(group.rotation.z, rollAngle, 0.1);
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
    if (_group) threeScene.remove(_group);
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
