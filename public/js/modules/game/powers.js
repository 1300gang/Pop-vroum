// Visuels des pouvoirs — meshes, flèche d'arrivée, flashs.
//
// Ce module ne décide plus de rien : toute la géométrie et toute la détection
// viennent de game/power-effects.js, partagé avec le serveur. Les zones
// dessinées ici sont donc exactement celles qui sont testées — ce n'était pas
// le cas avant, où visuel et détection divergeaient.
//
// Chaque pouvoir est un mesh enfant d'un pivot Object3D attaché au véhicule.
// Le pivot suit position + rotation du véhicule → pas de calcul par frame.
//
// Contrat I/O :
//   init(scene)                             → prépare les ressources partagées
//   createForVehicle(ownerId, powerValues)  → handle avec pivot + meshes + powerState
//   update(allVehicles, dt, serverEffects?) → pivots, pulses, traînées, flashs
//   setShieldState(ownerId, shield)         → dôme piloté par l'autorité serveur
//   dispose()                               → nettoie tout
//
// « powers » vient de voxel/stats : { aspiration, phares, sillage, shield, attraction, heal }
// La magnitude est proportionnelle au nombre de voxels de la couleur correspondante.

import * as THREE from '../../lib/three.module.js';
import * as fx     from './power-effects.js';

let _config    = null;
let _scene     = null;
let _finishPos = { x: 9999, z: 0 }; // position de l'arrivée — mise à jour via setFinishPosition()

const _vehiclePowers = []; // { ownerId, pivot, meshes, arrowGroup, arrowState, powerState }
const _trailMeshes   = new Map(); // trailId → mesh de traînée
let   _world         = null;      // traînées vivantes (power-effects.createPowerWorld)

// ---- Flashes d'activation ----
// Un flash = disque lumineux au sol sur le véhicule affecté, fade rapide
const FLASH_DURATION = 0.35;  // secondes
const FLASH_COOLDOWN = 0.7;   // secondes minimum entre deux flashs identiques (anti-spam)
const _flashes        = new Map(); // vehicleId → { mesh, timer }
const _flashCooldowns = new Map(); // `${vehicleId}:${effect}` → timestamp dernier déclenchement

const FLASH_COLORS = {
  aspiration_boost: 0xff3333,
  phares_grip:      0x44ff44,
  sillage_accel:    0x3388ff,
};

async function _chargerConfig() {
  if (_config) return _config;
  const resp = await fetch('/config/gameplay.json');
  if (!resp.ok) throw new Error('Impossible de charger /config/gameplay.json');
  const full = await resp.json();
  _config = full.powers;
  fx.setConfig(_config); // même config des deux côtés
  return _config;
}

/**
 * Initialise le module.
 * @param {THREE.Scene} scene
 */
export async function init(scene) {
  _scene = scene;
  await _chargerConfig();
  _world = fx.createPowerWorld();
}

/**
 * Indique la position mondiale de l'arrivée pour orienter les flèches.
 * À appeler après chaque génération de map.
 * @param {number} x
 * @param {number} z
 */
export function setFinishPosition(x, z) {
  _finishPos.x = x;
  _finishPos.z = z;
}

/**
 * Crée le pivot et les meshes de pouvoir pour un véhicule.
 * Les meshes sont enfants du pivot → ils suivent le véhicule automatiquement.
 *
 * Repères locaux du pivot :
 *   +Z = avant du véhicule   −Z = arrière
 *   +Y = haut                 X = latéral
 *
 * @param {string} ownerId
 * @param {{ aspiration: number, phares: number, sillage: number, shield: number }} powerValues
 * @param {object|null} existingState — état déjà créé ailleurs (bot.js) à partager
 *        plutôt qu'à dupliquer : sans ça les PV de bouclier divergeraient entre
 *        le porteur de l'état et le dôme censé le représenter.
 * @returns {object} handle pour update/dispose
 */
export function createForVehicle(ownerId, powerValues, existingState = null) {
  // Pivot sans scale ni rotation — update() le positionne chaque frame
  const pivot = new THREE.Object3D();
  _scene.add(pivot);

  const meshes     = {};
  const powerState = existingState ?? fx.createPowerState(powerValues);

  // ---- Rouge — Aspiration (triangle plat derrière le véhicule) ----
  if (powerState.aspiration) {
    const { size, offset, halfWidthRatio } = powerState.aspiration;
    const halfWidth = halfWidthRatio * size;
    // Triangle dans le plan XZ du pivot : pointe vers le véhicule, base à l'arrière.
    // Les sommets portent déjà le décalage → le mesh n'a pas d'offset propre,
    // et la zone testée par power-effects.js est ce triangle exactement.
    const verts = new Float32Array([
       0,          0, -offset,
       halfWidth,  0, -(offset + size),
      -halfWidth,  0, -(offset + size),
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.setIndex([0, 1, 2]);
    geo.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff3333, transparent: true, opacity: 0.25,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.05;
    pivot.add(mesh);
    meshes.aspiration = mesh;
  }

  // ---- Vert — Phares (cône lumineux avant) ----
  if (powerState.phares) {
    const { length, radius, offset } = powerState.phares;
    const geo = new THREE.ConeGeometry(radius, length, 12, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x44ff44, transparent: true, opacity: 0.18,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    // ConeGeometry pointe en +Y → Rx(−π/2) met la pointe en −Z, donc côté
    // véhicule : le faisceau part fin du capot et s'évase au loin. L'ancienne
    // Rx(+π/2) le dessinait à l'envers, large au capot et pointu au bout.
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0.5, offset + length / 2);
    pivot.add(mesh);
    meshes.phares = mesh;
  }

  // ---- Bleu — Sillage (pas de mesh permanent : les traînées vivent dans _world) ----

  // ---- Orange — Bouclier (demi-sphère devant le véhicule) ----
  if (powerState.shield) {
    const shieldSize = powerState.shield.size;
    const geo = new THREE.SphereGeometry(shieldSize, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff8800, transparent: true, opacity: 0.3,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    // Demi-sphère ouverte en +Y par défaut → Rx(−π/2) la fait ouvrir en +Z (avant)
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.PI; // orientation correcte
    mesh.position.set(0, 0.1, 1.2); // juste devant le véhicule
    pivot.add(mesh);
    meshes.shield = mesh;
  }

  // ---- Flèche de navigation vers l'arrivée (présente sur TOUS les véhicules) ----
  // Flottante au-dessus du véhicule, plate (visible depuis caméra top-down).
  // Clignotement : lent sans vert, rapide avec beaucoup de vert.
  const arrowCfg = _config?.arrow ?? {
    blinkIntervalBase: 5.0, blinkIntervalMin: 1.0, maxPharesValue: 15,
    height: 2.0, headRadius: 0.3, headLength: 0.55, shaftLength: 0.35, shaftWidth: 0.12,
  };

  const arrowGroup = new THREE.Group();

  // Pointe (ConeGeometry 3 faces = triangle) couchée dans le plan XZ
  const headGeo = new THREE.ConeGeometry(arrowCfg.headRadius, arrowCfg.headLength, 3, 1);
  const arrowMat = new THREE.MeshBasicMaterial({ color: 0x44ff44, depthWrite: false });
  const head = new THREE.Mesh(headGeo, arrowMat);
  // ConeGeometry pointe en +Y par défaut → rotation.x = −π/2 pour pointer en +Z
  head.rotation.x = -Math.PI / 2;
  head.position.z = arrowCfg.shaftLength / 2 + arrowCfg.headLength / 2;
  arrowGroup.add(head);

  // Queue (fine planche plate)
  const shaftGeo = new THREE.BoxGeometry(arrowCfg.shaftWidth, 0.06, arrowCfg.shaftLength);
  const shaft = new THREE.Mesh(shaftGeo, arrowMat);
  shaft.position.z = -arrowCfg.headLength / 4;
  arrowGroup.add(shaft);

  // Hauteur au-dessus du véhicule (plan XZ, pas d'inclinaison Y)
  arrowGroup.position.y = arrowCfg.height;

  _scene.add(arrowGroup); // dans la scène directement (pas enfant du pivot)

  // Calcul de l'intervalle de clignotement
  const ratio          = Math.min(1, (powerState.powerValues.phares ?? 0) / arrowCfg.maxPharesValue);
  const blinkInterval  = arrowCfg.blinkIntervalBase - ratio * (arrowCfg.blinkIntervalBase - arrowCfg.blinkIntervalMin);

  const arrowState = {
    visible:       true,
    blinkInterval,              // secondes
    nextBlink:     performance.now() / 1000 + blinkInterval,
  };
  arrowGroup.visible = true;

  const entry = { ownerId, pivot, meshes, arrowGroup, arrowState, powerState };
  _vehiclePowers.push(entry);
  return entry;
}

/**
 * Met à jour les visuels et fait vivre les traînées.
 *
 * La détection tourne toujours localement — c'est elle qui sème et fait
 * disparaître les disques de sillage. Mais dès que `serverEffects` est fourni
 * (partie en réseau), ce sont les effets du serveur qui font foi pour les
 * flashs : c'est lui l'autorité, chaque navigateur ne redécide plus dans son coin.
 *
 * @param {Array<{ id, position:{x,z}, y?, angle, speed }>} allVehicles
 * @param {number} dt — deltaTime en secondes
 * @param {Array<{ targetId, effect, position }>|null} serverEffects
 * @returns {Array} effets retenus cette frame
 */
export function update(allVehicles, dt, serverEffects = null) {
  if (!_config || !_world) return [];
  const now = performance.now() / 1000;

  for (const vp of _vehiclePowers) {
    const owner = allVehicles.find((v) => v.id === vp.ownerId);
    if (!owner) continue;

    const { x, z } = owner.position;
    const angle    = owner.angle;

    // ---- Le pivot colle au véhicule : Three.js s'occupe du reste ----
    // Même convention que _vehicleGroup.rotation.y = -angle (Three.js horaire)
    // Hauteur du véhicule : sans elle, dôme et faisceaux restaient au sol pendant les sauts
    vp.pivot.position.set(x, owner.y ?? 0, z);
    // +π/2 : aligne l'axe +Z du pivot avec l'avant du véhicule (forward = cos/sin → +X monde)
    vp.pivot.rotation.y = Math.PI / 2 - angle;

    // ---- Flèche de navigation : position + rotation vers l'arrivée + clignotement ----
    if (vp.arrowGroup) {
      // Placer au-dessus du véhicule (Y fixé par arrowGroup.position.y à la création)
      vp.arrowGroup.position.x = x;
      vp.arrowGroup.position.z = z;

      // Orienter vers l'arrivée dans le plan XZ seulement (pas de composante Y)
      const dx = _finishPos.x - x;
      const dz = _finishPos.z - z;
      if (dx !== 0 || dz !== 0) {
        vp.arrowGroup.rotation.y = Math.atan2(dx, dz);
      }

      // Clignotement
      const as = vp.arrowState;
      if (now >= as.nextBlink) {
        as.visible    = !as.visible;
        as.nextBlink  = now + as.blinkInterval;
        vp.arrowGroup.visible = as.visible;
      }
    }

    // ---- Respiration des visuels ----
    if (vp.meshes.aspiration) {
      vp.meshes.aspiration.material.opacity = 0.2 + 0.1 * Math.sin(now * 4);
    }
    if (vp.meshes.phares) {
      vp.meshes.phares.material.opacity = 0.15 + 0.08 * Math.sin(now * 3);
    }
    // Le dôme suit l'usure du bouclier, et disparaît une fois vidé
    if (vp.meshes.shield && vp.powerState.shield) {
      const sh = vp.powerState.shield;
      vp.meshes.shield.visible = sh.active;
      const hpRatio = sh.hpMax > 0 ? Math.max(0, sh.hp / sh.hpMax) : 0;
      vp.meshes.shield.material.opacity = 0.15 + 0.2 * hpRatio;
    }
  }

  // ---- Détection : géométrie partagée avec le serveur ----
  const vue = allVehicles.map((v) => ({
    id:       v.id,
    position: v.position,
    angle:    v.angle,
    speed:    v.speed,
    power:    _vehiclePowers.find((vp) => vp.ownerId === v.id)?.powerState ?? null,
  }));
  const local = fx.computeEffects(vue, _world, dt, now);
  _majTrainees(local, now);

  const effets = serverEffects ?? local.effects;

  // ---- Déclencher les flashes d'activation ----
  for (const e of effets) {
    if (e.position && FLASH_COLORS[e.effect] && !_hasCooldown(e.targetId, e.effect)) {
      _triggerFlash(e.targetId, e.position, FLASH_COLORS[e.effect]);
    }
  }

  // ---- Mise à jour des flashes (fade out) ----
  for (const [, flash] of _flashes) {
    if (flash.timer <= 0) continue;
    flash.timer -= dt;
    const ratio = Math.max(0, flash.timer / FLASH_DURATION);
    // Courbe en ease-out : fort au début, disparaît vite à la fin
    flash.mesh.material.opacity = 0.65 * ratio * ratio;
    if (flash.timer <= 0) flash.mesh.visible = false;
  }

  return effets;
}

/**
 * Retire un véhicule et libère ses visuels.
 * Sans ça, recréer un véhicule déjà enregistré (calibrateur qui retouche les
 * points de couleur) laissait l'ancienne entrée en place : visuels empilés, et
 * surtout détection comptée deux fois.
 *
 * @param {string} ownerId
 */
export function removeVehicle(ownerId) {
  const i = _vehiclePowers.findIndex(v => v.ownerId === ownerId);
  if (i === -1) return;
  const vp = _vehiclePowers[i];

  for (const mesh of Object.values(vp.meshes)) {
    mesh.geometry?.dispose();
    mesh.material?.dispose();
  }
  if (_scene && vp.pivot) _scene.remove(vp.pivot);

  if (vp.arrowGroup && _scene) {
    _scene.remove(vp.arrowGroup);
    vp.arrowGroup.traverse(o => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
  }
  _vehiclePowers.splice(i, 1);
}

/**
 * Aligne le dôme d'un véhicule sur l'état de bouclier du serveur.
 * En réseau, c'est le serveur qui use le bouclier (server/game-loop.js) : sans
 * ça, chaque client afficherait un dôme différent.
 *
 * @param {string} ownerId
 * @param {{ hp: number, hpMax?: number, active: boolean }|null} shield
 */
export function setShieldState(ownerId, shield) {
  if (!shield) return;
  const sh = _vehiclePowers.find((v) => v.ownerId === ownerId)?.powerState?.shield;
  if (!sh) return;
  sh.hp     = shield.hp;
  sh.hpMax  = shield.hpMax ?? sh.hpMax;
  sh.active = shield.active;
}

/**
 * Part d'un choc encaissée par le bouclier d'un véhicule — 0 s'il n'en a plus.
 * Le serveur use le bouclier de son côté ; le client s'en sert pour ne pas
 * arracher des voxels que le dôme a protégés.
 *
 * @param {string} ownerId
 * @returns {number} facteur ∈ [0, 1]
 */
export function shieldAbsorption(ownerId) {
  const sh = _vehiclePowers.find((v) => v.ownerId === ownerId)?.powerState?.shield;
  if (!sh?.active || sh.hp <= 0) return 0;
  return _config?.shield?.absorption ?? 0;
}

// Crée / supprime les disques de traînée au rythme du module de détection.
function _majTrainees(local, now) {
  for (const t of local.spawned) {
    _trailMeshes.set(t.id, _creerSillageMesh(t.x, t.z, t.radius));
  }
  for (const t of local.expired) {
    const mesh = _trailMeshes.get(t.id);
    if (!mesh) continue;
    _scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    _trailMeshes.delete(t.id);
  }
  const lifetime = _config.sillage.lifetimeSec;
  for (const t of _world.trails) {
    const mesh = _trailMeshes.get(t.id);
    if (mesh) mesh.material.opacity = 0.3 * (1 - (now - t.createdAt) / lifetime);
  }
}

/**
 * Consomme le bouclier d'un véhicule lors d'une collision — usage local
 * (pages solo). En réseau c'est le serveur qui appelle l'équivalent dans
 * power-effects.js, et le client se contente de setShieldState().
 *
 * L'ancien applyEffects() a disparu : il écrivait dans stats.speed/grip/accel
 * alors que la physique lit speed_stat/grip_stat/accel_stat, et il multipliait
 * l'objet stats à chaque frame sans jamais revenir à la valeur de base. Les
 * effets passent maintenant par server/game-loop.js, qui les replie dans des
 * stats reconstruites à chaque tick.
 *
 * @param {string} ownerId
 * @param {number} damage
 * @returns {number} dégâts restants après absorption
 */
export function absorbDamage(ownerId, damage) {
  const vp = _vehiclePowers.find((v) => v.ownerId === ownerId);
  if (!vp) return damage;
  return fx.absorbDamage(vp.powerState, damage).remaining;
}

/**
 * Libère toutes les ressources.
 */
export function dispose() {
  for (const vp of _vehiclePowers) {
    for (const mesh of Object.values(vp.meshes)) {
      mesh.geometry?.dispose();
      mesh.material?.dispose();
    }
    if (_scene && vp.pivot) _scene.remove(vp.pivot);

    // Flèche de navigation
    if (vp.arrowGroup && _scene) {
      _scene.remove(vp.arrowGroup);
      vp.arrowGroup.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
  }
  _vehiclePowers.length = 0;

  for (const mesh of _trailMeshes.values()) {
    if (_scene) _scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  _trailMeshes.clear();
  _world = null;

  for (const flash of _flashes.values()) {
    if (flash.mesh) {
      if (_scene) _scene.remove(flash.mesh);
      flash.mesh.geometry.dispose();
      flash.mesh.material.dispose();
    }
  }
  _flashes.clear();
  _flashCooldowns.clear();

  _scene = null;
}

// ---- Helpers internes ----

// Crée ou réinitialise un flash visuel au sol sur le véhicule cible.
function _triggerFlash(vehicleId, position, colorHex) {
  let flash = _flashes.get(vehicleId);
  if (!flash) {
    // Disque plat au sol — géométrie partageable par tous les flashes du même véhicule
    const geo = new THREE.CircleGeometry(3, 12);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex, transparent: true, opacity: 0,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 1;
    _scene.add(mesh);
    flash = { mesh, timer: 0 };
    _flashes.set(vehicleId, flash);
  }

  flash.mesh.position.set(position.x, 0.1, position.z);
  flash.mesh.material.color.setHex(colorHex);
  flash.mesh.material.opacity = 0.65;
  flash.mesh.visible = true;
  flash.timer = FLASH_DURATION;
}

// Vérifie si un cooldown est actif pour (vehicleId, effect) — et l'enregistre si non.
function _hasCooldown(vehicleId, effect) {
  const key = `${vehicleId}:${effect}`;
  const last = _flashCooldowns.get(key) || 0;
  const now  = performance.now() / 1000;
  if (now - last < FLASH_COOLDOWN) return true;
  _flashCooldowns.set(key, now);
  return false;
}

function _creerSillageMesh(x, z, radius) {
  const geo = new THREE.CircleGeometry(radius, 8);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x3388ff, transparent: true, opacity: 0.3,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, 0.02, z);
  mesh.renderOrder = -1;
  _scene.add(mesh);
  return mesh;
}
