// Effet visuel de cohésion — Story 7.5
//
// Affiche des lignes lumineuses entre les véhicules quand la cohésion est élevée.
// Chaque véhicule reçoit aussi une aura pulsante au sol.
//
// API :
//   init(scene)                              → prépare les ressources
//   update(vehiclePositions, cohesion, dt)   → met à jour l'effet chaque frame
//   dispose()                                → nettoie les ressources Three.js
//
// vehiclePositions : Array<{ x: number, z: number }>
// cohesion         : number [0..1]

import * as THREE from '../../lib/three.module.js';

// Seuil de cohésion à partir duquel les lignes commencent à apparaître
const SEUIL            = 0.65;
// Vitesse de pulsation (radians/s)
const PULSE_SPEED      = 2.5;
// Lerp de l'opacité (réactivité de l'apparition/disparition)
const LERP_OPACITY     = 0.04;
// Opacité max des lignes (subtil = 0.55)
const OPACITE_MAX_LIGNES = 0.55;
// Opacité max des auras (très subtil)
const OPACITE_MAX_AURAS  = 0.22;
// Rayon des auras en unités monde
const RAYON_AURA       = 3.2;
// Couleur des effets
const COULEUR_HEX      = 0x88ffff;

const MAX_VEHICULES = 5;
// Nombre max de paires = C(5,2) = 10 → 20 points = 60 composantes
const MAX_POINTS = MAX_VEHICULES * (MAX_VEHICULES - 1); // 2 points par segment

let _scene            = null;
let _linesMesh        = null;   // THREE.LineSegments pour toutes les connexions
let _linesPositions   = null;   // Float32Array sous-jacent
let _auras            = [];     // un Mesh CircleGeometry par véhicule
let _opaciteCourante  = 0;
let _time             = 0;

/**
 * Initialise les ressources Three.js.
 * @param {THREE.Scene} scene
 */
export function init(scene) {
  _scene = scene;

  // Géométrie des lignes — positons mise à jour chaque frame
  const geo = new THREE.BufferGeometry();
  _linesPositions = new Float32Array(MAX_POINTS * 3);
  const attr = new THREE.BufferAttribute(_linesPositions, 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', attr);
  // 0 segments au départ
  geo.setDrawRange(0, 0);

  const mat = new THREE.LineBasicMaterial({
    color: COULEUR_HEX,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });

  _linesMesh = new THREE.LineSegments(geo, mat);
  _linesMesh.renderOrder = 2;
  _scene.add(_linesMesh);

  // Pré-créer les auras (une par véhicule max)
  const geoAura = new THREE.CircleGeometry(RAYON_AURA, 16);
  for (let i = 0; i < MAX_VEHICULES; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: COULEUR_HEX, transparent: true, opacity: 0,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geoAura, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.05;
    mesh.renderOrder = 1;
    mesh.visible = false;
    _scene.add(mesh);
    _auras.push(mesh);
  }
}

/**
 * Met à jour l'effet chaque frame.
 * @param {Array<{x: number, z: number}>} vehiclePositions
 * @param {number} cohesion — valeur [0..1]
 * @param {number} dt — deltaTime en secondes
 */
export function update(vehiclePositions, cohesion, dt) {
  if (!_scene) return;

  _time += dt;

  // ---- Opacité cible selon cohésion ----
  const ratio      = cohesion >= SEUIL ? (cohesion - SEUIL) / (1 - SEUIL) : 0;
  // Pulse quand cohésion pleine (ratio > 0.9)
  const pulse      = ratio > 0.9 ? 0.15 * Math.sin(_time * PULSE_SPEED) : 0;
  const cible      = ratio * OPACITE_MAX_LIGNES + pulse;
  _opaciteCourante = _lerp(_opaciteCourante, cible, LERP_OPACITY);

  const visible = _opaciteCourante > 0.005;

  // ---- Lignes de connexion ----
  const n = Math.min(vehiclePositions.length, MAX_VEHICULES);
  let nbPoints = 0;

  if (visible && n >= 2) {
    // Paires de connexions : chaque véhicule connecté à tous les autres
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = vehiclePositions[i];
        const b = vehiclePositions[j];
        const base = nbPoints * 3;
        _linesPositions[base]     = a.x;
        _linesPositions[base + 1] = 0.3;  // légèrement au-dessus du sol
        _linesPositions[base + 2] = a.z;
        _linesPositions[base + 3] = b.x;
        _linesPositions[base + 4] = 0.3;
        _linesPositions[base + 5] = b.z;
        nbPoints += 2;
      }
    }
  }

  const posAttr = _linesMesh.geometry.getAttribute('position');
  posAttr.needsUpdate = true;
  _linesMesh.geometry.setDrawRange(0, nbPoints);
  _linesMesh.material.opacity = _opaciteCourante;
  _linesMesh.visible = visible && nbPoints > 0;

  // ---- Auras par véhicule ----
  const opaciteAura = (_opaciteCourante / OPACITE_MAX_LIGNES) * OPACITE_MAX_AURAS;
  for (let i = 0; i < MAX_VEHICULES; i++) {
    const aura = _auras[i];
    if (i < n && visible) {
      aura.position.x = vehiclePositions[i].x;
      aura.position.z = vehiclePositions[i].z;
      aura.material.opacity = opaciteAura;
      aura.visible = true;
    } else {
      aura.visible = false;
    }
  }
}

/**
 * Libère toutes les ressources Three.js.
 */
export function dispose() {
  if (_linesMesh) {
    _scene?.remove(_linesMesh);
    _linesMesh.geometry.dispose();
    _linesMesh.material.dispose();
    _linesMesh = null;
  }
  // La géométrie des auras est partagée — on la récupère du premier
  const geoPartagee = _auras[0]?.geometry;
  for (const aura of _auras) {
    _scene?.remove(aura);
    aura.material.dispose();
  }
  geoPartagee?.dispose();
  _auras = [];
  _linesPositions = null;
  _opaciteCourante = 0;
  _scene = null;
}

function _lerp(a, b, t) {
  return a + (b - a) * t;
}
