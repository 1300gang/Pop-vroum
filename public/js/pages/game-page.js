// Point d'entrée page jeu multijoueur — Stories 5.1-5.4
//
// Flux :
//   1. Lire matchId, playerId, map, players depuis sessionStorage
//   2. Connecter le socket et envoyer game:rejoin
//   3. Construire scène + map + véhicules de chaque joueur
//   4. Démarrer sync (envoi inputs 30 Hz, réception game:state)
//   5. Boucle de rendu : positions interpolées, caméra groupe, skid, HUD

import * as THREE from '../lib/three.module.js';
import { buildVehicleGroup, createPreviewScene, applyRoll } from '../modules/voxel/renderer.js';
import * as controls  from '../modules/game/controls.js';
import * as camera    from '../modules/game/camera.js';
import * as skid      from '../modules/game/skid.js';
import * as particles from '../modules/game/particles.js';
import * as powers    from '../modules/game/powers.js';
import { cohesionState } from '../modules/game/cohesion.js';
import * as cohesionView from '../modules/game/cohesion-view.js';
import * as Client    from '../modules/network/client.js';
import * as Sync      from '../modules/network/sync.js';
import { initMinimap, updateMinimap } from '../modules/game/minimap.js';
import { boundsFromExtent } from '../modules/game/collision.js';
import { buildFence } from '../modules/game/fence.js';
import { applyImpactDamage } from '../modules/voxel/impact.js';
import { recalcStats, computeStats } from '../modules/voxel/stats.js';

// ---- Constantes ----

const VEHICLE_SCALE = 0.28;
const BLOCK_SIZE    = 8;

const COULEUR_HEX = {
  red: '#e62020', green: '#1fa830', blue: '#1a52e0',
  orange: '#f07418', violet: '#7d2dc0', pink: '#e882b9',
};

const COULEUR_FR = {
  red: 'rouge', green: 'vert', blue: 'bleu',
  orange: 'orange', violet: 'violet', pink: 'rose',
};

// Couleur majoritaire de la grille voxel — pour teinter les effets (poussière de drift)
// selon le véhicule plutôt qu'une couleur neutre fixe.
function _couleurDominante(grid) {
  if (!grid) return '#c8b89a';
  const comptage = {};
  for (let x = 0; x < 8; x++)
    for (let z = 0; z < 4; z++)
      for (let y = 0; y < 4; y++) {
        const c = grid[x]?.[z]?.[y];
        if (c) comptage[c.color] = (comptage[c.color] || 0) + 1;
      }
  const [dominant] = Object.entries(comptage).sort((a, b) => b[1] - a[1])[0] ?? [];
  return dominant ? COULEUR_HEX[dominant] ?? '#c8b89a' : '#c8b89a';
}

const POUVOIR_INFO = {
  aspiration: { nom: 'Aspiration', couleur: '#ff3333' },
  phares:     { nom: 'Phares',     couleur: '#44ff44' },
  sillage:    { nom: 'Sillage',    couleur: '#3388ff' },
  shield:     { nom: 'Bouclier',   couleur: '#ff8800' },
};

const TYPES_CELLULE = {
  null:   { couleur: 0x3a3a4a, hauteur: 0.0 },
  dur:    { couleur: 0x4a5060, hauteur: 0.6 },
  ramp:   { couleur: 0xffb84d, hauteur: 0.6 },
  boost:  { couleur: 0x00d4ff, hauteur: 0.05 },
  sticky:      { couleur: 0x88ff66, hauteur: 0.05 },
  rampe_bosse: { couleur: 0xe8a020, hauteur: 0.18 },
  // SOLO-04 : nouveaux éléments
  ramp_n:  { couleur: 0xaaaaff, hauteur: 0.5 },
  ramp_s:  { couleur: 0xaaaaff, hauteur: 0.5 },
  ramp_e:  { couleur: 0xaaaaff, hauteur: 0.5 },
  ramp_o:  { couleur: 0xaaaaff, hauteur: 0.5 },
  bump:    { couleur: 0xcc8844, hauteur: 0.3 },
  movable: { couleur: 0xff6644, hauteur: 1.0 },
  pole:    { couleur: 0xffffff, hauteur: 2.5 },
};

const PLATEAU_HEIGHT      = 0.5;
const PLATEAU_FLOOR_H     = 0.15;
const PLATEAU_COULEUR_SOL = 0x444455;
const TRANSITION_THICK    = 0.06;

// ---- Lecture sessionStorage ----

const _matchId   = sessionStorage.getItem('pop-vroum:matchId');
const _playerId  = sessionStorage.getItem('pop-vroum:playerId');
const _map       = _parseJSON('pop-vroum:map');
const _allPlayers = _parseJSON('pop-vroum:players') ?? [];
const _monVehicule = JSON.parse(localStorage.getItem('pop-vroum:vehicule-courant') ?? 'null');

function _parseJSON(key) {
  try { return JSON.parse(sessionStorage.getItem(key)); }
  catch { return null; }
}

// ---- État global ----

let _scene, _renderer, _cam, _preview;
let _last = performance.now();

// playerId → { group: THREE.Group }
const _vehicleMeshes = new Map();
// stocke le handle retourné par powers.createForVehicle (un par joueur)
const _powersHandles  = new Map();

// SOLO-07 : groupes Three.js par bloc pour culling Chebyshev ("col,row" → Group)
const _blockGroups = new Map();
let _renderDistance = 3;
let _fenceCfg       = null;  // config map.fence — visuel seul, le serveur fait la collision
let _physConsts     = null;   // /config/gameplay.json → physics (réglage du roulis)
let _cohesionCfg    = null;   // /config/gameplay.json → cohesion (rayon + anneaux)

// SOLO-06
let _minimapInstance = null;

// SOLO-08 : détection de collision client-side (chute de vitesse) pour effets visuels
const _prevSpeeds = new Map(); // playerId → speed du tick précédent
const COLLISION_SPEED_DROP = 3.0; // seuil de chute de vitesse pour déclencher les effets

// SOLO-08 : flèches debug vélocité/forward
let _arrowVelocity = null;
let _arrowForward  = null;
let _debugArrows   = false;

// ---- Debug / Calibration (port test-solo-v3) ----

let _overlayVisible   = false;
let _calibVisible     = false;
let _debugPhysVisible = false;
let _autoLoop         = false;
let _autoSteer        = 0;
let _autoTimer        = 0;

let _speedStat = 0.5;
let _gripStat  = 0.5;
let _accelStat = 0.5;
let _seuilChoc = COLLISION_SPEED_DROP; // remplace la constante en runtime

const PROFILS_CALIBRATION = {
  equilibre:  { speed: 0.5, grip: 0.5, accel: 0.5 },
  drift:      { speed: 0.7, grip: 0.2, accel: 0.6 },
  tank:       { speed: 0.3, grip: 0.8, accel: 0.3 },
  fusee:      { speed: 1.0, grip: 0.4, accel: 1.0 },
  savonnette: { speed: 0.5, grip: 0.1, accel: 0.5 },
};

// FPS / chocs / overlay
let _fpsSamples    = [];
let _nbChocs       = 0;
let _dernierDeltaV = 0;
let _dernierVlat   = 0;

// Charts circulaires (5 s × 60 fps)
const CHART_MAX  = 300;
const _speedHist = new Float32Array(CHART_MAX);
const _vlatHist  = new Float32Array(CHART_MAX);
let   _chartHead = 0;

// Stats de session (tour local)
let _lapStart    = 0;
let _lapSpeedMax = 0;
let _lapSpeedSum = 0;
let _lapFrames   = 0;
let _lapChocs    = 0;

// Compte des voxels initiaux du joueur (pour panel calibration)
let _voxelsTotal    = 0;
let _voxelsRestants = 0;

// Copie locale du véhicule du joueur (pour dommages côté client)
let _localVehicleData = null;

const MASSE_PAR_BLOC = 25;

const $ = id => document.getElementById(id);

function _compterVoxels(grid) {
  if (!grid) return 0;
  let n = 0;
  for (const colX of grid) {
    for (const colZ of colX) {
      for (const voxel of colZ) {
        if (voxel !== null && voxel !== undefined) n++;
      }
    }
  }
  return n;
}

// ---- Initialisation ----

function _progression(pct, msg) {
  $('loading-bar').style.width = pct + '%';
  if (msg) $('loading-msg').textContent = msg;
}

async function init() {
  if (!_matchId || !_playerId || !_map) {
    $('loading-msg').textContent = 'Données de partie manquantes. Retourne au lobby.';
    return;
  }

  // Chargement config (RENDER_DISTANCE SOLO-07)
  try {
    const cfg = await fetch('/config/gameplay.json').then(r => r.json());
    _renderDistance = cfg.physics?.RENDER_DISTANCE ?? 3;
    _physConsts     = cfg.physics ?? null;
    _cohesionCfg    = cfg.cohesion ?? null;
    _fenceCfg       = cfg.map?.fence ?? null;
  } catch { /* défauts conservés */ }

  _progression(10, 'Création de la scène…');

  const canvas = $('jeu');

  // Scène Three.js
  _scene = new THREE.Scene();
  _scene.background = new THREE.Color(0x1a1a2e);
  _scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(20, 40, 10);
  _scene.add(dir);

  // Renderer
  _renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  _renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  _renderer.setSize(window.innerWidth, window.innerHeight, false);

  // Caméra isométrique
  _cam = camera.createCamera(window.innerWidth, window.innerHeight);

  // Preview 3D (mon véhicule)
  _preview = createPreviewScene($('preview'));

  // Modules jeu
  controls.init(canvas);
  skid.init(_scene);
  particles.init(_scene);
  await powers.init(_scene);
  cohesionView.init(_scene, _cohesionCfg?.halo);

  // SOLO-08 : flèches debug vélocité/forward (masquées par défaut, touche D)
  _arrowVelocity = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 3, 0x4488ff, 0.5, 0.3
  );
  _arrowForward = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 2.5, 0xff8800, 0.4, 0.25
  );
  _arrowVelocity.visible = false;
  _arrowForward.visible  = false;
  _scene.add(_arrowVelocity);
  _scene.add(_arrowForward);

  _progression(30, 'Construction de la map…');

  // Map
  const mapGroup = _construireMeshMap(_map);
  _scene.add(mapGroup);

  // SOLO-05 : position d'arrivée pour les flèches de navigation
  const fpExit = _map?.exit?.worldCenter ?? _map?.finishPosition;
  if (fpExit) powers.setFinishPosition(fpExit.x, fpExit.z);

  // SOLO-06 : mini-carte
  _minimapInstance = initMinimap(_map, document.body);

  _progression(50, 'Création des véhicules…');

  // Véhicules de chaque joueur + pouvoirs
  for (const p of _allPlayers) {
    const group = _creerGroupeVehicule(p);
    group.scale.set(VEHICLE_SCALE, VEHICLE_SCALE, VEHICLE_SCALE);
    _scene.add(group);
    _vehicleMeshes.set(p.playerId, { group });

    // Pouvoirs : si absents/vides mais grid présente, on les recalcule depuis la grille
    let pwValues = p.vehicle?.powers;
    const sumPow = pwValues
      ? Object.values(pwValues).reduce((a, b) => a + (b || 0), 0)
      : 0;
    if ((!pwValues || sumPow === 0) && p.vehicle?.grid) {
      try {
        const recomputed = await computeStats(p.vehicle.grid);
        pwValues = recomputed.powers;
        p.vehicle.powers = pwValues;
        if (p.playerId === _playerId) p.vehicle.stats = recomputed.stats;
      } catch (err) {
        console.warn('[powers] échec recompute pour', p.playerId, err);
        pwValues = {};
      }
    }
    _powersHandles.set(p.playerId, powers.createForVehicle(p.playerId, pwValues ?? {}));
  }

  // Preview de mon propre véhicule
  if (_monVehicule?.grid && _monVehicule?.wheelPositions) {
    try { _preview.setGroup(buildVehicleGroup(_monVehicule)); } catch {}
  }

  // HUD statique
  _mettreAJourHUDStatique();

  // Compte voxels initiaux pour panel calibration + copie locale pour dommages
  const moi = _allPlayers.find(p => p.playerId === _playerId);
  const monVehiculeBase = moi?.vehicle ?? _monVehicule;
  if (monVehiculeBase?.grid) {
    _localVehicleData = {
      ...monVehiculeBase,
      grid:          monVehiculeBase.grid.map(c => c.map(r => [...r])),
      originalGrid:  monVehiculeBase.grid.map(c => c.map(r => [...r])),
      originalStats: { ...(monVehiculeBase.stats ?? {}) },
    };
  }
  _voxelsTotal    = _compterVoxels(monVehiculeBase?.grid);
  _voxelsRestants = _voxelsTotal;
  const blocsEl = $('val-blocs');
  if (blocsEl) blocsEl.textContent = _voxelsTotal || '–';
  const poidsEl = $('val-poids');
  if (poidsEl) poidsEl.textContent = _voxelsTotal > 0 ? `${_voxelsTotal * MASSE_PAR_BLOC} kg` : '– kg';

  _initDebugUI();

  _progression(70, 'Connexion au serveur…');

  // Connexion + rejoin
  await Client.init();

  const rejoinOk = await new Promise((resolve) => {
    Client.once('game:rejoin:ok', () => resolve(true));
    Client.once('game:rejoin:error', ({ message }) => {
      console.error('[game] rejoin échoué :', message);
      resolve(false);
    });
    Client.emit('game:rejoin', { matchId: _matchId, playerId: _playerId });
  });

  if (!rejoinOk) {
    $('loading-msg').textContent = 'Impossible de rejoindre la partie. Elle a peut-être expiré.';
    return;
  }

  _progression(90, 'Lancement…');

  // Démarrer la sync (envoi inputs + réception états) — wrap pour auto-loop
  Sync.start(() => _getInputsAvecAuto());

  // Démarre le compteur de tour
  _lapStart    = performance.now();
  _lapSpeedMax = 0;
  _lapSpeedSum = 0;
  _lapFrames   = 0;
  _lapChocs    = 0;

  // Arrivée d'un joueur : mini-bannière temporaire
  Client.on('game:player-arrived', ({ playerId, ordre }) => {
    const info = _allPlayers.find(p => p.playerId === playerId);
    const nom  = info?.playerName ?? playerId;
    if (playerId === _playerId) {
      $('banner').textContent = '🏁 Arrivée !';
      $('banner').style.display = 'block';
      setTimeout(() => { $('banner').style.display = 'none'; }, 3000);
      _afficherResultatsSession();
    }
    console.log(`[victoire] ${nom} arrivé·e en position ${ordre}`);
  });

  // Victoire collective : afficher le podium
  Client.once('game:victory', ({ podium }) => {
    _afficherPodium(podium);
  });

  _progression(100, '');
  $('loading').style.display = 'none';

  window.addEventListener('resize', _onResize);

  // Raccourcis clavier : D overlay+arrows, C calibration, A auto, P debug-phys
  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if (k === 'd') _toggleOverlay();
    if (k === 'c') _toggleCalibration();
    if (k === 'a') _toggleAuto();
    if (k === 'p') _toggleDebugPhys();
  });

  // Bouton quitter
  $('btn-quitter').addEventListener('click', () => {
    $('modale-quitter').classList.add('visible');
  });
  $('btn-annuler-quitter').addEventListener('click', () => {
    $('modale-quitter').classList.remove('visible');
  });
  $('btn-confirmer-quitter').addEventListener('click', () => {
    Client.disconnect();
    window.location.href = '/';
  });

  _last = performance.now();
  requestAnimationFrame(_boucle);
}

// ---- Boucle de rendu ----

function _boucle(now) {
  // FPS (moyenne glissante 60 frames)
  const dtMs = now - _last;
  if (dtMs > 0) {
    const fps = 1000 / dtMs;
    _fpsSamples.push(fps);
    if (_fpsSamples.length > 60) _fpsSamples.shift();
  }

  const dt = Math.min(0.05, dtMs / 1000);
  _last = now;

  const playersState = Sync.getPlayerStates(now);
  const cohesion     = Sync.getCohesion();

  if (playersState) {
    const positions = [];

    for (const [pid, state] of Object.entries(playersState)) {
      const entry = _vehicleMeshes.get(pid);
      if (!entry) continue;

      // SOLO-08 : élévation du terrain (PLATEAU_HEIGHT) dans la hauteur Y
      const bs = _map?.blockScale ?? 1;
      const elevY = (state.elevation ?? 0) * PLATEAU_HEIGHT * bs;
      entry.group.position.set(state.position.x, 0.4 + elevY, state.position.z);
      entry.group.rotation.y = -state.angle;

      const vLatApprox = (state.speed ?? 0) * Math.sin(state.driftAngle ?? 0);
      // Fallback visuel : si le serveur n'a pas flag drifting mais qu'on glisse
      // visiblement (v_lateral > seuil), on affiche quand même les traces.
      const driftingVisuel = state.drifting || Math.abs(vLatApprox) > 1.0;
      applyRoll(entry.group, vLatApprox, dt, 'x', _physConsts);

      positions.push(state.position);

      // SOLO-08 : détection de collision client-side (chute de vitesse) → shake + étincelles
      const prevSpd = _prevSpeeds.get(pid) ?? state.speed;
      const speedDrop = prevSpd - state.speed;
      _prevSpeeds.set(pid, state.speed);

      if (speedDrop > _seuilChoc && state.velocity) {
        if (pid === _playerId) {
          _nbChocs++;
          _lapChocs++;
          _dernierDeltaV = speedDrop;
          _appliquerDommagesLocaux(state, speedDrop);
        }
        const spd = Math.max(0.01, state.speed);
        const wallNx = state.velocity.x / spd;
        const wallNz = state.velocity.z / spd;

        particles.emitSparks(
          { x: state.position.x, y: 0.3 + elevY, z: state.position.z },
          { x: -wallNx, z: -wallNz },
          Math.min(12, Math.floor(speedDrop))
        );

        if (pid === _playerId) {
          camera.shake(speedDrop * 0.3);
        }
      }

      // Skid marks + poussière pour tous les joueurs (fallback visuel inclus)
      if (driftingVisuel && state.velocity) {
        const spd       = Math.max(0.01, state.speed);
        const nx        = state.velocity.x / spd;
        const nz        = state.velocity.z / spd;
        const v_lateral = Math.abs(spd * Math.sin(state.driftAngle ?? 0));

        skid.emit(
          { x: state.position.x - nx * 0.6, z: state.position.z - nz * 0.6 },
          state.velocity,
          v_lateral
        );

        if (spd > 5 && Math.random() < 0.12) {
          const vehiculeJoueur = _allPlayers.find(p => p.playerId === pid)?.vehicle;
          particles.emitDust(
            { x: state.position.x - nx * 0.7, y: 0.15 + elevY, z: state.position.z - nz * 0.7 },
            state.velocity,
            _couleurDominante(vehiculeJoueur?.grid),
            1 + Math.floor(Math.random() * 2),
          );
        }
      }
    }

    skid.update();
    particles.update(dt);

    // Pouvoirs : le serveur fait autorité sur les effets et sur l'usure des
    // boucliers (server/game-loop.js) ; le client ne fait que les rendre.
    const allVehiclesView = [];
    const effetsServeur   = [];
    for (const [pid, s] of Object.entries(playersState)) {
      allVehiclesView.push({
        id:       pid,
        position: s.position,
        angle:    s.angle,
        speed:    s.speed,
      });
      powers.setShieldState(pid, s.shield ?? null);
      for (const type of s.effects?.types ?? []) {
        effetsServeur.push({ targetId: pid, effect: type, position: s.position });
      }
    }
    powers.update(allVehiclesView, dt, effetsServeur);

    // Cohésion rendue visible : un halo unique autour du groupe, dont le rayon
    // suit l'écartement. La jauge seule restait abstraite.
    const rayonCoh = _cohesionCfg?.radiusUnits ?? 8;
    cohesionView.update(
      allVehiclesView,
      cohesionState(allVehiclesView, rayonCoh),
      dt,
      rayonCoh,
    );

    // SOLO-08 : flèches debug vélocité/forward du joueur local
    if (_debugArrows) {
      const monDbg = playersState[_playerId];
      if (monDbg) {
        const dbgY = 0.9 + ((monDbg.elevation ?? 0) * PLATEAU_HEIGHT * (_map?.blockScale ?? 1));
        const pos = new THREE.Vector3(monDbg.position.x, dbgY, monDbg.position.z);
        _arrowVelocity.position.copy(pos);
        _arrowForward.position.copy(pos);

        const spd = monDbg.speed;
        if (spd > 0.1) {
          _arrowVelocity.setDirection(
            new THREE.Vector3(monDbg.velocity.x / spd, 0, monDbg.velocity.z / spd)
          );
          _arrowVelocity.setLength(Math.min(6, spd * 0.18), 0.5, 0.3);
        }
        _arrowForward.setDirection(
          new THREE.Vector3(Math.cos(monDbg.angle), 0, Math.sin(monDbg.angle))
        );
        _arrowForward.setLength(2.5, 0.4, 0.25);
      }
    }

    // Caméra suit le barycentre de tous les joueurs
    if (positions.length > 0) {
      camera.update(positions);
    }

    // HUD dynamique
    const monEtat = playersState[_playerId];
    if (monEtat) {
      $('speed-val').textContent = monEtat.speed.toFixed(1);
      const monVlat = (monEtat.speed ?? 0) * Math.sin(monEtat.driftAngle ?? 0);
      const driftAff = monEtat.drifting || Math.abs(monVlat) > 1.0;
      $('drift-label').style.display = driftAff ? '' : 'none';

      // Stats de session
      if (monEtat.speed > _lapSpeedMax) _lapSpeedMax = monEtat.speed;
      _lapSpeedSum += monEtat.speed;
      _lapFrames++;

      // v_lateral approx (depuis driftAngle serveur)
      _dernierVlat = (monEtat.speed ?? 0) * Math.sin(monEtat.driftAngle ?? 0);

      // Buffers charts (toujours alimentés)
      _speedHist[_chartHead] = monEtat.speed;
      _vlatHist[_chartHead]  = _dernierVlat;
      _chartHead = (_chartHead + 1) % CHART_MAX;

      // Mises à jour debug si visibles
      if (_debugPhysVisible) _mettreAJourDebugPhys(monEtat);
      if (_overlayVisible)   _mettreAJourOverlay(monEtat);
      if (_calibVisible)     _renderCharts(cohesion?.value ?? 0);
    }

    // SOLO-07 : culling Chebyshev par rapport au joueur local
    if (monEtat && _blockGroups.size > 0 && _map) {
      const bs        = _map.blockScale ?? 1;
      const bsize     = BLOCK_SIZE * bs;
      const pCol      = Math.floor(monEtat.position.x / bsize);
      const pRow      = Math.floor(monEtat.position.z / bsize);
      for (const [key, bg] of _blockGroups) {
        const sep = key.indexOf(',');
        const kc  = parseInt(key.slice(0, sep), 10);
        const kr  = parseInt(key.slice(sep + 1), 10);
        bg.visible = Math.max(Math.abs(kc - pCol), Math.abs(kr - pRow)) <= _renderDistance;
      }
    }

    // SOLO-06 : mise à jour mini-carte
    const minimapPlayers = Object.entries(playersState).map(([pid, s]) => ({
      id:      pid,
      position: s.position,
      isLocal:  pid === _playerId,
    }));
    updateMinimap(_minimapInstance, minimapPlayers);

    // Cohésion
    const pct = Math.round(cohesion.value * 100);
    $('cohesion-bar').style.width = pct + '%';
    $('cohesion-bar').classList.toggle('pleine', cohesion.isFull);
    $('cohesion-val').textContent = pct + ' %';
  }

  _renderer.render(_scene, _cam);
  requestAnimationFrame(_boucle);
}

// ---- Construction des meshes ----

function _creerGroupeVehicule(playerInfo) {
  const v = playerInfo.vehicle;
  if (v?.grid && v?.wheelPositions) {
    try { return buildVehicleGroup(v); } catch {}
  }
  // Fallback : cube coloré
  const geo = new THREE.BoxGeometry(1.5, 1.0, 2.0);
  const mat = new THREE.MeshStandardMaterial({ color: 0xff5e7a });
  const mesh = new THREE.Mesh(geo, mat);
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

// Prisme triangulaire montant en +X (de x=0 bas à x=cs haut).
// SOLO-04 : rampe directionnelle centrée — montant vers +X par défaut
function _creerGeomRampCentree(h, cs) {
  const hx = cs / 2, hz = cs / 2;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -hx, 0, -hz,   -hx, 0,  hz,
     hx, 0, -hz,    hx, 0,  hz,
     hx, h, -hz,    hx, h,  hz,
  ]), 3));
  geo.setIndex([
    0,2,3, 0,3,1,
    2,4,5, 2,5,3,
    0,4,2,
    1,3,5, 1,5,4,
    0,1,4,
  ]);
  geo.computeVertexNormals();
  return geo;
}

function _creerGeomRampX(h, cs) {
  const geo = new THREE.BufferGeometry();
  const v = new Float32Array([
    0, 0, 0,    cs, 0, cs,   cs, 0, 0,
    0, 0, 0,    0,  0, cs,   cs, 0, cs,
    cs, 0, 0,   cs, 0, cs,   cs, h, cs,
    cs, 0, 0,   cs, h, cs,   cs, h, 0,
    0, 0, 0,    cs, h, 0,    cs, h, cs,
    0, 0, 0,    cs, h, cs,   0,  0, cs,
    0, 0, 0,    cs, 0, 0,    cs, h, 0,
    0, 0, cs,   cs, h, cs,   cs, 0, cs,
  ]);
  geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
  geo.computeVertexNormals();
  return geo;
}

function _construireMeshMap(map) {
  const group = new THREE.Group();
  _blockGroups.clear();

  const cs = map.blockScale ?? 1;
  const { width, depth } = map.worldExtent;
  const blocmapSize = BLOCK_SIZE * cs;

  // Sol
  const solGeo = new THREE.PlaneGeometry(width + 8, depth + 8);
  const solMat = new THREE.MeshStandardMaterial({ color: 0x2a2a3e });
  const sol = new THREE.Mesh(solGeo, solMat);
  sol.rotation.x = -Math.PI / 2;
  sol.position.set(width / 2, -0.15, depth / 2);
  group.add(sol);

  // Cellules par bloc — groupes individuels pour le culling Chebyshev (SOLO-07)
  // Grilles déjà rotées par le serveur (server/game-loop.js _rotate90CW)
  for (const bloc of map.blocks) {
    const blocGroup = _construireMeshBloc(bloc, cs);
    _blockGroups.set(`${bloc.col},${bloc.row}`, blocGroup);
    group.add(blocGroup);
  }

  // SOLO-05 : dalle départ (coin 0,0) et arrivée (coin W-1,H-1)
  const blocGeo  = new THREE.PlaneGeometry(blocmapSize, blocmapSize);
  const entryPos = map.entry?.worldCenter ?? { x: blocmapSize * 0.5, z: blocmapSize * 0.5 };
  const exitPos  = map.exit?.worldCenter  ?? map.finishPosition;

  const departMat = new THREE.MeshBasicMaterial({ color: 0x66ff99, transparent: true, opacity: 0.35 });
  const depart    = new THREE.Mesh(blocGeo, departMat);
  depart.rotation.x = -Math.PI / 2;
  depart.position.set(entryPos.x, 0.02, entryPos.z);
  group.add(depart);

  if (exitPos) {
    const arriveeMat = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.45 });
    const arrivee    = new THREE.Mesh(blocGeo.clone(), arriveeMat);
    arrivee.rotation.x = -Math.PI / 2;
    arrivee.position.set(exitPos.x, 0.02, exitPos.z);
    group.add(arrivee);
  }

  // Clôture : rendu seul. La collision est calculée par le serveur (game-loop),
  // qui fait autorité ; le client ne fait que montrer où est la limite pour
  // qu'un mur invisible ne passe pas pour un bug.
  const fenceBounds = boundsFromExtent(map.worldExtent, _fenceCfg);
  const fence       = buildFence(fenceBounds, _fenceCfg ?? {});
  if (fence) group.add(fence);

  return group;
}

/**
 * Construit le groupe Three.js pour un seul bloc (SOLO-07 : culling Chebyshev).
 * SOLO-08 : gère l'élévation, les rampes_pente, les murs de transition (comme test-solo-v3).
 */
function _construireMeshBloc(bloc, cs) {
  const g = new THREE.Group();
  const [bx, bz] = bloc.position;
  const elevGrid = bloc.elevationGrid;

  for (let gz = 0; gz < BLOCK_SIZE; gz++) {
    for (let gx = 0; gx < BLOCK_SIZE; gx++) {
      const rawCell   = bloc.grid[gz]?.[gx];
      const cellType  = !rawCell ? null : (typeof rawCell === 'object' ? rawCell.type : rawCell);
      const cell      = cellType;
      const elevation = elevGrid?.[gz]?.[gx] ?? 0;
      const yOffset   = elevation * PLATEAU_HEIGHT * cs;
      const def       = TYPES_CELLULE[cell] ?? TYPES_CELLULE.null;

      // Cellule rampe_pente (objet) : rendu en prisme incliné
      if (cellType === 'rampe_pente' && typeof rawCell === 'object') {
        const { direction = 'E', elevation_start = 0, elevation_end = 1 } = rawCell;
        const yLow  = elevation_start * PLATEAU_HEIGHT * cs;
        const yHigh = elevation_end   * PLATEAU_HEIGHT * cs;
        const c     = cs / 2;
        const pos   = new Float32Array([
          -c, yLow,  -c,  -c, yLow,   c,   c, yLow,  -c,   c, yLow,   c,
          -c, yHigh,  c,   c, yHigh,  c,
        ]);
        const idx = [0,2,3, 0,3,1, 0,4,5, 0,5,2, 1,3,5, 1,5,4, 0,1,4, 2,5,3];
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({ color: 0xd07830 });
        const m   = new THREE.Mesh(geo, mat);
        // V4-02 : le prisme monte vers +Z (Sud) par défaut — E et O étaient inversées
        const rotY = direction === 'N' ? Math.PI
                   : direction === 'E' ?  Math.PI / 2
                   : direction === 'O' ? -Math.PI / 2
                   : 0;
        m.rotation.y = rotY;
        m.position.set(bx + gx * cs + cs / 2, 0, bz + gz * cs + cs / 2);
        g.add(m);
        continue;
      }

      // Sol surélevé : cellule vide (route) sur plateau
      if (!cell && elevation > 0) {
        const geo = new THREE.BoxGeometry(cs, PLATEAU_FLOOR_H * cs, cs);
        const mat = new THREE.MeshStandardMaterial({ color: PLATEAU_COULEUR_SOL });
        const m   = new THREE.Mesh(geo, mat);
        m.position.set(
          bx + gx * cs + cs / 2,
          yOffset + (PLATEAU_FLOOR_H * cs) / 2,
          bz + gz * cs + cs / 2,
        );
        g.add(m);
        continue;
      }

      if (def.hauteur === 0) continue;

      const mat = new THREE.MeshStandardMaterial({ color: def.couleur });
      let m;
      if (cell === 'ramp_n' || cell === 'ramp_s' || cell === 'ramp_e' || cell === 'ramp_o') {
        const geo = _creerGeomRampCentree(def.hauteur * cs, cs);
        m = new THREE.Mesh(geo, mat);
        m.rotation.y = cell === 'ramp_o' ? Math.PI
                     : cell === 'ramp_n' ? -Math.PI / 2
                     : cell === 'ramp_s' ?  Math.PI / 2
                     : 0;
        m.position.set(bx + gx * cs + cs / 2, yOffset, bz + gz * cs + cs / 2);
      } else if (cell === 'bump') {
        const geo = new THREE.SphereGeometry(cs * 0.45, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
        m = new THREE.Mesh(geo, mat);
        m.position.set(bx + gx * cs + cs / 2, yOffset, bz + gz * cs + cs / 2);
      } else if (cell === 'movable') {
        const geo = new THREE.BoxGeometry(cs * 0.8, cs * 0.8, cs * 0.8);
        m = new THREE.Mesh(geo, mat);
        m.position.set(bx + gx * cs + cs / 2, yOffset + cs * 0.4, bz + gz * cs + cs / 2);
      } else if (cell === 'pole') {
        const geo = new THREE.CylinderGeometry(cs * 0.06, cs * 0.06, def.hauteur * cs, 6);
        m = new THREE.Mesh(geo, mat);
        m.position.set(bx + gx * cs + cs / 2, yOffset + (def.hauteur * cs) / 2, bz + gz * cs + cs / 2);
      } else {
        const geo = new THREE.BoxGeometry(cs, def.hauteur * cs, cs);
        m = new THREE.Mesh(geo, mat);
        m.position.set(
          bx + gx * cs + cs / 2,
          yOffset + (def.hauteur * cs) / 2,
          bz + gz * cs + cs / 2,
        );
      }
      g.add(m);
    }
  }

  // Murs de transition plateau (RACE-C02)
  if (elevGrid) {
    for (let gz = 0; gz < BLOCK_SIZE; gz++) {
      for (let gx = 0; gx < BLOCK_SIZE; gx++) {
        const elev = elevGrid[gz]?.[gx] ?? 0;
        if (elev === 0) continue;

        const h = elev * PLATEAU_HEIGHT * cs;
        const voisins = [
          { dz: 0,  dx: -1, cote: 'gauche'  },
          { dz: 0,  dx:  1, cote: 'droit'   },
          { dz: -1, dx:  0, cote: 'avant'   },
          { dz:  1, dx:  0, cote: 'arriere' },
        ];

        for (const { dz, dx, cote } of voisins) {
          const elevV = elevGrid[gz + dz]?.[gx + dx] ?? 0;
          if (elevV >= elev) continue;

          const th  = TRANSITION_THICK * cs;
          const mat = new THREE.MeshStandardMaterial({ color: 0x555570 });
          let geo, wx, wz;

          switch (cote) {
            case 'gauche':
              geo = new THREE.BoxGeometry(th, h, cs);
              wx = bx + gx * cs; wz = bz + gz * cs + cs / 2; break;
            case 'droit':
              geo = new THREE.BoxGeometry(th, h, cs);
              wx = bx + (gx + 1) * cs; wz = bz + gz * cs + cs / 2; break;
            case 'avant':
              geo = new THREE.BoxGeometry(cs, h, th);
              wx = bx + gx * cs + cs / 2; wz = bz + gz * cs; break;
            case 'arriere':
              geo = new THREE.BoxGeometry(cs, h, th);
              wx = bx + gx * cs + cs / 2; wz = bz + (gz + 1) * cs; break;
          }

          const m = new THREE.Mesh(geo, mat);
          m.position.set(wx, h / 2, wz);
          g.add(m);
        }
      }
    }
  }

  return g;
}

// ---- HUD ----

function _mettreAJourHUDStatique() {
  const moi = _allPlayers.find(p => p.playerId === _playerId);
  const v   = moi?.vehicle ?? _monVehicule;

  $('nom-vehicule').textContent = moi?.playerName ?? 'Joueur';
  $('joueurs-info').textContent = `Joueurs : ${_allPlayers.length}`;

  if (v?.stats) {
    $('stat-speed').textContent = v.stats.speed?.toFixed(1) ?? '–';
    $('stat-grip').textContent  = v.stats.grip?.toFixed(1) ?? '–';
    $('stat-accel').textContent = v.stats.accel?.toFixed(1) ?? '–';
  }

  // Comptage couleurs
  if (v?.grid) {
    const comptage = {};
    for (let x = 0; x < 8; x++)
      for (let z = 0; z < 4; z++)
        for (let y = 0; y < 4; y++) {
          const c = v.grid[x]?.[z]?.[y];
          if (c) comptage[c.color] = (comptage[c.color] || 0) + 1;
        }

    $('couleurs').innerHTML = Object.entries(comptage)
      .sort((a, b) => b[1] - a[1])
      .map(([color, n]) =>
        `<span class="pill" style="background:${COULEUR_HEX[color]}">${COULEUR_FR[color]} ${n}</span>`
      ).join('');
  }

  // Pouvoirs
  if (v?.powers) {
    const maxPow = 15;
    $('pouvoirs').innerHTML = Object.entries(POUVOIR_INFO)
      .map(([key, info]) => {
        const val = v.powers[key] || 0;
        if (val === 0) return '';
        const pct = Math.min(100, (val / maxPow) * 100);
        return `<div class="pouvoir-ligne">
          <span class="pouvoir-dot" style="background:${info.couleur}"></span>
          <span style="min-width:70px">${info.nom}</span>
          <div class="pouvoir-barre-wrap">
            <div class="pouvoir-barre" style="width:${pct}%;background:${info.couleur}"></div>
          </div>
          <span style="opacity:0.7;font-size:11px;min-width:24px;text-align:right">${val.toFixed(1)}</span>
        </div>`;
      }).filter(Boolean).join('') || '<div style="opacity:0.4;font-size:11px">Aucun pouvoir actif</div>';
  }
}

// ---- Victoire ----

const RANG_ICONE = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];

function _afficherPodium(podium) {
  const liste = $('victoire-podium');
  liste.innerHTML = podium.map((p, i) => {
    const estMoi = p.playerId === _playerId;
    return `<li${estMoi ? ' style="color:#ffd166;font-weight:700"' : ''}>
      <span class="rang-icone">${RANG_ICONE[i] ?? `${i + 1}.`}</span>
      <span>${p.playerName}</span>
    </li>`;
  }).join('');

  $('ecran-victoire').classList.add('visible');

  // Masquer la bannière individuelle si affichée
  $('banner').style.display = 'none';

  $('btn-retour-accueil').addEventListener('click', () => {
    Client.disconnect();
    window.location.href = '/';
  });
}

// ---- Resize ----

function _onResize() {
  _renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.resize(window.innerWidth, window.innerHeight);
}

// ---- Debug / Calibration UI (port test-solo-v3) ----

function _initDebugUI() {
  // Boutons hud-droite
  $('btn-debug-toggle')?.addEventListener('click', _toggleOverlay);
  $('btn-calibration')?.addEventListener('click', _toggleCalibration);
  $('btn-auto-boucle')?.addEventListener('click', _toggleAuto);
  $('btn-debug-phys-toggle')?.addEventListener('click', _toggleDebugPhys);

  // Sliders calibration (affichage local uniquement)
  const sync = (id, lbl, varRef, dec = 2) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      varRef(v);
      $(lbl).textContent = v.toFixed(dec);
    });
  };
  sync('sl-speed',    'val-speed',    v => _speedStat = v);
  sync('sl-grip-cal', 'val-grip-cal', v => {
    _gripStat = v;
    const sg = $('slider-grip');   if (sg) sg.value = v;
    const gv = $('grip-val');      if (gv) gv.textContent = v.toFixed(2);
  });
  sync('sl-accel',    'val-accel',    v => _accelStat = v);
  sync('sl-choc',     'val-choc',     v => _seuilChoc = v, 1);

  // Profils prédéfinis
  document.querySelectorAll('.profil-btn').forEach(btn => {
    btn.addEventListener('click', () => _appliquerProfil(btn.dataset.profil));
  });
}

function _toggleOverlay() {
  _overlayVisible = !_overlayVisible;
  $('overlay-debug').style.display = _overlayVisible ? 'block' : 'none';
  // Active aussi les flèches debug (comme test-solo-v3)
  _debugArrows = _overlayVisible;
  if (_arrowVelocity) _arrowVelocity.visible = _debugArrows;
  if (_arrowForward)  _arrowForward.visible  = _debugArrows;
}

function _toggleCalibration() {
  _calibVisible = !_calibVisible;
  $('panel-calibration').classList.toggle('visible', _calibVisible);
  $('panel-charts').classList.toggle('visible', _calibVisible);
  const b = $('btn-calibration');
  if (b) b.textContent = _calibVisible ? 'Calibration ✓ [C]' : 'Calibration [C]';
}

function _toggleDebugPhys() {
  _debugPhysVisible = !_debugPhysVisible;
  $('debug-phys').classList.toggle('visible', _debugPhysVisible);
  const b = $('btn-debug-phys-toggle');
  if (b) b.textContent = _debugPhysVisible ? 'Phys ✓ [P]' : 'Phys [P]';
}

function _toggleAuto() {
  _autoLoop = !_autoLoop;
  const b = $('btn-auto-boucle');
  if (b) b.textContent = _autoLoop ? 'Auto ✓ [A]' : 'Auto [A]';
}

function _appliquerProfil(key) {
  const p = PROFILS_CALIBRATION[key];
  if (!p) return;
  _speedStat = p.speed;
  _gripStat  = p.grip;
  _accelStat = p.accel;
  $('sl-speed').value     = p.speed;  $('val-speed').textContent    = p.speed.toFixed(2);
  $('sl-grip-cal').value  = p.grip;   $('val-grip-cal').textContent = p.grip.toFixed(2);
  $('sl-accel').value     = p.accel;  $('val-accel').textContent    = p.accel.toFixed(2);
  const sg = $('slider-grip'); if (sg) sg.value = p.grip;
  const gv = $('grip-val');    if (gv) gv.textContent = p.grip.toFixed(2);
  document.querySelectorAll('.profil-btn').forEach(b => {
    b.classList.toggle('actif', b.dataset.profil === key);
  });
}

// Wrap autour de controls.getInputs pour gérer auto-loop (steer aléatoire + accel)
function _getInputsAvecAuto() {
  if (!_autoLoop) return controls.getInputs();
  // Mise à jour du steer aléatoire toutes les 0.5–1.5 s
  const now = performance.now() / 1000;
  if (now > _autoTimer) {
    _autoSteer = (Math.random() - 0.5) * 2;
    _autoTimer = now + 0.5 + Math.random();
  }
  return {
    steering:  _autoSteer,
    braking:   0,
    reversing: 0,
  };
}

function _mettreAJourDebugPhys(state) {
  $('dbg-vx').textContent    = (state.velocity?.x ?? 0).toFixed(2);
  $('dbg-vz').textContent    = (state.velocity?.z ?? 0).toFixed(2);
  $('dbg-speed').textContent = (state.speed ?? 0).toFixed(2);
  // v_forward / v_lateral à partir de l'angle (decompose simplifié)
  const c = Math.cos(state.angle ?? 0);
  const s = Math.sin(state.angle ?? 0);
  const vx = state.velocity?.x ?? 0;
  const vz = state.velocity?.z ?? 0;
  const vf =  vx * c + vz * s;
  const vl = -vx * s + vz * c;
  $('dbg-vfwd').textContent  = vf.toFixed(2);
  $('dbg-vlat').textContent  = vl.toFixed(2);
  $('dbg-angle').textContent = ((state.angle ?? 0) * 180 / Math.PI % 360).toFixed(1) + '°';
  $('dbg-elev').textContent  = (state.elevation ?? 0).toFixed(2);
  const el = $('dbg-drift');
  el.textContent = state.drifting ? 'OUI' : 'NON';
  el.style.color = state.drifting ? '#ff6b6b' : '#44ff99';
}

function _mettreAJourOverlay(state) {
  const fpsMoy = _fpsSamples.length > 0
    ? Math.round(_fpsSamples.reduce((a, b) => a + b, 0) / _fpsSamples.length)
    : 0;

  $('ov-speed').textContent = (state.speed ?? 0).toFixed(2) + ' u/s';
  $('ov-vlat').textContent  = _dernierVlat.toFixed(2) + ' u/s';

  const driftEl = $('ov-drift');
  driftEl.textContent = state.drifting ? 'OUI' : 'NON';
  driftEl.className   = 'ov-val' + (state.drifting ? ' alerte' : '');

  $('ov-voxels').textContent = `${_voxelsRestants} / ${_voxelsTotal}`;
  $('ov-chocs').textContent = _nbChocs > 0
    ? `${_nbChocs} (Δv: ${_dernierDeltaV.toFixed(1)} u/s)`
    : `0 (Δv: –)`;
  $('ov-fps').textContent = fpsMoy;

  // Blocs visibles : compter dans _blockGroups
  let nVis = 0;
  for (const bg of _blockGroups.values()) if (bg.visible) nVis++;
  $('ov-blocs').textContent = `${nVis} / ${_blockGroups.size}`;

  $('ov-pos').textContent = `(${(state.position?.x ?? 0).toFixed(1)}, ${(state.position?.z ?? 0).toFixed(1)})`;

  const ping = Sync.getPing ? Sync.getPing() : null;
  $('ov-ping').textContent = ping != null ? `${ping} ms` : '– ms';
}

function _renderCharts(cohesionVal) {
  const csSpeed = $('chart-speed');
  const csVlat  = $('chart-vlat');
  const csVie   = $('chart-vie');
  if (!csSpeed || !csVlat || !csVie) return;

  // Vitesse
  const ctxS = csSpeed.getContext('2d');
  const w = csSpeed.width, h = csSpeed.height;
  ctxS.clearRect(0, 0, w, h);
  ctxS.strokeStyle = '#4488ff'; ctxS.lineWidth = 1.5;
  ctxS.beginPath();
  const vmax = 40;
  for (let i = 0; i < CHART_MAX; i++) {
    const idx = (_chartHead + i) % CHART_MAX;
    const x = (i / (CHART_MAX - 1)) * w;
    const y = h - Math.min(1, _speedHist[idx] / vmax) * h;
    i === 0 ? ctxS.moveTo(x, y) : ctxS.lineTo(x, y);
  }
  ctxS.stroke();

  // v_lateral
  const ctxV = csVlat.getContext('2d');
  const wv = csVlat.width, hv = csVlat.height;
  ctxV.clearRect(0, 0, wv, hv);
  ctxV.strokeStyle = '#ff6b6b'; ctxV.lineWidth = 1.5;
  ctxV.beginPath();
  const vlatMax = 15;
  for (let i = 0; i < CHART_MAX; i++) {
    const idx = (_chartHead + i) % CHART_MAX;
    const x = (i / (CHART_MAX - 1)) * wv;
    const y = hv - Math.min(1, Math.abs(_vlatHist[idx]) / vlatMax) * hv;
    i === 0 ? ctxV.moveTo(x, y) : ctxV.lineTo(x, y);
  }
  ctxV.stroke();

  // Jauge cohésion (au lieu de la vie locale)
  const ctxL = csVie.getContext('2d');
  ctxL.clearRect(0, 0, csVie.width, csVie.height);
  const ratio = Math.max(0, Math.min(1, cohesionVal ?? 0));
  const col   = ratio > 0.6 ? '#66ff99' : ratio > 0.3 ? '#ffd166' : '#ff4444';
  ctxL.fillStyle = 'rgba(255,255,255,0.08)';
  ctxL.fillRect(0, 0, csVie.width, csVie.height);
  ctxL.fillStyle = col;
  ctxL.fillRect(0, 0, csVie.width * ratio, csVie.height);
}

// Applique les dommages d'impact sur la copie locale du véhicule du joueur,
// reconstruit le mesh, émet des cubes de couleur et met à jour le HUD.
function _appliquerDommagesLocaux(state, deltaSpeedBrut) {
  if (!_localVehicleData?.grid || !_localVehicleData.originalGrid) return;

  // Le bouclier encaisse d'abord. Le serveur l'use de son côté à chaque choc ;
  // ici on retire simplement la part du choc qu'il a absorbée avant de casser
  // des voxels, pour que le dôme protège vraiment quelque chose.
  const deltaSpeed = deltaSpeedBrut * (1 - powers.shieldAbsorption(_playerId));
  if (deltaSpeed <= 0) return;

  // Normale d'impact = inverse de la velocity (on a foncé dans un mur)
  const spd = Math.max(0.01, state.speed);
  const impactNormal = {
    x: -state.velocity.x / spd,
    z: -state.velocity.z / spd,
  };

  // Seuil de casse depuis le slider grip ou défaut (en u/s)
  const DAMAGE_THRESHOLD = 8.0;

  const { newGrid, removedVoxels } = applyImpactDamage(_localVehicleData.grid, {
    deltaSpeed,
    impactNormal,
    vehicleAngle: state.angle ?? 0,
    DAMAGE_THRESHOLD,
  });

  if (removedVoxels.length === 0) return;

  _localVehicleData.grid = newGrid;
  _voxelsRestants = _compterVoxels(newGrid);

  // Recalcul des stats proportionnellement
  const orig = _localVehicleData.originalStats;
  try {
    const recalc = recalcStats(newGrid, _localVehicleData.originalGrid);
    _localVehicleData.stats = {
      speed: (orig.speed ?? 0) * recalc.stats.speed,
      grip:  (orig.grip  ?? 0) * recalc.stats.grip,
      accel: (orig.accel ?? 0) * recalc.stats.accel,
    };
  } catch { /* recalcStats peut planter sur grid vide ; on tolère */ }

  // Reconstruit le mesh du véhicule local
  const entry = _vehicleMeshes.get(_playerId);
  if (entry && _localVehicleData.wheelPositions) {
    _scene.remove(entry.group);
    entry.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    try {
      const newGroup = buildVehicleGroup(_localVehicleData);
      newGroup.scale.set(VEHICLE_SCALE, VEHICLE_SCALE, VEHICLE_SCALE);
      newGroup.position.set(state.position.x, 0.4, state.position.z);
      newGroup.rotation.y = -state.angle;
      _scene.add(newGroup);
      entry.group = newGroup;
    } catch (err) {
      console.warn('[damage] échec rebuild mesh :', err);
    }
  }

  // Mini-cubes de couleur pour chaque voxel arraché
  for (const rv of removedVoxels) {
    const hex = COULEUR_HEX[rv.color] ?? '#ffffff';
    particles.emit(
      { x: state.position.x, y: 0.5 + rv.y * VEHICLE_SCALE, z: state.position.z },
      hex,
      1,
    );
  }

  // Étincelles supplémentaires
  particles.emitSparks(
    { x: state.position.x, y: 0.5, z: state.position.z },
    impactNormal,
    12,
  );
  camera.shake(deltaSpeed * 0.3);

  // Mise à jour HUD stats + comptage voxels
  if (_localVehicleData.stats) {
    $('stat-speed').textContent = _localVehicleData.stats.speed.toFixed(1);
    $('stat-grip').textContent  = _localVehicleData.stats.grip.toFixed(1);
    $('stat-accel').textContent = _localVehicleData.stats.accel.toFixed(1);
  }
  const blocsEl = $('val-blocs');
  if (blocsEl) blocsEl.textContent = `${_voxelsRestants} / ${_voxelsTotal}`;

  console.log(`[damage] -${removedVoxels.length} voxels (Δv=${deltaSpeed.toFixed(1)} u/s, restants=${_voxelsRestants})`);
}

function _afficherResultatsSession() {
  const now = performance.now();
  const lapSecs = (now - _lapStart) / 1000;
  const vitMoy  = _lapFrames > 0 ? (_lapSpeedSum / _lapFrames) : 0;

  if (!$('sess-temps')) return;
  $('sess-temps').textContent  = lapSecs.toFixed(1) + ' s';
  $('sess-vitmax').textContent = _lapSpeedMax.toFixed(1) + ' u/s';
  $('sess-vitmoy').textContent = vitMoy.toFixed(1) + ' u/s';
  $('sess-voxels').textContent = _lapChocs;

  $('panel-session').classList.add('visible');
  setTimeout(() => $('panel-session').classList.remove('visible'), 3500);
}

// ---- Démarrage ----

init().catch(err => {
  console.error('[game] erreur init :', err);
  const el = $('loading');
  if (el) {
    el.innerHTML = `
      <div style="text-align:center;max-width:420px;padding:24px;background:rgba(200,0,0,0.2);border-radius:12px;">
        <div style="font-size:18px;font-weight:700;margin-bottom:10px;">Erreur au démarrage</div>
        <div style="font-size:14px;opacity:0.85;margin-bottom:14px;">${err.message}</div>
        <div style="font-size:12px;opacity:0.6;">Vérifier que le serveur tourne :<br><code>node server.js</code></div>
      </div>`;
  }
});
