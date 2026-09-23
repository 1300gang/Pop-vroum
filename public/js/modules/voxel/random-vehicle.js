// Module voxel/random-vehicle.js — génération d'un véhicule aléatoire complet.
//
// Entrée : nom (string), options (optionnel)
// Sortie : { grid, wheelPositions, stats, powers, palette, nom }
//
// Les probabilités de couleur sont configurables via `options.probas`.
// La densité de voxels est configurable via `options.densite`.

import { buildVoxelGrid }  from './builder.js';
import { detectWheels }    from './wheel-detector.js';
import { computeStats }    from './stats.js';

// ---- Constantes ----

const COULEURS = ['red', 'green', 'blue', 'orange', 'violet', 'pink'];

// Couleurs lisibles en français
export const COULEUR_FR = {
  red: 'rouge', green: 'vert', blue: 'bleu',
  orange: 'orange', violet: 'violet', pink: 'rose',
};

export const COULEUR_HEX = {
  red: '#e62020', green: '#1fa830', blue: '#1a52e0',
  orange: '#f07418', violet: '#7d2dc0', pink: '#e882b9',
};

// Probabilités relatives par défaut (équilibrées, légèrement moins de violet/rose).
// Surcharger via options.probas = { red: 2.0, green: 1.0, … }
const PROBA_DEFAUT = {
  red: 1.0, green: 1.0, blue: 1.0,
  orange: 1.0, violet: 0.7, pink: 0.7,
};

// Densité par défaut : ~60 % de voxels pleins → forme intéressante sans être solide
const DENSITE_DEFAUT = 0.62;

// Nombre minimum de voxels pour un véhicule valide
const VOXELS_MIN = 20;

// ---- Génération des vues ----

function _tirerCouleur(distribution) {
  const r = Math.random();
  let cumul = 0;
  for (const { couleur, prob } of distribution) {
    cumul += prob;
    if (r < cumul) return couleur;
  }
  return distribution[distribution.length - 1].couleur;
}

function _construireDistribution(probas) {
  const total = Object.values(probas).reduce((s, v) => s + v, 0);
  return COULEURS
    .filter(c => (probas[c] ?? 0) > 0)
    .map(c => ({ couleur: c, prob: (probas[c] ?? 0) / total }));
}

function _genererVues(distribution, densite) {
  // Cellule : couleur aléatoire pondérée, ou null selon la densité
  const c = () => Math.random() < densite ? _tirerCouleur(distribution) : null;

  // Vue face (4 colonnes z × 4 rangées y) — rangée y=3 = toit, creux au centre
  const face = Array.from({ length: 4 }, (_, z) =>
    Array.from({ length: 4 }, (_, y) =>
      y === 3 ? (z >= 1 && z <= 2 ? c() : null) : c()
    )
  );

  // Vue profil (8 colonnes x × 4 rangées y) — rangée y=3 = toit, dégagé aux extrémités
  const profile = Array.from({ length: 8 }, (_, x) =>
    Array.from({ length: 4 }, (_, y) => {
      if (y === 3) return (x >= 1 && x <= 6) ? c() : null;
      return c();
    })
  );

  // Vue dessus (8 colonnes x × 4 colonnes z)
  const top = Array.from({ length: 8 }, () =>
    Array.from({ length: 4 }, () => c())
  );

  return { face, profile, top };
}

// ---- Dérivation des grilles 2D pour wheel-detector ----

function _deriveProfileGrid(grid) {
  return Array.from({ length: 8 }, (_, x) =>
    Array.from({ length: 4 }, (_, y) => {
      for (let z = 0; z < 4; z++) if (grid[x][z][y]) return grid[x][z][y].color;
      return null;
    })
  );
}

function _deriveTopGrid(grid) {
  return Array.from({ length: 8 }, (_, x) =>
    Array.from({ length: 4 }, (_, z) => {
      for (let y = 0; y < 4; y++) if (grid[x][z][y]) return grid[x][z][y].color;
      return null;
    })
  );
}

function _compterVoxels(grid) {
  let n = 0;
  for (let x = 0; x < 8; x++)
    for (let z = 0; z < 4; z++)
      for (let y = 0; y < 4; y++)
        if (grid[x][z][y]) n++;
  return n;
}

function _compterParCouleur(grid) {
  const counts = {};
  for (let x = 0; x < 8; x++)
    for (let z = 0; z < 4; z++)
      for (let y = 0; y < 4; y++) {
        const v = grid[x][z][y];
        if (v) counts[v.color] = (counts[v.color] || 0) + 1;
      }
  return counts;
}

// ---- API publique ----

/**
 * Génère un véhicule aléatoire complet.
 *
 * @param {string} nom                 — nom du véhicule (affiché dans le HUD)
 * @param {object} [options]
 * @param {object} [options.probas]    — probabilités relatives par couleur (ex: { red: 2.0, blue: 0.5 })
 * @param {number} [options.densite]   — densité de voxels (0..1, défaut 0.62)
 * @returns {Promise<{ grid, wheelPositions, stats, powers, palette, nom, voxelCount }>}
 */
export async function generateRandomVehicle(nom = 'Véhicule test', options = {}) {
  const probas      = { ...PROBA_DEFAUT, ...(options.probas ?? {}) };
  const densite     = options.densite ?? DENSITE_DEFAUT;
  const distribution = _construireDistribution(probas);

  // Générer jusqu'à avoir assez de voxels (max 10 tentatives)
  let grid;
  let tentatives = 0;
  do {
    const vues = _genererVues(distribution, densite);
    grid = buildVoxelGrid(vues);
    tentatives++;
  } while (_compterVoxels(grid) < VOXELS_MIN && tentatives < 10);

  const wheelPositions = detectWheels({
    profileGrid: _deriveProfileGrid(grid),
    topGrid:     _deriveTopGrid(grid),
  });

  const { stats, powers } = await computeStats(grid);

  // Palette = couleurs présentes, triées par fréquence décroissante
  const parCouleur = _compterParCouleur(grid);
  const palette = Object.entries(parCouleur)
    .sort((a, b) => b[1] - a[1])
    .map(([color]) => color);

  return {
    grid,
    wheelPositions,
    stats,
    powers,
    palette,
    nom,
    voxelCount:  _compterVoxels(grid),
    parCouleur,
  };
}

// ---- Véhicules de référence (équilibrage) ----
//
// L'aléatoire ne sert à rien pour équilibrer : deux essais ne sont jamais
// comparables. Ces véhicules-ci sont construits par une règle fixe, donc leurs
// stats sont exactement reproductibles d'une session à l'autre.
//
// Chaque préréglage décrit une carrosserie (longueur × largeur × hauteur en
// voxels, à partir de l'arrière) et un remplissage par couleur. Rappel de la
// convention : grid[x][z][y], x = 0..7 avant-arrière (7 = avant),
// z = 0..3 gauche-droite, y = 0..3 bas-haut.

export const PRESETS = [
  {
    id: 'etalon', nom: 'Étalon',
    note: 'Référence neutre : un tiers de chaque couleur primaire.',
    forme: { lg: 6, la: 4, ht: 2 },
    couleurs: ['red', 'green', 'blue'],
  },
  {
    id: 'fusee', nom: 'Fusée',
    note: 'Tout en rouge : vitesse maximale, rien d\'autre.',
    forme: { lg: 6, la: 3, ht: 2 },
    couleurs: ['red'],
  },
  {
    id: 'kart', nom: 'Kart',
    note: 'Tout en vert : colle à la route, ne dérape presque jamais.',
    forme: { lg: 5, la: 4, ht: 2 },
    couleurs: ['green'],
  },
  {
    id: 'catapulte', nom: 'Catapulte',
    note: 'Tout en bleu : reprise foudroyante, vitesse de pointe ordinaire.',
    forme: { lg: 5, la: 3, ht: 2 },
    couleurs: ['blue'],
  },
  {
    id: 'char', nom: 'Char',
    note: 'Bloc plein orange : le plus lourd possible, gros bouclier.',
    forme: { lg: 8, la: 4, ht: 4 },
    couleurs: ['orange'],
  },
  {
    id: 'brindille', nom: 'Brindille',
    note: 'Le plus petit véhicule viable : sert de plancher de masse.',
    forme: { lg: 4, la: 2, ht: 1 },
    couleurs: ['red', 'green'],
  },
  {
    id: 'savonnette', nom: 'Savonnette',
    note: 'Long, étroit et rapide, sans une once de vert : part en glisse.',
    forme: { lg: 8, la: 2, ht: 2 },
    couleurs: ['red', 'blue'],
  },
  {
    id: 'arc-en-ciel', nom: 'Arc-en-ciel',
    note: 'Les six couleurs à parts égales, pour voir tous les pouvoirs à la fois.',
    forme: { lg: 6, la: 4, ht: 3 },
    couleurs: ['red', 'green', 'blue', 'orange', 'violet', 'pink'],
  },
];

// Remplit une boîte centrée en z, posée au sol, alignée sur l'avant (x = 7).
// Les couleurs alternent selon l'index linéaire : réparti, et déterministe.
function _construireCarrosserie({ lg, la, ht }, couleurs) {
  const grid = Array.from({ length: 8 }, () =>
    Array.from({ length: 4 }, () => Array(4).fill(null)));

  const x0 = 8 - lg;                       // collé à l'avant
  const z0 = Math.floor((4 - la) / 2);     // centré en largeur
  let i = 0;

  for (let x = x0; x < 8; x++) {
    for (let z = z0; z < z0 + la; z++) {
      for (let y = 0; y < ht; y++) {
        grid[x][z][y] = { color: couleurs[i % couleurs.length] };
        i++;
      }
    }
  }
  return grid;
}

/**
 * Construit un véhicule de référence à partir de son identifiant.
 * Même forme de retour que generateRandomVehicle().
 *
 * @param {string} id — identifiant dans PRESETS
 * @returns {Promise<object>}
 */
export async function generatePresetVehicle(id) {
  const preset = PRESETS.find(p => p.id === id);
  if (!preset) throw new Error(`Préréglage inconnu : ${id}`);

  const grid = _construireCarrosserie(preset.forme, preset.couleurs);

  const wheelPositions = detectWheels({
    profileGrid: _deriveProfileGrid(grid),
    topGrid:     _deriveTopGrid(grid),
  });

  const { stats, powers } = await computeStats(grid);
  const parCouleur = _compterParCouleur(grid);

  return {
    grid,
    wheelPositions,
    stats,
    powers,
    palette: Object.entries(parCouleur).sort((a, b) => b[1] - a[1]).map(([c]) => c),
    nom:        preset.nom,
    note:       preset.note,
    presetId:   preset.id,
    voxelCount: _compterVoxels(grid),
    parCouleur,
  };
}
