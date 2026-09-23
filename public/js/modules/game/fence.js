// Rendu de la clôture de map — quatre parois translucides aux bornes du monde.
//
// Purement visuel : la collision est analytique et vit dans game/collision.js
// (boundsFromExtent + checkTerrain). Ce module ne fait que donner à voir la limite,
// pour qu'un mur invisible ne passe pas pour un bug côté participant·e.
//
// Quatre meshes au total, quelle que soit la taille de la map — à comparer aux
// 4 × gridSize blocs qu'aurait coûté un anneau de murs en cellules.
//
// Contrat I/O :
//   buildFence(bounds, fenceCfg) → THREE.Group | null
//   disposeFence(group)          → void

import * as THREE from '../../lib/three.module.js';

/**
 * Construit le groupe de parois.
 *
 * @param {{ minX, maxX, minZ, maxZ }} bounds — bornes issues de boundsFromExtent
 * @param {{ height?: number, color?: string, opacity?: number }} [fenceCfg]
 * @returns {THREE.Group|null} — null si les bornes sont absentes
 */
export function buildFence(bounds, fenceCfg = {}) {
  if (!bounds) return null;

  const hauteur = fenceCfg.height  ?? 3.0;
  const couleur = fenceCfg.color   ?? '#8ad8ff';
  const opacite = fenceCfg.opacity ?? 0.14;

  const largeur = bounds.maxX - bounds.minX;
  const profond = bounds.maxZ - bounds.minZ;
  const cx      = (bounds.minX + bounds.maxX) / 2;
  const cz      = (bounds.minZ + bounds.maxZ) / 2;
  const y       = hauteur / 2;

  const group = new THREE.Group();

  // DoubleSide : la paroi reste lisible vue de l'intérieur comme de l'extérieur
  // (caméra en surplomb qui déborde de la map dans les coins).
  // depthWrite false : sans ça les parois se masquent entre elles aux angles.
  const materiau = () => new THREE.MeshBasicMaterial({
    color:       new THREE.Color(couleur),
    transparent: true,
    opacity:     opacite,
    side:        THREE.DoubleSide,
    depthWrite:  false,
  });

  // [largeur du plan, rotation Y, position]
  const parois = [
    [largeur, 0,             cx,          y, bounds.minZ],  // nord
    [largeur, 0,             cx,          y, bounds.maxZ],  // sud
    [profond, Math.PI / 2,   bounds.minX, y, cz],           // ouest
    [profond, Math.PI / 2,   bounds.maxX, y, cz],           // est
  ];

  for (const [taille, rotY, px, py, pz] of parois) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(taille, hauteur), materiau());
    mesh.rotation.y = rotY;
    mesh.position.set(px, py, pz);
    group.add(mesh);
  }

  return group;
}

/**
 * Libère géométries et matériaux, et retire le groupe de sa scène.
 * @param {THREE.Group|null} group
 */
export function disposeFence(group) {
  if (!group) return;
  group.parent?.remove(group);
  group.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
      else o.material.dispose();
    }
  });
}
