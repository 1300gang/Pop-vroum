import { loadPool, generateMap, validateMap, generate, BLOCK_SIZE, hasProcgenExits } from '../modules/game/map-generator.js';

// ---- Configuration du rendu ----
const CELL_COLORS = {
  null:     '#131326', // route
  dur:      '#302217', // mur / obstacle dur
  ramp:     '#e67e22', // rampe standard
  ramp_n:   '#d35400', // rampe Nord
  ramp_e:   '#d35400', // rampe Est
  ramp_s:   '#d35400', // rampe Sud
  ramp_o:   '#d35400', // rampe Ouest
  boost:    '#00d4ff', // boost
  sticky:   '#2ecc71', // zone collante
  bump:     '#f1c40f', // bosse
  movable:  '#9b59b6', // obstacle mobile
  pole:     '#e74c3c', // poteau destructible
};

const CELL_SHAPES = {
  ramp_n: '↑',
  ramp_e: '→',
  ramp_s: '↓',
  ramp_o: '←',
  ramp:   '▲',
  boost:  '⚡',
  sticky: '░',
  bump:   '∿',
  movable: '⚃',
  pole:   '┃',
};

// ---- État de l'application ----
let poolData = null; // { depart, arrivee, pool: [...] }
let activeBlockIds = new Set(); // IDs des blocs sélectionnés pour la génération
let planMap = null; // PlanMap courant
let mapData = null; // MapData généré complet (avec grilles rotatives)
let checkResult = null; // Résultat du validateMap
let gridSize = 4;
let mode = 'graph';
let seedValue = '';

// État du Canvas & Navigation (Pan / Zoom)
let zoom = 1.0;
let offsetX = 0;
let offsetY = 0;
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let dragStartOffset = { x: 0, y: 0 };
let hasMoved = false;

// Variables pour le double clic
let lastClickTime = 0;

// Option d'affichage (liaison DOM)
const displaySettings = {
  cells: true,
  exits: true,
  connections: true,
  unreachable: true
};

// ---- Éléments DOM ----
const canvas = document.getElementById('map-canvas');
const ctx = canvas.getContext('2d');
const inpSeed = document.getElementById('inp-seed');
const btnRandSeed = document.getElementById('btn-rand-seed');
const selSize = document.getElementById('sel-size');
const selMode = document.getElementById('sel-mode');
const btnGenerate = document.getElementById('btn-generate');
const poolContainer = document.getElementById('pool-container');
const lnkAll = document.getElementById('lnk-all');
const lnkNone = document.getElementById('lnk-none');
const statusCard = document.getElementById('status-card');
const statusText = document.getElementById('status-text');
const statMapId = document.getElementById('stat-map-id');
const statSeed = document.getElementById('stat-seed');
const statReachable = document.getElementById('stat-reachable');
const unreachableContainer = document.getElementById('unreachable-container');
const unreachableList = document.getElementById('unreachable-list');
const btnCopyJson = document.getElementById('btn-copy-json');
const toast = document.getElementById('toast');
const blockTooltip = document.getElementById('block-tooltip');

// Controles de zoom flottants
const btnZoomIn = document.getElementById('btn-zoom-in');
const btnZoomOut = document.getElementById('btn-zoom-out');
const btnZoomReset = document.getElementById('btn-zoom-reset');

// ---- Fonctions de rotation (duplication clientside) ----
const EXIT_CW = { N: 'E', E: 'S', S: 'O', O: 'N' };
const OPPOSITE_EXIT = { N: 'S', S: 'N', E: 'O', O: 'E' };

function rotateGrid90CW(grid) {
  const n = grid.length;
  const result = Array.from({ length: n }, () => Array(n).fill(null));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      // Rotation : new[i][j] = old[7-j][i]
      result[i][j] = grid[n - 1 - j][i];
    }
  }
  return result;
}

function detectExits(grid) {
  const exits = [];
  if (grid[0]?.[3] == null || grid[0]?.[4] == null) exits.push('N');
  if (grid[7]?.[3] == null || grid[7]?.[4] == null) exits.push('S');
  if (grid[3]?.[7] == null || grid[4]?.[7] == null) exits.push('E');
  if (grid[3]?.[0] == null || grid[4]?.[0] == null) exits.push('O');
  return exits;
}

// V4-02 : tourne la direction intrinsèque d'une cellule (ramp_n/s/e/o,
// rampe_pente.direction) — sinon une rampe garde son orientation d'origine
// une fois le bloc pivoté. Miroir de block/builder.js::_rotateCellCW.
function rotateCellCW(cell, steps) {
  if (typeof cell === 'string') {
    const m = /^ramp_([nseo])$/.exec(cell);
    if (!m) return cell;
    let d = m[1].toUpperCase();
    for (let k = 0; k < steps; k++) d = EXIT_CW[d];
    return `ramp_${d.toLowerCase()}`;
  }
  if (cell && typeof cell === 'object' && cell.direction) {
    let d = cell.direction;
    for (let k = 0; k < steps; k++) d = EXIT_CW[d];
    return { ...cell, direction: d };
  }
  return cell;
}

function rotateBlock(block, steps) {
  const s = ((steps % 4) + 4) % 4;
  let grid = block.grid.map(r => [...r]);
  for (let k = 0; k < s; k++) {
    grid = rotateGrid90CW(grid);
  }
  grid = grid.map(row => row.map(cell => rotateCellCW(cell, s)));

  // V4-03 : elevationGrid suit la même rotation que grid.
  let elevationGrid = block.elevationGrid;
  if (elevationGrid) {
    elevationGrid = elevationGrid.map(r => [...r]);
    for (let k = 0; k < s; k++) {
      elevationGrid = rotateGrid90CW(elevationGrid);
    }
  }

  let exits;
  if (block.exits) {
    exits = [...block.exits];
    for (let k = 0; k < s; k++) {
      exits = exits.map(e => EXIT_CW[e]);
    }
  } else {
    exits = detectExits(grid);
  }

  return { ...block, grid, elevationGrid, exits };
}

function getBlockExits(block) {
  return block.exits ?? detectExits(block.grid);
}

// ---- Initialisation ----
async function init() {
  // Charger le pool de blocs via le serveur
  try {
    poolData = await loadPool();
    // Par défaut, tous les blocs sont actifs
    poolData.pool.forEach(b => activeBlockIds.add(b.id));
    
    renderPoolSelector();
  } catch (err) {
    console.error('Erreur de chargement du pool de blocs:', err);
    poolContainer.innerHTML = `<div style="font-size:0.75rem; color:#ff4f4f; padding:0.5rem; text-align:center;">Erreur: ${err.message}</div>`;
  }

  // Saisie de seed initiale aléatoire
  seedValue = String(Math.floor(Math.random() * 90000000) + 10000000);
  inpSeed.value = seedValue;

  // Configuration des écouteurs d'événements UI
  btnRandSeed.addEventListener('click', () => {
    seedValue = String(Math.floor(Math.random() * 90000000) + 10000000);
    inpSeed.value = seedValue;
    triggerGeneration();
  });

  inpSeed.addEventListener('change', (e) => {
    seedValue = e.target.value.trim();
    triggerGeneration();
  });

  selSize.addEventListener('change', (e) => {
    gridSize = parseInt(e.target.value, 10);
    triggerGeneration();
  });

  selMode.addEventListener('change', (e) => {
    mode = e.target.value;
    triggerGeneration();
  });

  btnGenerate.addEventListener('click', triggerGeneration);

  // Sélections globales du pool
  lnkAll.addEventListener('click', (e) => {
    e.preventDefault();
    poolData.pool.forEach(b => activeBlockIds.add(b.id));
    updateCheckboxes();
    triggerGeneration();
  });

  lnkNone.addEventListener('click', (e) => {
    e.preventDefault();
    activeBlockIds.clear();
    updateCheckboxes();
    triggerGeneration();
  });

  // Événements d'affichage
  ['chk-cells', 'chk-exits', 'chk-connections', 'chk-unreachable'].forEach(id => {
    const key = id.replace('chk-', '');
    const el = document.getElementById(id);
    el.addEventListener('change', (e) => {
      displaySettings[key] = e.target.checked;
      draw();
    });
  });

  // Copie JSON
  btnCopyJson.addEventListener('click', () => {
    if (!mapData) return;
    navigator.clipboard.writeText(JSON.stringify(mapData, null, 2))
      .then(() => {
        showToast('📋 JSON Copié dans le presse-papier !');
      })
      .catch(err => {
        console.error('Erreur lors de la copie du JSON:', err);
      });
  });

  // Contrôles de zoom flottants
  btnZoomIn.addEventListener('click', () => {
    zoom = Math.min(10.0, zoom * 1.25);
    draw();
  });
  btnZoomOut.addEventListener('click', () => {
    zoom = Math.max(0.1, zoom * 0.8);
    draw();
  });
  btnZoomReset.addEventListener('click', resetView);

  // Resize canvas
  window.addEventListener('resize', handleResize);
  
  // Événements souris/tactiles sur canvas
  setupCanvasEvents();

  // Première génération
  triggerGeneration();
}

// ---- Gestion du Pool de Blocs dans la Sidebar ----
function renderPoolSelector() {
  if (!poolData || !poolData.pool.length) return;
  poolContainer.innerHTML = '';

  poolData.pool.forEach(block => {
    const item = document.createElement('div');
    item.className = 'pool-item';

    const label = document.createElement('label');
    label.className = 'pool-item-label';
    label.htmlFor = `chk-pool-${block.id}`;

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.id = `chk-pool-${block.id}`;
    chk.checked = activeBlockIds.has(block.id);
    chk.addEventListener('change', (e) => {
      if (e.target.checked) {
        activeBlockIds.add(block.id);
      } else {
        activeBlockIds.add(block.id); // Par sécurité, garder au moins 1 bloc
        if (activeBlockIds.size > 1) {
          activeBlockIds.delete(block.id);
        } else {
          e.target.checked = true;
          showToast('⚠️ Vous devez garder au moins 1 bloc actif.');
        }
      }
      triggerGeneration();
    });

    const checkmark = document.createElement('span');
    checkmark.className = 'checkmark';
    checkmark.style.marginRight = '0.4rem';

    // Nom abrégé et badges
    const spanText = document.createElement('span');
    spanText.textContent = block.name || block.id;

    label.appendChild(chk);
    label.appendChild(checkmark);
    label.appendChild(spanText);

    // Badge exits
    const badgeExits = document.createElement('span');
    badgeExits.className = 'pool-badge pool-badge-exits';
    const exits = block.exits || detectExits(block.grid);
    badgeExits.textContent = exits.length ? exits.join('') : 'Aucun';
    badgeExits.title = `Sorties : ${exits.join(', ')}`;

    item.appendChild(label);
    item.appendChild(badgeExits);

    poolContainer.appendChild(item);
  });
}

function updateCheckboxes() {
  poolData.pool.forEach(b => {
    const chk = document.getElementById(`chk-pool-${b.id}`);
    if (chk) chk.checked = activeBlockIds.has(b.id);
  });
}

// ---- Génération procédurale ----
function triggerGeneration() {
  if (!poolData) return;

  // Filtrer le pool de blocs
  const filteredPool = poolData.pool.filter(b => activeBlockIds.has(b.id));
  if (filteredPool.length === 0) {
    showToast('⚠️ Erreur: Aucun bloc actif sélectionné !');
    return;
  }

  // Configurer la seed (cast en entier ou hash simple)
  let seed = parseInt(seedValue, 10);
  if (isNaN(seed)) {
    // Hash simple de chaîne
    seed = 0;
    for (let i = 0; i < seedValue.length; i++) {
      seed = (seed << 5) - seed + seedValue.charCodeAt(i);
      seed |= 0;
    }
  }

  if (mode === 'graph') {
    // Mode connecté (RACE-B02/B03/B04)
    // Séparer les blocs avec exits
    const seedBlocks = filteredPool.filter(hasProcgenExits);
    
    if (seedBlocks.length === 0) {
      showToast('⚠️ Besoin de blocs déclarant des exits pour le mode Graphe.');
      selMode.value = 'legacy';
      mode = 'legacy';
      triggerGeneration();
      return;
    }

    try {
      const corners = {
        entryBlock: poolData.depart,
        exitBlock:  poolData.arrivee,
      };
      planMap = generateMap(seedBlocks, gridSize, seed, corners);
      checkResult = validateMap(planMap);
      
      // Reconstruction de MapData
      const blocById = Object.fromEntries([
        ...poolData.pool,
        ...(poolData.depart ? [poolData.depart] : []),
        ...(poolData.arrivee ? [poolData.arrivee] : []),
      ].map(b => [b.id, b]));
      const blockScale = 2; // Par défaut
      const blocmapSize = BLOCK_SIZE * blockScale;

      const blocks = planMap.blocks.map(({ row, col, blockId, rotation }) => {
        const bloc = blocById[blockId];
        const rotated = rotateBlock(bloc, rotation);
        return {
          blockId: blockId,
          name: bloc.name ?? '',
          col, row,
          position: [col * blocmapSize, row * blocmapSize],
          grid: rotated.grid,
          exits: rotated.exits,
          rotation
        };
      });

      const totalWidth = gridSize * blocmapSize;
      const totalDepth = gridSize * blocmapSize;
      const entryCenter = { x: blocmapSize * 0.5, z: blocmapSize * 0.5 };
      const exitCenter  = { x: (gridSize - 0.5) * blocmapSize, z: (gridSize - 0.5) * blocmapSize };

      mapData = {
        id: `map_graph_${planMap.seed}`,
        gridCols: gridSize,
        gridRows: gridSize,
        blockScale,
        blocks,
        startPosition: { x: entryCenter.x, z: entryCenter.z, angle: 0 },
        finishPosition: { x: exitCenter.x, z: exitCenter.z },
        entry: {
          blockCol: 0,
          blockRow: 0,
          worldCenter: entryCenter
        },
        exit: {
          blockCol: gridSize - 1,
          blockRow: gridSize - 1,
          worldCenter: exitCenter
        },
        worldExtent: { width: totalWidth, depth: totalDepth }
      };

      updateUIStats();
      resetView();
    } catch (err) {
      console.error(err);
      showToast(`❌ Erreur de génération: ${err.message}`);
    }
  } else {
    // Mode legacy
    try {
      const poolDataMock = {
        depart: poolData.depart,
        arrivee: poolData.arrivee,
        pool: filteredPool
      };
      
      // Simuler generate() avec options
      const mapCfg = { gridCols: gridSize, gridRows: gridSize, blockScale: 2 };
      const blockScale = mapCfg.blockScale;
      const blocmapSize = BLOCK_SIZE * blockScale;
      const blocks = [];

      for (let col = 0; col < gridSize; col++) {
        for (let row = 0; row < gridSize; row++) {
          let choisi;
          if (col === 0) choisi = poolDataMock.depart;
          else if (col === gridSize - 1) choisi = poolDataMock.arrivee;
          else choisi = filteredPool[Math.floor(Math.random() * filteredPool.length)];

          const exits = choisi.exits || detectExits(choisi.grid);
          blocks.push({
            blockId: choisi?.id ?? 'legacy',
            name: choisi?.name ?? '',
            col, row,
            position: [col * blocmapSize, row * blocmapSize],
            grid: choisi?.grid ?? [],
            exits: exits,
            rotation: 0
          });
        }
      }

      const totalWidth = gridSize * blocmapSize;
      const totalDepth = gridSize * blocmapSize;

      mapData = {
        id: `map_legacy_${Date.now()}`,
        gridCols: gridSize,
        gridRows: gridSize,
        blockScale,
        blocks,
        startPosition:  { x: blocmapSize / 2, z: totalDepth / 2, angle: Math.PI / 2 },
        finishPosition: { x: (gridSize - 0.5) * blocmapSize, z: totalDepth / 2 },
        entry: {
          blockCol: 0,
          blockRow: Math.floor(gridSize / 2),
          worldCenter: { x: blocmapSize / 2, z: totalDepth / 2 }
        },
        exit: {
          blockCol: gridSize - 1,
          blockRow: Math.floor(gridSize / 2),
          worldCenter: { x: (gridSize - 0.5) * blocmapSize, z: totalDepth / 2 }
        },
        worldExtent: { width: totalWidth, depth: totalDepth }
      };

      // Simuler un planMap pour validation
      planMap = {
        seed: seed,
        gridSize: gridSize,
        blocks: blocks.map(b => ({ row: b.row, col: b.col, blockId: b.blockId, rotation: 0, exits: b.exits }))
      };
      checkResult = validateMap(planMap);

      updateUIStats();
      resetView();
    } catch (err) {
      console.error(err);
      showToast(`❌ Erreur: ${err.message}`);
    }
  }
}

// ---- Mise à jour des statistiques de l'UI ----
function updateUIStats() {
  if (!mapData || !checkResult) return;

  statMapId.textContent = mapData.id;
  statSeed.textContent = planMap.seed;
  statReachable.textContent = `${checkResult.reachable} / ${gridSize * gridSize} blocs`;

  // Changement de couleur/validation
  if (checkResult.valid) {
    statusCard.className = 'status-panel status-valid';
    statusText.textContent = '✓ Map Valide (Connexe)';
    unreachableContainer.style.display = 'none';
  } else {
    statusCard.className = 'status-panel status-invalid';
    statusText.textContent = `❌ Invalide (${checkResult.unreachable.length} isolés)`;
    unreachableContainer.style.display = 'block';
    
    unreachableList.innerHTML = '';
    checkResult.unreachable.forEach(b => {
      const div = document.createElement('div');
      div.textContent = `• Bloc en Ligne ${b.row + 1}, Col ${b.col + 1}`;
      div.style.cursor = 'pointer';
      div.addEventListener('click', () => {
        // Centrer la caméra sur ce bloc
        focusOnBlock(b.row, b.col);
      });
      unreachableList.appendChild(div);
    });
  }
}

// ---- Rotation interactive d'un bloc ----
function rotateBlockAt(row, col) {
  if (mode !== 'graph') {
    showToast('⚠️ La rotation interactive n\'est disponible qu\'en mode Graphe (Procgen).');
    return;
  }

  // Trouver le bloc dans le planMap
  const planBlock = planMap.blocks.find(b => b.row === row && b.col === col);
  const mapBlock = mapData.blocks.find(b => b.row === row && b.col === col);
  if (!planBlock || !mapBlock) return;

  // Calculer la nouvelle rotation
  const nextRotation = (planBlock.rotation + 1) % 4;
  planBlock.rotation = nextRotation;
  mapBlock.rotation = nextRotation;

  // Mettre à jour la grille rotative et les exits associés
  const origBlock = poolData.pool.find(b => b.id === planBlock.blockId)
    ?? (poolData.depart?.id === planBlock.blockId ? poolData.depart : null)
    ?? (poolData.arrivee?.id === planBlock.blockId ? poolData.arrivee : null);
  if (!origBlock) return;

  const rotated = rotateBlock(origBlock, nextRotation);

  planBlock.exits = rotated.exits;
  mapBlock.grid = rotated.grid;
  mapBlock.exits = rotated.exits;

  // Re-valider la carte
  checkResult = validateMap(planMap);

  // Mettre à jour l'UI et dessiner
  updateUIStats();
  draw();
  showToast(`↺ Bloc (${row + 1}, ${col + 1}) pivoté à ${(nextRotation * 90)}°`);
}

// ---- Moteur de Rendu 2D (Canvas) ----
function draw() {
  if (!mapData) return;

  // Nettoyage complet
  ctx.fillStyle = '#04040a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const dpr = window.devicePixelRatio || 1;
  ctx.save();
  ctx.scale(dpr, dpr);

  // Application de la caméra (Translation + Zoom)
  ctx.translate(canvas.clientWidth / 2 + offsetX, canvas.clientHeight / 2 + offsetY);
  ctx.scale(zoom, zoom);

  const blockScale = mapData.blockScale ?? 2;
  const bWorldSize = BLOCK_SIZE * blockScale; // ex: 16
  const cellWorldSize = bWorldSize / BLOCK_SIZE; // ex: 2
  const totalWorldWidth = gridSize * bWorldSize;
  const totalWorldDepth = gridSize * bWorldSize;

  // Centrage de la map à (0,0)
  ctx.translate(-totalWorldWidth / 2, -totalWorldDepth / 2);

  // 1. Dessiner les cellules de chaque bloc
  mapData.blocks.forEach(block => {
    const bx = block.col * bWorldSize;
    const bz = block.row * bWorldSize;

    // Fond du bloc
    ctx.fillStyle = '#0e0e1e';
    ctx.fillRect(bx, bz, bWorldSize, bWorldSize);

    // Dessiner les cases individuelles
    if (displaySettings.cells) {
      for (let gz = 0; gz < BLOCK_SIZE; gz++) {
        for (let gx = 0; gx < BLOCK_SIZE; gx++) {
          const cell = block.grid[gz][gx];
          if (cell === null) continue; // Route par défaut, déjà foncée

          const cx = bx + gx * cellWorldSize;
          const cz = bz + gz * cellWorldSize;
          
          ctx.fillStyle = CELL_COLORS[cell] || '#ff00ff';
          ctx.fillRect(cx, cz, cellWorldSize, cellWorldSize);

          // Texture / Lettre d'information pour chaque cellule spéciale
          const shape = CELL_SHAPES[cell];
          if (shape) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
            ctx.font = `${cellWorldSize * 0.6}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(shape, cx + cellWorldSize / 2, cz + cellWorldSize / 2);
          }
        }
      }

      // Dessiner une grille fine pour les cellules internes
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
      ctx.lineWidth = 0.1;
      ctx.beginPath();
      for (let i = 1; i < BLOCK_SIZE; i++) {
        // Verticales
        ctx.moveTo(bx + i * cellWorldSize, bz);
        ctx.lineTo(bx + i * cellWorldSize, bz + bWorldSize);
        // Horizontales
        ctx.moveTo(bx, bz + i * cellWorldSize);
        ctx.lineTo(bx + bWorldSize, bz + i * cellWorldSize);
      }
      ctx.stroke();
    }

    // Bordure extérieure du bloc
    const isStart = block.col === mapData.entry?.blockCol && block.row === mapData.entry?.blockRow;
    const isExit = block.col === mapData.exit?.blockCol && block.row === mapData.exit?.blockRow;

    if (isStart) {
      ctx.strokeStyle = 'rgba(46, 204, 113, 0.8)';
      ctx.lineWidth = 0.5;
    } else if (isExit) {
      ctx.strokeStyle = 'rgba(241, 196, 15, 0.8)';
      ctx.lineWidth = 0.5;
    } else {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 0.25;
    }
    ctx.strokeRect(bx, bz, bWorldSize, bWorldSize);

    // Surligner les blocs inaccessibles (BFS isolés)
    if (displaySettings.unreachable && checkResult) {
      const isUnreachable = checkResult.unreachable.some(u => u.row === block.row && u.col === block.col);
      if (isUnreachable) {
        ctx.fillStyle = 'rgba(231, 76, 60, 0.25)';
        ctx.fillRect(bx, bz, bWorldSize, bWorldSize);
        ctx.strokeStyle = '#e74c3c';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(bx + 0.2, bz + 0.2, bWorldSize - 0.4, bWorldSize - 0.4);
      }
    }
  });

  // 2. Dessiner les indicateurs de sortie (Exits) et les connections
  mapData.blocks.forEach(block => {
    const bx = block.col * bWorldSize;
    const bz = block.row * bWorldSize;
    const cx = bx + bWorldSize / 2;
    const cz = bz + bWorldSize / 2;

    const exits = getBlockExits(block);

    exits.forEach(exit => {
      // Coordonnées du marqueur de sortie
      let ex = cx;
      let ez = cz;
      let opposite = '';
      let nx = block.col;
      let nz = block.row;

      if (exit === 'N') { ez = bz; opposite = 'S'; nz--; }
      else if (exit === 'S') { ez = bz + bWorldSize; opposite = 'N'; nz++; }
      else if (exit === 'E') { ex = bx + bWorldSize; opposite = 'O'; nx++; }
      else if (exit === 'O') { ex = bx; opposite = 'E'; nx--; }

      // Vérifier si cette sortie est connectée de façon valide à un voisin
      let connected = false;
      if (nx >= 0 && nx < gridSize && nz >= 0 && nz < gridSize) {
        const neighbor = mapData.blocks.find(b => b.col === nx && b.row === nz);
        if (neighbor && getBlockExits(neighbor).includes(opposite)) {
          connected = true;
        }
      }

      // Dessiner le petit cercle de sortie
      if (displaySettings.exits) {
        ctx.beginPath();
        ctx.arc(ex, ez, bWorldSize * 0.05, 0, Math.PI * 2);
        ctx.fillStyle = connected ? '#2ecc71' : '#e74c3c';
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 0.2;
        ctx.stroke();
      }

      // Dessiner la ligne de connection BFS (seulement dans une direction pour éviter doublon)
      if (displaySettings.connections && connected && (nx > block.col || nz > block.row)) {
        ctx.beginPath();
        ctx.moveTo(cx, cz);
        const nBlock = mapData.blocks.find(b => b.col === nx && b.row === nz);
        if (nBlock) {
          const ncx = nBlock.col * bWorldSize + bWorldSize / 2;
          const ncz = nBlock.row * bWorldSize + bWorldSize / 2;
          ctx.lineTo(ncx, ncz);
          ctx.strokeStyle = 'rgba(46, 204, 113, 0.4)';
          ctx.lineWidth = 1.0;
          ctx.stroke();
        }
      }
    });

    // Dessiner les étiquettes "DEPART" et "ARRIVEE" sur les blocs
    const isStart = block.col === mapData.entry?.blockCol && block.row === mapData.entry?.blockRow;
    const isExit = block.col === mapData.exit?.blockCol && block.row === mapData.exit?.blockRow;

    if (isStart) {
      ctx.fillStyle = '#2ecc71';
      ctx.font = `bold ${bWorldSize * 0.15}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('START', cx, bz + bWorldSize * 0.25);

      // Dessiner un petit triangle vert pour la voiture de départ
      ctx.beginPath();
      ctx.moveTo(cx, cz - 1.2);
      ctx.lineTo(cx + 1.0, cz + 0.8);
      ctx.lineTo(cx - 1.0, cz + 0.8);
      ctx.closePath();
      ctx.fillStyle = '#4488ff';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.3;
      ctx.stroke();
    }

    if (isExit) {
      ctx.fillStyle = '#f1c40f';
      ctx.font = `bold ${bWorldSize * 0.15}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('FINISH', cx, bz + bWorldSize * 0.25);

      // Dessiner une petite étoile jaune d'arrivée
      drawStar(ctx, cx, cz, 1.2, 0.5, 5, '#f1c40f');
    }
  });

  ctx.restore();
}

function drawStar(ctx, cx, cy, spikes, outerRadius, innerRadius, fillStyle) {
  let rot = Math.PI / 2 * 3;
  let x = cx;
  let y = cy;
  let step = Math.PI / spikes;

  ctx.beginPath();
  ctx.moveTo(cx, cy - outerRadius);
  for (let i = 0; i < spikes; i++) {
    x = cx + Math.cos(rot) * outerRadius;
    y = cy + Math.sin(rot) * outerRadius;
    ctx.lineTo(x, y);
    rot += step;

    x = cx + Math.cos(rot) * innerRadius;
    y = cy + Math.sin(rot) * innerRadius;
    ctx.lineTo(x, y);
    rot += step;
  }
  ctx.lineTo(cx, cy - outerRadius);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 0.2;
  ctx.stroke();
}

// ---- Interactions du Canvas (Pan / Zoom / Clic) ----
function setupCanvasEvents() {
  canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    hasMoved = false;
    dragStart.x = e.clientX;
    dragStart.y = e.clientY;
    dragStartOffset.x = offsetX;
    dragStartOffset.y = offsetY;
  });

  canvas.addEventListener('mousemove', (e) => {
    if (isDragging) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;

      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasMoved = true;
      }

      offsetX = dragStartOffset.x + dx;
      offsetY = dragStartOffset.y + dy;
      hideBlockTooltip();
      draw();
      return;
    }

    updateBlockTooltip(e);
  });

  canvas.addEventListener('mouseleave', hideBlockTooltip);

  window.addEventListener('mouseup', (e) => {
    if (!isDragging) return;
    isDragging = false;

    // Détection de clic sans glisser
    if (!hasMoved && e.target === canvas) {
      const now = performance.now();
      if (now - lastClickTime < 300) {
        // Double-clic : réinitialiser la vue
        resetView();
      } else {
        // Clic simple : calculer le bloc cible
        handleCanvasClick(e);
      }
      lastClickTime = now;
    }
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Coordonnées du monde sous la souris avant zoom
    const wmx = (mouseX - canvas.clientWidth / 2 - offsetX) / zoom;
    const wmy = (mouseY - canvas.clientHeight / 2 - offsetY) / zoom;

    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    zoom = Math.max(0.1, Math.min(10.0, zoom * factor));

    // Ajustement de l'offset pour zoomer vers le pointeur
    offsetX = mouseX - canvas.clientWidth / 2 - wmx * zoom;
    offsetY = mouseY - canvas.clientHeight / 2 - wmy * zoom;

    draw();
  }, { passive: false });

  // Interactions tactiles (très basique pour tablettes)
  let touchStartDist = 0;
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      isDragging = true;
      hasMoved = false;
      dragStart.x = e.touches[0].clientX;
      dragStart.y = e.touches[0].clientY;
      dragStartOffset.x = offsetX;
      dragStartOffset.y = offsetY;
    } else if (e.touches.length === 2) {
      isDragging = false;
      touchStartDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  });

  canvas.addEventListener('touchmove', (e) => {
    if (isDragging && e.touches.length === 1) {
      const dx = e.touches[0].clientX - dragStart.x;
      const dy = e.touches[0].clientY - dragStart.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) hasMoved = true;
      offsetX = dragStartOffset.x + dx;
      offsetY = dragStartOffset.y + dy;
      draw();
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (touchStartDist > 0) {
        const factor = dist / touchStartDist;
        zoom = Math.max(0.1, Math.min(10.0, zoom * factor));
        touchStartDist = dist;
        draw();
      }
    }
  });

  canvas.addEventListener('touchend', (e) => {
    if (isDragging) {
      isDragging = false;
      if (!hasMoved) {
        // Clic tactile simulé
        const fakeEvent = {
          clientX: e.changedTouches[0].clientX,
          clientY: e.changedTouches[0].clientY
        };
        handleCanvasClick(fakeEvent);
      }
    }
  });
}

/** Convertit une position écran en coordonnées bloc { col, row } ou null. */
function getBlockAtClientPos(clientX, clientY) {
  if (!mapData) return null;

  const rect = canvas.getBoundingClientRect();
  const mx = clientX - rect.left;
  const my = clientY - rect.top;

  const blockScale = mapData.blockScale ?? 2;
  const bWorldSize = BLOCK_SIZE * blockScale;
  const totalWorldWidth = gridSize * bWorldSize;
  const totalWorldDepth = gridSize * bWorldSize;

  const wmx = (mx - canvas.clientWidth / 2 - offsetX) / zoom;
  const wmy = (my - canvas.clientHeight / 2 - offsetY) / zoom;
  const worldX = wmx + totalWorldWidth / 2;
  const worldZ = wmy + totalWorldDepth / 2;

  const col = Math.floor(worldX / bWorldSize);
  const row = Math.floor(worldZ / bWorldSize);

  if (col >= 0 && col < gridSize && row >= 0 && row < gridSize) {
    return { col, row };
  }
  return null;
}

function formatRotation(rotation) {
  const steps = ((rotation ?? 0) % 4 + 4) % 4;
  return `${steps * 90}°`;
}

function hideBlockTooltip() {
  blockTooltip.classList.remove('visible');
  blockTooltip.setAttribute('aria-hidden', 'true');
}

function updateBlockTooltip(e) {
  if (!mapData) {
    hideBlockTooltip();
    return;
  }

  const coords = getBlockAtClientPos(e.clientX, e.clientY);
  if (!coords) {
    hideBlockTooltip();
    return;
  }

  const block = mapData.blocks.find(b => b.col === coords.col && b.row === coords.row);
  if (!block) {
    hideBlockTooltip();
    return;
  }

  const name = block.name || block.blockId || 'Bloc inconnu';
  const rotation = formatRotation(block.rotation);
  const exits = getBlockExits(block).join(', ') || 'aucune';

  blockTooltip.innerHTML = `
    <div class="tooltip-name">${name}</div>
    <div class="tooltip-meta">Rotation : ${rotation} · Position L${coords.row + 1} C${coords.col + 1}</div>
    <div class="tooltip-meta">Sorties : ${exits}</div>
  `;

  const main = canvas.parentElement;
  const mainRect = main.getBoundingClientRect();
  blockTooltip.style.left = `${e.clientX - mainRect.left + 14}px`;
  blockTooltip.style.top = `${e.clientY - mainRect.top + 14}px`;
  blockTooltip.classList.add('visible');
  blockTooltip.setAttribute('aria-hidden', 'false');
}

function handleCanvasClick(e) {
  if (!mapData) return;

  const coords = getBlockAtClientPos(e.clientX, e.clientY);
  if (coords) {
    rotateBlockAt(coords.row, coords.col);
  }
}

// Centrer la vue sur un bloc spécifique (par exemple, un bloc inaccessible)
function focusOnBlock(row, col) {
  if (!mapData) return;
  const blockScale = mapData.blockScale ?? 2;
  const bWorldSize = BLOCK_SIZE * blockScale;
  const totalWorldWidth = gridSize * bWorldSize;
  const totalWorldDepth = gridSize * bWorldSize;

  // Position du bloc par rapport au centre de la map (0,0)
  const bx = col * bWorldSize + bWorldSize / 2;
  const bz = row * bWorldSize + bWorldSize / 2;
  const targetWorldX = bx - totalWorldWidth / 2;
  const targetWorldZ = bz - totalWorldDepth / 2;

  zoom = 2.0; // Zoom serré
  offsetX = -targetWorldX * zoom;
  offsetY = -targetWorldZ * zoom;
  draw();
}

function resetView() {
  if (!mapData) return;

  const blockScale = mapData.blockScale ?? 2;
  const bWorldSize = BLOCK_SIZE * blockScale;
  const totalWorldWidth = gridSize * bWorldSize;
  const totalWorldDepth = gridSize * bWorldSize;

  // Auto-fit avec 40px de marge
  const zoomX = (canvas.clientWidth - 80) / totalWorldWidth;
  const zoomY = (canvas.clientHeight - 80) / totalWorldDepth;
  zoom = Math.min(zoomX, zoomY, 2.0); // max 2x

  offsetX = 0;
  offsetY = 0;
  draw();
}

function handleResize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  draw();
}

// ---- Toast Notifications ----
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  setTimeout(() => {
    toast.classList.remove('visible');
  }, 2500);
}

// ---- Démarrage ----
handleResize();
init();
