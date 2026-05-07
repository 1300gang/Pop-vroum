// Outil de réglage manuel des cibles HSL par couleur.
// Permet d'ajuster la classification si la calibration auto échoue,
// et sert de support pédagogique sur la perception des couleurs (daltonisme).
//
// API :
//   init(containerEl, ciblesInitiales, onChangeCb)  — injecte l'UI dans containerEl
//   reset(ciblesHSL)                                — recharge les valeurs
//   getCibles()                                     — retourne les cibles actuelles

const COULEURS = ['red', 'green', 'blue', 'orange', 'violet', 'pink'];
const LABELS   = {
  red: 'Rouge', green: 'Vert', blue: 'Bleu',
  orange: 'Orange', violet: 'Violet', pink: 'Rose',
};
// Couleurs CSS de référence pour l'aperçu (indépendant des sliders)
const CSS_REF = {
  red: '#EF4444', green: '#22C55E', blue: '#3B82F6',
  orange: '#F97316', violet: '#A855F7', pink: '#EC4899',
};

let _cibles    = {};   // état courant { [nom]: { h, s, l } }
let _onChange  = null; // callback appelé à chaque modification
let _container = null;
let _debounce  = null;

/**
 * Initialise et injecte l'UI des sliders dans containerEl.
 * @param {HTMLElement} containerEl
 * @param {{ [nom]: { h, s, l } }} ciblesInitiales
 * @param {(cibles: object) => void} onChangeCb — appelé après chaque réglage
 */
export function init(containerEl, ciblesInitiales, onChangeCb) {
  _container = containerEl;
  _onChange  = onChangeCb;
  _cibles    = _cloner(ciblesInitiales);

  _container.innerHTML = _renderHTML();
  _attacherEvenements();
}

/**
 * Recharge les sliders avec de nouvelles valeurs (ex. après calibration auto).
 * @param {{ [nom]: { h, s, l } }} ciblesHSL
 */
export function reset(ciblesHSL) {
  _cibles = _cloner(ciblesHSL);
  if (_container) {
    _majSliders();
  }
}

/**
 * Retourne les cibles HSL actuellement réglées.
 * @returns {{ [nom]: { h, s, l } }}
 */
export function getCibles() {
  return _cloner(_cibles);
}

// --- Génération HTML ---

function _renderHTML() {
  const lignes = COULEURS.map(nom => {
    const c = _cibles[nom] || { h: 0, s: 0.5, l: 0.5 };
    const hslStr = `hsl(${Math.round(c.h)},${Math.round(c.s * 100)}%,${Math.round(c.l * 100)}%)`;

    return `
    <div class="tuner-ligne" data-couleur="${nom}">
      <div class="tuner-header">
        <span class="tuner-ref" style="background:${CSS_REF[nom]}"></span>
        <span class="tuner-preview" data-preview="${nom}" style="background:${hslStr}"></span>
        <span class="tuner-nom">${LABELS[nom]}</span>
        <span class="tuner-valeurs" data-valeurs="${nom}">
          H=${Math.round(c.h)}° S=${Math.round(c.s * 100)}% L=${Math.round(c.l * 100)}%
        </span>
      </div>
      <div class="tuner-sliders">
        <label>H
          <input type="range" data-nom="${nom}" data-comp="h"
                 min="0" max="360" step="1" value="${Math.round(c.h)}">
        </label>
        <label>S
          <input type="range" data-nom="${nom}" data-comp="s"
                 min="0" max="100" step="1" value="${Math.round(c.s * 100)}">
        </label>
        <label>L
          <input type="range" data-nom="${nom}" data-comp="l"
                 min="0" max="100" step="1" value="${Math.round(c.l * 100)}">
        </label>
      </div>
    </div>`;
  }).join('');

  return `
  <div class="tuner-toolbar">
    <button id="tuner-btn-reset">↺ Réinitialiser (calibration auto)</button>
    <small class="tuner-note">Réglage fin pour l'éclairage ou le daltonisme</small>
  </div>
  <div class="tuner-grille">${lignes}</div>`;
}

// --- Événements ---

function _attacherEvenements() {
  _container.querySelectorAll('input[type="range"]').forEach(input => {
    input.addEventListener('input', _onSliderChange);
  });

  const btnReset = _container.querySelector('#tuner-btn-reset');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      if (_onChange) {
        // Signale au parent de re-passer les cibles calibrées
        _onChange(null, true); // true = demande de reset
      }
    });
  }
}

function _onSliderChange(e) {
  const nom  = e.target.dataset.nom;
  const comp = e.target.dataset.comp;
  const val  = parseInt(e.target.value, 10);

  // Mettre à jour la cible
  if (!_cibles[nom]) _cibles[nom] = { h: 0, s: 0.5, l: 0.5 };
  _cibles[nom][comp] = (comp === 'h') ? val : val / 100;

  // Mise à jour aperçu instantanée (< 16ms)
  const c = _cibles[nom];
  const hslStr = `hsl(${Math.round(c.h)},${Math.round(c.s * 100)}%,${Math.round(c.l * 100)}%)`;

  const preview = _container.querySelector(`[data-preview="${nom}"]`);
  if (preview) preview.style.background = hslStr;

  const valeursEl = _container.querySelector(`[data-valeurs="${nom}"]`);
  if (valeursEl) {
    valeursEl.textContent = `H=${Math.round(c.h)}° S=${Math.round(c.s * 100)}% L=${Math.round(c.l * 100)}%`;
  }

  // Déclencher le callback avec debounce (< 200ms)
  clearTimeout(_debounce);
  _debounce = setTimeout(() => {
    if (_onChange) _onChange(_cloner(_cibles), false);
  }, 120);
}

// Recharge les valeurs des sliders depuis _cibles (sans re-rendre le HTML)
function _majSliders() {
  COULEURS.forEach(nom => {
    const c = _cibles[nom];
    if (!c) return;

    const hRange = _container.querySelector(`input[data-nom="${nom}"][data-comp="h"]`);
    const sRange = _container.querySelector(`input[data-nom="${nom}"][data-comp="s"]`);
    const lRange = _container.querySelector(`input[data-nom="${nom}"][data-comp="l"]`);
    if (hRange) hRange.value = Math.round(c.h);
    if (sRange) sRange.value = Math.round(c.s * 100);
    if (lRange) lRange.value = Math.round(c.l * 100);

    const hslStr = `hsl(${Math.round(c.h)},${Math.round(c.s * 100)}%,${Math.round(c.l * 100)}%)`;
    const preview = _container.querySelector(`[data-preview="${nom}"]`);
    if (preview) preview.style.background = hslStr;

    const valeursEl = _container.querySelector(`[data-valeurs="${nom}"]`);
    if (valeursEl) {
      valeursEl.textContent = `H=${Math.round(c.h)}° S=${Math.round(c.s * 100)}% L=${Math.round(c.l * 100)}%`;
    }
  });
}

function _cloner(obj) {
  return JSON.parse(JSON.stringify(obj));
}
