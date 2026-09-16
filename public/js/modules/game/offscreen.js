// Module game/offscreen — Story 5.6
//
// Flèches au bord de l'écran pour les coéquipier·ères hors du champ de vision.
// Overlay 2D DOM (SVG) — pas de Three.js dans les flèches elles-mêmes.
//
// API :
//   init(camera, containerEl)            — caméra Three.js + élément DOM parent
//   update(players)                      — met à jour positions et visibilité
//   dispose()                            — supprime les éléments DOM
//
// players : Array<{ id: string, position: {x, z}, color?: string }>
//
// La flèche d'un joueur est visible uniquement si sa position projetée est
// hors de l'espace NDC [-1, 1] (c'est-à-dire hors de la fenêtre rendue).

import * as THREE from '../../lib/three.module.js';

const MARGIN = 40;  // pixels depuis le bord intérieur
const TAILLE = 24;  // taille de la flèche SVG en pixels

let _camera    = null;
let _container = null;

// id joueur → élément div contenant la flèche SVG
const _arrows = new Map();

// Vecteur réutilisé pour éviter les allocations dans update()
const _vec = new THREE.Vector3();

/**
 * Initialise le module.
 * @param {THREE.Camera} camera — caméra Three.js active
 * @param {HTMLElement} containerEl — élément plein-écran parent (position relative)
 */
export function init(camera, containerEl) {
  _camera    = camera;
  _container = containerEl;
}

/**
 * Met à jour les flèches hors-écran à chaque frame.
 * @param {Array<{id: string, position: {x, z}, color?: string}>} players
 */
export function update(players) {
  if (!_camera || !_container) return;

  const cw = _container.clientWidth;
  const ch = _container.clientHeight;

  const usedIds = new Set();

  for (const p of players) {
    usedIds.add(p.id);

    // Projeter la position monde (plan XZ, hauteur 0.4) en NDC
    _vec.set(p.position.x, 0.4, p.position.z);
    _vec.project(_camera);

    // NDC [-1,1] → pixels écran
    const sx = (_vec.x + 1) / 2 * cw;
    const sy = (-_vec.y + 1) / 2 * ch;

    // Hors-champ si coordonnée pixel hors écran ou plan de clip dépassé
    const horsChamp = sx < 0 || sx > cw || sy < 0 || sy > ch || _vec.z > 1;

    if (!horsChamp) {
      if (_arrows.has(p.id)) _arrows.get(p.id).style.display = 'none';
      continue;
    }

    // Créer la flèche si elle n'existe pas encore
    let arrow = _arrows.get(p.id);
    if (!arrow) {
      arrow = _creerFleche(p.color ?? '#ffffff');
      _container.appendChild(arrow);
      _arrows.set(p.id, arrow);
    }
    arrow.style.display = 'block';

    // Angle depuis le centre de l'écran vers la position projetée
    const cx    = cw / 2;
    const cy    = ch / 2;
    const angle = Math.atan2(sy - cy, sx - cx);

    // Point sur le bord de la zone sûre (rectangle MARGIN)
    const cosA  = Math.cos(angle);
    const sinA  = Math.sin(angle);
    const halfW = cx - MARGIN;
    const halfH = cy - MARGIN;
    // Facteur d'échelle pour atteindre exactement un bord
    const scX   = halfW / (Math.abs(cosA) || 1e-4);
    const scY   = halfH / (Math.abs(sinA) || 1e-4);
    const sc    = Math.min(scX, scY);
    const ex    = cx + cosA * sc;
    const ey    = cy + sinA * sc;

    // Positionner + orienter la flèche (centrage par rapport au centre du SVG)
    arrow.style.left      = (ex - TAILLE / 2) + 'px';
    arrow.style.top       = (ey - TAILLE / 2) + 'px';
    arrow.style.transform = `rotate(${angle}rad)`;
  }

  // Masquer les flèches des joueurs absents de la liste courante
  for (const [id, arrow] of _arrows) {
    if (!usedIds.has(id)) arrow.style.display = 'none';
  }
}

/**
 * Supprime tous les éléments DOM créés.
 */
export function dispose() {
  for (const arrow of _arrows.values()) {
    _container?.removeChild(arrow);
  }
  _arrows.clear();
  _camera    = null;
  _container = null;
}

// ---- Helpers internes ----

function _creerFleche(color) {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:absolute',
    `width:${TAILLE}px`,
    `height:${TAILLE}px`,
    'display:none',
    'pointer-events:none',
    'z-index:100',
  ].join(';');

  // Triangle SVG pointant vers la droite (angle 0 = est) — rotation CSS oriente ensuite
  el.innerHTML = `<svg width="${TAILLE}" height="${TAILLE}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <polygon points="4,4 20,12 4,20" fill="${_escapeSVGColor(color)}" opacity="0.9"/>
  </svg>`;

  return el;
}

// Échappe les caractères dangereux dans une valeur SVG inline (protège contre l'injection)
function _escapeSVGColor(color) {
  if (typeof color !== 'string') return '#ffffff';
  // Accepte seulement #rrggbb, #rgb, et noms CSS simples (sans guillemets ni chevrons)
  return color.replace(/[^a-zA-Z0-9#]/g, '');
}
