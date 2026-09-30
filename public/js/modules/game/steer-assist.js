// Aide à la direction dans les couloirs.
//
// Deux « antennes » partent de l'avant de la voiture, de part et d'autre de sa
// trajectoire. Chacune mesure la place libre avant le premier mur. Si un côté
// est plus encombré que l'autre, on ajoute un léger coup de volant vers le côté
// dégagé. Dans un couloir droit, la voiture se recentre d'elle-même ; à l'entrée
// d'un virage, l'antenne côté ouverture voit plus loin et accompagne le virage.
//
// Ce n'est PAS un pilote automatique : l'aide ne connaît pas la sortie, elle ne
// choisit jamais un embranchement. Elle s'efface quand le joueur braque fort,
// en drift, en l'air et sur les plateaux — là où le joueur doit garder la main.
//
// Contrat : JSON in, JSON out, aucun DOM, aucun Three.js — importable par Node.
// S'appuie sur la grille de navigation de game/navigation.js (murs statiques :
// les cubes poussables y comptent comme murs à leur position d'origine).

import { cellIndex } from './navigation.js';

const PAS_RAYON = 0.25;   // pas d'échantillonnage le long d'une antenne (u)

// Distance libre le long d'une direction, bornée à `longueur`
function _distanceLibre(nav, x, z, dx, dz, longueur) {
  for (let d = PAS_RAYON; d <= longueur; d += PAS_RAYON) {
    const i = cellIndex(nav, x + dx * d, z + dz * d);
    if (i < 0 || !nav.walkable[i]) return d - PAS_RAYON;
  }
  return longueur;
}

/**
 * Correction de volant à ajouter à l'entrée du joueur.
 *
 * @param {object} nav   — grille de buildNavGrid(), ou null (aide coupée)
 * @param {object} state — { position, velocity, speed, airborne, drifting, elevation }
 * @param {number} steer — entrée brute du joueur, -1..1 (> 0 = droite)
 * @param {object} cfg   — /config/gameplay.json → physics.steerAssist
 * @returns {{ steer: number, gauche: number, droite: number, correction: number }}
 *   steer = entrée corrigée ; gauche/droite = place libre mesurée (debug)
 */
export function assistSteering(nav, state, steer, cfg) {
  const neutre = { steer, gauche: 0, droite: 0, correction: 0 };
  if (!nav || !cfg?.enabled) return neutre;
  if (state.airborne || state.drifting) return neutre;
  if ((state.elevation ?? 0) > 0.05) return neutre;   // plateaux : absents de la grille
  if (state.speed < (cfg.minSpeed ?? 2)) return neutre;

  // Les antennes suivent la trajectoire réelle (velocity), pas le nez : c'est
  // là que la voiture va, et ça évite de corriger pendant une petite glisse.
  const vx = state.velocity.x / state.speed;
  const vz = state.velocity.z / state.speed;

  const theta    = (cfg.whiskerAngleDeg ?? 25) * Math.PI / 180;
  const longueur = (cfg.lookaheadBase ?? 2) + state.speed * (cfg.lookaheadTime ?? 0.35);
  const c = Math.cos(theta), s = Math.sin(theta);

  // Droite = rotation vers les angles croissants (même sens que steering > 0)
  const droite = _distanceLibre(nav, state.position.x, state.position.z,
    vx * c - vz * s, vz * c + vx * s, longueur);
  const gauche = _distanceLibre(nav, state.position.x, state.position.z,
    vx * c + vz * s, vz * c - vx * s, longueur);

  // Déséquilibre normalisé ∈ [-1, 1], puis effacement quand le joueur braque
  const desequilibre = (droite - gauche) / longueur;
  const effacement   = 1 - (cfg.playerOverride ?? 0.7) * Math.min(1, Math.abs(steer));
  const correction   = Math.max(-1, Math.min(1, desequilibre * (cfg.gain ?? 0.6))) * effacement;

  return {
    steer: Math.max(-1, Math.min(1, steer + correction)),
    gauche, droite, correction,
  };
}
