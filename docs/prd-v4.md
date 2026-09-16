# PRD — Pop Vroum · MAJ V4 : Maps, Élévations & Obstacles Actifs

**Projet** : Pop Vroum  
**Porteur** : 1k3vrtical / Collectif Mille Trois Cents  
**Version** : 1.0 — 13 mai 2026  
**Document amont** : PRD Solo v3 (MAJ Solo v3), `docs/conception_drift_gamefeel.md`  
**Cible matérielle** : Redmi Note 10 (Snapdragon 678, 4 GB RAM, 60 Hz) — 30 FPS minimum stable  
**Workflow** : implémenter sur `test-solo-v3.html` d'abord, puis porter dans `game.html`

---

## 1. Contexte

Cette MAJ fait suite à la Solo v3. Elle porte sur trois axes :

- **Map** : blocmaps départ/arrivée vides, bords en verre, templates builder.
- **Physique** : correction des collisions rampes/bosses, système d'élévation 0 → 0.6.
- **Contenu** : obstacles actifs (punchers, vents), particules de drift style PAKO.

Le chantier "Drift & Game Feel" (physique PAKO avancée) et les pouvoirs restent **hors scope**.

---

## 2. Périmètre

### IN (cette MAJ)

| ID | Feature | Priorité |
|---|---|---|
| V4-01 | Bug fix : collisions rampes/bosses (hitbox hauteur + normales) | P0 |
| V4-02 | Bug fix : inversion géométrie rampe (`_creerGeomRampX`) | P0 |
| V4-03 | Élévation physique rampe → bloc dur (Y : 0 → 0.6) | P0 |
| V4-04 | Blocmaps départ/arrivée — cellules vides, spawn côte à côte | P0 |
| V4-05 | Bords de map en verre (mesh + collision + toggle debug) | P1 |
| V4-06 | Templates blocmap dans le builder (ligne droite, virage 90°, carrefour) | P1 |
| V4-07 | Punchers — obstacles actifs à intervalle fixe | P1 |
| V4-08 | Vents — force constante directionnelle | P1 |
| V4-09 | Particules drift style PAKO (fumée, poussière, étincelles) | P1 |
| V4-10 | Portage → `game.html` | P2 |

### OUT (hors scope)

- Pouvoirs (MAJ suivante)
- Génération procédurale avancée (S, épingles)
- Élévations multi-niveaux (étages)
- Particules cubes/voxels (risque confusion avec perte de blocs)
- `InstancedMesh` / LOD

---

## 3. Décisions structurantes

| Sujet | Décision |
|---|---|
| Élévation hauteur | Stocker la hauteur par type dans `TYPES_CELLULE` — pas de champ hauteur dans le JSON map. Simple : 0 vs 0.6 uniquement |
| Puncher déclenchement | Intervalle fixe (pas de détection de proximité) |
| Vent | Force constante permanente (pas de rafales) |
| Particules | Three.js `Points` / `PointsMaterial` — pas de sprite atlas |
| Templates builder | Grilles 8×8 figées (pas de paramètres de largeur) |
| Sync puncher/vent | Côté serveur — les forces sont appliquées dans la game loop |
| Particules drift | Côté client uniquement — direction = velocity, intensité = `|v_lateral|` |

---

## 4. Critères d'acceptation transversaux

**CA-01** — Un véhicule ne traverse plus les rampes ni les bosses.  
**CA-02** — La rampe monte bien dans la bonne direction (pas de descente inversée).  
**CA-03** — Sur un bloc `dur` adjacent à une rampe, le véhicule reste à `Y = 0.6`.  
**CA-04** — Le blocmap départ a toutes ses cellules à `null` ; les joueurs spawnent côte à côte.  
**CA-05** — Un pseudo avec `<script>` ne provoque aucune exécution côté client (déjà couvert SOLO-07 — vérifier à la régression).  
**CA-06** — Les particules de fumée ne ressemblent pas à des voxels qui s'envolent.  
**CA-07** — 30 FPS stables sur Redmi Note 10 avec les obstacles actifs en jeu.  

---

## 5. Ordre d'implémentation

```
Phase 1 — Corrections critiques (bloquant pour tout le reste)
  V4-01  Bug collisions rampes/bosses
  V4-02  Bug inversion géométrie rampe
  V4-03  Élévation physique rampe → bloc dur

Phase 2 — Structure de map
  V4-04  Blocmaps départ/arrivée vides
  V4-05  Bords en verre
  V4-06  Templates builder

Phase 3 — Obstacles actifs
  V4-07  Punchers
  V4-08  Vents

Phase 4 — VFX
  V4-09  Particules drift PAKO

Phase 5 — Portage
  V4-10  → game.html
```

---

---

# Stories — MAJ V4

> **Convention** : JSON in / JSON out, modules testables sans UI.  
> Commentaires en **français**, identifiants en **anglais**.  
> Lire les fichiers listés dans "Fichiers à lire" **avant** de toucher au code.  
> Toute valeur configurable va dans `/config/gameplay.json`.

---

## V4-01 — Bug fix : collisions rampes/bosses

**Modèle** : Sonnet 4.6  
**Priorité** : P0 — bloquant pour V4-03  
**Dépendances** : aucune  
**Fichiers à lire** : `server.js` (collision detection), `game-page.js` (`TYPES_CELLULE`), `/config/gameplay.json`

### Problème

Les véhicules traversent les rampes et bosses sans réaction. La détection de collision côté serveur traite le véhicule comme un point fixe à `Y = 0` et ignore la hauteur des cellules définie dans `TYPES_CELLULE`.

### Diagnostic

```js
// Actuel (probable) — collision uniquement sur plan XZ
if (cell !== null) {
  // rebond horizontal seulement
  applyWallRebound(state, normal)
}

// Manquant : vérification de la surface supérieure des blocs
// La hitbox verticale du véhicule n'est pas prise en compte
```

### Correction

**Étape 1 — Hitbox verticale du véhicule**

Le véhicule n'est plus un point mais une boîte `VEHICLE_WIDTH × VEHICLE_HEIGHT × VEHICLE_LENGTH`. La position `Y` du centre de masse est suivie.

```js
// server.js — state joueur
state.position = { x, y, z }   // y = hauteur centre de masse
// Initialisé à VEHICLE_HEIGHT / 2 (au sol)
```

**Étape 2 — Collision avec la surface supérieure**

```js
// Pour chaque cellule sous le véhicule :
const cellHeight = TYPES_CELLULE[cellType]?.height ?? 0
const cellSurface = cellHeight  // Y du dessus de la cellule

if (state.position.y < cellSurface + VEHICLE_HEIGHT / 2) {
  // Le véhicule est dans la cellule → le repousser vers le haut
  state.position.y = cellSurface + VEHICLE_HEIGHT / 2
  state.velocity.y = Math.max(0, state.velocity.y)   // annuler la chute
}
```

**Étape 3 — Impulsion verticale pour les bosses**

```js
// Quand le véhicule roule sur une cellule 'bump'
if (cellType === 'bump' && state.speed > BUMP_MIN_SPEED) {
  state.velocity.y += BUMP_IMPULSE
}
```

### Configuration (gameplay.json)

```json
"VEHICLE_HEIGHT": 0.8,
"VEHICLE_WIDTH": 0.9,
"BUMP_MIN_SPEED": 2.0,
"BUMP_IMPULSE": 3.0,
"GRAVITY": 15.0
```

### Fichiers

- `server.js` — hitbox verticale, collision surface supérieure, gravité
- `/config/gameplay.json` — constantes ci-dessus

### Critères d'acceptation

- [ ] Le véhicule ne traverse plus un bloc `dur` par le dessus.
- [ ] Une bosse `bump` à `speed > BUMP_MIN_SPEED` projette le véhicule vers le haut.
- [ ] À `speed < BUMP_MIN_SPEED`, la bosse ne fait rien (effleurement).
- [ ] La gravité ramène le véhicule au sol après un saut.
- [ ] `VEHICLE_HEIGHT` et `BUMP_IMPULSE` dans `gameplay.json`.

---

## V4-02 — Bug fix : inversion géométrie rampe

**Modèle** : Haiku 4.5  
**Priorité** : P0 — bloquant pour V4-03  
**Dépendances** : aucune  
**Fichiers à lire** : `game-page.js` — fonction `_creerGeomRampX` (et variantes Z)

### Problème

La rampe descend au lieu de monter dans certaines orientations. La géométrie générée par `_creerGeomRampX` a ses vertices dans le mauvais ordre ou sa direction `position.set` inversée.

### Diagnostic

```js
// Vérifier l'ordre des vertices dans _creerGeomRampX
// Une rampe 'ramp_n' doit monter vers le Nord (Z négatif en convention Three.js)
// Le vertex bas doit être côté Sud (Z+), le vertex haut côté Nord (Z-)

// Test rapide : placer une ramp_n dans l'éditeur et vérifier
// que le côté haut est bien adjacent au bloc dur nord
```

### Correction

Pour chaque variante de rampe, vérifier et corriger l'ordre des 4 vertices du quad incliné :

```js
// Rampe montant vers le Nord (ramp_n) — exemple corrigé
// Bas-Sud (y=0), Bas-Nord (y=0), Haut-Nord (y=RAMP_HEIGHT), Haut-Sud (y=0)
// → pente monte du Sud vers le Nord

function _creerGeomRampN(cellSize, rampHeight) {
  const geo = new THREE.BufferGeometry()
  const vertices = new Float32Array([
    0,          0,           cellSize,  // Bas-Sud-Ouest
    cellSize,   0,           cellSize,  // Bas-Sud-Est
    cellSize,   rampHeight,  0,         // Haut-Nord-Est
    0,          rampHeight,  0,         // Haut-Nord-Ouest
  ])
  // ... indices, normals
  return geo
}
```

Appliquer la même logique cohérente pour `ramp_s`, `ramp_e`, `ramp_o`.

### Fichiers

- `game-page.js` — fonctions `_creerGeomRampX`, `_creerGeomRampZ` (et toutes variantes)

### Critères d'acceptation

- [ ] `ramp_n` : côté haut au Nord, côté bas au Sud.
- [ ] `ramp_s` : côté haut au Sud, côté bas au Nord.
- [ ] `ramp_e` : côté haut à l'Est, côté bas à l'Ouest.
- [ ] `ramp_o` : côté haut à l'Ouest, côté bas à l'Est.
- [ ] Les 4 rampes s'affichent sans face inversée (pas de dark face due aux normales).

---

## V4-03 — Élévation physique rampe → bloc dur

**Modèle** : Sonnet 4.6  
**Priorité** : P0  
**Dépendances** : V4-01, V4-02  
**Fichiers à lire** : `server.js` (physique), `game-page.js` (`TYPES_CELLULE`), `/config/gameplay.json`

### Objectif

Quand un véhicule monte une rampe vers un bloc `dur` adjacent, sa position Y augmente progressivement de `0` à `PLATEAU_HEIGHT (0.6)`. Sur le plateau, il reste à `Y = 0.6`. Pour descendre, il doit passer sur une rampe en sens inverse.

### Système d'élévation

**Hauteur des cellules dans `TYPES_CELLULE`**

```js
const TYPES_CELLULE = {
  null:    { height: 0.0, ... },   // sol plat
  dur:     { height: 0.6, ... },   // plateau
  sticky:  { height: 0.0, ... },
  boost:   { height: 0.0, ... },
  ramp_n:  { height: 0.0, rampTarget: 'N', rampMaxHeight: 0.6 },
  ramp_s:  { height: 0.0, rampTarget: 'S', rampMaxHeight: 0.6 },
  ramp_e:  { height: 0.0, rampTarget: 'E', rampMaxHeight: 0.6 },
  ramp_o:  { height: 0.0, rampTarget: 'O', rampMaxHeight: 0.6 },
  bump:    { height: 0.3, ... },
  // ...
}
```

**Calcul de la hauteur cible sur une rampe**

La hauteur du véhicule sur une rampe est interpolée selon sa progression dans la cellule :

```js
// Pour ramp_n : progression = (cellSize - localZ) / cellSize
// localZ = position du véhicule dans la cellule (0 = entrée Sud, cellSize = entrée Nord)

function getRampHeight(cellType, localPos, cellSize) {
  const progress = getRampProgress(cellType, localPos, cellSize) // 0→1
  return progress * PLATEAU_HEIGHT
}
```

**Vérification d'alignement rampe → plateau**

À la génération ou au placement dans le builder : si une `ramp_n` n'a pas de cellule `dur` immédiatement au Nord, afficher un warning dans la console (pas de blocage dur).

```js
// server.js ou map-generator.js
function validateRampConnections(grid) {
  // Parcourir toutes les cellules ramp_*
  // Vérifier que la cellule cible est 'dur'
  // Logger un warning si ce n'est pas le cas
}
```

### Configuration (gameplay.json)

```json
"PLATEAU_HEIGHT": 0.6,
"RAMP_IMPULSE": 0.0
```

> `RAMP_IMPULSE = 0` : la montée est progressive (pas d'impulsion), contrairement à la bosse.

### Fichiers

- `server.js` — `getRampHeight`, intégration dans la mise à jour de `position.y`
- `game-page.js` — `TYPES_CELLULE` mis à jour avec `rampTarget` et `rampMaxHeight`
- `/config/gameplay.json` — `PLATEAU_HEIGHT`

### Critères d'acceptation

- [ ] Un véhicule qui monte `ramp_n` voit son `Y` augmenter progressivement jusqu'à `0.6`.
- [ ] Sur un bloc `dur` en haut, `Y` reste stable à `0.6`.
- [ ] Pas de saut brusque à la jonction rampe / bloc dur.
- [ ] Un véhicule qui descend une rampe inverse revient à `Y = 0`.
- [ ] Un warning console si une rampe n'est pas alignée avec un bloc dur.

---

## V4-04 — Blocmaps départ/arrivée — cellules vides & spawn côte à côte

**Modèle** : Haiku 4.5  
**Priorité** : P0  
**Dépendances** : SOLO-05 (structure départ/arrivée dans MapData)  
**Fichiers à lire** : `server.js` (génération MapData), `game-page.js` (`_construireMeshMap`)

### Objectif

Le blocmap départ et le blocmap arrivée ont toutes leurs 64 cellules à `null` (sol plat, hauteur 0, aucun obstacle). Les joueurs spawnent côte à côte sur la ligne de départ.

### Génération des blocmaps spéciaux

```js
// server.js — lors de la génération de la map
function createStartBlock() {
  return {
    id: 'block_start',
    grid: Array(8).fill(null).map(() => Array(8).fill(null)),  // 64 × null
    exits: ['N', 'S', 'E', 'O'],   // toutes les sorties ouvertes
    isStart: true
  }
}

function createFinishBlock() {
  return {
    id: 'block_finish',
    grid: Array(8).fill(null).map(() => Array(8).fill(null)),
    exits: ['N', 'S', 'E', 'O'],
    isFinish: true
  }
}
```

### Spawn côte à côte

Les positions de spawn sont réparties sur l'axe Z central du blocmap de départ, espacées de `SPAWN_SPREAD` :

```js
// server.js
function computeSpawnPositions(entryBlock, playerCount) {
  const centerX = entryBlock.worldCenter.x
  const centerZ = entryBlock.worldCenter.z
  const positions = []
  const offset = (playerCount - 1) / 2  // centrer le groupe

  for (let i = 0; i < playerCount; i++) {
    positions.push({
      x: centerX,
      z: centerZ + (i - offset) * SPAWN_SPREAD,
      angle: 0   // tous orientés vers le Nord
    })
  }
  return positions
}
```

### Rendu (`_construireMeshMap`)

```js
// Pour le blocmap départ :
// – Ne pas générer de mesh de cellules (grid est null partout)
// – Ajouter une bande verte au sol (PlaneGeometry) + label "DÉPART"
// – La bande occupe toute la largeur du blocmap, épaisseur 0.3 unités

// Pour le blocmap arrivée :
// – Même logique — bande dorée au sol + label "ARRIVÉE"
```

### Configuration (gameplay.json)

```json
"SPAWN_SPREAD": 1.5
```

### Fichiers

- `server.js` — `createStartBlock`, `createFinishBlock`, `computeSpawnPositions`
- `game-page.js` — rendu bandes dans `_construireMeshMap`

### Critères d'acceptation

- [ ] Le blocmap départ a exactement 64 cellules `null`.
- [ ] Le blocmap arrivée a exactement 64 cellules `null`.
- [ ] 5 joueurs spawnent côte à côte, espacés de `SPAWN_SPREAD`, tous orientés vers le Nord.
- [ ] Bande verte visible au départ, bande dorée visible à l'arrivée.
- [ ] Aucun mesh de cellule généré dans ces deux blocmaps.

---

## V4-05 — Bords de map en verre

**Modèle** : Haiku 4.5  
**Priorité** : P1  
**Dépendances** : aucune  
**Fichiers à lire** : `game-page.js` (init scène Three.js, collision detection)

### Objectif

Entourer la map d'un mur de verre quasi-invisible. Collision active. Toggle debug pour désactiver visuellement et physiquement (test hors-map).

### Mesh

```js
// game-page.js — après construction de la map
function createBorderWalls(mapWorldWidth, mapWorldHeight) {
  const wallMaterial = new THREE.MeshStandardMaterial({
    transparent: true,
    opacity: 0.1,
    color: 0xaaddff,
    side: THREE.DoubleSide,
    roughness: 0.1,
    metalness: 0.2,
  })

  // 4 murs : Nord, Sud, Est, Ouest
  // PlaneGeometry(longueur, hauteur_mur)
  // Positionnés sur les bords extérieurs de la map
  // WALL_HEIGHT configurable dans gameplay.json
}
```

### Hitbox collision

Les bords de map sont traités comme des murs normaux dans la détection de collision côté serveur. Même rebond élastique que les murs de blocs.

```js
// server.js — game loop, après mise à jour position
function checkBorderCollision(state, mapBounds) {
  if (state.position.x < mapBounds.minX) {
    state.position.x = mapBounds.minX
    state.velocity.x = Math.abs(state.velocity.x) * RESTITUTION
  }
  // ... idem pour maxX, minZ, maxZ
}
```

### Toggle debug

```js
// game-page.js — variable globale
const debug = { showBorders: true }

// Touche F3 : toggle
document.addEventListener('keydown', e => {
  if (e.key === 'F3') {
    debug.showBorders = !debug.showBorders
    borderWalls.forEach(w => { w.visible = debug.showBorders })
    // Côté serveur : envoyer socket 'debug:borders' avec la valeur
    // Le serveur désactive checkBorderCollision si false
  }
})
```

### Configuration (gameplay.json)

```json
"WALL_HEIGHT": 2.0,
"RESTITUTION": 0.5
```

### Fichiers

- `game-page.js` — `createBorderWalls`, toggle F3
- `server.js` — `checkBorderCollision`, réception `debug:borders`
- `/config/gameplay.json` — `WALL_HEIGHT`

### Critères d'acceptation

- [ ] Les 4 bords sont visibles à 10% d'opacité (légère teinte bleue).
- [ ] Un véhicule rebondit sur le bord comme sur un mur normal.
- [ ] F3 rend les murs invisibles ET supprime la collision.
- [ ] F3 une deuxième fois rétablit les murs et la collision.

---

## V4-06 — Templates blocmap dans le builder

**Modèle** : Sonnet 4.6  
**Priorité** : P1  
**Dépendances** : RACE-01 (blocs seed avec `exits`)  
**Fichiers à lire** : `block-editor.html`, format JSON blocmap, blocs seed existants

### Objectif

Ajouter dans le builder une palette de templates prédéfinis. Un clic sur un template charge sa grille 8×8 dans l'éditeur avec les `exits` corrects affichés en vert.

### Templates

| ID | Nom | exits | Grille |
|---|---|---|---|
| `tpl_straight_ns` | Ligne droite N-S | N, S | Couloir 2 cellules de large, murs sur les côtés E/O |
| `tpl_straight_eo` | Ligne droite E-O | E, O | Couloir 2 cellules de large, murs sur les côtés N/S |
| `tpl_turn_ne` | Virage N-E | N, E | Virage quart de cercle, murs sur S et O |
| `tpl_turn_no` | Virage N-O | N, O | Virage quart de cercle |
| `tpl_turn_se` | Virage S-E | S, E | Virage quart de cercle |
| `tpl_turn_so` | Virage S-O | S, O | Virage quart de cercle |
| `tpl_cross` | Carrefour | N, S, E, O | Ouvert sur les 4 côtés, îlot central optionnel |

Les 4 virages à 90° partagent la même grille, simplement choisie selon l'orientation voulue.

### Interface builder

```
[Palette outils]   [Templates]   [Propriétés]
  ...               ● Ligne NS     exits: N S
                    ● Ligne EO
                    ● Virage NE
                    ● ...
                    ● Carrefour
```

- Clic sur un template → charge la grille dans l'éditeur.
- Les cellules `exits` (bords ouverts) sont surlignées en vert dans la grille.
- Le créateur peut modifier la grille après chargement du template.
- Bouton "Rotation 90°" applique `rotateBlock(current, 1)` (V4-02 doit être terminé).

### Affichage des exits

```js
// block-editor.html — rendu de la grille
function drawGrid(grid, exits) {
  exits.forEach(exit => {
    // Surligné en vert les cellules de bord correspondant à l'exit
    // N → ligne 0, colonnes 3 et 4
    // S → ligne 7, colonnes 3 et 4
    // E → lignes 3 et 4, colonne 7
    // O → lignes 3 et 4, colonne 0
    highlightBorderCells(exit, '#00ff88')
  })
}
```

### Fichiers

- `block-editor.html` — panneau templates, `drawGrid` avec exits, bouton rotation
- `/data/map-blocks/_seed/` — les 7 templates JSON (peuvent réutiliser les blocs RACE-01)

### Critères d'acceptation

- [ ] Les 7 templates apparaissent dans le panneau du builder.
- [ ] Clic sur un template charge la bonne grille 8×8.
- [ ] Les exits sont surlignés en vert.
- [ ] Le bouton Rotation 90° fait pivoter la grille et met à jour les exits.
- [ ] Le résultat peut être sauvegardé comme un nouveau bloc.

---

## V4-07 — Punchers (obstacles actifs à intervalle fixe)

**Modèle** : Sonnet 4.6  
**Priorité** : P1  
**Dépendances** : V4-01 (hitbox verticale)  
**Fichiers à lire** : `server.js` (game loop), `game-page.js` (`_construireMeshMap`), format JSON map

### Objectif

Le puncher est un poteau qui sort du sol périodiquement. S'il touche un véhicule pendant sa phase montante, il lui applique une impulsion violente. L'état (sorti/rentré) est géré côté serveur et synchronisé aux clients.

### Format JSON

```json
{
  "type": "puncher",
  "x": 3, "z": 2,
  "interval": 3000,
  "extendDuration": 1200,
  "phase": 0
}
```

- `interval` : millisecondes entre deux sorties (ex: 3000ms = toutes les 3s).
- `extendDuration` : durée en ms où le puncher est sorti.
- `phase` : décalage initial en ms (pour désynchroniser plusieurs punchers).

### Logique serveur

```js
// server.js — game loop
function updatePunchers(punchers, dt, now) {
  punchers.forEach(p => {
    const cycle = (now - p.phase) % p.interval
    p.extended = cycle < p.extendDuration

    if (p.extended) {
      // Vérifier collision avec chaque véhicule
      players.forEach(player => {
        if (distanceTo(player.position, p) < PUNCHER_RADIUS) {
          applyPuncherImpact(player, p)
        }
      })
    }
  })
}

function applyPuncherImpact(player, puncher) {
  // Impulsion vers l'extérieur (direction opposée au puncher)
  const dir = normalize(subtract(player.position, puncher))
  player.velocity.x += dir.x * PUNCHER_FORCE
  player.velocity.z += dir.z * PUNCHER_FORCE
  player.velocity.y += PUNCHER_VERTICAL_FORCE
  // Dégâts voxels si deltaV > seuil (réutilise handleImpact)
}
```

### Rendu client

```js
// game-page.js — mise à jour mesh puncher à chaque frame
// state.punchers reçu via Socket.io (game:state)
punchers.forEach(p => {
  const mesh = puncherMeshes.get(p.id)
  const targetY = p.extended ? PUNCHER_HEIGHT : 0
  mesh.position.y = THREE.MathUtils.lerp(mesh.position.y, targetY, 0.25)
})
```

Mesh : `CylinderGeometry(0.2, 0.2, PUNCHER_HEIGHT)` — couleur rouge sombre.

### Payload Socket.io

```js
// Ajout dans game:state
{
  punchers: [
    { id: 'p_0_3_2', extended: true },
    { id: 'p_1_5_4', extended: false },
    ...
  ]
}
```

### Configuration (gameplay.json)

```json
"PUNCHER_RADIUS": 0.8,
"PUNCHER_FORCE": 12.0,
"PUNCHER_VERTICAL_FORCE": 4.0,
"PUNCHER_HEIGHT": 1.5
```

### Fichiers

- `server.js` — `updatePunchers`, `applyPuncherImpact`, payload `game:state`
- `game-page.js` — rendu mesh punchers, animation `translateY`
- `block-editor.html` — ajout du type `puncher` dans la palette
- `/config/gameplay.json` — constantes ci-dessus

### Critères d'acceptation

- [ ] Le puncher sort et rentre à l'intervalle défini.
- [ ] Un véhicule touché pendant la phase étendue reçoit une impulsion violente.
- [ ] Plusieurs punchers avec des `phase` différents ne sont pas synchronisés.
- [ ] L'animation Three.js est fluide (lerp, pas de téléportation).
- [ ] Le puncher est plaçable dans le builder.
- [ ] `PUNCHER_FORCE` et `PUNCHER_RADIUS` dans `gameplay.json`.

---

## V4-08 — Vents (force constante directionnelle)

**Modèle** : Haiku 4.5  
**Priorité** : P1  
**Dépendances** : V4-01  
**Fichiers à lire** : `server.js` (game loop, application des forces), format JSON map

### Objectif

Le vent est une cellule qui applique une force constante dans une direction (N/S/E/O) sur tout véhicule présent dans sa zone. Toujours actif (pas de rafales).

### Format JSON

```json
{
  "type": "wind",
  "x": 4, "z": 3,
  "direction": "E",
  "force": 8.0
}
```

### Logique serveur

```js
// server.js — game loop, après calcul des forces de physique
function applyWindForces(winds, players) {
  winds.forEach(wind => {
    const windVec = directionToVector(wind.direction)  // { x, z }
    players.forEach(player => {
      if (playerIsInCell(player.position, wind)) {
        player.velocity.x += windVec.x * wind.force * dt
        player.velocity.z += windVec.z * wind.force * dt
      }
    })
  })
}
```

### Rendu client

- Particules directionnelles (`Points`) émises depuis la cellule dans la direction du vent.
- Couleur : blanc-gris translucide, vitesse proportionnelle à `wind.force`.
- Flèche directionnelle au sol (plane avec texture flèche ou `ArrowHelper`).

### Builder

- Type `wind` dans la palette.
- Propriétés : direction (boutons N/S/E/O) + curseur force (1.0–20.0).

### Configuration (gameplay.json)

```json
"WIND_PARTICLE_COUNT": 12,
"WIND_PARTICLE_SPEED": 0.8
```

### Fichiers

- `server.js` — `applyWindForces`
- `game-page.js` — rendu particules vent + flèche au sol
- `block-editor.html` — type `wind` dans la palette
- `/config/gameplay.json` — `WIND_PARTICLE_COUNT`, `WIND_PARTICLE_SPEED`

### Critères d'acceptation

- [ ] Un véhicule dans une cellule `wind E` est poussé vers l'Est en continu.
- [ ] La force est proportionnelle à `wind.force`.
- [ ] Les particules indiquent visuellement la direction et l'intensité.
- [ ] Le vent est plaçable dans le builder avec réglage direction + force.
- [ ] Aucune force appliquée en dehors de la cellule `wind`.

---

## V4-09 — Particules drift style PAKO

**Modèle** : Sonnet 4.6  
**Priorité** : P1  
**Dépendances** : E03-S10 (velocity + drifting dans le payload réseau)  
**Fichiers à lire** : `/public/js/modules/game/particles.js`, `game-page.js` (boucle rendu)

### Objectif

Remplacer le système de particules de drift actuel par trois types de particules style PAKO. Purement décoratif, client uniquement. Les particules ne doivent **jamais** ressembler à des voxels.

### Trois types

**1. Fumée** (`smoke`)

- Déclencheur : `drifting === true` depuis plus de 500ms.
- Apparence : sphères floues (`Points` avec texture disque gaussien blanc-gris), rayon ~0.3, qui s'élargissent et s'estompent sur 1.5s.
- Émetteur : centre de masse arrière du véhicule.
- Direction : opposée à `velocity` (la fumée reste en arrière).
- Intensité : `Math.min(|v_lateral| / 10, 1.0)`.

**2. Poussière** (`dust`)

- Déclencheur : `drifting === true` immédiatement.
- Apparence : `Points` couleur sable/beige (#C4A35A), taille 0.05–0.1, rebondissent légèrement sur Y.
- Émetteur : roues arrière (décalage ±`VEHICLE_WIDTH/2` sur l'axe `right`).
- Direction : velocity + léger aléatoire latéral.

**3. Étincelles** (`sparks`)

- Déclencheur : `drifting === true` ET collision murale dans les 200ms.
- Apparence : `Points` jaune-orange (#FFB347), très petits (0.03), traînées lumineuses (`additive blending`).
- Direction : normale du mur + léger spread aléatoire.
- Durée : 0.3s.

### Règles absolues

- ❌ **Jamais de BoxGeometry ou de formes cubiques** dans les particules.
- ❌ **Jamais de couleurs primaires saturées** (rouge, vert, bleu pur) — risque de confusion avec les voxels du véhicule.
- ✅ Direction toujours calculée depuis `velocity`, pas depuis `angle`.
- ✅ Intensité toujours proportionnelle à `|v_lateral|`.

### Architecture du module

```js
// /public/js/modules/game/particles.js
export function initParticles(scene) → ParticleSystem
export function emitSmoke(system, position, velocity, intensity)
export function emitDust(system, position, velocity, intensity)
export function emitSparks(system, position, wallNormal, intensity)
export function updateParticles(system, dt)   // à appeler chaque frame
```

### Configuration (gameplay.json)

```json
"SMOKE_MAX_PARTICLES": 80,
"DUST_MAX_PARTICLES": 60,
"SPARK_MAX_PARTICLES": 40,
"SMOKE_LIFETIME": 1.5,
"DUST_LIFETIME": 0.6,
"SPARK_LIFETIME": 0.3,
"DRIFT_SMOKE_DELAY": 0.5
```

### Fichiers

- `/public/js/modules/game/particles.js` — réécriture du module
- `game-page.js` — `initParticles` à l'init, `emitSmoke/Dust/Sparks` dans `_boucle`
- `/config/gameplay.json` — constantes ci-dessus

### Critères d'acceptation

- [ ] La fumée apparaît après 500ms de drift continu.
- [ ] La poussière apparaît immédiatement au drift.
- [ ] Les étincelles n'apparaissent que lors d'une collision murale en drift.
- [ ] Direction des particules = velocity (pas angle) — vérifiable visuellement en drift à 45°.
- [ ] Intensité proportionnelle à `|v_lateral|`.
- [ ] Aucune particule ne ressemble à un voxel (test : faire voir à quelqu'un d'autre).
- [ ] 30 FPS stables avec les 3 systèmes actifs simultanément.

---

## V4-10 — Portage → game.html

**Modèle** : Haiku 4.5  
**Priorité** : P2 — après validation sur `test-solo-v3.html`  
**Dépendances** : V4-01 à V4-09 validés  
**Fichiers à lire** : `game.html`, `game-page.js`, `server.js`

### Checklist de portage

- [ ] V4-01/02/03 (physique hauteur) — côté serveur, actif automatiquement.
- [ ] V4-04 (blocmaps vides) — vérifier spawn à 5 joueurs.
- [ ] V4-05 (bords verre) — vérifier que le toggle F3 ne désynchro pas les clients.
- [ ] V4-06 (templates) — builder indépendant, pas de portage nécessaire.
- [ ] V4-07 (punchers) — vérifier sync état `extended` pour les 5 clients.
- [ ] V4-08 (vents) — vérifier que la force est bien appliquée sur tous les joueurs.
- [ ] V4-09 (particules) — vérifier rendu pour les véhicules distants.

### Critères d'acceptation

- [ ] Aucune régression lobby / sync Socket.io.
- [ ] Punchers et vents synchronisés pour les 5 joueurs.
- [ ] 30 FPS stables en mode 5 joueurs, map 8×8, obstacles actifs.

---

## Tableau récapitulatif

| Story | Titre | Modèle | Priorité | Dépendances |
|---|---|---|---|---|
| V4-01 | Bug collisions rampes/bosses | Sonnet 4.6 | P0 | aucune |
| V4-02 | Bug inversion géométrie rampe | Haiku 4.5 | P0 | aucune |
| V4-03 | Élévation physique rampe → bloc dur | Sonnet 4.6 | P0 | V4-01, V4-02 |
| V4-04 | Blocmaps départ/arrivée vides | Haiku 4.5 | P0 | SOLO-05 |
| V4-05 | Bords de map en verre | Haiku 4.5 | P1 | aucune |
| V4-06 | Templates blocmap dans le builder | Sonnet 4.6 | P1 | RACE-01 |
| V4-07 | Punchers | Sonnet 4.6 | P1 | V4-01 |
| V4-08 | Vents | Haiku 4.5 | P1 | V4-01 |
| V4-09 | Particules drift PAKO | Sonnet 4.6 | P1 | E03-S10 |
| V4-10 | Portage → game.html | Haiku 4.5 | P2 | V4-01→09 |

---

*Ce fichier est la référence de la MAJ V4. Les valeurs configurables vivent dans `/config/gameplay.json`. Ne jamais hardcoder.*
