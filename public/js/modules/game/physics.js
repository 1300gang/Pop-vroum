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

// ---- Courbe de pneu et bandes de stats ----

/**
 * Rendement d'adhérence en fonction de l'angle de dérive (courbe de pneu simplifiée).
 *
 * Monte jusqu'à un pic à s = 1 (l'angle de dérive optimal), puis redescend
 * doucement vers un plancher. C'est cette redescente progressive — au lieu d'une
 * chute brutale — qui rend la glisse pilotable : passé le pic on perd de
 * l'adhérence sans la perdre toute, donc la voiture se rattrape au lieu de partir
 * en toupie. L'ancien modèle n'avait que deux états (collé / 20 % d'adhérence),
 * d'où une conduite soit sur rails, soit ingérable.
 *
 * @param {number} s — angle de dérive normalisé (1 = pic)
 * @param {number} tailFloor — adhérence résiduelle en glisse extrême
 * @returns {number} rendement ∈ [0, 1]
 */
export function tireCurve(s, tailFloor = 0.55) {
  if (s <= 0) return 0;
  const forme = 2 * s / (1 + s * s);            // pic exactement à s = 1
  return Math.max(forme, tailFloor * Math.min(1, s));
}

/**
 * Ramène une stat brute issue du scan dans une bande utilisable.
 *
 * Les stats brutes ne sont pas bornées : une voiture très verte sort un grip_stat
 * autour de 10, ce qui multipliait l'adhérence par dix et rendait tout équilibrage
 * impossible. La saturation garde un écart lisible entre véhicules sans jamais
 * devenir absurde.
 *
 * @param {number} brut — stat normalisée (1 = aucun voxel de cette couleur)
 * @param {number} min — valeur pour un véhicule sans voxel de la couleur
 * @param {number} max — asymptote pour un véhicule saturé
 * @param {number} demi — valeur brute qui atteint la moitié de la bande
 */
export function bandeStat(brut, min, max, demi = 3) {
  const v = Math.max(0, (brut ?? 1) - 1);
  return min + (max - min) * (v / (v + demi));
}

// ---- Pipeline de forces vectoriel ----

/**
 * Calcule la nouvelle velocity pour une frame.
 *
 * Trois accélérations, toutes exprimées directement en u/s². La masse a disparu :
 * elle se simplifiait déjà des deux côtés dans l'ancien modèle, la garder ne
 * faisait qu'obscurcir le réglage.
 *   - moteur   : le long de forward
 *   - latérale : bornée par la courbe de pneu — c'est elle qui autorise la glisse
 *   - traînée  : roulement constant + aéro quadratique
 *
 * Fonction pure — pas de side-effects, testable sans navigateur.
 *
 * @param {{ velocity: {x,z}, angle: number }} state
 * @param {{ throttle: number }}  inputs  — throttle ∈ [-1, 1]
 * @param {{ speed_stat: number, grip_stat: number, accel_stat: number }} stats
 * @param {number} dt — deltaTime en secondes
 * @param {object} consts — /config/gameplay.json → physics
 * @param {number|null} lateralGrip — adhérence latérale en u/s² (detectDrift.lateralGrip).
 *                                    0 en vol, null = adhérence au pic.
 * @returns {{ x: number, z: number }} — nouvelle velocity
 */
export function computeForces(state, inputs, stats, dt, consts, lateralGrip = null) {
  const { v_forward, v_lateral, forward, right } = decompose(state.velocity, state.angle);
  const v_speed = Math.sqrt(state.velocity.x ** 2 + state.velocity.z ** 2);

  const vmax = consts.vmaxGlobal * bandeStat(
    stats.speed_stat, consts.speedStatMin ?? 0.78, consts.speedStatMax ?? 1.3,
  );
  const accelMax = (consts.engineAccel ?? 16) * bandeStat(
    stats.accel_stat, consts.accelStatMin ?? 0.7, consts.accelStatMax ?? 1.4,
  );

  const throttle = Math.max(-1, Math.min(1, inputs.throttle ?? 0));

  // ---- Moteur ----
  // Pas de plafond dur : c'est la traînée qui arrête la montée en vitesse (plus bas).
  let aLong;
  if (throttle >= 0) {
    aLong = accelMax * throttle;
  } else if (v_forward > 0.5) {
    aLong = (consts.brakeAccel ?? 24) * throttle;      // throttle négatif = freinage franc
  } else {
    aLong = (consts.reverseAccel ?? 7) * throttle;     // puis marche arrière
  }

  // ---- Adhérence latérale ----
  let aLatMag = lateralGrip ?? (consts.gripAccel ?? 22);
  // Transfert de poids : accélérer allège l'avant, freiner allège l'arrière.
  if (v_speed > 3) {
    if (throttle > 0.3)  aLatMag *= (1 - (consts.accelGripTransfer ?? 0.15) * throttle);
    if (throttle < -0.5) aLatMag *= (1 - (consts.brakeGripTransfer ?? 0.20) * Math.abs(throttle));
  }
  // On ne peut pas effacer plus de glisse qu'il n'y en a : sans ce plafond, une
  // adhérence forte inverserait le signe de v_lateral à chaque frame (tremblement).
  const aLatDispo = Math.abs(v_lateral) / Math.max(dt, 1e-4);
  const aLat      = -Math.sign(v_lateral) * Math.min(aLatMag, aLatDispo);

  // ---- Traînée ----
  // L'aéro est calée pour que la vitesse d'équilibre tombe exactement sur vmax :
  // le stat de vitesse fixe donc le palier, le stat d'accélération le temps pour
  // l'atteindre. Lâcher l'accélérateur ralentit vraiment, ce qui n'était pas le
  // cas avant (la traînée valait 0,08 u/s², soit rien).
  const rolling = consts.rollingResist ?? 1.6;
  const aero    = Math.max(0, accelMax - rolling) / (vmax * vmax);
  let aDragX = 0, aDragZ = 0;
  if (v_speed > 0.01) {
    const magnitude = Math.min(
      rolling + aero * v_speed * v_speed,
      v_speed / Math.max(dt, 1e-4),          // la traînée ne doit jamais inverser la vitesse
    );
    aDragX = -state.velocity.x / v_speed * magnitude;
    aDragZ = -state.velocity.z / v_speed * magnitude;
  }

  // ---- Intégration Euler ----
  let vx = state.velocity.x + (forward.x * aLong + right.x * aLat + aDragX) * dt;
  let vz = state.velocity.z + (forward.z * aLong + right.z * aLat + aDragZ) * dt;

  // Plafond de sécurité : la traînée fixe déjà le palier, ce clamp ne sert qu'en
  // cas de cumul anormal (boost, pente descendante, rebond).
  const plafond = vmax * (consts.vmaxOverhead ?? 1.25);
  const v_new   = Math.sqrt(vx * vx + vz * vz);
  if (v_new > plafond) {
    vx *= plafond / v_new;
    vz *= plafond / v_new;
  }

  return { x: vx, z: vz };
}

// ---- Angle de dérive, adhérence courante et détection de drift ----

/**
 * Mesure l'angle de dérive et en déduit l'adhérence latérale disponible.
 *
 * L'angle de dérive (slip angle) est l'écart entre là où la voiture pointe et là
 * où elle va réellement. C'est la grandeur juste pour ce modèle : bornée à 90° et
 * indépendante de la vitesse, contrairement à l'ancien seuil qui comparait une
 * vitesse latérale absolue à une valeur qu'elle n'atteignait jamais — le drift ne
 * se déclenchait donc littéralement jamais.
 *
 * `is_drifting` ne pilote plus la physique (la courbe de pneu s'en charge en
 * continu) : c'est devenu un simple drapeau d'affichage pour la fumée, les traces
 * et l'inclinaison. Il a une hystérésis pour ne pas clignoter à la frontière.
 *
 * @param {{ v_forward: number, v_lateral: number }} dec — résultat de decompose()
 * @param {object} consts — /config/gameplay.json → physics
 * @param {{ grip_stat: number }} stats
 * @param {number} [surface_grip=1.0] — multiplicateur selon la surface (collant, boost)
 * @param {boolean} [prevDrifting=false] — état de la frame précédente (hystérésis)
 * @returns {{ is_drifting, slip, slipDeg, gripFactor, gripAccel, lateralGrip, v_speed, drift_threshold }}
 */
export function detectDrift(dec, consts, stats, surface_grip = 1.0, prevDrifting = false) {
  const { v_forward, v_lateral } = dec;
  const v_speed = Math.sqrt(v_forward ** 2 + v_lateral ** 2);

  // Le plancher sur v_forward évite un angle qui explose à l'arrêt ou juste après
  // un rebond, là où la notion de dérive n'a pas de sens.
  const slip    = v_speed < 0.05
    ? 0
    : Math.atan2(Math.abs(v_lateral), Math.max(Math.abs(v_forward), 0.5));
  const slipDeg = slip * 180 / Math.PI;

  const peakDeg    = consts.slipPeakDeg ?? 10;
  const gripFactor = tireCurve(slipDeg / peakDeg, consts.tireTailFloor ?? 0.55);

  const gripAccel = (consts.gripAccel ?? 22)
    * bandeStat(stats.grip_stat, consts.gripStatMin ?? 0.75, consts.gripStatMax ?? 1.35)
    * surface_grip;

  const entree = consts.driftEnterDeg ?? 16;
  const sortie = consts.driftExitDeg  ?? 9;
  let is_drifting;
  if (v_speed < (consts.minDriftSpeed ?? 3)) is_drifting = false;
  else if (slipDeg > entree)                 is_drifting = true;
  else if (slipDeg < sortie)                 is_drifting = false;
  else                                       is_drifting = prevDrifting;

  return {
    is_drifting, slip, slipDeg, gripFactor, gripAccel,
    lateralGrip: gripAccel * gripFactor,
    v_speed,
    drift_threshold: entree,
  };
}

// ---- Vitesse de rotation ----

/**
 * Calcule le turn_rate (vitesse de rotation du nez, en rad/s).
 *
 * Trois effets se composent :
 *   - montée    : on ne pivote pas sur place, l'autorité arrive avec la vitesse
 *   - plafond d'adhérence : tourner le nez plus vite que ce que les pneus peuvent
 *                 encaisser ne fait pas tourner la voiture, ça la met en travers.
 *                 Le plafond vaut donc grosso modo adhérence / vitesse. Sans lui,
 *                 braquer à fond à 27 u/s réclamait 94 u/s² pour 22 disponibles :
 *                 la voiture partait à 88° de dérive en une demi-seconde.
 *   - survirage : en glisse l'arrière pivote un peu plus, de façon continue et
 *                 bornée. L'ancien bonus binaire ×1.8 se combinait à une chute
 *                 d'adhérence à 20 % : la glisse s'auto-entretenait jusqu'à 90°.
 *
 * Effet de bord voulu : une voiture très adhérente peut braquer plus fort à haute
 * vitesse qu'une savonnette. La différence de pilotage entre véhicules découle du
 * modèle au lieu d'être plaquée dessus.
 *
 * @param {number} steering — entrée virage ∈ [-1, 1]
 * @param {{ v_forward: number, v_lateral: number }} dec
 * @param {{ slip: number, gripAccel: number }} driftInfo — résultat de detectDrift()
 * @param {object} consts — /config/gameplay.json → physics
 * @returns {number} — turn_rate en rad/s
 */
export function computeTurnRate(steering, dec, driftInfo, consts) {
  const { v_forward, v_lateral } = dec;
  const v_speed = Math.max(0.01, Math.sqrt(v_forward ** 2 + v_lateral ** 2));

  const vRef      = Math.max(v_speed, consts.turnGripMinSpeed ?? 4);
  const gripAccel = driftInfo?.gripAccel ?? (consts.gripAccel ?? 22);

  // L'autorité de braquage vient du conducteur, pas des pneus : c'est une
  // accélération latérale demandée, convertie en vitesse de rotation. L'indexer
  // sur l'adhérence inversait le contraste entre véhicules (la voiture la plus
  // adhérente dérivait le plus, parce qu'elle pouvait braquer plus fort).
  const omegaMax = Math.min(consts.turnSpeed ?? 3.5, (consts.turnLatAccel ?? 30) / vRef);

  const montee  = Math.min(1, Math.abs(v_forward) / (consts.turnRampSpeed ?? 5));

  const slip    = driftInfo?.slip ?? 0;
  const slipDeg = slip * 180 / Math.PI;

  // Survirage : volontairement faible. C'est le seul terme déstabilisant, il doit
  // rester sous l'amortissement sinon la glisse s'auto-entretient jusqu'au tête-à-queue.
  const survire = 1 + (consts.driftRotationBoost ?? 0.25)
                    * Math.min(1, slipDeg / 45);

  // Moment stabilisant des pneus arrière : ils ramènent le nez vers la trajectoire
  // réelle, d'autant plus fort que la dérive est grande. C'est lui qui fait qu'une
  // voiture prend un angle de glisse et s'y tient au lieu de partir en toupie.
  // Il est indexé sur l'adhérence disponible — une voiture adhérente se recale vite,
  // une savonnette reste en travers — mais surtout PAS sur gripFactor : celui-ci
  // chute quand la dérive monte, l'amortissement s'effondrait donc au moment précis
  // où il devenait nécessaire, ce qui recréait la bistabilité qu'on vient de retirer.
  const stab = Math.sign(v_lateral) * (consts.yawDamping ?? 2.0)
             * (gripAccel / vRef)
             * Math.min(1, slipDeg / (consts.yawDampSlipDeg ?? 40));

  return steering * omegaMax * montee * survire + stab;
}

// ---- Charge de dérapage et boost de sortie ----

/**
 * Accumule la durée de glisse et libère une poussée à la sortie.
 *
 * Reprise de PAKO (et du mini-turbo de Mario Kart) : tenir un dérapage long doit
 * rapporter quelque chose, sinon glisser n'est qu'une perte de vitesse et le jeu
 * optimal consiste à ne jamais déraper. La poussée part vers l'avant du véhicule,
 * donc vers la sortie du virage.
 *
 * À appeler une fois par frame, après la mise à jour de `carState.drifting`.
 * Mute `carState` (velocity et driftTime), comme applyBump et applyLandingPenalty.
 *
 * @param {object} carState — état véhicule (drifting, angle, velocity, driftTime)
 * @param {number} dt — deltaTime en secondes
 * @param {object} consts — /config/gameplay.json → physics
 * @returns {{ libere: boolean, charge: number }} charge ∈ [0, 1] pour le HUD/VFX
 */
export function tickDriftCharge(carState, dt, consts) {
  const cfg    = consts ?? {};
  const tMin   = cfg.driftBoostMinTime ?? 0.5;
  const tPlein = cfg.driftBoostMaxTime ?? 2.0;
  const pousse = cfg.driftBoostSpeed   ?? 3.0;

  if (carState.drifting) {
    carState.driftTime = (carState.driftTime ?? 0) + dt;
    return { libere: false, charge: Math.min(1, carState.driftTime / tPlein) };
  }

  const duree = carState.driftTime ?? 0;
  carState.driftTime = 0;

  // Une glisse trop courte ne rapporte rien : sans ce seuil, le moindre
  // frémissement latéral déclencherait une poussée et la conduite deviendrait
  // saccadée.
  if (duree < tMin) return { libere: false, charge: 0 };

  const charge = Math.min(1, duree / tPlein);
  carState.velocity.x += Math.cos(carState.angle) * pousse * charge;
  carState.velocity.z += Math.sin(carState.angle) * pousse * charge;
  return { libere: true, charge };
}

// ---- Braquage progressif (entrée de virage en clothoïde) ----

/**
 * Fait monter le braquage progressivement au lieu de le faire passer de 0 à
 * 100 % en une frame.
 *
 * Les entrées sont binaires (touche ou zone tactile) : sans rampe, la courbure
 * de la trajectoire saute d'un coup à sa valeur finale et le virage démarre déjà
 * rond. Avec une rampe, la courbure croît avec la distance parcourue — c'est une
 * clothoïde, la courbe qu'utilisent les routes pour raccorder une ligne droite à
 * un arc de cercle. `steerRampTime` règle donc directement la longueur de
 * l'entrée du virage.
 *
 * Le retour (relâcher ou contre-braquer) a sa propre durée, en général plus
 * courte : on veut pouvoir redresser vite.
 *
 * Une durée à 0 rend le braquage instantané, comme avant.
 *
 * @param {object} carState — état véhicule, mute steerSmooth
 * @param {number} cible    — entrée brute ∈ [-1, 1]
 * @param {number} dt
 * @param {object} consts   — /config/gameplay.json → physics
 * @returns {number} braquage effectif ∈ [-1, 1]
 */
export function rampSteering(carState, cible, dt, consts) {
  const cfg    = consts ?? {};
  const actuel = carState.steerSmooth ?? 0;

  // On braque davantage : même sens (ou départ de zéro) et amplitude qui grandit
  const accentue = cible !== 0
    && (actuel === 0 || Math.sign(cible) === Math.sign(actuel))
    && Math.abs(cible) > Math.abs(actuel);
  const duree = accentue ? (cfg.steerRampTime ?? 0) : (cfg.steerReturnTime ?? 0);

  if (duree <= 0) {
    carState.steerSmooth = cible;
    return cible;
  }

  const pas     = dt / duree;          // pleine amplitude (0 → 1) en `duree` secondes
  const ecart   = cible - actuel;
  const suivant = Math.abs(ecart) <= pas ? cible : actuel + Math.sign(ecart) * pas;
  carState.steerSmooth = suivant;
  return suivant;
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
export function applyBounce(velocity, pushBack, restitution, consts = null) {
  const len = Math.sqrt(pushBack.x ** 2 + pushBack.z ** 2);
  if (len < 0.001) return { x: velocity.x, z: velocity.z }; // normale invalide, pas de rebond

  const nx    = pushBack.x / len;
  const nz    = pushBack.z / len;
  const v_dot = velocity.x * nx + velocity.z * nz;

  // Ne rebondit que si la velocity pointe vers le mur (v_dot < 0)
  if (v_dot >= 0) return { x: velocity.x, z: velocity.z };

  const vLen = Math.sqrt(velocity.x ** 2 + velocity.z ** 2);
  // 1 = choc de face, 0 = frottement rasant le long du mur
  const incidence = vLen > 0.01 ? Math.min(1, Math.abs(v_dot) / vLen) : 0;

  // Le rebond dépend de l'incidence. Avec un coefficient unique, un choc de face
  // renvoyait la moitié de la vitesse vers l'arrière : la voiture repartait en
  // marche arrière puis pivotait pour s'aligner dessus — elle se retournait à
  // pleine vitesse. Pire, se jeter dans un mur devenait un bon moyen de freiner.
  // De face on s'arrête donc, en rasant on continue de glisser.
  const cfg    = consts ?? {};
  const rasant = cfg.wallBounceGrazing ?? restitution ?? 0.5;
  const face   = cfg.wallBounceHeadOn  ?? 0.05;
  const rebond = rasant * (1 - incidence) + face * incidence;

  // Décomposition normale / tangentielle
  const vnx = v_dot * nx,        vnz = v_dot * nz;
  const vtx = velocity.x - vnx,  vtz = velocity.z - vnz;

  // Frotter le long d'un mur coûte un peu de vitesse : sans ça, longer la paroi
  // est gratuit et devient la trajectoire optimale.
  const friction = 1 - (cfg.wallFriction ?? 0.12);

  return {
    x: vtx * friction - vnx * rebond,
    z: vtz * friction - vnz * rebond,
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
    driftTime: 0, steerSmooth: 0,
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

