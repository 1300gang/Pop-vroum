// Détection de fin de partie (victoire) côté serveur.
//
// Un joueur "arrive" quand sa position X dépasse finishX - ARRIVE_MARGIN.
// La victoire se déclenche quand tous les joueurs connectés sont arrivés.
// Un seul événement game:victory est émis par match.
//
// API publique :
//   checkVictory(match)  → boolean  (true si la victoire vient d'être déclarée)
//   resetMatch(matchId)  → void     (à appeler à stopMatch)

// Marge en unités monde avant le bord droit pour déclencher "arrivé".
// blockScale=2, BLOCK_SIZE=8 → dernière colonne arrivée = 16 unités.
// On déclenche dès que le joueur entre dans le blocmap d'arrivée.
const ARRIVE_MARGIN = 14;

// matchId → Set<playerId> des joueurs déjà arrivés
const _arrived  = new Map();
// matchId → boolean (victoire déjà déclenchée)
const _declared = new Set();

/**
 * À appeler à chaque tick pour vérifier si la victoire est atteinte.
 *
 * @param {{ id, playerStates, map, io, roomId }} match
 * @returns {boolean} true si la victoire vient d'être déclarée ce tick
 */
export function checkVictory(match) {
  const { id: matchId, playerStates, map, io, roomId } = match;

  // Déjà déclarée → ne rien faire
  if (_declared.has(matchId)) return false;

  if (!_arrived.has(matchId)) _arrived.set(matchId, new Set());
  const arrived = _arrived.get(matchId);

  const finishX = map.finishPosition.x - ARRIVE_MARGIN;

  // Marquer les joueurs arrivés
  for (const [pid, ps] of playerStates) {
    if (!arrived.has(pid) && ps.physicsState.position.x >= finishX) {
      arrived.add(pid);
      console.log(`[match-end] Joueur ${pid} arrivé (x=${ps.physicsState.position.x.toFixed(1)}, match ${matchId})`);

      // Notifier le groupe : ce joueur est arrivé
      io.to(roomId).emit('game:player-arrived', {
        matchId,
        playerId: pid,
        ordre:    arrived.size,
      });
    }
  }

  // Vérifier si tous les joueurs connectés sont arrivés
  const connectes = [...playerStates.values()].filter(ps => ps.connected);
  if (connectes.length === 0) return false;

  const tousArrivés = connectes.every(ps => arrived.has(ps.playerId));
  if (!tousArrivés) return false;

  // Victoire !
  _declared.add(matchId);

  // Podium = ordre d'arrivée (Set conserve l'ordre d'insertion)
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
