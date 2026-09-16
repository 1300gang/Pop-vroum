// Cubes déplaçables — mouvement continu et collider solidaire.
//
// Le cube EST son mesh : il avance avec sa propre vitesse, frotte, et sa cellule
// de collision n'est réattribuée que lorsqu'il change réellement de case. Avant,
// seul le mesh était déplacé et la cellule restait en place : le cube glissait
// tout seul devant un collider fantôme.
//
// Contrat I/O : pas de Three.js ici — un cube est un objet
//   { mesh: { position: { x, z } }, bloc, gx, gz, vx, vz, cellule? }
// `cellule` est l'objet posé dans la grille ({ type: 'movable', x, z }) : il est
// déplacé de case en case et sa position est tenue à jour pour collision.js.
// ce qui rend le module testable avec de simples objets.

/**
 * Pousse le cube lors d'un contact avec le véhicule.
 *
 * La direction est imposée par l'appelant (véhicule → cube) et NON déduite de
 * la vitesse du véhicule : à ce stade celle-ci a déjà été inversée par le rebond.
 *
 * La vitesse du cube est RELEVÉE jusqu'à une cible, jamais additionnée : cette
 * fonction est appelée à chaque frame de contact, et une addition ferait
 * accélérer le cube sans limite tant que la voiture reste collée.
 *
 * @param {object} cube
 * @param {{ x: number, z: number }} direction — du véhicule vers le cube
 * @param {number} vitesse — vitesse d'impact (avant rebond)
 * @param {number} [transfert=0.55] — part de la vitesse d'impact transmise
 * @param {number} [vitesseMin=0] — poussée continue quand la voiture reste collée
 */
export function pousser(cube, direction, vitesse, transfert = 0.55, vitesseMin = 0) {
  const len = Math.sqrt(direction.x ** 2 + direction.z ** 2);
  if (len < 0.0001) return;
  const nx = direction.x / len;
  const nz = direction.z / len;

  const impact = Number.isFinite(vitesse) ? vitesse * transfert : 0;
  const cible  = Math.max(impact, vitesseMin);
  if (cible < 0.05) return;

  const actuelle = cube.vx * nx + cube.vz * nz;
  if (actuelle >= cible) return;
  cube.vx += nx * (cible - actuelle);
  cube.vz += nz * (cible - actuelle);
}

// Avance les cubes d'une frame ; renvoie le nombre de cubes encore en mouvement.
/**
 * @param {Iterable<object>} cubes
 * @param {number} dt
 * @param {number} cellSize — unités monde par cellule
 * @param {object} [consts]
 * @param {(x: number, z: number) => object|null} [trouverBloc] — bloc contenant un
 *   point monde ; sans lui un cube ne peut pas quitter son bloc
 */
export function tick(cubes, dt, cellSize, consts, trouverBloc = null) {
  const cfg        = consts ?? {};
  const frottement = Math.max(0, 1 - (cfg.CUBE_FRICTION ?? 3.2) * dt);
  const transfert  = cfg.CUBE_CHAIN_TRANSFER ?? 0.85;

  // Retrouver le cube qui occupe une case à partir de sa cellule-objet
  const liste      = Array.from(cubes);
  const parCellule = new Map(liste.filter(c => c.cellule).map(c => [c.cellule, c]));
  let enMouvement  = 0;

  for (const cube of liste) {
    if (Math.abs(cube.vx) < 0.01 && Math.abs(cube.vz) < 0.01) {
      cube.vx = 0;
      cube.vz = 0;
      continue;
    }

    const nx = cube.mesh.position.x + cube.vx * dt;
    const nz = cube.mesh.position.z + cube.vz * dt;

    // Bloc d'arrivée : le sien, ou le voisin si le cube franchit une frontière.
    // Sans ça le cube restait prisonnier de son bloc et chaque frontière faisait mur.
    let bloc = cube.bloc;
    const tailleBloc = bloc.grid.length * cellSize;
    const horsBloc = nx < bloc.position[0] || nx >= bloc.position[0] + tailleBloc
                  || nz < bloc.position[1] || nz >= bloc.position[1] + tailleBloc;
    if (horsBloc) {
      bloc = trouverBloc?.(nx, nz) ?? null;
      if (!bloc) {                     // bord de la map : le cube s'arrête
        cube.vx = 0; cube.vz = 0;
        continue;
      }
    }

    // Case occupée par le centre du cube, dans le repère de son bloc d'arrivée
    const gx = Math.floor((nx - bloc.position[0]) / cellSize);
    const gz = Math.floor((nz - bloc.position[1]) / cellSize);

    if (bloc !== cube.bloc || gx !== cube.gx || gz !== cube.gz) {
      const occupant = bloc.grid[gz]?.[gx];
      if (occupant !== null) {
        // Un autre cube : il reçoit l'élan (choc presque élastique). Sans ce
        // transfert, deux cubes qui se touchaient formaient un mur immobile et
        // la voiture restait coincée derrière le tas.
        const autre = (occupant && typeof occupant === 'object') ? parCellule.get(occupant) : null;
        if (autre) {
          autre.vx += cube.vx * transfert;
          autre.vz += cube.vz * transfert;
        }
        // Mur, bord de bloc ou cube percuté : celui-ci s'arrête
        cube.vx = 0;
        cube.vz = 0;
        continue;
      }
      cube.bloc.grid[cube.gz][cube.gx] = null;
      bloc.grid[gz][gx] = cube.cellule ?? 'movable';
      cube.bloc = bloc;
      cube.gz = gz;
      cube.gx = gx;
    }

    cube.mesh.position.x = nx;
    cube.mesh.position.z = nz;
    if (cube.cellule) {            // le collider suit le cube au centimètre près
      cube.cellule.x = nx;
      cube.cellule.z = nz;
    }
    cube.vx *= frottement;
    cube.vz *= frottement;
    enMouvement++;
  }

  return enMouvement;
}

/**
 * Réponse du véhicule qui pousse un cube.
 *
 * Contre un mur la voiture rebondit ; contre un cube elle doit le SUIVRE : sa
 * vitesse vers le cube est ramenée à celle du cube, sans rebond. Sinon pousser
 * devenait un va-et-vient — rebond, amortissement, puis marche arrière auto.
 *
 * @param {{ x: number, z: number }} velocity — vitesse du véhicule
 * @param {{ x: number, z: number }} pushBack — dégagement renvoyé par checkTerrain
 * @param {object|null} cube — cube poussé ({ vx, vz }) ; null = cube immobile
 * @returns {{ x: number, z: number }} nouvelle vitesse du véhicule
 */
export function suivreCube(velocity, pushBack, cube) {
  const len = Math.sqrt(pushBack.x ** 2 + pushBack.z ** 2);
  if (len < 1e-4) return { x: velocity.x, z: velocity.z };

  // Direction du véhicule vers le cube (opposée au dégagement)
  const nx = -pushBack.x / len;
  const nz = -pushBack.z / len;

  const versCube = velocity.x * nx + velocity.z * nz;
  const vCube    = cube ? cube.vx * nx + cube.vz * nz : 0;
  if (versCube <= vCube) return { x: velocity.x, z: velocity.z };

  const exces = versCube - vCube;
  return { x: velocity.x - nx * exces, z: velocity.z - nz * exces };
}
