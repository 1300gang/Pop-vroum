// Prédiction du véhicule local : il roule tout de suite chez soi, avec la même
// conduite que le serveur (game/vehicle-tick.js), puis se recale en douceur sur
// l'état que le serveur fait autorité.
//
// Sans prédiction, chaque coup de volant attendait un aller-retour réseau plus
// un tick serveur avant de se voir (~70-100 ms) : une conduite « molle » qui
// gommait tout le calibrage fait en solo.
//
// Recalage : l'état serveur a un petit âge (tick + trajet) ; on l'avance de cet
// âge avec sa vitesse avant de comparer, sinon on tirerait la voiture en
// arrière en permanence. Petit écart → rapprochement exponentiel ; gros écart
// (chocs vécus différemment, cube poussé côté serveur) → on se cale net.
//
// Contrat : aucun DOM, aucun Three.js.

/**
 * @param {object} car     — voiture prédite (sim.car), mutée
 * @param {object} srv     — état serveur de ce véhicule (game:state.players[id])
 * @param {number} ageSec  — âge estimé de l'état serveur (s)
 * @param {number} dt      — durée de la frame (s)
 * @param {{ correctionRate?: number, snapDistance?: number }} cfg — gameplay.json → network
 * @returns {{ ecart: number, cale: boolean }}
 */
export function reconcile(car, srv, ageSec, dt, cfg = {}) {
  const sx = srv.position.x + srv.velocity.x * ageSec;
  const sz = srv.position.z + srv.velocity.z * ageSec;
  const ex = sx - car.position.x;
  const ez = sz - car.position.z;
  const ecart = Math.hypot(ex, ez);

  if (ecart > (cfg.snapDistance ?? 3)) {
    car.position.x = sx;
    car.position.z = sz;
    car.velocity.x = srv.velocity.x;
    car.velocity.z = srv.velocity.z;
    car.angle      = srv.angle;
    car.speed      = srv.speed;
    return { ecart, cale: true };
  }

  const k = 1 - Math.exp(-(cfg.correctionRate ?? 6) * dt);
  car.position.x += ex * k;
  car.position.z += ez * k;
  car.velocity.x += (srv.velocity.x - car.velocity.x) * k;
  car.velocity.z += (srv.velocity.z - car.velocity.z) * k;
  let da = srv.angle - car.angle;
  while (da >  Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  car.angle += da * k;
  return { ecart, cale: false };
}

/**
 * Cale entièrement la voiture prédite sur l'état serveur (départ, reprise).
 * @param {object} car
 * @param {object} srv
 */
export function snapTo(car, srv) {
  car.position.x = srv.position.x;
  car.position.z = srv.position.z;
  car.velocity.x = srv.velocity.x;
  car.velocity.z = srv.velocity.z;
  car.angle      = srv.angle;
  car.speed      = srv.speed;
}
