// Page de jeu multijoueur — la partie d'atelier.
//
// Réécrite le 30/09 (étape 3 du passage serveur). Le serveur fait autorité sur
// tout ; la page :
//   - fait rouler SA voiture tout de suite avec la même conduite que le serveur
//     (game/vehicle-tick.js), recalée en douceur sur lui (network/prediction.js) ;
//   - montre les autres voitures lissées entre deux états serveur (network/sync.js) ;
//   - dessine map et voitures avec les mêmes modules que test-v5
//     (game/map-view.js, game/vehicle-view.js) ;
//   - tire ses effets (étincelles, sauts, voxels arrachés) des événements serveur.
//
// Interface minimale : jauge « Ensemble », flèches vers les joueurs hors écran,
// mini-carte, un marqueur sur sa propre voiture, Frein / Reculer, un « Quitter »
// discret, puis l'écran de victoire collective. Jamais de classement.
//
// Flux : sessionStorage (map, joueurs, ids) → game:rejoin → attente → décompte
// → course → victoire → « Rejouer » (nouveau match, même joueurs).

import * as THREE from '../lib/three.module.js';
import * as controls     from '../modules/game/controls.js';
import * as camera       from '../modules/game/camera.js';
import * as skid         from '../modules/game/skid.js';
import * as particles    from '../modules/game/particles.js';
import * as powers       from '../modules/game/powers.js';
import * as powerFx      from '../modules/game/power-effects.js';
import * as cohesionView from '../modules/game/cohesion-view.js';
import * as offscreen    from '../modules/game/offscreen.js';
import * as mapLoader    from '../modules/game/map-loader.js';
import * as physics      from '../modules/game/physics.js';
import { cohesionState } from '../modules/game/cohesion.js';
import { initMinimap, updateMinimap } from '../modules/game/minimap.js';
import { boundsFromExtent, setConfig as setCollisionConfig } from '../modules/game/collision.js';
import { setConfig as setMapGenConfig, BLOCK_SIZE } from '../modules/game/map-generator.js';
import { buildFence } from '../modules/game/fence.js';
import { buildBlockMeshes, buildGround } from '../modules/game/map-view.js';
import {
  createVehicleView, updateVehicleView, rebuildVehicleView, bodyHeight,
  viewLanding, viewWallContact, viewDamage,
} from '../modules/game/vehicle-view.js';
import { createVehicleSim, tickVehicle } from '../modules/game/vehicle-tick.js';
import { buildNavGrid } from '../modules/game/navigation.js';
import { createWorldObjects, placeCube, createBlockIndex, blocksAround } from '../modules/game/world-objects.js';
import { statsFromGrid, recalcStats, recalcPowers } from '../modules/voxel/stats.js';
import * as Client from '../modules/network/client.js';
import * as Sync   from '../modules/network/sync.js';
import { reconcile, snapTo } from '../modules/network/prediction.js';

const COULEUR_HEX = {
  red: '#e62020', green: '#1fa830', blue: '#1a52e0',
  orange: '#f07418', violet: '#7d2dc0', pink: '#e882b9',
};

const $ = id => document.getElementById(id);

// ---- Données de la partie (posées par la page lobby) ----

const _matchId  = sessionStorage.getItem('pop-vroum:matchId');
const _playerId = sessionStorage.getItem('pop-vroum:playerId');
const _map      = _lireJSON('pop-vroum:map');
const _joueurs  = _lireJSON('pop-vroum:players') ?? [];

function _lireJSON(cle) {
  try { return JSON.parse(sessionStorage.getItem(cle)); }
  catch { return null; }
}

// ---- État ----

let _scene, _renderer, _cam;
let _cfg = null;              // gameplay.json complet
let _plateauH = 0.5;          // layout.json → PLATEAU_HEIGHT
let _last = performance.now();
let _minimap = null;
let _marqueur = null;         // triangle au-dessus de sa propre voiture

// playerId → { view, vehicule: {grid, originalGrid, originalPowers}, nom, couleur, bot }
const _vehicules = new Map();

// Objets de la map côté client : la collision locale doit voir les cubes où le
// serveur les a mis, et passer à travers les poteaux qu'il a fait tomber.
let _objets    = null;                 // world-objects : cubes et poteaux par id
const _cubeMesh = new Map();           // cellule de cube → mesh affiché
const _poleMesh = new Map();           // id de poteau → mesh affiché

// Voiture locale prédite
let _sim     = null;
let _monde   = null;                   // monde de vehicle-tick pour la prédiction
let _index   = null;                   // blocs par case, pour la collision autour de moi
let _mesStats = { speed: 1, grip: 1, accel: 1 };

let _phase = null;
let _annonceFin = 0;                   // « Partez ! » affiché jusqu'à cet instant
let _arrive = false;
let _victoire = false;

// ---- Initialisation ----

function _progression(pct, msg) {
  $('loading-bar').style.width = pct + '%';
  if (msg !== undefined) $('loading-msg').textContent = msg;
}

async function init() {
  if (!_matchId || !_playerId || !_map) {
    _progression(0, 'Données de partie manquantes. Retourne au lobby.');
    return;
  }

  _cfg = await fetch('/config/gameplay.json').then(r => r.json());
  const layout = await fetch('/config/layout.json').then(r => r.json()).catch(() => ({}));
  _plateauH = layout.PLATEAU_HEIGHT ?? 0.5;
  physics.setConfig({ ..._cfg.vehicleStats, ..._cfg.physics });
  setCollisionConfig(_cfg.physics);
  setMapGenConfig(_cfg);

  _progression(15, 'Création de la scène…');
  _creerScene();

  _progression(35, 'Construction de la map…');
  _construireMap();

  _progression(55, 'Création des véhicules…');
  await _creerVehicules();
  _preparerPrediction();

  _progression(75, 'Connexion au serveur…');
  const ok = await _rejoindre();
  if (!ok) return;

  Sync.start(() => controls.getInputs(), { interpDelayMs: _cfg.network?.interpDelayMs });
  Sync.onState(_surEtat);
  _brancherEvenements();

  _progression(100, '');
  $('loading').classList.remove('visible');
  window.addEventListener('resize', _surRedimension);
  _last = performance.now();
  requestAnimationFrame(_boucle);
}

function _creerScene() {
  const canvas = $('jeu');
  _scene = new THREE.Scene();
  _scene.background = new THREE.Color(0x1a1a2e);
  _scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(20, 40, 10);
  _scene.add(dir);

  _renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  _renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  _renderer.setSize(window.innerWidth, window.innerHeight, false);
  _cam = camera.createCamera(window.innerWidth, window.innerHeight);

  controls.init(canvas);
  skid.init(_scene);
  particles.init(_scene);
  offscreen.init(_cam, document.body);
}

function _construireMap() {
  _objets = createWorldObjects(_map);

  mapLoader.init(_scene, _map, (blocks, bs) => buildBlockMeshes(blocks, bs, {
    plateauHeight: _plateauH,
    onCube: (cellule, mesh) => _cubeMesh.set(cellule, mesh),
    onPole: (id, mesh) => _poleMesh.set(id, mesh),
  }), _cfg.physics?.RENDER_DISTANCE ?? 3);

  _scene.add(buildGround(_map));

  // Clôture : le serveur fait la collision, ici on la dessine et la prédiction
  // locale la respecte aussi
  const bornes = boundsFromExtent(_map.worldExtent, _cfg.map?.fence);
  if (bornes) {
    const cloture = buildFence(bornes, _cfg.map?.fence);
    if (cloture) _scene.add(cloture);
  }
  _minimap = initMinimap(_map, document.body);
}

async function _creerVehicules() {
  await powers.init(_scene);
  powerFx.setConfig(_cfg.powers);
  cohesionView.init(_scene, _cfg.cohesion?.halo);
  const fin = _map.exit?.worldCenter ?? _map.finishPosition;
  if (fin) powers.setFinishPosition(fin.x, fin.z);

  const echelle = _cfg.physics?.vehicleScale ?? 0.28;
  for (const j of _joueurs) {
    const brut = j.vehicle?.grid ? j.vehicle : _vehiculeParDefaut(j.vehicle);
    const grid = brut.grid.map(col => col.map(row => [...row]));
    const { powers: pouvoirs } = statsFromGrid(grid, _cfg);
    const couleur = COULEUR_HEX[brut.palette?.[0]] ?? _couleurDominante(grid);
    const vehicule = {
      ...brut, grid,
      originalGrid:   grid.map(col => col.map(row => [...row])),
      originalPowers: pouvoirs,
    };
    _vehicules.set(j.playerId, {
      vehicule,
      nom:     j.playerName,
      bot:     !!j.bot,
      couleur,
      view:    createVehicleView(_scene, vehicule, { scale: echelle, dustColor: couleur }),
    });
    powers.createForVehicle(j.playerId, pouvoirs);
  }

  // Petit triangle au-dessus de sa propre voiture, pour la reconnaître
  _marqueur = new THREE.Mesh(
    new THREE.ConeGeometry(0.35, 0.6, 4),
    new THREE.MeshBasicMaterial({ color: 0xffd166 }),
  );
  _marqueur.rotation.x = Math.PI;   // pointe vers le bas
  _scene.add(_marqueur);
}

// Véhicule sans grille exploitable : une caisse simple, pour ne rien casser
function _vehiculeParDefaut(v = {}) {
  const grid = Array.from({ length: 8 }, () => Array.from({ length: 4 }, () =>
    Array.from({ length: 4 }, (_, y) => (y < 2 ? { color: 'blue' } : null))));
  const wheelPositions = [
    { x: 1, y: -0.3, z: 0 }, { x: 1, y: -0.3, z: 3 },
    { x: 6, y: -0.3, z: 0 }, { x: 6, y: -0.3, z: 3 },
  ];
  return { ...v, grid, wheelPositions };
}

function _couleurDominante(grid) {
  const n = {};
  for (const col of grid) for (const row of col) for (const c of row) if (c) n[c.color] = (n[c.color] ?? 0) + 1;
  const [dom] = Object.entries(n).sort((a, b) => b[1] - a[1])[0] ?? [];
  return COULEUR_HEX[dom] ?? '#c8b89a';
}

// Même conduite que le serveur, dans le même monde : map, clôture, aide couloir.
// Les cubes et poteaux restent au serveur (la voiture locale ne les pousse ni
// ne les casse) : sa réponse arrive par game:state et recale tout le monde.
function _preparerPrediction() {
  const moi = _vehicules.get(_playerId);
  const vs  = _cfg.vehicleStats;
  const { stats } = statsFromGrid(moi.vehicule.grid, _cfg);
  _mesStats = { speed: stats.speed / vs.baseSpeed, grip: stats.grip / vs.baseGrip, accel: stats.accel / vs.baseAccel };

  const depart = _map.entry?.spawnPositions?.[0] ?? _map.startPosition;
  _sim   = createVehicleSim({ x: depart.x, z: depart.z, angle: _map.startPosition?.angle ?? 0 });
  _index = createBlockIndex(_map);
  _monde = {
    blocks:        [],
    blockScale:    _map.blockScale,
    bounds:        boundsFromExtent(_map.worldExtent, _cfg.map?.fence),
    nav:           buildNavGrid(_map),
    consts:        _cfg.physics,
    plateauHeight: _plateauH,
    vehicleScale:  _cfg.physics?.vehicleScale ?? 0.28,
    cubes:         [],
    poles:         null,
  };
}

async function _rejoindre() {
  await Client.init();
  const res = await new Promise(resolve => {
    Client.once('game:rejoin:ok', data => resolve(data));
    Client.once('game:rejoin:error', () => resolve(null));
    Client.emit('game:rejoin', { matchId: _matchId, playerId: _playerId });
  });
  if (!res) {
    _progression(0, 'Impossible de rejoindre la partie. Elle a peut-être expiré.');
    return false;
  }
  if (res.snapshot) _appliquerSnapshot(res.snapshot);
  return true;
}

// Ce qui a changé depuis l'envoi de la map (page rechargée en cours de partie)
function _appliquerSnapshot(snap) {
  for (const [pid, grid] of Object.entries(snap.vehicules ?? {})) {
    const v = _vehicules.get(pid);
    if (!v || !grid) continue;
    v.vehicule.grid = grid.map(col => col.map(row => [...row]));
    _apresPerte(pid);
  }
  for (const id of snap.poteauxTombes ?? []) _faireTomberPoteau(id);
  for (const c of snap.cubes ?? []) _placerCube(c);
}

function _brancherEvenements() {
  Client.on('game:player-arrived', ({ playerId }) => {
    if (playerId !== _playerId || _victoire) return;
    _arrive = true;
    $('bandeau-arrivee').style.display = 'block';
  });

  // Victoire collective. Le podium du serveur n'est jamais affiché.
  Client.on('game:victory', ({ matchId }) => {
    if (matchId !== _matchId) return;
    _victoire = true;
    $('bandeau-arrivee').style.display = 'none';
    $('ecran-victoire').classList.add('visible');
  });

  $('btn-rejouer').addEventListener('click', () => {
    $('btn-rejouer').disabled = true;
    Client.emit('game:rejouer');
  });
  Client.on('game:rejouer:votes', ({ votes, total }) => {
    $('votes').textContent = `${votes} / ${total} prêt·es à rejouer`;
  });

  // Nouveau match (Rejouer) : même message que depuis le lobby
  Client.on('lobby:start', ({ matchId, map, playerId, players }) => {
    sessionStorage.setItem('pop-vroum:matchId', matchId);
    sessionStorage.setItem('pop-vroum:playerId', playerId);
    sessionStorage.setItem('pop-vroum:map', JSON.stringify(map));
    sessionStorage.setItem('pop-vroum:players', JSON.stringify(players));
    window.location.href = `game.html?match=${encodeURIComponent(matchId)}`;
  });

  Client.onDisconnect(() => _annoncer('Connexion perdue…', true));

  $('btn-quitter').addEventListener('click', () => $('modale-quitter').classList.add('visible'));
  $('btn-annuler-quitter').addEventListener('click', () => $('modale-quitter').classList.remove('visible'));
  $('btn-confirmer-quitter').addEventListener('click', () => {
    Client.disconnect();
    window.location.href = '/';
  });
}

// ---- Réception d'un état serveur ----

function _surEtat(etat) {
  if (etat.matchId !== _matchId) return;   // reste d'un match précédent

  _majPhase(etat);

  for (const c of etat.cubes ?? []) _placerCube(c);

  for (const ev of etat.events ?? []) {
    const estMoi = ev.id === _playerId;
    const v   = ev.id ? _vehicules.get(ev.id) : null;
    const pos = ev.id ? etat.players[ev.id] : null;

    switch (ev.t) {
      case 'poteau':
        _faireTomberPoteau(ev.poteau);
        break;
      case 'degats':
        if (!v) break;
        for (const vx of ev.voxels) v.vehicule.grid[vx.x][vx.z][vx.y] = null;
        viewDamage(v.view, estMoi ? _sim.car : pos, ev.voxels, null, COULEUR_HEX);  // reconstruit le mesh
        _apresPerte(ev.id, { reconstruire: false });
        if (estMoi) camera.shake(ev.dv * 0.3);
        break;
      // Sa propre voiture tire ces effets de sa prédiction, tout de suite ;
      // ceux du serveur arriveraient en retard et en double.
      case 'atterrissage':
        if (!estMoi && v && pos) viewLanding(v.view, pos, ev.impact, _cfg.physics);
        break;
      case 'mur':
        if (!estMoi && v && pos) {
          viewWallContact(v.view, pos, { x: ev.n[0], z: ev.n[1] }, ev.v, 1 / 30, _cfg.physics);
        }
        break;
    }
  }
}

// Après une perte de voxels : stats (pour la prédiction) et pouvoirs recalculés
function _apresPerte(pid, { reconstruire = true } = {}) {
  const v = _vehicules.get(pid);
  if (!v) return;
  if (pid === _playerId) {
    _sim.degats = recalcStats(v.vehicule.grid, v.vehicule.originalGrid).stats;
  }
  const pouvoirs = recalcPowers(v.vehicule.grid, v.vehicule.originalGrid, v.vehicule.originalPowers);
  powers.removeVehicle(pid);
  powers.createForVehicle(pid, pouvoirs);
  if (reconstruire) rebuildVehicleView(v.view, v.vehicule);
}

function _faireTomberPoteau(id) {
  const p = _objets.poles.get(id);
  if (p) p.bloc.grid[p.gz][p.gx] = null;   // la collision locale passe au travers
  const m = _poleMesh.get(id);
  if (m) m.visible = false;
}

function _placerCube({ id, x, z }) {
  const cube = _objets.cubes.get(id);
  if (!cube) return;
  placeCube(_map, cube, x, z);
  const m = _cubeMesh.get(cube.cellule);
  if (m) { m.position.x = x; m.position.z = z; }
}

// ---- Phases : attente → décompte → course ----

function _majPhase(etat) {
  const avant = _phase;
  _phase = etat.phase;

  if (_phase === 'attente') {
    _annoncer('En attente des autres joueurs…', true);
  } else if (_phase === 'decompte') {
    _annoncer(String(Math.max(1, Math.ceil(etat.departDans ?? 0))));
  } else if (_phase === 'course' && avant && avant !== 'course') {
    _annoncer('Partez !');
    _annonceFin = performance.now() + 1000;
  } else if (_phase === 'course' && !avant) {
    $('annonce').style.display = 'none';   // page rechargée en pleine course
  }
}

function _annoncer(texte, petite = false) {
  const el = $('annonce');
  el.textContent = texte;
  el.classList.toggle('petite', petite);
  el.style.display = 'block';
}

// ---- Boucle ----

function _boucle(now) {
  const dt = Math.min(0.05, (now - _last) / 1000);
  _last = now;

  const etat = Sync.getLatest();
  if (_phase === 'course' && _annonceFin && now > _annonceFin) {
    $('annonce').style.display = 'none';
    _annonceFin = 0;
  }

  if (etat) {
    _majMaVoiture(etat, now, dt);
    const vues = _majAutresEtVues(etat, now, dt);
    _majGroupe(etat, vues, dt);
  }

  skid.update();
  particles.update(dt);
  _renderer.render(_scene, _cam);
  requestAnimationFrame(_boucle);
}

// Ma voiture : prédite en course, calée sur le serveur avant le départ
function _majMaVoiture(etat, now, dt) {
  const srv = etat.players[_playerId];
  if (!srv) return;
  const car = _sim.car;

  if (_phase !== 'course') {
    snapTo(car, srv);
    car.y = srv.y ?? 0;
    return;
  }

  const inputs = controls.getInputs();
  _monde.blocks = blocksAround(_index, car.position);
  const ev = tickVehicle(_sim, inputs, _monde, dt, {
    stats: _mesStats,
    fx:    srv.effects ?? undefined,
  });

  // L'état serveur a l'âge du trajet plus, en moyenne, un demi-tick
  const age = (now - Sync.getReceivedAt()) / 1000 + 1 / 60;
  reconcile(car, srv, age, dt, _cfg.network);

  // Effets de ma voiture, tout de suite
  const v = _vehicules.get(_playerId);
  if (ev.boostEntered)  camera.kick(-(_cfg.physics?.BOOST_ZOOM ?? 3));
  if (ev.stickyEntered) camera.kick(_cfg.physics?.STICKY_ZOOM ?? 2.5);
  if (ev.landed) {
    camera.shake(ev.landed.impact * (_cfg.physics?.LANDING_SHAKE ?? 0.25));
    viewLanding(v.view, car, ev.landed.impact, _cfg.physics);
  }
  if (ev.contact && !ev.contact.pushingCube) {
    viewWallContact(v.view, car, ev.contact.normal, ev.contact.tangentSpeed, dt, _cfg.physics);
  }
  if (ev.driftCharge?.libere) {
    camera.kick(-(_cfg.physics?.BOOST_ZOOM ?? 3) * 0.5 * ev.driftCharge.charge);
  }
}

// Place chaque voiture et renvoie la liste commune (pouvoirs, cohésion, caméra)
function _majAutresEtVues(etat, now, dt) {
  const vues = [];
  for (const [pid, v] of _vehicules) {
    const srv = etat.players[pid];
    if (!srv) continue;
    const s = pid === _playerId
      ? { ..._sim.car, drifting: _sim.car.drifting, airborne: _sim.car.airborne }
      : (Sync.getInterpolated(pid, now) ?? srv);

    updateVehicleView(v.view, s, dt, { consts: _cfg.physics, effets: true });
    powers.setShieldState(pid, srv.shield ?? null);
    vues.push({
      id: pid, position: s.position, y: s.y ?? 0, angle: s.angle, speed: s.speed,
      effets: srv.effects?.types ?? [],
    });
  }
  return vues;
}

function _majGroupe(etat, vues, dt) {
  // Pouvoirs : le serveur décide des effets, le client ne fait que les montrer
  const effetsServeur = [];
  for (const v of vues) {
    for (const type of v.effets) effetsServeur.push({ targetId: v.id, effect: type, position: v.position });
  }
  powers.update(vues, dt, effetsServeur);

  // Cohésion : halo autour du groupe + jauge
  const rayon = _cfg.cohesion?.radiusUnits ?? 8;
  cohesionView.update(vues, cohesionState(vues, rayon), dt, rayon);
  const valeur = etat.cohesion?.value ?? 0;
  $('cohesion-bar').style.width = Math.round(valeur * 100) + '%';
  $('cohesion-bar').classList.toggle('pleine', !!etat.cohesion?.isFull);

  // Caméra : tout le groupe dans le cadre
  camera.update(vues.map(v => ({ x: v.position.x, z: v.position.z, y: v.y })));

  // Blocs chargés autour du centre du groupe, assez loin pour couvrir le zoom
  const bx = vues.reduce((s, v) => s + v.position.x, 0) / Math.max(1, vues.length);
  const bz = vues.reduce((s, v) => s + v.position.z, 0) / Math.max(1, vues.length);
  const blocMonde = BLOCK_SIZE * _map.blockScale;
  const etendue   = camera.getHalfHeight() * Math.max(camera.getAspect(), 2);
  mapLoader.setRenderDistance(Math.max(3, Math.min(6, Math.ceil(etendue / blocMonde) + 1)));
  mapLoader.update(bx, _cam, bz);

  // Flèches vers les coéquipier·ères hors écran, mini-carte
  offscreen.update(vues.filter(v => v.id !== _playerId).map(v => ({
    id: v.id, position: v.position, color: _vehicules.get(v.id)?.couleur,
  })));
  updateMinimap(_minimap, vues.map(v => ({ id: v.id, position: v.position, isLocal: v.id === _playerId })));

  // Marqueur au-dessus de ma voiture, qui flotte doucement
  const moi = _vehicules.get(_playerId);
  if (moi?.view.group) {
    const p = moi.view.group.position;
    _marqueur.position.set(p.x, p.y + bodyHeight(moi.view) + 1.4 + Math.sin(performance.now() / 250) * 0.12, p.z);
  }
}

function _surRedimension() {
  _renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.resize(window.innerWidth, window.innerHeight);
}

init().catch(err => {
  console.error('[game] échec du lancement', err);
  _progression(0, 'Erreur au lancement de la partie : ' + err.message);
});
