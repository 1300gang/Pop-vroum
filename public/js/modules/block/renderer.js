// Module block/renderer — Story 6.1
//
// Gère le rendu Three.js d'un bloc map dans un canvas donné.
// Utilisé par l'aperçu 3D de l'éditeur (Story 6.2) et la vue jeu.
//
// Entrée  : canvas HTMLCanvasElement + blockData JSON optionnel
// Sortie  : contrôleur { setBlock, resize, setAutoRotate, dispose }

import * as THREE from '../../lib/three.module.js';
import { buildBlock } from './builder.js';

const BLOCK_SIZE = 8; // cases par côté

// Paramètres de la caméra orbitale
const CAM_RAYON    = 18;
const CAM_ELEVATION = Math.PI / 4; // 45° de hauteur

/**
 * Crée un rendu Three.js d'un bloc dans le canvas fourni.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object|null}       blockData — JSON bloc initial (optionnel)
 * @returns {{ setBlock, resize, setAutoRotate, dispose }}
 */
export function createBlockRenderer(canvas, blockData = null) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  // ---- Éclairage ----
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
  dirLight.position.set(6, 12, 8);
  scene.add(dirLight);

  // ---- Caméra ----
  const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  let _angleOrbite = Math.PI / 4; // départ : vue de 3/4
  _mettreAJourCamera();

  // ---- Groupe courant ----
  let _groupe = null;
  let _autoRotate = false;
  let _animId = null;

  // ---- Boucle ----
  function _loop() {
    _animId = requestAnimationFrame(_loop);
    if (_autoRotate) {
      _angleOrbite += 0.006;
      _mettreAJourCamera();
    }
    renderer.render(scene, cam);
  }
  _loop();

  // Charge un bloc si fourni d'emblée
  if (blockData) _charger(blockData);

  // ---- API ----

  /**
   * Remplace le bloc affiché.
   * @param {object|null} bd — JSON bloc, ou null pour vider
   */
  function setBlock(bd) {
    if (_groupe) {
      scene.remove(_groupe);
      _groupe = null;
    }
    if (bd) _charger(bd);
  }

  /** Adapte le renderer à la taille courante du canvas. */
  function resize() {
    const w = canvas.clientWidth  || 300;
    const h = canvas.clientHeight || 300;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  }

  /** Active ou désactive la rotation automatique. */
  function setAutoRotate(actif) {
    _autoRotate = !!actif;
  }

  /** Libère le renderer WebGL. */
  function dispose() {
    cancelAnimationFrame(_animId);
    renderer.dispose();
  }

  return { setBlock, resize, setAutoRotate, dispose };

  // ---- Helpers privés ----

  function _charger(bd) {
    const { group } = buildBlock(bd);
    // Centrer le bloc 8×8 à l'origine
    group.position.set(-BLOCK_SIZE / 2, 0, -BLOCK_SIZE / 2);
    scene.add(group);
    _groupe = group;
  }

  function _mettreAJourCamera() {
    cam.position.set(
      Math.sin(_angleOrbite) * CAM_RAYON,
      Math.sin(CAM_ELEVATION) * CAM_RAYON,
      Math.cos(_angleOrbite) * CAM_RAYON,
    );
    cam.lookAt(0, 0, 0);
  }
}
