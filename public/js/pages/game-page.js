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
import * as Client    from '../modules/network/client.js';
import * as Sync      from '../modules/network/sync.js';

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
  sticky: { couleur: 0x88ff66, hauteur: 0.05 },
};

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

const $ = id => document.getElementById(id);

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

  _progression(30, 'Construction de la map…');

  // Map
  const mapGroup = _construireMeshMap(_map);
  _scene.add(mapGroup);

  // Informer les pouvoirs de la position d'arrivée (pour les flèches de navigation)
  if (_map?.finishPosition) {
    powers.setFinishPosition(_map.finishPosition.x, _map.finishPosition.z);
  }

  _progression(50, 'Création des véhicules…');

  // Véhicules de chaque joueur + pouvoirs
  for (const p of _allPlayers) {
    const group = _creerGroupeVehicule(p);
    group.scale.set(VEHICLE_SCALE, VEHICLE_SCALE, VEHICLE_SCALE);
    _scene.add(group);
    _vehicleMeshes.set(p.playerId, { group });

    const pwValues = p.vehicle?.powers ?? {};
    _powersHandles.set(p.playerId, powers.createForVehicle(p.playerId, pwValues));
  }

  // Preview de mon propre véhicule
  if (_monVehicule?.grid && _monVehicule?.wheelPositions) {
    try { _preview.setGroup(buildVehicleGroup(_monVehicule)); } catch {}
  }

  // HUD statique
  _mettreAJourHUDStatique();

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

  // Démarrer la sync (envoi inputs + réception états)
  Sync.start(() => controls.getInputs());

  // Arrivée d'un joueur : mini-bannière temporaire
  Client.on('game:player-arrived', ({ playerId, ordre }) => {
    const info = _allPlayers.find(p => p.playerId === playerId);
    const nom  = info?.playerName ?? playerId;
    if (playerId === _playerId) {
      $('banner').textContent = '🏁 Arrivée !';
      $('banner').style.display = 'block';
      setTimeout(() => { $('banner').style.display = 'none'; }, 3000);
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
  const dt = Math.min(0.05, (now - _last) / 1000);
  _last = now;

  const playersState = Sync.getPlayerStates(now);
  const cohesion     = Sync.getCohesion();

  if (playersState) {
    const positions = [];

    for (const [pid, state] of Object.entries(playersState)) {
      const entry = _vehicleMeshes.get(pid);
      if (!entry) continue;

      // Positionnement du groupe voxel
      entry.group.position.set(state.position.x, 0.4, state.position.z);
      entry.group.rotation.y = state.angle - Math.PI / 2;
      // Roll visuel en dérapage (E03-S13) — steerInput approché via driftAngle pour les distants
      const virtualSteer = -Math.max(-1, Math.min(1, (state.driftAngle ?? 0) / 0.4));
      applyRoll(entry.group, state.drifting, virtualSteer);

      positions.push(state.position);

      // Skid marks + poussière pour tous les joueurs (E03-S11 / S12)
      if (state.drifting && state.velocity) {
        const spd       = Math.max(0.01, state.speed);
        const nx        = state.velocity.x / spd;
        const nz        = state.velocity.z / spd;
        const v_lateral = Math.abs(spd * Math.sin(state.driftAngle ?? 0));

        // Skid marks orientés sur velocity (E03-S11)
        skid.emit(
          { x: state.position.x - nx * 0.6, z: state.position.z - nz * 0.6 },
          state.velocity,
          v_lateral
        );

        // Poussière de drift si v_speed > 5 (E03-S12 T-S12-1)
        if (spd > 5 && Math.random() < 0.12) {
          particles.emitDust(
            { x: state.position.x - nx * 0.7, y: 0.15, z: state.position.z - nz * 0.7 },
            state.velocity,
            '#c8b89a',
            1 + Math.floor(Math.random() * 2),
          );
        }
      }
    }

    skid.update();
    particles.update(dt);

    // Pouvoirs : positionner les meshes et détecter les effets
    const allVehiclesView = Object.entries(playersState).map(([pid, s]) => ({
      id:       pid,
      position: s.position,
      angle:    s.angle,
      speed:    s.speed,
      stats:    _allPlayers.find(p => p.playerId === pid)?.vehicle?.stats ?? {},
    }));
    powers.update(allVehiclesView, dt);

    // Caméra suit le barycentre de tous les joueurs
    if (positions.length > 0) {
      camera.update(positions);
    }

    // HUD dynamique
    const monEtat = playersState[_playerId];
    if (monEtat) {
      $('speed-val').textContent = monEtat.speed.toFixed(1);
      $('drift-label').style.display = monEtat.drifting ? '' : 'none';
    }

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

  // Cellules (grilles déjà rotées par le serveur)
  for (const bloc of map.blocks) {
    const [bx, bz] = bloc.position;
    for (let gz = 0; gz < BLOCK_SIZE; gz++) {
      for (let gx = 0; gx < BLOCK_SIZE; gx++) {
        const cell = bloc.grid[gz]?.[gx];
        const def  = TYPES_CELLULE[cell] ?? TYPES_CELLULE.null;
        if (def.hauteur === 0) continue;

        const mat = new THREE.MeshStandardMaterial({ color: def.couleur });
        let m;
        if (cell === 'ramp') {
          const geo = _creerGeomRampX(def.hauteur, cs);
          m = new THREE.Mesh(geo, mat);
          m.position.set(bx + gx * cs, 0, bz + gz * cs);
        } else {
          const geo = new THREE.BoxGeometry(cs, def.hauteur, cs);
          m = new THREE.Mesh(geo, mat);
          m.position.set(bx + gx * cs + cs / 2, def.hauteur / 2, bz + gz * cs + cs / 2);
        }
        group.add(m);
      }
    }
  }

  // Ligne de départ (verte, bande verticale)
  const ligneGeo  = new THREE.PlaneGeometry(1, depth);
  const departMat = new THREE.MeshBasicMaterial({ color: 0x66ff99, transparent: true, opacity: 0.5 });
  const depart    = new THREE.Mesh(ligneGeo, departMat);
  depart.rotation.x = -Math.PI / 2;
  depart.position.set(blocmapSize, 0.02, depth / 2);
  group.add(depart);

  // Ligne d'arrivée (dorée)
  const arriveeMat = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.7 });
  const arrivee    = new THREE.Mesh(ligneGeo.clone(), arriveeMat);
  arrivee.rotation.x = -Math.PI / 2;
  arrivee.position.set(map.finishPosition.x - blocmapSize / 2, 0.02, depth / 2);
  group.add(arrivee);

  return group;
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
