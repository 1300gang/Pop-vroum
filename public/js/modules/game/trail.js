// Trace de trajectoire — ruban qui suit le passage du véhicule, hauteur comprise.
//
// Sert à lire les trajectoires de saut : la portion au sol et la portion en vol
// sont de deux couleurs, donc la parabole se voit d'un coup d'œil.
//
// Contrat I/O :
//   init(scene, maxPoints?)
//   push({ x, y, z }, airborne)   — à appeler chaque frame
//   clear()                       — vide la trace (nouvelle tentative)
//   dispose()

import * as THREE from '../../lib/three.module.js';

const COULEUR_SOL = [0.35, 0.85, 0.55];  // vert : roues au sol
const COULEUR_VOL = [1.00, 0.72, 0.20];  // orange : en l'air

let _ligne     = null;
let _positions = null;
let _couleurs  = null;
let _max       = 0;
let _nb        = 0;
let _scene     = null;

export function init(scene, maxPoints = 1500) {
  dispose();

  _scene     = scene;
  _max       = maxPoints;
  _nb        = 0;
  _positions = new Float32Array(_max * 3);
  _couleurs  = new Float32Array(_max * 3);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(_positions, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(_couleurs, 3));
  geo.setDrawRange(0, 0);

  _ligne = new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true }));
  _ligne.frustumCulled = false;   // la trace dépasse souvent le champ de la caméra
  scene.add(_ligne);
}

/**
 * Ajoute un point à la trace.
 * @param {{ x: number, y: number, z: number }} position
 * @param {boolean} airborne — colore le segment en orange si le véhicule vole
 */
export function push(position, airborne) {
  if (!_ligne) return;

  // Buffer plein : on décale d'un point (fenêtre glissante)
  if (_nb >= _max) {
    _positions.copyWithin(0, 3);
    _couleurs.copyWithin(0, 3);
    _nb = _max - 1;
  }

  const i = _nb * 3;
  _positions[i]     = position.x;
  _positions[i + 1] = position.y;
  _positions[i + 2] = position.z;

  const c = airborne ? COULEUR_VOL : COULEUR_SOL;
  _couleurs[i]     = c[0];
  _couleurs[i + 1] = c[1];
  _couleurs[i + 2] = c[2];

  _nb++;
  _ligne.geometry.setDrawRange(0, _nb);
  _ligne.geometry.attributes.position.needsUpdate = true;
  _ligne.geometry.attributes.color.needsUpdate    = true;
}

export function clear() {
  if (!_ligne) return;
  _nb = 0;
  _ligne.geometry.setDrawRange(0, 0);
}

export function setVisible(visible) {
  if (_ligne) _ligne.visible = visible;
}

export function dispose() {
  if (!_ligne) return;
  _scene?.remove(_ligne);
  _ligne.geometry.dispose();
  _ligne.material.dispose();
  _ligne     = null;
  _positions = null;
  _couleurs  = null;
  _nb        = 0;
}
