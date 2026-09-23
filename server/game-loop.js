// Boucle de jeu autoritaire côté serveur.
//
// Physique V2 : utilise les mêmes modules que le client (physics.js, collision.js).
// Map : générée via map-generator.js (mode graph + SOLO-05 entry/exit).
//
// API publique :
//   startMatch(matchId, players, io, roomId) → Promise<{map, playerInfos}>
//   rejoinPlayer(matchId, playerId, newSocketId, socket) → boolean
//   applyInput(matchId, socketId, inputs)     → void
//   stopMatch(matchId)                        → void
//   getMatch(matchId)                         → MatchState | null
//   getPlayerIdBySocket(matchId, socketId)    → string | null

import { readFile, readdir } from 'fs/promises';
import { join, dirname }     from 'path';
import { fileURLToPath }     from 'url';
import * as MatchEnd         from './match-end.js';

// Modules partagés client/serveur (pur JS, pas de dépendances navigateur)
import {
  setConfig as setPhysicsConfig,
  decompose, computeForces, detectDrift, computeTurnRate,
  applyBounce, checkDamage, createState, tickDriftCharge, rampSteering,
} from '../public/js/modules/game/physics.js';
import { checkTerrain, boundsFromExtent, setConfig as setCollisionConfig } from '../public/js/modules/game/collision.js';
import {
  setConfig as setPowersConfig,
  createPowerState, createPowerWorld, computeEffects, foldEffects, absorbDamage,
} from '../public/js/modules/game/power-effects.js';
import {
  setConfig as setMapGenConfig,
  generate  as generateMapData,
  getSurfaceGrip,
  dedupePoolById,
  prepareBlockForGame,
  BLOCK_SIZE,
} from '../public/js/modules/game/map-generator.js';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const TICK_RATE  = 30;
const TICK_MS    = Math.round(1000 / TICK_RATE);

// ---- Cache config + pool ----

let _config    = null;
let _blockPool = null;

async function _chargerConfig() {
  if (_config) return _config;
  const raw = await readFile(join(__dirname, '..', 'config', 'gameplay.json'), 'utf-8');
  _config = JSON.parse(raw);

  // Injecter la config dans les modules partagés
  setPhysicsConfig({ ..._config.vehicleStats, ..._config.physics });
  setMapGenConfig(_config);
  setPowersConfig(_config.powers);
  setCollisionConfig(_config.physics);

  return _config;
}

async function _chargerBlockPool() {
  if (_blockPool) return _blockPool;
  const lire = async (dossier) => {
    const dir      = join(__dirname, '..', 'data', 'map-blocks', dossier);
    const fichiers = await readdir(dir).catch(() => []);
    return Promise.all(
      fichiers.filter(f => f.endsWith('.json')).map(async f => {
        const raw = await readFile(join(dir, f), 'utf-8');
        return JSON.parse(raw);
      })
    );
  };
  const seed      = await lire('_seed');
  const generated = await lire('generated');

  let depart = null;
  let arrivee = null;
  const pool = [];

  for (const brut of [...seed, ...generated]) {
    // Même repère que le client : pivoté une fois, plus jamais ensuite.
    const b = prepareBlockForGame(brut);
    if (brut.special === 'depart')  { depart  = b; continue; }
    if (brut.special === 'arrivee') { arrivee = b; continue; }
    // Les blocs seed (avec exits) ne sont pas filtrés par _estJouable :
    // le mode graph gère la compatibilité via les exits
    if (b.exits && b.exits.length > 0) { pool.push(b); continue; }
    if (_estJouable(b)) pool.push(b);
  }

  _blockPool = { depart, arrivee, pool: dedupePoolById(pool) };
  console.log(`Pool chargé : ${pool.length} bloc(s) jouable(s), départ: ${!!depart}, arrivée: ${!!arrivee}`);
  return _blockPool;
}

/** Invalide le cache du pool (à appeler après ajout d'un bloc via admin). */
export function reloadPool() {
  _blockPool = null;
}

_chargerBlockPool().catch(err => console.error('[pool] Erreur chargement initial :', err));

// ---- Validation jouabilité bloc (mode legacy) ----

function _estJouable(bloc) {
  if (!bloc?.grid || bloc.grid.length !== BLOCK_SIZE) return false;
  const CORRIDOR_MIN = 2;
  const CORRIDOR_MAX = 5;
  return _aPassageColonne(bloc.grid, 0, CORRIDOR_MIN, CORRIDOR_MAX)
      && _aPassageColonne(bloc.grid, BLOCK_SIZE - 1, CORRIDOR_MIN, CORRIDOR_MAX);
}

function _aPassageColonne(grid, gx, gzMin, gzMax) {
  for (let gz = gzMin; gz <= gzMax; gz++) {
    const c = grid[gz]?.[gx];
    const v = (c && typeof c === 'object') ? c.v : c;
    if (v === null || v === undefined
     || v === 'ramp' || v === 'boost' || v === 'sticky'
     || v === 'bump' || v === 'ramp_n' || v === 'ramp_e'
     || v === 'ramp_s' || v === 'ramp_o') return true;
  }
  return false;
}

// ---- Rotation 90° CW (post-génération, pour mouvement en +X) ----

function _rotate90CW(grid) {
  const n = grid.length;
  const result = Array.from({ length: n }, () => Array(n).fill(null));
  for (let gz = 0; gz < n; gz++) {
    for (let gx = 0; gx < n; gx++) {
      result[gx][n - 1 - gz] = grid[gz][gx];
    }
  }
  return result;
}

// ---- Constantes physique serveur ----

const STUCK_THRESHOLD       = 0.4;  // secondes avant déclenchement du recul
const AUTO_REVERSE_DURATION = 0.8;  // secondes de recul automatique

// ---- Gestion des matchs ----

const matches = new Map();

/**
 * Démarre un match.
 */
export async function startMatch(matchId, players, io, roomId) {
  const cfg      = await _chargerConfig();
  const poolData = await _chargerBlockPool();

  if (poolData.pool.length === 0 && !poolData.depart) {
    throw new Error('Pool de blocs vide et pas de bloc de départ');
  }

  // Génération via map-generator (SOLO-05 : mode graph avec entry/exit coins)
  const mapCfg    = cfg.map ?? {};
  const gridSize  = mapCfg.gridCols ?? mapCfg.gridSize ?? 8;
  const mapData   = await generateMapData(poolData, { gridSize });

  const blockScale = mapData.blockScale;

  // Clôture : bornes figées à la génération. Le serveur fait autorité sur la
  // physique, donc c'est ici qu'elle referme le contournement du labyrinthe —
  // checkVictory ne teste qu'une distance au bloc d'arrivée.
  const fenceBounds = boundsFromExtent(mapData.worldExtent, cfg.map?.fence);

  const playerStates = new Map();
  const socketMap    = new Map();
  const playerInfos  = [];

  const soloCfg  = cfg.solo ?? {};
  const physCfg  = cfg.physics;

  players.forEach((p, i) => {
    const stats    = p.vehicle?.stats ?? {};
    const playerId = p.vehicle?.id ?? `player_${i}_${Date.now()}`;

    socketMap.set(p.socketId, playerId);

    // SOLO-05 : spawn aux positions calculées dans le bloc départ
    const spawnPos = mapData.entry?.spawnPositions?.[i]
                  ?? mapData.entry?.spawnPositions?.[0]
                  ?? mapData.startPosition;

    playerStates.set(playerId, {
      playerId,
      playerName:   p.playerName,
      vehicleStats: {
        speed: stats.speed ?? cfg.vehicleStats.baseSpeed,
        grip:  stats.grip  ?? cfg.vehicleStats.baseGrip,
        accel: stats.accel ?? cfg.vehicleStats.baseAccel,
      },
      // Pouvoirs : le serveur fait autorité (prd_pouvoirs.md §8). Les valeurs
      // arrivaient déjà avec le véhicule au lobby:join, elles n'étaient
      // simplement pas conservées.
      powerState: createPowerState(p.vehicle?.powers ?? {}),
      physicsState: {
        position:  { x: spawnPos.x, z: spawnPos.z },
        velocity:  { x: 0, z: 0 },
        angle:     mapData.startPosition?.angle ?? 0,
        speed:     0,
        drifting:  false,
        elevation: 0,
      },
      latestInputs: { steering: 0, braking: 0, reversing: 0 },
      connected:    true,
      terrainState: { lastTerrain: null, onRamp: false, boostTimer: 0, rampTimer: 0 },
      stuckTimer:       0,
      autoReverseTimer: 0,
    });

    playerInfos.push({
      playerId,
      socketId:   p.socketId,
      playerName: p.playerName,
      vehicle:    p.vehicle,
    });
  });

  let lastTick = Date.now();

  // Traînées de sillage du match. Elles vivent ici et pas dans le module :
  // le serveur fait tourner plusieurs matchs à la fois.
  const powerWorld = createPowerWorld();

  const intervalId = setInterval(() => {
    const now = Date.now();
    const dt  = Math.min((now - lastTick) / 1000, 0.1);
    lastTick  = now;

    // ---- Pouvoirs : une seule passe, avant la physique ----
    // Les effets sont recalculés à chaque tick puis repliés dans les stats au
    // moment du calcul des forces. Ils ne sont jamais écrits dans
    // ps.vehicleStats : c'est ce qui les empêche de se cumuler d'une frame à
    // l'autre, défaut de l'ancien applyEffects() côté client.
    const vuePouvoirs = [...playerStates.values()].map(ps => ({
      id:       ps.playerId,
      position: ps.physicsState.position,
      angle:    ps.physicsState.angle,
      speed:    ps.physicsState.speed,
      power:    ps.powerState,
    }));
    const { effects } = computeEffects(vuePouvoirs, powerWorld, dt, now / 1000);
    const effetsParJoueur = foldEffects(effects);

    for (const ps of playerStates.values()) {
      _tickJoueur(
        ps, mapData, blockScale, dt, cfg, fenceBounds,
        effetsParJoueur[ps.playerId] ?? null,
      );
    }

    const positions = [...playerStates.values()].map(ps => ps.physicsState.position);
    const cohesion  = _calculerCohesion(positions, cfg.cohesion);

    const playersPayload = {};
    for (const [pid, ps] of playerStates) {
      const vel = ps.physicsState.velocity;
      const velocityAngle = Math.atan2(vel.x, vel.z);
      let driftAngle = velocityAngle - ps.physicsState.angle;
      if (driftAngle >  Math.PI) driftAngle -= 2 * Math.PI;
      if (driftAngle < -Math.PI) driftAngle += 2 * Math.PI;

      playersPayload[pid] = {
        playerName: ps.playerName,
        position:   { ...ps.physicsState.position },
        velocity:   { x: vel.x, z: vel.z },
        angle:      ps.physicsState.angle,
        speed:      ps.physicsState.speed,
        drifting:   ps.physicsState.drifting,
        driftAngle,
        elevation:  ps.physicsState.elevation ?? 0,
        // Ce qui agit sur moi en ce moment — le client s'en sert pour les
        // flashs et les halos, au lieu de redétecter chacun dans son coin.
        effects:    _payloadEffets(effetsParJoueur[pid]),
        shield:     _payloadBouclier(ps.powerState),
      };
    }

    io.to(roomId).emit('game:state', { matchId, players: playersPayload, cohesion });

    MatchEnd.checkVictory(match);
  }, TICK_MS);

  const match = { id: matchId, playerStates, socketMap, map: mapData, intervalId, roomId, io, cfg };
  matches.set(matchId, match);
  console.log(`Match ${matchId} démarré — ${players.length} joueur(s), map ${mapData.gridCols}×${mapData.gridRows}`);

  return { map: mapData, playerInfos };
}

// ---- Tick physique V2 par joueur ----

function _tickJoueur(ps, map, blockScale, dt, cfg, bounds = null, powerEffects = null) {
  const state    = ps.physicsState;
  const inputs   = ps.latestInputs;
  const ts       = ps.terrainState;
  const physConsts = cfg.physics;

  // Détection terrain via collision.js partagé
  const terrain = checkTerrain(state.position, map.blocks, blockScale, state.elevation, null, bounds);

  // Effets de terrain
  if (terrain) {
    if (terrain.softTerrain === 'boost' && ts.lastTerrain !== 'boost') ts.boostTimer = 1.5;
    if (terrain.softTerrain === 'ramp') {
      ts.onRamp = true;
    } else if (ts.onRamp) {
      ts.rampTimer = 1.0;
      ts.onRamp    = false;
    }
    // SOLO-04 : bosse → pas d'impulsion Y sur serveur (2D), mais le bump est détecté comme softTerrain
    ts.lastTerrain = terrain.softTerrain;
    ts.boostTimer  = Math.max(0, ts.boostTimer - dt);
    ts.rampTimer   = Math.max(0, ts.rampTimer  - dt);

    // RACE-C04 : élévation du terrain
    if (terrain.elevationTarget !== undefined) {
      state.elevation = state.elevation + (terrain.elevationTarget - state.elevation) * 0.3;
      if (terrain.elevationTarget === 0 && terrain.softTerrain === null) {
        state.elevation = Math.max(0, state.elevation - dt * 4);
      }
    }
  } else if (state.elevation > 0) {
    state.elevation = Math.max(0, state.elevation - dt * 4);
  }

  // Surface grip
  const surfaceGrip = getSurfaceGrip(terrain?.softTerrain ?? null);

  // Recul automatique si bloqué dans un mur
  if (ps.autoReverseTimer > 0) {
    ps.autoReverseTimer -= dt;
    if (ps.autoReverseTimer <= 0) ps.stuckTimer = 0;
  } else if (terrain?.hardCollision) {
    ps.stuckTimer += dt;
    if (ps.stuckTimer > STUCK_THRESHOLD) {
      ps.autoReverseTimer = AUTO_REVERSE_DURATION;
      ps.stuckTimer       = 0;
    }
  } else {
    ps.stuckTimer = 0;
  }
  const isAutoReversing = ps.autoReverseTimer > 0;

  // Multiplicateur vitesse max selon terrain
  const vmaxMult = ts.boostTimer > 0             ? 1.5
                 : ts.rampTimer  > 0              ? 1.3
                 : terrain?.softTerrain === 'sticky' ? 0.5
                 : 1.0;

  // Stats normalisées pour le pipeline de forces.
  // Les multiplicateurs de pouvoir s'appliquent ici, sur une valeur reconstruite
  // à chaque tick — jamais sur ps.vehicleStats, qui resterait gonflé à vie.
  const vs = cfg.vehicleStats;
  const pw = powerEffects ?? { speedMul: 1, gripMul: 1, accelMul: 1 };
  const statsNorm = {
    speed_stat: (ps.vehicleStats.speed / vs.baseSpeed) * vmaxMult * pw.speedMul,
    grip_stat:  (ps.vehicleStats.grip  / vs.baseGrip)  * pw.gripMul,
    accel_stat: (ps.vehicleStats.accel / vs.baseAccel) * pw.accelMul,
  };

  // Throttle/steering depuis inputs
  const throttle = isAutoReversing  ? -1
                 : inputs.reversing ? -1
                 : inputs.braking   ? -0.8
                 : 1;

  // ---- Collision dure ----
  if (terrain?.hardCollision && !isAutoReversing) {
    if (terrain.pushBack) {
      const velocityBefore = { x: state.velocity.x, z: state.velocity.z };

      const bounced = applyBounce(
        state.velocity, terrain.pushBack, physConsts.restitution ?? 0.5, physConsts
      );
      state.velocity.x = bounced.x;
      state.velocity.z = bounced.z;
      state.speed      = Math.sqrt(bounced.x ** 2 + bounced.z ** 2);

      // Correction de position
      state.position.x += terrain.pushBack.x;
      state.position.z += terrain.pushBack.z;

      // Velocity post-rebond → déplacement pour sortir du mur
      state.position.x += state.velocity.x * dt;
      state.position.z += state.velocity.z * dt;

      // Amortissement pour éviter les oscillations
      state.velocity.x *= 0.92;
      state.velocity.z *= 0.92;
      state.speed = Math.sqrt(state.velocity.x ** 2 + state.velocity.z ** 2);

      // ---- Orange — Bouclier : il encaisse avant le véhicule ----
      // checkDamage était importé côté serveur sans jamais être appelé. Le
      // bouclier s'use ici, et une fois vidé il est perdu pour la partie.
      // La perte de voxels, elle, reste locale au client (prd_pouvoirs.md §7).
      if (ps.powerState?.shield?.active) {
        const nPush = Math.hypot(terrain.pushBack.x, terrain.pushBack.z) || 1;
        const dmg = checkDamage(velocityBefore, state.velocity, {
          x: terrain.pushBack.x / nPush,
          z: terrain.pushBack.z / nPush,
        }, state.position);
        if (dmg.damaged) absorbDamage(ps.powerState, dmg.deltaSpeed);
      }
    } else {
      state.velocity.x = 0;
      state.velocity.z = 0;
      state.speed      = 0;
    }
    // Un choc annule la charge de dérapage : pas de récompense pour une glisse
    // qui finit dans un mur.
    state.drifting  = false;
    state.driftTime = 0;
  } else {
    // Pas de collision (ou auto-reverse actif)
    if (isAutoReversing && terrain?.hardCollision && terrain.pushBack) {
      state.position.x += terrain.pushBack.x * 2;
      state.position.z += terrain.pushBack.z * 2;
    }

    const dec       = decompose(state.velocity, state.angle);
    const driftInfo = detectDrift(dec, physConsts, statsNorm, surfaceGrip, state.drifting);
    state.drifting  = driftInfo.is_drifting;

    const newV = computeForces(
      state, { throttle }, statsNorm, dt, physConsts, driftInfo.lateralGrip
    );
    state.velocity.x = newV.x;
    state.velocity.z = newV.z;

    const steeringEff = rampSteering(state, inputs.steering, dt, physConsts);
    const turn_rate   = computeTurnRate(steeringEff, dec, driftInfo, physConsts);
    state.angle      += turn_rate * dt;

    state.position.x += state.velocity.x * dt;
    state.position.z += state.velocity.z * dt;
    state.speed       = driftInfo.v_speed;

    // Récompense de sortie de glisse (façon mini-turbo)
    tickDriftCharge(state, dt, physConsts);
  }
}

// ---- Sérialisation des pouvoirs pour game:state ----

// Compact : null la plupart des ticks, donc rien sur le fil tant qu'aucun
// pouvoir n'agit sur ce joueur.
function _payloadEffets(fx) {
  if (!fx) return null;
  const types = [...new Set(fx.sources.map(s => s.effect))];
  return {
    speedMul: fx.speedMul,
    gripMul:  fx.gripMul,
    accelMul: fx.accelMul,
    types,
  };
}

function _payloadBouclier(powerState) {
  const sh = powerState?.shield;
  if (!sh) return null;
  return { hp: sh.hp, hpMax: sh.hpMax, active: sh.active };
}

// ---- Cohésion ----

function _calculerCohesion(positions, cfg) {
  if (positions.length <= 1) return { value: 1, isFull: true };
  let maxDist = 0;
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const dx = positions[i].x - positions[j].x;
      const dz = positions[i].z - positions[j].z;
      const d  = Math.sqrt(dx * dx + dz * dz);
      if (d > maxDist) maxDist = d;
    }
  }
  const value = Math.max(0, 1 - maxDist / cfg.radiusUnits);
  return { value, isFull: value >= cfg.fullThreshold };
}

// ---- Rejoin / Input / Stop / Getters ----

/**
 * Ré-associe un joueur à un nouveau socketId après navigation de page.
 */
export function rejoinPlayer(matchId, playerId, newSocketId, socket) {
  const match = matches.get(matchId);
  if (!match) return false;
  if (!match.playerStates.has(playerId)) return false;

  for (const [sid, pid] of match.socketMap) {
    if (pid === playerId) { match.socketMap.delete(sid); break; }
  }

  match.socketMap.set(newSocketId, playerId);
  match.playerStates.get(playerId).connected = true;

  socket.join(match.roomId);

  console.log(`Rejoin : ${playerId} → socket ${newSocketId} (match ${matchId})`);
  return true;
}

/**
 * Enregistre les inputs d'un joueur (lookup via socketMap).
 */
export function applyInput(matchId, socketId, inputs) {
  const match = matches.get(matchId);
  if (!match) return;

  const playerId = match.socketMap.get(socketId);
  if (!playerId) return;

  const ps = match.playerStates.get(playerId);
  if (!ps) return;

  ps.latestInputs = {
    steering:  Math.max(-1, Math.min(1, Number(inputs.steering) || 0)),
    braking:   inputs.braking   ? 1 : 0,
    reversing: inputs.reversing ? 1 : 0,
  };
}

/** Arrête la boucle et supprime le match. */
export function stopMatch(matchId) {
  const match = matches.get(matchId);
  if (!match) return;
  clearInterval(match.intervalId);
  matches.delete(matchId);
  MatchEnd.resetMatch(matchId);
  console.log(`Match ${matchId} terminé`);
}

/** Retourne l'état interne d'un match, ou null. */
export function getMatch(matchId) {
  return matches.get(matchId) ?? null;
}

/** Liste les matchIds actifs (debug). */
export function listMatchIds() {
  return matches.keys();
}

/** Trouve le playerId associé à un socketId dans un match. */
export function getPlayerIdBySocket(matchId, socketId) {
  const match = matches.get(matchId);
  if (!match) return null;
  return match.socketMap.get(socketId) ?? null;
}

/**
 * Gère la déconnexion d'un socket en le retirant de socketMap.
 */
export function handleDisconnect(socketId) {
  for (const match of matches.values()) {
    const playerId = match.socketMap.get(socketId);
    if (playerId) {
      match.socketMap.delete(socketId);
      const ps = match.playerStates.get(playerId);
      if (ps) ps.connected = false;
      console.log(`Socket ${socketId} déconnecté du match ${match.id} (joueur ${playerId} préservé)`);
      return match.id;
    }
  }
  return null;
}
