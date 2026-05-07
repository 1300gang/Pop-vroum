// Module game/particles — Story 4.3 / E03-S12
//
// Mini-cubes qui s'envolent lors d'impacts ou de dérapes.
//
// Contrat I/O :
//   init(scene)
//   emit(position, color, count?)          → voxel burst (collision voxel)
//   emitDust(position, velocity, color, count?) → poussière de drift (E03-S12)
//   emitSparks(position, wallNormal, count?)   → étincelles collision mur (E03-S12)
//   update(dt)
//   dispose()
//
// position   : { x, y, z }
// velocity   : { x, z }   — direction du drift (plan XZ)
// wallNormal : { x, z }   — normale sortante du mur (normalisée)
// color      : string CSS ou 0xRRGGBB

import * as THREE from '../../lib/three.module.js';

// Durées de vie par type
const LIFETIME_VOXEL = 3.0;   // burst de voxel : longue durée
const LIFETIME_DUST  = 1.5;   // poussière drift : courte
const LIFETIME_SPARK = 0.8;   // étincelles mur : très courte

const GRAVITY       = -9.8;
const MAX_PARTICLES = 300;

let _scene = null;
// { mesh, vx, vy, vz, age, lifetime }
const _particles = [];

// Géométrie partagée par toutes les particules
const _geo = new THREE.BoxGeometry(0.25, 0.25, 0.25);

/**
 * Initialise le module.
 * @param {THREE.Scene} scene
 */
export function init(scene) {
  _scene = scene;
}

// ---- Émetteurs ----

/**
 * Éclat de voxels — utilisé lors d'une collision ou perte de voxel.
 * @param {{ x, y, z }} position
 * @param {string|number} color
 * @param {number} [count=1]
 */
export function emit(position, color, count = 1) {
  _spawn(position, color, count, LIFETIME_VOXEL, (p) => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * 2.5;
    p.vx = Math.cos(angle) * speed * 0.6;
    p.vz = Math.sin(angle) * speed * 0.6;
    p.vy = 2.5 + Math.random() * 3.0;
  });
}

/**
 * Poussière de pneu en dérapage (E03-S12 T-S12-1 / T-S12-2).
 * Émission conditionnée par le caller (drifting=true && v_speed>5).
 *
 * @param {{ x, y, z }} position    — position roue arrière
 * @param {{ x, z }}    velocity    — vecteur vitesse réel
 * @param {string}      color       — couleur (teinte voiture ou neutre)
 * @param {number}      [count=1]
 */
export function emitDust(position, velocity, color, count = 1) {
  const speed = Math.sqrt(velocity.x ** 2 + velocity.z ** 2);
  if (speed < 0.01) return;
  const nx = velocity.x / speed;
  const nz = velocity.z / speed;

  _spawn(position, color, count, LIFETIME_DUST, (p) => {
    // Direction biaisée dans le sens de la velocity + dispersion latérale
    const s       = 0.6 + Math.random() * 1.2;
    const spread  = 1.8;
    p.vx = nx * s * 0.4 + (Math.random() - 0.5) * spread;
    p.vz = nz * s * 0.4 + (Math.random() - 0.5) * spread;
    p.vy = 0.4 + Math.random() * 1.2;
    // Taille réduite pour la poussière (scale aléatoire)
    const sc = 0.4 + Math.random() * 0.6;
    p.mesh.scale.setScalar(sc);
  });
}

/**
 * Étincelles lors d'une collision mur en drift (E03-S12 T-S12-3).
 *
 * @param {{ x, y, z }}  position   — point de contact
 * @param {{ x, z }}     wallNormal — normale sortante du mur (normalisée)
 * @param {number}       [count=6]
 */
export function emitSparks(position, wallNormal, count = 6) {
  _spawn(position, '#ffee66', count, LIFETIME_SPARK, (p) => {
    const s = 3.0 + Math.random() * 4.0;
    p.vx = wallNormal.x * s + (Math.random() - 0.5) * 2.5;
    p.vz = wallNormal.z * s + (Math.random() - 0.5) * 2.5;
    p.vy = 1.0 + Math.random() * 3.5;
    p.mesh.scale.setScalar(0.3 + Math.random() * 0.4);
  });
}

// ---- Boucle de mise à jour ----

/**
 * Met à jour la physique des particules et supprime celles expirées.
 * @param {number} dt — deltaTime en secondes
 */
export function update(dt) {
  for (let i = _particles.length - 1; i >= 0; i--) {
    const p = _particles[i];
    p.age += dt;

    if (p.age >= p.lifetime) {
      _scene.remove(p.mesh);
      p.mesh.material.dispose();
      _particles.splice(i, 1);
      continue;
    }

    // Gravité
    p.vy += GRAVITY * dt;

    // Déplacement
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;

    // Rebond léger sur le sol
    if (p.mesh.position.y < 0.12) {
      p.mesh.position.y = 0.12;
      p.vy = Math.abs(p.vy) * 0.35;
      p.vx *= 0.7;
      p.vz *= 0.7;
    }

    // Fade sur la dernière demi-seconde de vie
    const fadeStart = p.lifetime - 0.5;
    if (p.age > fadeStart) {
      p.mesh.material.transparent = true;
      p.mesh.material.opacity = 1.0 - (p.age - fadeStart) / 0.5;
    }

    // Légère rotation
    p.mesh.rotation.x += p.vx * dt * 2;
    p.mesh.rotation.z += p.vz * dt * 2;
  }
}

/**
 * Libère toutes les ressources.
 */
export function dispose() {
  for (const p of _particles) {
    if (_scene) _scene.remove(p.mesh);
    p.mesh.material.dispose();
  }
  _particles.length = 0;
  _geo.dispose();
  _scene = null;
}

// ---- Helpers internes ----

/**
 * Factorie commune : crée N particules, appelle initFn(p) pour les vélocités.
 * @param {{ x, y, z }} position
 * @param {string|number} color
 * @param {number} count
 * @param {number} lifetime
 * @param {function} initFn — reçoit le particle { mesh, vx, vy, vz, age, lifetime }
 */
function _spawn(position, color, count, lifetime, initFn) {
  if (!_scene) return;
  const libres = MAX_PARTICLES - _particles.length;
  const n = Math.min(count, libres);

  for (let i = 0; i < n; i++) {
    const mat  = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(_geo, mat);
    mesh.position.set(
      position.x + (Math.random() - 0.5) * 0.4,
      position.y + Math.random() * 0.2,
      position.z + (Math.random() - 0.5) * 0.4,
    );
    const p = { mesh, vx: 0, vy: 0, vz: 0, age: 0, lifetime };
    initFn(p);
    _scene.add(mesh);
    _particles.push(p);
  }
}
