// Page éditeur de blocs map — Story 6.2
//
// Orchestre : palette, grille 8×8, aperçu 3D, export JSON, chargement JSON.

import {
  TAILLE, SYMBOLES,
  effacer, getGrille, poser, charger,
  validerJouabilite, telecharger, exporter, validerBloc,
} from '../modules/block/editor.js';
import { createBlockRenderer } from '../modules/block/renderer.js';

// ---- Éléments DOM ----

const elGrille      = document.getElementById('grille');
const elNom         = document.getElementById('inp-nom');
const elAtelier     = document.getElementById('inp-atelier');
const elMsgValid    = document.getElementById('msg-validation');
const elApercuPanel = document.getElementById('apercu-panel');
const elApercuCv    = document.getElementById('apercu-cv');
const elBtnApercu   = document.getElementById('btn-apercu');
const elDialogLoad  = document.getElementById('dialog-load');
const elTxtJson     = document.getElementById('txt-json');
const elErrJson     = document.getElementById('err-json');

// ---- État outil ----
// _outil : null (gomme) ou string parmi SYMBOLES
// _rotations : rotation courante par outil (0/90/180/270)
let _outil     = null;
let _rotations = { ramp: 0, sticky: 0, dur: 0, boost: 0 };
let _drag      = false;

// ---- Rendu 3D (créé à la demande) ----
let _renderer3D = null;

// ---- Icônes directionnelles ----
// Flèche de base par symbole, tournée par CSS selon la rotation

const ICONES = {
  ramp:   '↑',   // rampe : inclinaison vers le haut
  sticky: '●',   // collant : pas de direction
  dur:    '■',   // dur : pas de direction
  boost:  '▲',   // boost : direction de propulsion
};

// ---- Construction de la grille DOM ----

function _construireGrille() {
  elGrille.innerHTML = '';
  for (let row = 0; row < TAILLE; row++) {
    for (let col = 0; col < TAILLE; col++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = row;
      cell.dataset.col = col;
      // Span intérieur pour la rotation CSS de l'icône
      const ico = document.createElement('span');
      ico.className = 'cell-ico';
      cell.appendChild(ico);
      elGrille.appendChild(cell);
    }
  }
}

// ---- Rendu d'une cellule ----

function _rendreCellule(row, col) {
  const el  = elGrille.querySelector(`[data-row="${row}"][data-col="${col}"]`);
  if (!el) return;
  const grille = getGrille();
  const c      = grille[row][col]; // { v, r } | null
  const v      = c?.v ?? null;
  const r      = c?.r ?? 0;

  el.dataset.v = v ?? '';

  const ico = el.querySelector('.cell-ico');
  if (v && ICONES[v]) {
    ico.textContent          = ICONES[v];
    ico.style.transform      = r ? `rotate(${r}deg)` : '';
    // Les symboles symétriques n'ont pas besoin d'indiquer la rotation
    ico.style.opacity        = (v === 'sticky' || v === 'dur') ? '0.6' : '1';
  } else {
    ico.textContent     = '';
    ico.style.transform = '';
  }
}

function _rendreGrille() {
  for (let row = 0; row < TAILLE; row++) {
    for (let col = 0; col < TAILLE; col++) {
      _rendreCellule(row, col);
    }
  }
  _afficherValidation();
  _majApercu();
}

// ---- Validation ----

function _afficherValidation() {
  const { ok, entree, sortie } = validerJouabilite();
  const grille = getGrille();

  for (let col = 0; col < TAILLE; col++) {
    const elE = elGrille.querySelector(`[data-row="0"][data-col="${col}"]`);
    const elS = elGrille.querySelector(`[data-row="${TAILLE-1}"][data-col="${col}"]`);
    const veE = _estPassable(grille[0][col]?.v);
    const veS = _estPassable(grille[TAILLE-1][col]?.v);
    if (elE) { elE.classList.toggle('entree-ok', veE); elE.classList.toggle('entree-ko', !veE); }
    if (elS) { elS.classList.toggle('sortie-ok', veS); elS.classList.toggle('sortie-ko', !veS); }
  }

  elMsgValid.innerHTML = ok
    ? '<span class="ok">✓ Bloc jouable</span>'
    : `<span class="warn">⚠ ${[!entree && 'entrée bloquée', !sortie && 'sortie bloquée'].filter(Boolean).join(', ')}</span>`;
}

function _estPassable(v) {
  return !v || v === 'ramp' || v === 'boost' || v === 'sticky';
}

// ---- Aperçu 3D ----

function _majApercu() {
  if (!_renderer3D) return;
  _renderer3D.setBlock({ id: 'preview', name: elNom.value || 'Aperçu', grid: getGrille() });
}

function _toggleApercu() {
  const visible = elApercuPanel.classList.toggle('visible');
  elBtnApercu.textContent = visible ? 'Masquer aperçu 3D' : 'Aperçu 3D';
  if (visible && !_renderer3D) {
    const w = elApercuCv.clientWidth  || elApercuPanel.clientWidth;
    const h = elApercuCv.clientHeight || elApercuPanel.clientHeight - 24;
    elApercuCv.width  = w;
    elApercuCv.height = h;
    _renderer3D = createBlockRenderer(elApercuCv);
    _renderer3D.resize();
    _renderer3D.setAutoRotate(true);
    _majApercu();
  }
}

// ---- Sélection et rotation d'outil ----

/**
 * Sélectionne un outil, ou si déjà actif, fait tourner sa rotation de 90°.
 * @param {string|null} symbole
 */
function _selectionnerOutil(symbole) {
  const memeOutil   = symbole === _outil;
  const estDirec    = symbole === 'ramp' || symbole === 'boost';

  if (memeOutil && estDirec && symbole !== null) {
    // Cycling de la rotation pour les symboles directionnels
    _rotations[symbole] = (_rotations[symbole] + 90) % 360;
  } else {
    _outil = symbole;
  }

  _majPalette();
}

function _majPalette() {
  document.querySelectorAll('.outil').forEach(el => {
    const s = el.dataset.symbole === 'null' ? null : el.dataset.symbole;
    const actif = s === _outil;
    el.classList.toggle('actif', actif);

    // Afficher la rotation dans le badge de l'outil actif
    const badge = el.querySelector('.outil-rot');
    if (badge) {
      const rot = s && _rotations[s] ? _rotations[s] + '°' : '';
      badge.textContent = rot;
    }

    // Orienter l'icône dans la palette
    const ico = el.querySelector('.outil-swatch-ico');
    if (ico && s && ICONES[s]) {
      const r = s ? (_rotations[s] ?? 0) : 0;
      ico.style.transform = r ? `rotate(${r}deg)` : '';
    }
  });
}

// ---- Interactions grille ----

function _rotationCourante() {
  return _outil ? (_rotations[_outil] ?? 0) : 0;
}

function _appliquerCase(row, col) {
  poser(row, col, _outil, _rotationCourante());
  _rendreCellule(row, col);
  _afficherValidation();
  _majApercu();
}

function _onDown(e) {
  const cell = e.target.closest('.cell');
  if (!cell) return;
  e.preventDefault();
  _drag = true;
  _appliquerCase(+cell.dataset.row, +cell.dataset.col);
}

function _onMove(e) {
  if (!_drag) return;
  e.preventDefault();
  const pt = e.touches ? e.touches[0] : e;
  const el = document.elementFromPoint(pt.clientX, pt.clientY)?.closest('.cell');
  if (el) _appliquerCase(+el.dataset.row, +el.dataset.col);
}

function _onUp() { _drag = false; }

// ---- Dialog chargement JSON ----

function _ouvrirDialogLoad() {
  elTxtJson.value = '';
  elErrJson.textContent = '';
  elDialogLoad.classList.add('visible');
  elTxtJson.focus();
}

function _fermerDialogLoad() {
  elDialogLoad.classList.remove('visible');
}

function _chargerDepuisJSON() {
  elErrJson.textContent = '';
  try {
    const obj = JSON.parse(elTxtJson.value);
    validerBloc(obj);
    charger(obj);
    if (obj.name)    elNom.value     = obj.name;
    if (obj.atelier) elAtelier.value = obj.atelier;
    _rendreGrille();
    _fermerDialogLoad();
  } catch (err) {
    elErrJson.textContent = err.message;
  }
}

// ---- Export ----

function _exporter() {
  const { ok } = validerJouabilite();
  if (!ok && !confirm('Ce bloc n\'est pas entièrement jouable. Exporter quand même ?')) return;
  const { filename } = telecharger({ nom: elNom.value.trim() || 'Bloc', atelier: elAtelier.value.trim() });
  elMsgValid.innerHTML = `<span class="ok">✓ Exporté : ${filename}</span>`;
}

// ---- Envoi au serveur (Story 6.4) ----

async function _envoyerAuServeur() {
  const { ok } = validerJouabilite();
  if (!ok && !confirm('Ce bloc n\'est pas entièrement jouable. Envoyer quand même ?')) return;

  const token = prompt('Token admin (laisser vide pour le token atelier par défaut) :', '');
  const adminToken = token?.trim() || 'popvroum-admin-v1';

  const meta = { nom: elNom.value.trim() || 'Bloc', atelier: elAtelier.value.trim() };
  const bloc = exporter(meta);

  elMsgValid.innerHTML = '<span class="info">Envoi en cours…</span>';

  try {
    const resp = await fetch('/admin/blocks', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken },
      body:    JSON.stringify(bloc),
    });
    const data = await resp.json();
    if (resp.ok) {
      elMsgValid.innerHTML = `<span class="ok">✓ Bloc "${bloc.id}" ajouté au pool du serveur</span>`;
    } else {
      elMsgValid.innerHTML = `<span class="ko">✗ Erreur ${resp.status} : ${data.error}</span>`;
    }
  } catch (err) {
    elMsgValid.innerHTML = `<span class="ko">✗ Serveur inaccessible : ${err.message}</span>`;
  }
}

// ---- Init ----

function init() {
  _construireGrille();
  _rendreGrille();
  _selectionnerOutil(null); // départ : gomme

  // Palette — clic sur outil
  document.querySelectorAll('.outil').forEach(el => {
    el.addEventListener('click', () => {
      const s = el.dataset.symbole === 'null' ? null : el.dataset.symbole;
      _selectionnerOutil(s);
    });
  });

  document.getElementById('btn-effacer').addEventListener('click', () => {
    if (confirm('Effacer toute la grille ?')) { effacer(); _rendreGrille(); }
  });

  // Grille — souris
  elGrille.addEventListener('mousedown', _onDown);
  window.addEventListener('mousemove',   _onMove);
  window.addEventListener('mouseup',     _onUp);

  // Grille — touch
  elGrille.addEventListener('touchstart', _onDown,  { passive: false });
  window.addEventListener('touchmove',   _onMove,  { passive: false });
  window.addEventListener('touchend',    _onUp);

  // Clic droit = gomme sur la case
  elGrille.addEventListener('contextmenu', e => {
    e.preventDefault();
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const prevOutil = _outil;
    _outil = null;
    _appliquerCase(+cell.dataset.row, +cell.dataset.col);
    _outil = prevOutil;
  });

  elBtnApercu.addEventListener('click', _toggleApercu);
  document.getElementById('btn-exporter').addEventListener('click', _exporter);
  document.getElementById('btn-envoyer').addEventListener('click', _envoyerAuServeur);
  document.getElementById('btn-charger').addEventListener('click', _ouvrirDialogLoad);
  document.getElementById('btn-dialog-annuler').addEventListener('click', _fermerDialogLoad);
  document.getElementById('btn-dialog-ok').addEventListener('click', _chargerDepuisJSON);
  elDialogLoad.addEventListener('click', e => { if (e.target === elDialogLoad) _fermerDialogLoad(); });
  elNom.addEventListener('input', _majApercu);
  window.addEventListener('resize', () => { _renderer3D?.resize(); });
}

init();
