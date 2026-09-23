// Regroupement des véhicules par proximité — logique pure, sans rendu.
//
// La jauge actuelle (server/game-loop._calculerCohesion) ne regarde que la plus
// grande distance entre deux véhicules : elle dit si le groupe est serré, mais
// pas QUI est avec QUI. Pour montrer aux joueur·euses qu'iels sont ensemble, il
// faut cette information-là, d'où ce module.
//
// Règle retenue (prd_pouvoirs.md §6) : le groupe de référence est la grappe la
// plus nombreuse. Un·e isolé·e ne fait donc pas basculer tout le monde.
//
// Contrat I/O : JSON in, JSON out, aucun état de module. Testable sans navigateur.

/**
 * Découpe les véhicules en grappes : deux véhicules sont dans la même grappe
 * s'il existe une chaîne de voisins à moins de `radius` entre eux.
 *
 * @param {Array<{id: string, position: {x: number, z: number}}>} vehicles
 * @param {number} radius — rayon de cohésion en unités monde
 * @returns {Array<Array<string>>} grappes, chacune = liste d'ids
 */
export function computeGroups(vehicles, radius) {
  const restants = vehicles.filter(v => v?.id && v.position);
  const vus      = new Set();
  const grappes  = [];
  const r2       = radius * radius;

  const proches = (a, b) => {
    const dx = a.position.x - b.position.x;
    const dz = a.position.z - b.position.z;
    return dx * dx + dz * dz <= r2;
  };

  for (const depart of restants) {
    if (vus.has(depart.id)) continue;

    // Parcours en largeur sur le graphe de proximité
    const grappe = [];
    const file   = [depart];
    vus.add(depart.id);

    while (file.length) {
      const v = file.shift();
      grappe.push(v.id);
      for (const autre of restants) {
        if (vus.has(autre.id) || !proches(v, autre)) continue;
        vus.add(autre.id);
        file.push(autre);
      }
    }
    grappes.push(grappe);
  }
  return grappes;
}

/**
 * État de cohésion prêt à afficher.
 *
 * @param {Array<{id, position}>} vehicles
 * @param {number} radius
 * @returns {{ groupes: Array<Array<string>>, reference: Set<string>,
 *             liens: Array<[string, string]>, seul: Set<string> }}
 */
export function cohesionState(vehicles, radius) {
  const groupes = computeGroups(vehicles, radius);

  // Grappe de référence : la plus nombreuse. À égalité, la première trouvée —
  // l'ordre des véhicules étant stable, l'affichage ne clignote pas.
  let plusGrande = [];
  for (const g of groupes) if (g.length > plusGrande.length) plusGrande = g;
  const reference = new Set(plusGrande.length > 1 ? plusGrande : []);

  // Liens : les paires réellement à portée, pour tracer qui est avec qui
  const liens = [];
  const r2 = radius * radius;
  for (let i = 0; i < vehicles.length; i++) {
    for (let j = i + 1; j < vehicles.length; j++) {
      const a = vehicles[i], b = vehicles[j];
      if (!a?.position || !b?.position) continue;
      const dx = a.position.x - b.position.x;
      const dz = a.position.z - b.position.z;
      if (dx * dx + dz * dz <= r2) liens.push([a.id, b.id]);
    }
  }

  const seul = new Set(vehicles.filter(v => v?.id && !reference.has(v.id)).map(v => v.id));
  return { groupes, reference, liens, seul };
}
