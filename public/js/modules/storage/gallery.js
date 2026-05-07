// Gestion de la galerie des véhicules en localStorage.
// API CRUD pour persister et lister les véhicules scannés.

const PREFIX = 'vehicle:';
const MAX_SIZE = 5 * 1024 * 1024; // 5 Mo (limite localStorage typique)

/**
 * Liste tous les véhicules sauvegardés.
 * @returns {Array<object>} Tableau des véhicules avec métadonnées
 */
export function list() {
  const vehicles = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(PREFIX)) {
      try {
        const data = JSON.parse(localStorage.getItem(key));
        vehicles.push(data);
      } catch (e) {
        console.error(`[gallery] Erreur lecture ${key}:`, e);
      }
    }
  }
  return vehicles.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Sauvegarde un véhicule avec ID unique et métadonnées.
 * @param {object} vehicle — {grid, wheelPositions, stats, powers, playerName?, ...}
 * @returns {string} ID du véhicule sauvegardé
 * @throws {Error} Si localStorage est plein ou données invalides
 */
export function save(vehicle) {
  if (!vehicle) throw new Error('[gallery] Véhicule invalide.');
  if (!vehicle.grid) throw new Error('[gallery] grid manquante.');

  const id = vehicle.id || `veh_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;

  const entry = {
    id,
    playerName: vehicle.playerName || 'Anonyme',
    createdAt: vehicle.createdAt || new Date().toISOString(),
    grid: vehicle.grid,
    wheelPositions: vehicle.wheelPositions || [],
    stats: vehicle.stats || {},
    powers: vehicle.powers || {},
  };

  const key = PREFIX + id;
  const json = JSON.stringify(entry);

  try {
    const estimatedSize = new Blob([json]).size;
    if (estimatedSize > MAX_SIZE) {
      throw new Error('[gallery] Véhicule trop volumineux pour localStorage.');
    }
    localStorage.setItem(key, json);
    console.log(`[gallery] Véhicule sauvegardé : ${id}`);
    return id;
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.message.includes('QuotaExceeded')) {
      throw new Error('[gallery] localStorage plein. Supprime des véhicules pour libérer de l\'espace.');
    }
    throw e;
  }
}

/**
 * Récupère un véhicule par ID.
 * @param {string} id
 * @returns {object|null} Le véhicule ou null si non trouvé
 */
export function get(id) {
  if (!id) return null;
  const key = PREFIX + id;
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    console.error(`[gallery] Erreur lecture ${key}:`, e);
    return null;
  }
}

/**
 * Supprime un véhicule par ID.
 * @param {string} id
 * @returns {boolean} true si suppression réussie, false sinon
 */
export function remove(id) {
  if (!id) return false;
  const key = PREFIX + id;
  try {
    if (localStorage.getItem(key) === null) return false;
    localStorage.removeItem(key);
    console.log(`[gallery] Véhicule supprimé : ${id}`);
    return true;
  } catch (e) {
    console.error(`[gallery] Erreur suppression ${key}:`, e);
    return false;
  }
}

/**
 * Compte le nombre de véhicules sauvegardés.
 * @returns {number}
 */
export function count() {
  let cnt = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(PREFIX)) cnt++;
  }
  return cnt;
}
