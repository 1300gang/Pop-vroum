// Traces de pneu (skid marks) — pool de quads recyclés au sol.
//
// Chaque trace est un PlaneGeometry positionné au sol (y≈0) orienté selon
// la direction réelle du vecteur velocity (et non l'angle du véhicule).
// L'intensité (opacité) est proportionnelle à |v_lateral| (E03-S11).
//
// API publique :
//   init(scene)
//   emit(wheelPos, velocity, v_lateral)  — velocity={x,z}, v_lateral=|composante latérale|
//   update()                             — fade-out, appeler chaque frame
//   dispose()

import * as THREE from '../../lib/three.module.js';

const POOL_SIZE    = 200;
const LIFETIME_SEC = 5;
const QUAD_W       = 0.6;   // largeur de la trace (voxels)
const QUAD_H       = 1.0;   // longueur du segment (voxels)

// Seuils de déclenchement (E03-S11)
const SPEED_MIN    = 1.0;   // |velocity| minimale
const VLATERAL_MIN = 0.4;   // |v_lateral| minimal pour émettre une trace

let _scene   = null;
let _texture = null;
let _geo     = null;

// Pool de { mesh, createdAt, active, opacity0 }
const _pool = [];
let _poolHead = 0;

/**
 * Initialise le pool de quads et crée la texture programmatique.
 * @param {THREE.Scene} scene
 */
export function init(scene) {
  _scene   = scene;
  _texture = _creerTexture();
  _geo     = new THREE.PlaneGeometry(QUAD_W, QUAD_H);

  for (let i = 0; i < POOL_SIZE; i++) {
    const mat  = new THREE.MeshBasicMaterial({
      map:         _texture,
      transparent: true,
      opacity:     0,
      depthWrite:  false,
    });
    const mesh = new THREE.Mesh(_geo, mat);
    mesh.rotation.x = -Math.PI / 2; // plat sur le sol
    mesh.visible = false;
    mesh.renderOrder = -1;
    scene.add(mesh);
    _pool.push({ mesh, createdAt: 0, active: false, opacity0: 0 });
  }
}

/**
 * Émet une trace de pneu orientée selon le vecteur velocity réel (E03-S11).
 *
 * @param {{ x: number, z: number }} wheelPos  — position monde de la roue arrière
 * @param {{ x: number, z: number }} velocity  — vecteur vitesse réel du véhicule
 * @param {number}                   v_lateral — |composante latérale| (détermine l'intensité)
 */
export function emit(wheelPos, velocity, v_lateral) {
  const spd = Math.sqrt(velocity.x ** 2 + velocity.z ** 2);
  if (spd < SPEED_MIN || Math.abs(v_lateral) < VLATERAL_MIN) return;

  // Intensité proportionnelle à |v_lateral| (T-S11-3)
  const opacity0 = Math.min(0.75, Math.max(0.2, Math.abs(v_lateral) * 0.07));

  const slot  = _pool[_poolHead % POOL_SIZE];
  _poolHead++;

  slot.createdAt = performance.now() / 1000;
  slot.active    = true;
  slot.opacity0  = opacity0;

  slot.mesh.position.set(wheelPos.x, 0.01, wheelPos.z);
  // Orientation sur velocity réelle, pas sur l'angle du véhicule (T-S11-1)
  slot.mesh.rotation.y = Math.atan2(velocity.x, velocity.z);
  slot.mesh.material.opacity = opacity0;
  slot.mesh.visible = true;
}

/**
 * Met à jour l'opacité de tous les quads actifs (fade-out linéaire).
 * Appeler à chaque frame.
 */
export function update() {
  const now = performance.now() / 1000;
  for (const slot of _pool) {
    if (!slot.active) continue;
    const age = now - slot.createdAt;
    if (age >= LIFETIME_SEC) {
      slot.mesh.visible          = false;
      slot.mesh.material.opacity = 0;
      slot.active                = false;
    } else {
      slot.mesh.material.opacity = slot.opacity0 * (1 - age / LIFETIME_SEC);
    }
  }
}

/**
 * Libère toutes les ressources (fin de partie).
 */
export function dispose() {
  _geo?.dispose();
  _texture?.dispose();
  for (const slot of _pool) {
    if (_scene) _scene.remove(slot.mesh);
    slot.mesh.material.dispose();
  }
  _pool.length = 0;
  _poolHead    = 0;
  _scene       = null;
}

// Génère une texture noire avec alpha gradient (centre opaque → bords transparents)
function _creerTexture() {
  const size = 32;
  const cv   = document.createElement('canvas');
  cv.width   = size;
  cv.height  = size;
  const ctx  = cv.getContext('2d');

  const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  grad.addColorStop(0,   'rgba(0,0,0,0.85)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.4)');
  grad.addColorStop(1,   'rgba(0,0,0,0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  return new THREE.CanvasTexture(cv);
}
