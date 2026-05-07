// Wrapper Socket.io côté client — Story 5.2
//
// Centralise toute la communication avec le serveur.
// Le module se connecte automatiquement à l'initialisation.
// Socket.io gère la reconnexion nativement.
//
// API publique :
//   init()                          → Promise<void>  (attend la connexion)
//   joinLobby({ lobbyId?, vehicle, playerName }) → void
//   leaveLobby()                    → void
//   sendReady(ready)                → void
//   sendInput({ steering, braking }) → void
//
//   onLobbyUpdate(fn)   → fn({ id, status, players[] })
//   onLobbyStart(fn)    → fn({ matchId, map })
//   onLobbyError(fn)    → fn({ message })
//   onState(fn)         → fn({ matchId, players, cohesion })
//   onEvent(fn)         → fn({ type, data })
//   onGameEnd(fn)       → fn({ result, vehicles })
//   onConnect(fn)       → fn()
//   onDisconnect(fn)    → fn(reason)
//
//   isConnected()       → boolean
//   getSocketId()       → string | null
//   off(event, fn)      → void  (désabonnement)

// Socket.io ESM — servi automatiquement par notre serveur, fonctionne offline.
import { io } from '/socket.io/socket.io.esm.min.js';

let _socket = null;

/**
 * Initialise la connexion Socket.io et attend qu'elle soit établie.
 * Idempotent : si déjà connecté, résout immédiatement.
 *
 * @returns {Promise<void>}
 */
export function init() {
  if (_socket?.connected) return Promise.resolve();

  if (!_socket) {
    _socket = io({
      reconnection:      true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
  }

  return new Promise((resolve, reject) => {
    if (_socket.connected) { resolve(); return; }

    const onConnect = () => { cleanup(); resolve(); };
    const onError   = (err) => { cleanup(); reject(err); };

    _socket.once('connect', onConnect);
    _socket.once('connect_error', onError);

    function cleanup() {
      _socket.off('connect', onConnect);
      _socket.off('connect_error', onError);
    }
  });
}

// ---- Envoi (client → serveur) ----

/**
 * Rejoint un lobby.
 * @param {{ lobbyId?: string, vehicle: object, playerName: string }} opts
 */
export function joinLobby({ lobbyId, vehicle, playerName } = {}) {
  _assertConnected();
  _socket.emit('lobby:join', { lobbyId, vehicle, playerName });
}

/** Quitte le lobby en cours. */
export function leaveLobby() {
  _assertConnected();
  _socket.emit('lobby:leave');
}

/**
 * Indique que le joueur est prêt (ou non).
 * @param {boolean} ready
 */
export function sendReady(ready = true) {
  _assertConnected();
  _socket.emit('lobby:ready', { ready });
}

/**
 * Envoie les inputs de pilotage.
 * @param {{ steering: number, braking: number }} inputs
 */
export function sendInput({ steering = 0, braking = 0 } = {}) {
  if (!_socket?.connected) return; // silencieux si déco (input continu)
  _socket.emit('game:input', { steering, braking });
}

// ---- Réception (serveur → client) ----

/** @param {function} fn — appelé avec l'état du lobby */
export function onLobbyUpdate(fn) { _on('lobby:update', fn); }

/** @param {function} fn — appelé avec { matchId, map } au lancement */
export function onLobbyStart(fn) { _on('lobby:start', fn); }

/** @param {function} fn — appelé avec { message } en cas d'erreur lobby */
export function onLobbyError(fn) { _on('lobby:error', fn); }

/** @param {function} fn — appelé à 30 Hz avec l'état de jeu complet */
export function onState(fn) { _on('game:state', fn); }

/** @param {function} fn — appelé pour les événements ponctuels (impact, voxel perdu…) */
export function onEvent(fn) { _on('game:event', fn); }

/** @param {function} fn — appelé en fin de partie avec { result, vehicles } */
export function onGameEnd(fn) { _on('game:end', fn); }

/** @param {function} fn — appelé à chaque (re)connexion */
export function onConnect(fn) { _on('connect', fn); }

/** @param {function} fn — appelé à chaque déconnexion (reason: string) */
export function onDisconnect(fn) { _on('disconnect', fn); }

/**
 * S'abonne à un événement personnalisé depuis le serveur.
 * @param {string}   event
 * @param {function} fn
 */
export function on(event, fn) {
  _assertSocket();
  _socket.on(event, fn);
}

/**
 * Émet un événement personnalisé vers le serveur.
 * @param {string} event
 * @param {*}      data
 */
export function emit(event, data) {
  _assertConnected();
  _socket.emit(event, data);
}

/**
 * Écoute un événement une seule fois.
 * @param {string}   event
 * @param {function} fn
 */
export function once(event, fn) {
  _assertSocket();
  _socket.once(event, fn);
}

/**
 * Désabonne une fonction d'un événement Socket.io.
 * @param {string}   event
 * @param {function} fn
 */
export function off(event, fn) {
  _socket?.off(event, fn);
}

/**
 * Déconnecte proprement le socket. Utilisé au moment de quitter la partie.
 */
export function disconnect() {
  _socket?.disconnect();
}

// ---- État de connexion ----

/** @returns {boolean} */
export function isConnected() {
  return _socket?.connected ?? false;
}

/** @returns {string|null} */
export function getSocketId() {
  return _socket?.id ?? null;
}

// ---- Helpers internes ----

function _on(event, fn) {
  _assertSocket();
  _socket.on(event, fn);
}

function _assertSocket() {
  if (!_socket) throw new Error('network/client : appelez init() avant d\'utiliser le client.');
}

function _assertConnected() {
  _assertSocket();
  if (!_socket.connected) throw new Error('network/client : socket non connecté.');
}
