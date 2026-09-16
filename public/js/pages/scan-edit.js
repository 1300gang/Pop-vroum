// Page scan-edit — RACE-G01 à G07
// Retouche non-destructive du véhicule scanné.
// UX : palette d'outil persistante + peinture par clic/glisser.

import { buildVehicleGroup, createPreviewScene } from '../modules/voxel/renderer.js';

// ---- Clé localStorage (cohérente avec scan-page-v2.js) ----
const LS_KEY = 'pop-vroum:vehicule-courant';

// ---- Palette couleurs ----
const COULEURS = [
  { id: 'red',    hex: '#e62020', fr: 'Rouge'  },
  { id: 'green',  hex: '#1fa830', fr: 'Vert'   },
  { id: 'blue',   hex: '#1a52e0', fr: 'Bleu'   },
  { id: 'orange', hex: '#f07418', fr: 'Orange' },
  { id: 'violet', hex: '#7d2dc0', fr: 'Violet' },
  { id: 'pink',   hex: '#e882b9', fr: 'Rose'   },
];

// Raccourcis clavier : 1-6 pour les couleurs, 0 pour la gomme
const RACCOURCIS = ['1', '2', '3', '4', '5', '6'];

// Labels des 4 tranches Y
const LABELS_Y = ['Dessous', 'Milieu bas', 'Milieu haut', 'Dessus'];

// ---- État de l'éditeur (accessible en module-level export) ----
export const editState = {
  original: null,   // grid[x][z][y] — jamais muté
  edited:   null,   // copie de travail
  dirty:    false,
  vehicle:  null,   // objet complet chargé depuis localStorage
};

// ---- Outil actif ---- (null = gomme, sinon id couleur)
let _outilActif = null;

// ---- État du glisser-peindre ----
let _enTrainDePeindre = false;

// ---- Aperçu 3D ----
let _preview3d = null;

// ---- Point d'entrée ----
document.addEventListener('DOMContentLoaded', init);

function init() {
  _chargerDepuisLocalStorage();
  _initRaccourcisClavier();
}

// ---- Chargement ----

function _chargerDepuisLocalStorage() {
  const raw = localStorage.getItem(LS_KEY);

  if (!raw) {
    _afficherEtatVide();
    return;
  }

  let vehicle;
  try { vehicle = JSON.parse(raw); } catch (_) {
    _afficherEtatVide('Données corrompues dans localStorage.');
    return;
  }

  if (!vehicle?.grid) {
    _afficherEtatVide('Le véhicule sauvegardé ne contient pas de grille voxel.');
    return;
  }

  editState.original = vehicle.grid;
  editState.edited   = _copierGrille(vehicle.grid);
  editState.dirty    = false;
  editState.vehicle  = vehicle;

  _afficherZonePrincipale(vehicle);
}

function _copierGrille(grid) {
  return grid.map(planX =>
    planX.map(planZ =>
      planZ.map(voxel => voxel ? { ...voxel } : null)
    )
  );
}

// ---- État vide ----

function _afficherEtatVide(msg) {
  document.getElementById('etat-vide').classList.add('visible');
  if (msg) document.querySelector('#etat-vide p').textContent = msg;
  document.getElementById('btn-aller-scanner')
    .addEventListener('click', () => { window.location.href = '/scan2.html'; });
}

// ---- Affichage principal ----

function _afficherZonePrincipale(vehicle) {
  document.getElementById('etat-vide').classList.remove('visible');
  document.getElementById('zone-principale').classList.add('visible');
  document.getElementById('barre-palette').classList.add('visible');

  if (vehicle.playerName) {
    document.getElementById('entete-pseudo').textContent = vehicle.playerName;
  }

  _construirePalette();
  _construireVues2D();
  _initApercu3D();
  _rafraichirApercu3D();

  document.getElementById('btn-valider').addEventListener('click', _valider);
  document.getElementById('btn-annuler').addEventListener('click', () => {
    window.location.href = '/scan2.html';
  });

  // Stoppe le glisser si le pointeur sort de la fenêtre
  window.addEventListener('pointerup', () => { _enTrainDePeindre = false; });
}

// ---- Palette d'outil ----

function _construirePalette() {
  const barre    = document.getElementById('barre-palette');
  const gomme    = document.getElementById('outil-gomme');
  const labelEl  = document.getElementById('palette-label');

  // Insérer les boutons couleur avant la gomme
  COULEURS.forEach((c, i) => {
    const btn = document.createElement('button');
    btn.className   = 'outil-btn';
    btn.style.background = c.hex;
    btn.title       = `${c.fr} (${RACCOURCIS[i]})`;
    btn.dataset.outil = c.id;
    btn.innerHTML   = `<span class="raccourci">${RACCOURCIS[i]}</span>`;
    btn.addEventListener('click', () => _selectionnerOutil(c.id));
    barre.insertBefore(btn, gomme);
  });

  gomme.addEventListener('click', () => _selectionnerOutil(null));
  // Gomme active par défaut
  _selectionnerOutil(null);
}

function _selectionnerOutil(outilId) {
  _outilActif = outilId;

  // Mettre à jour l'état visuel des boutons
  document.querySelectorAll('.outil-btn').forEach(btn => {
    btn.classList.toggle('actif', btn.dataset.outil === (outilId ?? '__gomme__'));
  });
  document.getElementById('outil-gomme').classList.toggle('actif', outilId === null);

  // Mettre à jour le curseur de toutes les cellules selon l'outil
  const curseur = outilId === null ? 'cell' : 'crosshair';
  document.querySelectorAll('.cellule-voxel').forEach(el => {
    el.style.cursor = curseur;
  });
}

// ---- Vues 2D ----

function _construireVues2D() {
  const panneau = document.getElementById('panneau-vues');
  panneau.innerHTML = '';

  for (let y = 0; y < 4; y++) {
    const section = document.createElement('div');
    section.className = 'vue-tranche';

    const titre = document.createElement('div');
    titre.className = 'vue-tranche-titre';
    titre.innerHTML = `<span class="vue-index">${y}</span>${LABELS_Y[y]} <span style="opacity:.4;font-weight:400">(y=${y})</span>`;
    section.appendChild(titre);

    const grille = document.createElement('div');
    grille.className  = 'grille-voxels';
    grille.dataset.trancheY = y;

    // 4 lignes z × 8 colonnes x
    for (let z = 0; z < 4; z++) {
      for (let x = 0; x < 8; x++) {
        grille.appendChild(_creerCellule(x, z, y));
      }
    }

    // Glisser-peindre : pointer events sur la grille entière
    grille.addEventListener('pointerdown', (e) => {
      const cell = e.target.closest('.cellule-voxel');
      if (!cell) return;
      e.preventDefault();
      grille.setPointerCapture(e.pointerId);
      _enTrainDePeindre = true;
      _peindre(cell);
    });

    grille.addEventListener('pointermove', (e) => {
      if (!_enTrainDePeindre) return;
      // Trouver la cellule sous le pointeur (elementFromPoint car pointer capturé)
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const cell = el?.closest('.cellule-voxel');
      if (cell && cell.closest('.grille-voxels') === grille) _peindre(cell);
    });

    grille.addEventListener('pointerup', () => { _enTrainDePeindre = false; });

    section.appendChild(grille);
    panneau.appendChild(section);
  }
}

function _creerCellule(x, z, y) {
  const div = document.createElement('div');
  div.className    = 'cellule-voxel';
  div.dataset.x    = x;
  div.dataset.z    = z;
  div.dataset.y    = y;
  _renderCellule(div, x, z, y);
  return div;
}

function _renderCellule(div, x, z, y) {
  const voxel = editState.edited?.[x]?.[z]?.[y];
  if (voxel?.color) {
    const def = COULEURS.find(c => c.id === voxel.color);
    div.classList.replace('vide', 'pleine') || div.classList.add('pleine');
    div.style.background = def?.hex ?? '#888';
    div.title = def?.fr ?? voxel.color;
  } else {
    div.classList.replace('pleine', 'vide') || div.classList.add('vide');
    div.style.background = '';
    div.title = 'Vide';
  }
}

// ---- Peinture d'une cellule ----

function _peindre(cell) {
  const x = +cell.dataset.x;
  const z = +cell.dataset.z;
  const y = +cell.dataset.y;

  const avant = editState.edited[x][z][y];

  // Ne rien faire si déjà identique (évite les re-renders inutiles pendant le glisser)
  if (_outilActif === null && avant === null) return;
  if (_outilActif !== null && avant?.color === _outilActif) return;

  editState.edited[x][z][y] = _outilActif !== null ? { color: _outilActif } : null;
  editState.dirty = true;

  _renderCellule(cell, x, z, y);
  document.getElementById('badge-modifie').classList.add('visible');

  // Rafraîchissement 3D différé pour ne pas bloquer le glisser
  _planifierRafraichi3D();
}

// ---- Rafraîchissement 3D (debounce 80ms) ----

let _timerRafraichi = null;

function _planifierRafraichi3D() {
  if (_timerRafraichi) clearTimeout(_timerRafraichi);
  _timerRafraichi = setTimeout(_rafraichirApercu3D, 80);
}

// ---- Aperçu 3D ----

function _initApercu3D() {
  const canvas = document.getElementById('canvas-apercu-3d');
  if (!canvas) return;
  // Dimensionner avant createPreviewScene pour éviter un canvas 0×0
  const rect = canvas.getBoundingClientRect();
  canvas.width  = rect.width  || 228;
  canvas.height = rect.height || 171;
  _preview3d = createPreviewScene(canvas);
}

function _rafraichirApercu3D() {
  if (!_preview3d || !editState.edited) return;
  const groupe = buildVehicleGroup({
    grid:           editState.edited,
    wheelPositions: editState.vehicle?.wheelPositions ?? [],
  });
  _preview3d.setGroup(groupe);
}

// ---- Raccourcis clavier ----

function _initRaccourcisClavier() {
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === '0') { _selectionnerOutil(null); return; }
    const idx = RACCOURCIS.indexOf(e.key);
    if (idx !== -1) _selectionnerOutil(COULEURS[idx].id);
  });
}

// ---- Validation ----

function _valider() {
  if (!editState.edited) return;

  if (!editState.dirty) {
    if (!confirm('Aucune retouche effectuée. Valider quand même ?')) return;
  }

  if (!_validerStructure(editState.edited)) {
    document.getElementById('msg-validation').textContent =
      'Erreur : grille invalide (attendu 8×4×4).';
    return;
  }

  if (!_validerCouleurs(editState.edited)) {
    document.getElementById('msg-validation').textContent =
      'Erreur : couleur inconnue dans la grille.';
    return;
  }

  localStorage.setItem(LS_KEY, JSON.stringify({
    ...editState.vehicle,
    grid: editState.edited,
  }));

  window.location.href = '/lobby.html';
}

function _validerStructure(grid) {
  if (!Array.isArray(grid) || grid.length !== 8) return false;
  return grid.every(px =>
    Array.isArray(px) && px.length === 4 &&
    px.every(pz => Array.isArray(pz) && pz.length === 4)
  );
}

function _validerCouleurs(grid) {
  const valides = new Set(COULEURS.map(c => c.id));
  return grid.every(px => px.every(pz =>
    pz.every(v => v === null || valides.has(v?.color))
  ));
}
