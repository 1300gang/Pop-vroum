// Générateur de map procédurale — V2 (quadrillage 8×8 blocmaps).
//
// La map est un quadrillage grid[row][col] de blocmaps :
//   - col = axe X (progression gauche→droite), 0 = départ, 7 = arrivée
//   - row = axe Z (largeur), 0..7
//
// Chaque blocmap = grille 8×8 de cellules (BLOCK_SIZE).
// En monde, chaque cellule fait blockScale × blockScale unités (défaut 2).
// Un blocmap occupe donc BLOCK_SIZE × blockScale = 16 unités monde.
//
// Les blocs seed sont conçus pour un déplacement en Z. Lors du placement
// dans la map (déplacement en +X), on applique une rotation 90° horaire :
//   cellule(gx, gz) du bloc original → cellule rotée : grid[BS-1-gx][gz]
//
// Contrat I/O :
//   loadPool()           → Promise<{ depart, arrivee, pool }>
//   generate(poolData)   → Promise<MapData>
//
//   MapData = {
//     id, gridCols, gridRows, blockScale,
//     blocks: [{ blockId, name, col, row, position: [worldX, worldZ], grid }],
//     startPosition: { x, z, angle },
//     finishPosition: { x, z },
//     worldExtent: { width, depth }
//   }

export const BLOCK_SIZE = 8;

let _config = null;

async function _chargerConfig() {
  if (_config) return _config;
  const resp = await fetch('/config/gameplay.json');
  if (!resp.ok) throw new Error('Impossible de charger /config/gameplay.json');
  _config = await resp.json();
  return _config;
}

/**
 * Charge le pool de blocs : sépare départ, arrivée et blocs normaux.
 * @returns {Promise<{ depart: object, arrivee: object, pool: Array<object> }>}
 */
export async function loadPool() {
  const resp = await fetch('/api/map-blocks');
  if (!resp.ok) throw new Error('Impossible de lister les blocs map');
  const { seed = [], generated = [] } = await resp.json();
  const urls = [...seed, ...generated];
  const blocs = await Promise.all(urls.map(async (u) => {
    const r = await fetch(u);
    if (!r.ok) throw new Error(`Bloc introuvable : ${u}`);
    return r.json();
  }));

  let depart = null;
  let arrivee = null;
  const pool = [];

  for (const b of blocs) {
    if (b.special === 'depart') { depart = b; continue; }
    if (b.special === 'arrivee') { arrivee = b; continue; }
    if (_estJouable(b)) pool.push(b);
  }

  if (!depart) throw new Error('Blocmap de départ introuvable (special: "depart")');
  if (!arrivee) throw new Error("Blocmap d'arrivée introuvable (special: \"arrivee\")");

  return { depart, arrivee, pool };
}

/**
 * Génère une map 8×8 (ou selon config).
 * @param {{ depart: object, arrivee: object, pool: Array<object> }} poolData
 * @returns {Promise<object>} MapData
 */
export async function generate(poolData) {
  const { depart, arrivee, pool } = poolData;
  if (pool.length === 0) throw new Error('map-generator : pool vide');

  const cfg = await _chargerConfig();
  const mapCfg = cfg.map ?? {};
  const gridCols   = mapCfg.gridCols ?? 8;
  const gridRows   = mapCfg.gridRows ?? 8;
  const blockScale = mapCfg.blockScale ?? 2;

  const blocmapSize = BLOCK_SIZE * blockScale; // unités monde par blocmap
  const blocks = [];

  for (let col = 0; col < gridCols; col++) {
    for (let row = 0; row < gridRows; row++) {
      let choisi;
      if (col === 0)              choisi = depart;
      else if (col === gridCols - 1) choisi = arrivee;
      else                        choisi = pool[Math.floor(Math.random() * pool.length)];

      const worldX = col * blocmapSize;
      const worldZ = row * blocmapSize;

      blocks.push({
        blockId:  choisi.id,
        name:     choisi.name ?? '',
        col,
        row,
        position: [worldX, worldZ],
        grid:     choisi.grid,
      });
    }
  }

  const totalWidth = gridCols * blocmapSize; // étendue en X
  const totalDepth = gridRows * blocmapSize; // étendue en Z

  // Spawn au milieu de la colonne 0 (centre vertical de la grille)
  const spawnX = blocmapSize / 2;
  const spawnZ = totalDepth / 2;

  // Arrivée au milieu de la dernière colonne
  const finishX = (gridCols - 0.5) * blocmapSize;
  const finishZ = totalDepth / 2;

  return {
    id:          `map_${Date.now()}`,
    gridCols,
    gridRows,
    blockScale,
    blocks,
    startPosition:  { x: spawnX, z: spawnZ, angle: Math.PI / 2 },
    finishPosition: { x: finishX, z: finishZ },
    worldExtent:    { width: totalWidth, depth: totalDepth },
  };
}

// ---- Validation jouabilité ----

// Vérifie qu'un bloc peut être traversé en direction X (après rotation 90° CW).
// Après rotation : rx=0 (entrée) = colonne gx=0 originale, rx=7 (sortie) = colonne gx=7 originale.
// Les rangées gz=2..5 correspondent au couloir central (rz=2..5 après rotation).
function _estJouable(bloc) {
  if (!bloc?.grid || bloc.grid.length !== BLOCK_SIZE) return false;
  const CORRIDOR_MIN = 2;
  const CORRIDOR_MAX = 5;
  // Vérifie qu'au moins une cellule de passage existe en entrée (gx=0) et sortie (gx=7)
  const entreeOuverte = _aPassageColonne(bloc.grid, 0, CORRIDOR_MIN, CORRIDOR_MAX);
  const sortieOuverte = _aPassageColonne(bloc.grid, BLOCK_SIZE - 1, CORRIDOR_MIN, CORRIDOR_MAX);
  return entreeOuverte && sortieOuverte;
}

// Vérifie qu'au moins une cellule est passable dans la colonne gx, entre gz=min et gz=max
function _aPassageColonne(grid, gx, gzMin, gzMax) {
  for (let gz = gzMin; gz <= gzMax; gz++) {
    if (_estPassable(grid[gz]?.[gx])) return true;
  }
  return false;
}

function _estPassable(cell) {
  return cell === null || cell === 'ramp' || cell === 'boost' || cell === 'sticky';
}

// ---- Multiplicateur de grip par surface (E03-S08) ----

// Valeurs par défaut — remplacées par gameplay.json.surfaceGrip au chargement config
const _SURFACE_GRIP_DEFAULTS = { dur: 1.0, ramp: 1.0, sticky: 1.8, boost: 0.6 };

/**
 * Retourne le multiplicateur de grip pour un type de surface.
 * null = route normale (dur), 'ramp', 'sticky', 'boost'.
 * Utilise gameplay.json.surfaceGrip si la config est chargée, sinon les défauts.
 *
 * @param {string|null} cellType — type de cellule sous le véhicule
 * @returns {number} — multiplicateur ∈ [0.1, 3.0]
 */
export function getSurfaceGrip(cellType) {
  const table = _config?.surfaceGrip ?? _SURFACE_GRIP_DEFAULTS;
  const key   = cellType ?? 'dur';   // null → route normale
  return table[key] ?? 1.0;
}
