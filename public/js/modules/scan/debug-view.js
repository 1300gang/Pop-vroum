// Mosaïque de visualisation du pipeline scan — Story 1.11
// Affiche 8 panneaux miniatures (6 actifs + 2 réservés Phase 2)
// auto-mis à jour après chaque étape.
//
// API :
//   init(containerEl)
//   updateBrute(imageData, qrResult?)
//   updateRedressée(imageData)
//   updatePatch(imageData, cibles?)
//   updateFace(imageData, grille?, dims?)
//   updateProfil(imageData, grille?, dims?)
//   updateDessus(imageData, grille?, dims?)
//   placeholderVoxel(message?)
//   placeholderValidation(message?)

const COLOR_CSS = {
  red: '#EF4444', green: '#22C55E', blue: '#3B82F6',
  orange: '#F97316', violet: '#A855F7', pink: '#EC4899',
};

const PANNEAUX = [
  { id: 'brute',      label: '📷 Brute',          col: 1, row: 1 },
  { id: 'redressée',  label: '🔲 Redressée',       col: 2, row: 1 },
  { id: 'patch',      label: '🎨 Patch',           col: 3, row: 1 },
  { id: 'face',       label: '🚗 Face',            col: 4, row: 1 },
  { id: 'profil',     label: '⬛ Profil',          col: 1, row: 2 },
  { id: 'dessus',     label: '🔝 Dessus',          col: 2, row: 2 },
  { id: 'voxel',      label: '🧊 Voxel 3D',        col: 3, row: 2, placeholder: true },
  { id: 'validation', label: '✅ Validation',       col: 4, row: 2, placeholder: true },
];

let _canvases = {}; // id → HTMLCanvasElement

/**
 * Injecte la mosaïque dans containerEl.
 * @param {HTMLElement} containerEl
 */
export function init(containerEl) {
  containerEl.innerHTML = `
    <div class="dv-mosaique">
      ${PANNEAUX.map(p => `
        <div class="dv-cellule${p.placeholder ? ' dv-placeholder' : ''}" data-id="${p.id}">
          <div class="dv-label">${p.label}</div>
          <canvas class="dv-canvas" id="dv-canvas-${p.id}"></canvas>
          ${p.placeholder ? `<div class="dv-ph-msg">Phase 2</div>` : ''}
        </div>
      `).join('')}
    </div>`;

  PANNEAUX.forEach(p => {
    _canvases[p.id] = document.getElementById(`dv-canvas-${p.id}`);
  });
}

/** Panneau 1 : photo brute, avec superposition QR optionnelle. */
export function updateBrute(imageData, qrResult = null) {
  const canvas = _canvases.brute;
  if (!canvas) return;
  _drawImageData(canvas, imageData);

  if (qrResult) {
    const ctx  = canvas.getContext('2d');
    const scaleX = canvas.width  / imageData.width;
    const scaleY = canvas.height / imageData.height;
    const lw   = Math.max(1.5, canvas.width / 200);

    for (const info of Object.values(qrResult.trouve || {})) {
      const { topLeftCorner: tl, topRightCorner: tr,
              bottomRightCorner: br, bottomLeftCorner: bl } = info.location;
      ctx.strokeStyle = '#2ecc71';
      ctx.lineWidth   = lw;
      ctx.beginPath();
      ctx.moveTo(tl.x * scaleX, tl.y * scaleY);
      ctx.lineTo(tr.x * scaleX, tr.y * scaleY);
      ctx.lineTo(br.x * scaleX, br.y * scaleY);
      ctx.lineTo(bl.x * scaleX, bl.y * scaleY);
      ctx.closePath();
      ctx.stroke();
    }

    // Badge type
    if (qrResult.type) {
      const icone = qrResult.type === 'vehicle' ? '🚗' : '🧱';
      ctx.font = `bold ${Math.max(10, canvas.width / 20)}px sans-serif`;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(4, 4, canvas.width * 0.4, 20);
      ctx.fillStyle = '#fff';
      ctx.fillText(`${icone} ${qrResult.type}`, 6, 18);
    }
  }

  _majStatut('brute', qrResult?.complet ? '✓' : '…');
}

/** Panneau 2 : image redressée. */
export function updateRedressée(imageData) {
  _drawImageData(_canvases.redressée, imageData);
  _majStatut('redressée', '✓');
}

/** Panneau 3 : patch couleur avec carrés HSL calibrés. */
export function updatePatch(imageData, cibles = null) {
  const canvas = _canvases.patch;
  if (!canvas) return;
  _drawImageData(canvas, imageData);

  if (cibles) {
    const ctx = canvas.getContext('2d');
    const noms = ['red', 'green', 'blue', 'orange', 'violet', 'pink'];
    const dotSize = Math.max(6, canvas.width / 12);
    noms.forEach((nom, i) => {
      const c = cibles[nom];
      ctx.fillStyle = `hsl(${c.h.toFixed(0)},${(c.s*100).toFixed(0)}%,${(c.l*100).toFixed(0)}%)`;
      ctx.fillRect(i * (dotSize + 2) + 2, canvas.height - dotSize - 2, dotSize, dotSize);
    });
  }

  _majStatut('patch', cibles ? '✓' : '…');
}

/** Panneau 4 : vue face avec grille de couleurs. */
export function updateFace(imageData, grille = null, dims = null) {
  _drawGrille(_canvases.face, imageData, grille, dims);
  _majStatut('face', grille ? '✓' : '…');
}

/** Panneau 5 : vue profil. */
export function updateProfil(imageData, grille = null, dims = null) {
  _drawGrille(_canvases.profil, imageData, grille, dims);
  _majStatut('profil', grille ? '✓' : '…');
}

/** Panneau 6 : vue dessus. */
export function updateDessus(imageData, grille = null, dims = null) {
  _drawGrille(_canvases.dessus, imageData, grille, dims);
  _majStatut('dessus', grille ? '✓' : '…');
}

/** Panneau 7 : placeholder voxel 3D. */
export function placeholderVoxel(message = 'Phase 2') {
  _ecrireTexte(_canvases.voxel, message);
}

/** Panneau 7 : retourne le canvas voxel pour y faire un rendu Three.js externe. */
export function getVoxelCanvas() {
  return _canvases.voxel ?? null;
}

/** Panneau 7 : marque le panneau voxel comme actif (retire le style placeholder). */
export function activerVoxel() {
  const cellule = _canvases.voxel?.closest('.dv-cellule');
  if (cellule) {
    cellule.classList.remove('dv-placeholder');
    const ph = cellule.querySelector('.dv-ph-msg');
    if (ph) ph.remove();
  }
  _majStatut('voxel', '✓');
}

/** Panneau 8 : affiche un résumé stats/pouvoirs dans le panneau validation. */
export function updateValidation(stats, powers) {
  const canvas = _canvases.validation;
  if (!canvas) return;

  const cellule = canvas.closest('.dv-cellule');
  if (cellule) {
    cellule.classList.remove('dv-placeholder');
    const ph = cellule.querySelector('.dv-ph-msg');
    if (ph) ph.remove();
  }

  const w = 200, h = 150;
  canvas.width  = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0f0f23';
  ctx.fillRect(0, 0, w, h);

  const lignes = [
    { label: 'Vitesse',  val: stats.speed.toFixed(1),  couleur: '#e62020' },
    { label: 'Adhérence',val: stats.grip.toFixed(1),   couleur: '#1fa830' },
    { label: 'Accél.',   val: stats.accel.toFixed(1),  couleur: '#1a52e0' },
  ];
  const maxVals = [69, 39.4, 53.2];

  ctx.font = 'bold 11px monospace';
  lignes.forEach((l, i) => {
    const y = 18 + i * 22;
    ctx.fillStyle = '#aaa';
    ctx.fillText(l.label, 4, y);
    const barW = Math.round(((parseFloat(l.val) / maxVals[i]) * (w - 80)));
    ctx.fillStyle = l.couleur;
    ctx.fillRect(70, y - 12, barW, 14);
    ctx.fillStyle = '#fff';
    ctx.fillText(l.val, w - 34, y);
  });

  _majStatut('validation', '✓');
}

/** Panneau 8 : placeholder validation. */
export function placeholderValidation(message = 'Phase 2') {
  _ecrireTexte(_canvases.validation, message);
}

// --- Utilitaires internes ---

// Dessine un ImageData sur un canvas miniature (adapté à la taille du canvas)
function _drawImageData(canvas, imageData) {
  if (!canvas || !imageData) return;
  // Taille cible basée sur le CSS (la cellule fait ~200px de large)
  canvas.width  = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
}

// Dessine une grille de couleurs en superposition sur l'image
function _drawGrille(canvas, imageData, grille, dims) {
  if (!canvas) return;
  _drawImageData(canvas, imageData);
  if (!grille || !dims) return;

  const ctx   = canvas.getContext('2d');
  const cellW = imageData.width  / dims.cols;
  const cellH = imageData.height / dims.rows;

  for (let c = 0; c < dims.cols; c++) {
    for (let r = 0; r < dims.rows; r++) {
      const couleur = grille[c]?.[r];
      if (!couleur) continue;
      ctx.fillStyle = COLOR_CSS[couleur] + '99'; // semi-transparent
      ctx.fillRect(c * cellW + 1, r * cellH + 1, cellW - 2, cellH - 2);
    }
  }
}

// Écrit un texte centré (panneaux placeholder)
function _ecrireTexte(canvas, texte) {
  if (!canvas) return;
  canvas.width  = 120;
  canvas.height = 80;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(texte, canvas.width / 2, canvas.height / 2 + 4);
}

// Met à jour le statut visible dans la cellule
function _majStatut(id, statut) {
  const cellule = document.querySelector(`.dv-cellule[data-id="${id}"]`);
  if (!cellule) return;
  let badge = cellule.querySelector('.dv-statut');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'dv-statut';
    cellule.querySelector('.dv-label').appendChild(badge);
  }
  badge.textContent = ' ' + statut;
  badge.style.color = statut === '✓' ? '#2ecc71' : '#f5a623';
}
