// Objets mobiles ou destructibles d'une map : cubes poussables et poteaux.
//
// Côté client, test-v5 crée ces entrées en même temps que leurs meshes. Le
// serveur, lui, n'a pas de rendu : il lui faut les mêmes entrées, construites
// directement depuis la map, pour que vehicle-tick et movables.tick les
// manipulent de la même façon. Une entrée expose `mesh.position` — un vrai mesh
// Three.js côté client, un simple { x, y, z } ici.
//
// Chaque objet porte un `id` stable (bloc + case d'origine) : c'est lui qui
// circule sur le réseau pour dire « ce cube a bougé », « ce poteau est tombé ».
//
// Contrat : aucun DOM, aucun Three.js — importable par Node. Mute la map : les
// cellules de cube deviennent des objets { type: 'movable', x, z } qui portent
// la position réelle du cube, comme le fait test-v5 (collision.js vise le cube
// là où il est, pas au centre de sa case).

const BLOCK_SIZE = 8;

function _type(cell) {
  if (!cell) return null;
  return typeof cell === 'object' ? cell.type : cell;
}

/**
 * Recense cubes et poteaux d'une map.
 * @param {object} map — MapData (blocks, blockScale)
 * @returns {{ cubes: Map<string, object>, poles: Map<string, object> }}
 *   cubes : id → { id, mesh: { position }, bloc, gz, gx, vx, vz, cellule }
 *   poles : id → { id, mesh: { position }, bloc, gz, gx }
 */
export function createWorldObjects(map) {
  const cs    = map.blockScale ?? 2;
  const cubes = new Map();
  const poles = new Map();

  for (const bloc of map.blocks) {
    const [bx, bz] = bloc.position;
    for (let gz = 0; gz < BLOCK_SIZE; gz++) {
      for (let gx = 0; gx < BLOCK_SIZE; gx++) {
        const raw = bloc.grid[gz]?.[gx];
        const t   = _type(raw);
        if (t !== 'movable' && t !== 'pole') continue;

        const id = `${bx},${bz},${gz},${gx}`;
        const cx = bx + gx * cs + cs / 2;
        const cz = bz + gz * cs + cs / 2;

        if (t === 'movable') {
          const cellule = (typeof raw === 'object' && Number.isFinite(raw.x))
            ? raw
            : { type: 'movable', x: cx, z: cz };
          bloc.grid[gz][gx] = cellule;
          cubes.set(id, {
            id, mesh: { position: { x: cellule.x, y: 0, z: cellule.z } },
            bloc, gz, gx, vx: 0, vz: 0, cellule,
          });
        } else {
          poles.set(id, { id, mesh: { position: { x: cx, y: 0, z: cz } }, bloc, gz, gx });
        }
      }
    }
  }
  return { cubes, poles };
}

/**
 * Bloc qui contient un point monde, ou null — pour qu'un cube poussé puisse
 * passer d'un bloc à son voisin (movables.tick).
 * @param {object} map
 * @param {number} x
 * @param {number} z
 */
export function findBlockAt(map, x, z) {
  const taille = BLOCK_SIZE * (map.blockScale ?? 2);
  return map.blocks.find(b =>
    x >= b.position[0] && x < b.position[0] + taille &&
    z >= b.position[1] && z < b.position[1] + taille) ?? null;
}
