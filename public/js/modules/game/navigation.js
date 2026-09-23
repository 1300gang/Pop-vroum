// Navigation dans la map — grille de cellules et champs de distance.
//
// Les bots visaient leur but en ligne droite : la sortie avec un cap fixe en +X,
// le joueur à vol d'oiseau. Dans un labyrinthe, ça revient à foncer dans le
// premier mur. Ce module leur donne une vraie notion de chemin.
//
// Principe : un « champ de distance » donne, pour chaque case, le coût du plus
// court chemin jusqu'à un but en contournant les murs. Un bot n'a plus qu'à
// descendre ce champ, case après case. Un seul calcul sert à tous les bots qui
// visent le même but — c'est ce qui rend l'approche bon marché.
//
// Les coûts ne sont pas uniformes :
//   - les cases collées à un mur coûtent plus cher → les bots restent au milieu
//     des couloirs au lieu de frotter les parois ;
//   - les rampes coûtent plus cher → les bots prennent les voies plates de
//     contournement, ils ne savent pas voler.
//
// Contrat : JSON in, JSON out, aucun DOM, aucun Three.js — importable par Node.

const BLOCK_SIZE = 8;
const BLOQUANTES = new Set(['dur', 'pole', 'movable']);
const RAMPES     = /^(ramp|ramp_[nseo]|rampe_bosse|rampe_pente)$/;
// Sens de montée en axes monde — même table que collision._MONTEE
const MONTEE     = { N: [0, -1], S: [0, 1], E: [1, 0], O: [-1, 0] };

// 8 voisins : [dx, dz, diagonale ?]
const VOISINS = [
  [1, 0, false], [-1, 0, false], [0, 1, false], [0, -1, false],
  [1, 1, true],  [1, -1, true],  [-1, 1, true], [-1, -1, true],
];

const DEFAUTS = {
  coutRampe:  4,     // préférer les voies plates
  coutBosse:  1,
  coutCollant: 1.5,
  coutMur1:   3,     // case touchant un mur
  coutMur2:   0.8,   // case à deux cases d'un mur
};

function _type(cell) {
  if (!cell) return null;
  return typeof cell === 'object' ? cell.type : cell;
}

/**
 * Construit la grille de navigation d'une map (MapData de map-generator).
 *
 * @param {object} map — { blocks, blockScale, gridCols, gridRows }
 * @param {object} [opts] — surcoûts, voir DEFAUTS
 * @returns {object} nav
 */
export function buildNavGrid(map, opts = {}) {
  const o  = { ...DEFAUTS, ...opts };
  const cs = map.blockScale ?? 2;

  let maxCol = 0, maxRow = 0;
  for (const b of map.blocks) { maxCol = Math.max(maxCol, b.col); maxRow = Math.max(maxRow, b.row); }
  const W = Math.max(map.gridCols ?? 0, maxCol + 1) * BLOCK_SIZE;
  const H = Math.max(map.gridRows ?? 0, maxRow + 1) * BLOCK_SIZE;
  const N = W * H;

  const walkable = new Uint8Array(N);    // 0 = mur ou hors bloc
  const surcout  = new Float32Array(N);
  // Sens de montée des rampes orientées (0,0 = case ordinaire). Une rampe ne se
  // gravit que par le bas : abordée par le haut ou par le flanc, elle fait mur.
  // Sans cette information, un bot calculait un chemin à contresens, butait,
  // reculait, recalculait le même chemin… et tournait en rond.
  const montee   = new Int8Array(N * 2);

  for (const b of map.blocks) {
    const c0 = Math.round(b.position[0] / cs);
    const r0 = Math.round(b.position[1] / cs);
    for (let gz = 0; gz < BLOCK_SIZE; gz++) {
      for (let gx = 0; gx < BLOCK_SIZE; gx++) {
        const t    = _type(b.grid[gz]?.[gx]);
        const elev = b.elevationGrid?.[gz]?.[gx] ?? 0;
        if (BLOQUANTES.has(t)) continue;
        const estRampe = !!t && RAMPES.test(t);
        // Plateau sans rampe : une falaise, qu'un bot au sol ne peut pas gravir
        if (elev > 0 && !estRampe) continue;

        const i = (r0 + gz) * W + (c0 + gx);
        walkable[i] = 1;
        const cell = b.grid[gz]?.[gx];
        const sens = t === 'rampe_pente' ? cell.direction
                   : /^ramp_[nseo]$/.test(t ?? '') ? t.slice(-1).toUpperCase() : null;
        if (sens && MONTEE[sens]) {
          montee[i * 2]     = MONTEE[sens][0];
          montee[i * 2 + 1] = MONTEE[sens][1];
        }
        if (estRampe)          surcout[i] += o.coutRampe;
        else if (t === 'bump')   surcout[i] += o.coutBosse;
        else if (t === 'sticky') surcout[i] += o.coutCollant;
      }
    }
  }

  // ---- Dégagement : distance (en cases) au mur le plus proche ----
  // Les bords de la map comptent comme des murs : c'est la clôture.
  const clearance = new Uint8Array(N).fill(255);
  const file = [];
  for (let i = 0; i < N; i++) {
    if (!walkable[i]) { clearance[i] = 0; file.push(i); continue; }
    const x = i % W, z = (i / W) | 0;
    if (x === 0 || z === 0 || x === W - 1 || z === H - 1) { clearance[i] = 1; file.push(i); }
  }
  for (let q = 0; q < file.length; q++) {
    const i = file[q], x = i % W, z = (i / W) | 0;
    const d = clearance[i];
    if (d >= 4) continue;
    for (let k = 0; k < 4; k++) {
      const nx = x + VOISINS[k][0], nz = z + VOISINS[k][1];
      if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
      const j = nz * W + nx;
      if (clearance[j] > d + 1) { clearance[j] = d + 1; file.push(j); }
    }
  }

  // ---- Coût d'entrée dans chaque case ----
  const cout = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (!walkable[i]) continue;
    const c = clearance[i];
    cout[i] = 1 + surcout[i] + (c <= 1 ? o.coutMur1 : c === 2 ? o.coutMur2 : 0);
  }

  // ---- Décalage des points de passage, à l'écart des murs ----
  // Dans un couloir de deux cases, le centre d'une case est à 1 u de l'axe :
  // on repousse le point vers l'axe. Murs des deux côtés → aucun décalage.
  const decalage = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    if (!walkable[i]) continue;
    const x = i % W, z = (i / W) | 0;
    let px = 0, pz = 0;
    for (let k = 0; k < 4; k++) {
      const [dx, dz] = VOISINS[k];
      const nx = x + dx, nz = z + dz;
      const bloque = nx < 0 || nz < 0 || nx >= W || nz >= H || !walkable[nz * W + nx];
      if (bloque) { px -= dx; pz -= dz; }
    }
    decalage[i * 2]     = Math.max(-1, Math.min(1, px)) * 0.5 * cs;
    decalage[i * 2 + 1] = Math.max(-1, Math.min(1, pz)) * 0.5 * cs;
  }

  return { W, H, cs, walkable, clearance, cout, decalage, montee };
}

// Un véhicule peut-il passer de la case `de` à la case `vers` ?
// Seule contrainte : entrer dans une rampe orientée exige d'aller dans son sens
// de montée, et en ligne droite. En sortir (sauter, redescendre sur le côté)
// reste toujours permis.
function _entreePermise(nav, de, vers) {
  const mx = nav.montee[vers * 2], mz = nav.montee[vers * 2 + 1];
  if (mx === 0 && mz === 0) return true;
  const W = nav.W;
  return (vers % W) - (de % W) === mx && ((vers / W) | 0) - ((de / W) | 0) === mz;
}

/** Index de la case sous une position monde, ou -1 hors grille. */
export function cellIndex(nav, x, z) {
  const gx = Math.floor(x / nav.cs), gz = Math.floor(z / nav.cs);
  if (gx < 0 || gz < 0 || gx >= nav.W || gz >= nav.H) return -1;
  return gz * nav.W + gx;
}

/**
 * Case praticable la plus proche d'une position. Un véhicule repoussé contre un
 * mur a souvent son centre sur une case murée : sans ça, il n'aurait plus de
 * chemin du tout.
 */
export function nearestWalkable(nav, x, z, rayon = 3) {
  const i0 = cellIndex(nav, x, z);
  if (i0 >= 0 && nav.walkable[i0]) return i0;
  const gx = Math.floor(x / nav.cs), gz = Math.floor(z / nav.cs);
  let meilleur = -1, dMin = Infinity;
  for (let dz = -rayon; dz <= rayon; dz++) {
    for (let dx = -rayon; dx <= rayon; dx++) {
      const nx = gx + dx, nz = gz + dz;
      if (nx < 0 || nz < 0 || nx >= nav.W || nz >= nav.H) continue;
      const j = nz * nav.W + nx;
      if (!nav.walkable[j]) continue;
      const cx = (nx + 0.5) * nav.cs - x, cz = (nz + 0.5) * nav.cs - z;
      const d = cx * cx + cz * cz;
      if (d < dMin) { dMin = d; meilleur = j; }
    }
  }
  return meilleur;
}

/** Point de passage d'une case : son centre, écarté des murs. */
export function waypoint(nav, i) {
  const x = i % nav.W, z = (i / nav.W) | 0;
  return {
    x: (x + 0.5) * nav.cs + nav.decalage[i * 2],
    z: (z + 0.5) * nav.cs + nav.decalage[i * 2 + 1],
  };
}

// ---- Tas binaire minimal (Dijkstra) ----
function _tas() {
  const idx = [], cle = [];
  return {
    get taille() { return idx.length; },
    push(i, k) {
      idx.push(i); cle.push(k);
      let n = idx.length - 1;
      while (n > 0) {
        const p = (n - 1) >> 1;
        if (cle[p] <= cle[n]) break;
        [idx[p], idx[n]] = [idx[n], idx[p]]; [cle[p], cle[n]] = [cle[n], cle[p]];
        n = p;
      }
    },
    pop() {
      const haut = idx[0], k = cle[0];
      const di = idx.pop(), dk = cle.pop();
      if (idx.length) {
        idx[0] = di; cle[0] = dk;
        let n = 0;
        for (;;) {
          const g = 2 * n + 1, d = g + 1;
          let m = n;
          if (g < idx.length && cle[g] < cle[m]) m = g;
          if (d < idx.length && cle[d] < cle[m]) m = d;
          if (m === n) break;
          [idx[m], idx[n]] = [idx[n], idx[m]]; [cle[m], cle[n]] = [cle[n], cle[m]];
          n = m;
        }
      }
      return [haut, k];
    },
  };
}

/**
 * Champ de distance : coût du plus court chemin de chaque case jusqu'aux sources.
 *
 * `arretSur` (optionnel) : ensemble de cases dont on a besoin. Dès qu'elles sont
 * toutes réglées, on s'arrête — toutes les cases de leurs chemins le sont déjà,
 * puisqu'elles sont plus proches de la source. Ça borne le calcul à la zone
 * utile au lieu de parcourir une map de 64×64 à chaque rafraîchissement.
 *
 * @param {object} nav
 * @param {number[]} sources — index de cases
 * @param {Set<number>} [arretSur]
 * @returns {Float32Array} distances (Infinity = non atteint)
 */
export function distanceField(nav, sources, arretSur = null) {
  const { W, H, walkable, cout } = nav;
  const dist = new Float32Array(W * H).fill(Infinity);
  const tas  = _tas();
  const restant = arretSur ? new Set(arretSur) : null;

  for (const s of sources) {
    if (s < 0 || !walkable[s]) continue;
    dist[s] = 0;
    tas.push(s, 0);
  }

  while (tas.taille) {
    const [i, d] = tas.pop();
    if (d > dist[i]) continue;              // entrée périmée
    if (restant) {
      restant.delete(i);
      if (restant.size === 0) break;
    }
    const x = i % W, z = (i / W) | 0;
    for (const [dx, dz, diag] of VOISINS) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
      const j = nz * W + nx;
      if (!walkable[j]) continue;
      // Pas de coin rogné : une diagonale exige ses deux côtés libres
      if (diag && (!walkable[z * W + nx] || !walkable[nz * W + x])) continue;
      // Le champ part du but : passer de i à j ici, c'est le bot qui va de j à i
      if (!_entreePermise(nav, j, i)) continue;
      const pas = (cout[i] + cout[j]) * 0.5 * (diag ? Math.SQRT2 : 1);
      const nd = d + pas;
      if (nd < dist[j]) {
        dist[j] = nd;
        // Pousser la valeur STOCKÉE (arrondie en float32), pas le double : sinon
        // l'entrée tirée du tas paraît plus grande que dist[j], elle est prise
        // pour une entrée périmée et la case n'est jamais développée — tout ce
        // qui se trouve derrière devient inatteignable.
        tas.push(j, dist[j]);
      }
    }
  }
  return dist;
}

/**
 * Suit la pente d'un champ depuis une case : liste des cases du chemin.
 * S'arrête au but ou si aucun voisin n'est plus proche.
 */
export function descend(nav, champ, depart, nbPas = 10) {
  const { W, H, walkable } = nav;
  const chemin = [];
  let i = depart;
  for (let p = 0; p < nbPas; p++) {
    const x = i % W, z = (i / W) | 0;
    let meilleur = -1, dMin = champ[i];
    for (const [dx, dz, diag] of VOISINS) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
      const j = nz * W + nx;
      if (!walkable[j]) continue;
      if (diag && (!walkable[z * W + nx] || !walkable[nz * W + x])) continue;
      if (!_entreePermise(nav, i, j)) continue;
      if (champ[j] < dMin) { dMin = champ[j]; meilleur = j; }
    }
    if (meilleur < 0) break;
    chemin.push(meilleur);
    i = meilleur;
  }
  return chemin;
}

/** Vrai si le segment ne traverse aucune case murée. */
export function lineOfSight(nav, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const longueur = Math.hypot(dx, dz);
  const n = Math.max(1, Math.ceil(longueur / (nav.cs * 0.4)));
  for (let k = 1; k < n; k++) {
    const i = cellIndex(nav, a.x + dx * k / n, a.z + dz * k / n);
    if (i < 0 || !nav.walkable[i]) return false;
  }
  return true;
}
