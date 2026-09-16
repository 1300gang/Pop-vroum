// Système de pouvoirs — 4 pouvoirs P0 + 2 pouvoirs P1.
//
// Chaque pouvoir est un mesh enfant d'un pivot Object3D attaché au véhicule.
// Le pivot suit position + rotation du véhicule → pas de calcul de position par frame.
//
// Contrat I/O :
//   init(scene)               → prépare les ressources partagées
//   createForVehicle(ownerId, powerValues) → handle avec pivot + meshes + state
//   update(allVehicles, dt)    → déplace le pivot, pulse les visuels, détecte les effets
//   dispose()                  → nettoie tout
//
// « powers » vient de voxel/stats : { aspiration: 0-N, phares: 0-N, sillage: 0-N, shield: 0-N }
// La magnitude est proportionnelle au nombre de voxels de la couleur correspondante.

import * as THREE from '../../lib/three.module.js';

let _config    = null;
let _scene     = null;
let _finishPos = { x: 9999, z: 0 }; // position de l'arrivée — mise à jour via setFinishPosition()

const _vehiclePowers = []; // { ownerId, pivot, meshes, arrowGroup, arrowState, state, powerValues }
const _sillageTrails = []; // { ownerId, position, createdAt, radius, mesh }

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
  return _config;
}

/**
 * Initialise le module.
 * @param {THREE.Scene} scene
 */
export async function init(scene) {
  _scene = scene;
  await _chargerConfig();
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
 * @returns {object} handle pour update/dispose
 */
export function createForVehicle(ownerId, powerValues) {
  // Pivot sans scale ni rotation — update() le positionne chaque frame
  const pivot = new THREE.Object3D();
  _scene.add(pivot);

  const meshes = {};
  const state  = {};

  // ---- Rouge — Aspiration (triangle plat derrière le véhicule) ----
  if (powerValues.aspiration > 0) {
    const size = 1.5 + powerValues.aspiration * 0.8;
    // Triangle dans le plan XZ du pivot : pointe en +Z (vers le véhicule), base en −Z (arrière)
    const verts = new Float32Array([
       0,           0,  0,
       size * 0.6,  0, -size,
      -size * 0.6,  0, -size,
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
    mesh.position.set(0, 0.05, -1.0); // juste derrière le véhicule
    pivot.add(mesh);
    meshes.aspiration = mesh;
    state.aspiration  = { size, active: true };
  }

  // ---- Vert — Phares (cône lumineux avant) ----
  if (powerValues.phares > 0) {
    const length = 3 + powerValues.phares * 1.5;
    const radius = 1 + powerValues.phares * 0.5;
    const geo = new THREE.ConeGeometry(radius, length, 12, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x44ff44, transparent: true, opacity: 0.18,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    // ConeGeometry pointe en +Y par défaut → Rx(π/2) le fait pointer en +Z (avant)
    mesh.rotation.x = Math.PI / 2;
    mesh.rotation.z = Math.PI; // orientation correcte
    mesh.position.set(0, 0.5, 1.0 + length / 2); // devant le véhicule
    pivot.add(mesh);
    meshes.phares = mesh;
    state.phares  = { length, radius, active: true };
  }

  // ---- Bleu — Sillage (pas de mesh permanent — les trails restent dans _sillageTrails) ----
  if (powerValues.sillage > 0) {
    state.sillage = {
      radius:      0.8 + powerValues.sillage * 0.3,
      emitCounter: 0,
      active:      true,
    };
  }

  // ---- Orange — Bouclier (demi-sphère devant le véhicule) ----
  if (powerValues.shield > 0) {
    // Dôme en unités monde, hors échelle du véhicule : non plafonné il atteignait
    // 7 u de rayon pour une voiture de 2,24 u, et les objets semblaient percutés
    // à distance.
    const cfgDome    = _config?.shield ?? {};
    const shieldSize = Math.min(
      cfgDome.domeMax ?? 1.6,
      (cfgDome.domeMin ?? 0.9) + powerValues.shield * (cfgDome.domeParPoint ?? 0.05),
    );
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
    state.shield  = { size: shieldSize, hp: powerValues.shield, active: true };
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
  const ratio          = Math.min(1, (powerValues.phares ?? 0) / arrowCfg.maxPharesValue);
  const blinkInterval  = arrowCfg.blinkIntervalBase - ratio * (arrowCfg.blinkIntervalBase - arrowCfg.blinkIntervalMin);

  const arrowState = {
    visible:       true,
    blinkInterval,              // secondes
    nextBlink:     performance.now() / 1000 + blinkInterval,
  };
  arrowGroup.visible = true;

  const entry = { ownerId, pivot, meshes, arrowGroup, arrowState, state, powerValues };
  _vehiclePowers.push(entry);
  return entry;
}

/**
 * Met à jour tous les pouvoirs : positionne les meshes, émet les trails,
 * détecte les véhicules dans les zones et applique les effets.
 *
 * @param {Array<{ id: string, position: {x,z}, angle: number, speed: number, stats: object }>} allVehicles
 * @param {number} dt — deltaTime en secondes
 * @returns {Array<{ targetId: string, effect: string, value: number }>} effets appliqués cette frame
 */
export function update(allVehicles, dt) {
  if (!_config) return [];
  const effets = [];
  const now = performance.now() / 1000;

  for (const vp of _vehiclePowers) {
    const owner = allVehicles.find((v) => v.id === vp.ownerId);
    if (!owner) continue;

    const { x, z } = owner.position;
    const angle     = owner.angle;

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

    const sinA = Math.sin(angle);
    const cosA = Math.cos(angle);

    // ---- Aspiration : pulse + détection derrière ----
    if (vp.meshes.aspiration && vp.state.aspiration?.active) {
      vp.meshes.aspiration.material.opacity = 0.2 + 0.1 * Math.sin(now * 4);

      const s = vp.state.aspiration.size;
      for (const other of allVehicles) {
        if (other.id === vp.ownerId) continue;
        const dx   = other.position.x - x;
        const dz   = other.position.z - z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        // Derrière : projection sur l'axe avant négative
        const proj = dx * sinA + dz * cosA;
        if (proj < 0 && dist < s) {
          effets.push({ targetId: other.id, effect: 'aspiration_boost', value: _config.aspiration.boostStrength, position: other.position });
        }
      }
    }

    // ---- Phares : pulse + détection dans le cône avant ----
    if (vp.meshes.phares && vp.state.phares?.active) {
      vp.meshes.phares.material.opacity = 0.15 + 0.08 * Math.sin(now * 3);

      const len     = vp.state.phares.length;
      const cosHalf = 0.7; // ~45° demi-angle
      for (const other of allVehicles) {
        if (other.id === vp.ownerId) continue;
        const dx   = other.position.x - x;
        const dz   = other.position.z - z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > len || dist < 0.1) continue;
        const dot = (dx / dist) * sinA + (dz / dist) * cosA;
        if (dot > cosHalf) {
          effets.push({ targetId: other.id, effect: 'phares_grip', value: _config.phares.gripBoost, position: other.position });
        }
      }
    }

    // ---- Sillage : émission de trails au sol ----
    if (vp.state.sillage?.active && owner.speed > 1) {
      vp.state.sillage.emitCounter += dt;
      if (vp.state.sillage.emitCounter > 0.15) {
        vp.state.sillage.emitCounter = 0;
        _sillageTrails.push({
          ownerId:   vp.ownerId,
          position:  { x, z },
          createdAt: now,
          radius:    vp.state.sillage.radius,
          mesh:      _creerSillageMesh(x, z, vp.state.sillage.radius),
        });
      }
    }

    // ---- Bouclier : pulse selon HP restants ----
    if (vp.meshes.shield && vp.state.shield?.active) {
      const hpRatio = vp.state.shield.hp / Math.max(1, vp.powerValues.shield);
      vp.meshes.shield.material.opacity = 0.15 + 0.2 * hpRatio;
    }
  }

  // ---- Update sillage trails : fade + détection ----
  const lifetime = _config.sillage.lifetimeSec;
  for (let i = _sillageTrails.length - 1; i >= 0; i--) {
    const trail = _sillageTrails[i];
    const age   = now - trail.createdAt;
    if (age > lifetime) {
      if (trail.mesh) {
        _scene.remove(trail.mesh);
        trail.mesh.geometry.dispose();
        trail.mesh.material.dispose();
      }
      _sillageTrails.splice(i, 1);
      continue;
    }
    // Fade
    if (trail.mesh) {
      trail.mesh.material.opacity = 0.3 * (1 - age / lifetime);
    }
    // Détection des véhicules qui traversent
    for (const other of allVehicles) {
      if (other.id === trail.ownerId) continue;
      const dx = other.position.x - trail.position.x;
      const dz = other.position.z - trail.position.z;
      if (dx * dx + dz * dz < trail.radius * trail.radius) {
        effets.push({ targetId: other.id, effect: 'sillage_accel', value: _config.sillage.accelBoost, position: other.position });
      }
    }
  }

  // ---- Déclencher les flashes d'activation ----
  for (const e of effets) {
    if (e.position && FLASH_COLORS[e.effect] && !_hasCooldown(e.targetId, e.effect)) {
      _triggerFlash(e.targetId, e.position, FLASH_COLORS[e.effect]);
    }
  }

  // ---- Mise à jour des flashes (fade out) ----
  for (const [id, flash] of _flashes) {
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
 * Applique les effets retournés par update() aux stats temporaires des véhicules.
 * @param {Array<{ targetId: string, effect: string, value: number }>} effets
 * @param {Array<{ id: string, stats: { speed: number, grip: number, accel: number } }>} allVehicles
 */
export function applyEffects(effets, allVehicles) {
  for (const e of effets) {
    const target = allVehicles.find((v) => v.id === e.targetId);
    if (!target) continue;
    switch (e.effect) {
      case 'aspiration_boost':
        target.stats.speed *= e.value;
        break;
      case 'phares_grip':
        target.stats.grip *= e.value;
        break;
      case 'sillage_accel':
        target.stats.accel *= e.value;
        break;
    }
  }
}

/**
 * Consomme des HP du bouclier d'un véhicule lors d'une collision.
 * @param {string} ownerId
 * @param {number} damage
 * @returns {number} dégâts restants après absorption
 */
export function absorbDamage(ownerId, damage) {
  const vp = _vehiclePowers.find((v) => v.ownerId === ownerId);
  if (!vp?.state.shield?.active || vp.state.shield.hp <= 0) return damage;
  const absorbed = damage * _config.shield.absorption;
  const remaining = damage - absorbed;
  vp.state.shield.hp = Math.max(0, vp.state.shield.hp - absorbed);
  if (vp.state.shield.hp <= 0) {
    vp.state.shield.active = false;
    if (vp.meshes.shield) vp.meshes.shield.visible = false;
  }
  return remaining;
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

  for (const trail of _sillageTrails) {
    if (trail.mesh) {
      if (_scene) _scene.remove(trail.mesh);
      trail.mesh.geometry.dispose();
      trail.mesh.material.dispose();
    }
  }
  _sillageTrails.length = 0;

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
