// Inputs de pilotage du véhicule — clavier et tactile (multi-touch).
//
// Sortie : objet réactif { steering: -1..1, braking: 0..1, reversing: 0..1 }
//   steering  > 0 = virage à droite, < 0 = à gauche
//   braking   = 1 = frein, 0 = roue libre
//   reversing = 1 = marche arrière
//
// Zones tactiles (sur la largeur de l'élément cible) :
//   tiers gauche        → steering -1
//   tiers droit         → steering +1
//   bas centre gauche   → braking  1
//   bas centre droit    → reversing 1
//   (multi-touch : combinaisons possibles)

const _état = { steering: 0, braking: 0, reversing: 0 };

// État des boutons HTML optionnels (id="btn-ctrl-frein" / id="btn-ctrl-reculer")
const _boutons = { braking: 0, reversing: 0 };

// Touches clavier actuellement pressées
const _touches = new Set();

// Pointeurs tactiles actifs : Map<pointerId, { x, y, zone }>
const _pointeurs = new Map();

let _cible = null; // élément DOM sur lequel écouter le tactile

/**
 * Attache les listeners sur l'élément cible (canvas de jeu).
 * @param {HTMLElement} el
 */
export function init(el) {
  _cible = el;
  el.style.touchAction = 'none'; // empêche pinch-zoom et scroll

  el.addEventListener('pointerdown',   _onPointerDown);
  el.addEventListener('pointermove',   _onPointerMove);
  el.addEventListener('pointerup',     _onPointerUp);
  el.addEventListener('pointercancel', _onPointerUp);

  window.addEventListener('keydown', _onKeyDown);
  window.addEventListener('keyup',   _onKeyUp);

  // Boutons HTML optionnels — branchés si présents dans le DOM
  _brancher('btn-ctrl-frein',   'braking');
  _brancher('btn-ctrl-reculer', 'reversing');
}

// Branche les événements pointerdown/up/cancel sur un bouton HTML optionnel
function _brancher(id, champ) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.addEventListener('pointerdown',   () => { _boutons[champ] = 1; _recalculer(); });
  btn.addEventListener('pointerup',     () => { _boutons[champ] = 0; _recalculer(); });
  btn.addEventListener('pointercancel', () => { _boutons[champ] = 0; _recalculer(); });
  btn.addEventListener('contextmenu', e => e.preventDefault()); // évite menu long-press
}

/**
 * Détache tous les listeners.
 */
export function destroy() {
  if (_cible) {
    _cible.removeEventListener('pointerdown',   _onPointerDown);
    _cible.removeEventListener('pointermove',   _onPointerMove);
    _cible.removeEventListener('pointerup',     _onPointerUp);
    _cible.removeEventListener('pointercancel', _onPointerUp);
    _cible = null;
  }
  window.removeEventListener('keydown', _onKeyDown);
  window.removeEventListener('keyup',   _onKeyUp);
  _pointeurs.clear();
  _touches.clear();
  _recalculer();
}

/**
 * Retourne l'état courant des inputs.
 * @returns {{ steering: number, braking: number }}
 */
export function getInputs() {
  return { ..._état };
}

// ---- Tactile ----

function _zone(el, x, y) {
  const rect = el.getBoundingClientRect();
  const rx = (x - rect.left) / rect.width;
  const ry = (y - rect.top)  / rect.height;
  if (rx < 0.33)                              return 'gauche';
  if (rx > 0.67)                              return 'droite';
  if (ry > 0.65 && rx >= 0.33 && rx < 0.50)  return 'frein';
  if (ry > 0.65 && rx >= 0.50 && rx <= 0.67) return 'reculer';
  return 'centre';
}

function _onPointerDown(e) {
  e.preventDefault();
  _cible.setPointerCapture(e.pointerId);
  _pointeurs.set(e.pointerId, { zone: _zone(_cible, e.clientX, e.clientY) });
  _recalculer();
}

function _onPointerMove(e) {
  if (!_pointeurs.has(e.pointerId)) return;
  _pointeurs.set(e.pointerId, { zone: _zone(_cible, e.clientX, e.clientY) });
  _recalculer();
}

function _onPointerUp(e) {
  _pointeurs.delete(e.pointerId);
  _recalculer();
}

// ---- Clavier ----

const TOUCHES_DROITE   = new Set(['ArrowRight', 'd', 'D']);
const TOUCHES_GAUCHE   = new Set(['ArrowLeft',  'a', 'A']);
const TOUCHES_FREIN    = new Set(['ArrowDown',  's', 'S']);
const TOUCHES_RECULER  = new Set(['r', 'R']);

function _onKeyDown(e) {
  if (TOUCHES_DROITE.has(e.key) || TOUCHES_GAUCHE.has(e.key)
      || TOUCHES_FREIN.has(e.key) || TOUCHES_RECULER.has(e.key)) {
    e.preventDefault();
    _touches.add(e.key);
    _recalculer();
  }
}

function _onKeyUp(e) {
  _touches.delete(e.key);
  _recalculer();
}

// ---- Calcul de l'état combiné ----

function _recalculer() {
  let steering  = 0;
  let braking   = 0;
  let reversing = 0;

  // Clavier (dernière touche pressée pour gauche/droite)
  for (const k of _touches) {
    if (TOUCHES_DROITE.has(k))  steering  =  1;
    if (TOUCHES_GAUCHE.has(k))  steering  = -1;
    if (TOUCHES_FREIN.has(k))   braking   =  1;
    if (TOUCHES_RECULER.has(k)) reversing =  1;
  }

  // Tactile — multi-touch : les zones s'accumulent
  for (const { zone } of _pointeurs.values()) {
    if (zone === 'droite')  steering  =  1;
    if (zone === 'gauche')  steering  = -1;
    if (zone === 'frein')   braking   =  1;
    if (zone === 'reculer') reversing =  1;
  }

  // Boutons HTML optionnels
  if (_boutons.braking)   braking   = 1;
  if (_boutons.reversing) reversing = 1;

  _état.steering  = steering;
  _état.braking   = braking;
  _état.reversing = reversing;
}
