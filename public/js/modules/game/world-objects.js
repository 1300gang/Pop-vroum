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

        // Un cube déjà recensé (map reçue du serveur) garde son id d'origine
        const id = raw?.id ?? `${bx},${bz},${gz},${gx}`;
        const cx = bx + gx * cs + cs / 2;
        const cz = bz + gz * cs + cs / 2;

        if (t === 'movable') {
          const cellule = (typeof raw === 'object' && Number.isFinite(raw.x))
            ? raw
            : { type: 'movable', x: cx, z: cz };
          cellule.id = id;   // voyage avec la map : le client retrouve le même cube
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

/**
 * Pose un cube à une position reçue du serveur. Si le cube change de case, sa
 * cellule de collision le suit (même règle que movables.tick) : sans ça, la
 * prédiction locale buterait contre un cube fantôme resté à son ancienne place.
 * @param {object} map
 * @param {object} cube — entrée de createWorldObjects
 * @param {number} x
 * @param {number} z
 */
export function placeCube(map, cube, x, z) {
  const cs   = map.blockScale ?? 2;
  const bloc = findBlockAt(map, x, z) ?? cube.bloc;
  const gx   = Math.max(0, Math.min(BLOCK_SIZE - 1, Math.floor((x - bloc.position[0]) / cs)));
  const gz   = Math.max(0, Math.min(BLOCK_SIZE - 1, Math.floor((z - bloc.position[1]) / cs)));
  if (bloc !== cube.bloc || gx !== cube.gx || gz !== cube.gz) {
    if (cube.bloc.grid[cube.gz][cube.gx] === cube.cellule) cube.bloc.grid[cube.gz][cube.gx] = null;
    bloc.grid[gz][gx] = cube.cellule;
    cube.bloc = bloc; cube.gx = gx; cube.gz = gz;
  }
  cube.cellule.x = x;
  cube.cellule.z = z;
  cube.mesh.position.x = x;
  cube.mesh.position.z = z;
}

/**
 * Index des blocs par case, pour ne tester la collision qu'autour d'un véhicule.
 * @param {object} map
 */
export function createBlockIndex(map) {
  return {
    cs:      map.blockScale ?? 2,
    parCase: new Map(map.blocks.map(b => [`${b.col},${b.row}`, b])),
  };
}

/**
 * Blocs autour d'une position (3×3) : chaque véhicule entre en collision avec
 * ce qui l'entoure LUI, pas avec les blocs chargés pour l'affichage.
 * @param {object} index — createBlockIndex()
 * @param {{x,z}} pos
 */
export function blocksAround(index, pos) {
  const taille = BLOCK_SIZE * index.cs;
  const c = Math.floor(pos.x / taille), r = Math.floor(pos.z / taille);
  const blocs = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const b = index.parCase.get(`${c + dc},${r + dr}`);
      if (b) blocs.push(b);
    }
  }
  return blocs;
}
