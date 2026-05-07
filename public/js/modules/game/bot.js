// Module game/bot.js — faux joueurs pour le mode test solo.
//
// Comportement de chaque bot :
//   - Si distance au joueur humain > cohesionRadius × 0.5 :
//       → se dirige vers le joueur (cohésion d'abord)
//   - Sinon :
//       → avance vers l'arrivée (cap vers +X en ligne droite)
//
// Physique : même module que le joueur (physics.tick).
// Visuel   : boîte colorée simple (pas de voxelRenderer).
// Collision : hardStop + pushBack appliqués ; effets de terrain ignorés.

import * as THREE   from '../../lib/three.module.js';
import * as physics from './physics.js';
import { checkTerrain } from './collision.js';

// Couleurs Three.js pour les 4 bots (rouge, bleu, vert, orange)
const COULEURS_MESH = [0xe62020, 0x1a52e0, 0x1fa830, 0xf07418];

// Dimensions approx d'un véhicule joueur en espace monde (8×4×4 voxels × scale 0.28)
const BOT_W = 2.0;
const BOT_H = 0.8;
const BOT_D = 1.0;
const BOT_Y = 0.4; // hauteur de positionnement (idem joueur)

// Décalages Z au spawn pour ne pas empiler les bots
const SPAWN_DECALAGES = [1.8, -1.8, 3.6, -3.6];

let _scene      = null;
let _bots       = [];   // [{ id, state, mesh, config, arrivee }]
let _finishX    = 0;
let _cohRadius  = 8;

/**
 * Charge les configs de bots depuis /data/test-vehicles/.
 * @param {number} n — nombre de bots (0..4)
 * @returns {Promise<Array>}
 */
export async function loadConfigs(n) {
  const configs = [];
  for (let i = 1; i <= n; i++) {
    const resp = await fetch(`/data/test-vehicles/bot-${i}.json`);
    if (!resp.ok) throw new Error(`Impossible de charger bot-${i}.json`);
    configs.push(await resp.json());
  }
  return configs;
}

/**
 * Crée les bots dans la scène.
 * @param {THREE.Scene} scene
 * @param {Array}       configs         — tableau de configs (résultat de loadConfigs)
 * @param {{ x, z, angle }} startPos    — position de spawn
 * @param {number}      finishX         — coordonnée X de l'arrivée
 * @param {number}      cohesionRadius
 */
export function init(scene, configs, startPos, finishX, cohesionRadius) {
  _scene     = scene;
  _finishX   = finishX;
  _cohRadius = cohesionRadius;
  _bots      = [];

  configs.forEach((cfg, i) => {
    const state = physics.createState({
      x:     startPos.x,
      z:     startPos.z + (SPAWN_DECALAGES[i] ?? (i * 1.8)),
      angle: startPos.angle,
    });

    // Boîte colorée avec une petite cabine pour indiquer l'avant
    const groupe = new THREE.Group();

    const corpsGeo = new THREE.BoxGeometry(BOT_W, BOT_H, BOT_D);
    const corpsMat = new THREE.MeshStandardMaterial({ color: COULEURS_MESH[i % COULEURS_MESH.length] });
    const corps = new THREE.Mesh(corpsGeo, corpsMat);
    corps.position.y = BOT_H / 2;
    groupe.add(corps);

    // Petite cabine à l'avant (+X) pour indiquer la direction
    const cabineGeo = new THREE.BoxGeometry(BOT_W * 0.35, BOT_H * 0.6, BOT_D * 0.7);
    const cabineMat = new THREE.MeshStandardMaterial({
      color: COULEURS_MESH[i % COULEURS_MESH.length],
      emissive: COULEURS_MESH[i % COULEURS_MESH.length],
      emissiveIntensity: 0.3,
    });
    const cabine = new THREE.Mesh(cabineGeo, cabineMat);
    cabine.position.set(BOT_W * 0.25, BOT_H + BOT_H * 0.3, 0);
    groupe.add(cabine);

    scene.add(groupe);

    _bots.push({
      id:       cfg.id,
      nom:      cfg.nom,
      couleur:  cfg.couleurHex,
      state,
      mesh:     groupe,
      config:   cfg,
      arrivee:  false,
    });
  });
}

/**
 * Met à jour tous les bots pour une frame.
 * @param {{ x, z }} joueurPosition  — position du joueur humain
 * @param {Array}    activeBlocks    — blocs actifs (pour collision)
 * @param {number}   blockScale
 * @param {number}   dt              — delta time en secondes
 */
export function update(joueurPosition, activeBlocks, blockScale, dt) {
  if (!_scene) return;

  for (const bot of _bots) {
    if (bot.arrivee) continue;

    // ---- Calcul du cap cible ----
    const dx   = joueurPosition.x - bot.state.position.x;
    const dz   = joueurPosition.z - bot.state.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    let targetAngle;
    if (dist > _cohRadius * 0.5) {
      // Cohésion : aller vers le joueur
      targetAngle = Math.atan2(dx, dz);
    } else {
      // En cohésion : avancer vers l'arrivée (+X → angle π/2)
      targetAngle = Math.PI / 2;
    }

    // ---- Steering : différence angulaire → [-1, 1] ----
    let diff = targetAngle - bot.state.angle;
    // Normaliser dans [-π, π]
    while (diff >  Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    const steering = Math.max(-1, Math.min(1, diff / (Math.PI * 0.4)));

    const inputs = { steering, braking: 0, reversing: 0 };

    // ---- Terrain + collision ----
    let modifiers = {};
    if (activeBlocks.length > 0) {
      const terrain = checkTerrain(bot.state.position, activeBlocks, blockScale);
      if (terrain?.hardCollision) {
        modifiers.hardStop = true;
        // Légère correction : reculer de 0.3 unité dans la direction opposée
        if (terrain.pushBack) {
          bot.state.position.x += terrain.pushBack.x;
          bot.state.position.z += terrain.pushBack.z;
        }
      }
    }

    // ---- Physique ----
    physics.tick(bot.state, bot.config.stats, inputs, dt, modifiers);

    // ---- Positionnement mesh ----
    bot.mesh.position.set(bot.state.position.x, BOT_Y, bot.state.position.z);
    // angle=π/2 → pointe en +X (même convention que le joueur)
    bot.mesh.rotation.y = bot.state.angle - Math.PI / 2;

    // ---- Détection arrivée ----
    if (bot.state.position.x >= _finishX) {
      bot.arrivee = true;
    }
  }
}

/**
 * Retourne la liste des états bots pour intégration dans vehicleView (pouvoirs, caméra…).
 * @returns {Array<{ id, nom, couleur, position, angle, speed, stats }>}
 */
export function getStates() {
  return _bots
    .filter(b => !b.arrivee)
    .map(b => ({
      id:       b.id,
      nom:      b.nom,
      couleur:  b.couleur,
      position: b.state.position,
      angle:    b.state.angle,
      speed:    b.state.speed,
      stats:    b.config.stats,
    }));
}

/**
 * Retourne le nombre de bots actifs (non arrivés).
 */
export function countActifs() {
  return _bots.filter(b => !b.arrivee).length;
}

/**
 * Retourne le nombre de bots dans le rayon de cohésion du joueur.
 * @param {{ x, z }} joueurPosition
 * @returns {number}
 */
export function countEnCohesion(joueurPosition) {
  let n = 0;
  for (const bot of _bots) {
    if (bot.arrivee) continue;
    const dx = joueurPosition.x - bot.state.position.x;
    const dz = joueurPosition.z - bot.state.position.z;
    if (Math.sqrt(dx * dx + dz * dz) <= _cohRadius) n++;
  }
  return n;
}

/**
 * Libère tous les meshes et remet le module à zéro.
 */
export function dispose() {
  for (const bot of _bots) {
    if (bot.mesh) {
      _scene.remove(bot.mesh);
      bot.mesh.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
  }
  _bots  = [];
  _scene = null;
}
