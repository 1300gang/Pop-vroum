// Simulation d'un véhicule sur une frame — le cœur de la conduite.
//
// Cette boucle vivait en entier dans test-v5-page.js, et le serveur en gardait
// une copie plus ancienne (pas de sauts, pas de cubes, pas d'aide couloir). Elle
// est ici une seule fois, pour le solo comme pour le serveur : c'est la règle
// « une seule implémentation de la physique ».
//
// Le module ne dessine rien et ne touche à aucun effet visuel. Il fait avancer
// l'état et RACONTE ce qui s'est passé (atterrissage, choc, frottement, poteau
// cassé, sortie de glisse…) dans un objet d'événements. Chaque page en tire ses
// étincelles, ses secousses de caméra ou, côté serveur, ce qu'elle diffuse.
//
// Contrat : aucun DOM, aucun Three.js — importable par Node.
//
//   const sim = createVehicleSim(spawn);
//   const ev  = tickVehicle(sim, inputs, world, dt, opts);
//
//   world : { blocks, blockScale, bounds, nav, consts, plateauHeight,
//             vehicleScale, cubes, poles }
//     blocks       — blocs actifs (déjà pivotés, ceux que voit la collision)
//     bounds       — clôture (boundsFromExtent) ou null
//     nav          — grille buildNavGrid() pour l'aide couloir, ou null
//     consts       — gameplay.json → physics
//     cubes        — itérable de cubes poussables { mesh: { position }, … }
//     poles        — Map clé → { mesh: { position }, bloc, gx, gz }
//   opts  : { stats, fx, assist }
//     stats        — stats normalisées { speed, grip, accel } (1 = aucun voxel)
//     fx           — effets de pouvoir subis { speedMul, gripMul, accelMul }
//     assist       — false pour couper l'aide couloir (comparaison en test)

import * as physics       from './physics.js';
import * as movables      from './movables.js';
import { checkTerrain }   from './collision.js';
import { getSurfaceGrip } from './map-generator.js';
import { assistSteering } from './steer-assist.js';

const RAMPES_PENTE = new Set(['rampe_pente', 'ramp_n', 'ramp_s', 'ramp_e', 'ramp_o']);
const FX_NEUTRES   = { speedMul: 1, gripMul: 1, accelMul: 1 };

/**
 * Carrosserie du véhicule pour les chocs : la grille voxel fait 8 × 4 cases.
 * @param {number} angle
 * @param {number} scale — taille monde d'un voxel
 */
export function bodyShape(angle, scale) {
  return { angle, demiLongueur: 8 * scale / 2, demiLargeur: 4 * scale / 2 };
}

/**
 * État de simulation d'un véhicule posé au départ.
 * @param {{ x: number, z: number, angle?: number }} spawn
 */
export function createVehicleSim(spawn) {
  return {
    car: physics.createState({ x: spawn.x, z: spawn.z, angle: spawn.angle ?? 0 }),
    terrain: { lastTerrain: null, onRamp: false, boostTimer: 0, rampTimer: 0 },
    stuckTimer:       0,
    autoReverseTimer: 0,
    // Un choc est un événement, pas un état : sans ce verrou, une voiture plaquée
    // contre un mur encaissait des dégâts à chaque frame et se désintégrait.
    enContactMur: false,
    // Ratios de voxels survivants par couleur (1 = intact)
    degats: { speed: 1, grip: 1, accel: 1 },
  };
}

/**
 * Fait avancer un véhicule d'une frame.
 *
 * @param {object} sim    — createVehicleSim()
 * @param {{ steering: number, braking?: boolean, reversing?: boolean, throttle?: number }} inputs
 * @param {object} world  — voir l'en-tête
 * @param {number} dt     — secondes
 * @param {object} opts   — voir l'en-tête
 * @returns {object} événements de la frame (voir la fin de la fonction)
 */
export function tickVehicle(sim, inputs, world, dt, opts = {}) {
  const car    = sim.car;
  const consts = world.consts;
  const ts     = sim.terrain;
  const scale  = world.blockScale ?? 1;

  const ev = {
    terrain: null,
    boostEntered: false, stickyEntered: false,
    landed: null,          // { impact, reception }
    contact: null,         // choc ou frottement contre une paroi
    poleBroken: null,      // { key, entry }
    driftCharge: null,     // tickDriftCharge()
    dec: null, driftInfo: null,
    aide: null,
    enVol: false,
  };

  // ---- Terrain sous le véhicule ----
  // La clôture seule suffit à produire un contact : on interroge donc le terrain
  // même sans bloc chargé, sinon sortir du pool rendrait la clôture inerte.
  const terrain = (world.blocks.length > 0 || world.bounds)
    ? checkTerrain(car.position, world.blocks, scale, car.elevation,
        bodyShape(car.angle, world.vehicleScale), world.bounds)
    : null;
  ev.terrain = terrain;

  if (terrain) {
    if (terrain.softTerrain === 'boost'  && ts.lastTerrain !== 'boost')  { ts.boostTimer = 1.5; ev.boostEntered = true; }
    if (terrain.softTerrain === 'sticky' && ts.lastTerrain !== 'sticky') ev.stickyEntered = true;
    // Entrée sur une bosse (arrondie ou directionnelle) → impulsion verticale
    if ((terrain.softTerrain === 'rampe_bosse' || terrain.softTerrain === 'bump')
        && ts.lastTerrain !== terrain.softTerrain) {
      physics.applyBump(car, consts.BUMP_IMPULSE ?? 2.0, car.speed, consts);
    }
    ts.lastTerrain = terrain.softTerrain;
    ts.boostTimer  = Math.max(0, ts.boostTimer - dt);
    ts.rampTimer   = Math.max(0, ts.rampTimer  - dt);
  }

  // ---- Physique verticale ----
  // La voiture épouse le relief, décolle quand le sol se dérobe, et retombe sous
  // la gravité. Hors de tout bloc, solCible = 0 : elle retombe au niveau du sol.
  const uniteElevation = (world.plateauHeight ?? 0.5) * scale;
  const solCible = (terrain?.elevationTarget ?? 0) * uniteElevation;
  const surRampe = RAMPES_PENTE.has(terrain?.softTerrain);

  const vertical = physics.tickVertical(car, solCible, dt, consts, surRampe);
  // checkTerrain raisonne en niveaux : en vol, la voiture survole les plateaux
  // plus bas qu'elle au lieu d'être bloquée par leur bordure.
  car.elevation = car.y / uniteElevation;

  if (vertical.landed) {
    ev.landed = {
      impact:    vertical.impact ?? 0,
      reception: physics.applyLandingPenalty(car, consts),
    };
  }

  const surfaceGrip = getSurfaceGrip(terrain?.softTerrain ?? null);

  // ---- Recul automatique si bloqué dans un mur ----
  // « Bloqué » = en contact ET presque à l'arrêt. Une voiture plaquée contre un
  // mur ne le touche qu'une frame sur deux (rebond, puis le moteur la renvoie
  // dedans) : remettre le compteur à zéro à chaque frame sans contact
  // l'empêchait d'atteindre le seuil, et le recul ne partait jamais. On ne le
  // remet donc à zéro que si la voiture roule vraiment. Frotter le long d'une
  // paroi à bonne vitesse ne compte pas comme bloqué.
  const vitesseBloque = consts.stuckSpeed ?? 1.0;
  if (sim.autoReverseTimer > 0) {
    sim.autoReverseTimer -= dt;
    if (sim.autoReverseTimer <= 0) sim.stuckTimer = 0;
  } else if (terrain?.hardCollision && car.speed < vitesseBloque) {
    sim.stuckTimer += dt;
    if (sim.stuckTimer > (consts.stuckThreshold ?? 0.4)) {
      sim.autoReverseTimer = consts.autoReverseDuration ?? 0.8;
      sim.stuckTimer       = 0;
    }
  } else if (car.speed >= vitesseBloque) {
    sim.stuckTimer = 0;
  }
  const isAutoReversing = sim.autoReverseTimer > 0;

  const vmaxMult = ts.boostTimer > 0 ? 1.5
                 : terrain?.softTerrain === 'sticky' ? 0.5
                 : 1.0;

  // Les pouvoirs subis se replient par-dessus, sur une valeur reconstruite à
  // chaque frame — jamais stockée, sinon l'effet se cumulerait sans fin.
  // Les dégâts ramènent la stat vers 1, c'est-à-dire vers un véhicule sans aucun
  // voxel de cette couleur : perdre tout son rouge revient à n'en avoir jamais eu.
  const fx    = opts.fx ?? FX_NEUTRES;
  const stats = opts.stats ?? { speed: 1, grip: 1, accel: 1 };
  const use   = (stat, ratio) => 1 + (stat - 1) * ratio;
  const statsNorm = {
    speed_stat: use(stats.speed, sim.degats.speed) * vmaxMult * fx.speedMul,
    grip_stat:  use(stats.grip,  sim.degats.grip)  * fx.gripMul,
    accel_stat: use(stats.accel, sim.degats.accel) * fx.accelMul,
  };

  // En l'air, plus aucune force du sol : les pneus ne poussent ni ne rattrapent,
  // le volant ne répond plus. Une petite bosse ne doit pas figer le pilotage : on
  // ne coupe qu'au-delà d'une vraie hauteur de décollage.
  const enVol = car.airborne && car.hauteurSol > (consts.AIR_CONTROL_MIN_HEIGHT ?? 0.25);
  ev.enVol = enVol;

  // Aide couloir : léger coup de volant vers le côté dégagé, avant la rampe de
  // volant pour qu'elle soit lissée comme une vraie entrée du joueur.
  const steerBrut = inputs.steering ?? 0;
  const aide = opts.assist === false
    ? null
    : assistSteering(world.nav, car, steerBrut, consts.steerAssist);
  ev.aide = aide;

  // La rampe de volant agit même en vol : la main reste sur le volant, seule la
  // réponse du véhicule est coupée.
  const steerLisse  = physics.rampSteering(car, aide?.steer ?? steerBrut, dt, consts);
  const steeringEff = enVol ? 0 : steerLisse;
  // `throttle` explicite : réservé aux bots, qui lèvent le pied ou dosent
  // l'accélérateur. Un joueur n'a que le frein et la marche arrière — le
  // serveur ne transmet d'ailleurs que ces deux-là.
  const throttle = enVol            ? 0
                 : isAutoReversing  ? -1
                 : Number.isFinite(inputs.throttle) ? inputs.throttle
                 : inputs.reversing ? -1
                 : inputs.braking   ? -0.8
                 : 1;

  if (terrain?.hardCollision && !isAutoReversing) {
    _contactParoi(sim, terrain, world, dt, ev);
  } else {
    sim.enContactMur = false;

    // Recul automatique en collision : on sort du mur avant d'appliquer les forces
    if (isAutoReversing && terrain?.hardCollision && terrain.pushBack) {
      car.position.x += terrain.pushBack.x * 2;
      car.position.z += terrain.pushBack.z * 2;
    }

    const dec       = physics.decompose(car.velocity, car.angle);
    const driftInfo = physics.detectDrift(dec, consts, statsNorm, surfaceGrip, car.drifting);
    car.drifting = enVol ? false : driftInfo.is_drifting;

    // Adhérence nulle en vol : la voiture conserve exactement son élan
    const newV = physics.computeForces(
      car, { throttle }, statsNorm, dt, consts, enVol ? 0 : driftInfo.lateralGrip,
    );
    car.velocity.x = newV.x;
    car.velocity.z = newV.z;

    // La pente agit sur le vecteur vitesse : on freine en montant, on accélère en descendant
    physics.applySlopeGravity(car, terrain?.rampe, uniteElevation, dt, consts);

    // Boost / collant : agissent sur la vitesse réelle, pas sur un plafond
    if (ts.boostTimer > 0) {
      const a = (consts.BOOST_ACCEL ?? 14) * dt;
      car.velocity.x += Math.cos(car.angle) * a;
      car.velocity.z += Math.sin(car.angle) * a;
    }
    if (terrain?.softTerrain === 'sticky') {
      const k = Math.max(0, 1 - (consts.STICKY_DRAG ?? 1.6) * dt);
      car.velocity.x *= k;
      car.velocity.z *= k;
    }

    const turnRate = physics.computeTurnRate(steeringEff, dec, driftInfo, consts);
    car.angle += turnRate * dt;

    car.position.x += car.velocity.x * dt;
    car.position.z += car.velocity.z * dt;
    car.speed = driftInfo.v_speed;

    // Récompense de sortie de glisse (façon mini-turbo)
    ev.driftCharge = physics.tickDriftCharge(car, dt, consts);
    ev.dec       = dec;
    ev.driftInfo = driftInfo;
  }

  return ev;
}

// ---- Contact avec une paroi (mur, poteau, cube, clôture) ----

function _contactParoi(sim, terrain, world, dt, ev) {
  const car    = sim.car;
  const consts = world.consts;

  // Premier frame de contact seulement : c'est le choc. Les frames suivantes sont
  // du frottement contre la paroi, pas un nouvel impact.
  const fresh = !sim.enContactMur;
  sim.enContactMur = true;

  // Pousser un cube n'est ni un rebond ni un blocage : la voiture le suit.
  const pousseCube = terrain.hardCellType === 'movable';

  if (terrain.pushBack) {
    const velocityBefore = { x: car.velocity.x, z: car.velocity.z };
    const pbLen = Math.sqrt(terrain.pushBack.x ** 2 + terrain.pushBack.z ** 2);
    const normal = pbLen > 0.001
      ? { x: terrain.pushBack.x / pbLen, z: terrain.pushBack.z / pbLen }
      : null;

    // Contre un mur : rebond. Contre un cube : on le pousse d'abord, puis la
    // voiture cale sa vitesse sur la sienne au lieu de rebondir dessus.
    const bounced = pousseCube
      ? movables.suivreCube(car.velocity, terrain.pushBack,
          _pousserCube(world, car, velocityBefore))
      : physics.applyBounce(car.velocity, terrain.pushBack, consts.restitution, consts);
    car.velocity.x = bounced.x;
    car.velocity.z = bounced.z;
    car.speed      = Math.sqrt(bounced.x ** 2 + bounced.z ** 2);
    car.position.x += terrain.pushBack.x;
    car.position.z += terrain.pushBack.z;

    if (normal) {
      // Vitesse de glissement le long de la paroi : c'est elle qui fait frotter
      const vn  = velocityBefore.x * normal.x + velocityBefore.z * normal.z;
      const vtx = velocityBefore.x - vn * normal.x;
      const vtz = velocityBefore.z - vn * normal.z;

      const dmg = physics.checkDamage(velocityBefore, bounced, normal, car.position);
      ev.contact = {
        fresh, pushingCube: pousseCube, cellType: terrain.hardCellType,
        normal, velocityBefore, tangentSpeed: Math.sqrt(vtx * vtx + vtz * vtz),
        dmg,
      };

      // Poteau cassé si le choc est fort
      if (terrain.hardCellType === 'pole') {
        ev.poleBroken = _casserPoteau(world, car, dmg.deltaSpeed);
      }
    }
  } else {
    car.velocity.x = 0;
    car.velocity.z = 0;
    car.speed      = 0;
  }

  // Appliquer la velocity rebondie à la position pour sortir du mur. Sans ça le
  // véhicule reste bloqué : pushBack seul est minuscule.
  car.position.x += car.velocity.x * dt;
  car.position.z += car.velocity.z * dt;

  // Amortissement contre un mur pour éviter les oscillations — pas en poussant
  // un cube, sinon la voiture ne le suivrait jamais. Rapporté au temps (0,92
  // par frame à 60 fps) : appliqué par frame, il freinait plus fort à 144 fps
  // et moins sur le serveur à 30 Hz qu'en solo.
  if (!pousseCube) {
    const amorti = Math.pow(0.92, dt * 60);
    car.velocity.x *= amorti;
    car.velocity.z *= amorti;
  }
  car.speed = Math.sqrt(car.velocity.x ** 2 + car.velocity.z ** 2);

  // Un choc annule la charge de dérapage : on ne récompense pas une glisse qui
  // se termine dans un mur.
  car.drifting  = false;
  car.driftTime = 0;
}

// Cube poussable le plus proche : on lui transmet l'élan. Renvoyé à l'appelant,
// qui cale la voiture sur sa vitesse.
function _pousserCube(world, car, velocityImpact) {
  const pos = car.position;
  let closest = null, distMin = Infinity;
  for (const entry of (world.cubes ?? [])) {
    const d = Math.hypot(entry.mesh.position.x - pos.x, entry.mesh.position.z - pos.z);
    if (d < distMin && d < world.blockScale * 2) { distMin = d; closest = entry; }
  }
  if (!closest) return null;

  // Direction imposée : du véhicule vers le cube. Déduite de la vitesse du
  // véhicule, elle renvoyait le cube en arrière dès qu'un rebond l'inversait.
  const direction = {
    x: closest.mesh.position.x - pos.x,
    z: closest.mesh.position.z - pos.z,
  };
  const vitesse = velocityImpact
    ? Math.sqrt(velocityImpact.x ** 2 + velocityImpact.z ** 2)
    : car.speed;
  // Le choc donne l'impulsion ; une voiture qui reste collée pousse au pas
  movables.pousser(closest, direction, vitesse,
    world.consts.CUBE_PUSH ?? 0.55, world.consts.CUBE_PUSH_CONTINU ?? 4);
  return closest;
}

// Casse le poteau le plus proche si le choc dépasse le seuil. La cellule est
// retirée de la grille : le prochain checkTerrain passe au travers.
function _casserPoteau(world, car, deltaV) {
  const seuil = world.consts.POLE_BREAK_THRESHOLD ?? 5.0;
  // deltaV vaut undefined quand le choc n'a pas causé de dégât : sans ce
  // garde-fou la comparaison est fausse et le poteau cassait au moindre frôlement.
  if (!Number.isFinite(deltaV) || deltaV < seuil || !world.poles) return null;

  const pos = car.position;
  let closest = null, distMin = Infinity;
  for (const [key, entry] of world.poles) {
    const d = Math.hypot(entry.mesh.position.x - pos.x, entry.mesh.position.z - pos.z);
    if (d < distMin && d < world.blockScale * 2) { distMin = d; closest = { key, entry }; }
  }
  if (!closest) return null;

  closest.entry.bloc.grid[closest.entry.gz][closest.entry.gx] = null;
  world.poles.delete(closest.key);
  return closest;
}
