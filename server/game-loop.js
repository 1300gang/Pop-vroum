// Boucle de jeu autoritaire côté serveur.
//
// Les joueurs sont identifiés par un playerId stable (= vehicle.id ou
// un fallback généré) et non par socketId — cela permet le rejoin après
// navigation lobby → game.html.
//
// API publique :
//   startMatch(matchId, players, io, roomId) → Promise<map>
//   rejoinPlayer(matchId, playerId, newSocketId, io) → boolean
//   applyInput(matchId, socketId, inputs)     → void
//   stopMatch(matchId)                        → void
//   getMatch(matchId)                         → MatchState | null
//   getPlayerIdBySocket(matchId, socketId)    → string | null

import { readFile, readdir } from 'fs/promises';
import { join, dirname }     from 'path';
import { fileURLToPath }     from 'url';
import * as MatchEnd         from './match-end.js';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const TICK_RATE  = 30;
const TICK_MS    = Math.round(1000 / TICK_RATE);
const BLOCK_SIZE = 8;

// ---- Cache config + pool ----

let _config    = null;
let _blockPool = null;

async function _chargerConfig() {
  if (_config) return _config;
  const raw = await readFile(join(__dirname, '..', 'config', 'gameplay.json'), 'utf-8');
  _config = JSON.parse(raw);
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

  for (const b of [...seed, ...generated]) {
    if (b.special === 'depart') { depart = b; continue; }
    if (b.special === 'arrivee') { arrivee = b; continue; }
    if (_estJouable(b)) pool.push(b);
  }

  _blockPool = { depart, arrivee, pool };
  console.log(`Pool chargé : ${pool.length} bloc(s) jouable(s), départ: ${!!depart}, arrivée: ${!!arrivee}`);
  return _blockPool;
}

/** Invalide le cache du pool (à appeler après ajout d'un bloc via admin). */
export function reloadPool() {
  _blockPool = null;
}

_chargerBlockPool().catch(err => console.error('[pool] Erreur chargement initial :', err));

// ---- Validation jouabilité bloc ----

// Vérifie qu'un bloc peut être traversé en direction X (après rotation 90° CW).
// Après rotation : rx=0 (entrée) = colonne gx=0 originale, rx=7 (sortie) = colonne gx=7 originale.
// Les rangées gz=2..5 correspondent au couloir central (rz=2..5 après rotation).
function _estJouable(bloc) {
  if (!bloc?.grid || bloc.grid.length !== BLOCK_SIZE) return false;
  const CORRIDOR_MIN = 2;
  const CORRIDOR_MAX = 5;
  return _aPassageColonne(bloc.grid, 0, CORRIDOR_MIN, CORRIDOR_MAX)
      && _aPassageColonne(bloc.grid, BLOCK_SIZE - 1, CORRIDOR_MIN, CORRIDOR_MAX);
}

// Vérifie qu'au moins une cellule est passable dans la colonne gx, entre gz=min et gz=max
function _aPassageColonne(grid, gx, gzMin, gzMax) {
  for (let gz = gzMin; gz <= gzMax; gz++) {
    const c = grid[gz]?.[gx];
    const v = (c && typeof c === 'object') ? c.v : c;
    if (v === null || v === undefined || v === 'ramp' || v === 'boost' || v === 'sticky') return true;
  }
  return false;
}

// ---- Rotation 90° CW ----

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

// ---- Génération map 8×8 ----

function _genererMap(poolData, cfg) {
  const { depart, arrivee, pool } = poolData;
  const mapCfg     = cfg.map ?? {};
  const gridCols   = mapCfg.gridCols ?? 8;
  const gridRows   = mapCfg.gridRows ?? 8;
  const blockScale = mapCfg.blockScale ?? 2;

  const blocmapSize = BLOCK_SIZE * blockScale;
  const blocks = [];

  for (let col = 0; col < gridCols; col++) {
    for (let row = 0; row < gridRows; row++) {
      let choisi;
      if (col === 0)                 choisi = depart;
      else if (col === gridCols - 1) choisi = arrivee;
      else                           choisi = pool[Math.floor(Math.random() * pool.length)];

      const worldX = col * blocmapSize;
      const worldZ = row * blocmapSize;

      blocks.push({
        blockId:  choisi.id,
        name:     choisi.name ?? '',
        col,
        row,
        position: [worldX, worldZ],
        grid:     _rotate90CW(choisi.grid),
      });
    }
  }

  const totalWidth = gridCols * blocmapSize;
  const totalDepth = gridRows * blocmapSize;

  const spawnX  = blocmapSize / 2;
  const spawnZ  = totalDepth / 2;
  const finishX = (gridCols - 0.5) * blocmapSize;

  return {
    id:             `map_${Date.now()}`,
    gridCols,
    gridRows,
    blockScale,
    blocks,
    startPosition:  { x: spawnX, z: spawnZ, angle: Math.PI / 2 },
    finishPosition: { x: finishX, z: totalDepth / 2 },
    worldExtent:    { width: totalWidth, depth: totalDepth },
  };
}

// ---- Détection terrain (cellSize-aware) ----

const VEHICLE_RADIUS = 0.65;

function _checkTerrain(pos, blocks, cellSize) {
  let softTerrain = null, hardCollision = false, pushX = 0, pushZ = 0;
  const blocExtent = BLOCK_SIZE * cellSize;

  for (const bloc of blocks) {
    const [bx, bz] = bloc.position;
    if (pos.x + VEHICLE_RADIUS < bx || pos.x - VEHICLE_RADIUS > bx + blocExtent) continue;
    if (pos.z + VEHICLE_RADIUS < bz || pos.z - VEHICLE_RADIUS > bz + blocExtent) continue;

    const gxMin = Math.max(0, Math.floor((pos.x - VEHICLE_RADIUS - bx) / cellSize));
    const gxMax = Math.min(BLOCK_SIZE - 1, Math.floor((pos.x + VEHICLE_RADIUS - bx) / cellSize));
    const gzMin = Math.max(0, Math.floor((pos.z - VEHICLE_RADIUS - bz) / cellSize));
    const gzMax = Math.min(BLOCK_SIZE - 1, Math.floor((pos.z + VEHICLE_RADIUS - bz) / cellSize));

    for (let gz = gzMin; gz <= gzMax; gz++) {
      for (let gx = gxMin; gx <= gxMax; gx++) {
        const cell = bloc.grid[gz]?.[gx];
        if (!cell) continue;
        const cellX    = bx + gx * cellSize;
        const cellZ    = bz + gz * cellSize;
        const closestX = Math.max(cellX, Math.min(pos.x, cellX + cellSize));
        const closestZ = Math.max(cellZ, Math.min(pos.z, cellZ + cellSize));
        const dx = pos.x - closestX, dz = pos.z - closestZ;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist >= VEHICLE_RADIUS) continue;
        if (cell === 'dur') {
          hardCollision = true;
          const pen = VEHICLE_RADIUS - dist;
          if (dist > 0.001) { pushX += (dx / dist) * pen; pushZ += (dz / dist) * pen; }
          else { pushX += pen; }
        } else if (!softTerrain) {
          softTerrain = cell;
        }
      }
    }
  }
  return { softTerrain: hardCollision ? null : softTerrain, hardCollision, pushX, pushZ };
}

// ---- Physique serveur ----

function _tickPhysique(state, vehicleStats, inputs, dt, cfg, modifiers = {}) {
  const ph        = cfg.physics;
  const vs        = cfg.vehicleStats;
  const maxSpeed  = (vehicleStats.speed ?? vs.baseSpeed) * (modifiers.maxSpeedMultiplier ?? 1);
  const grip      = vehicleStats.grip   ?? vs.baseGrip;
  const accelStat = vehicleStats.accel  ?? vs.baseAccel;

  const accelRate  = ph.accelRate * (accelStat / vs.baseAccel);
  const maxReverse = -maxSpeed * 0.4;

  if (inputs.reversing) {
    if (state.speed > 0) {
      state.speed = Math.max(0, state.speed - ph.brakingDecel * dt);
    } else {
      state.speed = Math.max(maxReverse, state.speed - accelRate * 0.5 * dt);
    }
  } else if (inputs.braking) {
    state.speed = Math.max(0, state.speed - ph.brakingDecel * dt);
  } else {
    if (state.speed < maxSpeed) {
      state.speed = Math.min(maxSpeed, state.speed + accelRate * dt);
    }
    if (state.speed < 0) {
      state.speed = Math.min(0, state.speed + ph.brakingDecel * 0.5 * dt);
    }
    if (state.speed > 0) {
      state.speed = Math.max(0, state.speed - ph.naturalDecel * dt * 0.1);
    }
  }

  // Velocity calculée AVANT la rotation d'angle — garantit l'indépendance velocity/angle (E03-S01)
  state.velocity.x = Math.sin(state.angle) * state.speed;
  state.velocity.z = Math.cos(state.angle) * state.speed;

  // S04 : v_forward = projection de velocity sur l'axe avant (convention sin/cos)
  // Dans le modèle scalaire actuel v_forward == state.speed ; formule complète pour la suite
  const v_forward = state.velocity.x * Math.sin(state.angle)
                  + state.velocity.z * Math.cos(state.angle);

  // S04 : rotation décorrélée — angle tourne selon |v_forward|, velocity ne change pas
  const clampFactor = Math.min(1, Math.max(0, Math.abs(v_forward) / 5));
  const turn_rate   = inputs.steering * ph.turnSpeed * clampFactor;
  state.angle      += turn_rate * dt;

  // Détection drift temporaire basée sur turn_rate (S05 remplacera avec v_lateral)
  const gripNorm   = grip / vs.baseGrip;
  const driftSeuil = ph.driftThreshold / Math.max(0.5, gripNorm);
  state.drifting   = Math.abs(turn_rate) * (Math.abs(v_forward) / Math.max(1, maxSpeed)) > driftSeuil;

  if (state.drifting) {
    state.speed *= Math.pow(ph.driftFriction, dt * 60);
  }

  // Position mise à jour via velocity (plus via sin/cos directement)
  state.position.x += state.velocity.x * dt;
  state.position.z += state.velocity.z * dt;

  if (modifiers.hardStop) {
    state.speed      = 0;
    state.velocity.x = 0;
    state.velocity.z = 0;
  }

  return state;
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

// ---- Gestion des matchs ----

const matches = new Map();

/**
 * Démarre un match.
 */
export async function startMatch(matchId, players, io, roomId) {
  const cfg      = await _chargerConfig();
  const poolData = await _chargerBlockPool();

  if (!poolData.depart)  throw new Error('Blocmap de départ introuvable');
  if (!poolData.arrivee) throw new Error("Blocmap d'arrivée introuvable");
  if (poolData.pool.length === 0) throw new Error('Pool de blocs vide');

  const map = _genererMap(poolData, cfg);
  const blockScale = map.blockScale;

  const playerStates = new Map();
  const socketMap    = new Map();
  const playerInfos  = [];

  players.forEach((p, i) => {
    const decalage = (i - (players.length - 1) / 2) * 1.5;
    const stats    = p.vehicle?.stats ?? {};
    const playerId = p.vehicle?.id ?? `player_${i}_${Date.now()}`;

    socketMap.set(p.socketId, playerId);

    playerStates.set(playerId, {
      playerId,
      playerName:   p.playerName,
      vehicleStats: {
        speed: stats.speed ?? cfg.vehicleStats.baseSpeed,
        grip:  stats.grip  ?? cfg.vehicleStats.baseGrip,
        accel: stats.accel ?? cfg.vehicleStats.baseAccel,
      },
      physicsState: {
        position: { x: map.startPosition.x, z: map.startPosition.z + decalage },
        velocity: { x: 0, z: 0 },
        angle:    map.startPosition.angle,
        speed:    0,
        drifting: false,
      },
      latestInputs: { steering: 0, braking: 0, reversing: 0 },
      connected:    true,
      terrainState: { lastTerrain: null, onRamp: false, boostTimer: 0, rampTimer: 0 },
    });

    playerInfos.push({
      playerId,
      socketId:   p.socketId,
      playerName: p.playerName,
      vehicle:    p.vehicle,
    });
  });

  let lastTick = Date.now();

  const intervalId = setInterval(() => {
    const now = Date.now();
    const dt  = Math.min((now - lastTick) / 1000, 0.1);
    lastTick  = now;

    for (const ps of playerStates.values()) {
      const ts = ps.terrainState;

      const terrain = _checkTerrain(ps.physicsState.position, map.blocks, blockScale);

      if (terrain.softTerrain === 'boost' && ts.lastTerrain !== 'boost') ts.boostTimer = 1.5;
      if (terrain.softTerrain === 'ramp') {
        ts.onRamp = true;
      } else if (ts.onRamp) {
        ts.rampTimer = 1.0;
        ts.onRamp    = false;
      }
      ts.lastTerrain  = terrain.softTerrain;
      ts.boostTimer   = Math.max(0, ts.boostTimer - dt);
      ts.rampTimer    = Math.max(0, ts.rampTimer  - dt);

      const modifiers = {};
      if (!terrain.hardCollision) {
        if (terrain.softTerrain === 'sticky') {
          modifiers.maxSpeedMultiplier = 0.5;
        } else if (ts.boostTimer > 0) {
          modifiers.maxSpeedMultiplier = 1.5;
        } else if (ts.rampTimer > 0) {
          modifiers.maxSpeedMultiplier = 1.3;
        }
      }

      _tickPhysique(ps.physicsState, ps.vehicleStats, ps.latestInputs, dt, cfg, modifiers);

      if (terrain.hardCollision) {
        // Rebond élastique sur mur (E03-S09) — formule : velocity -= wallNormal × v_dot × (1 + restitution)
        const px  = terrain.pushX;
        const pz  = terrain.pushZ;
        const len = Math.sqrt(px * px + pz * pz);
        if (len > 0.001) {
          const nx    = px / len;
          const nz    = pz / len;
          const st    = ps.physicsState;
          const v_dot = st.velocity.x * nx + st.velocity.z * nz;
          const res   = cfg.physics.restitution ?? 0.5;
          if (v_dot < 0) {
            st.velocity.x -= (1 + res) * v_dot * nx;
            st.velocity.z -= (1 + res) * v_dot * nz;
            st.speed       = Math.sqrt(st.velocity.x ** 2 + st.velocity.z ** 2);
          }
        }
        // Correction de position pour sortir du mur
        ps.physicsState.position.x += terrain.pushX;
        ps.physicsState.position.z += terrain.pushZ;
        ps.physicsState.drifting    = false;
      }
    }

    const positions = [...playerStates.values()].map(ps => ps.physicsState.position);
    const cohesion  = _calculerCohesion(positions, cfg.cohesion);

    const playersPayload = {};
    for (const [pid, ps] of playerStates) {
      const vel = ps.physicsState.velocity;

      // driftAngle : écart entre direction velocity et cap du véhicule (E03-S10)
      // 0 = droit devant, ≠ 0 = dérapage latéral perceptible
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
      };
    }

    io.to(roomId).emit('game:state', { matchId, players: playersPayload, cohesion });

    // Vérification de victoire
    MatchEnd.checkVictory(match);
  }, TICK_MS);

  const match = { id: matchId, playerStates, socketMap, map, intervalId, roomId, io, cfg };
  matches.set(matchId, match);
  console.log(`Match ${matchId} démarré — ${players.length} joueur(s), map ${map.gridCols}×${map.gridRows}`);

  return { map, playerInfos };
}

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
