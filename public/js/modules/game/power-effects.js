// Détection et calcul des effets de pouvoir — module sans dépendance navigateur.
//
// C'est la source unique de vérité de la géométrie des pouvoirs : le serveur
// l'importe pour faire autorité sur les effets, et game/powers.js l'importe pour
// construire des visuels qui coïncident exactement avec les zones testées.
// Aucun `document`, `window` ni Three.js ici — même contrainte que physics.js
// et collision.js, qui tournent déjà des deux côtés.
//
// Contrat I/O — JSON in, JSON out, pas d'état de module en dehors de la config :
//   setConfig(powersCfg)                     → /config/gameplay.json → powers
//   createPowerState(powerValues)            → état d'un véhicule (bouclier, sillage)
//   createPowerWorld()                       → état partagé d'un match (traînées)
//   computeEffects(vehicles, world, dt, now) → { effects, spawned, expired }
//   foldEffects(effects)                     → { [targetId]: { speedMul, gripMul, accelMul } }
//   absorbDamage(powerState, damage)         → { remaining, absorbed, hp, broken }
//
// Repère local d'un véhicule : forward = (cos angle, sin angle), right = (−sin angle, cos angle)
// — la convention de physics.decompose(). L'ancienne détection projetait sur
// (sin, cos), un axe miroir du bon : les zones ne tombaient pas où les visuels
// les dessinaient.
//
// Principe produit (prd_pouvoirs.md §2) : un pouvoir ne s'applique jamais à son
// porteur. Toutes les boucles ci-dessous sautent `other.id === v.id`.

let _config = null;

// Valeurs de repli : le module reste utilisable si setConfig() n'a pas été appelé
// (page de test, import isolé). Les vraies valeurs vivent dans gameplay.json.
const DEFAULTS = {
  aspiration: {
    boostStrength: 1.3,
    offset: 1.0, sizeBase: 1.5, sizeParPoint: 0.8, halfWidthRatio: 0.6,
  },
  phares: {
    gripBoost: 1.2,
    offset: 1.0, lengthBase: 3.0, lengthParPoint: 1.5,
    radiusBase: 1.0, radiusParPoint: 0.5,
  },
  sillage: {
    accelBoost: 1.2, lifetimeSec: 7,
    radiusBase: 0.8, radiusParPoint: 0.3,
    emitPeriodSec: 0.15, emitMinSpeed: 1.0,
  },
  shield: {
    absorption: 0.7, domeMin: 0.9, domeMax: 1.6, domeParPoint: 0.05,
  },
};

/**
 * Injecte la section `powers` de gameplay.json.
 * @param {object|null} powersCfg
 */
export function setConfig(powersCfg) {
  _config = powersCfg ?? null;
}

function cfg(nom) {
  return { ...DEFAULTS[nom], ...(_config?.[nom] ?? {}) };
}

// ---- Géométrie des zones (partagée avec les visuels) ----

/**
 * Triangle d'aspiration, derrière le véhicule.
 * Pointe à `offset` derrière l'arrière, base à `offset + size`, demi-largeur
 * croissant linéairement de 0 (pointe) à `halfWidthRatio × size` (base).
 */
export function aspirationShape(value) {
  const c = cfg('aspiration');
  const size = c.sizeBase + value * c.sizeParPoint;
  return { size, offset: c.offset, halfWidthRatio: c.halfWidthRatio };
}

/**
 * Cône des phares, devant le véhicule.
 * Pointe à `offset` devant l'avant, base de rayon `radius` à `offset + length`.
 */
export function pharesShape(value) {
  const c = cfg('phares');
  return {
    length: c.lengthBase + value * c.lengthParPoint,
    radius: c.radiusBase + value * c.radiusParPoint,
    offset: c.offset,
  };
}

/** Disque de traînée déposé au sol. */
export function sillageShape(value) {
  const c = cfg('sillage');
  return {
    radius:        c.radiusBase + value * c.radiusParPoint,
    emitPeriodSec: c.emitPeriodSec,
    emitMinSpeed:  c.emitMinSpeed,
    lifetimeSec:   c.lifetimeSec,
  };
}

/**
 * Dôme de bouclier. Plafonné : non borné il atteignait 7 u de rayon pour une
 * voiture de 2,24 u, et les obstacles semblaient percutés à distance.
 */
export function shieldShape(value) {
  const c = cfg('shield');
  return { size: Math.min(c.domeMax, c.domeMin + value * c.domeParPoint) };
}

// ---- États ----

/**
 * Construit l'état de pouvoir d'un véhicule à partir de ses valeurs de couleur.
 * @param {{aspiration?,phares?,sillage?,shield?,attraction?,heal?}} powerValues
 */
export function createPowerState(powerValues = {}) {
  const pv = {
    aspiration: powerValues.aspiration ?? 0,
    phares:     powerValues.phares     ?? 0,
    sillage:    powerValues.sillage    ?? 0,
    shield:     powerValues.shield     ?? 0,
    attraction: powerValues.attraction ?? 0,
    heal:       powerValues.heal       ?? 0,
  };

  return {
    powerValues: pv,
    aspiration: pv.aspiration > 0 ? aspirationShape(pv.aspiration) : null,
    phares:     pv.phares     > 0 ? pharesShape(pv.phares)         : null,
    sillage:    pv.sillage    > 0 ? { ...sillageShape(pv.sillage), emitCounter: 0 } : null,
    shield:     pv.shield     > 0
      ? { ...shieldShape(pv.shield), hp: pv.shield, hpMax: pv.shield, active: true }
      : null,
  };
}

/**
 * État partagé d'un match. Les traînées y vivent, pas dans le module : le
 * serveur fait tourner plusieurs matchs à la fois et un tableau global les
 * mélangerait.
 */
export function createPowerWorld() {
  return { trails: [], nextTrailId: 1 };
}

// ---- Détection ----

// Coordonnées de `to` dans le repère de `from` : fwd = axe avant, lat = axe droit.
function _local(from, to, cosA, sinA) {
  const dx = to.position.x - from.position.x;
  const dz = to.position.z - from.position.z;
  return {
    fwd: dx * cosA + dz * sinA,
    lat: -dx * sinA + dz * cosA,
  };
}

/**
 * Calcule les effets de la frame et fait vivre les traînées.
 *
 * @param {Array<{id, position:{x,z}, angle, speed, power}>} vehicles — `power` = createPowerState()
 * @param {{trails: Array, nextTrailId: number}} world
 * @param {number} dt  — secondes
 * @param {number} now — horloge en secondes (Date.now()/1000 ou performance.now()/1000)
 * @returns {{effects: Array, spawned: Array, expired: Array}}
 */
export function computeEffects(vehicles, world, dt, now) {
  const effects = [];
  const spawned = [];
  const expired = [];
  if (!world || !Array.isArray(vehicles)) return { effects, spawned, expired };

  const cAsp = cfg('aspiration');
  const cPha = cfg('phares');
  const cSil = cfg('sillage');

  for (const v of vehicles) {
    const ps = v.power;
    if (!ps) continue;

    const cosA = Math.cos(v.angle ?? 0);
    const sinA = Math.sin(v.angle ?? 0);

    // ---- Rouge — Aspiration : triangle arrière ----
    // Le code d'origine testait un demi-disque, ce qui ne correspondait pas au
    // visuel. prd_pouvoirs.md §5 tranche : le triangle fait foi.
    if (ps.aspiration) {
      const { size, offset, halfWidthRatio } = ps.aspiration;
      for (const other of vehicles) {
        if (other.id === v.id) continue;
        const { fwd, lat } = _local(v, other, cosA, sinA);
        const u = -fwd - offset;                      // profondeur dans le triangle
        if (u < 0 || u > size) continue;
        if (Math.abs(lat) > halfWidthRatio * u) continue;
        effects.push({
          targetId: other.id, sourceId: v.id,
          effect: 'aspiration_boost', value: cAsp.boostStrength,
          position: { x: other.position.x, z: other.position.z },
        });
      }
    }

    // ---- Vert — Phares : cône avant ----
    if (ps.phares) {
      const { length, radius, offset } = ps.phares;
      for (const other of vehicles) {
        if (other.id === v.id) continue;
        const { fwd, lat } = _local(v, other, cosA, sinA);
        const u = fwd - offset;
        if (u < 0 || u > length) continue;
        if (Math.abs(lat) > radius * (u / length)) continue;
        effects.push({
          targetId: other.id, sourceId: v.id,
          effect: 'phares_grip', value: cPha.gripBoost,
          position: { x: other.position.x, z: other.position.z },
        });
      }
    }

    // ---- Bleu — Sillage : dépôt de traînées ----
    if (ps.sillage && (v.speed ?? 0) > ps.sillage.emitMinSpeed) {
      ps.sillage.emitCounter += dt;
      if (ps.sillage.emitCounter >= ps.sillage.emitPeriodSec) {
        ps.sillage.emitCounter = 0;
        const trail = {
          id:        world.nextTrailId++,
          ownerId:   v.id,
          x:         v.position.x,
          z:         v.position.z,
          radius:    ps.sillage.radius,
          createdAt: now,
        };
        world.trails.push(trail);
        spawned.push(trail);
      }
    }
  }

  // ---- Vieillissement des traînées + détection de traversée ----
  const lifetime = cSil.lifetimeSec;
  for (let i = world.trails.length - 1; i >= 0; i--) {
    const t = world.trails[i];
    if (now - t.createdAt > lifetime) {
      expired.push(t);
      world.trails.splice(i, 1);
      continue;
    }
    const r2 = t.radius * t.radius;
    for (const other of vehicles) {
      if (other.id === t.ownerId) continue;
      const dx = other.position.x - t.x;
      const dz = other.position.z - t.z;
      if (dx * dx + dz * dz >= r2) continue;
      effects.push({
        targetId: other.id, sourceId: t.ownerId,
        effect: 'sillage_accel', value: cSil.accelBoost,
        position: { x: other.position.x, z: other.position.z },
      });
    }
  }

  return { effects, spawned, expired };
}

/**
 * Replie les effets en multiplicateurs par véhicule.
 *
 * Une même source ne compte qu'une fois par type d'effet : un véhicule qui
 * traverse une traînée chevauche une dizaine de disques du même émetteur, et
 * les multiplier donnerait un boost délirant. Deux sources différentes, elles,
 * se cumulent — c'est le propos coopératif.
 *
 * Le résultat est recalculé à chaque frame et n'est jamais stocké dans les
 * stats du véhicule : c'est ce qui empêche l'effet de s'accumuler indéfiniment,
 * défaut de l'ancien applyEffects().
 *
 * @param {Array} effects
 * @returns {Object<string, {speedMul, gripMul, accelMul, sources: Array}>}
 */
export function foldEffects(effects) {
  const vus      = new Set();
  const parCible = {};

  for (const e of effects) {
    const cle = `${e.targetId}|${e.effect}|${e.sourceId}`;
    if (vus.has(cle)) continue;
    vus.add(cle);

    if (!parCible[e.targetId]) {
      parCible[e.targetId] = { speedMul: 1, gripMul: 1, accelMul: 1, sources: [] };
    }
    const t = parCible[e.targetId];

    switch (e.effect) {
      case 'aspiration_boost': t.speedMul *= e.value; break;
      case 'phares_grip':      t.gripMul  *= e.value; break;
      case 'sillage_accel':    t.accelMul *= e.value; break;
      default: break;
    }
    t.sources.push({ effect: e.effect, sourceId: e.sourceId, value: e.value });
  }

  return parCible;
}

// ---- Orange — Bouclier ----

/**
 * Consomme le bouclier pour absorber une partie d'un choc.
 * Une fois vidé, le bouclier est définitivement perdu pour la partie
 * (prd_pouvoirs.md §5) — pas de recharge.
 *
 * @param {object} powerState — état retourné par createPowerState()
 * @param {number} damage     — intensité du choc (Δvitesse en u/s)
 * @returns {{remaining: number, absorbed: number, hp: number, broken: boolean}}
 */
export function absorbDamage(powerState, damage) {
  const sh = powerState?.shield;
  if (!sh?.active || sh.hp <= 0) {
    return { remaining: damage, absorbed: 0, hp: sh?.hp ?? 0, broken: false };
  }

  const absorbed = damage * cfg('shield').absorption;
  sh.hp = Math.max(0, sh.hp - absorbed);

  const broken = sh.hp <= 0;
  if (broken) sh.active = false;

  return { remaining: damage - absorbed, absorbed, hp: sh.hp, broken };
}
