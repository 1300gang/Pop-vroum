// Cerveau des bots : navigation dans le labyrinthe et choix des commandes.
//
// Séparé de game/bot.js (le rendu, côté navigateur) pour que le serveur puisse
// faire rouler des bots de test dans un vrai match. Le cerveau ne conduit pas
// lui-même : il décide volant et pédales, puis la voiture roule avec
// game/vehicle-tick.js, exactement comme celle d'un joueur.
//
// Comportement (mesuré le 23/09 : 100 % des bots traversent un 4×4 ou un 8×8) :
// les bots descendent des « champs de distance » (game/navigation.js), vont vers
// la sortie, reviennent quand le joueur s'éloigne, l'attendent quand ils sont
// trop en avance, freinent avant les virages et reculent quand ils sont coincés.
//
// Contrat : aucun DOM, aucun Three.js — importable par Node.

import {
  buildNavGrid, nearestWalkable, waypoint, distanceField, descend, lineOfSight, cellIndex,
} from './navigation.js';

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

/**
 * Navigation partagée par tous les bots d'une map.
 * @param {object} map — MapData
 * @param {{ exit?: {x,z} }} [opts]
 */
export function createBotNav(map, opts = {}) {
  const nav = buildNavGrid(map);
  const e   = opts.exit ?? map.exit?.worldCenter ?? map.finishPosition;
  return {
    nav,
    cs:          map.blockScale ?? 2,
    blocIndex:   new Map(map.blocks.map(b => [`${b.col},${b.row}`, b])),
    champSortie: distanceField(nav, [nearestWalkable(nav, e.x, e.z)]),
    champJoueur: null,   // distance au joueur — partagé par tous les bots
    tChamp:      0,      // délai avant le prochain rafraîchissement
  };
}

/** État de décision d'un bot ; `n` = son rang, qui fixe sa voie et son audace. */
export function createBotIA(n) {
  return {
    mode: 'sortie', tRecul: 0, sensRecul: 1,
    tLent: 0, tContact: 0, tSansProgres: 0, meilleur: Infinity,
    voie: VOIES[n % VOIES.length], audace: AUDACES[n % AUDACES.length],
    proche: null, loin: null,
  };
}

/**
 * Rafraîchit le champ « distance au joueur », trois fois par seconde, et
 * s'arrête dès que les cases des bots sont réglées.
 * @param {object} bn — createBotNav()
 * @param {{x,z}} joueur
 * @param {Array<{x,z}>} positionsBots
 * @param {number} dt
 */
export function refreshPlayerField(bn, joueur, positionsBots, dt) {
  bn.tChamp -= dt;
  if (bn.tChamp > 0 && bn.champJoueur) return;
  bn.tChamp = 0.3;
  const cj = nearestWalkable(bn.nav, joueur.x, joueur.z);
  const cibles = new Set();
  for (const p of positionsBots) {
    const c = nearestWalkable(bn.nav, p.x, p.z);
    if (c >= 0) cibles.add(c);
  }
  bn.champJoueur = cj >= 0 ? distanceField(bn.nav, [cj], cibles) : null;
}

/**
 * Blocs autour d'une position (3×3) : chaque bot entre en collision avec ce
 * qui l'entoure LUI, pas avec les blocs chargés autour du joueur.
 */
export function blocksAround(bn, pos) {
  const taille = 8 * bn.cs;
  const c = Math.floor(pos.x / taille), r = Math.floor(pos.z / taille);
  const blocs = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const b = bn.blocIndex.get(`${c + dc},${r + dr}`);
      if (b) blocs.push(b);
    }
  }
  return blocs;
}

/**
 * Décide volant et pédales d'un bot pour cette frame.
 * @param {object} bn     — createBotNav()
 * @param {object} ia     — createBotIA()
 * @param {object} car    — voiture du bot (sim.car)
 * @param {{x,z}}  joueur — position de celui que le groupe accompagne
 * @param {number} cohRadius
 * @param {number} dt
 * @returns {{ steering: number, throttle: number }}
 */
export function decideInputs(bn, ia, car, joueur, cohRadius, dt) {
  const { nav } = bn;
  const pos = car.position;
  const cj  = nearestWalkable(nav, joueur.x, joueur.z);
  const ic  = nearestWalkable(nav, pos.x, pos.z);
  const dJoueur = Math.hypot(joueur.x - pos.x, joueur.z - pos.z);

  // ---- 1. Que faire ? ----
  _choisirMode(bn, ia, dJoueur, ic, cj, cohRadius, dt);

  // ---- 2. Par où ? ----
  const champ = ia.mode === 'rejoindre' ? bn.champJoueur : bn.champSortie;
  let proche, loin, auBut = false;
  if (champ && ic >= 0 && isFinite(champ[ic])) {
    const pts = descend(nav, champ, ic, 12).map(c => waypoint(nav, c));
    const dernier = pts[pts.length - 1];
    // But atteint : dans sa case, ou tout près du dernier point du chemin.
    // Sans ce seuil, un point plus proche que le rayon de braquage fait
    // orbiter le bot autour, vite et sans jamais s'arrêter.
    const court = pts.length < 12 && dernier
      && Math.hypot(dernier.x - pos.x, dernier.z - pos.z) < BUT_ATTEINT;
    if (pts.length === 0 || court) {
      auBut = true;
      proche = loin = dernier ?? waypoint(nav, ic);
    } else {
      proche = _pointAnticipe(nav, pos, pts, R_PROCHE);
      loin   = _pointAnticipe(nav, pos, pts, R_LOIN);
    }
  } else {
    // Aucun chemin connu (map fermée, bot hors grille) : vers le joueur, à vue
    proche = loin = { x: joueur.x, z: joueur.z };
  }

  // Voie propre au bot, seulement là où le couloir est assez large
  const ip = cellIndex(nav, proche.x, proche.z);
  if (ip >= 0 && nav.clearance[ip] >= 2) {
    const dx = proche.x - pos.x, dz = proche.z - pos.z, l = Math.hypot(dx, dz) || 1;
    const decale = { x: proche.x - dz / l * ia.voie * bn.cs * 0.5, z: proche.z + dx / l * ia.voie * bn.cs * 0.5 };
    if (lineOfSight(nav, pos, decale)) proche = decale;
  }
  ia.proche = proche;
  ia.loin   = loin;

  // ---- 3. Volant et pédales ----
  const eProche = _ecart(proche, pos, car.angle);
  const eLoin   = _ecart(loin, pos, car.angle);
  const v = car.speed ?? 0;
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

  return { steering: volant, throttle: gaz };
}

/**
 * Mémoire de contact, à appeler après la frame de conduite. Plaquée contre un
 * mur, une voiture ne le touche qu'une frame sur deux (rebond puis retour) :
 * la mémoire s'use donc deux fois moins vite qu'elle ne se remplit, sinon elle
 * ne dépasserait jamais le seuil de « collé ».
 * @param {object} ia
 * @param {boolean} enContact
 * @param {number} dt
 */
export function noteContact(ia, enContact, dt) {
  ia.tContact = enContact ? ia.tContact + dt : Math.max(0, ia.tContact - dt * 0.5);
}

// ---- Interne ----

function _ecart(cible, pos, angle) {
  let e = Math.atan2(cible.z - pos.z, cible.x - pos.x) - angle;
  while (e >  Math.PI) e -= 2 * Math.PI;
  while (e < -Math.PI) e += 2 * Math.PI;
  return e;
}

// Avance le long du chemin tant qu'il reste visible, jusqu'à `portee`. Viser au
// delà d'un coin ferait couper le virage à travers le mur.
function _pointAnticipe(nav, pos, pts, portee) {
  let choix = pts[0] ?? null;
  for (const p of pts) {
    if (!lineOfSight(nav, pos, p)) break;
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

function _choisirMode(bn, ia, dJoueur, ic, cj, cohRadius, dt) {
  if (ia.mode === 'recul') {
    ia.tRecul -= dt;
    if (ia.tRecul > 0) return;
    _changerMode(ia, 'sortie');
  }

  // Hystérésis : deux seuils différents, sinon un bot à la limite oscille
  // entre « revenir » et « repartir » à chaque frame.
  if (ia.mode === 'rejoindre') {
    if (dJoueur < cohRadius * RELACHER_SI) _changerMode(ia, 'sortie');
    return;
  }
  if (dJoueur > cohRadius * REJOINDRE_SI) { _changerMode(ia, 'rejoindre'); return; }

  // En groupe : avancer vers la sortie, sauf si on a trop d'avance sur le joueur
  const avance = (cj >= 0 ? bn.champSortie[cj] : Infinity) - (ic >= 0 ? bn.champSortie[ic] : Infinity);
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
