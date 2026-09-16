// Physique du véhicule — auto-avance, virages, dérapage, freinage.
//
// Unités : distance en voxels, temps en secondes.
// Pas de moteur physique externe — logique custom PAKO-style.
//
// État d'un véhicule :
//   position   : { x, z }   — coordonnées monde (Y ignoré, vue top-down)
//   velocity   : { x, z }   — vecteur vitesse réel (E03-S01+)
//   angle      : number     — en radians, 0 = vers +X, croît dans le sens horaire
//   speed      : number     — vitesse scalaire courante (voxels/s)
//   drifting   : boolean    — true si l'on dérape actuellement
//
// Convention vectorielle (E03-S02+) :
//   forward = { cos(angle), sin(angle) }   — axe longitudinal
//   right   = { -sin(angle), cos(angle) }  — axe latéral
//
// Les coefficients tunables viennent de /config/gameplay.json → "physics".

let _config = null;

async function _chargerConfig() {
  if (_config) return _config;
  const resp = await fetch('/config/gameplay.json');
  if (!resp.ok) throw new Error('Impossible de charger /config/gameplay.json');
  const full = await resp.json();
  _config = { ...full.vehicleStats, ...full.physics };
  return _config;
}

/**
 * Pré-charge la config (optionnel — sinon chargé au premier tick).
 */
export async function init() {
  await _chargerConfig();
}

/**
 * Injecte la config sans fetch (pour usage côté serveur Node.js).
 * @param {object} cfg — objet gameplay.json complet ou merged { ...vehicleStats, ...physics }
 */
export function setConfig(cfg) {
  _config = cfg;
}

// ---- Décomposition vectorielle (E03-S02) ----

/**
 * Décompose un vecteur velocity en composantes longitudinale et latérale
 * par rapport à l'orientation du véhicule.
 *
 * @param {{ x: number, z: number }} velocity — vecteur vitesse monde
 * @param {number} angle — orientation du véhicule en radians
 * @returns {{ v_forward: number, v_lateral: number, forward: {x,z}, right: {x,z} }}
 */
export function decompose(velocity, angle) {
  const forward   = { x:  Math.cos(angle), z: Math.sin(angle) };
  const right     = { x: -Math.sin(angle), z: Math.cos(angle) };
  const v_forward = velocity.x * forward.x + velocity.z * forward.z;
  const v_lateral = velocity.x * right.x   + velocity.z * right.z;
  return { v_forward, v_lateral, forward, right };
}

// ---- Pipeline de forces vectoriel (E03-S03) ----

/**
 * Calcule la nouvelle velocity après application des trois forces du modèle :
 *   F_engine  = forward × throttle × accel_stat × engineBase
 *   F_lateral = -right  × v_lateral × grip_base × mass   (correction de glisse)
 *   F_drag    = -velocity × dragCoeff                     (frottement aérodynamique)
 *
 * Intégration Euler : a = (F_engine + F_lateral + F_drag) / mass
 *                     velocity += a × dt
 *
 * Fonction pure — pas de side-effects, testable sans navigateur.
 *
 * @param {{ velocity: {x,z}, angle: number }} state
 * @param {{ throttle: number }}  inputs  — throttle ∈ [-1, 1]
 * @param {{ speed_stat: number, grip_stat: number, accel_stat: number }} stats — normalisés [0..1+]
 * @param {number} dt — deltaTime en secondes
 * @param {{ mass, engineBase, gripBase, dragCoeff, vmaxGlobal }} consts — depuis gameplay.json
 * @param {number} [current_grip] — override du grip (fourni par S05 en mode drift)
 * @returns {{ x: number, z: number }} — nouvelle velocity
 */
export function computeForces(state, inputs, stats, dt, consts, current_grip = null) {
  const { mass, engineBase, gripBase, dragCoeff, vmaxGlobal } = consts;

  const { v_forward, v_lateral, forward, right } = decompose(state.velocity, state.angle);

  // Stats → paramètres physiques (PRD §5)
  const grip_base  = gripBase  * (stats.grip_stat  ?? 1.0);
  const vmax       = vmaxGlobal * (0.6 + (stats.speed_stat ?? 1.0) * 0.4);
  const accel_stat = stats.accel_stat ?? 1.0;

  // Grip actif : S05 passera current_grip en mode drift ; sinon grip de base
  const grip = current_grip ?? grip_base;

  // Throttle ∈ [-1, 1]
  const throttle = Math.max(-1, Math.min(1, inputs.throttle ?? 0));

  // F_engine = forward × throttle × accel_stat × ENGINE_BASE
  const Fex = forward.x * throttle * accel_stat * engineBase;
  const Fez = forward.z * throttle * accel_stat * engineBase;

  // F_lateral = -right × v_lateral × grip × mass  (S07 : réduit par transfert de poids)
  const v_speed_local = Math.sqrt(v_forward ** 2 + v_lateral ** 2);
  let grip_applied = grip;
  if (v_speed_local > 3) {
    if (throttle > 0.3)  grip_applied *= (1 - consts.accelGripTransfer * throttle);
    if (throttle < -0.5) grip_applied *= (1 - consts.brakeGripTransfer * Math.abs(throttle));
  }
  const Flx = -right.x * v_lateral * grip_applied * mass;
  const Flz = -right.z * v_lateral * grip_applied * mass;

  // F_drag = -velocity × dragCoeff
  const Fdx = -state.velocity.x * dragCoeff;
  const Fdz = -state.velocity.z * dragCoeff;

  // Intégration Euler
  const ax = (Fex + Flx + Fdx) / mass;
  const az = (Fez + Flz + Fdz) / mass;

  let vx = state.velocity.x + ax * dt;
  let vz = state.velocity.z + az * dt;

  // Plafonnement à vmax
  const v_new = Math.sqrt(vx * vx + vz * vz);
  if (v_new > vmax) {
    const scale = vmax / v_new;
    vx *= scale;
    vz *= scale;
  }

  return { x: vx, z: vz };
}

// ---- Détection drift et grip courant (E03-S05) ----

/**
 * Détecte le dérapage et calcule le grip courant.
 *
 * drift_threshold = grip_base × 1.2 × (1 + v_speed/VMAX × 0.3)
 * is_drifting     = |v_lateral| > drift_threshold && v_speed > minDriftSpeed
 * current_grip    = is_drifting ? grip_base × driftGripMultiplier : grip_base
 *
 * @param {{ v_forward: number, v_lateral: number }} dec — résultat de decompose()
 * @param {{ vmaxGlobal, gripBase, driftGripMultiplier, minDriftSpeed }} consts
 * @param {{ grip_stat: number }} stats
 * @param {number} [surface_grip=1.0] — multiplicateur de grip selon la surface (E03-S08)
 * @returns {{ is_drifting, current_grip, drift_threshold, v_speed }}
 */
export function detectDrift(dec, consts, stats, surface_grip = 1.0) {
  const { v_forward, v_lateral } = dec;
  const v_speed    = Math.sqrt(v_forward ** 2 + v_lateral ** 2);
  const grip_base  = consts.gripBase * (stats.grip_stat ?? 1.0) * surface_grip;

  const drift_threshold = grip_base * 1.2 * (1 + v_speed / consts.vmaxGlobal * 0.3);

  const is_drifting = Math.abs(v_lateral) > drift_threshold
                   && v_speed > consts.minDriftSpeed;

  const current_grip = is_drifting
    ? grip_base * consts.driftGripMultiplier
    : grip_base;

  return { is_drifting, current_grip, drift_threshold, v_speed };
}

// ---- Turn rate avec oversteer en drift (E03-S06) ----

/**
 * Calcule le turn_rate avec amplification en dérapage.
 *
 * Hors drift : turn_rate = steering × turnSpeed × clamp(|v_forward|/5, 0, 1)
 * En drift   : turn_rate ×= (1 + driftRotationBoost × |v_lateral|/v_speed)
 *
 * @param {number} steering — entrée virage ∈ [-1, 1]
 * @param {{ v_forward: number, v_lateral: number }} dec
 * @param {boolean} is_drifting
 * @param {{ turnSpeed: number, driftRotationBoost: number }} consts
 * @returns {number} — turn_rate en rad/s
 */
export function computeTurnRate(steering, dec, is_drifting, consts) {
  const { v_forward, v_lateral } = dec;
  const v_speed   = Math.max(0.01, Math.sqrt(v_forward ** 2 + v_lateral ** 2));
  const clamp     = Math.min(1, Math.max(0, Math.abs(v_forward) / 5));
  let turn_rate   = steering * consts.turnSpeed * clamp;

  if (is_drifting) {
    turn_rate *= (1 + consts.driftRotationBoost * Math.abs(v_lateral) / v_speed);
  }

  return turn_rate;
}

// ---- Rebond élastique sur mur (E03-S09) ----

/**
 * Applique un rebond élastique sur un mur (style PAKO).
 *
 * Formule :
 *   wallNormal = normalize(pushBack)   — normal sortant du mur (direction de poussée)
 *   v_dot      = dot(velocity, wallNormal)
 *   si v_dot < 0 (velocity va vers le mur) :
 *     velocity -= wallNormal × v_dot × (1 + restitution)
 *
 * La composante tangentielle est conservée ; la composante normale est inversée
 * et atténuée par le coefficient de restitution.
 *
 * Fonction pure — ne modifie pas l'état en place.
 *
 * @param {{ x: number, z: number }} velocity — vecteur vitesse courant
 * @param {{ x: number, z: number }} pushBack — vecteur de correction (normal sortant du mur)
 * @param {number} restitution — ∈ [0, 1] (0 = inélastique, 1 = parfaitement élastique)
 * @returns {{ x: number, z: number }} — nouvelle velocity après rebond
 */
export function applyBounce(velocity, pushBack, restitution) {
  const len = Math.sqrt(pushBack.x ** 2 + pushBack.z ** 2);
  if (len < 0.001) return { x: velocity.x, z: velocity.z }; // normale invalide, pas de rebond

  const nx    = pushBack.x / len;
  const nz    = pushBack.z / len;
  const v_dot = velocity.x * nx + velocity.z * nz;

  // Ne rebondit que si la velocity pointe vers le mur (v_dot < 0)
  if (v_dot >= 0) return { x: velocity.x, z: velocity.z };

  return {
    x: velocity.x - (1 + restitution) * v_dot * nx,
    z: velocity.z - (1 + restitution) * v_dot * nz,
  };
}

// ---- Seuil de dommage par choc (RACE-D01) ----

/**
 * Vérifie si un choc mur est assez violent pour endommager le véhicule.
 * Appeler APRÈS avoir appliqué le rebond (applyBounce).
 *
 * @param {{ x, z }} velocityBefore  — velocity juste avant le rebond
 * @param {{ x, z }} velocityAfter   — velocity juste après le rebond
 * @param {{ x, z }} impactNormal    — normale normalisée, pointe du mur vers le véhicule
 * @param {{ x, z }} [position]      — position au moment du choc (pour impactPoint)
 * @returns {{ damaged: boolean, deltaSpeed?, impactPoint?, impactNormal? }}
 */
export function checkDamage(velocityBefore, velocityAfter, impactNormal, position = { x: 0, z: 0 }) {
  const threshold   = _config?.DAMAGE_THRESHOLD ?? 8;
  const speedBefore = Math.sqrt(velocityBefore.x ** 2 + velocityBefore.z ** 2);
  const speedAfter  = Math.sqrt(velocityAfter.x  ** 2 + velocityAfter.z  ** 2);
  const deltaSpeed  = speedBefore - speedAfter;

  if (deltaSpeed <= threshold) return { damaged: false };

  return {
    damaged: true,
    deltaSpeed,
    impactPoint:  { x: position.x, y: 0.5, z: position.z },
    impactNormal,
  };
}

/**
 * Crée un état physique initial pour un véhicule.
 * @param {{ x, z, angle }} opts
 * @returns {{ position, angle, speed, drifting }}
 */
export function createState({ x = 0, z = 0, angle = 0, elevation = 0 } = {}) {
  return {
    position: { x, z }, velocity: { x: 0, z: 0 },
    angle, speed: 0, drifting: false, elevation,
    // V4 : état vertical réel (hauteur monde + vitesse verticale)
    y: 0, vy: 0, airborne: false, vyTerrain: 0, hauteurSol: 0,
  };
}

// ---- Physique verticale : sauts et changements de niveau (V4) ----

// Écart en dessous duquel on considère que la voiture touche encore le sol.
// Purement numérique (évite un décollage/atterrissage alterné à chaque frame).
const _TOL_SOL = 0.02;

/**
 * Donne une impulsion verticale au véhicule (bosses, RACE-C05).
 *
 * @param {object} carState — état courant (doit avoir vy, airborne)
 * @param {number} impulse  — vitesse verticale initiale en u/s (gameplay.json BUMP_IMPULSE)
 */
export function applyBump(carState, impulse, vitesse = 0, consts) {
  if (!impulse || impulse <= 0) return;   // désactivé via config
  if (carState.airborne) return;          // déjà en l'air, pas de double-saut

  // Une bosse prise au pas doit à peine secouer, prise à fond elle doit envoyer.
  const ref     = (consts ?? {}).BUMP_REF_SPEED ?? 12;
  const facteur = Math.max(0.25, Math.min(2.5, vitesse / ref));

  carState.vy       = impulse * facteur;
  carState.airborne = true;
}

/**
 * Gravité le long d'une pente, appliquée au vecteur vitesse horizontal.
 *
 * Sans ça, monter une rampe ne coûte rien et la descendre ne rapporte rien :
 * la hauteur est plaquée sur un mouvement inchangé, et le saut « singe » la
 * gravité au lieu d'en découler.
 *
 * @param {object} carState — muté en place
 * @param {{ dirX, dirZ, penteElev }} rampe — géométrie renvoyée par checkTerrain
 * @param {number} uniteElevation — unités monde par niveau d'élévation
 * @param {number} dt
 * @param {{ GRAVITY }} consts
 */
export function applySlopeGravity(carState, rampe, uniteElevation, dt, consts) {
  if (!rampe || carState.airborne) return 0;

  const pente = rampe.penteElev * uniteElevation;   // dénivelé / distance
  if (Math.abs(pente) < 0.001) return 0;

  const alpha = Math.atan(pente);
  // Composante horizontale du poids le long de la pente, pondérée : à pleine
  // gravité une pente de 26° freine à 7,2 u/s², plus du double de la poussée du
  // moteur — une voiture lente ne pouvait plus monter et redescendait en arrière.
  const cfg = consts ?? {};
  const a = (cfg.GRAVITY ?? 18) * (cfg.SLOPE_GRAVITY_FACTOR ?? 0.35) * Math.sin(alpha) * Math.cos(alpha);

  carState.velocity.x -= rampe.dirX * a * dt;
  carState.velocity.z -= rampe.dirZ * a * dt;
  return a;
}

/**
 * Pénalité de réception : retomber de travers coûte de la vitesse et laisse la
 * voiture en glissade ; retomber dans l'axe ne coûte presque rien.
 *
 * Le désalignement est la part de la vitesse qui est latérale au moment de
 * toucher le sol : 0 = parfaitement dans l'axe, 1 = complètement en travers.
 *
 * @param {object} carState — muté en place
 * @param {{ LAND_ALIGN_TOLERANCE, LAND_MAX_SPEED_LOSS }} consts
 * @returns {{ desalignement: number, perte: number }}
 */
export function applyLandingPenalty(carState, consts) {
  const cfg       = consts ?? {};
  const tolerance = cfg.LAND_ALIGN_TOLERANCE ?? 0.15;
  const perteMax  = cfg.LAND_MAX_SPEED_LOSS  ?? 0.45;

  const vitesse = Math.sqrt(carState.velocity.x ** 2 + carState.velocity.z ** 2);
  if (vitesse < 0.01) return { desalignement: 0, perte: 0 };

  const { v_lateral } = decompose(carState.velocity, carState.angle);
  const desalignement = Math.min(1, Math.abs(v_lateral) / vitesse);
  if (desalignement <= tolerance) return { desalignement, perte: 0 };

  const perte = perteMax * (desalignement - tolerance) / (1 - tolerance);
  carState.velocity.x *= (1 - perte);
  carState.velocity.z *= (1 - perte);
  carState.drifting = true;   // la réception part en glissade

  return { desalignement, perte };
}

/**
 * Met à jour la hauteur du véhicule pour une frame.
 *
 * Au sol, la voiture épouse le relief et mémorise la vitesse verticale que
 * celui-ci lui imprime. Quand le sol se dérobe (haut d'une rampe tremplin,
 * bord de plateau), elle décolle avec cet élan puis retombe sous la gravité :
 * c'est ce qui permet de changer de niveau. Sur une rampe, en revanche, on
 * suit la pente au lieu de décoller — une rampe est un raccord, pas un saut.
 *
 * @param {object} carState — muté en place
 * @param {number} solCible — hauteur du terrain sous le véhicule (unités monde)
 * @param {number} dt       — deltaTime en secondes
 * @param {{ GRAVITY, RAMP_LAUNCH_FACTOR, JUMP_MAX_LAUNCH_VY }} consts
 * @param {boolean} [surRampe=false] — le véhicule est sur une cellule de rampe
 * @returns {{ landed: boolean, launched: boolean }}
 */
export function tickVertical(carState, solCible, dt, consts, surRampe = false) {
  // consts peut être null tant que /config/gameplay.json n'est pas chargé
  const cfg      = consts ?? {};
  const gravite  = cfg.GRAVITY ?? 18;
  const facteur  = cfg.RAMP_LAUNCH_FACTOR ?? 1.0;
  const vyMax    = cfg.JUMP_MAX_LAUNCH_VY ?? 12;

  if (carState.airborne) {
    carState.vy -= gravite * dt;
    carState.y  += carState.vy * dt;

    if (carState.y <= solCible) {
      const impact       = Math.abs(carState.vy);
      carState.y         = solCible;
      carState.vy        = 0;
      carState.airborne  = false;
      carState.vyTerrain = 0;
      carState.hauteurSol = 0;
      return { landed: true, launched: false, impact };
    }
    carState.hauteurSol = carState.y - solCible;
    return { landed: false, launched: false, impact: 0 };
  }

  // Au sol : le sol se dérobe-t-il sous la voiture ?
  if (solCible < carState.y - _TOL_SOL && !surRampe) {
    carState.airborne = true;
    // On repart avec l'élan vertical accumulé pendant la montée (jamais vers le bas :
    // une chute part de zéro, la gravité fait le reste).
    carState.vy = Math.min(vyMax, Math.max(0, carState.vyTerrain) * facteur);

    // La vitesse verticale est prise SUR l'horizontale, elle ne s'y ajoute pas :
    // un gros saut coûte de l'élan, exactement comme sur un vrai tremplin.
    const vH = Math.sqrt(carState.velocity.x ** 2 + carState.velocity.z ** 2);
    if (vH > 0.01) {
      const reste = Math.sqrt(Math.max(0, vH * vH - carState.vy * carState.vy));
      const k = reste / vH;
      carState.velocity.x *= k;
      carState.velocity.z *= k;
    }

    return { landed: false, launched: carState.vy > 0, impact: 0 };
  }

  // Sinon on épouse le relief, en mémorisant la vitesse verticale qu'il imprime.
  // Cette mémoire décroît à la vitesse de la gravité — comme le ferait un projectile —
  // pour survivre aux quelques frames où le véhicule chevauche encore la rampe en la
  // quittant, sans pour autant persister après une longue portion plate.
  const vyTerrain = dt > 0 ? (solCible - carState.y) / dt : 0;
  carState.vyTerrain = Math.max(
    0,
    Math.min(vyMax, vyTerrain),
    carState.vyTerrain - gravite * dt,
  );
  carState.y          = solCible;
  carState.hauteurSol = 0;
  return { landed: false, launched: false, impact: 0 };
}

/**
 * Calcule le nouvel état pour une frame.
 *
 * @param {object} state      — état courant (muté en place ET retourné)
 * @param {object} vehicleStats — { speed: maxSpeed, grip, accel } issus de voxel/stats
 * @param {{ steering: number, braking: number }} inputs
 * @param {number} dt         — deltaTime en secondes
 * @returns {object}          — le même état mis à jour
 */
export function tick(state, vehicleStats, inputs, dt, modifiers = {}) {
  if (!_config) return state; // config pas encore chargée

  const cfg       = _config;
  // maxSpeedMultiplier : 0.5 sticky | 1.3 ramp | 1.5 boost
  const maxSpeed  = vehicleStats.speed * (modifiers.maxSpeedMultiplier ?? 1);
  const grip      = vehicleStats.grip;
  const accelStat = vehicleStats.accel;

  // ---- Vitesse ----
  const accelRate = cfg.accelRate * (accelStat / cfg.baseAccel);
  const maxReverse = -maxSpeed * 0.4; // marche arrière limitée à 40% de la vitesse max

  // SOLO-03 : marche arrière activable avant l'arrêt complet
  const reverseThreshold = cfg.REVERSE_SPEED_THRESHOLD ?? 0.1;
  if (inputs.reversing) {
    if (state.speed > reverseThreshold) {
      state.speed = Math.max(0, state.speed - cfg.brakingDecel * dt);
    } else {
      state.speed = Math.max(maxReverse, state.speed - accelRate * 0.5 * dt);
    }
  } else if (inputs.braking) {
    // Freinage (vers 0 seulement, ne passe pas en négatif)
    state.speed = Math.max(0, state.speed - cfg.brakingDecel * dt);
  } else {
    // Accélération vers maxSpeed
    if (state.speed < maxSpeed) {
      state.speed = Math.min(maxSpeed, state.speed + accelRate * dt);
    }
    // Si on était en marche arrière et qu'on relâche tout : retour progressif vers 0
    if (state.speed < 0) {
      state.speed = Math.min(0, state.speed + cfg.brakingDecel * 0.5 * dt);
    }
    // Décélération naturelle légère (résistance à l'air, en marche avant seulement)
    if (state.speed > 0) {
      state.speed = Math.max(0, state.speed - cfg.naturalDecel * dt * 0.1);
    }
  }

  // ---- Rotation ----
  // angularVelocity = steering × turnRate × grip_normalisé
  const gripNorm = grip / cfg.baseGrip; // 1.0 à plein grip de base
  const angularVelocity = inputs.steering * cfg.turnRate * Math.sqrt(gripNorm);

  // Dérapage : si rotation trop forte par rapport au grip
  const driftSeuil = cfg.driftThreshold / Math.max(0.5, gripNorm);
  state.drifting = Math.abs(angularVelocity) * (state.speed / Math.max(1, maxSpeed)) > driftSeuil;

  // En dérapage : vitesse réduite par frottement latéral
  if (state.drifting) {
    state.speed *= Math.pow(cfg.driftFriction, dt * 60);
  }

  // Appliquer la rotation (proportionnelle à la vitesse pour éviter de pivoter sur place)
  const speedRatio = Math.min(1, state.speed / Math.max(1, maxSpeed * 0.3));
  state.angle += angularVelocity * speedRatio * dt;

  // ---- Déplacement ----
  // Avance selon l'angle courant
  state.position.x += Math.sin(state.angle) * state.speed * dt;
  state.position.z += Math.cos(state.angle) * state.speed * dt;

  // Bloc dur : arrêt complet (le push-back de position est appliqué par l'appelant)
  if (modifiers.hardStop) state.speed = 0;

  return state;
}
