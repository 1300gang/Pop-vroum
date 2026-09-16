// Détection du terrain sous le véhicule et collisions avec blocs durs.
//
// Contrat I/O :
//   checkTerrain(pos, blocks, cellSize, vehicleElevation, forme?)
//     → { softTerrain, rampe, hardCollision, hardCellType, pushBack, elevationTarget }
//
//   softTerrain     : 'sticky' | 'boost' | 'bump' | 'rampe_bosse' | rampes | null
//   hardCollision   : true si la carrosserie touche un obstacle
//   pushBack        : { x, z } vecteur qui dégage le véhicule (ou null)
//   forme           : { angle, demiLongueur, demiLargeur } — carrosserie réelle
//
// Deux empreintes distinctes :
//   – APPUI (cercle VEHICLE_RADIUS) : ce qui est sous les roues — sol, rampes,
//     bosses, boost. Toute la physique de saut est réglée dessus.
//   – CONTACT (boîte orientée `forme`) : ce que la carrosserie percute. Chaque
//     obstacle garde sa vraie forme : cercle pour un poteau, boîte pour un cube,
//     case pleine pour un mur.
//
// RACE-C03 : les bords de plateau (transition élévation 0→1) agissent comme des murs.
//   vehicleElevation (défaut 0) : si une cellule a une élévation supérieure à celle du
//   véhicule, elle est traitée comme un mur dur quelle que soit son type.
//
// Chaque bloc a { position: [worldX, worldZ], grid: 8×8, elevationGrid?: 8×8 }.
// Les grilles sont déjà rotées par map-loader (déplacement en +X).
// cellSize = blockScale (unités monde par cellule, défaut 1 pour rétrocompatibilité).

// Empreinte d'APPUI du véhicule (ce qui est sous ses roues : rampes, plateaux,
// bosses, boost…). Volontairement petite : c'est elle qui décide quand le sol se
// dérobe, toute la physique de saut est réglée dessus.
export const VEHICLE_RADIUS = 0.65;
const BLOCK_SIZE = 8;

// Dimensions des obstacles en fraction de cellule. Exportées pour que les meshes
// du jeu les utilisent : collider et visuel ne peuvent plus diverger.
export const POLE_RADIUS_RATIO = 0.06;
export const CUBE_SIZE_RATIO   = 0.8;

// Rampes directionnelles simples (SOLO-04) — élévation 0 → 1 sur la cellule.
const _EST_RAMPE_DIR = new Set(['ramp_n', 'ramp_s', 'ramp_e', 'ramp_o']);

// Retourne le type string d'une cellule (string ou objet { type, ... })
function _typeOf(cell) {
  if (!cell) return null;
  if (typeof cell === 'object') return cell.type ?? null;
  return cell;
}

// Fenêtre de cellules couvertes par un rayon autour du véhicule (null si hors bloc).
function _bornesCellules(pos, bloc, cellSize, rayon) {
  const [bx, bz]   = bloc.position;
  const blocExtent = BLOCK_SIZE * cellSize;

  if (pos.x + rayon < bx || pos.x - rayon > bx + blocExtent) return null;
  if (pos.z + rayon < bz || pos.z - rayon > bz + blocExtent) return null;

  return {
    bx, bz,
    gxMin: Math.max(0, Math.floor((pos.x - rayon - bx) / cellSize)),
    gxMax: Math.min(BLOCK_SIZE - 1, Math.floor((pos.x + rayon - bx) / cellSize)),
    gzMin: Math.max(0, Math.floor((pos.z - rayon - bz) / cellSize)),
    gzMax: Math.min(BLOCK_SIZE - 1, Math.floor((pos.z + rayon - bz) / cellSize)),
  };
}

// ---- Contact carrosserie : boîte orientée à la taille réelle du véhicule ----

/**
 * Normalise la forme de contact. Sans forme (bots, serveur, anciennes pages) on
 * retombe sur un carré de demi-côté VEHICLE_RADIUS, aligné sur les axes.
 */
function _formeContact(forme) {
  const angle = forme?.angle ?? 0;
  const hl    = forme?.demiLongueur ?? VEHICLE_RADIUS;
  const hw    = forme?.demiLargeur  ?? VEHICLE_RADIUS;
  return {
    ux: Math.cos(angle),  uz: Math.sin(angle),    // axe avant (convention physics.decompose)
    vx: -Math.sin(angle), vz: Math.cos(angle),    // axe latéral
    hl, hw,
    rayon: Math.sqrt(hl * hl + hw * hw),           // rayon englobant, pour la fenêtre
  };
}

/**
 * Boîte orientée (véhicule) contre boîte alignée (mur, cube) — théorème des axes
 * séparateurs sur 4 axes. Renvoie le vecteur qui dégage le VÉHICULE, ou null.
 */
function _boiteContreBoite(pos, f, cx, cz, bx, bz) {
  const dx = pos.x - cx;
  const dz = pos.z - cz;
  let recouvrementMin = Infinity;
  let nx = 0, nz = 0;

  for (const [ax, az] of [[1, 0], [0, 1], [f.ux, f.uz], [f.vx, f.vz]]) {
    const rVehicule = f.hl * Math.abs(f.ux * ax + f.uz * az) + f.hw * Math.abs(f.vx * ax + f.vz * az);
    const rObstacle = bx * Math.abs(ax) + bz * Math.abs(az);
    const d         = dx * ax + dz * az;
    const recouvrement = rVehicule + rObstacle - Math.abs(d);
    if (recouvrement <= 0) return null;           // axe séparateur trouvé : pas de contact
    if (recouvrement < recouvrementMin) {
      recouvrementMin = recouvrement;
      const sens = d >= 0 ? 1 : -1;               // de l'obstacle vers le véhicule
      nx = ax * sens;
      nz = az * sens;
    }
  }
  return { x: nx * recouvrementMin, z: nz * recouvrementMin };
}

/**
 * Boîte orientée (véhicule) contre cercle (poteau). Renvoie le vecteur qui dégage
 * le VÉHICULE, ou null.
 */
function _boiteContreCercle(pos, f, px, pz, r) {
  // Poteau exprimé dans le repère du véhicule
  const dx = px - pos.x;
  const dz = pz - pos.z;
  const lx = dx * f.ux + dz * f.uz;
  const lz = dx * f.vx + dz * f.vz;

  const procheX = Math.max(-f.hl, Math.min(f.hl, lx));
  const procheZ = Math.max(-f.hw, Math.min(f.hw, lz));
  const ex = lx - procheX;
  const ez = lz - procheZ;
  const dist = Math.sqrt(ex * ex + ez * ez);

  if (dist >= r) return null;

  if (dist > 1e-4) {
    // On recule le véhicule à l'opposé du poteau
    const pen = r - dist;
    const wx  = (ex * f.ux + ez * f.vx) / dist;
    const wz  = (ex * f.uz + ez * f.vz) / dist;
    return { x: -wx * pen, z: -wz * pen };
  }

  // Poteau déjà dans la carrosserie : on ressort par l'axe le moins enfoncé
  const penAvant   = f.hl - Math.abs(lx) + r;
  const penLateral = f.hw - Math.abs(lz) + r;
  if (penAvant < penLateral) {
    const sens = lx >= 0 ? -1 : 1;
    return { x: f.ux * sens * penAvant, z: f.uz * sens * penAvant };
  }
  const sens = lz >= 0 ? -1 : 1;
  return { x: f.vx * sens * penLateral, z: f.vz * sens * penLateral };
}

// Élévation desservie par une cellule de rampe (null si ce n'est pas une rampe).
function _sommetRampe(cell, cellType) {
  if (cellType === 'rampe_pente' && typeof cell === 'object') {
    return Math.max(cell.elevation_start ?? 0, cell.elevation_end ?? 1);
  }
  if (_EST_RAMPE_DIR.has(cellType)) return 1;
  return null;
}

// Écart d'élévation en dessous duquel on considère que le véhicule roule sur la
// rampe. Au-delà, c'est qu'il en heurte le flanc ou l'arrière : elle fait mur.
const _TOLERANCE_RAMPE = 0.35;

// Sens de montée d'une rampe, en axes monde.
const _MONTEE = { N: [0, -1], S: [0, 1], E: [1, 0], O: [-1, 0] };

/**
 * Géométrie de la pente sous le véhicule : sens de montée + dénivelé par unité
 * de distance (en niveaux d'élévation, l'appelant convertit en unités monde).
 * Permet d'appliquer la gravité le long de la pente au vecteur vitesse, au lieu
 * de plaquer une hauteur sur un mouvement horizontal inchangé.
 */
function _geometrieRampe(cell, cellType, cellSize) {
  if (cellType === 'rampe_pente' && typeof cell === 'object') {
    const { direction = 'E', elevation_start = 0, elevation_end = 1 } = cell;
    const [dx, dz] = _MONTEE[direction] ?? _MONTEE.E;
    return { dirX: dx, dirZ: dz, penteElev: (elevation_end - elevation_start) / cellSize };
  }
  if (_EST_RAMPE_DIR.has(cellType)) {
    const [dx, dz] = _MONTEE[cellType.slice(-1).toUpperCase()] ?? _MONTEE.E;
    return { dirX: dx, dirZ: dz, penteElev: 1 / cellSize };
  }
  return null;
}

function _progressionRampe(direction, pos, cellX, cellZ, cellSize) {
  const fx = Math.max(0, Math.min(1, (pos.x - cellX) / cellSize));
  const fz = Math.max(0, Math.min(1, (pos.z - cellZ) / cellSize));
  return direction === 'E' ? fx
       : direction === 'O' ? 1 - fx
       : direction === 'S' ? fz
       : /* N */             1 - fz;
}

/**
 * Hauteur de la surface de rampe à l'aplomb du véhicule (null hors rampe).
 *
 * C'est la hauteur LOCALE, pas le sommet : elle vaut ~0 du côté bas et ~1 du
 * côté haut. C'est ce qui permet de distinguer « je monte la rampe » de
 * « je percute son dos ».
 */
function _hauteurRampe(cell, cellType, pos, cellX, cellZ, cellSize) {
  if (cellType === 'rampe_pente' && typeof cell === 'object') {
    const { direction = 'E', elevation_start = 0, elevation_end = 1 } = cell;
    const p = _progressionRampe(direction, pos, cellX, cellZ, cellSize);
    return elevation_start + p * (elevation_end - elevation_start);
  }
  if (_EST_RAMPE_DIR.has(cellType)) {
    const direction = cellType.slice(-1).toUpperCase();
    return _progressionRampe(direction, pos, cellX, cellZ, cellSize);
  }
  return null;
}

/**
 * V4-03 : niveau auquel le véhicule a droit.
 *
 * La collision teste le RAYON du véhicule, mais son élévation est celle de son
 * CENTRE. Sur une rampe, le capot touche donc la bordure du plateau bien avant
 * que le centre soit assez haut : sans cette règle le véhicule reste coincé au
 * pied de la rampe et aucun changement de niveau n'est possible. Être sur une
 * rampe donne accès au niveau qu'elle dessert.
 */
function _niveauAutorise(pos, blocks, cellSize, vehicleElevation) {
  let niveau = vehicleElevation;

  for (const bloc of blocks) {
    const b = _bornesCellules(pos, bloc, cellSize, VEHICLE_RADIUS);
    if (!b) continue;

    for (let gz = b.gzMin; gz <= b.gzMax; gz++) {
      for (let gx = b.gxMin; gx <= b.gxMax; gx++) {
        const cell     = bloc.grid[gz]?.[gx];
        const cellType = _typeOf(cell);
        const hauteur  = _hauteurRampe(
          cell, cellType, pos, b.bx + gx * cellSize, b.bz + gz * cellSize, cellSize,
        );
        if (hauteur === null) continue;

        // Seule une rampe qu'on emprunte réellement donne accès à son sommet.
        // Si sa surface locale est nettement au-dessus du véhicule, c'est qu'il
        // arrive par le dos : elle le bloque au lieu de le hisser.
        if (hauteur - vehicleElevation > _TOLERANCE_RAMPE) continue;

        const sommet = _sommetRampe(cell, cellType);
        if (sommet !== null && sommet > niveau) niveau = sommet;
      }
    }
  }
  return niveau;
}

/**
 * @param {{ x: number, z: number }} pos — centre du véhicule
 * @param {Array<{ position: [number, number], grid: any[][], elevationGrid?: number[][] }>} blocks
 * @param {number} [cellSize=1] — taille d'une cellule en unités monde
 * @param {number} [vehicleElevation=0] — élévation courante (0 = sol, 1 = plateau)
 * @param {{ angle: number, demiLongueur: number, demiLargeur: number }} [forme]
 *   carrosserie du véhicule pour les chocs ; sans elle, carré de demi-côté VEHICLE_RADIUS
 */
export function checkTerrain(pos, blocks, cellSize = 1, vehicleElevation = 0, forme = null) {
  let softTerrain     = null;
  let hardCollision   = false;
  let hardCellType    = null; // SOLO-04 : type de la cellule dure percutée
  // Dégagement cumulé : on garde la poussée la plus forte par sens et par axe,
  // pour ne pas pousser deux fois quand la carrosserie longe deux cases de mur.
  let pxPlus = 0, pxMoins = 0, pzPlus = 0, pzMoins = 0;
  // V4 : hauteur du sol réellement sous le véhicule = la plus haute surface qu'il
  // chevauche. Part de 0 : amorcer avec l'élévation du véhicule le maintenait en
  // l'air indéfiniment une fois monté, puisque cette valeur n'est jamais abaissée.
  let elevationTarget = 0;
  let rampe = null;              // pente empruntée (sens + dénivelé)

  const f = _formeContact(forme);
  const elevationAutorisee = _niveauAutorise(pos, blocks, cellSize, vehicleElevation);

  for (const bloc of blocks) {
    // Fenêtre assez large pour la carrosserie ; l'appui est filtré plus bas
    const bornes = _bornesCellules(pos, bloc, cellSize, Math.max(f.rayon, VEHICLE_RADIUS));
    if (!bornes) continue;
    const { bx, bz, gxMin, gxMax, gzMin, gzMax } = bornes;

    for (let gz = gzMin; gz <= gzMax; gz++) {
      for (let gx = gxMin; gx <= gxMax; gx++) {
        const cell          = bloc.grid[gz]?.[gx];
        const cellType      = _typeOf(cell);
        const cellElevation = bloc.elevationGrid?.[gz]?.[gx] ?? 0;

        const cellX = bx + gx * cellSize;
        const cellZ = bz + gz * cellSize;

        // Hauteur de la rampe juste sous le véhicule (null hors rampe)
        const hauteurRampe = _hauteurRampe(cell, cellType, pos, cellX, cellZ, cellSize);
        const isRamp       = hauteurRampe !== null;

        // V4 : rampe abordée par le dos ou par le flanc — sa surface est trop
        // haute par rapport au véhicule, elle doit l'arrêter comme un mur et
        // non le soulever silencieusement.
        const rampeBloque = isRamp && (hauteurRampe - vehicleElevation > _TOLERANCE_RAMPE);

        // RACE-C03 : cellule plus haute que le véhicule = mur, SAUF sur une rampe
        // V4-01 : ramp_n/s/e/o (SOLO-04) suivent la même règle que rampe_pente
        const elevationBloque = (cellElevation > elevationAutorisee && !isRamp) || rampeBloque;

        // La case est-elle sous l'empreinte d'appui ? (fenêtre historique ± VEHICLE_RADIUS)
        const enAppui = cellX < pos.x + VEHICLE_RADIUS && cellX + cellSize > pos.x - VEHICLE_RADIUS
                     && cellZ < pos.z + VEHICLE_RADIUS && cellZ + cellSize > pos.z - VEHICLE_RADIUS;

        // Cellule vide à la même élévation (ou inférieure) = route libre
        if (!cellType && !elevationBloque) {
          if (enAppui && cellElevation > elevationTarget) elevationTarget = cellElevation;
          continue;
        }

        // SOLO-04 : pole et movable bloquent comme dur (effets visuels côté client)
        const isHardCell = cellType === 'dur' || cellType === 'pole' || cellType === 'movable' || elevationBloque;

        if (isHardCell) {
          // Chaque obstacle collisionne avec SA forme, plus avec la case entière
          let push;
          if (cellType === 'pole' && !elevationBloque) {
            push = _boiteContreCercle(pos, f,
              cellX + cellSize / 2, cellZ + cellSize / 2, cellSize * POLE_RADIUS_RATIO);
          } else if (cellType === 'movable' && !elevationBloque) {
            // Le cube glisse en continu : on vise sa position réelle si on la connaît
            const cx   = Number.isFinite(cell?.x) ? cell.x : cellX + cellSize / 2;
            const cz   = Number.isFinite(cell?.z) ? cell.z : cellZ + cellSize / 2;
            const demi = cellSize * CUBE_SIZE_RATIO / 2;
            push = _boiteContreBoite(pos, f, cx, cz, demi, demi);
          } else {
            push = _boiteContreBoite(pos, f,
              cellX + cellSize / 2, cellZ + cellSize / 2, cellSize / 2, cellSize / 2);
          }
          if (!push) continue;

          hardCollision = true;
          if (!hardCellType) hardCellType = cellType;
          if (push.x > 0) pxPlus = Math.max(pxPlus, push.x); else pxMoins = Math.min(pxMoins, push.x);
          if (push.z > 0) pzPlus = Math.max(pzPlus, push.z); else pzMoins = Math.min(pzMoins, push.z);
          continue;
        }

        // Terrains roulants : uniquement sous l'empreinte d'appui (comme avant)
        const closestX = Math.max(cellX, Math.min(pos.x, cellX + cellSize));
        const closestZ = Math.max(cellZ, Math.min(pos.z, cellZ + cellSize));
        const dist     = Math.sqrt((pos.x - closestX) ** 2 + (pos.z - closestZ) ** 2);
        if (dist >= VEHICLE_RADIUS) continue;

        if (isRamp) {
          // RACE-C04 / V4 : le véhicule roule sur la rampe — le sol suit la pente.
          elevationTarget = Math.max(elevationTarget, hauteurRampe);
          if (!softTerrain) softTerrain = cellType;
          if (!rampe) rampe = _geometrieRampe(cell, cellType, cellSize);
        } else if (cellType && !softTerrain) {
          softTerrain = cellType;
          if (cellElevation > elevationTarget) elevationTarget = cellElevation;
        }
      }
    }
  }

  return {
    softTerrain:     hardCollision ? null : softTerrain,
    rampe,
    hardCollision,
    hardCellType,    // SOLO-04 : 'pole' | 'movable' | 'dur' | null
    pushBack:        hardCollision ? { x: pxPlus + pxMoins, z: pzPlus + pzMoins } : null,
    elevationTarget,
  };
}
