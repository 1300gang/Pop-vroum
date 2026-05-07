// Logique du lobby pré-partie — Story 5.3
//
// Centralise la gestion de l'état du lobby côté client.
// N'accède jamais au DOM — communique uniquement via des callbacks.
//
// Flux :
//   join() → onUpdate() × N → (allReady) → onStart()
//
// API publique :
//   join({ vehicle, playerName, lobbyId? }) → Promise<void>
//   setReady(ready)
//   leave()
//   getState()         → { id, status, players[], matchId, map }
//   getLocalSocketId() → string | null
//   onUpdate(fn)   — fn(state) à chaque changement de lobby
//   onStart(fn)    — fn({ matchId, map }) au lancement de la partie
//   onError(fn)    — fn({ message }) en cas d'erreur

import * as Client from './client.js';

// État courant du lobby (objet plat, jamais muté directement depuis l'extérieur)
let _etat = _etatVide();

// Registres de callbacks
const _cbs = { update: [], start: [], error: [] };

function _etatVide() {
  return { id: null, status: 'disconnected', players: [], matchId: null, map: null };
}

function _notifier(evt, data) {
  for (const fn of _cbs[evt]) fn(data);
}

/**
 * Initialise la connexion et rejoint le lobby.
 * Les callbacks onUpdate / onStart / onError doivent être enregistrés avant d'appeler join().
 *
 * @param {{ vehicle: object, playerName: string, lobbyId?: string }} opts
 * @returns {Promise<void>}
 */
export async function join({ vehicle, playerName, lobbyId } = {}) {
  _etat = { ..._etatVide(), status: 'connecting' };

  await Client.init();

  // Reconnexion — rejoindre de nouveau si le socket se reconnecte
  Client.onConnect(() => {
    if (_etat.status !== 'disconnected') {
      Client.joinLobby({ vehicle, playerName, lobbyId: _etat.id ?? lobbyId });
    }
  });

  Client.onDisconnect(() => {
    _etat.status = 'disconnected';
    _notifier('update', { ..._etat });
  });

  Client.onLobbyUpdate((data) => {
    _etat.id      = data.id;
    _etat.status  = data.status === 'in_game' ? 'in_game' : 'waiting';
    _etat.players = data.players ?? [];
    _notifier('update', { ..._etat });
  });

  Client.onLobbyStart(({ matchId, map, playerId, players }) => {
    _etat.matchId = matchId;
    _etat.map     = map;
    _etat.status  = 'in_game';
    _notifier('start', { matchId, map, playerId, players });
  });

  Client.onLobbyError(({ message }) => {
    _notifier('error', { message });
  });

  Client.joinLobby({ vehicle, playerName, lobbyId });
}

/**
 * Indique que le joueur local est prêt (ou non).
 * @param {boolean} ready
 */
export function setReady(ready = true) {
  Client.sendReady(ready);
}

/** Quitte le lobby proprement. */
export function leave() {
  Client.leaveLobby();
  _etat = _etatVide();
  _notifier('update', { ..._etat });
}

/** Retourne une copie de l'état courant. */
export function getState() {
  return { ..._etat, players: [..._etat.players] };
}

/** Retourne le socketId local (null si non connecté). */
export function getLocalSocketId() {
  return Client.getSocketId();
}

// ---- Enregistrement des callbacks ----

/** @param {function} fn — appelé avec l'état complet à chaque mise à jour */
export function onUpdate(fn) { _cbs.update.push(fn); }

/** @param {function} fn — appelé avec { matchId, map } au lancement */
export function onStart(fn) { _cbs.start.push(fn); }

/** @param {function} fn — appelé avec { message } en cas d'erreur serveur */
export function onError(fn) { _cbs.error.push(fn); }
