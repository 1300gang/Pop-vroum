// Boucle de jeu autoritaire côté serveur.
//
// La conduite passe par game/vehicle-tick.js, le même module que le solo
// (test-v5) : sauts, rampes, bosses, cubes poussables, poteaux cassables, aide
// couloir. Le serveur fait aussi autorité sur la perte de voxels (game/damage.js)
// et sur l'état des cubes et poteaux (game/world-objects.js).
//
// Déroulé d'un match : « attente » (les joueurs passent de la page lobby à la
// page de jeu, personne ne bouge) → « decompte » → « course ».
//
// API publique :
//   startMatch(matchId, players, io, roomId) → Promise<{map, playerInfos}>
//   rejoinPlayer(matchId, playerId, newSocketId, socket) → boolean
//   getSnapshot(matchId)                      → état courant (pour un rejoin)
//   applyInput(matchId, socketId, inputs)     → void
//   stopMatch(matchId)                        → void
//   getMatch(matchId)                         → MatchState | null
//   getPlayerIdBySocket(matchId, socketId)    → string | null

import { readFile, readdir } from 'fs/promises';
import { join, dirname }     from 'path';
import { fileURLToPath }     from 'url';
import * as MatchEnd         from './match-end.js';

// Modules partagés client/serveur (pur JS, pas de dépendances navigateur)
import { setConfig as setPhysicsConfig } from '../public/js/modules/game/physics.js';
import { boundsFromExtent, setConfig as setCollisionConfig } from '../public/js/modules/game/collision.js';
import {
  setConfig as setPowersConfig,
  createPowerState, createPowerWorld, computeEffects, foldEffects,
} from '../public/js/modules/game/power-effects.js';
import {
  setConfig as setMapGenConfig,
  generate  as generateMapData,
  dedupePoolById,
  prepareBlockForGame,
  BLOCK_SIZE,
} from '../public/js/modules/game/map-generator.js';
import { createVehicleSim, tickVehicle } from '../public/js/modules/game/vehicle-tick.js';
import { resolveCollision, rebuildPowerState } from '../public/js/modules/game/damage.js';
import { createWorldObjects, findBlockAt } from '../public/js/modules/game/world-objects.js';
import { buildNavGrid } from '../public/js/modules/game/navigation.js';
import * as movables from '../public/js/modules/game/movables.js';
import { statsFromGrid } from '../public/js/modules/voxel/stats.js';

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

  // Hauteur de plateau : vit dans layout.json (partagée avec le rendu client)
  const layout = JSON.parse(await readFile(join(__dirname, '..', 'config', 'layout.json'), 'utf-8'));
  _config.plateauHeight = layout.PLATEAU_HEIGHT ?? 0.5;

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

// ---- Véhicule reçu du lobby ----

const COULEURS = new Set(['red', 'green', 'blue', 'orange', 'violet', 'pink']);

// Grille 8×4×4 nettoyée : seules des cellules { color } connues passent. Le
// véhicule arrive d'un navigateur ; une grille malformée ferait planter la
// boucle pour tout le monde. Renvoie null si la forme n'est pas la bonne.
function _grilleValide(grid) {
  if (!Array.isArray(grid) || grid.length !== 8) return null;
  const propre = [];
  for (let x = 0; x < 8; x++) {
    if (!Array.isArray(grid[x]) || grid[x].length !== 4) return null;
    propre.push([]);
    for (let z = 0; z < 4; z++) {
      if (!Array.isArray(grid[x][z]) || grid[x][z].length !== 4) return null;
      propre[x].push(grid[x][z].map(c => (c && COULEURS.has(c.color)) ? { color: c.color } : null));
    }
  }
  return propre;
}

/**
 * Véhicule tel que le serveur le suit pendant le match : stats et pouvoirs
 * recalculés depuis la grille (mêmes règles que le client), plus les copies
 * d'origine dont resolveImpact a besoin.
 */
function _preparerVehicule(brut, cfg) {
  const grid = _grilleValide(brut?.grid);
  if (!grid) {
    // Sans grille exploitable : véhicule neutre, qui ne perd pas de voxels
    const vs = cfg.vehicleStats;
    const stats = { speed: vs.baseSpeed, grip: vs.baseGrip, accel: vs.baseAccel };
    return { grid: null, stats, powers: {}, originalStats: stats, originalPowers: {} };
  }
  const { stats, powers } = statsFromGrid(grid, cfg);
  return {
    grid,
    originalGrid:   grid.map(col => col.map(row => [...row])),
    stats,          originalStats:  { ...stats },
    powers,         originalPowers: { ...powers },
  };
}

// Stats normalisées (1 = aucun voxel de la couleur), même calcul que test-v5
function _statsNormalisees(vehicule, vs) {
  return {
    speed: vehicule.originalStats.speed / vs.baseSpeed,
    grip:  vehicule.originalStats.grip  / vs.baseGrip,
    accel: vehicule.originalStats.accel / vs.baseAccel,
  };
}

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

  // Cubes et poteaux : recensés avant l'envoi de la map, pour que les cellules
  // de cube portent déjà leur position réelle chez tout le monde.
  const objets = createWorldObjects(mapData);

  const physCfg = cfg.physics;
  const world = {
    blocks:        mapData.blocks,
    blockScale,
    bounds:        fenceBounds,
    nav:           buildNavGrid(mapData),
    consts:        physCfg,
    plateauHeight: cfg.plateauHeight,
    vehicleScale:  physCfg.vehicleScale ?? 0.28,
    // La liste des cubes ne change pas, seules leurs positions : un tableau se
    // parcourt autant de fois qu'il faut, un itérateur de Map une seule.
    cubes:         [...objets.cubes.values()],
    poles:         objets.poles,
  };

  const playerStates = new Map();
  const socketMap    = new Map();
  const playerInfos  = [];

  players.forEach((p, i) => {
    const playerId = p.vehicle?.id ?? `player_${i}_${Date.now()}`;
    socketMap.set(p.socketId, playerId);

    // SOLO-05 : spawn aux positions calculées dans le bloc départ
    const spawnPos = mapData.entry?.spawnPositions?.[i]
                  ?? mapData.entry?.spawnPositions?.[0]
                  ?? mapData.startPosition;
    const sim = createVehicleSim({
      x: spawnPos.x, z: spawnPos.z,
      angle: spawnPos.angle ?? mapData.startPosition?.angle ?? 0,
    });

    const vehicule = _preparerVehicule(p.vehicle, cfg);

    playerStates.set(playerId, {
      playerId,
      playerName:   p.playerName,
      vehicule,
      baseStats:    _statsNormalisees(vehicule, cfg.vehicleStats),
      // Pouvoirs : le serveur fait autorité (prd_pouvoirs.md §8)
      powerState:   createPowerState(vehicule.powers),
      sim,
      // Alias lu par match-end et la cohésion : la voiture de la simulation
      physicsState: sim.car,
      latestInputs: { steering: 0, braking: 0, reversing: 0 },
      connected:    true,
      // Passé à true quand la page de jeu de ce joueur s'est reconnectée
      rejoint:      false,
    });

    playerInfos.push({
      playerId,
      socketId:   p.socketId,
      playerName: p.playerName,
      // La grille nettoyée remplace celle reçue : tout le monde part de la même
      vehicle:    { ...(p.vehicle ?? {}), grid: vehicule.grid },
    });
  });

  // Traînées de sillage du match. Elles vivent ici et pas dans le module :
  // le serveur fait tourner plusieurs matchs à la fois.
  const powerWorld = createPowerWorld();

  const match = {
    id: matchId, playerStates, socketMap, map: mapData, roomId, io, cfg,
    world, powerWorld,
    // Ids de tous les poteaux au départ : world.poles perd ceux qui tombent
    polesInitiaux: [...objets.poles.keys()],
    phase:      'attente',
    attenteFin: Date.now() + (cfg.match?.waitForPlayersSec ?? 20) * 1000,
    departA:    null,
    lastTick:   Date.now(),
    intervalId: null,
  };
  match.intervalId = setInterval(() => _tickMatch(match), TICK_MS);
  matches.set(matchId, match);
  console.log(`Match ${matchId} démarré — ${players.length} joueur(s), map ${mapData.gridCols}×${mapData.gridRows}`);

  return { map: mapData, playerInfos };
}

// ---- Tick d'un match ----

function _tickMatch(match) {
  const { playerStates, world, cfg, io, roomId } = match;
  const matchId = match.id;
  const now = Date.now();
  const dt  = Math.min((now - match.lastTick) / 1000, 0.1);
  match.lastTick = now;

  _avancerPhase(match, now);
  const enCourse = match.phase === 'course';
  const events   = [];

  // ---- Pouvoirs : une seule passe, avant la physique ----
  // Les effets sont recalculés à chaque tick puis repliés dans les stats par
  // vehicle-tick. Ils ne sont jamais écrits dans les stats du véhicule : c'est
  // ce qui les empêche de se cumuler d'une frame à l'autre.
  let effetsParJoueur = {};
  if (enCourse) {
    const vuePouvoirs = [...playerStates.values()].map(ps => ({
      id:       ps.playerId,
      position: ps.sim.car.position,
      y:        ps.sim.car.y ?? 0,
      angle:    ps.sim.car.angle,
      speed:    ps.sim.car.speed,
      power:    ps.powerState,
    }));
    const { effects } = computeEffects(vuePouvoirs, match.powerWorld, dt, now / 1000);
    effetsParJoueur = foldEffects(effects);

    for (const ps of playerStates.values()) {
      const ev = tickVehicle(ps.sim, ps.latestInputs, world, dt, {
        stats: ps.baseStats,
        fx:    effetsParJoueur[ps.playerId],
      });
      _traiterEvenements(ps, ev, world, cfg, events);
    }

    // Cubes poussés : ils glissent, frottent, se transmettent l'élan
    movables.tick(world.cubes, dt, world.blockScale, cfg.physics,
      (x, z) => findBlockAt(match.map, x, z));
  }

  const positions = [...playerStates.values()].map(ps => ps.sim.car.position);
  const cohesion  = _calculerCohesion(positions, cfg.cohesion);

  const playersPayload = {};
  for (const [pid, ps] of playerStates) {
    const car = ps.sim.car;
    const vel = car.velocity;
    const velocityAngle = Math.atan2(vel.x, vel.z);
    let driftAngle = velocityAngle - car.angle;
    if (driftAngle >  Math.PI) driftAngle -= 2 * Math.PI;
    if (driftAngle < -Math.PI) driftAngle += 2 * Math.PI;

    playersPayload[pid] = {
      playerName: ps.playerName,
      position:   { x: car.position.x, z: car.position.z },
      velocity:   { x: vel.x, z: vel.z },
      angle:      car.angle,
      speed:      car.speed,
      drifting:   car.drifting,
      driftAngle,
      elevation:  car.elevation ?? 0,
      // Hauteur réelle (sauts, plateaux) et vitesse verticale pour le tangage en vol
      y:          car.y ?? 0,
      vy:         car.vy ?? 0,
      airborne:   !!car.airborne,
      // Ce qui agit sur moi en ce moment — le client s'en sert pour les
      // flashs et les halos, au lieu de redétecter chacun dans son coin.
      effects:    _payloadEffets(effetsParJoueur[pid]),
      shield:     _payloadBouclier(ps.powerState),
    };
  }

  io.to(roomId).emit('game:state', {
    matchId,
    phase:     match.phase,
    // Secondes avant le départ pendant le décompte (null sinon)
    departDans: match.phase === 'decompte' ? Math.max(0, (match.departA - now) / 1000) : null,
    players:   playersPayload,
    cohesion,
    // Cubes encore en mouvement : les autres n'ont pas bougé depuis le dernier envoi
    cubes:     _payloadCubes(world.cubes),
    // Ce qui s'est passé pendant ce tick (chocs, sauts, poteaux…), pour les effets
    events,
  });

  if (enCourse) MatchEnd.checkVictory(match);
}

// attente → decompte → course. On attend que chaque joueur ait rechargé sa page
// de jeu (sinon il partirait sans voir sa voiture), avec un délai maximal pour
// qu'un joueur perdu en route ne bloque pas les autres.
function _avancerPhase(match, now) {
  if (match.phase === 'attente') {
    // Pas de « || !connected » : en quittant la page lobby, chaque joueur se
    // déconnecte un instant avant que sa page de jeu ne rejoigne — il serait
    // compté comme parti et le décompte partirait sans lui.
    const tousLa = [...match.playerStates.values()].every(ps => ps.rejoint);
    if (tousLa || now >= match.attenteFin) {
      match.phase   = 'decompte';
      match.departA = now + (match.cfg.match?.countdownSec ?? 3) * 1000;
    }
  }
  if (match.phase === 'decompte' && now >= match.departA) {
    match.phase = 'course';
    match.lastTick = now;
  }
}

// ---- Événements d'un véhicule ----

function _traiterEvenements(ps, ev, world, cfg, events) {
  const id = ps.playerId;
  const physCfg = cfg.physics;

  if (ev.landed)        events.push({ t: 'atterrissage', id, impact: ev.landed.impact });
  if (ev.boostEntered)  events.push({ t: 'boost', id });
  if (ev.stickyEntered) events.push({ t: 'collant', id });
  if (ev.driftCharge?.libere) events.push({ t: 'turbo', id, charge: ev.driftCharge.charge });
  if (ev.poleBroken)    events.push({ t: 'poteau', poteau: ev.poleBroken.key });

  const c = ev.contact;
  if (!c) return;

  // Frottement : seulement quand il y a de quoi faire des étincelles
  if (c.fresh || c.tangentSpeed > (physCfg.scrapeMinSpeed ?? 2)) {
    events.push({
      t: 'mur', id, choc: c.fresh,
      n: [c.normal.x, c.normal.z], v: c.tangentSpeed,
    });
  }

  if (!c.fresh || !c.dmg.damaged || !ps.vehicule.grid) return;

  // Choc endommageant : le bouclier encaisse d'abord, puis la carrosserie
  const res = resolveCollision(
    ps.vehicule, ps.powerState, c.dmg, ps.sim.car.angle, physCfg.voxelLossSpeed ?? 8,
  );
  if (res.absorbed > 0) {
    events.push({ t: 'bouclier', id, hp: ps.powerState.shield?.hp ?? 0, brise: res.shieldBroken });
  }
  if (res.removedVoxels.length > 0) {
    ps.sim.degats  = res.degats;
    // Perdre du bleu affaiblit le sillage, du orange le bouclier…
    ps.powerState  = rebuildPowerState(ps.powerState, ps.vehicule.powers);
    events.push({
      t: 'degats', id, dv: c.dmg.deltaSpeed,
      voxels: res.removedVoxels.map(v => ({ x: v.x, z: v.z, y: v.y, color: v.color })),
    });
  }
}

// Cubes en mouvement : { id, x, z } — null quand tout est immobile. Un cube
// qui vient de s'arrêter est envoyé une dernière fois, pour que tout le monde
// ait sa position finale.
function _payloadCubes(cubes) {
  const envois = [];
  for (const c of cubes) {
    const bouge = c.vx !== 0 || c.vz !== 0;
    if (bouge || c.bougeait) envois.push({ id: c.id, x: c.mesh.position.x, z: c.mesh.position.z });
    c.bougeait = bouge;
  }
  return envois.length > 0 ? envois : null;
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
  const ps = match.playerStates.get(playerId);
  ps.connected = true;
  ps.rejoint   = true;   // sa page de jeu est prête : le départ peut l'attendre

  socket.join(match.roomId);

  console.log(`Rejoin : ${playerId} → socket ${newSocketId} (match ${matchId})`);
  return true;
}

/**
 * État courant d'un match, pour une page qui (re)arrive en cours de route : la
 * map envoyée au lancement était vierge, ce qui a changé depuis est ici —
 * voxels perdus, poteaux tombés, cubes déplacés.
 * @returns {{ phase, vehicules: {[playerId]: grid}, poteauxTombes: string[],
 *             cubes: Array<{id,x,z}> } | null}
 */
export function getSnapshot(matchId) {
  const match = matches.get(matchId);
  if (!match) return null;
  const vehicules = {};
  for (const [pid, ps] of match.playerStates) vehicules[pid] = ps.vehicule.grid;
  const poteauxTombes = [];
  for (const id of match.polesInitiaux) {
    if (!match.world.poles.has(id)) poteauxTombes.push(id);
  }
  return {
    phase: match.phase,
    vehicules,
    poteauxTombes,
    cubes: match.world.cubes.map(c => ({ id: c.id, x: c.mesh.position.x, z: c.mesh.position.z })),
  };
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
