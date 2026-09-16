// Détection de fin de partie (victoire) côté serveur.
//
// SOLO-05 : un joueur « arrive » quand sa distance au centre du bloc arrivée
//           est inférieure à WIN_RADIUS (défaut 4.0).
// La victoire se déclenche quand tous les joueurs connectés sont arrivés.
// Un seul événement game:victory est émis par match.
//
// API publique :
//   checkVictory(match)  → boolean
//   resetMatch(matchId)  → void

// matchId → Set<playerId> des joueurs déjà arrivés
const _arrived  = new Map();
// matchId → boolean (victoire déjà déclenchée)
const _declared = new Set();

/**
 * À appeler à chaque tick pour vérifier si la victoire est atteinte.
 *
 * @param {{ id, playerStates, map, io, roomId, cfg }} match
 * @returns {boolean} true si la victoire vient d'être déclarée ce tick
 */
export function checkVictory(match) {
  const { id: matchId, playerStates, map, io, roomId, cfg } = match;

  if (_declared.has(matchId)) return false;

  if (!_arrived.has(matchId)) _arrived.set(matchId, new Set());
  const arrived = _arrived.get(matchId);

  // SOLO-05 : position d'arrivée = centre du bloc exit (coin W-1,H-1)
  const exitPos   = map.exit?.worldCenter ?? map.finishPosition;
  const winRadius = cfg?.solo?.WIN_RADIUS ?? 4.0;

  for (const [pid, ps] of playerStates) {
    if (arrived.has(pid)) continue;

    const pos  = ps.physicsState.position;
    const dist = Math.hypot(pos.x - exitPos.x, pos.z - exitPos.z);

    if (dist < winRadius) {
      arrived.add(pid);
      console.log(`[match-end] Joueur ${pid} arrivé (dist=${dist.toFixed(1)}, match ${matchId})`);

      io.to(roomId).emit('game:player-arrived', {
        matchId,
        playerId: pid,
        ordre:    arrived.size,
      });
    }
  }

  // Tous les joueurs connectés sont-ils arrivés ?
  const connectes = [...playerStates.values()].filter(ps => ps.connected);
  if (connectes.length === 0) return false;

  const tousArrivés = connectes.every(ps => arrived.has(ps.playerId));
  if (!tousArrivés) return false;

  _declared.add(matchId);

  const podium = [...arrived].map((pid, i) => {
    const ps = playerStates.get(pid);
    return {
      rang:       i + 1,
      playerId:   pid,
      playerName: ps?.playerName ?? pid,
    };
  });

  console.log(`[match-end] Victoire — match ${matchId}`, podium.map(p => `${p.rang}. ${p.playerName}`).join(', '));

  io.to(roomId).emit('game:victory', { matchId, podium });

  return true;
}

/**
 * Réinitialise l'état de fin pour un match (appelé lors de stopMatch).
 * @param {string} matchId
 */
export function resetMatch(matchId) {
  _arrived.delete(matchId);
  _declared.delete(matchId);
}
