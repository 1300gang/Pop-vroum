// Module block/validator — RACE-A02 + RACE-C01
//
// Valide la structure d'un bloc JSON avant utilisation.
// Utilisé par le serveur lors du chargement des blocs et par le générateur.
//
// RACE-C01 : supporte le champ optionnel elevationGrid (grille parallèle à grid).
// Absence de elevationGrid → toutes les cellules traitées comme élévation 0.

const EXITS_VALIDES = new Set(['N', 'S', 'E', 'O']);
const ELEVATIONS_VALIDES = new Set([0, 1]);

/**
 * Valide la structure d'un bloc JSON.
 *
 * @param {object} json — données du bloc
 * @returns {{ valid: true } | { valid: false, errors: string[] }}
 */
export function validateBlock(json) {
  const errors = [];

  if (!json || typeof json !== 'object') {
    return { valid: false, errors: ['le bloc doit être un objet JSON'] };
  }

  // ---- grid ----
  if (!Array.isArray(json.grid)) {
    errors.push('grid manquant ou non-tableau');
  } else {
    if (json.grid.length !== 8) {
      errors.push(`grille invalide : doit avoir 8 lignes, a ${json.grid.length}`);
    }
    for (let row = 0; row < json.grid.length; row++) {
      if (!Array.isArray(json.grid[row])) {
        errors.push(`grid[${row}] doit être un tableau`);
      } else if (json.grid[row].length !== 8) {
        errors.push(`grille invalide : grid[${row}] doit avoir 8 colonnes, a ${json.grid[row].length}`);
      }
    }
  }

  // ---- exits (optionnel, rétrocompatibilité) ----
  if (json.exits !== undefined) {
    if (!Array.isArray(json.exits)) {
      errors.push('exits doit être un tableau');
    } else {
      for (const e of json.exits) {
        if (!EXITS_VALIDES.has(e)) {
          errors.push(`exit invalide : "${e}" (valeurs acceptées : N, S, E, O)`);
        }
      }
    }
  }

  // ---- elevationGrid (optionnel — RACE-C01) ----
  if (json.elevationGrid !== undefined) {
    if (!Array.isArray(json.elevationGrid)) {
      errors.push('elevationGrid doit être un tableau');
    } else {
      if (json.elevationGrid.length !== 8) {
        errors.push(`elevationGrid invalide : doit avoir 8 lignes, a ${json.elevationGrid.length}`);
      }
      for (let row = 0; row < json.elevationGrid.length; row++) {
        if (!Array.isArray(json.elevationGrid[row])) {
          errors.push(`elevationGrid[${row}] doit être un tableau`);
        } else {
          if (json.elevationGrid[row].length !== 8) {
            errors.push(`elevationGrid invalide : elevationGrid[${row}] doit avoir 8 colonnes, a ${json.elevationGrid[row].length}`);
          }
          for (let col = 0; col < json.elevationGrid[row].length; col++) {
            const val = json.elevationGrid[row][col];
            if (!ELEVATIONS_VALIDES.has(val)) {
              errors.push(`elevationGrid[${row}][${col}] invalide : "${val}" (valeurs acceptées : 0, 1)`);
            }
          }
        }
      }
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/**
 * Retourne la valeur d'élévation d'une cellule.
 * Si elevationGrid absent → 0 pour toutes les cellules (rétrocompatibilité).
 *
 * @param {object} blockData — bloc JSON
 * @param {number} row — ligne (0-7)
 * @param {number} col — colonne (0-7)
 * @returns {number} 0 ou 1
 */
export function getElevation(blockData, row, col) {
  return blockData.elevationGrid?.[row]?.[col] ?? 0;
}
