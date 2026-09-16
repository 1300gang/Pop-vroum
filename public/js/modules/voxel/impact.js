// Raycasting voxel depuis le point d'impact — RACE-D02.
//
// Contrat I/O :
//   applyImpactDamage(vehicleGrid, impactData) → { newGrid, removedVoxels }
//
//   vehicleGrid  : grid[x][z][y], 8×4×4
//   impactData   : { deltaSpeed, impactNormal: {x,z}, vehicleAngle, DAMAGE_THRESHOLD? }
//   newGrid      : copie de vehicleGrid avec les voxels retirés
//   removedVoxels: [{ x, z, y, color }]
//
// Convention grille voxel : grid[x][z][y]
//   x ∈ [0,7]  → axe longitudinal (x=7 = avant du véhicule)
//   z ∈ [0,3]  → axe latéral     (z=3 = côté droit)
//   y ∈ [0,3]  → axe vertical    (y=0 = bas)
//
// Algorithme :
//   1. Transformer impactNormal monde → espace voxel local.
//   2. Déterminer la face touchée (dominante) et la direction du rayon entrant.
//   3. Sur TOUTE la face exposée, trouver le premier voxel de chaque ligne.
//   4. Mélanger aléatoirement ces voxels exposés et en retirer N.
//   N = clamp(floor(deltaSpeed / DAMAGE_THRESHOLD), 1, 4).

/**
 * Applique des dommages d'impact sur la grille voxel.
 *
 * @param {Array<Array<Array<{color:string}|null>>>} vehicleGrid — grid[x][z][y] 8×4×4
 * @param {{ deltaSpeed:number, impactNormal:{x,z}, vehicleAngle:number, DAMAGE_THRESHOLD?:number }} impactData
 * @returns {{ newGrid:Array, removedVoxels:Array<{x,z,y,color}> }}
 */
export function applyImpactDamage(vehicleGrid, impactData) {
  const { deltaSpeed, impactNormal, vehicleAngle = 0 } = impactData;
  const threshold = impactData.DAMAGE_THRESHOLD ?? 8;
  const N = Math.min(4, Math.max(1, Math.floor(deltaSpeed / threshold)));

  // Copie profonde de la grille (on modifie newGrid, jamais vehicleGrid)
  const newGrid = vehicleGrid.map(col => col.map(row => [...row]));

  // Transformer impactNormal monde → espace voxel local
  // forward voxel = (cos(angle), sin(angle)), right voxel = (-sin(angle), cos(angle))
  const cosA    = Math.cos(vehicleAngle);
  const sinA    = Math.sin(vehicleAngle);
  const localLong = impactNormal.x * cosA + impactNormal.z * sinA;   // axe x voxel
  const localLat  = impactNormal.x * (-sinA) + impactNormal.z * cosA; // axe z voxel

  // Valeurs négatives → le mur est dans la direction positive de l'axe
  // localLong < 0 → mur devant (face x=7) ; > 0 → mur derrière (face x=0)
  // localLat  < 0 → mur à droite (face z=3) ; > 0 → mur à gauche (face z=0)

  const exposed = []; // premiers voxels exposés par rayon

  if (Math.abs(localLong) >= Math.abs(localLat)) {
    // Axe longitudinal : rayon sur l'axe X
    const xStart = localLong < 0 ? 7 : 0;
    const xStep  = localLong < 0 ? -1 : 1;

    for (let z = 0; z <= 3; z++) {
      for (let y = 0; y <= 3; y++) {
        // Premier voxel non-null sur ce rayon
        for (let x = xStart; x >= 0 && x <= 7; x += xStep) {
          const v = newGrid[x]?.[z]?.[y];
          if (v !== undefined && v !== null) {
            exposed.push({ x, z, y, color: v.color });
            break;
          }
        }
      }
    }
  } else {
    // Axe latéral : rayon sur l'axe Z
    const zStart = localLat < 0 ? 3 : 0;
    const zStep  = localLat < 0 ? -1 : 1;

    for (let x = 0; x <= 7; x++) {
      for (let y = 0; y <= 3; y++) {
        // Premier voxel non-null sur ce rayon
        for (let z = zStart; z >= 0 && z <= 3; z += zStep) {
          const v = newGrid[x]?.[z]?.[y];
          if (v !== undefined && v !== null) {
            exposed.push({ x, z, y, color: v.color });
            break;
          }
        }
      }
    }
  }

  // Mélanger et retirer N voxels parmi les exposés
  _shuffleInPlace(exposed);
  const removedVoxels = exposed.slice(0, N);
  for (const { x, z, y } of removedVoxels) {
    newGrid[x][z][y] = null;
  }

  return { newGrid, removedVoxels };
}

// Fisher-Yates in-place (pas de seed nécessaire ici — l'impact est stochastique)
function _shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
