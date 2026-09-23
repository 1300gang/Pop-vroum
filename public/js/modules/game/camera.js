// Caméra isométrique qui suit le groupe de véhicules.
// Déplacement gauche→droite (+X). La caméra regarde depuis le côté +Z.

import * as THREE from '../../lib/three.module.js';

// Suivi volontairement resserré : le lissage s'applique deux fois (barycentre
// puis position caméra), donc un coefficient bas se paie double en retard. À
// 0,08 la caméra traînait d'environ un demi-blocmap derrière la voiture.
const LERP_POS   = 0.14;
const LERP_ZOOM  = 0.05;

// --- Anticipation directionnelle ---
// La caméra regarde devant la voiture, dans la direction où elle va réellement.
// L'ancienne version anticipait sur un axe fixe (+X), hérité d'une époque où la
// map se traversait de gauche à droite : dans un labyrinthe où l'on roule aussi
// vers le nord ou le sud, elle regardait donc systématiquement de travers.
const LERP_LEAD    = 0.06;   // lissage de la direction (lent : évite le fouet en virage)
const LEAD_MIN_MOVE = 0.02;  // en deçà, le déplacement est du bruit — on garde la direction
// Suivi vertical volontairement plus lent que le suivi horizontal : la voiture
// s'échappe vers le haut du cadre au décollage, et la caméra la rattrape. C'est
// ce décalage qui fait lire le saut — une caméra collée à la voiture l'aplatit.
const LERP_HAUTEUR = 0.035;
// Recul supplémentaire (zoom arrière) par unité de hauteur, pour voir la réception
const ZOOM_AIR     = 1.1;
const PADDING    = 8;
const ZOOM_MIN   = 12;
const ZOOM_MAX   = 80;

// --- Paramètres isométriques ---
const ISO_ANGLE    = 30 * (Math.PI / 180); // 30° au-dessus de l'horizontale
const ISO_DISTANCE = 45;
const LOOK_AHEAD   = 4;                    // la caméra regarde légèrement devant en +X

// --- Paramètres screen shake ---
// Décroissance exponentielle : SHAKE_DECAY tel que 95% d'atténuation en 0.3s → decay ≈ 10
const SHAKE_DECAY     = 10;
const SHAKE_MAX       = 6;  // magnitude maximale acceptée (évite les valeurs aberrantes)

let _camera      = null;
let _aspect      = 1;
let _targetHalfW = ZOOM_MIN;
let _currentHalfW = ZOOM_MIN; // suivi séparé pour éviter la divergence avec _camera.right
let _currentPos  = new THREE.Vector3();
let _targetPos   = new THREE.Vector3();

// Direction d'anticipation (unitaire, plan XZ) + barycentre de la frame précédente.
// On dérive la direction du déplacement du barycentre plutôt que de demander les
// vélocités aux appelants : ça marche pour les quatre pages, y compris le
// multijoueur qui ne transmet que des positions.
let _leadX  = 1, _leadZ = 0;
let _prevCX = null, _prevCZ = null;

// Coup de zoom ponctuel (boost, collant) — s'estompe tout seul
let _kick = 0;

// État du shake
let _shakeIntensity = 0;
let _shakePrevTime  = 0;

export function createCamera(canvasW, canvasH) {
  _aspect = canvasW / canvasH;
  const hw = ZOOM_MIN;

  _camera = new THREE.OrthographicCamera(
    -hw * _aspect, hw * _aspect,
    hw, -hw,
    0.1, 500
  );

  // up=(0,1,0) : Y est le haut du monde. Avec une inclinaison iso, plus de gimbal lock.
  _camera.up.set(0, 1, 0);

  // Position initiale isométrique
  const offset = _calcOffset(0, 0, ISO_DISTANCE);
  _camera.position.copy(offset);
  _camera.lookAt(LOOK_AHEAD, 0, 0);

  // Initialiser _currentPos à la vraie position iso pour éviter un lerp de départ depuis (0,0,0)
  _currentPos.copy(offset);
  _targetPos.set(0, 0, 0);
  _targetHalfW  = ZOOM_MIN;
  _currentHalfW = ZOOM_MIN;
  _leadX = 1; _leadZ = 0;
  _prevCX = null; _prevCZ = null;

  return _camera;
}

export function update(positions) {
  if (!_camera || positions.length === 0) return;

  // ---- Barycentre ----
  let cx = 0, cz = 0, cy = 0;
  for (const p of positions) { cx += p.x; cz += p.z; cy += (p.y ?? 0); }
  cx /= positions.length;
  cz /= positions.length;
  cy /= positions.length;

  // ---- Zoom adaptatif (bounding box) ----
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const p of positions) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }

  const extentX = (maxX - minX) / 2 + PADDING;
  const extentZ = (maxZ - minZ) / 2 + PADDING;
  _kick *= 0.92;   // retour au cadrage normal en ~0.5 s
  if (Math.abs(_kick) < 0.02) _kick = 0;

  const targetHW = Math.max(extentX, extentZ / _aspect, ZOOM_MIN) + Math.max(0, cy) * ZOOM_AIR + _kick;
  _targetHalfW = Math.max(ZOOM_MIN * 0.6, Math.min(targetHW, ZOOM_MAX));

  // Lerp zoom : utilise _currentHalfW (pas _camera.right qui vaut hw×aspect)
  // pour éviter la divergence sur les écrans non-carrés
  _currentHalfW = _lerp(_currentHalfW, _targetHalfW, LERP_ZOOM);
  const hw = _currentHalfW;

  // ---- Direction d'anticipation ----
  // Dérivée du déplacement du barycentre, lissée. En dessous du seuil on conserve
  // la dernière direction connue : à l'arrêt, la caméra ne doit pas se mettre à
  // tourner sur du bruit numérique.
  if (_prevCX !== null) {
    const dx = cx - _prevCX;
    const dz = cz - _prevCZ;
    const d  = Math.sqrt(dx * dx + dz * dz);
    if (d > LEAD_MIN_MOVE) {
      _leadX = _lerp(_leadX, dx / d, LERP_LEAD);
      _leadZ = _lerp(_leadZ, dz / d, LERP_LEAD);
      const n = Math.sqrt(_leadX * _leadX + _leadZ * _leadZ);
      if (n > 0.001) { _leadX /= n; _leadZ /= n; }
    }
  }
  _prevCX = cx;
  _prevCZ = cz;

  // ---- Position cible (lerp doux) ----
  _targetPos.x = _lerp(_targetPos.x, cx, LERP_POS);
  _targetPos.z = _lerp(_targetPos.z, cz, LERP_POS);
  _targetPos.y = _lerp(_targetPos.y, cy, LERP_HAUTEUR);

  // ---- Calcul position caméra isométrique ----
  // La distance varie avec le zoom pour garder la même "échelle" visuelle
  const dist = ISO_DISTANCE * (hw / ZOOM_MIN);
  const offset = _calcOffset(_targetPos.x, _targetPos.z, dist);
  offset.y += _targetPos.y;

  _currentPos.x = _lerp(_currentPos.x, offset.x, LERP_POS);
  _currentPos.y = _lerp(_currentPos.y, offset.y, LERP_POS);
  _currentPos.z = _lerp(_currentPos.z, offset.z, LERP_POS);

  // ---- Application ----
  _camera.left   = -hw * _aspect;
  _camera.right  =  hw * _aspect;
  _camera.top    =  hw;
  _camera.bottom = -hw;

  _camera.position.copy(_currentPos);
  _camera.lookAt(
    _targetPos.x + _leadX * LOOK_AHEAD,
    _targetPos.y,
    _targetPos.z + _leadZ * LOOK_AHEAD,
  );

  // ---- Screen shake : offset 2D aléatoire sur position caméra ----
  if (_shakeIntensity > 0.005) {
    const now = performance.now() / 1000;
    const dt  = _shakePrevTime > 0 ? Math.min(now - _shakePrevTime, 0.05) : 0.016;
    _shakePrevTime = now;

    // Décalage aléatoire dans le plan de la caméra (X et Z, pas Y pour éviter le mal de mer)
    const angle = Math.random() * Math.PI * 2;
    _camera.position.x += Math.cos(angle) * _shakeIntensity;
    _camera.position.z += Math.sin(angle) * _shakeIntensity;

    // Décroissance exponentielle
    _shakeIntensity *= Math.exp(-SHAKE_DECAY * dt);
  } else {
    _shakeIntensity = 0;
    _shakePrevTime  = 0;
  }

  _camera.updateProjectionMatrix();
}

export function resize(canvasW, canvasH) {
  if (!_camera) return;
  _aspect = canvasW / canvasH;
  _camera.left   = -_currentHalfW * _aspect;
  _camera.right  =  _currentHalfW * _aspect;
  _camera.updateProjectionMatrix();
}

/**
 * Calcule la position caméra pour un angle isométrique fixe.
 * @param {number} tx - cible X
 * @param {number} tz - cible Z
 * @param {number} dist - distance caméra/cible
 */
function _calcOffset(tx, tz, dist) {
  // Azimut 0° : caméra regarde depuis +Z vers -Z.
  // +X va à droite à l'écran (déplacement gauche→droite).
  const azimuth = 0;

  const dy = dist * Math.sin(ISO_ANGLE);   // hauteur
  const dH = dist * Math.cos(ISO_ANGLE);   // distance horizontale

  const dx = dH * Math.sin(azimuth);
  const dz = dH * Math.cos(azimuth);

  return new THREE.Vector3(tx + dx, dy, tz + dz);
}

/**
 * Déclenche un screen shake proportionnel à la magnitude donnée.
 * Appelé par game/impact lors d'une collision.
 * @param {number} magnitude — intensité brute (ex. vitesse de collision)
 */
/**
 * Coup de zoom ponctuel : négatif = la vue se resserre (boost),
 * positif = elle s'élargit (ralentissement).
 */
export function kick(amount) {
  _kick = amount;
}

export function shake(magnitude) {
  const clamped = Math.min(magnitude, SHAKE_MAX);
  // On prend le max pour ne pas couper un shake déjà en cours
  _shakeIntensity = Math.max(_shakeIntensity, clamped);
}

function _lerp(a, b, t) {
  return a + (b - a) * t;
}