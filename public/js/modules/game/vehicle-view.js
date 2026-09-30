// Rendu d'un véhicule et de ses effets de conduite : roulis, cabrage/plongée,
// écrasement à l'atterrissage, tangage en vol, traces de pneus, poussière de
// glisse, étincelles contre les murs, voxels arrachés.
//
// Sorti de test-v5-page.js pour que la page de jeu montre chaque voiture — la
// sienne comme celles des autres — exactement comme le banc d'essai.
// Côté client uniquement (Three.js). Les modules skid et particles doivent
// avoir été initialisés sur la scène par la page.
//
//   const view = createVehicleView(scene, vehicule, { scale, dustColor });
//   updateVehicleView(view, etat, dt, { consts, effets });   // chaque frame
//   viewLanding / viewWallContact / viewDamage              // sur événement
//
// etat : { position: {x,z}, y, vy, angle, velocity: {x,z}, speed, drifting, airborne }

import { buildVehicleGroup, disposeVehicleGroup, applyRoll, applyPitch, kickSquash, applySquash }
  from '../voxel/renderer.js';
import { decompose } from './physics.js';
import * as skid      from './skid.js';
import * as particles from './particles.js';

const ECHELLE_DEFAUT = 0.28;

/**
 * @param {THREE.Scene} scene
 * @param {object} vehicule — { grid, wheelPositions }
 * @param {{ scale?: number, dustColor?: string }} [opts]
 */
export function createVehicleView(scene, vehicule, opts = {}) {
  const view = {
    scene,
    vehicule,
    scale:     opts.scale ?? ECHELLE_DEFAUT,
    dustColor: opts.dustColor ?? '#c8b89a',
    group:     null,
    vfwdPrec:  0,
    accelLissee: 0,
  };
  _construire(view);
  return view;
}

/** Hauteur du centre du véhicule au-dessus du sol, proportionnelle à sa taille. */
export function bodyHeight(view) {
  return 0.4 * view.scale / ECHELLE_DEFAUT;
}

/** Change la taille du véhicule (curseur « Gabarit » de test-v5). */
export function setVehicleScale(view, scale) {
  view.scale = scale;
  view.group?.scale.setScalar(scale);
}

/**
 * Reconstruit le mesh après une perte de voxels (vehicule.grid déjà mis à jour).
 * Géométries et matériaux sont partagés entre véhicules (voxel/renderer.js) :
 * on détache le groupe sans les détruire.
 */
export function rebuildVehicleView(view, vehicule = view.vehicule) {
  const ancien = view.group;
  view.vehicule = vehicule;
  _construire(view);
  if (ancien) {
    view.group.position.copy(ancien.position);
    view.group.rotation.copy(ancien.rotation);
    disposeVehicleGroup(ancien);
  }
}

/**
 * Place le véhicule et anime sa caisse pour une frame.
 * @param {object} view
 * @param {object} s — état du véhicule (voir l'en-tête)
 * @param {number} dt
 * @param {{ consts?: object, effets?: boolean, vLat?: number, vFwd?: number }} [opts]
 *   effets : particules, traces et cabrage (touche E de test-v5) ;
 *   vLat / vFwd : composantes déjà calculées par l'appelant, sinon déduites ici
 */
export function updateVehicleView(view, s, dt, opts = {}) {
  const g      = view.group;
  const consts = opts.consts ?? null;
  const effets = opts.effets ?? true;

  let { vLat, vFwd } = opts;
  if (vLat === undefined || vFwd === undefined) {
    const dec = decompose(s.velocity, s.angle);
    vLat ??= dec.v_lateral;
    vFwd ??= dec.v_forward;
  }

  g.position.set(s.position.x, bodyHeight(view) + (s.y ?? 0), s.position.z);
  g.rotation.y = -s.angle;
  // Axe 'x' : rotation.y = -angle (véhicule face +X)
  applyRoll(g, vLat, dt, 'x', consts);

  // Cabre à l'accélération, plonge au freinage. En l'air la caisse revient à
  // plat, le tangage de vol est porté par le groupe.
  const accelBrute = dt > 0 ? (vFwd - view.vfwdPrec) / dt : 0;
  view.vfwdPrec     = vFwd;
  view.accelLissee += (accelBrute - view.accelLissee) * (consts?.pitchSmoothing ?? 0.15);
  applyPitch(g, (effets && !s.airborne) ? view.accelLissee : 0, dt, 'x', consts);
  applySquash(g, dt, consts);

  // Le capot se lève au décollage et pique en chute. Sans ça, une voiture qui
  // reste plate en l'air se lit comme un sol qui monte.
  const pitchCible = s.airborne
    ? Math.max(-0.5, Math.min(0.5, (s.vy ?? 0) * (consts?.PITCH_FACTOR ?? 0.12)))
    : 0;
  g.rotation.z += (pitchCible - g.rotation.z) * 0.25;

  if (!effets || !s.drifting || !(s.speed > 0.5)) return;

  // Traces de pneus et poussière de glisse
  const nx = s.velocity.x / s.speed;
  const nz = s.velocity.z / s.speed;
  skid.emit(
    { x: s.position.x - nx * 0.6, z: s.position.z - nz * 0.6 },
    s.velocity,
    Math.abs(vLat),
  );
  if (s.speed > 5 && Math.random() < 0.12) {
    particles.emitDust(
      { x: s.position.x - nx * 0.7, y: 0.15, z: s.position.z - nz * 0.7 },
      s.velocity,
      view.dustColor,
      1 + Math.floor(Math.random() * 2),
    );
  }
}

/** Atterrissage : la caisse s'écrase, la poussière s'envole. */
export function viewLanding(view, s, impact, consts = null) {
  kickSquash(view.group, impact, consts);
  particles.emitLanding({ x: s.position.x, y: (s.y ?? 0) + 0.1, z: s.position.z }, 8);
}

/**
 * Frottement contre une paroi : étincelles au taux par seconde, pour ne pas
 * dépendre du framerate. Rien sous la vitesse de glissement minimale.
 * @param {{x,z}} normal — normale sortante de la paroi
 * @param {number} tangentSpeed — vitesse de glissement le long de la paroi
 */
export function viewWallContact(view, s, normal, tangentSpeed, dt, consts = null) {
  const seuil = consts?.scrapeMinSpeed ?? 2.0;
  if (!(tangentSpeed > seuil)) return;
  const attendu = (consts?.scrapeSparkRate ?? 25) * dt * (tangentSpeed / seuil);
  const nb = Math.floor(attendu) + (Math.random() < attendu % 1 ? 1 : 0);
  if (nb > 0) particles.emitSparks(
    { x: s.position.x - normal.x * 0.5, y: 0.3, z: s.position.z - normal.z * 0.5 },
    normal, nb,
  );
}

/**
 * Voxels arrachés : un mini-cube de leur couleur chacun, une gerbe
 * d'étincelles, puis le mesh est reconstruit (vehicule.grid déjà mis à jour).
 * @param {Array<{y, color}>} removedVoxels
 * @param {{x,z}|null} normal — normale du mur percuté, si connue
 * @param {Object<string,string>} couleurs — nom de couleur → hex CSS
 */
export function viewDamage(view, s, removedVoxels, normal, couleurs) {
  for (const rv of removedVoxels) {
    particles.emit(
      { x: s.position.x, y: 0.5 + rv.y * view.scale, z: s.position.z },
      couleurs?.[rv.color] ?? '#ffffff',
      1,
    );
  }
  if (normal) particles.emitSparks({ x: s.position.x, y: 0.5, z: s.position.z }, normal, 12);
  rebuildVehicleView(view);
}

/** Retire le véhicule de la scène (ressources partagées conservées). */
export function disposeVehicleView(view) {
  if (view.group) disposeVehicleGroup(view.group);
  view.group = null;
}

function _construire(view) {
  view.group = buildVehicleGroup(view.vehicule);
  view.group.scale.setScalar(view.scale);
  view.scene.add(view.group);
}
