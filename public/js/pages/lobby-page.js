// Point d'entrée page lobby — Story 5.3
//
// Flux :
//   1. Lire vehicule + pseudo depuis localStorage
//   2. Rejoindre le lobby via network/lobby.js
//   3. Afficher les cartes joueurs (canvas Three.js par véhicule)
//   4. Bouton "Prêt" → setReady
//   5. onStart → redirect vers game.html?match=<matchId>

import * as Lobby    from '../modules/network/lobby.js';
import { buildVehicleGroup, createPreviewScene, disposeVehicleGroup } from '../modules/voxel/renderer.js';

// ---- Lecture localStorage ----

const _vehicule    = _lireVehicule();
const _playerName  = localStorage.getItem('pop-vroum:pseudo') || 'Anonyme';

function _lireVehicule() {
  try {
    const raw = localStorage.getItem('pop-vroum:vehicule-courant');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ---- Éléments DOM ----

const elStatut          = document.getElementById('statut-connexion');
const elPanneauSansVeh  = document.getElementById('panneau-sans-vehicule');
const elPanneauLobby    = document.getElementById('panneau-lobby');
const elGrille          = document.getElementById('grille-joueurs');
const elBtnPret         = document.getElementById('btn-pret');
const elMsgAttente      = document.getElementById('message-attente');
const elBandeauErreur   = document.getElementById('bandeau-erreur');

// ---- État local ----

// Map socketId → { carte: HTMLElement, preview: { setGroup, stop } }
const _previews  = new Map();
let _estPret     = false;
let _erreurTimer = null;

// ---- Initialisation ----

if (!_vehicule) {
  // Pas de véhicule → afficher l'invite à scanner
  elPanneauSansVeh.classList.remove('cache');
  elPanneauLobby.classList.add('cache');
  elStatut.textContent = 'Aucun véhicule';
  elStatut.className   = 'statut-erreur';
} else {
  _demarrerLobby();
}

async function _demarrerLobby() {
  elStatut.textContent = 'Connexion…';
  elStatut.className   = 'statut-attente';

  Lobby.onUpdate(_rendreLobby);
  Lobby.onStart(_onPartieDemarrée);
  Lobby.onError(({ message }) => _afficherErreur(message));

  try {
    await Lobby.join({ vehicle: _vehicule, playerName: _playerName });
  } catch (err) {
    _afficherErreur(`Impossible de se connecter : ${err.message}`);
    elStatut.textContent = 'Erreur de connexion';
    elStatut.className   = 'statut-erreur';
  }
}

// ---- Rendu lobby ----

function _rendreLobby(etat) {
  // Statut en-tête
  if (etat.status === 'disconnected') {
    elStatut.textContent = 'Déconnecté…';
    elStatut.className   = 'statut-erreur';
  } else if (etat.status === 'waiting') {
    const nb = etat.players.length;
    elStatut.textContent = `Lobby — ${nb} / 5 joueur${nb > 1 ? 's' : ''}`;
    elStatut.className   = 'statut-ok';
  } else if (etat.status === 'in_game') {
    elStatut.textContent = 'Partie en cours…';
    elStatut.className   = 'statut-partie';
  }

  const moiId      = Lobby.getLocalSocketId();
  const socketsVus = new Set(etat.players.map(p => p.socketId));

  // Supprimer les cartes dont le joueur est parti
  for (const [sid, { carte, preview }] of _previews) {
    if (!socketsVus.has(sid)) {
      preview.stop();
      carte.remove();
      _previews.delete(sid);
    }
  }

  // Créer ou mettre à jour chaque carte
  for (const joueur of etat.players) {
    if (_previews.has(joueur.socketId)) {
      _mettreAJourCarte(joueur, moiId);
    } else {
      _creerCarte(joueur, moiId);
    }
  }

  // Mettre à jour le bouton "Prêt"
  const moi = etat.players.find(p => p.socketId === moiId);
  if (moi) {
    _estPret = moi.ready;
    elBtnPret.textContent = _estPret ? 'Annuler' : 'Je suis prêt !';
    elBtnPret.classList.toggle('est-pret', _estPret);
  }

  // Message d'attente
  const tousPretsCount = etat.players.filter(p => p.ready).length;
  const total          = etat.players.length;
  if (total > 0 && tousPretsCount === total) {
    elMsgAttente.textContent = 'Tous prêts — lancement imminent…';
  } else if (total > 0) {
    elMsgAttente.textContent = `${tousPretsCount} / ${total} prêt${tousPretsCount > 1 ? 's' : ''}`;
  } else {
    elMsgAttente.textContent = 'En attente des autres joueurs…';
  }
}

function _creerCarte(joueur, moiId) {
  const estMoi = joueur.socketId === moiId;

  const carte = document.createElement('div');
  carte.className = 'carte-joueur';
  if (estMoi) carte.classList.add('moi');

  // Canvas Three.js
  const canvas = document.createElement('canvas');
  canvas.width  = 140;
  canvas.height = 110;
  carte.appendChild(canvas);

  // Pseudo
  const pseudo = document.createElement('p');
  pseudo.className = 'carte-pseudo' + (estMoi ? ' moi' : '');
  pseudo.textContent = joueur.playerName || 'Anonyme';
  carte.appendChild(pseudo);

  // Badge statut
  const badge = document.createElement('span');
  badge.className = 'carte-badge ' + (joueur.ready ? 'pret' : 'attente');
  badge.textContent = joueur.ready ? 'Prêt !' : 'En attente';
  carte.appendChild(badge);

  elGrille.appendChild(carte);

  // Scène Three.js
  const preview = createPreviewScene(canvas);
  if (joueur.vehicle?.grid && joueur.vehicle?.wheelPositions) {
    try {
      const group = buildVehicleGroup(joueur.vehicle);
      preview.setGroup(group);
    } catch (e) {
      console.warn('[lobby] Impossible de rendre le véhicule :', e);
    }
  }

  _previews.set(joueur.socketId, { carte, preview });

  // Statut prêt sur la carte
  if (joueur.ready) carte.classList.add('pret');
}

function _mettreAJourCarte(joueur, moiId) {
  const { carte } = _previews.get(joueur.socketId);

  // Badge
  const badge = carte.querySelector('.carte-badge');
  if (badge) {
    badge.textContent = joueur.ready ? 'Prêt !' : 'En attente';
    badge.className   = 'carte-badge ' + (joueur.ready ? 'pret' : 'attente');
  }

  // Bordure verte si prêt
  carte.classList.toggle('pret', joueur.ready);
}

// ---- Lancement de la partie ----

function _onPartieDemarrée({ matchId, map, playerId, players }) {
  elStatut.textContent = 'Lancement…';
  elStatut.className   = 'statut-partie';
  elBtnPret.disabled   = true;

  // Nettoyage des scènes Three.js
  for (const { preview } of _previews.values()) preview.stop();
  _previews.clear();

  // Sauvegarder les données du match pour game-page.js
  sessionStorage.setItem('pop-vroum:matchId', matchId);
  sessionStorage.setItem('pop-vroum:playerId', playerId);
  sessionStorage.setItem('pop-vroum:map', JSON.stringify(map));
  sessionStorage.setItem('pop-vroum:players', JSON.stringify(players));

  window.location.href = `game.html?match=${encodeURIComponent(matchId)}`;
}

// ---- Bouton Prêt ----

elBtnPret.addEventListener('click', () => {
  _estPret = !_estPret;
  Lobby.setReady(_estPret);
  elBtnPret.textContent = _estPret ? 'Annuler' : 'Je suis prêt !';
  elBtnPret.classList.toggle('est-pret', _estPret);
});

// ---- Nettoyage à la fermeture ----

window.addEventListener('beforeunload', () => {
  Lobby.leave();
});

// ---- Utilitaire erreur ----

function _afficherErreur(message) {
  elBandeauErreur.textContent = message;
  elBandeauErreur.classList.remove('cache');
  clearTimeout(_erreurTimer);
  _erreurTimer = setTimeout(() => {
    elBandeauErreur.classList.add('cache');
  }, 4000);
}
