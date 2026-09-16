# Stories — Pop Vroum / Module RACE

**Document** : stories atomiques pour sessions code AI
**Version** : 0.1 — 11 mai 2026
**PRD source** : `prd-race.md` v0.1
**CLAUDE.md** : lire avant toute implémentation

---

## Ordre d'implémentation

```
Phase 1 — Test solo      RACE-H01, H03, H04
Phase 2 — Blocs seed     RACE-A01, A02, A03
Phase 3 — Génération     RACE-B01, B02, B03, B04
Phase 4 — Chocs          RACE-D01, D02, D03
Phase 5 — HUD            RACE-E01, E02
Phase 6 — Robustesse     RACE-F01, F02
Phase 7 — Relief         RACE-C01, C02, C03, C04, C05
Phase 8 — Retouche scan  RACE-G01 → G07
```

---

## Récapitulatif modèle recommandé

| Story | Modèle | Raison |
|-------|--------|--------|
| RACE-H01, H03, H04 | Haiku 4.5 | UI + wiring, pas d'algo complexe |
| RACE-A01, A02 | Haiku 4.5 | Génération de JSON structurés |
| RACE-A03 | Sonnet 4.6 | Rotation matricielle + transformation exits |
| RACE-B01 | Sonnet 4.6 | Scan de bords, détection exits automatique |
| RACE-B02, B03, B04 | Sonnet 4.6 | Algo graphe, Prim, BFS — cœur procédural |
| RACE-D01, D02, D03 | Sonnet 4.6 | Raycasting grille voxel + cascade stats |
| RACE-E01, E02 | Haiku 4.5 | Projection géométrique simple |
| RACE-F01 | Haiku 4.5 | frustum.containsPoint() Three.js |
| RACE-F02 | Haiku 4.5 | Regex sanitisation, logique triviale |
| RACE-C01, C02, C03 | Sonnet 4.6 | Nouveau système de hauteur, physique |
| RACE-C04, C05 | Sonnet 4.6 | Physique rampe, impulsion verticale |
| RACE-G01 → G07 | Sonnet 4.6 | Architecture UI nouvelle, session dédiée |

---

---

# Phase 1 — Page de test solo

---

## RACE-H01 — Page `test-solo.html` standalone

**Priorité** : P0
**Modèle** : Haiku 4.5
**Dépendances** : aucune (précède tout)

### Description

Créer une page HTML standalone qui lance une partie solo sans lobby ni Socket.io. Charge un véhicule depuis localStorage ou génère un véhicule de test par défaut (voxels colorés aléatoirement). Génère une map simple (3×3 blocs seed en dur pour cette story — l'algo procédural viendra en Phase 3).

### Fichiers

- `public/test-solo.html` (nouveau)
- `public/js/pages/test-solo.js` (nouveau)

### Contrat I/O

```
Entrée  : localStorage["popvroum_vehicles"] (optionnel)
Sortie  : partie solo jouable dans le navigateur
```

### Critères d'acceptation

- [ ] La page charge et affiche un véhicule en moins de 10s depuis un navigateur vierge
- [ ] Si localStorage vide : véhicule de test généré automatiquement (grille 4×4×8 avec quelques voxels de chaque couleur)
- [ ] La map 3×3 de test est visible et le véhicule peut se déplacer dedans
- [ ] Aucun appel Socket.io, aucun lobby

---

## RACE-H03 — Contrôles clavier + raccourcis de test

**Priorité** : P0
**Modèle** : Haiku 4.5
**Dépendances** : RACE-H01

### Description

Ajouter les contrôles clavier complets à `test-solo.html` et les raccourcis de développement.

### Fichiers

- `public/js/pages/test-solo.js`

### Contrat I/O

```
Entrée  : événements keydown/keyup
Sortie  : actions sur l'état du jeu

Touches :
  ↑ / W  → accélérer
  ↓ / S  → freiner
  ← / A  → tourner gauche
  → / D  → tourner droite
  R      → régénérer la map (réinitialise la scène)
  V      → véhicule suivant dans localStorage
  D      → toggle overlay debug (RACE-H04)
```

### Critères d'acceptation

- [ ] Flèches et WASD fonctionnent simultanément
- [ ] `R` régénère la map sans recharger la page
- [ ] `V` cycle à travers les véhicules sauvegardés en localStorage
- [ ] `D` affiche/cache l'overlay debug

---

## RACE-H04 — Overlay d'équilibrage (debug live)

**Priorité** : P0
**Modèle** : Haiku 4.5
**Dépendances** : RACE-H01, RACE-H03

### Description

Overlay HTML superposé au canvas Three.js affichant les métriques clés en temps réel. Togglable via touche `D`.

### Fichiers

- `public/js/pages/test-solo.js`
- Style inline dans `test-solo.html`

### Contrat I/O

```
Entrée  : state joueur (velocity, angle, drifting, voxels)
Sortie  : affichage overlay

Métriques affichées :
  vitesse (m/s)
  v_lateral (m/s)
  is_drifting (boolean)
  voxels restants / total
  fps (moyenne glissante 60 frames)
  position (x, z)
```

### Critères d'acceptation

- [ ] Overlay mis à jour à chaque frame
- [ ] Lisible sur fond sombre et fond clair
- [ ] `D` toggle sans lag
- [ ] fps affiché en nombre entier (pas de décimales)

---

---

# Phase 2 — Blocs seed

---

## RACE-A01 — Set de blocs seed JSON

**Priorité** : P0
**Modèle** : Haiku 4.5
**Dépendances** : aucune

### Description

Créer les 6 fichiers JSON de blocs seed de base dans `/data/map-blocks/_seed/`. Chaque bloc respecte le format existant + champ `exits`.

### Fichiers

```
/data/map-blocks/_seed/block_seed_droite.json
/data/map-blocks/_seed/block_seed_virage_g.json
/data/map-blocks/_seed/block_seed_virage_d.json
/data/map-blocks/_seed/block_seed_chicane.json     (existe déjà — ajouter exits)
/data/map-blocks/_seed/block_seed_carrefour_t.json
/data/map-blocks/_seed/block_seed_rond_point.json
```

### Contrat I/O

Format JSON pour chaque bloc :

```json
{
  "id": "block_seed_[nom]",
  "name": "[Nom lisible]",
  "createdAt": "2026-05-11T00:00:00Z",
  "atelier": "_seed",
  "exits": ["N", "S"],
  "grid": [ [...8 lignes de 8 cellules...] ]
}
```

Valeurs exits : `"N"` (nord, bord haut), `"S"` (sud, bord bas), `"E"` (est, bord droit), `"O"` (ouest, bord gauche).

### Critères d'acceptation

- [ ] 6 fichiers créés et valides (JSON.parse sans erreur)
- [ ] Chaque bloc a au moins 2 exits cohérentes avec sa grille
- [ ] Le bloc chicane existant est mis à jour avec ses exits
- [ ] Les routes sont continues (pas de cellule isolée)
- [ ] Les bords de route atteignent effectivement le bord de la grille 8×8 sur les exits déclarées

---

## RACE-A02 — Schéma de validation JSON des blocs

**Priorité** : P1
**Modèle** : Haiku 4.5
**Dépendances** : RACE-A01

### Description

Fonction de validation `validateBlock(json)` qui vérifie la structure d'un bloc avant utilisation. Utilisée par le serveur lors du chargement des blocs.

### Fichiers

- `public/js/modules/block/validator.js` (nouveau)

### Contrat I/O

```js
// Entrée
validateBlock(json)

// Sortie
{ valid: true }
// ou
{ valid: false, errors: ["exits manquants", "grille invalide (doit être 8×8)"] }
```

### Critères d'acceptation

- [ ] Détecte grille non-8×8
- [ ] Détecte exits avec valeurs invalides (hors N/S/E/O)
- [ ] Accepte exits absent (rétrocompatibilité)
- [ ] Testable avec `node` sans UI

---

## RACE-A03 — Rotation globale d'un bloc (grille + exits)

**Priorité** : P0
**Modèle** : Sonnet 4.6
**Dépendances** : RACE-A01

### Description

Fonction utilitaire `rotateBlock(block, steps)` où `steps` ∈ {0, 1, 2, 3} correspond à 0°, 90°, 180°, 270° dans le sens horaire. Transforme la grille 8×8 ET les exits en conséquence.

### Fichiers

- `public/js/modules/block/builder.js` (étendre ou créer)

### Contrat I/O

```js
// Entrée
rotateBlock(block, 1)  // 90° CW

// Sortie — nouveau bloc (immutable, ne modifie pas l'original)
{
  ...block,
  exits: ["E", "O"],   // N→E, S→O après rotation 90° CW
  grid: [[...]]        // grille pivotée 90° CW
}

// Correspondance exits par rotation 90° CW :
// N → E → S → O → N
```

### Critères d'acceptation

- [ ] Rotation 0° = bloc identique
- [ ] Rotation 4× 90° = bloc identique à l'original
- [ ] Un virage G (exits S, O) devient virage D (exits S, E) après rotation 90° CW
- [ ] La grille 8×8 est correctement transposée (pas d'inversion d'axe)
- [ ] Fonction pure (n'altère pas le bloc source)
- [ ] Testable avec `node` sans UI

---

---

# Phase 3 — Génération procédurale

---

## RACE-B01 — Détection automatique des exits (fallback)

**Priorité** : P0
**Modèle** : Sonnet 4.6
**Dépendances** : RACE-A01

### Description

Fonction `detectExits(grid)` qui analyse les 4 bords d'une grille 8×8 et retourne les exits probables. Une sortie est détectée si au moins une cellule non-null est présente parmi les 3 cellules centrales du bord (indices 2, 3, 4 sur les 8 colonnes/lignes).

### Fichiers

- `public/js/modules/block/builder.js`

### Contrat I/O

```js
// Entrée : grille 8×8 (null = vide, string = type de cellule)
detectExits(grid)

// Sortie
["N", "S"]   // exits détectées

// Logique de détection par bord :
// Nord  : grid[0][2], grid[0][3], grid[0][4]
// Sud   : grid[7][2], grid[7][3], grid[7][4]
// Est   : grid[2][7], grid[3][7], grid[4][7]
// Ouest : grid[2][0], grid[3][0], grid[4][0]
// Si au moins 1 non-null parmi les 3 → exit détectée
```

### Critères d'acceptation

- [ ] Détecte correctement les exits du bloc chicane existant
- [ ] Retourne tableau vide `[]` si grille entièrement null
- [ ] Préfère `block.exits` si présent (ne remplace pas la métadonnée manuelle)
- [ ] Testable avec `node`

---

## RACE-B02 — Algo d'assemblage de blocs (grille NxM)

**Priorité** : P0
**Modèle** : Sonnet 4.6
**Dépendances** : RACE-A03, RACE-B01

### Description

Fonction `generateMap(pool, gridSize, seed)` qui place les blocs du pool sur une grille de `gridSize × gridSize` emplacements. Chaque bloc posé doit connecter au moins une de ses exits à un bloc adjacent. L'algo peut appliquer jusqu'à 4 rotations pour trouver une connexion valide.

### Fichiers

- `public/js/modules/block/map-generator.js` (étendre)

### Contrat I/O

```js
// Entrée
generateMap(pool, 4, 42)  // pool = tableau de blocs, gridSize=4, seed=42

// Sortie
{
  seed: 42,
  gridSize: 4,
  blocks: [
    { row: 0, col: 0, blockId: "block_seed_virage_g", rotation: 1 },
    { row: 0, col: 1, blockId: "block_seed_droite",   rotation: 0 },
    ...
  ]
}
```

### Critères d'acceptation

- [ ] Chaque emplacement de la grille est rempli
- [ ] Chaque bloc a au moins une exit connectée à un bloc adjacent
- [ ] Même seed → même map à chaque appel
- [ ] Fonctionne avec un pool de 6 blocs seed seulement
- [ ] Testable sans rendu Three.js

---

## RACE-B03 — Garantie de boucles (Prim + reconnexions)

**Priorité** : P0
**Modèle** : Sonnet 4.6
**Dépendances** : RACE-B02

### Description

Étendre `generateMap` pour garantir qu'au moins une boucle existe dans la map. Approche : après génération de l'arbre couvrant minimal (Prim), ajouter aléatoirement K reconnexions entre blocs adjacents non encore connectés (K = floor(gridSize / 2)).

### Fichiers

- `public/js/modules/block/map-generator.js`

### Contrat I/O

Même interface que RACE-B02. La sortie inclut des connexions supplémentaires.

### Critères d'acceptation

- [ ] La map générée contient au moins 1 cycle (détectable par DFS)
- [ ] Le nombre de boucles est proportionnel à `gridSize` (plus la map est grande, plus il y a de boucles)
- [ ] Pas de cul-de-sac : tout bloc a au moins 2 connexions (entrée + sortie)

---

## RACE-B04 — Validation BFS (chemin départ → arrivée)

**Priorité** : P0
**Modèle** : Sonnet 4.6
**Dépendances** : RACE-B03

### Description

Fonction `validateMap(mapData)` qui vérifie par BFS que tous les blocs de la map sont accessibles depuis le bloc de départ (coin haut-gauche). Si la validation échoue, `generateMap` relance avec un nouveau seed (max 10 tentatives).

### Fichiers

- `public/js/modules/block/map-generator.js`

### Contrat I/O

```js
validateMap(mapData)
// → { valid: true, reachable: 16 }
// ou
// → { valid: false, unreachable: [{ row: 2, col: 3 }] }
```

### Critères d'acceptation

- [ ] Détecte les blocs isolés
- [ ] `generateMap` ne retourne jamais une map invalide
- [ ] Max 10 tentatives avant d'émettre une erreur explicite en console
- [ ] Testable avec `node`

---

---

# Phase 4 — Perte de voxels au choc

---

## RACE-D01 — Seuil de dommage par delta vitesse

**Priorité** : P0
**Modèle** : Sonnet 4.6
**Dépendances** : E03-S09 (rebond mur)

### Description

Au moment d'une collision mur, calculer le delta vitesse (`|v_avant_choc| - |v_après_choc|`). Si ce delta dépasse `DAMAGE_THRESHOLD` (gameplay.json), déclencher la perte de voxels. En dessous : rebond sans dommage.

### Fichiers

- `server.js` (ou `public/js/modules/game/physics.js`)
- `/config/gameplay.json` — ajouter `DAMAGE_THRESHOLD: 8`

### Contrat I/O

```js
// Appelé après calcul du rebond
checkDamage(velocityBefore, velocityAfter, impactNormal)
// → { damaged: false }
// ou
// → { damaged: true, deltaSpeed: 12.3, impactPoint: {x, y, z}, impactNormal: {x,z} }
```

### Critères d'acceptation

- [ ] Un effleurement (delta < 8 m/s) ne cause aucun dommage
- [ ] Un choc frontal à vitesse max cause des dommages
- [ ] `DAMAGE_THRESHOLD` externalisé dans `gameplay.json`
- [ ] Testable avec `node` (pas de rendu)

---

## RACE-D02 — Raycasting voxel depuis l'impact

**Priorité** : P0
**Modèle** : Sonnet 4.6
**Dépendances** : RACE-D01

### Description

Quand `damaged: true`, lancer un rayon depuis le point d'impact dans la direction de la normale du mur, à travers la grille voxel 4×4×8. Retirer les N premiers voxels touchés (N = `floor(deltaSpeed / DAMAGE_THRESHOLD)`, min 1, max 4).

### Fichiers

- `public/js/modules/voxel/impact.js` (nouveau)

### Contrat I/O

```js
// Entrée
applyImpactDamage(vehicleGrid, impactData)
// impactData = { deltaSpeed, impactPoint, impactNormal }

// Sortie
{
  newGrid: [...],           // grille 4×4×8 mise à jour
  removedVoxels: [
    { x: 3, z: 1, y: 2, color: "rouge" },
    ...
  ]
}
```

### Critères d'acceptation

- [ ] Les voxels retirés sont bien les plus exposés face à l'impact (côté normal du mur)
- [ ] N voxels retirés = `floor(deltaSpeed / DAMAGE_THRESHOLD)`, max 4
- [ ] Si la face touchée n'a pas de voxel : rayon continue jusqu'au prochain
- [ ] Testable avec une grille mockée

---

## RACE-D03 — Mise à jour stats après perte de voxels

**Priorité** : P0
**Modèle** : Sonnet 4.6
**Dépendances** : RACE-D02

### Description

Après `applyImpactDamage`, recalculer les stats du véhicule (speed, grip, accel) proportionnellement au nombre de voxels restants par rapport au total. Mettre à jour les pouvoirs actifs : si une couleur n'a plus aucun voxel, le pouvoir correspondant est désactivé.

### Fichiers

- `public/js/modules/voxel/stats.js` (étendre)

### Contrat I/O

```js
// Entrée
recalcStats(newGrid, originalGrid)

// Sortie
{
  stats: { speed: 0.8, grip: 0.6, accel: 0.9 },  // ratios 0-1
  activePowers: ["rouge", "vert"],                  // couleurs encore présentes
  lostPowers: ["bleu"]                              // couleurs disparues
}
```

### Critères d'acceptation

- [ ] Stats proportionnelles aux voxels restants (50% voxels = ~50% stats)
- [ ] Pouvoir désactivé si 0 voxel de cette couleur
- [ ] Pouvoir réactivable si voxels restaurés (bulle de soin rose)
- [ ] Testable avec grille mockée

---

---

# Phase 5 — HUD flèches hors-écran

---

## RACE-E01 — Flèches HUD hors-écran

**Priorité** : P0
**Modèle** : Haiku 4.5
**Dépendances** : E03-S10 (payload réseau avec position)

### Description

Pour chaque joueur distant absent du frustum caméra, afficher une flèche colorée sur le bord de l'écran indiquant sa direction. La couleur de la flèche = couleur dominante du véhicule.

### Fichiers

- `public/js/modules/game/offscreen.js` (étendre ou créer)
- `public/js/pages/game.js` (intégration HUD)

### Contrat I/O

```js
// Appelé chaque frame pour chaque joueur distant
updateOffscreenIndicator(playerId, worldPosition, dominantColor, camera)
// → affiche ou cache la flèche du joueur sur le HUD
```

### Critères d'acceptation

- [ ] Flèche visible uniquement quand le joueur est hors du frustum
- [ ] Flèche disparaît quand le joueur rentre dans le champ de vue
- [ ] Couleur correcte par joueur
- [ ] Fonctionne pour 4 joueurs simultanément

---

## RACE-E02 — Calcul de position flèche sur le bord d'écran

**Priorité** : P0
**Modèle** : Haiku 4.5
**Dépendances** : RACE-E01

### Description

Calculer la position exacte de la flèche sur le bord de l'écran. Projeter la position monde du joueur distant sur le plan écran, tracer une droite depuis le centre vers ce point projeté, et clipper sur le bord du rectangle écran.

### Fichiers

- `public/js/modules/game/offscreen.js`

### Contrat I/O

```js
// Entrée
computeEdgePosition(screenPos, screenWidth, screenHeight)
// screenPos = projection Three.js en coordonnées normalisées [-1, 1]

// Sortie
{
  x: 45,          // pixels depuis le bord gauche
  y: 320,         // pixels depuis le bord haut
  angle: 1.23     // radians, pour orienter la flèche
}
```

### Critères d'acceptation

- [ ] La flèche reste toujours dans les marges de l'écran (padding 20px des bords)
- [ ] L'angle de la flèche pointe vers le joueur (pas vers un bord fixe)
- [ ] Joueur derrière la caméra géré correctement (pas de position NaN)

---

---

# Phase 6 — Robustesse et sécurité

---

## RACE-F01 — Culling des blocs hors frustum

**Priorité** : P0
**Modèle** : Haiku 4.5
**Dépendances** : RACE-B02 (map générée)

### Description

À chaque frame, vérifier quels blocs map sont dans le frustum caméra. Ajouter/retirer de la scène Three.js selon leur visibilité. Zone tampon : un bloc est gardé en scène même s'il est à 1 bloc au-delà du frustum (évite les pop-ins).

### Fichiers

- `public/js/modules/block/renderer.js` (étendre)

### Critères d'acceptation

- [ ] Blocs hors frustum retirés de la scène (pas seulement cachés)
- [ ] Aucun pop-in visible lors des déplacements normaux
- [ ] Gain de fps mesurable sur map 5×5 (overlay RACE-H04)
- [ ] Pas de fuite mémoire (geometries/materials non disposées)

---

## RACE-F02 — Sanitisation XSS des pseudos et champs texte

**Priorité** : P0
**Modèle** : Haiku 4.5
**Dépendances** : aucune

### Description

Côté serveur (`server.js`), sanitiser tous les champs texte entrants avant diffusion via Socket.io.

### Fichiers

- `server.js`

### Contrat I/O

```js
// Fonction utilitaire
sanitizeText(input, maxLength = 20)
// → string nettoyée

// Règles :
// - Strip toutes les balises HTML (< et > encodés en entités)
// - Trim whitespace
// - Longueur max 20 caractères (pseudo) ou 100 (nom de bloc/note)
// - Whitelist chars pseudo : [a-zA-Z0-9_\-\s]
// - Champs concernés : pseudo joueur, name bloc, note bloc
```

### Critères d'acceptation

- [ ] `<script>alert(1)</script>` → affiché comme texte brut `&lt;script&gt;alert(1)&lt;/script&gt;`
- [ ] Pseudo de 200 chars → tronqué à 20
- [ ] Caractères unicode courants (accents français) conservés
- [ ] Sanitisation appliquée AVANT `io.emit` et AVANT écriture JSON

---

---

# Phase 7 — Relief (plateaux et rampes)

---

## RACE-C01 — Champ `elevation` dans le format de bloc

**Priorité** : P0
**Modèle** : Sonnet 4.6
**Dépendances** : RACE-A01

### Description

Étendre le format JSON de bloc pour supporter un champ `elevation` par cellule. Deux approches possibles : grille parallèle `elevationGrid` ou objet par cellule `{ type: "dur", elevation: 1 }`. Choisir la plus rétrocompatible.

### Fichiers

- `docs/architecture.md` (documenter le format étendu)
- `public/js/modules/block/validator.js` (étendre)

### Contrat I/O

Format retenu (grille parallèle pour rétrocompatibilité) :

```json
{
  "grid": [["dur", null, ...], ...],
  "elevationGrid": [[1, 0, ...], ...]
}
```

Absence de `elevationGrid` → toutes les cellules à élévation 0.

### Critères d'acceptation

- [ ] Les blocs existants sans `elevationGrid` fonctionnent sans modification
- [ ] Validator accepte les deux formats
- [ ] Format documenté dans `architecture.md`

---

## RACE-C02 — Rendu Three.js des plateaux

**Priorité** : P0
**Modèle** : Sonnet 4.6
**Dépendances** : RACE-C01

### Description

Les cellules avec `elevation: 1` sont rendues avec une hauteur supplémentaire de `PLATEAU_HEIGHT` unités (configurable dans `layout.json`, valeur initiale : 0.5). Ajouter une face visible sur les bords du plateau (mur de transition).

### Fichiers

- `public/js/modules/block/renderer.js`
- `/config/layout.json` — ajouter `PLATEAU_HEIGHT: 0.5`

### Critères d'acceptation

- [ ] Cellules élévation 1 visuellement plus hautes que élévation 0
- [ ] Mur de transition visible sur les bords des plateaux
- [ ] Pas de Z-fighting entre le sol et le plateau
- [ ] Rétrocompatible avec les blocs sans `elevationGrid`

---

## RACE-C03 — Physique des plateaux (collision bord)

**Priorité** : P0
**Modèle** : Sonnet 4.6
**Dépendances** : RACE-C02, E03-S09

### Description

Le bord d'un plateau (transition élévation 0 → 1) agit comme un mur si le véhicule n'est pas sur une rampe. Réutilise la logique de rebond mur (E03-S09).

### Fichiers

- `server.js` (détection collision)
- `public/js/modules/game/physics.js`

### Critères d'acceptation

- [ ] Le véhicule rebondit sur le bord d'un plateau sans rampe
- [ ] Le bord est détecté à la même précision que les murs normaux
- [ ] Pas de traversée de bord à haute vitesse (tunneling)

---

## RACE-C04 — Rampe douce (pente progressive)

**Priorité** : P1
**Modèle** : Sonnet 4.6
**Dépendances** : RACE-C03

### Description

Cellule de type `rampe_pente` : le véhicule monte de y=0 à y=1 (ou descend de y=1 à y=0) progressivement sur la longueur de la cellule. La vitesse horizontale est conservée. Orientation de la rampe définie par un champ `direction` dans le JSON (`N`, `S`, `E`, `O`).

### Fichiers

- `public/js/modules/game/physics.js`
- `public/js/modules/block/renderer.js` (rendu en pente)

### Contrat I/O

```json
// Cellule de type rampe dans la grille
{ "type": "rampe_pente", "direction": "N", "elevation_start": 0, "elevation_end": 1 }
```

### Critères d'acceptation

- [ ] Le véhicule monte sans rebond sur la rampe pente
- [ ] Vitesse horizontale conservée (pas de frein à la montée)
- [ ] La rampe est visuellement inclinée dans le bon sens
- [ ] Descente (élévation 1 → 0) fonctionne aussi

---

## RACE-C05 — Rampe bosse (saut court)

**Priorité** : P1
**Modèle** : Sonnet 4.6
**Dépendances** : RACE-C04

### Description

Cellule de type `rampe_bosse` : applique une impulsion verticale courte au passage. Le véhicule quitte brièvement le sol. Particules à l'atterrissage.

### Fichiers

- `public/js/modules/game/physics.js`
- `public/js/modules/game/particles.js`

### Contrat I/O

```js
// Appelé quand le véhicule entre dans une cellule rampe_bosse
applyBump(velocity, BUMP_IMPULSE)
// BUMP_IMPULSE configurable dans gameplay.json (valeur initiale : 5.0)
```

### Critères d'acceptation

- [ ] Le véhicule saute visible (suspension visuelle brève)
- [ ] Particules à l'atterrissage
- [ ] Vitesse horizontale conservée pendant le saut
- [ ] L'effet est désactivable depuis `gameplay.json` (`BUMP_IMPULSE: 0`)

---

---

# Phase 8 — Retouche scan (session dédiée)

> ⚠️ Cette phase nécessite une session de design dédiée avant implémentation. Lire `scan2.html` et `block-editor.html` en entier avant de commencer.

---

## RACE-G01 — Architecture `scan-edit.html` + structure de données

**Priorité** : P0
**Modèle** : Sonnet 4.6
**Dépendances** : scan2.html existant, block-editor.html existant

### Description

Créer la page `scan-edit.html` et définir la structure de données du véhicule retouché. Le JSON retouché est un dérivé du JSON scanné — le JSON original n'est jamais modifié.

### Fichiers

- `public/scan-edit.html` (nouveau)
- `public/js/pages/scan-edit.js` (nouveau)

### Contrat I/O

```js
// Chargement
const scanned = JSON.parse(localStorage["popvroum_scanned_current"])
// scanned.grid = grille voxel 4×4×8 telle que lue par le scan

// Données de travail (dérivées, non-destructives)
const editState = {
  original: scanned.grid,     // jamais modifié
  edited: deepCopy(scanned.grid),  // surface de travail
  dirty: false
}
```

### Critères d'acceptation

- [ ] Page charge le résultat du scan depuis localStorage
- [ ] `editState.original` n'est jamais muté
- [ ] Si localStorage vide : affiche un message et propose de scanner
- [ ] Structure `editState` accessible depuis tous les modules de la page

---

## RACE-G02 — 4 vues horizontales 2D

**Priorité** : P0
**Modèle** : Sonnet 4.6
**Dépendances** : RACE-G01

### Description

Afficher les 4 tranches horizontales (`y=0` à `y=3`) de la grille voxel 4×4×8 sous forme de 4 grilles 2D de 4×8 cellules. Légende : dessous (y=0), milieu bas (y=1), milieu haut (y=2), dessus (y=3).

### Fichiers

- `public/js/pages/scan-edit.js`
- `public/scan-edit.html`

### Critères d'acceptation

- [ ] 4 grilles affichées, chacune labellisée
- [ ] Chaque cellule colorée selon la couleur du voxel (ou gris clair si null)
- [ ] Les grilles correspondent bien aux tranches y=0..3 de la grille 4×4×8
- [ ] Responsive : lisible sur tablette en portrait

---

## RACE-G03 — Correction couleur par clic

**Priorité** : P0
**Modèle** : Sonnet 4.6
**Dépendances** : RACE-G02

### Description

Clic sur une cellule colorée → sélecteur des 6 couleurs + option "effacer" (null). La cellule dans `editState.edited` est mise à jour. `dirty` passe à `true`.

### Fichiers

- `public/js/pages/scan-edit.js`

### Critères d'acceptation

- [ ] Sélecteur affiché au clic, fermé au clic extérieur ou validation
- [ ] Les 6 couleurs du vocabulaire + "effacer" présents
- [ ] La cellule change visuellement immédiatement
- [ ] `editState.original` inchangé après correction

---

## RACE-G04 — Ajout de voxels manquants

**Priorité** : P0
**Modèle** : Haiku 4.5
**Dépendances** : RACE-G03

### Description

Les cellules null cliquables dans les 4 vues permettent d'ajouter un voxel avec la couleur choisie dans le sélecteur. Même sélecteur que RACE-G03, sans l'option "effacer".

### Fichiers

- `public/js/pages/scan-edit.js`

### Critères d'acceptation

- [ ] Cellule null affiche un indicateur (+) au survol
- [ ] Clic → sélecteur couleur (sans option effacer)
- [ ] Voxel ajouté visible immédiatement dans la vue 2D et la vue 3D

---

## RACE-G05 — Aperçu 3D synchronisé

**Priorité** : P0
**Modèle** : Sonnet 4.6
**Dépendances** : RACE-G03, RACE-G04

### Description

Rendu Three.js du véhicule mis à jour en temps réel à chaque modification dans les grilles 2D. Réutilise `voxel/renderer.js` existant.

### Fichiers

- `public/js/pages/scan-edit.js`
- `public/js/modules/voxel/renderer.js` (réutilisé sans modification)

### Critères d'acceptation

- [ ] Le rendu 3D se met à jour < 100ms après chaque modification
- [ ] Rotation libre de la vue 3D (OrbitControls ou équivalent)
- [ ] Les voxels ajoutés/modifiés/supprimés sont reflétés fidèlement

---

## RACE-G07 — Validation et retour au flow

**Priorité** : P0
**Modèle** : Haiku 4.5
**Dépendances** : RACE-G05

### Description

Bouton "Valider les retouches" : enregistre `editState.edited` dans localStorage sous la même clé que le véhicule scanné (remplace). Redirige vers la page de validation existante. Bouton "Annuler" : revient au scan sans modification.

### Fichiers

- `public/js/pages/scan-edit.js`

### Critères d'acceptation

- [ ] "Valider" écrit le JSON retouché dans localStorage
- [ ] "Annuler" ne modifie pas localStorage
- [ ] Validation de structure avant écriture (grille 4×4×8, couleurs valides)
- [ ] Message de confirmation si `dirty: false` (aucune retouche effectuée)

---

*Document stories v0.1 — à utiliser avec `prd-race.md` v0.1 et `CLAUDE.md`*
