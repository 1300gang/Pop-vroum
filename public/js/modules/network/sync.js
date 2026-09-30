// Synchronisation temps réel client ↔ serveur.
//
// Responsabilités :
//   - Envoyer les commandes du joueur local au serveur à 30 Hz
//   - Garder une courte file des états reçus (game:state)
//   - Donner l'état des AUTRES véhicules avec un léger retard de rendu,
//     interpolé entre deux états serveur : c'est ce qui les rend fluides.
//     (Le véhicule local, lui, est prédit par la page — network/prediction.js.)
//
// Réécrit le 30/09 : l'ancienne version comparait l'id de connexion du socket
// aux ids de joueurs, qui ne correspondent jamais — la voiture locale n'était
// jamais reconnue comme telle. Tout est maintenant indexé par playerId.
//
// API publique :
//   start(getInputsFn, opts)   → lance l'envoi à 30 Hz et l'écoute de game:state
//   stop()
//   onState(fn) / offState(fn) → fn(état brut) à chaque tick serveur
//   getLatest()                → dernier état brut reçu (phase, cohésion, events…)
//   getReceivedAt()            → performance.now() de sa réception
//   getInterpolated(playerId, nowMs) → état lissé d'un véhicule, ou null

import * as Client from './client.js';

const INPUT_MS    = Math.round(1000 / 30);
const FILE_MAX    = 20;       // ~0,7 s d'états serveur

let _inputInterval = null;
let _getInputsFn   = null;
let _delai         = 100;     // retard de rendu (ms), network.interpDelayMs
let _file          = [];      // [{ t, etat }] du plus ancien au plus récent
const _cbs         = [];

function _onState(etat) {
  _file.push({ t: performance.now(), etat });
  if (_file.length > FILE_MAX) _file.shift();
  for (const fn of _cbs) fn(etat);
}

/**
 * @param {() => { steering, braking, reversing }} getInputsFn
 * @param {{ interpDelayMs?: number }} [opts]
 */
export function start(getInputsFn, opts = {}) {
  _getInputsFn = getInputsFn;
  _delai       = opts.interpDelayMs ?? 100;
  _file        = [];

  if (_inputInterval) clearInterval(_inputInterval);
  _inputInterval = setInterval(() => {
    if (!_getInputsFn || !Client.isConnected()) return;
    Client.sendInput(_getInputsFn());
  }, INPUT_MS);

  Client.off('game:state', _onState);
  Client.on('game:state', _onState);
}

export function stop() {
  if (_inputInterval) clearInterval(_inputInterval);
  _inputInterval = null;
  Client.off('game:state', _onState);
}

export function onState(fn)  { _cbs.push(fn); }
export function offState(fn) {
  const i = _cbs.indexOf(fn);
  if (i >= 0) _cbs.splice(i, 1);
}

/** Dernier état brut reçu, ou null. */
export function getLatest() {
  return _file.length ? _file[_file.length - 1].etat : null;
}

/** Instant (performance.now) de réception du dernier état. */
export function getReceivedAt() {
  return _file.length ? _file[_file.length - 1].t : 0;
}

/**
 * État lissé d'un véhicule, rendu avec un léger retard : on interpole entre les
 * deux états serveur qui encadrent (maintenant − retard). Sans encadrement
 * possible (début de partie, paquet perdu), on prend le plus proche.
 * @param {string} playerId
 * @param {number} nowMs — performance.now()
 * @returns {object|null} { position, y, vy, angle, velocity, speed, drifting, airborne, … }
 */
export function getInterpolated(playerId, nowMs) {
  if (_file.length === 0) return null;
  const cible = nowMs - _delai;

  let a = null, b = null;
  for (let i = _file.length - 1; i >= 0; i--) {
    if (_file[i].t <= cible) { a = _file[i]; b = _file[i + 1] ?? null; break; }
  }
  const pa = a?.etat.players?.[playerId];
  const pb = b?.etat.players?.[playerId];
  if (!pa || !pb) {
    // Hors de la fenêtre : l'état connu le plus proche
    const proche = (a ?? _file[0]).etat.players?.[playerId];
    return proche ? { ...proche } : null;
  }

  const t = Math.max(0, Math.min(1, (cible - a.t) / Math.max(1, b.t - a.t)));
  const lerp = (u, v) => u + (v - u) * t;
  return {
    ...pb,
    position: { x: lerp(pa.position.x, pb.position.x), z: lerp(pa.position.z, pb.position.z) },
    velocity: { x: lerp(pa.velocity.x, pb.velocity.x), z: lerp(pa.velocity.z, pb.velocity.z) },
    y:        lerp(pa.y ?? 0, pb.y ?? 0),
    vy:       lerp(pa.vy ?? 0, pb.vy ?? 0),
    speed:    lerp(pa.speed ?? 0, pb.speed ?? 0),
    angle:    _lerpAngle(pa.angle, pb.angle, t),
  };
}

// Interpolation d'angle (gère le passage de ±π)
function _lerpAngle(a, b, t) {
  let d = b - a;
  while (d >  Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}
