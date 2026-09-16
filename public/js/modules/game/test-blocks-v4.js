// Blocs de test V4 — banc d'essai déterministe pour la MAJ V4.
//
// Objectif : pouvoir vérifier à l'œil, sans chercher une rampe au hasard dans
// une map procédurale, que :
//   – une rampe monte bien dans la direction annoncée par son nom (V4-02) ;
//   – le véhicule monte progressivement et reste en haut sur le plateau (V4-03) ;
//   – les bosses provoquent bien une impulsion (V4-01) ;
//   – une rampe reste alignée avec son plateau dans les 4 orientations, le
//     générateur pivotant les blocs au hasard (V4-02, rotation).
//
// Contrat I/O : JSON out — mêmes champs qu'un bloc seed
// ({ id, name, exits, grid, elevationGrid }), consommable tel quel par
// map-generator.generate() via { ...poolData, pool: V4_TEST_BLOCKS }.

// Légende des grilles (ligne 0 = Nord, colonne 0 = Ouest) :
//   #  mur dur                     .  route, élévation 0
//   P  plateau (route, élévation 1)
//   N  ramp_n   S  ramp_s   E  ramp_e   O  ramp_o      (rampes SOLO-04)
//   n  rampe_pente direction N        s  rampe_pente direction S   (RACE-C04)
//   o  bosse (bump)

const _rampePente = (direction, elevation_start = 0, elevation_end = 1) => ({
  type: 'rampe_pente',
  direction,
  elevation_start,
  elevation_end,
});

// Fabriques : une cellule neuve par case, jamais de référence partagée entre
// deux cases (la rotation de bloc recrée les objets, mais un bloc non pivoté
// garderait sinon la même instance sur toute une rangée).
const _CELLULES = {
  '#': () => 'dur',
  '.': () => null,
  'P': () => null,
  'N': () => 'ramp_n',
  'S': () => 'ramp_s',
  'E': () => 'ramp_e',
  'O': () => 'ramp_o',
  'n': () => _rampePente('N'),
  's': () => _rampePente('S'),
  'a': () => _rampePente('S', 0,   0.5),
  'b': () => _rampePente('S', 0.5, 1),
  'o': () => 'bump',
};

const _ELEVATIONS = { P: 1 };

/**
 * Convertit une grille écrite en légende ASCII en { grid, elevationGrid }.
 * @param {string[]} lignes — 8 chaînes de 8 caractères
 */
function _parseGrille(lignes) {
  const grid          = [];
  const elevationGrid = [];

  for (const ligne of lignes) {
    const cases = [...ligne];
    grid.push(cases.map(c => {
      const fabrique = _CELLULES[c];
      if (!fabrique) throw new Error(`test-blocks-v4 : caractère inconnu "${c}"`);
      return fabrique();
    }));
    elevationGrid.push(cases.map(c => _ELEVATIONS[c] ?? 0));
  }

  return { grid, elevationGrid };
}

// Direction de montée d'une cellule de rampe, en axes monde [dx, dz].
const _MONTEE = { N: [0, -1], S: [0, 1], E: [1, 0], O: [-1, 0] };

function _directionRampe(cell) {
  if (typeof cell === 'string') {
    const m = /^ramp_([nseo])$/.exec(cell);
    return m ? m[1].toUpperCase() : null;
  }
  if (cell && typeof cell === 'object' && cell.type === 'rampe_pente') {
    return cell.direction ?? null;
  }
  return null;
}

/**
 * Cherche la première rampe de la map et retourne un point de spawn placé
 * deux cellules en contrebas, orienté face à la montée.
 *
 * Sans ça le banc n'a aucun intérêt : il faut sillonner la map au hasard en
 * espérant croiser une rampe.
 *
 * Les blocs doivent être ceux que voit la collision, c'est-à-dire déjà pivotés
 * par map-loader : calculé sur les grilles d'origine, le point tombait ailleurs
 * une fois la grille tournée, souvent dans un mur.
 *
 * @param {{ blockScale: number, blocks: Array<{ position: [number, number], grid: any[][] }> }} map
 * @param {(candidat: { x: number, z: number, angle: number }) => boolean} [estLibre]
 *   vérifie que la carrosserie entière tient à cet endroit
 * @returns {{ x: number, z: number, angle: number } | null}
 */
export function trouverSpawnRampe(map, estLibre = () => true) {
  const cs = map?.blockScale ?? 1;

  for (const bloc of map?.blocks ?? []) {
    const [bx, bz] = bloc.position;
    for (let gz = 0; gz < 8; gz++) {
      for (let gx = 0; gx < 8; gx++) {
        const direction = _directionRampe(bloc.grid?.[gz]?.[gx]);
        if (!direction) continue;

        const [dx, dz] = _MONTEE[direction];

        // On recule dans le sens inverse de la montée jusqu'à trouver une case
        // de route libre : près d'un bord de bloc, le contrebas peut être un mur.
        for (const recul of [2, 1]) {
          const cgx = gx - dx * recul;
          const cgz = gz - dz * recul;
          if (cgx < 0 || cgx > 7 || cgz < 0 || cgz > 7) continue;
          if (bloc.grid?.[cgz]?.[cgx] !== null) continue;          // mur ou obstacle
          if ((bloc.elevationGrid?.[cgz]?.[cgx] ?? 0) !== 0) continue; // déjà en haut

          const candidat = {
            x:     bx + cgx * cs + cs / 2,
            z:     bz + cgz * cs + cs / 2,
            // Convention du pipeline V2 (physics.decompose) : forward = (cos, sin)
            // → angle 0 = Est (+X), π/2 = Sud (+Z), -π/2 = Nord (−Z).
            angle: Math.atan2(dz, dx),
          };
          // Le centre de la case peut être libre alors que l'avant ou l'arrière
          // de la voiture mord sur un mur : on vérifie toute la carrosserie.
          if (!estLibre(candidat)) continue;
          return candidat;
        }
      }
    }
  }
  return null;
}

export const V4_TEST_BLOCKS = [
  {
    id:    'block_v4_rampes_ns',
    name:  'V4 · Rampes N/S + plateau',
    exits: ['N', 'S'],
    ..._parseGrille([
      '##....##',
      '#......#',
      '#.SSSS.#',
      '#.PPPP.#',
      '#.PPPP.#',
      '#.NNNN.#',
      '#......#',
      '##....##',
    ]),
  },
  {
    id:    'block_v4_rampes_eo',
    name:  'V4 · Rampes E/O + plateau',
    exits: ['E', 'O'],
    ..._parseGrille([
      '########',
      '#......#',
      '#.EPPO.#',
      '..EPPO..',
      '..EPPO..',
      '#.EPPO.#',
      '#......#',
      '########',
    ]),
  },
  {
    id:    'block_v4_bosses',
    name:  'V4 · Bosses (carrefour)',
    exits: ['N', 'S', 'E', 'O'],
    ..._parseGrille([
      '##....##',
      '#..o...#',
      '.....o..',
      '..o.....',
      '....o...',
      '.o....o.',
      '#..o...#',
      '##....##',
    ]),
  },
  {
    id:    'block_v4_tremplin',
    name:  'V4 · Tremplin (saut)',
    exits: ['N', 'S'],
    // La rampe débouche directement sur le vide : en la quittant, le sol se
    // dérobe et le véhicule part en l'air avec l'élan de la montée. Plus il
    // arrive vite, plus il saute loin.
    ..._parseGrille([
      '##....##',
      '#......#',
      '#.SSSS.#',
      '#......#',
      '#......#',
      '#......#',
      '#......#',
      '##....##',
    ]),
  },
  {
    id:    'block_v4_tremplin_pente',
    name:  'V4 · Tremplin rampe_pente (saut)',
    exits: ['N', 'S'],
    // Pente continue sur deux cellules puis le vide : décollage plus doux et
    // plus long que le tremplin à une cellule.
    ..._parseGrille([
      '##....##',
      '#......#',
      '#.aaaa.#',
      '#.bbbb.#',
      '#......#',
      '#......#',
      '#......#',
      '##....##',
    ]),
  },
  {
    id:    'block_v4_rampe_pente',
    name:  'V4 · Rampe_pente RACE-C04 (comparaison)',
    exits: ['N', 'S'],
    ..._parseGrille([
      '##....##',
      '#......#',
      '#.ssss.#',
      '#.PPPP.#',
      '#.PPPP.#',
      '#.nnnn.#',
      '#......#',
      '##....##',
    ]),
  },
];
