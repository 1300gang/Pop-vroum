// Module block/editor — Story 6.2
//
// Logique de l'éditeur web de blocs map.
// Gère l'état de la grille 8×8, la validation, et l'export JSON.
//
// Format interne des cases : { v: string, r: number } | null
//   v = symbole ('ramp'|'sticky'|'dur'|'boost')
//   r = rotation en degrés (0|90|180|270)
//
// Format export JSON compact :
//   null              → null
//   { v:'dur', r:0 }  → "dur"        (rétrocompat avec les seed files)
//   { v:'ramp', r:90 }→ { v:'ramp', r:90 }

export const TAILLE   = 8;
export const SYMBOLES = ['ramp', 'sticky', 'dur', 'boost', 'bump', 'movable', 'pole', 'ramp_n', 'ramp_e', 'ramp_s', 'ramp_o'];

// ---- État interne ----

let _grille = _grilleVide();

function _grilleVide() {
  return Array.from({ length: TAILLE }, () => Array(TAILLE).fill(null));
}

// ---- API grille ----

/** Remet la grille à zéro. */
export function effacer() {
  _grille = _grilleVide();
}

/**
 * Retourne une copie profonde de la grille au format interne { v, r } | null.
 * Compatible avec buildBlock() qui accepte les deux formats.
 */
export function getGrille() {
  return _grille.map(r => r.map(c => c ? { ...c } : null));
}

/**
 * Pose un symbole (ou null) à la position donnée.
 * @param {number}      row
 * @param {number}      col
 * @param {string|null} symbole
 * @param {number}      rotation — 0|90|180|270
 */
export function poser(row, col, symbole, rotation = 0) {
  if (row < 0 || row >= TAILLE || col < 0 || col >= TAILLE) return;
  _grille[row][col] = SYMBOLES.includes(symbole)
    ? { v: symbole, r: rotation }
    : null;
}

/**
 * Charge un JSON bloc dans l'éditeur.
 * Accepte l'ancien format (string par case) et le nouveau ({ v, r }).
 * @param {object} bloc
 */
export function charger(bloc) {
  validerBloc(bloc);
  _grille = bloc.grid.map(rangee =>
    rangee.map(cell => {
      if (!cell) return null;
      if (typeof cell === 'string') return SYMBOLES.includes(cell) ? { v: cell, r: 0 } : null;
      if (cell.v && SYMBOLES.includes(cell.v)) return { v: cell.v, r: cell.r ?? 0 };
      return null;
    })
  );
}

// ---- Validation ----

/** Valide la structure brute d'un objet bloc. */
export function validerBloc(bloc) {
  if (!bloc || typeof bloc !== 'object') throw new Error('Bloc invalide');
  if (!Array.isArray(bloc.grid))         throw new Error('Champ "grid" manquant');
  if (bloc.grid.length !== TAILLE)       throw new Error(`grid doit avoir ${TAILLE} lignes`);
  for (const r of bloc.grid) {
    if (!Array.isArray(r) || r.length !== TAILLE)
      throw new Error(`Chaque rangée doit avoir ${TAILLE} colonnes`);
  }
}

/**
 * Vérifie qu'il y a un passage jouable (entrée et sortie non entièrement bloquées).
 * @returns {{ ok: boolean, entree: boolean, sortie: boolean }}
 */
export function validerJouabilite() {
  const entree = _grille[0].some(c => _estPassable(c?.v));
  const sortie = _grille[TAILLE - 1].some(c => _estPassable(c?.v));
  return { ok: entree && sortie, entree, sortie };
}

function _estPassable(v) {
  return !v || v === 'ramp' || v === 'boost' || v === 'sticky'
    || v === 'bump' || v === 'ramp_n' || v === 'ramp_e' || v === 'ramp_s' || v === 'ramp_o';
}

// ---- Export ----

/**
 * Génère un objet JSON bloc exportable.
 * @param {{ nom: string, atelier: string }} meta
 */
export function exporter({ nom = 'Sans nom', atelier = '' } = {}) {
  const slug      = _slugifier(nom);
  const timestamp = Date.now();
  return {
    id:        `block_${timestamp}_${slug}`,
    name:      nom,
    createdAt: new Date().toISOString(),
    atelier,
    grid:      _grille.map(rangee =>
      rangee.map(c => {
        if (!c) return null;
        return c.r === 0 ? c.v : { v: c.v, r: c.r }; // compact
      })
    ),
  };
}

/** Déclenche le téléchargement du bloc au format JSON. */
export function telecharger(meta) {
  const json     = exporter(meta);
  const slug     = _slugifier(json.name);
  const filename = `block-${slug}-${Date.now()}.json`;
  const blob     = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
  const url      = URL.createObjectURL(blob);
  const a        = document.createElement('a');
  a.href         = url;
  a.download     = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { blob, filename };
}

function _slugifier(str) {
  return str
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'bloc';
}
