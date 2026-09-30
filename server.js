import express          from 'express';
import { createServer } from 'http';
import { Server }       from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdir }       from 'fs/promises';
import { randomBytes }   from 'crypto';

import * as LobbyManager            from './server/lobby-manager.js';
import * as GameLoop                from './server/game-loop.js';
import { registerAdminRoutes }      from './server/admin-routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// 3000 par défaut (l'adresse que l'animateur·trice donne aux tablettes en atelier),
// surchargeable par la variable d'environnement pour faire tourner deux instances.
const PORT      = Number(process.env.PORT) || 3000;

const app        = express();
const httpServer = createServer(app);
const io         = new Server(httpServer);

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

registerAdminRoutes(app);
app.use('/config', express.static(join(__dirname, 'config')));
app.use('/data',   express.static(join(__dirname, 'data')));

// Liste les blocs map disponibles (seeds + générés en atelier).
app.get('/api/map-blocks', async (_req, res) => {
  try {
    const lister = async (dossier) => {
      const dir      = join(__dirname, 'data', 'map-blocks', dossier);
      const fichiers = await readdir(dir).catch(() => []);
      return fichiers
        .filter(f => f.endsWith('.json'))
        .map(f => `/data/map-blocks/${dossier}/${f}`);
    };
    res.json({ seed: await lister('_seed'), generated: await lister('generated') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Helpers ----

// Sanitise un champ texte entrant — protection XSS + whitelist.
// Règles pseudo : alphanumérique, tiret, underscore, espace, accents courants.
// Règles nom bloc / note : maxLength=100, même whitelist élargie.
function sanitizeText(input, maxLength = 20) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Whitelist : lettres (y compris accents), chiffres, tiret, underscore, espace
    .replace(/[^\p{L}\p{N}_\- ]/gu, '')
    .trim()
    .slice(0, maxLength);
}

// ---- Suivi socket → match ----
// socketId → matchId
const socketToMatch = new Map();

// ---- Socket.io ----

io.on('connection', (socket) => {
  console.log(`Connexion : ${socket.id}`);

  // ------------------------------------------------------------------
  // lobby:join
  // ------------------------------------------------------------------
  socket.on('lobby:join', ({ lobbyId, vehicle, playerName } = {}) => {
    const cible    = lobbyId ?? LobbyManager.findOrCreateLobby();
    const nomPropre = sanitizeText(playerName) || 'Anonyme';

    const result = LobbyManager.joinLobby(cible, socket.id, vehicle ?? null, nomPropre);
    if (!result.ok) {
      socket.emit('lobby:error', { message: result.error });
      return;
    }

    socket.join(cible);
    console.log(`${nomPropre} (${socket.id}) → lobby ${cible}`);
    io.to(cible).emit('lobby:update', LobbyManager.getLobbyState(cible));
  });

  // ------------------------------------------------------------------
  // lobby:leave
  // ------------------------------------------------------------------
  socket.on('lobby:leave', () => {
    const lobbyId = LobbyManager.leaveBySocket(socket.id);
    if (!lobbyId) return;
    socket.leave(lobbyId);
    io.to(lobbyId).emit('lobby:update', LobbyManager.getLobbyState(lobbyId));
  });

  // ------------------------------------------------------------------
  // lobby:ready
  // ------------------------------------------------------------------
  socket.on('lobby:ready', ({ ready = true } = {}) => {
    const lobbyId = LobbyManager.setReady(socket.id, ready);
    if (!lobbyId) return;

    io.to(lobbyId).emit('lobby:update', LobbyManager.getLobbyState(lobbyId));

    if (LobbyManager.allReady(lobbyId)) {
      _lancerMatch(lobbyId);
    }
  });

  // ------------------------------------------------------------------
  // game:rejoin — le client se reconnecte après navigation lobby → game
  // Payload : { matchId, playerId }
  // ------------------------------------------------------------------
  socket.on('game:rejoin', ({ matchId, playerId } = {}) => {
    console.log(`[rejoin] socket=${socket.id} matchId=${matchId} playerId=${playerId}`);
    if (!matchId || !playerId) {
      socket.emit('game:rejoin:error', { message: 'matchId et playerId requis' });
      return;
    }

    const match = GameLoop.getMatch(matchId);
    if (!match) {
      console.log(`[rejoin] ÉCHEC — match "${matchId}" introuvable. Matchs actifs :`, [...GameLoop.listMatchIds()]);
    } else if (!match.playerStates.has(playerId)) {
      console.log(`[rejoin] ÉCHEC — playerId "${playerId}" absent. Joueurs :`, [...match.playerStates.keys()]);
    }

    const ok = GameLoop.rejoinPlayer(matchId, playerId, socket.id, socket);
    if (!ok) {
      socket.emit('game:rejoin:error', { message: 'Match ou joueur introuvable' });
      return;
    }

    socketToMatch.set(socket.id, matchId);
    // L'état courant accompagne la confirmation : voxels perdus, poteaux tombés
    // et cubes déplacés depuis l'envoi de la map
    socket.emit('game:rejoin:ok', { matchId, playerId, snapshot: GameLoop.getSnapshot(matchId) });
  });

  // ------------------------------------------------------------------
  // game:input
  // ------------------------------------------------------------------
  socket.on('game:input', (inputs) => {
    const matchId = socketToMatch.get(socket.id);
    if (!matchId) return;
    GameLoop.applyInput(matchId, socket.id, inputs);
  });

  // ------------------------------------------------------------------
  // disconnect
  // ------------------------------------------------------------------
  socket.on('disconnect', () => {
    console.log(`Déconnexion : ${socket.id}`);

    // Retrait du lobby si en attente
    const lobbyId = LobbyManager.leaveBySocket(socket.id);
    if (lobbyId) {
      io.to(lobbyId).emit('lobby:update', LobbyManager.getLobbyState(lobbyId));
    }

    // Gestion match : retirer le socket mais préserver le joueur (rejoin possible)
    const matchId = socketToMatch.get(socket.id);
    if (matchId) {
      socketToMatch.delete(socket.id);
      GameLoop.handleDisconnect(socket.id);
    }
  });
});

// ---- Lancement d'un match ----

async function _lancerMatch(lobbyId) {
  const players = LobbyManager.getLobbyPlayers(lobbyId);
  LobbyManager.startLobby(lobbyId);

  const matchId = `match_${Date.now()}_${randomBytes(3).toString('hex')}`;

  try {
    const { map, playerInfos } = await GameLoop.startMatch(matchId, players, io, lobbyId);

    // Enregistre matchId pour chaque socket
    for (const p of players) {
      socketToMatch.set(p.socketId, matchId);
    }

    // Envoi individuel : chaque joueur reçoit son propre playerId
    for (const info of playerInfos) {
      io.to(info.socketId).emit('lobby:start', {
        matchId,
        map,
        playerId: info.playerId,
        players:  playerInfos.map(pi => ({
          playerId:   pi.playerId,
          playerName: pi.playerName,
          vehicle:    pi.vehicle,
        })),
      });
    }

    console.log(`Lobby ${lobbyId} → match ${matchId}`);
  } catch (err) {
    console.error(`Erreur au lancement du match :`, err);
    io.to(lobbyId).emit('lobby:error', { message: `Impossible de démarrer la partie : ${err.message}` });
  }
}

// ---- Démarrage ----

httpServer.listen(PORT, () => {
  console.log(`Pop Vroum — serveur démarré sur http://localhost:${PORT}`);
});
