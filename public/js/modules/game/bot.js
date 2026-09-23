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
// Physique : même pipeline vectoriel V5 que le joueur et que le serveur
// (decompose → detectDrift → computeForces → rampSteering → computeTurnRate).
// Visuel   : boîte colorée simple (pas de voxelRenderer).

import * as THREE   from '../../lib/three.module.js';
import * as physics from './physics.js';
import { checkTerrain } from './collision.js';
import { createPowerState } from './power-effects.js';
import { getSurfaceGrip } from './map-generator.js';
import {
  buildNavGrid, nearestWalkable, waypoint, distanceField, descend, lineOfSight, cellIndex,
} from './navigation.js';

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
let _bots       = [];   // [{ id, state, mesh, config, statsNorm, arrivee }]
let _finishX    = 0;
let _cohRadius  = 8;
let _consts     = null; // /config/gameplay.json → physics

// ---- Navigation (null = conduite historique) ----
let _nav          = null;   // grille de navigation
let _champSortie  = null;   // distance de chaque case à la sortie — calculé une fois par map
let _champJoueur  = null;   // distance au joueur — partagé par tous les bots
let _tChamp       = 0;      // délai avant le prochain rafraîchissement du champ joueur
let _blocIndex    = null;   // "col,row" → bloc, pour les collisions autour de chaque bot
let _cs           = 2;      // taille d'une cellule en unités monde
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
      ia:         _nouvelleIA(i),
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
  if (_nav) { _updateNav(joueurPosition, dt, effetsParBot); return; }
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

const R_PROCHE        = 2.8;   // regard anticipé du volant (u)
const R_LOIN          = 7.0;   // regard lointain, pour freiner avant un virage (u)
const V_MAX           = 14;    // vitesse visée en ligne droite
const V_MIN           = 4;     // vitesse visée dans un virage serré
const AVANCE_ATTENTE  = 5;     // coût de chemin d'avance sur le joueur au-delà duquel on l'attend
// Être dans le rayon de cohésion suffit : viser la case exacte du joueur
// faisait converger quatre bots sur un point souvent collé à un mur, où ils
// frottaient, reculaient et recommençaient sans fin.
const REJOINDRE_SI    = 0.75;  // × rayon de cohésion : trop loin, on revient
const RELACHER_SI     = 0.5;   // × rayon : assez près, on repart vers la sortie
const BUT_ATTEINT     = 2.0;   // u : sous cette distance du dernier point, on s'arrête
// Décalage latéral propre à chaque bot : sans lui, les quatre suivent la même
// ligne et se superposent (les véhicules ne se percutent pas).
const VOIES           = [0.7, -0.7, 0.35, -0.35];
const AUDACES         = [1.0, 0.9, 1.1, 0.95];
const COULEUR_MODE    = { sortie: 0x66ff99, rejoindre: 0xffd166, attente: 0x7fb4ff, recul: 0xff6b6b };

function _nouvelleIA(n) {
  return {
    mode: 'sortie', tRecul: 0, sensRecul: 1,
    tLent: 0, tContact: 0, tSansProgres: 0, meilleur: Infinity,
    voie: VOIES[n % VOIES.length], audace: AUDACES[n % AUDACES.length],
    proche: null, loin: null, ligne: null, enContact: false,
  };
}

/**
 * Active la conduite par navigation pour la map courante.
 * À rappeler à chaque nouvelle map, après init().
 *
 * @param {object} map — MapData (blocks, blockScale, exit…)
 * @param {{ exit?: {x,z}, bounds?: object, plateauHeight?: number }} [opts]
 */
export function setNavigation(map, opts = {}) {
  _nav       = buildNavGrid(map);
  _cs        = map.blockScale ?? 2;
  _blocIndex = new Map(map.blocks.map(b => [`${b.col},${b.row}`, b]));
  _bounds    = opts.bounds ?? null;
  _plateauH  = opts.plateauHeight ?? 0.5;

  const e = opts.exit ?? map.exit?.worldCenter ?? map.finishPosition;
  _champSortie = distanceField(_nav, [nearestWalkable(_nav, e.x, e.z)]);
  _champJoueur = null;
  _tChamp      = 0;
  _bots.forEach((b, i) => { b.ia = _nouvelleIA(i); b.arrivee = false; });
}

/** Affiche une ligne de visée par bot, colorée selon ce qu'il cherche à faire. */
export function setShowIntentions(actif) {
  _intentions = !!actif;
  if (!_intentions) for (const b of _bots) if (b.ia?.ligne) b.ia.ligne.visible = false;
}

/** État interne détaillé, pour diagnostiquer un bot qui se conduit mal. */
export function getDebug(joueur = null) {
  if (!_nav) return [];
  const cj = joueur ? nearestWalkable(_nav, joueur.x, joueur.z) : -1;
  return _bots.map(b => {
    const ic = nearestWalkable(_nav, b.state.position.x, b.state.position.z);
    return {
      nom: b.nom, mode: b.ia.mode, case: ic, caseJoueur: cj,
      versSortie: ic >= 0 ? _champSortie[ic] : null,
      versJoueur: ic >= 0 && _champJoueur ? _champJoueur[ic] : null,
      proche: b.ia.proche, contact: +b.ia.tContact.toFixed(2),
      lent: +b.ia.tLent.toFixed(2), sansProgres: +b.ia.tSansProgres.toFixed(2),
    };
  });
}

/** Ce que fait chaque bot en ce moment — pour l'affichage. */
export function getModes() {
  return _bots.map(b => ({ id: b.id, nom: b.nom, mode: b.ia?.mode ?? '—' }));
}

function _ecart(cible, pos, angle) {
  let e = Math.atan2(cible.z - pos.z, cible.x - pos.x) - angle;
  while (e >  Math.PI) e -= 2 * Math.PI;
  while (e < -Math.PI) e += 2 * Math.PI;
  return e;
}

// Avance le long du chemin tant qu'il reste visible, jusqu'à `portee`. Viser au
// delà d'un coin ferait couper le virage à travers le mur.
function _pointAnticipe(pos, pts, portee) {
  let choix = pts[0] ?? null;
  for (const p of pts) {
    if (!lineOfSight(_nav, pos, p)) break;
    choix = p;
    if (Math.hypot(p.x - pos.x, p.z - pos.z) >= portee) break;
  }
  return choix;
}

function _changerMode(ia, mode) {
  if (ia.mode === mode) return;
  ia.mode = mode;
  ia.meilleur = Infinity;
  ia.tSansProgres = 0;
  ia.tLent = 0;
}

function _choisirMode(bot, dJoueur, ic, cj, dt) {
  const ia = bot.ia;
  if (ia.mode === 'recul') {
    ia.tRecul -= dt;
    if (ia.tRecul > 0) return;
    _changerMode(ia, 'sortie');
  }

  // Hystérésis : deux seuils différents, sinon un bot à la limite oscille
  // entre « revenir » et « repartir » à chaque frame.
  if (ia.mode === 'rejoindre') {
    if (dJoueur < _cohRadius * RELACHER_SI) _changerMode(ia, 'sortie');
    return;
  }
  if (dJoueur > _cohRadius * REJOINDRE_SI) { _changerMode(ia, 'rejoindre'); return; }

  // En groupe : avancer vers la sortie, sauf si on a trop d'avance sur le joueur
  const avance = (cj >= 0 ? _champSortie[cj] : Infinity) - (ic >= 0 ? _champSortie[ic] : Infinity);
  if (ia.mode === 'attente') {
    if (!(avance > AVANCE_ATTENTE * 0.5)) _changerMode(ia, 'sortie');
  } else if (avance > AVANCE_ATTENTE) {
    _changerMode(ia, 'attente');
  }
}

function _lancerRecul(ia, ecart) {
  ia.mode      = 'recul';
  ia.tRecul    = 0.8 + Math.random() * 0.4;
  // Le lacet ne s'inverse pas en marche arrière dans ce modèle : braquer vers
  // le but pendant qu'on recule suffit à ressortir le nez dans la bonne direction.
  ia.sensRecul = Math.abs(ecart) > 0.1 ? Math.sign(ecart) : (Math.random() < 0.5 ? -1 : 1);
  ia.tLent = ia.tContact = ia.tSansProgres = 0;
  ia.meilleur = Infinity;
}

function _blocsAutour(pos) {
  const taille = 8 * _cs;
  const c = Math.floor(pos.x / taille), r = Math.floor(pos.z / taille);
  const blocs = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const b = _blocIndex.get(`${c + dc},${r + dr}`);
      if (b) blocs.push(b);
    }
  }
  return blocs;
}

function _updateNav(joueur, dt, effetsParBot) {
  const cj = nearestWalkable(_nav, joueur.x, joueur.z);

  // Champ vers le joueur : un seul pour tous, rafraîchi trois fois par seconde,
  // et arrêté dès que les cases des bots sont réglées.
  _tChamp -= dt;
  if (_tChamp <= 0 || !_champJoueur) {
    _tChamp = 0.3;
    const cibles = new Set();
    for (const b of _bots) {
      const c = nearestWalkable(_nav, b.state.position.x, b.state.position.z);
      if (c >= 0) cibles.add(c);
    }
    _champJoueur = cj >= 0 ? distanceField(_nav, [cj], cibles) : null;
  }

  _bots.forEach((bot, n) => {
    const s = bot.state, ia = bot.ia, pos = s.position;
    const ic = nearestWalkable(_nav, pos.x, pos.z);
    const dJoueur = Math.hypot(joueur.x - pos.x, joueur.z - pos.z);

    // ---- 1. Que faire ? ----
    _choisirMode(bot, dJoueur, ic, cj, dt);

    // ---- 2. Par où ? ----
    const champ = ia.mode === 'rejoindre' ? _champJoueur : _champSortie;
    let proche, loin, auBut = false;
    if (champ && ic >= 0 && isFinite(champ[ic])) {
      const pts = descend(_nav, champ, ic, 12).map(c => waypoint(_nav, c));
      const dernier = pts[pts.length - 1];
      // But atteint : dans sa case, ou tout près du dernier point du chemin.
      // Sans ce seuil, un point plus proche que le rayon de braquage fait
      // orbiter le bot autour, vite et sans jamais s'arrêter.
      const court = pts.length < 12 && dernier
        && Math.hypot(dernier.x - pos.x, dernier.z - pos.z) < BUT_ATTEINT;
      if (pts.length === 0 || court) {
        auBut = true;
        proche = loin = dernier ?? waypoint(_nav, ic);
      } else {
        proche = _pointAnticipe(pos, pts, R_PROCHE);
        loin   = _pointAnticipe(pos, pts, R_LOIN);
      }
    } else {
      // Aucun chemin connu (map fermée, bot hors grille) : vers le joueur, à vue
      proche = loin = { x: joueur.x, z: joueur.z };
    }

    // Voie propre au bot, seulement là où le couloir est assez large
    const ip = cellIndex(_nav, proche.x, proche.z);
    if (ip >= 0 && _nav.clearance[ip] >= 2) {
      const dx = proche.x - pos.x, dz = proche.z - pos.z, l = Math.hypot(dx, dz) || 1;
      const decale = { x: proche.x - dz / l * ia.voie * _cs * 0.5, z: proche.z + dx / l * ia.voie * _cs * 0.5 };
      if (lineOfSight(_nav, pos, decale)) proche = decale;
    }
    ia.proche = proche;
    ia.loin   = loin;

    // ---- 3. Volant et pédales ----
    const eProche = _ecart(proche, pos, s.angle);
    const eLoin   = _ecart(loin, pos, s.angle);
    const v = s.speed ?? 0;
    let volant = Math.max(-1, Math.min(1, eProche / (Math.PI * 0.3)));
    let gaz;

    if (ia.mode === 'recul') {
      gaz = -1;
      volant = ia.sensRecul;
    } else if (ia.mode === 'attente' || auBut) {
      gaz = v > 0.8 ? -0.7 : 0;            // s'arrêter en gardant le cap
    } else if (Math.abs(eProche) > 1.3) {
      gaz = v > 2.5 ? -0.7 : 0.35;         // demi-tour : freiner puis tourner au pas
    } else {
      // Freiner AVANT le virage : la vitesse visée dépend du point lointain
      const vCible = (V_MAX - (V_MAX - V_MIN) * Math.min(1, Math.abs(eLoin) / 1.2)) * ia.audace;
      gaz = v > vCible + 1.5 ? -0.6 : v > vCible ? 0 : 1;
    }

    // ---- 4. Coincé ? ----
    if (ia.mode !== 'recul' && ia.mode !== 'attente' && !auBut) {
      ia.tLent = (gaz > 0.3 && v < 0.8) ? ia.tLent + dt : 0;
      const val = champ && ic >= 0 ? champ[ic] : Infinity;
      if (val < ia.meilleur - 0.5) { ia.meilleur = val; ia.tSansProgres = 0; }
      else ia.tSansProgres += dt;
      // Frotter une paroi en roulant n'est pas être coincé : seul un contact qui
      // dure ET qui ralentit justifie de reculer.
      const colle = ia.tContact > 0.6 && v < 2.5;
      if (ia.tLent > 1.0 || colle || ia.tSansProgres > 4) _lancerRecul(ia, eProche);
    }

    // ---- 5. Collisions, contre les blocs autour du BOT ----
    // (avant : seulement ceux chargés autour du joueur, et un arrêt net qui
    // collait le bot au mur pour toujours)
    const forme   = { angle: s.angle, demiLongueur: BOT_W / 2, demiLargeur: BOT_D / 2 };
    const terrain = checkTerrain(pos, _blocsAutour(pos), _cs, s.elevation ?? 0, forme, _bounds);
    if (terrain?.hardCollision && terrain.pushBack) {
      const pb = terrain.pushBack;
      pos.x += pb.x;
      pos.z += pb.z;
      if (!ia.enContact) {
        // Premier contact : un vrai rebond, une seule fois
        const r = physics.applyBounce(s.velocity, pb, _consts.restitution ?? 0.5, _consts);
        s.velocity.x = r.x * 0.9;
        s.velocity.z = r.z * 0.9;
      } else {
        // Contact prolongé : on retire seulement la vitesse qui entre dans le
        // mur, et le bot glisse le long. Rebondir à chaque frame faisait
        // dépendre la perte d'énergie de la cadence — à 144 fps le bot était
        // cloué au mur et finissait en marche arrière.
        const l = Math.hypot(pb.x, pb.z) || 1;
        const nx = pb.x / l, nz = pb.z / l;
        const vn = s.velocity.x * nx + s.velocity.z * nz;
        if (vn < 0) { s.velocity.x -= vn * nx; s.velocity.z -= vn * nz; }
      }
      ia.enContact = true;
      ia.tContact += dt;
    } else {
      ia.enContact = false;
      ia.tContact = Math.max(0, ia.tContact - dt);
    }
    // Élévation suivie : sans elle, la première rampe arrêtait le bot net.
    // Lissage rapporté au temps (calé sur 60 fps), pas à la frame.
    const kElev = 1 - Math.pow(0.7, dt * 60);
    s.elevation = (s.elevation ?? 0) + ((terrain?.elevationTarget ?? 0) - (s.elevation ?? 0)) * kElev;

    _tickBot(bot, volant, dt, effetsParBot?.[bot.id] ?? null, gaz,
      getSurfaceGrip(terrain?.softTerrain ?? null));

    // ---- 6. Rendu ----
    bot.mesh.position.set(pos.x, BOT_Y + s.elevation * _plateauH * _cs, pos.z);
    bot.mesh.rotation.y = -s.angle;
    _majLigne(bot);
  });
}

function _majLigne(bot) {
  const ia = bot.ia;
  if (!_intentions) return;
  if (!ia.ligne) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    ia.ligne = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }));
    ia.ligne.renderOrder = 5;
    _scene.add(ia.ligne);
  }
  const p = bot.state.position, a = ia.ligne.geometry.attributes.position;
  a.setXYZ(0, p.x, 1.2, p.z);
  a.setXYZ(1, ia.proche.x, 0.3, ia.proche.z);
  a.setXYZ(2, ia.loin.x,   0.3, ia.loin.z);
  a.needsUpdate = true;
  ia.ligne.material.color.setHex(COULEUR_MODE[ia.mode] ?? 0xffffff);
  ia.ligne.visible = true;
}

// Une frame de conduite — même enchaînement que server/game-loop.js.
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
    if (bot.ia?.ligne) {
      _scene?.remove(bot.ia.ligne);
      bot.ia.ligne.geometry.dispose();
      bot.ia.ligne.material.dispose();
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
  _nav = _champSortie = _champJoueur = _blocIndex = null;
}
