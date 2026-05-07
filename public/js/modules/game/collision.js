// Détection du terrain sous le véhicule et collisions avec blocs durs.
//
// Contrat I/O :
//   checkTerrain(pos, blocks, cellSize) → { softTerrain, hardCollision, pushBack }
//
//   softTerrain  : 'ramp' | 'sticky' | 'boost' | null
//   hardCollision: true si le véhicule chevauche un bloc dur
//   pushBack     : { x, z } vecteur de correction (ou null)
//
// Chaque bloc a { position: [worldX, worldZ], grid: 8×8 }.
// Les grilles sont déjà rotées par map-loader (déplacement en +X).
// cellSize = blockScale (unités monde par cellule, défaut 1 pour rétrocompatibilité).

export const VEHICLE_RADIUS = 0.65;
const BLOCK_SIZE = 8;

/**
 * @param {{ x: number, z: number }} pos — centre du véhicule
 * @param {Array<{ position: [number, number], grid: Array<Array<string|null>> }>} blocks
 * @param {number} [cellSize=1] — taille d'une cellule en unités monde
 */
export function checkTerrain(pos, blocks, cellSize = 1) {
  let softTerrain   = null;
  let hardCollision = false;
  let pushX = 0;
  let pushZ = 0;

  const blocExtent = BLOCK_SIZE * cellSize;

  for (const bloc of blocks) {
    const [bx, bz] = bloc.position;

    if (pos.x + VEHICLE_RADIUS < bx || pos.x - VEHICLE_RADIUS > bx + blocExtent) continue;
    if (pos.z + VEHICLE_RADIUS < bz || pos.z - VEHICLE_RADIUS > bz + blocExtent) continue;

    const gxMin = Math.max(0, Math.floor((pos.x - VEHICLE_RADIUS - bx) / cellSize));
    const gxMax = Math.min(BLOCK_SIZE - 1, Math.floor((pos.x + VEHICLE_RADIUS - bx) / cellSize));
    const gzMin = Math.max(0, Math.floor((pos.z - VEHICLE_RADIUS - bz) / cellSize));
    const gzMax = Math.min(BLOCK_SIZE - 1, Math.floor((pos.z + VEHICLE_RADIUS - bz) / cellSize));

    for (let gz = gzMin; gz <= gzMax; gz++) {
      for (let gx = gxMin; gx <= gxMax; gx++) {
        const cell = bloc.grid[gz]?.[gx];
        if (!cell) continue;

        const cellX     = bx + gx * cellSize;
        const cellZ     = bz + gz * cellSize;
        const closestX  = Math.max(cellX, Math.min(pos.x, cellX + cellSize));
        const closestZ  = Math.max(cellZ, Math.min(pos.z, cellZ + cellSize));
        const dx        = pos.x - closestX;
        const dz        = pos.z - closestZ;
        const dist      = Math.sqrt(dx * dx + dz * dz);

        if (dist >= VEHICLE_RADIUS) continue;

        if (cell === 'dur') {
          hardCollision  = true;
          const pen      = VEHICLE_RADIUS - dist;
          if (dist > 0.001) {
            pushX += (dx / dist) * pen;
            pushZ += (dz / dist) * pen;
          } else {
            pushX += pen;
          }
        } else if (!softTerrain) {
          softTerrain = cell;
        }
      }
    }
  }

  return {
    softTerrain:   hardCollision ? null : softTerrain,
    hardCollision,
    pushBack:      hardCollision ? { x: pushX, z: pushZ } : null,
  };
}
