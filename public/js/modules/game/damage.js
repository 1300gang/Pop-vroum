// Résolution d'un choc contre une paroi : le bouclier encaisse d'abord, puis
// ce qui reste arrache des voxels.
//
// Le serveur fait autorité sur la perte de voxels : chaque client la calculait
// dans son coin et deux joueurs ne voyaient pas le même véhicule abîmé. Ce
// module réunit les deux étapes pour que la règle soit la même partout.
//
// Contrat : aucun DOM, aucun Three.js — importable par Node.

import { absorbDamage, createPowerState } from './power-effects.js';
import { resolveImpact } from '../voxel/impact.js';

/**
 * @param {object} vehicle     — { grid, originalGrid, originalStats, originalPowers, stats, powers }
 * @param {object} powerState  — état de pouvoir du véhicule (bouclier), ou null
 * @param {object} dmg         — physics.checkDamage() (damaged === true)
 * @param {number} angle       — orientation du véhicule
 * @param {number} voxelLossSpeed — vitesse de choc par voxel arraché
 * @returns {{ absorbed: number, shieldBroken: boolean,
 *             removedVoxels: Array, degats: object|null }}
 */
export function resolveCollision(vehicle, powerState, dmg, angle, voxelLossSpeed) {
  // Orange — le bouclier encaisse avant la carrosserie, et s'use
  const bouclier = absorbDamage(powerState, dmg.deltaSpeed);
  const reste    = bouclier.remaining;

  const res = reste > 0
    ? resolveImpact(vehicle, { ...dmg, deltaSpeed: reste }, angle, voxelLossSpeed)
    : null;

  return {
    absorbed:      bouclier.absorbed,
    shieldBroken:  bouclier.broken,
    removedVoxels: res?.removedVoxels ?? [],
    degats:        res?.degats ?? null,
  };
}

/**
 * Nouvel état de pouvoir après une perte de voxels, sans rendre au bouclier ce
 * qu'il a déjà encaissé : il garde ses points restants (bornés par son nouveau
 * maximum), et un bouclier brisé reste brisé.
 * @param {object} ancien  — état de pouvoir avant le choc
 * @param {object} powers  — nouvelles valeurs de pouvoir (vehicle.powers)
 */
export function rebuildPowerState(ancien, powers) {
  const neuf = createPowerState(powers);
  if (neuf.shield && ancien?.shield) {
    neuf.shield.hp     = Math.min(ancien.shield.hp, neuf.shield.hpMax);
    neuf.shield.active = ancien.shield.active && neuf.shield.hp > 0;
  }
  return neuf;
}
