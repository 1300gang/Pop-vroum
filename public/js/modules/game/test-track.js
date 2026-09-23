// Piste de mesure — ligne droite calibrée pour régler le game feel des sauts.
//
// Rien de procédural ici : le tracé est fixe pour qu'une même conduite donne
// toujours le même résultat, et que deux réglages puissent être comparés.
//
// Enchaînement : élan → tremplin doux → zone de mesure → tremplin moyen →
// zone de mesure → tremplin raide → longue réception.
// Les trois tremplins montent tous à la même hauteur (élévation 1) mais sur des
// longueurs différentes : plus la rampe est courte, plus la montée est raide,
// donc plus le décollage est violent à vitesse égale.
//
// Contrat I/O : JSON out — { map, reperes }, la map ayant la même forme que
// celle produite par map-generator.generate().

const TAILLE           = 8;
const LIGNES_OUVERTES  = [2, 3, 4, 5];   // couloir central, murs de part et d'autre
const GX_RAMPE         = 2;              // colonne où commence chaque tremplin

// Depuis le 22/09/2026 map-loader ne pivote plus rien : la rotation se fait une
// seule fois sur le pool, à son chargement. Les pistes construites ici n'entrent
// pas par le pool, elles s'écrivent donc directement dans le repère du jeu et
// _rotate90CCW n'a plus lieu d'être — elle décalait la piste d'un quart de tour.
const _DIR_CCW = { N: 'O', O: 'S', S: 'E', E: 'N' };

function _rotate90CCW(grid, _remplissage = null) {
  return grid; // plus de rotation en aval : la piste est déjà dans le bon repère
}

function _rotate90CCW_ancien(grid, remplissage = null) {
  const n      = grid.length;
  const result = Array.from({ length: n }, () => Array(n).fill(remplissage));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let cell = grid[j][n - 1 - i];
      if (cell && typeof cell === 'object' && cell.direction) {
        cell = { ...cell, direction: _DIR_CCW[cell.direction] ?? cell.direction };
      }
      // Miroir du traitement de map-loader : les rampes en chaîne portent leur
      // direction dans leur nom, elle doit tourner avec la grille.
      if (typeof cell === 'string') {
        const m = /^ramp_([nseo])$/.exec(cell);
        if (m) cell = `ramp_${(_DIR_CCW[m[1].toUpperCase()] ?? '').toLowerCase()}`;
      }
      result[i][j] = cell;
    }
  }
  return result;
}

function _grilleCouloir() {
  const grid = [];
  for (let gz = 0; gz < TAILLE; gz++) {
    const ouverte = LIGNES_OUVERTES.includes(gz);
    grid.push(Array.from({ length: TAILLE }, () => (ouverte ? null : 'dur')));
  }
  return grid;
}

function _grilleZero() {
  return Array.from({ length: TAILLE }, () => Array(TAILLE).fill(0));
}

function _blocPlat(id, name) {
  return { id, name, exits: ['E', 'O'], grid: _grilleCouloir(), elevationGrid: _grilleZero() };
}

// Tremplin réparti sur `nbCellules` : la pente est continue de 0 à 1, puis le
// sol retombe à 0 juste après — c'est cette rupture qui fait décoller.
function _blocTremplin(id, name, nbCellules) {
  const grid = _grilleCouloir();

  for (let k = 0; k < nbCellules; k++) {
    for (const gz of LIGNES_OUVERTES) {
      grid[gz][GX_RAMPE + k] = {
        type:            'rampe_pente',
        direction:       'E',
        elevation_start: k / nbCellules,
        elevation_end:   (k + 1) / nbCellules,
      };
    }
  }

  return { id, name, exits: ['E', 'O'], grid, elevationGrid: _grilleZero(), nbCellules };
}

// Pose une valeur sur toute la largeur du couloir, des colonnes gxA à gxB.
function _poser(grid, gxA, gxB, valeur) {
  for (let gx = gxA; gx <= gxB; gx++) {
    for (const gz of LIGNES_OUVERTES) {
      grid[gz][gx] = typeof valeur === 'function' ? valeur() : valeur;
    }
  }
}

// Bloc « vitrine » : une seule famille d'effet, pour la piste catalogue.
function _blocEffet(id, name, remplir) {
  const grid          = _grilleCouloir();
  const elevationGrid = _grilleZero();
  remplir(grid, elevationGrid);
  return { id, name, exits: ['E', 'O'], grid, elevationGrid };
}

// Séquence des blocs, d'ouest en est.
const SEQUENCE = [
  { plat: true,  nom: 'Élan' },
  { plat: true,  nom: 'Élan' },
  { cellules: 3, nom: 'Tremplin doux' },
  { plat: true,  nom: 'Mesure' },
  { cellules: 2, nom: 'Tremplin moyen' },
  { plat: true,  nom: 'Mesure' },
  { cellules: 1, nom: 'Tremplin raide' },
  { plat: true,  nom: 'Réception' },
  { plat: true,  nom: 'Réception' },
];

const PAS_REPERE   = 4;    // un repère tous les 4 u après chaque tremplin
const PORTEE_MAX   = 40;   // distance couverte par les repères (le grand saut porte à ~31 u)

/**
 * Construit la piste de mesure.
 *
 * @param {number} blockScale — unités monde par cellule
 * @returns {{ map: object, reperes: Array<{ x: number, z: number, label: string }> }}
 */
export function construirePisteMesure(blockScale = 2) {
  const tailleBloc = TAILLE * blockScale;
  const blocks     = [];
  const reperes    = [];

  SEQUENCE.forEach((etape, col) => {
    const id   = etape.plat ? `piste_plat_${col}` : `piste_tremplin_${col}`;
    const bloc = etape.plat
      ? _blocPlat(id, etape.nom)
      : _blocTremplin(id, etape.nom, etape.cellules);

    blocks.push({
      blockId:       bloc.id,
      name:          bloc.name,
      col, row:      0,
      position:      [col * tailleBloc, 0],
      grid:          _rotate90CCW(bloc.grid, null),
      elevationGrid: _rotate90CCW(bloc.elevationGrid, 0),
    });

    // Repères de distance à partir du bord de fuite du tremplin
    if (!etape.plat) {
      const xLevre = col * tailleBloc + (GX_RAMPE + etape.cellules) * blockScale;
      for (let d = PAS_REPERE; d <= PORTEE_MAX; d += PAS_REPERE) {
        reperes.push({ x: xLevre + d, z: tailleBloc / 2, label: `${d}` });
      }
    }
  });

  const largeurTotale = SEQUENCE.length * tailleBloc;
  const centreZ       = tailleBloc / 2;
  const depart        = { x: blockScale * 1.5, z: centreZ };
  const arrivee       = { x: largeurTotale - blockScale * 1.5, z: centreZ };

  const map = {
    id:         'piste_mesure',
    gridCols:   SEQUENCE.length,
    gridRows:   1,
    blockScale,
    blocks,
    // angle 0 = Est : toute la piste se court dans l'axe +X
    startPosition:  { x: depart.x,  z: depart.z, angle: 0 },
    finishPosition: { x: arrivee.x, z: arrivee.z },
    entry: {
      blockCol: 0, blockRow: 0,
      worldCenter:    { x: tailleBloc / 2, z: centreZ },
      spawnPositions: [{ x: depart.x, z: depart.z, angle: 0 }],
    },
    exit: {
      blockCol: SEQUENCE.length - 1, blockRow: 0,
      worldCenter: { x: largeurTotale - tailleBloc / 2, z: centreZ },
    },
    worldExtent: { width: largeurTotale, depth: tailleBloc },
  };

  return { map, reperes };
}

// ---- Piste catalogue : une section par effet ----

// Chaque entrée = un bloc de 8×8. `remplir` pose l'effet dans le couloir ;
// `note` est affichée au sol à l'entrée de la section.
const SECTIONS_EFFETS = [
  { nom: 'DÉPART',    note: 'élan',                remplir: null },
  { nom: 'BOOST',     note: 'accélère — la vue se resserre', remplir: g => _poser(g, 2, 5, 'boost') },
  { nom: 'COLLANT',   note: 'freine — la vue s\'élargit', remplir: g => _poser(g, 2, 5, 'sticky') },
  { nom: 'BOSSES',    note: 'impulsion verticale',  remplir: g => {
      for (const [gz, gx] of [[2, 2], [4, 3], [3, 5], [5, 6]]) g[gz][gx] = 'bump';
    } },
  { nom: 'RAMPE-BOSSE', note: 'ralentisseurs bombés', remplir: g => {
      for (const [gz, gx] of [[3, 3], [4, 3], [3, 5], [4, 5]]) g[gz][gx] = 'rampe_bosse';
    } },
  { nom: 'RAMPE + PLATEAU', note: 'monte, roule en haut, décolle', remplir: (g, e) => {
      // Rampe bleue → plateau → relanceur. Sans ce dernier, traverser le plateau
      // à plat efface l'élan vertical de la montée : quitter le bord n'était
      // qu'une chute d'un mètre, pas un saut.
      _poser(g, 2, 2, 'ramp_e');
      for (const gz of LIGNES_OUVERTES) {
        g[gz][5] = { type: 'rampe_pente', direction: 'E', elevation_start: 1, elevation_end: 1.7 };
      }
      for (const gx of [3, 4, 5]) for (const gz of LIGNES_OUVERTES) e[gz][gx] = 1;
    } },
  { nom: 'RÉCEPTION', note: 'on retombe du plateau', remplir: null },
  { nom: 'TREMPLIN',  note: 'saut — la pente débouche sur le vide', remplir: g => {
      for (const gz of LIGNES_OUVERTES) {
        g[gz][2] = { type: 'rampe_pente', direction: 'E', elevation_start: 0,   elevation_end: 0.5 };
        g[gz][3] = { type: 'rampe_pente', direction: 'E', elevation_start: 0.5, elevation_end: 1   };
      }
    } },
  { nom: 'POTEAUX',   note: 'cassent si le choc est fort', remplir: g => {
      for (const [gz, gx] of [[3, 2], [5, 3], [2, 4], [4, 5], [3, 6]]) g[gz][gx] = 'pole';
    } },
  { nom: 'CUBES',     note: 'un cube dans l\'axe, deux à côté', remplir: g => {
      // Un seul cube sur la ligne de conduite (rangée 4) : avec plusieurs, la
      // voiture les ramassait en un train qu'elle poussait jusqu'au bout de la
      // map, et l'arrivée devenait inatteignable. Les deux cubes décalés se
      // testent en braquant dessus.
      for (const [gz, gx] of [[4, 3], [3, 5], [5, 5]]) g[gz][gx] = 'movable';
    } },
  { nom: 'CUBES (suite)', note: 'le premier cube vient percuter le second', remplir: g => {
      for (const [gz, gx] of [[4, 4], [2, 2]]) g[gz][gx] = 'movable';
    } },
  { nom: 'ARRIVÉE',   note: '',                     remplir: null },
];

/**
 * Construit la piste catalogue : un bloc par effet, chacun annoncé au sol.
 *
 * @param {number} blockScale — unités monde par cellule
 * @returns {{ map: object, reperes: Array<{ x, z, label, type }> }}
 */
export function construirePisteEffets(blockScale = 2) {
  const tailleBloc = TAILLE * blockScale;
  const blocks     = [];
  const reperes    = [];

  SECTIONS_EFFETS.forEach((section, col) => {
    const bloc = section.remplir
      ? _blocEffet(`piste_effet_${col}`, section.nom, section.remplir)
      : _blocPlat(`piste_effet_${col}`, section.nom);

    blocks.push({
      blockId:       bloc.id,
      name:          bloc.name,
      col, row:      0,
      position:      [col * tailleBloc, 0],
      grid:          _rotate90CCW(bloc.grid, null),
      elevationGrid: _rotate90CCW(bloc.elevationGrid, 0),
    });

    // Nom de la section, posé juste avant qu'on y entre
    reperes.push({
      x:     col * tailleBloc + blockScale,
      z:     tailleBloc / 2,
      label: section.nom,
      type:  'section',
    });
    if (section.note) {
      reperes.push({
        x:     col * tailleBloc + blockScale * 2.6,
        z:     tailleBloc / 2,
        label: section.note,
        type:  'note',
      });
    }
  });

  const largeurTotale = SECTIONS_EFFETS.length * tailleBloc;
  // Ligne de conduite calée sur le centre de la rangée 4 : les obstacles posés sur
  // cette rangée sont pile dans l'axe. Au milieu exact du bloc (z = 8), la voiture
  // roulait sur la frontière de deux rangées et passait entre les poteaux sans
  // jamais les toucher depuis qu'ils ont leur vrai collider.
  const centreZ       = tailleBloc / 2 + blockScale / 2;

  return {
    map: {
      id:       'piste_effets',
      gridCols: SECTIONS_EFFETS.length,
      gridRows: 1,
      blockScale,
      blocks,
      startPosition:  { x: blockScale * 1.5, z: centreZ, angle: 0 },
      finishPosition: { x: largeurTotale - blockScale * 1.5, z: centreZ },
      entry: {
        blockCol: 0, blockRow: 0,
        worldCenter:    { x: tailleBloc / 2, z: centreZ },
        spawnPositions: [{ x: blockScale * 1.5, z: centreZ, angle: 0 }],
      },
      exit: {
        blockCol: SECTIONS_EFFETS.length - 1, blockRow: 0,
        worldCenter: { x: largeurTotale - tailleBloc / 2, z: centreZ },
      },
      worldExtent: { width: largeurTotale, depth: tailleBloc },
    },
    reperes,
  };
}

// ---- Arène des pouvoirs (test-v6-pouvoirs.html) ----
//
// Les pouvoirs sont altruistes : ils ne se jugent qu'à plusieurs, et seulement
// si on voit ce qui se passe. Un labyrinthe procédural cache tout — d'où une
// arène ouverte, avec juste assez de piliers pour éprouver le double tranchant
// (« un véhicule trop rouge pousse ses coéquipier·ères dans les murs »).

// Piliers 2×2 posés dans chaque bloc, décalés d'un bloc à l'autre pour ne pas
// former de couloir régulier. Coordonnées en cellules dans la grille 8×8.
const _PILIERS = [
  [[2, 2]],
  [[5, 4]],
  [[3, 5], [6, 1]],
  [],
];

/**
 * Construit une arène carrée et ouverte pour le calibrage des pouvoirs.
 *
 * @param {number} blockScale — unités monde par cellule
 * @param {number} cote       — côté de l'arène en blocs
 * @returns {{ map: object }}
 */
export function construireArenePouvoirs(blockScale = 2, cote = 3) {
  const tailleBloc = TAILLE * blockScale;
  const blocks     = [];

  for (let col = 0; col < cote; col++) {
    for (let row = 0; row < cote; row++) {
      const grid = Array.from({ length: TAILLE }, () => Array(TAILLE).fill(null));

      // Pas de pilier dans le bloc de départ : on veut de l'espace pour lancer
      const estDepart = col === 0 && row === Math.floor(cote / 2);
      if (!estDepart) {
        for (const [gz, gx] of _PILIERS[(col + row) % _PILIERS.length]) {
          grid[gz][gx]         = 'dur';
          grid[gz][gx + 1]     = 'dur';
          grid[gz + 1][gx]     = 'dur';
          grid[gz + 1][gx + 1] = 'dur';
        }
      }

      blocks.push({
        blockId:       `arene_${col}_${row}`,
        name:          `Arène ${col},${row}`,
        col, row,
        position:      [col * tailleBloc, row * tailleBloc],
        grid:          _rotate90CCW(grid, null),
        elevationGrid: _rotate90CCW(_grilleZero(), 0),
      });
    }
  }

  const rowCentre = Math.floor(cote / 2);
  const centreZ   = rowCentre * tailleBloc + tailleBloc / 2;
  const largeur   = cote * tailleBloc;
  const depart    = { x: blockScale * 2, z: centreZ, angle: 0 };

  // Cinq points de spawn en éventail : le joueur et jusqu'à quatre bots
  const spawnPositions = [0, 1.8, -1.8, 3.6, -3.6].map(dz => ({
    x: depart.x, z: centreZ + dz, angle: 0,
  }));

  return {
    map: {
      id:       'arene_pouvoirs',
      gridCols: cote,
      gridRows: cote,
      blockScale,
      blocks,
      startPosition:  depart,
      finishPosition: { x: largeur - blockScale * 2, z: centreZ },
      entry: {
        blockCol: 0, blockRow: rowCentre,
        worldCenter: { x: tailleBloc / 2, z: centreZ },
        spawnPositions,
      },
      exit: {
        blockCol: cote - 1, blockRow: rowCentre,
        worldCenter: { x: largeur - tailleBloc / 2, z: centreZ },
      },
      worldExtent: { width: largeur, depth: cote * tailleBloc },
    },
  };
}
