// Mini-carte 2D superposée au jeu (SOLO-06).
// Mode compact : canvas 160×160, coin bas-droit, opacité 0.85.
// Mode agrandi : modale 90% du min(innerWidth, innerHeight), overlay connectivité.
//
// API publique :
//   initMinimap(mapData, container) → MinimapInstance
//   updateMinimap(instance, playersState) → void
//   disposeMinimap(instance) → void
//
// playersState : [{id, position:{x,z}, isLocal:bool, color?:string}]

const COMPACT_SIZE  = 160;
const COMPACT_OPACITY = 0.85;

const C_ROUTE   = '#222233';
const C_DEPART  = '#66ff99';
const C_ARRIVEE = '#ffd700';
const C_JOUEUR  = '#4488ff';
const C_FOND    = '#000011';

// Taille d'un bloc en unités monde (BLOCK_SIZE * blockScale)
function _blocmapSize(mapData) {
  const bs = mapData.blockScale ?? 2;
  return 8 * bs; // BLOCK_SIZE = 8
}

function _gridCols(mapData) { return mapData.gridCols ?? mapData.width  ?? 4; }
function _gridRows(mapData) { return mapData.gridRows ?? mapData.height ?? 4; }

/**
 * Convertit une position monde en coordonnées pixel sur le canvas.
 */
function _worldToPx(wx, wz, mapData, size) {
  const cols     = _gridCols(mapData);
  const rows     = _gridRows(mapData);
  const bsize    = _blocmapSize(mapData);
  const totalW   = cols * bsize;
  const totalH   = rows * bsize;
  return {
    x: (wx / totalW) * size,
    y: (wz / totalH) * size,
  };
}

/**
 * Initialise la mini-carte.
 * @param {object} mapData — MapData de map-generator
 * @param {HTMLElement} container — élément parent (généralement document.body)
 * @returns {MinimapInstance}
 */
export function initMinimap(mapData, container) {
  // Canvas compact — coin bas-droit
  const canvas = document.createElement('canvas');
  canvas.width  = COMPACT_SIZE;
  canvas.height = COMPACT_SIZE;
  Object.assign(canvas.style, {
    position:    'fixed',
    bottom:      '8px',
    right:       '8px',
    opacity:     String(COMPACT_OPACITY),
    border:      '1px solid rgba(255,255,255,0.2)',
    borderRadius:'4px',
    cursor:      'pointer',
    zIndex:      '100',
    imageRendering: 'pixelated',
  });
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  // Overlay agrandi — modale plein écran
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    display:         'none',
    position:        'fixed',
    inset:           '0',
    background:      'rgba(0,0,0,0.75)',
    zIndex:          '200',
    alignItems:      'center',
    justifyContent:  'center',
  });
  document.body.appendChild(overlay);

  const overlayCanvas = document.createElement('canvas');
  Object.assign(overlayCanvas.style, {
    border:       '1px solid rgba(255,255,255,0.3)',
    borderRadius: '6px',
  });
  overlay.appendChild(overlayCanvas);
  const overlayCtx = overlayCanvas.getContext('2d');

  const instance = {
    canvas, ctx,
    overlay, overlayCanvas, overlayCtx,
    mapData,
    expanded: false,
    _staticCache: null, // fond statique pré-rendu
  };

  _buildStaticCache(instance);

  // Bascule vers le mode agrandi au clic sur le canvas compact
  canvas.addEventListener('click', () => _toggleExpanded(instance, true));

  // Fermeture de l'overlay au clic à l'extérieur ou Échap
  overlay.addEventListener('click', e => {
    if (e.target === overlay) _toggleExpanded(instance, false);
  });
  instance._onKeydown = e => {
    if (e.key === 'Escape' && instance.expanded) _toggleExpanded(instance, false);
  };
  document.addEventListener('keydown', instance._onKeydown);

  return instance;
}

/**
 * Met à jour la mini-carte à chaque frame.
 * @param {MinimapInstance} instance
 * @param {Array} playersState — [{id, position:{x,z}, isLocal:bool, color?}]
 */
export function updateMinimap(instance, playersState) {
  if (!instance) return;
  _dessinerCompact(instance, playersState);
  if (instance.expanded) _dessinerAgrandi(instance, playersState);
}

/**
 * Libère les ressources DOM de la mini-carte.
 * @param {MinimapInstance} instance
 */
export function disposeMinimap(instance) {
  if (!instance) return;
  instance.canvas.remove();
  instance.overlay.remove();
  if (instance._onKeydown) document.removeEventListener('keydown', instance._onKeydown);
}

// ---- Internes ----

/**
 * Pré-calcule le fond statique (blocs, départ, arrivée) dans un canvas offscreen.
 */
function _buildStaticCache(instance) {
  const { mapData } = instance;
  const cols = _gridCols(mapData);
  const rows = _gridRows(mapData);

  const off = document.createElement('canvas');
  off.width  = COMPACT_SIZE;
  off.height = COMPACT_SIZE;
  const c   = off.getContext('2d');

  const cellW = COMPACT_SIZE / cols;
  const cellH = COMPACT_SIZE / rows;

  // Fond global
  c.fillStyle = C_FOND;
  c.fillRect(0, 0, COMPACT_SIZE, COMPACT_SIZE);

  const blocSet = new Set(mapData.blocks.map(b => `${b.col},${b.row}`));
  const entryC  = mapData.entry?.blockCol ?? 0;
  const entryR  = mapData.entry?.blockRow ?? 0;
  const exitC   = mapData.exit?.blockCol  ?? cols - 1;
  const exitR   = mapData.exit?.blockRow  ?? rows - 1;

  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const isEntry = col === entryC && row === entryR;
      const isExit  = col === exitC  && row === exitR;

      if      (isEntry)                       c.fillStyle = C_DEPART;
      else if (isExit)                        c.fillStyle = C_ARRIVEE;
      else if (blocSet.has(`${col},${row}`)) c.fillStyle = C_ROUTE;
      else                                   c.fillStyle = C_FOND;

      c.fillRect(
        Math.round(col * cellW) + 1,
        Math.round(row * cellH) + 1,
        Math.max(1, Math.round(cellW) - 1),
        Math.max(1, Math.round(cellH) - 1),
      );
    }
  }

  instance._staticCache = off;
}

function _dessinerCompact(instance, playersState) {
  const { canvas, ctx, _staticCache } = instance;
  ctx.clearRect(0, 0, COMPACT_SIZE, COMPACT_SIZE);
  if (_staticCache) ctx.drawImage(_staticCache, 0, 0);
  _dessinerJoueurs(ctx, instance, playersState, COMPACT_SIZE, 4, 3);
}

function _dessinerAgrandi(instance, playersState) {
  const { overlayCanvas, overlayCtx, mapData } = instance;
  const size  = overlayCanvas.width;
  const cols  = _gridCols(mapData);
  const rows  = _gridRows(mapData);
  const cellW = size / cols;
  const cellH = size / rows;

  // Fond
  overlayCtx.fillStyle = C_FOND;
  overlayCtx.fillRect(0, 0, size, size);

  const blocSet = new Set(mapData.blocks.map(b => `${b.col},${b.row}`));
  const entryC  = mapData.entry?.blockCol ?? 0;
  const entryR  = mapData.entry?.blockRow ?? 0;
  const exitC   = mapData.exit?.blockCol  ?? cols - 1;
  const exitR   = mapData.exit?.blockRow  ?? rows - 1;

  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const isEntry = col === entryC && row === entryR;
      const isExit  = col === exitC  && row === exitR;
      const hasBoc  = blocSet.has(`${col},${row}`);

      if      (isEntry) overlayCtx.fillStyle = C_DEPART;
      else if (isExit)  overlayCtx.fillStyle = C_ARRIVEE;
      else if (hasBoc)  overlayCtx.fillStyle = C_ROUTE;
      else              overlayCtx.fillStyle = C_FOND;

      const px = Math.round(col * cellW) + 1;
      const py = Math.round(row * cellH) + 1;
      const pw = Math.max(1, Math.round(cellW) - 1);
      const ph = Math.max(1, Math.round(cellH) - 1);
      overlayCtx.fillRect(px, py, pw, ph);

      // Overlay connectivité : cellules null du bloc en vert translucide
      if (hasBoc && !isEntry && !isExit) {
        const bloc = mapData.blocks.find(b => b.col === col && b.row === row);
        const grid = bloc?.grid;
        if (grid) {
          const gcols = grid.length;
          const grows = grid[0]?.length ?? 0;
          const cw    = pw / gcols;
          const ch    = ph / grows;
          overlayCtx.fillStyle = 'rgba(100,200,100,0.15)';
          for (let gc = 0; gc < gcols; gc++) {
            for (let gr = 0; gr < grows; gr++) {
              if (grid[gc][gr] === null) {
                overlayCtx.fillRect(px + gc * cw, py + gr * ch, cw, ch);
              }
            }
          }
        }
      }
    }
  }

  // Marqueur départ : triangle
  _dessinerTriangle(
    overlayCtx,
    Math.round(entryC * cellW + cellW / 2),
    Math.round(entryR * cellH + cellH / 2),
    Math.min(cellW, cellH) * 0.28,
    C_DEPART,
  );

  // Marqueur arrivée : étoile
  _dessinerEtoile(
    overlayCtx,
    Math.round(exitC  * cellW + cellW / 2),
    Math.round(exitR  * cellH + cellH / 2),
    Math.min(cellW, cellH) * 0.28,
    C_ARRIVEE,
  );

  _dessinerJoueurs(overlayCtx, instance, playersState, size, 6, 5);
}

function _dessinerJoueurs(ctx, instance, playersState, size, localR, remoteR) {
  if (!playersState) return;
  for (const p of playersState) {
    if (!p?.position) continue;
    const pos = _worldToPx(p.position.x, p.position.z, instance.mapData, size);
    const r   = p.isLocal ? localR : remoteR;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    ctx.fillStyle = p.isLocal ? C_JOUEUR : (p.color ?? '#ffffff');
    ctx.fill();
    if (p.isLocal) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = 1.5;
      ctx.stroke();
    }
  }
}

function _toggleExpanded(instance, open) {
  instance.expanded = open;
  if (open) {
    const s = Math.floor(Math.min(window.innerWidth, window.innerHeight) * 0.9);
    instance.overlayCanvas.width  = s;
    instance.overlayCanvas.height = s;
    instance.overlay.style.display = 'flex';
    _dessinerAgrandi(instance, null);
  } else {
    instance.overlay.style.display = 'none';
  }
}

function _dessinerTriangle(ctx, cx, cy, r, couleur) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r * 0.866, cy + r * 0.5);
  ctx.lineTo(cx - r * 0.866, cy + r * 0.5);
  ctx.closePath();
  ctx.fillStyle = couleur;
  ctx.fill();
}

function _dessinerEtoile(ctx, cx, cy, r, couleur) {
  const n     = 5;
  const inner = r * 0.4;
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const angle = (i * Math.PI) / n - Math.PI / 2;
    const dist  = i % 2 === 0 ? r : inner;
    ctx.lineTo(cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist);
  }
  ctx.closePath();
  ctx.fillStyle = couleur;
  ctx.fill();
}
