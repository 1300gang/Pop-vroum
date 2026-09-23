// Générateur de map procédurale — V2 (quadrillage NxN blocmaps).
//
// Deux modes de génération coexistent :
//
// Mode legacy (blocs sans exits) :
//   col = axe X (progression gauche→droite), row = axe Z (largeur)
//   Placement aléatoire, blocs vérifiés par _estJouable().
//
// Mode graph (blocs avec exits, block_seed_*) — RACE-B02/B03/B04 :
//   Grille NxN. Assemblage par arbre couvrant (DFS) + boucles (Prim-like).
//   Chaque cellule reçoit un bloc dont les exits correspondent aux connexions.
//   BFS valide la connexité avant de retourner la map.
//
// Contrat I/O :
//   loadPool()           → Promise<{ depart, arrivee, pool }>
//   generate(poolData)   → Promise<MapData>
//   generateMap(pool, gridSize, seed) → PlanMap
//   validateMap(planMap) → { valid, reachable, unreachable }
//
//   MapData = {
//     id, gridCols, gridRows, blockScale,
//     blocks: [{ blockId, name, col, row, position: [worldX, worldZ], grid }],
//     startPosition: { x, z, angle },
//     finishPosition: { x, z },
//     worldExtent: { width, depth }
//   }
//
//   PlanMap = {
//     seed, gridSize,
//     blocks: [{ row, col, blockId, rotation, exits }]
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
 * Injecte la config sans fetch (pour usage côté serveur Node.js).
 * @param {object} cfg — objet gameplay.json complet
 */
export function setConfig(cfg) {
  _config = cfg;
}

// ---- Chargement du pool ----

/**
 * Élimine les doublons d'ID dans le pool.
 * En cas de conflit, préfère la version avec exits explicites.
 * @param {Array<object>} pool
 * @returns {Array<object>}
 */
export function dedupePoolById(pool) {
  const byId = new Map();
  for (const b of pool) {
    const prev = byId.get(b.id);
    if (!prev) {
      byId.set(b.id, b);
      continue;
    }
    const preferNew = (b.exits?.length > 0) && !(prev.exits?.length > 0);
    byId.set(b.id, preferNew ? b : prev);
    console.warn(`[pool] ID dupliqué « ${b.id} » — doublon ignoré`);
  }
  return [...byId.values()];
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
    // Pivotés ici une fois pour toutes — plus aucune rotation en aval.
    const bloc = prepareBlockForGame(b);
    if (b.special === 'depart')  { depart  = bloc; continue; }
    if (b.special === 'arrivee') { arrivee = bloc; continue; }
    pool.push(bloc);
  }

  return { depart, arrivee, pool: dedupePoolById(pool) };
}

// ---- Utilitaires RNG + rotation (dupliqués ici pour éviter l'import de builder.js+Three) ----

// Générateur LCG avec seed — retourne une fonction rand() ∈ [0, 1)
function _rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = Math.imul(s, 1664525) + 1013904223 | 0;
    return (s >>> 0) / 0x100000000;
  };
}

// Mélange un tableau en place avec le RNG fourni (Fisher-Yates)
function _shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Rotation 90° CW d'une grille 8×8 : new[i][j] = old[7-j][i]
function _rotateGrid90CW(grid) {
  const n = grid.length;
  const result = Array.from({ length: n }, () => Array(n).fill(null));
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      result[i][j] = grid[n - 1 - j][i];
  return result;
}

const _EXIT_CW = { N: 'E', E: 'S', S: 'O', O: 'N' };

// V4-02 : tourne la direction intrinsèque d'une cellule (ramp_n/s/e/o,
// rampe_pente.direction) — la rotation de grille ne fait que déplacer les
// cellules, sans quoi une rampe garde son orientation d'origine une fois le
// bloc pivoté. Miroir de block/builder.js::_rotateCellCW.
function _rotateCellCW(cell, steps) {
  if (typeof cell === 'string') {
    const m = /^ramp_([nseo])$/.exec(cell);
    if (!m) return cell;
    let d = m[1].toUpperCase();
    for (let k = 0; k < steps; k++) d = _EXIT_CW[d];
    return `ramp_${d.toLowerCase()}`;
  }
  if (cell && typeof cell === 'object' && cell.direction) {
    let d = cell.direction;
    for (let k = 0; k < steps; k++) d = _EXIT_CW[d];
    return { ...cell, direction: d };
  }
  return cell;
}

function _rotateBlock(block, steps) {
  const s = ((steps % 4) + 4) % 4;
  let grid = block.grid.map(r => [...r]);
  for (let k = 0; k < s; k++) {
    grid = _rotateGrid90CW(grid);
  }
  grid = grid.map(row => row.map(cell => _rotateCellCW(cell, s)));

  // V4-03 : elevationGrid est une grille parallèle — elle doit suivre la même
  // rotation que grid, sinon le relief se désynchronise des cellules.
  let elevationGrid = block.elevationGrid;
  if (elevationGrid) {
    elevationGrid = elevationGrid.map(r => [...r]);
    for (let k = 0; k < s; k++) {
      elevationGrid = _rotateGrid90CW(elevationGrid);
    }
  }

  // Exits manuels : rotation des labels. Sinon : détection sur la grille finale.
  let exits;
  if (block.exits) {
    exits = [...block.exits];
    for (let k = 0; k < s; k++) {
      exits = exits.map(e => _EXIT_CW[e]);
    }
  } else {
    exits = _detectExits(grid);
  }

  return { ...block, grid, elevationGrid, exits };
}

/**
 * Amène un bloc du repère d'écriture au repère du jeu.
 *
 * Les blocs sont rédigés « avant rotation » (leurs notes le disent), et la course
 * se déroule en +X. map-loader.js et server/game-loop.js appliquaient chacun cette
 * rotation APRÈS l'assemblage : le générateur ouvrait un couloir sur le bord Est
 * d'un bloc, la rotation le déplaçait sur son bord Sud, et il ne rencontrait plus
 * celui du voisin. Une liaison voulue sur deux se retrouvait murée (mesuré :
 * 280/558). En pivotant le pool à l'entrée, le générateur raisonne directement
 * dans la géométrie du jeu et ses liaisons sont exactes.
 *
 * @param {object} block
 * @returns {object} bloc pivoté, exits recalculées
 */
export function prepareBlockForGame(block) {
  return block ? _rotateBlock(block, 1) : block;
}

function _detectExits(grid) {
  const exits = [];
  // Une sortie existe là où le couloir central (cols/rows 3,4) est passable (null)
  if (grid[0]?.[3] == null || grid[0]?.[4] == null) exits.push('N');
  if (grid[7]?.[3] == null || grid[7]?.[4] == null) exits.push('S');
  if (grid[3]?.[7] == null || grid[4]?.[7] == null) exits.push('E');
  if (grid[3]?.[0] == null || grid[4]?.[0] == null) exits.push('O');
  return exits;
}

function _blockExits(block) {
  return block.exits ?? _detectExits(block.grid);
}

/**
 * Indique si un bloc peut participer au mode graphe (exits explicites ou auto-détectées).
 * @param {object} block
 * @returns {boolean}
 */
export function hasProcgenExits(block) {
  if (!block?.grid) return false;
  return (block.exits?.length > 0) || _detectExits(block.grid).length > 0;
}

/** Grille 8×8 entièrement ouverte — repli si départ/arrivée absents. */
export const EMPTY_PLAT_BLOCK = {
  id:    'block_seed_plat',
  name:  'Plat ouvert',
  exits: ['N', 'S', 'E', 'O'],
  grid:  Array.from({ length: BLOCK_SIZE }, () => Array(BLOCK_SIZE).fill(null)),
};

// ---- Mode graph : generateMap (RACE-B02/B03) ----

// Directions : [dRow, dCol, exitFrom, exitTo]
const _DIRS = [
  [-1, 0, 'N', 'S'],
  [0,  1, 'E', 'O'],
  [1,  0, 'S', 'N'],
  [0, -1, 'O', 'E'],
];

/**
 * Construit la carte des connexions requises par arbre couvrant DFS.
 * connections[row][col] = tableau des exits nécessaires.
 */
function _buildSpanningTree(gridSize, rand) {
  const conn    = Array.from({ length: gridSize }, () =>
    Array.from({ length: gridSize }, () => [])
  );
  const visited = Array.from({ length: gridSize }, () => Array(gridSize).fill(false));

  // Garantit que le bloc de départ (0,0) a toujours une sortie S
  // pour que le véhicule puisse avancer dès le spawn (orienté vers le Sud, angle=0).
  if (gridSize > 1) {
    conn[0][0].push('S');
    conn[1][0].push('N');
    visited[0][0] = true;
    visited[1][0] = true;
    
    // Commence l'exploration DFS depuis le bloc adjacent (1,0)
    dfs(1, 0);
  } else {
    dfs(0, 0);
  }

  function dfs(r, c) {
    visited[r][c] = true;
    const dirs = _shuffle([..._DIRS], rand);
    for (const [dr, dc, exFrom, exTo] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < gridSize && nc >= 0 && nc < gridSize && !visited[nr][nc]) {
        conn[r][c].push(exFrom);
        conn[nr][nc].push(exTo);
        dfs(nr, nc);
      }
    }
  }

  return conn;
}

/**
 * Ajoute K reconnexions aléatoires pour créer des boucles (RACE-B03).
 * K = floor(gridSize / 2).
 */
function _addLoops(conn, gridSize, rand) {
  const K = Math.floor(gridSize / 2);
  let added = 0;
  let attempts = 0;

  while (added < K && attempts < gridSize * gridSize * 4) {
    attempts++;
    const r = Math.floor(rand() * gridSize);
    const c = Math.floor(rand() * gridSize);
    const [dr, dc, exFrom, exTo] = _DIRS[Math.floor(rand() * _DIRS.length)];
    const nr = r + dr;
    const nc = c + dc;
    if (nr < 0 || nr >= gridSize || nc < 0 || nc >= gridSize) continue;
    // N'ajoute que si la connexion n'existe pas déjà
    if (!conn[r][c].includes(exFrom)) {
      conn[r][c].push(exFrom);
      conn[nr][nc].push(exTo);
      added++;
    }
  }
}

/**
 * Cherche un bloc du pool compatible avec les exits requises (avec toutes les rotations).
 * Retourne { block, rotation } ou un fallback si aucune correspondance parfaite.
 */
function _findCompatible(pool, required, rand) {
  const requiredSet = new Set(required);
  const candidates  = [];

  for (const block of pool) {
    for (let rot = 0; rot < 4; rot++) {
      const rotated = _rotateBlock(block, rot);
      const exits   = new Set(_blockExits(rotated));
      if ([...requiredSet].every(e => exits.has(e))) {
        candidates.push({ block, rotation: rot });
      }
    }
  }

  if (candidates.length > 0) {
    return candidates[Math.floor(rand() * candidates.length)];
  }

  // Fallback : bloc avec le plus d'exits parmi toutes les rotations
  let best = null;
  let bestScore = -1;
  for (const block of pool) {
    for (let rot = 0; rot < 4; rot++) {
      const rotated = _rotateBlock(block, rot);
      const exits   = _blockExits(rotated);
      const score   = required.filter(e => exits.includes(e)).length;
      if (score > bestScore) { bestScore = score; best = { block, rotation: rot }; }
    }
  }
  return best ?? { block: pool[0], rotation: 0 };
}

/**
 * Choisit un bloc compatible avec les exits requises.
 * Si forcedBlock est fourni (départ/arrivée), le privilégie.
 */
function _placeBlock(blockPool, required, rand, forcedBlock = null) {
  if (forcedBlock) {
    const requiredSet = new Set(required);
    for (let rot = 0; rot < 4; rot++) {
      const rotated = _rotateBlock(forcedBlock, rot);
      const exits   = new Set(_blockExits(rotated));
      if ([...requiredSet].every(e => exits.has(e))) {
        return { block: forcedBlock, rotation: rot };
      }
    }
    return { block: forcedBlock, rotation: 0 };
  }
  return _findCompatible(blockPool, required, rand);
}

/**
 * Génère un plan de map NxN à partir d'un pool de blocs seed (avec exits).
 * Garantit la connexité (arbre couvrant) et au moins une boucle.
 *
 * @param {Array<object>} blockPool — blocs avec exits déclarés
 * @param {number}        gridSize  — taille de la grille (ex. 4 pour 4×4)
 * @param {number}        [seed]    — seed reproductible ; aléatoire si absent
 * @param {{ entryBlock?: object, exitBlock?: object }} [cornerBlocks] — plats départ/arrivée
 * @returns {{ seed: number, gridSize: number, blocks: Array<object> }}
 */
export function generateMap(blockPool, gridSize, seed, cornerBlocks = {}) {
  const usedSeed   = seed ?? (Math.random() * 0x7fffffff | 0);
  const rand       = _rng(usedSeed);
  const entryBlock = cornerBlocks.entryBlock ?? EMPTY_PLAT_BLOCK;
  const exitBlock  = cornerBlocks.exitBlock  ?? EMPTY_PLAT_BLOCK;
  const last       = gridSize - 1;

  const conn = _buildSpanningTree(gridSize, rand);
  _addLoops(conn, gridSize, rand);

  const blocks = [];
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const required = conn[row][col];
      let forced     = null;
      if (row === 0 && col === 0)              forced = entryBlock;
      else if (row === last && col === last)     forced = exitBlock;

      const { block, rotation } = _placeBlock(blockPool, required, rand, forced);
      const rotated             = _rotateBlock(block, rotation);
      const actualExits         = _blockExits(rotated);
      blocks.push({ row, col, blockId: block.id, rotation, exits: actualExits });
    }
  }

  return { seed: usedSeed, gridSize, blocks };
}

// ---- Validation BFS (RACE-B04) ----

/**
 * Vérifie par BFS que tous les blocs de la map sont accessibles depuis (0,0).
 *
 * @param {{ gridSize: number, blocks: Array<{row,col,exits}> }} planMap
 * @returns {{ valid: boolean, reachable: number, unreachable: Array<{row,col}> }}
 */
export function validateMap(planMap) {
  const { gridSize, blocks } = planMap;

  // Index exits par (row, col)
  const exitsAt = {};
  for (const b of blocks) {
    exitsAt[`${b.row},${b.col}`] = new Set(b.exits);
  }

  // Connexion entre (r,c) et (nr,nc) = exits compatibles dans les deux sens
  function connected(r, c, nr, nc, exFrom, exTo) {
    return exitsAt[`${r},${c}`]?.has(exFrom) && exitsAt[`${nr},${nc}`]?.has(exTo);
  }

  const visited  = new Set();
  const queue    = [[0, 0]];
  visited.add('0,0');

  while (queue.length) {
    const [r, c] = queue.shift();
    for (const [dr, dc, exFrom, exTo] of _DIRS) {
      const nr = r + dr;
      const nc = c + dc;
      const key = `${nr},${nc}`;
      if (nr < 0 || nr >= gridSize || nc < 0 || nc >= gridSize) continue;
      if (visited.has(key)) continue;
      if (connected(r, c, nr, nc, exFrom, exTo)) {
        visited.add(key);
        queue.push([nr, nc]);
      }
    }
  }

  const total       = gridSize * gridSize;
  const reachable   = visited.size;
  const unreachable = blocks
    .filter(b => !visited.has(`${b.row},${b.col}`))
    .map(b => ({ row: b.row, col: b.col }));

  return { valid: reachable === total, reachable, unreachable };
}

// ---- generate() — point d'entrée principal ----

/**
 * Génère une MapData complète.
 * Utilise le mode graph si des blocs seed avec exits sont disponibles,
 * sinon retombe sur le mode legacy.
 *
 * @param {{ depart: object, arrivee: object, pool: Array<object> }} poolData
 * @returns {Promise<object>} MapData
 */
export async function generate(poolData, options = {}) {
  const { pool, depart, arrivee } = poolData;

  const cfg        = await _chargerConfig();
  const mapCfg     = cfg.map ?? {};
  const blockScale = mapCfg.blockScale ?? 2;
  const blocmapSize = BLOCK_SIZE * blockScale;

  const seedBlocks   = pool.filter(hasProcgenExits);
  const legacyBlocks = pool.filter(b => !hasProcgenExits(b));

  if (seedBlocks.length >= 3) {
    const gridSize    = options.gridSize ?? mapCfg.procgenGridSize ?? 4;
    const spawnSpread = cfg.solo?.SPAWN_SPREAD ?? 1.5;
    const corners = {
      entryBlock: depart  ?? EMPTY_PLAT_BLOCK,
      exitBlock:  arrivee ?? EMPTY_PLAT_BLOCK,
    };
    return _genererModeGraph(seedBlocks, gridSize, blockScale, blocmapSize, spawnSpread, corners);
  }

  // Mode legacy : placement aléatoire avec blocs non-seed
  const legacyPool = legacyBlocks.filter(_estJouable);
  if (legacyPool.length === 0) throw new Error('map-generator : aucun bloc jouable dans le pool');
  return _genererModeLegacy(depart, arrivee, legacyPool, mapCfg, blockScale, blocmapSize);
}

/**
 * SOLO-05 : calcule les positions de spawn dans le bloc départ.
 * Répartit count joueurs sur l'axe Z, espacés de spread, centrés dans le bloc.
 */
function _computeSpawnPositions(entryCenter, count, spread) {
  const positions = [];
  const halfSpan  = ((count - 1) / 2) * spread;
  for (let i = 0; i < count; i++) {
    positions.push({
      x: entryCenter.x - spread, // légèrement en retrait du centre
      z: entryCenter.z - halfSpan + i * spread,
    });
  }
  return positions;
}

// Génère la map en mode graphe (blocs seed avec exits)
function _genererModeGraph(seedBlocks, gridSize, blockScale, blocmapSize, spawnSpread, cornerBlocks = {}) {
  const MAX_TENTATIVES = 10;
  const spread = spawnSpread ?? 1.5;

  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative++) {
    const seed    = Math.random() * 0x7fffffff | 0;
    const planMap = generateMap(seedBlocks, gridSize, seed, cornerBlocks);
    const check   = validateMap(planMap);

    if (!check.valid) {
      console.warn(`[map-generator] tentative ${tentative + 1} invalide (${check.unreachable.length} blocs inaccessibles), nouvelle tentative…`);
      continue;
    }

    // Index bloc : pool jouable + plats départ/arrivée
    const blocById = Object.fromEntries([
      ...seedBlocks,
      cornerBlocks.entryBlock,
      cornerBlocks.exitBlock,
    ].filter(Boolean).map(b => [b.id, b]));

    const blocks = planMap.blocks.map(({ row, col, blockId, rotation }) => {
      const bloc    = blocById[blockId];
      const rotated = _rotateBlock(bloc, rotation);
      return {
        blockId:  blockId,
        name:     bloc.name ?? '',
        col, row,
        position: [col * blocmapSize, row * blocmapSize],
        grid:     rotated.grid,
        // V4-03 : sans ce report, le relief (plateaux, rampe_pente) est perdu
        // à l'assemblage et le système d'élévation reste inerte en jeu.
        elevationGrid: rotated.elevationGrid,
      };
    });

    const totalWidth = gridSize * blocmapSize;
    const totalDepth = gridSize * blocmapSize;

    // SOLO-05 : départ = coin (0,0), arrivée = coin (W-1,H-1)
    const entryCenter = { x: blocmapSize * 0.5, z: blocmapSize * 0.5 };
    const exitCenter  = {
      x: (gridSize - 0.5) * blocmapSize,
      z: (gridSize - 0.5) * blocmapSize,
    };

    return {
      id:             `map_graph_${seed}`,
      gridCols:       gridSize,
      gridRows:       gridSize,
      blockScale,
      blocks,
      startPosition:  { x: entryCenter.x, z: entryCenter.z, angle: 0 },
      finishPosition: { x: exitCenter.x,  z: exitCenter.z },
      // SOLO-05 : métadonnées départ / arrivée pour le client
      entry: {
        blockCol:       0,
        blockRow:       0,
        worldCenter:    entryCenter,
        spawnPositions: _computeSpawnPositions(entryCenter, 5, spread),
      },
      exit: {
        blockCol:    gridSize - 1,
        blockRow:    gridSize - 1,
        worldCenter: exitCenter,
      },
      worldExtent: { width: totalWidth, depth: totalDepth },
    };
  }

  throw new Error('[map-generator] impossible de générer une map valide après 10 tentatives');
}

// Génère la map en mode legacy (blocs sans exits, placement aléatoire)
function _genererModeLegacy(depart, arrivee, pool, mapCfg, blockScale, blocmapSize) {
  const gridCols = mapCfg.gridCols ?? 8;
  const gridRows = mapCfg.gridRows ?? 8;
  const blocks   = [];

  for (let col = 0; col < gridCols; col++) {
    for (let row = 0; row < gridRows; row++) {
      let choisi;
      if (col === 0)                 choisi = depart;
      else if (col === gridCols - 1) choisi = arrivee;
      else                           choisi = pool[Math.floor(Math.random() * pool.length)];

      blocks.push({
        blockId:  choisi?.id ?? 'legacy',
        name:     choisi?.name ?? '',
        col, row,
        position: [col * blocmapSize, row * blocmapSize],
        grid:     choisi?.grid ?? [],
        elevationGrid: choisi?.elevationGrid,   // V4-03 : conserver le relief
      });
    }
  }

  const totalWidth = gridCols * blocmapSize;
  const totalDepth = gridRows * blocmapSize;

  return {
    id:             `map_legacy_${Date.now()}`,
    gridCols, gridRows, blockScale, blocks,
    startPosition:  { x: blocmapSize / 2, z: totalDepth / 2, angle: Math.PI / 2 },
    finishPosition: { x: (gridCols - 0.5) * blocmapSize, z: totalDepth / 2 },
    worldExtent:    { width: totalWidth, depth: totalDepth },
  };
}

// ---- Validation jouabilité (mode legacy) ----

function _estJouable(bloc) {
  if (!bloc?.grid || bloc.grid.length !== BLOCK_SIZE) return false;
  const CORRIDOR_MIN = 2;
  const CORRIDOR_MAX = 5;
  const entreeOuverte = _aPassageColonne(bloc.grid, 0, CORRIDOR_MIN, CORRIDOR_MAX);
  const sortieOuverte = _aPassageColonne(bloc.grid, BLOCK_SIZE - 1, CORRIDOR_MIN, CORRIDOR_MAX);
  return entreeOuverte && sortieOuverte;
}

function _aPassageColonne(grid, gx, gzMin, gzMax) {
  for (let gz = gzMin; gz <= gzMax; gz++) {
    if (_estPassable(grid[gz]?.[gx])) return true;
  }
  return false;
}

function _estPassable(cell) {
  return cell === null || cell === 'boost' || cell === 'sticky'
      || cell === 'bump' || cell === 'ramp_n' || cell === 'ramp_e'
      || cell === 'ramp_s' || cell === 'ramp_o';
}

// ---- Multiplicateur de grip par surface (E03-S08) ----

const _SURFACE_GRIP_DEFAULTS = { dur: 1.0, ramp: 1.0, sticky: 1.8, boost: 0.6 };

/**
 * Retourne le multiplicateur de grip pour un type de surface.
 * @param {string|null} cellType
 * @returns {number}
 */
export function getSurfaceGrip(cellType) {
  const table = _config?.surfaceGrip ?? _SURFACE_GRIP_DEFAULTS;
  const key   = cellType ?? 'dur';
  return table[key] ?? 1.0;
}
