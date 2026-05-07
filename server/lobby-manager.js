// Gestion des lobbies (salles d'attente pré-partie).
//
// Un lobby contient 1 à 5 joueurs qui attendent avant le lancement.
// Chaque joueur rejoint avec son véhicule JSON (issu du scan).
// Quand tous sont prêts, le lobby passe en statut 'in_game'.
//
// API :
//   findOrCreateLobby()              → lobbyId
//   joinLobby(lobbyId, socketId, vehicle, playerName) → { ok, error? }
//   leaveBySocket(socketId)          → lobbyId | null
//   setReady(socketId, ready)        → lobbyId | null
//   getLobbyBySocket(socketId)       → lobby | null
//   getLobbyState(lobbyId)           → état sérialisable pour broadcast
//   allReady(lobbyId)                → boolean
//   startLobby(lobbyId)              → void

import { randomBytes } from 'crypto';

const MAX_PLAYERS = 5;

// Map lobbyId → { id, players: Map<socketId, PlayerEntry>, status }
const lobbies = new Map();

function _genId() {
  return `lobby_${Date.now()}_${randomBytes(3).toString('hex')}`;
}

/**
 * Trouve un lobby ouvert avec de la place, ou en crée un nouveau.
 */
export function findOrCreateLobby() {
  for (const lobby of lobbies.values()) {
    if (lobby.status === 'waiting' && lobby.players.size < MAX_PLAYERS) {
      return lobby.id;
    }
  }
  const id = _genId();
  lobbies.set(id, { id, players: new Map(), status: 'waiting' });
  return id;
}

/**
 * Ajoute un joueur à un lobby existant.
 * @returns {{ ok: boolean, error?: string }}
 */
export function joinLobby(lobbyId, socketId, vehicle, playerName) {
  const lobby = lobbies.get(lobbyId);
  if (!lobby) return { ok: false, error: 'Lobby introuvable' };
  if (lobby.status !== 'waiting') return { ok: false, error: 'Partie déjà en cours' };
  if (lobby.players.size >= MAX_PLAYERS) return { ok: false, error: 'Lobby plein (5 joueurs max)' };

  lobby.players.set(socketId, { vehicle, playerName, ready: false });
  return { ok: true };
}

/**
 * Retire un joueur depuis son socketId.
 * Supprime le lobby s'il est vide.
 * @returns {string|null} lobbyId concerné, ou null si non trouvé
 */
export function leaveBySocket(socketId) {
  for (const lobby of lobbies.values()) {
    if (!lobby.players.has(socketId)) continue;
    lobby.players.delete(socketId);
    if (lobby.players.size === 0) {
      lobbies.delete(lobby.id);
    }
    return lobby.id;
  }
  return null;
}

/**
 * Marque un joueur comme prêt (ou non).
 * @returns {string|null} lobbyId concerné
 */
export function setReady(socketId, ready = true) {
  for (const lobby of lobbies.values()) {
    const player = lobby.players.get(socketId);
    if (!player) continue;
    player.ready = ready;
    return lobby.id;
  }
  return null;
}

/**
 * Retourne le lobby dans lequel se trouve un socket, ou null.
 */
export function getLobbyBySocket(socketId) {
  for (const lobby of lobbies.values()) {
    if (lobby.players.has(socketId)) return lobby;
  }
  return null;
}

/**
 * Retourne l'état d'un lobby sous forme sérialisable (pour emit Socket.io).
 */
export function getLobbyState(lobbyId) {
  const lobby = lobbies.get(lobbyId);
  if (!lobby) return null;
  return {
    id: lobby.id,
    status: lobby.status,
    players: [...lobby.players.entries()].map(([socketId, p]) => ({
      socketId,
      playerName: p.playerName,
      vehicle:    p.vehicle,
      ready:      p.ready,
    })),
  };
}

/**
 * Retourne true si tous les joueurs sont prêts (et qu'il y en a au moins 1).
 */
export function allReady(lobbyId) {
  const lobby = lobbies.get(lobbyId);
  if (!lobby || lobby.players.size === 0) return false;
  for (const p of lobby.players.values()) {
    if (!p.ready) return false;
  }
  return true;
}

/**
 * Passe le lobby en statut 'in_game'.
 */
export function startLobby(lobbyId) {
  const lobby = lobbies.get(lobbyId);
  if (lobby) lobby.status = 'in_game';
}

/**
 * Retourne la liste des joueurs d'un lobby (pour démarrer le match).
 * @returns {Array<{ socketId, playerName, vehicle }>}
 */
export function getLobbyPlayers(lobbyId) {
  const lobby = lobbies.get(lobbyId);
  if (!lobby) return [];
  return [...lobby.players.entries()].map(([socketId, p]) => ({
    socketId,
    playerName: p.playerName,
    vehicle:    p.vehicle,
  }));
}
