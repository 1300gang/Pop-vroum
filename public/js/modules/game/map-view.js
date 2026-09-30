// Rendu Three.js de la map : blocs (murs, rampes, plateaux, bosses, cubes,
// poteaux) et sol (dalles et libellés départ / arrivée).
//
// Sorti de test-v5-page.js pour que la page de jeu multijoueur dessine la map
// exactement comme le banc d'essai, sans troisième copie du code.
// Côté client uniquement (Three.js). La hauteur de plateau vient de
// config/layout.json (PLATEAU_HEIGHT), passée par l'appelant.

import * as THREE from '../../lib/three.module.js';
import { BLOCK_SIZE } from './map-generator.js';
import { POLE_RADIUS_RATIO, CUBE_SIZE_RATIO } from './collision.js';

const TYPES_CELLULE = {
  null:        { couleur: 0x3a3a4a, hauteur: 0.0  },
  dur:         { couleur: 0x4a5060, hauteur: 0.6  },
  boost:       { couleur: 0x00d4ff, hauteur: 0.05 },
  sticky:      { couleur: 0x88ff66, hauteur: 0.05 },
  rampe_bosse: { couleur: 0xe8a020, hauteur: 0.18 },  // RACE-C05
  // SOLO-04 : nouveaux éléments
  ramp_n:  { couleur: 0xaaaaff, hauteur: 0.5 },
  ramp_s:  { couleur: 0xaaaaff, hauteur: 0.5 },
  ramp_e:  { couleur: 0xaaaaff, hauteur: 0.5 },
  ramp_o:  { couleur: 0xaaaaff, hauteur: 0.5 },
  bump:    { couleur: 0xcc8844, hauteur: 0.3 },
  movable: { couleur: 0xff6644, hauteur: 1.0 },
  pole:    { couleur: 0xffffff, hauteur: 2.5 },
};

const PLATEAU_FLOOR_H     = 0.15;
const PLATEAU_COULEUR_SOL = 0x444455;
const TRANSITION_THICK    = 0.06;

// SOLO-04 : rampe directionnelle centrée — montant vers +X par défaut (ramp_e)
// Prisme triangulaire centré sur l'origine ; rotation Y appliquée par l'appelant.
function _creerGeomRampCentree(h, cs) {
  const hx = cs / 2, hz = cs / 2;
  const geo = new THREE.BufferGeometry();
  const v = new Float32Array([
    -hx, 0,  -hz,   -hx, 0,   hz,
     hx, 0,  -hz,    hx, 0,   hz,
     hx, h,  -hz,    hx, h,   hz,
  ]);
  const idx = [
    0,2,3, 0,3,1,  // face du bas
    2,4,5, 2,5,3,  // surface inclinée
    1,3,5, 1,5,4,  // côté hz
    0,4,2,         // côté -hz (triangle)
    0,1,4, 1,5,4,  // côté hz (rectangle)
    0,1,4, 1,5,4,  // doublon ignoré par THREE mais on garde les tris utiles
  ];
  geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
  geo.setIndex([
    0,2,3, 0,3,1,
    2,4,5, 2,5,3,
    0,4,2,
    1,3,5, 1,5,4,
    0,1,4,
  ]);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Construit les meshes d'un ou plusieurs blocs (murs, rampes, plateaux, bosses,
 * cubes, poteaux, bords de plateau).
 *
 * Les cubes et poteaux sont signalés à l'appelant, qui les range à sa façon
 * (test-v5 par cellule, la page de jeu par id réseau) :
 *   onCube(cellule, mesh, bloc, gz, gx) — la cellule porte la position réelle du cube
 *   onPole(id, mesh, bloc, gz, gx)      — id = "bx,bz,gz,gx", celui de world-objects
 *
 * @param {Array<object>} blocks
 * @param {number} blockScale
 * @param {{ onCube?, onPole?, plateauHeight? }} [opts]
 * @returns {THREE.Group}
 */
export function buildBlockMeshes(blocks, blockScale, opts = {}) {
  const PLATEAU_HEIGHT = opts.plateauHeight ?? 0.5;
  const group = new THREE.Group();
  const cs = blockScale;

  for (const bloc of blocks) {
    const [bx, bz] = bloc.position;
    const elevGrid = bloc.elevationGrid; // null si le bloc n'a pas d'élévation (rétrocompat)

    for (let gz = 0; gz < BLOCK_SIZE; gz++) {
      for (let gx = 0; gx < BLOCK_SIZE; gx++) {
        const rawCell   = bloc.grid[gz]?.[gx];
        // Support cellules objets (ex: rampe_pente) : extraire le type string
        const cellType  = !rawCell ? null : (typeof rawCell === 'object' ? rawCell.type : rawCell);
        const cell      = cellType; // alias pour lisibilité en dessous
        const elevation = elevGrid?.[gz]?.[gx] ?? 0;
        const yOffset   = elevation * PLATEAU_HEIGHT * cs;
        const def       = TYPES_CELLULE[cell] ?? TYPES_CELLULE.null;

        // Cellule rampe_pente (objet) : rendu en prisme incliné
        if (cellType === 'rampe_pente' && typeof rawCell === 'object') {
          const { direction = 'E', elevation_start = 0, elevation_end = 1 } = rawCell;
          const yLow  = elevation_start * PLATEAU_HEIGHT * cs;
          const yHigh = elevation_end   * PLATEAU_HEIGHT * cs;
          const c     = cs / 2;
          const pos   = new Float32Array([
            -c, yLow,  -c,  -c, yLow,   c,   c, yLow,  -c,   c, yLow,   c,
            -c, yHigh,  c,   c, yHigh,  c,
          ]);
          const idx = [0,2,3, 0,3,1, 0,4,5, 0,5,2, 1,3,5, 1,5,4, 0,1,4, 2,5,3];
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
          geo.setIndex(idx);
          geo.computeVertexNormals();
          const mat = new THREE.MeshStandardMaterial({ color: 0xd07830 });
          const m   = new THREE.Mesh(geo, mat);
          // V4-02 : le prisme monte vers +Z (Sud) par défaut — E et O étaient inversées
          const rotY = direction === 'N' ? Math.PI
                     : direction === 'E' ?  Math.PI / 2
                     : direction === 'O' ? -Math.PI / 2
                     : 0;
          m.rotation.y = rotY;
          m.position.set(bx + gx * cs + cs / 2, 0, bz + gz * cs + cs / 2);
          group.add(m);
          continue;
        }

        // Sol surélevé : cellule vide (route) sur plateau
        if (!cell && elevation > 0) {
          const geo = new THREE.BoxGeometry(cs, PLATEAU_FLOOR_H * cs, cs);
          const mat = new THREE.MeshStandardMaterial({ color: PLATEAU_COULEUR_SOL });
          const m   = new THREE.Mesh(geo, mat);
          m.position.set(
            bx + gx * cs + cs / 2,
            yOffset + (PLATEAU_FLOOR_H * cs) / 2,
            bz + gz * cs + cs / 2,
          );
          group.add(m);
          continue;
        }

        if (def.hauteur === 0) continue; // cellule vide à élévation 0, pas de mesh

        const mat = new THREE.MeshStandardMaterial({ color: def.couleur });
        let m;
        if (cell === 'ramp_n' || cell === 'ramp_s' || cell === 'ramp_e' || cell === 'ramp_o') {
          // SOLO-04 : rampe directionnelle — prisme centré + rotation Y
          const geo = _creerGeomRampCentree(def.hauteur * cs, cs);
          m = new THREE.Mesh(geo, mat);
          // V4-02 : ramp_n/ramp_s étaient inversées (la base monte vers +X = Est)
          const rotY = cell === 'ramp_o' ? Math.PI
                     : cell === 'ramp_n' ?  Math.PI / 2
                     : cell === 'ramp_s' ? -Math.PI / 2
                     : 0; // ramp_e
          m.rotation.y = rotY;
          m.position.set(bx + gx * cs + cs / 2, yOffset, bz + gz * cs + cs / 2);
        } else if (cell === 'rampe_bosse') {
          // RACE-C05 : ralentisseur bombé, en travers de la piste — sans mesh
          // dédié il s'affichait comme une dalle plate qu'on croyait inerte.
          const geo = new THREE.SphereGeometry(cs * 0.5, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2);
          m = new THREE.Mesh(geo, mat);
          m.scale.set(1, 0.42, 0.55);
          m.position.set(bx + gx * cs + cs / 2, yOffset, bz + gz * cs + cs / 2);
        } else if (cell === 'bump') {
          // SOLO-04 : bosse — demi-sphère aplatie
          const geo = new THREE.SphereGeometry(cs * 0.45, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
          m = new THREE.Mesh(geo, mat);
          m.position.set(bx + gx * cs + cs / 2, yOffset, bz + gz * cs + cs / 2);
        } else if (cell === 'movable') {
          // SOLO-04 : cube déplaçable — même empreinte au sol que son collider
          const geo = new THREE.BoxGeometry(cs * CUBE_SIZE_RATIO, cs * 1.15, cs * CUBE_SIZE_RATIO);
          m = new THREE.Mesh(geo, mat);
          // La cellule devient un objet qui porte la position réelle du cube :
          // collision.js vise le cube là où il est, pas au centre de sa case.
          const cellule = (typeof rawCell === 'object' && Number.isFinite(rawCell.x))
            ? rawCell
            : { type: 'movable', x: bx + gx * cs + cs / 2, z: bz + gz * cs + cs / 2 };
          bloc.grid[gz][gx] = cellule;
          m.position.set(cellule.x, yOffset + cs * 0.575, cellule.z);
          opts.onCube?.(cellule, m, bloc, gz, gx);
        } else if (cell === 'pole') {
          // SOLO-04 : poteau fin
          const geo = new THREE.CylinderGeometry(
            cs * POLE_RADIUS_RATIO, cs * POLE_RADIUS_RATIO, def.hauteur * cs, 6,
          );
          m = new THREE.Mesh(geo, mat);
          m.position.set(bx + gx * cs + cs / 2, yOffset + (def.hauteur * cs) / 2, bz + gz * cs + cs / 2);
          opts.onPole?.(`${bx},${bz},${gz},${gx}`, m, bloc, gz, gx);
        } else {
          const geo = new THREE.BoxGeometry(cs, def.hauteur * cs, cs);
          m = new THREE.Mesh(geo, mat);
          m.position.set(
            bx + gx * cs + cs / 2,
            yOffset + (def.hauteur * cs) / 2,
            bz + gz * cs + cs / 2,
          );
        }
        group.add(m);
      }
    }

    // Murs de transition plateau (RACE-C02) : bords entre élévation 1 et 0
    if (elevGrid) {
      for (let gz = 0; gz < BLOCK_SIZE; gz++) {
        for (let gx = 0; gx < BLOCK_SIZE; gx++) {
          const elev = elevGrid[gz]?.[gx] ?? 0;
          if (elev === 0) continue;

          const h = elev * PLATEAU_HEIGHT * cs;
          const voisins = [
            { dz: 0,  dx: -1, cote: 'gauche'  },
            { dz: 0,  dx:  1, cote: 'droit'   },
            { dz: -1, dx:  0, cote: 'avant'   },
            { dz:  1, dx:  0, cote: 'arriere' },
          ];

          for (const { dz, dx, cote } of voisins) {
            const elevV = elevGrid[gz + dz]?.[gx + dx] ?? 0;
            if (elevV >= elev) continue;

            const th  = TRANSITION_THICK * cs;
            const mat = new THREE.MeshStandardMaterial({ color: 0x555570 });
            let geo, wx, wz;

            switch (cote) {
              case 'gauche':
                geo = new THREE.BoxGeometry(th, h, cs);
                wx = bx + gx * cs; wz = bz + gz * cs + cs / 2; break;
              case 'droit':
                geo = new THREE.BoxGeometry(th, h, cs);
                wx = bx + (gx + 1) * cs; wz = bz + gz * cs + cs / 2; break;
              case 'avant':
                geo = new THREE.BoxGeometry(cs, h, th);
                wx = bx + gx * cs + cs / 2; wz = bz + gz * cs; break;
              case 'arriere':
                geo = new THREE.BoxGeometry(cs, h, th);
                wx = bx + gx * cs + cs / 2; wz = bz + (gz + 1) * cs; break;
            }

            const m = new THREE.Mesh(geo, mat);
            m.position.set(wx, h / 2, wz);
            group.add(m);
          }
        }
      }
    }
  }

  return group;
}

// V4-04 : label posé à plat au sol (texture canvas — pas de chargeur de police,
// donc rien à télécharger : le jeu doit tourner hors ligne en atelier).
/**
 * Texte posé à plat au sol (texture canvas, sans chargeur de police : le jeu
 * doit tourner hors ligne en atelier).
 */
export function createGroundLabel(texte, couleurCss, blocmapSize) {
  const canvas  = document.createElement('canvas');
  canvas.width  = 512;
  canvas.height = 128;

  const ctx = canvas.getContext('2d');
  ctx.fillStyle    = couleurCss;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  // Réduit la police jusqu'à ce que le texte tienne : les noms de section
  // ("RAMPE + PLATEAU") sont bien plus longs qu'un simple repère chiffré.
  let taille = 84;
  do {
    ctx.font = `bold ${taille}px system-ui, -apple-system, sans-serif`;
    if (ctx.measureText(texte).width <= canvas.width * 0.92) break;
    taille -= 4;
  } while (taille > 16);

  ctx.fillText(texte, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const largeur = blocmapSize * 0.75;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(largeur, largeur / 4),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  // Le départ est orienté vers l'Est (angle 0) : le texte se lit dans ce sens.
  mesh.rotation.z = -Math.PI / 2;
  return mesh;
}

/**
 * Sol de la map, dalles et libellés DÉPART / ARRIVÉE.
 * @param {object} map — MapData
 * @param {Array<object>} [reperes] — repères au sol des pistes de mesure (test-v5)
 * @returns {THREE.Group}
 */
export function buildGround(map, reperes = []) {
  const group = new THREE.Group();
  const { width, depth } = map.worldExtent;
  const blocmapSize = BLOCK_SIZE * map.blockScale;

  const solGeo = new THREE.PlaneGeometry(width + 8, depth + 8);
  const solMat = new THREE.MeshStandardMaterial({ color: 0x2a2a3e });
  const sol = new THREE.Mesh(solGeo, solMat);
  sol.rotation.x = -Math.PI / 2;
  sol.position.set(width / 2, -0.15, depth / 2);
  group.add(sol);

  // SOLO-05 : dalle départ (coin 0,0) et arrivée (coin W-1,H-1)
  const blocGeo    = new THREE.PlaneGeometry(blocmapSize, blocmapSize);
  const entryPos   = map.entry?.worldCenter ?? { x: blocmapSize * 0.5, z: blocmapSize * 0.5 };
  const exitPos    = map.exit?.worldCenter  ?? map.finishPosition;

  const departMat = new THREE.MeshBasicMaterial({ color: 0x66ff99, transparent: true, opacity: 0.35 });
  const depart    = new THREE.Mesh(blocGeo, departMat);
  depart.rotation.x = -Math.PI / 2;
  depart.position.set(entryPos.x, 0.02, entryPos.z);
  group.add(depart);

  const arriveeMat = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.45 });
  const arrivee    = new THREE.Mesh(blocGeo.clone(), arriveeMat);
  arrivee.rotation.x = -Math.PI / 2;
  arrivee.position.set(exitPos.x, 0.02, exitPos.z);
  group.add(arrivee);

  // Piste de mesure : traits + distances au sol après chaque tremplin, pour
  // lire d'un coup d'œil la portée d'un saut.
  for (const repere of reperes) {
    if (repere.type === 'section' || repere.type === 'note') {
      const estSection = repere.type === 'section';
      const label = createGroundLabel(
        repere.label,
        estSection ? '#ffd88a' : '#8fa6bd',
        blocmapSize * (estSection ? 1.15 : 0.8),
      );
      label.position.set(repere.x, 0.05, repere.z);
      group.add(label);
      continue;
    }

    // Repère de distance : un trait en travers de la piste + sa valeur
    const trait = new THREE.Mesh(
      new THREE.PlaneGeometry(0.15, blocmapSize * 0.8),
      new THREE.MeshBasicMaterial({ color: 0x6688aa, transparent: true, opacity: 0.5 }),
    );
    trait.rotation.x = -Math.PI / 2;
    trait.position.set(repere.x, 0.03, repere.z);
    group.add(trait);

    const chiffre = createGroundLabel(repere.label, '#88aacc', blocmapSize * 0.35);
    chiffre.position.set(repere.x, 0.04, repere.z + blocmapSize * 0.32);
    group.add(chiffre);
  }

  // V4-04 : labels au sol pour que les participant·es repèrent les deux zones
  const labelDepart = createGroundLabel('DÉPART', '#8effb8', blocmapSize);
  labelDepart.position.set(entryPos.x, 0.05, entryPos.z);
  group.add(labelDepart);

  const labelArrivee = createGroundLabel('ARRIVÉE', '#ffe29a', blocmapSize);
  labelArrivee.position.set(exitPos.x, 0.05, exitPos.z);
  group.add(labelArrivee);

  return group;
}
