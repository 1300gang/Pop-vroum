// Module game/bot.js — faux joueurs pour les pages de test.
//
// Deux conduites :
//
//   - Navigation (setNavigation() appelé) : les bots suivent de vrais chemins à
//     travers le labyrinthe (game/navigation.js), vont vers la sortie, reviennent
//     quand le joueur s'éloigne, l'attendent quand ils sont trop en avance,
//     freinent avant les virages et reculent quand ils sont coincés.
//
//   - Historique (sans navigation) : cap en ligne droite vers le joueur ou vers
//     +X, arrêt net contre les murs. Conservée telle quelle pour
//     test-jeu-v2-solo.html, qui ne connaît pas la navigation.
//
// Conduite (mode navigation) : game/vehicle-tick.js, exactement comme un joueur
// — sauts, rampes, recul automatique, même carrosserie. Le cerveau (où aller,
// volant, pédales) vit dans game/bot-brain.js, sans Three.js, pour que le
// serveur puisse aussi faire rouler des bots.
// Visuel : boîte colorée simple (pas de voxelRenderer).

import * as THREE   from '../../lib/three.module.js';
import * as physics from './physics.js';
import { checkTerrain } from './collision.js';
import { createPowerState } from './power-effects.js';
import { createVehicleSim, tickVehicle } from './vehicle-tick.js';
import {
  createBotNav, createBotIA, refreshPlayerField, blocksAround, decideInputs, noteContact,
} from './bot-brain.js';
import { nearestWalkable } from './navigation.js';

// Couleurs Three.js pour les 4 bots (rouge, bleu, vert, orange)
const COULEURS_MESH = [0xe62020, 0x1a52e0, 0x1fa830, 0xf07418];

// Hauteur de la boîte ; longueur et largeur suivent la taille du véhicule
// joueur (physics.vehicleScale : 8 × 4 voxels), comme sa carrosserie de choc
const BOT_H = 0.8;
const BOT_Y = 0.4; // hauteur de positionnement (idem joueur)

// Décalages Z au spawn pour ne pas empiler les bots
const SPAWN_DECALAGES = [1.8, -1.8, 3.6, -3.6];

let _scene      = null;
let _bots       = [];   // [{ id, state, mesh, config, statsNorm, arrivee }]
let _finishX    = 0;
let _cohRadius  = 8;
let _consts     = null; // /config/gameplay.json → physics

// ---- Navigation (null = conduite historique) ----
let _bn           = null;   // bot-brain.createBotNav() : grille + champs de distance
let _bounds       = null;   // clôture
let _plateauH     = 0.5;    // hauteur d'un niveau d'élévation (miroir de layout.json)
let _intentions   = false;  // lignes de visée affichées

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
 * @param {{ physics: object, vehicleStats: object }} consts — /config/gameplay.json
 */
export function init(scene, configs, startPos, finishX, cohesionRadius, consts) {
  _scene     = scene;
  _finishX   = finishX;
  _cohRadius = cohesionRadius;
  _consts    = consts.physics;
  _bots      = [];

  const vs = consts.vehicleStats;

  const echelle = _consts.vehicleScale ?? 0.28;
  const BOT_W = 8 * echelle, BOT_D = 4 * echelle;

  configs.forEach((cfg, i) => {
    const sim = createVehicleSim({
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
      sim,
      state:    sim.car,   // la voiture de la simulation
      mesh:     groupe,
      ligne:    null,      // ligne de visée (debug)
      config:   cfg,
      // Stats normalisées (1 = aucun voxel de la couleur), format vehicle-tick
      stats: {
        speed: cfg.stats.speed / vs.baseSpeed,
        grip:  cfg.stats.grip  / vs.baseGrip,
        accel: cfg.stats.accel / vs.baseAccel,
      },
      // Même chose au format du pipeline historique (conduite sans navigation)
      statsNorm: {
        speed_stat: cfg.stats.speed / vs.baseSpeed,
        grip_stat:  cfg.stats.grip  / vs.baseGrip,
        accel_stat: cfg.stats.accel / vs.baseAccel,
      },
      // Les bots portent leurs pouvoirs comme n'importe quel véhicule : sans ça
      // ils ne sont que des cibles, et le calibrateur ne montre qu'un sens de
      // la relation. createPowerState() suppose power-effects.setConfig() déjà
      // appelé (powers.init() s'en charge).
      powerState: createPowerState(cfg.powers ?? {}),
      ia:         createBotIA(i),
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
 * @param {Object<string, {speedMul,gripMul,accelMul}>|null} effetsParBot
 *        — effets subis ce tick, indexés par id de bot (power-effects.foldEffects).
 *          Omis : les bots roulent sans subir aucun pouvoir, comportement d'origine.
 */
export function update(joueurPosition, activeBlocks, blockScale, dt, effetsParBot = null) {
  if (!_scene) return;
  if (_bn) { _updateNav(joueurPosition, dt, effetsParBot); return; }
  _updateLegacy(joueurPosition, activeBlocks, blockScale, dt, effetsParBot);
}

// Conduite historique — inchangée, pour les pages qui n'appellent pas setNavigation().
function _updateLegacy(joueurPosition, activeBlocks, blockScale, dt, effetsParBot) {
  for (const bot of _bots) {
    if (bot.arrivee) continue;

    // ---- Calcul du cap cible ----
    const dx   = joueurPosition.x - bot.state.position.x;
    const dz   = joueurPosition.z - bot.state.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    let targetAngle;
    if (dist > _cohRadius * 0.5) {
      // Cohésion : aller vers le joueur
      targetAngle = Math.atan2(dz, dx);
    } else {
      // En cohésion : avancer vers l'arrivée (+X → angle 0)
      targetAngle = 0;
    }

    // ---- Steering : différence angulaire → [-1, 1] ----
    let diff = targetAngle - bot.state.angle;
    // Normaliser dans [-π, π]
    while (diff >  Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    const steering = Math.max(-1, Math.min(1, diff / (Math.PI * 0.4)));

    // ---- Terrain + collision ----
    let arret = false;
    if (activeBlocks.length > 0) {
      const terrain = checkTerrain(bot.state.position, activeBlocks, blockScale);
      if (terrain?.hardCollision) {
        arret = true;
        // Légère correction : reculer de 0.3 unité dans la direction opposée
        if (terrain.pushBack) {
          bot.state.position.x += terrain.pushBack.x;
          bot.state.position.z += terrain.pushBack.z;
        }
      }
    }

    // ---- Physique ----
    if (arret) {
      bot.state.velocity.x = 0;
      bot.state.velocity.z = 0;
      bot.state.speed      = 0;
      bot.state.drifting   = false;
    } else {
      _tickBot(bot, steering, dt, effetsParBot?.[bot.id] ?? null);
    }

    // ---- Positionnement mesh ----
    bot.mesh.position.set(bot.state.position.x, BOT_Y, bot.state.position.z);
    // angle=0 → pointe en +X (même convention que le joueur)
    bot.mesh.rotation.y = -bot.state.angle;

    // ---- Détection arrivée ----
    if (bot.state.position.x >= _finishX) {
      bot.arrivee = true;
    }
  }
}

// ============================================================================
// Conduite par navigation
// ============================================================================

const COULEUR_MODE = { sortie: 0x66ff99, rejoindre: 0xffd166, attente: 0x7fb4ff, recul: 0xff6b6b };

/**
 * Active la conduite par navigation pour la map courante.
 * À rappeler à chaque nouvelle map, après init().
 *
 * @param {object} map — MapData (blocks, blockScale, exit…)
 * @param {{ exit?: {x,z}, bounds?: object, plateauHeight?: number }} [opts]
 */
export function setNavigation(map, opts = {}) {
  _bn       = createBotNav(map, { exit: opts.exit });
  _bounds   = opts.bounds ?? null;
  _plateauH = opts.plateauHeight ?? 0.5;
  _bots.forEach((b, i) => { b.ia = createBotIA(i); b.arrivee = false; });
}

/** Affiche une ligne de visée par bot, colorée selon ce qu'il cherche à faire. */
export function setShowIntentions(actif) {
  _intentions = !!actif;
  if (!_intentions) for (const b of _bots) if (b.ligne) b.ligne.visible = false;
}

/** État interne détaillé, pour diagnostiquer un bot qui se conduit mal. */
export function getDebug(joueur = null) {
  if (!_bn) return [];
  const cj = joueur ? nearestWalkable(_bn.nav, joueur.x, joueur.z) : -1;
  return _bots.map(b => {
    const ic = nearestWalkable(_bn.nav, b.state.position.x, b.state.position.z);
    return {
      nom: b.nom, mode: b.ia.mode, case: ic, caseJoueur: cj,
      versSortie: ic >= 0 ? _bn.champSortie[ic] : null,
      versJoueur: ic >= 0 && _bn.champJoueur ? _bn.champJoueur[ic] : null,
      proche: b.ia.proche, contact: +b.ia.tContact.toFixed(2),
      lent: +b.ia.tLent.toFixed(2), sansProgres: +b.ia.tSansProgres.toFixed(2),
    };
  });
}

/** Ce que fait chaque bot en ce moment — pour l'affichage. */
export function getModes() {
  return _bots.map(b => ({ id: b.id, nom: b.nom, mode: b.ia?.mode ?? '—' }));
}

function _updateNav(joueur, dt, effetsParBot) {
  refreshPlayerField(_bn, joueur, _bots.map(b => b.state.position), dt);

  for (const bot of _bots) {
    const s = bot.state;

    // Le cerveau décide, la voiture roule avec la même physique qu'un joueur.
    // Pas d'aide couloir : le bot a sa propre navigation, elle la contrarierait.
    const inputs = decideInputs(_bn, bot.ia, s, joueur, _cohRadius, dt);
    const ev = tickVehicle(bot.sim, inputs, {
      blocks:        blocksAround(_bn, s.position),
      blockScale:    _bn.cs,
      bounds:        _bounds,
      nav:           null,
      consts:        _consts,
      plateauHeight: _plateauH,
      vehicleScale:  _consts.vehicleScale ?? 0.28,
    }, dt, {
      stats:  bot.stats,
      fx:     effetsParBot?.[bot.id],
      assist: false,
    });
    noteContact(bot.ia, !!ev.contact, dt);

    // ---- Rendu ----
    bot.mesh.position.set(s.position.x, BOT_Y + (s.y ?? 0), s.position.z);
    bot.mesh.rotation.y = -s.angle;
    _majLigne(bot);
  }
}

function _majLigne(bot) {
  const ia = bot.ia;
  if (!_intentions || !ia.proche) return;
  if (!bot.ligne) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    bot.ligne = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }));
    bot.ligne.renderOrder = 5;
    _scene.add(bot.ligne);
  }
  const p = bot.state.position, a = bot.ligne.geometry.attributes.position;
  a.setXYZ(0, p.x, 1.2, p.z);
  a.setXYZ(1, ia.proche.x, 0.3, ia.proche.z);
  a.setXYZ(2, ia.loin.x,   0.3, ia.loin.z);
  a.needsUpdate = true;
  bot.ligne.material.color.setHex(COULEUR_MODE[ia.mode] ?? 0xffffff);
  bot.ligne.visible = true;
}

// Une frame de conduite historique (mode sans navigation, test-jeu-v2-solo).
function _tickBot(bot, steering, dt, effets, throttle = 1, surfaceGrip = 1.0) {
  const s         = bot.state;

  // Stats reconstruites à chaque frame à partir de bot.statsNorm, jamais
  // écrites dedans : même règle que le serveur, sinon l'effet se cumulerait.
  const stats = effets
    ? {
        speed_stat: bot.statsNorm.speed_stat * effets.speedMul,
        grip_stat:  bot.statsNorm.grip_stat  * effets.gripMul,
        accel_stat: bot.statsNorm.accel_stat * effets.accelMul,
      }
    : bot.statsNorm;

  const dec       = physics.decompose(s.velocity, s.angle);
  const driftInfo = physics.detectDrift(dec, _consts, stats, surfaceGrip, s.drifting);
  s.drifting      = driftInfo.is_drifting;

  const newV = physics.computeForces(
    s, { throttle }, stats, dt, _consts, driftInfo.lateralGrip
  );
  s.velocity.x = newV.x;
  s.velocity.z = newV.z;

  const steeringEff = physics.rampSteering(s, steering, dt, _consts);
  s.angle += physics.computeTurnRate(steeringEff, dec, driftInfo, _consts) * dt;

  s.position.x += s.velocity.x * dt;
  s.position.z += s.velocity.z * dt;
  s.speed       = driftInfo.v_speed;
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
      power:    b.powerState,
    }));
}

/**
 * Remplace les valeurs de pouvoir d'un bot et reconstruit son état.
 * Utilisé par le calibrateur, qui change les formes en direct.
 *
 * @param {string} botId
 * @param {object} powerValues
 */
export function setPowerValues(botId, powerValues) {
  const bot = _bots.find(b => b.id === botId);
  if (!bot) return;
  bot.config.powers = { ...powerValues };
  bot.powerState    = createPowerState(bot.config.powers);
}

/**
 * Reconstruit tous les états de pouvoir — à appeler après un changement de
 * géométrie dans la config (les formes sont figées à la création).
 */
export function rebuildPowerStates() {
  for (const bot of _bots) bot.powerState = createPowerState(bot.config.powers ?? {});
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
    if (bot.ligne) {
      _scene?.remove(bot.ligne);
      bot.ligne.geometry.dispose();
      bot.ligne.material.dispose();
    }
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
  _bn = null;
}
