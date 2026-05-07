// Synchronisation temps réel client ↔ serveur — Story 5.4 / E03-S10
//
// Responsabilités :
//   - Envoyer les inputs du joueur local au serveur à 30 Hz
//   - Recevoir game:state et maintenir un snapshot courant
//   - Interpolation linéaire entre les deux derniers snapshots pour les joueurs distants
//   - Dead reckoning (extrapolation via velocity) pour le joueur local — réduit la latence perçue
//
// API publique :
//   start(getInputsFn)             → lance l'envoi à 30 Hz
//   stop()                         → arrête l'envoi
//   getPlayerStates(nowMs)         → { [socketId]: { position, velocity, angle, speed, drifting, driftAngle, playerName } }
//   getCohesion()                  → { value, isFull }
//   getMatchId()                   → string | null
//   getLocalSocketId()             → string | null
//   onState(fn)                    → fn(rawState) à chaque tick serveur
//   offState(fn)                   → désabonnement

import * as Client from './client.js';

const INPUT_HZ  = 30;
const INPUT_MS  = Math.round(1000 / INPUT_HZ);
const TICK_MS   = 1000 / 30; // durée théorique d'un tick serveur

// ---- État interne ----

let _inputInterval = null;
let _getInputsFn   = null;

// Double-buffer pour interpolation
let _prev     = null;   // avant-dernier snapshot
let _curr     = null;   // dernier snapshot
let _currTime = 0;      // performance.now() à la réception de _curr

const _cbs = [];

// ---- Envoi des inputs ----

/**
 * Démarre l'envoi périodique des inputs et l'écoute de game:state.
 * @param {() => { steering: number, braking: number }} getInputsFn
 */
export function start(getInputsFn) {
  _getInputsFn = getInputsFn;

  // Envoi à 30 Hz
  if (_inputInterval) clearInterval(_inputInterval);
  _inputInterval = setInterval(() => {
    if (!_getInputsFn || !Client.isConnected()) return;
    Client.sendInput(_getInputsFn());
  }, INPUT_MS);

  // Écoute de l'état serveur
  Client.onState(_onServerState);
}

/** Arrête l'envoi et le listener. */
export function stop() {
  if (_inputInterval) clearInterval(_inputInterval);
  _inputInterval = null;
  _getInputsFn   = null;
  Client.off('game:state', _onServerState);
  _prev = _curr = null;
}

// ---- Réception serveur ----

function _onServerState(state) {
  _prev     = _curr;
  _curr     = state;
  _currTime = performance.now();
  for (const fn of _cbs) fn(state);
}

// ---- Lecture des états (avec interpolation) ----

/**
 * Retourne les états de tous les joueurs pour le frame courant.
 *
 * - Joueur local      : dead reckoning — position extrapolée via velocity depuis
 *                       le dernier snapshot (élimine le délai d'un tick).
 * - Joueurs distants  : interpolation linéaire entre les deux derniers snapshots.
 * - velocity          : interpolée linéairement.
 * - driftAngle        : interpolé avec wrap ±π.
 *
 * @param {number} nowMs — performance.now() du frame de rendu
 * @returns {Object<string, { position, velocity, angle, speed, drifting, driftAngle, playerName }>|null}
 */
export function getPlayerStates(nowMs) {
  if (!_curr) return null;

  const elapsed  = nowMs - _currTime;
  const t        = Math.min(1, elapsed / TICK_MS);
  const localId  = Client.getSocketId();
  const result   = {};

  for (const [sid, curr] of Object.entries(_curr.players)) {
    const prev = _prev?.players?.[sid];

    // ---- Joueur local : dead reckoning (E03-S10) ----
    if (sid === localId && curr.velocity) {
      const dtSec = Math.min(elapsed / 1000, 0.1);
      result[sid] = {
        ...curr,
        position: {
          x: curr.position.x + curr.velocity.x * dtSec,
          z: curr.position.z + curr.velocity.z * dtSec,
        },
      };
      continue;
    }

    // ---- Joueurs distants : interpolation linéaire ----
    if (!prev) {
      result[sid] = { ...curr };
      continue;
    }

    result[sid] = {
      playerName: curr.playerName,
      speed:      curr.speed,
      drifting:   curr.drifting,
      position: {
        x: prev.position.x + (curr.position.x - prev.position.x) * t,
        z: prev.position.z + (curr.position.z - prev.position.z) * t,
      },
      angle:      _lerpAngle(prev.angle, curr.angle, t),
      velocity: curr.velocity && prev.velocity ? {
        x: prev.velocity.x + (curr.velocity.x - prev.velocity.x) * t,
        z: prev.velocity.z + (curr.velocity.z - prev.velocity.z) * t,
      } : curr.velocity,
      driftAngle: curr.driftAngle !== undefined
        ? _lerpAngle(prev.driftAngle ?? 0, curr.driftAngle, t)
        : curr.driftAngle,
    };
  }
  return result;
}

/** @returns {{ value: number, isFull: boolean }} */
export function getCohesion() {
  return _curr?.cohesion ?? { value: 0, isFull: false };
}

/** @returns {string|null} */
export function getMatchId() {
  return _curr?.matchId ?? null;
}

/** @returns {string|null} */
export function getLocalSocketId() {
  return Client.getSocketId();
}

// ---- Callbacks ----

/** @param {function} fn — appelé avec le state brut à chaque tick serveur */
export function onState(fn) { _cbs.push(fn); }

/** @param {function} fn */
export function offState(fn) {
  const i = _cbs.indexOf(fn);
  if (i >= 0) _cbs.splice(i, 1);
}

// ---- Helpers ----

// Interpolation d'angle (gère le wrap autour de ±π)
function _lerpAngle(a, b, t) {
  let diff = b - a;
  // Raccourci le chemin angulaire
  if (diff > Math.PI)  diff -= 2 * Math.PI;
  if (diff < -Math.PI) diff += 2 * Math.PI;
  return a + diff * t;
}
