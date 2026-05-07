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

/**
 * Crée un état physique initial pour un véhicule.
 * @param {{ x, z, angle }} opts
 * @returns {{ position, angle, speed, drifting }}
 */
export function createState({ x = 0, z = 0, angle = 0 } = {}) {
  return { position: { x, z }, velocity: { x: 0, z: 0 }, angle, speed: 0, drifting: false };
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

  if (inputs.reversing) {
    // Marche arrière : freine d'abord, puis recule
    if (state.speed > 0) {
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
