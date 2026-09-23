// Rendu de la cohésion — un halo unique autour de tout le groupe.
//
// La cohésion était purement abstraite : une jauge en haut de l'écran, rien
// dans le monde. Ici le groupe entier est entouré d'un seul halo, dont le
// rayon suit l'écartement des joueur·euses : resserrez-vous, il rétrécit ;
// éparpillez-vous, il enfle et vire au rouge. La règle se lit sans texte.
//
// Le halo est un cylindre ouvert, pas un disque : il monte sur les faces des
// cubes de route qu'il traverse, ce qui le rend visible même quand la caméra
// est haute et que le sol est encombré.
//
// Séparé de game/cohesion.js (qui ne fait que le calcul), sur le modèle
// turn-analyzer / turn-view.
//
// Contrat I/O :
//   init(scene, cfg)           → construit le halo
//   update(vehicles, etat, dt) → recentre, redimensionne, recolore
//   dispose()                  → libère tout

import * as THREE from '../../lib/three.module.js';

const DEFAUTS = {
  enabled: true, height: 3.2, margin: 2.0, rayonMin: 3.0,
  colorProche: '#66ff99', colorLoin: '#ff6b6b',
  opacity: 0.5, opacitySol: 0.3, segments: 56, fadeSpeed: 4.0,
};

let _scene   = null;
let _cfg     = { ...DEFAUTS };
let _mur     = null;   // cylindre ouvert — la partie qui grimpe sur les cubes
let _sol     = null;   // disque au sol, pour ancrer le halo
let _alpha   = 0;      // fondu global
let _rayon   = 0;      // rayon lissé, pour éviter les à-coups
const _teinteProche = new THREE.Color();
const _teinteLoin   = new THREE.Color();
const _teinte       = new THREE.Color();

// Dégradé vertical en alpha : opaque en bas, transparent en haut. Fait en
// canvas plutôt qu'en shader — le projet n'a pas d'étape de build.
function _textureDegrade() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0,    'rgba(255,255,255,0)');     // haut
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(1,    'rgba(255,255,255,1)');     // bas, au contact du sol
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

/**
 * @param {THREE.Scene} scene
 * @param {object} haloCfg — config/gameplay.json → cohesion.halo
 */
export function init(scene, haloCfg = {}) {
  dispose();
  _scene = scene;
  _cfg   = { ...DEFAUTS, ...haloCfg };
  _teinteProche.set(_cfg.colorProche);
  _teinteLoin.set(_cfg.colorLoin);

  // Rayon 1 à la construction : update() ne fait que changer l'échelle, il n'y
  // a donc jamais de géométrie reconstruite pendant la partie.
  const geoMur = new THREE.CylinderGeometry(1, 1, _cfg.height, _cfg.segments, 1, true);
  const matMur = new THREE.MeshBasicMaterial({
    map: _textureDegrade(),
    transparent: true, opacity: 0, depthWrite: false,
    side: THREE.DoubleSide,
  });
  _mur = new THREE.Mesh(geoMur, matMur);
  _mur.renderOrder = -1;
  _mur.visible = false;
  scene.add(_mur);

  const geoSol = new THREE.RingGeometry(0.86, 1, _cfg.segments);
  const matSol = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
  });
  _sol = new THREE.Mesh(geoSol, matSol);
  _sol.rotation.x = -Math.PI / 2;
  _sol.renderOrder = -2;
  _sol.visible = false;
  scene.add(_sol);
}

/**
 * @param {Array<{id, position:{x,z}}>} vehicles
 * @param {{ reference: Set<string> }} etat — game/cohesion.cohesionState()
 * @param {number} dt
 * @param {number} rayonCohesion — cohesion.radiusUnits, sert de seuil de couleur
 */
export function update(vehicles, etat, dt, rayonCohesion = 8) {
  if (!_scene || !_cfg.enabled || !_mur) return;

  // Le halo n'a de sens qu'à plusieurs : seul, on ne « reste pas groupé ».
  const membres = vehicles.filter(v => v?.position && etat?.reference?.has(v.id));
  const actif   = membres.length > 1;
  const pas     = Math.min(1, (_cfg.fadeSpeed ?? 4) * dt);

  _alpha += ((actif ? 1 : 0) - _alpha) * pas;
  const visible = _alpha > 0.01;
  _mur.visible = visible;
  _sol.visible = visible;
  if (!visible) return;

  if (actif) {
    // Barycentre du groupe, puis rayon qui englobe tout le monde
    let cx = 0, cz = 0;
    for (const v of membres) { cx += v.position.x; cz += v.position.z; }
    cx /= membres.length; cz /= membres.length;

    let ecart = 0;
    for (const v of membres) {
      ecart = Math.max(ecart, Math.hypot(v.position.x - cx, v.position.z - cz));
    }
    const cible = Math.max(_cfg.rayonMin, ecart + _cfg.margin);
    _rayon += (cible - _rayon) * pas;

    _mur.position.set(cx, _cfg.height / 2, cz);
    _sol.position.set(cx, 0.05, cz);
    _mur.scale.set(_rayon, 1, _rayon);
    _sol.scale.set(_rayon, _rayon, 1);

    // Vert quand le groupe est serré, rouge quand il s'étire jusqu'au rayon
    // de cohésion : c'est le seuil au-delà duquel la jauge s'effondre.
    const tension = Math.max(0, Math.min(1, (ecart * 2) / rayonCohesion));
    _teinte.copy(_teinteProche).lerp(_teinteLoin, tension);
    _mur.material.color.copy(_teinte);
    _sol.material.color.copy(_teinte);
  }

  _mur.material.opacity = _alpha * _cfg.opacity;
  _sol.material.opacity = _alpha * _cfg.opacitySol;
}

export function dispose() {
  for (const m of [_mur, _sol]) {
    if (!m) continue;
    if (_scene) _scene.remove(m);
    m.geometry.dispose();
    m.material.map?.dispose();
    m.material.dispose();
  }
  _mur = _sol = null;
  _alpha = 0;
  _rayon = 0;
  _scene = null;
}
