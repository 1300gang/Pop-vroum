# Architecture — Pop Vroum

**Projet** : Pop Vroum
**Porteur** : 1k3vrtical / Collectif Mille Trois Cents
**Version** : 1.0 — document consolidé, fait foi
**Date** : 16 septembre 2026
**Document amont** : `prd.md` v1.0

> Ce document décrit **le code tel qu'il est**, vérifié fichier par fichier le 16/09/2026 — pas la structure prévue à l'origine. Quand un doc plus ancien contredit ce qui suit, c'est ce document (et le code) qui font foi.

---

## 1. Topologie

Application web client-serveur sur **réseau local uniquement**. Aucune dépendance cloud, aucun hébergement distant prévu.

```
Wi-Fi de la salle
  ├── Tablettes / téléphones (scan + pilotage)   ──┐
  ├── Écran ou projecteur (spectator.html)        ─┼── Socket.io ──> Serveur Node
  └── Laptop animateur·trice (éditeur de blocs)   ──┘                 (port 3000)
                                                                       + JSON store
```

| Couche | Choix |
|--------|-------|
| Backend | Node.js 20+, Express 4, Socket.io 4 |
| Frontend | HTML/CSS/JS vanilla, ES modules natifs, **aucun bundler** |
| 3D | Three.js (servi depuis `/public/js/lib/`) |
| Vision | OpenCV.js + jsQR (locaux, jamais de CDN) |
| Stockage | Fichiers JSON (`/data/`) + localStorage client. Pas de base de données. |
| Dépendances npm | `express`, `socket.io` uniquement (+ `qrcode` en dev) |

---

## 2. Convention de coordonnées voxel — CRITIQUE

```
grid[x][z][y]
  x ∈ [0, 7]  avant-arrière (longueur)   x = 7 → AVANT du véhicule
  z ∈ [0, 3]  gauche-droite (largeur)    z = 3 → côté DROIT
  y ∈ [0, 3]  bas-haut     (hauteur)     y = 0 → BAS
```

Dimensions : `DIM_X = 8`, `DIM_Z = 4`, `DIM_Y = 4`.

**Ne jamais inverser x et z.** `docs/scan-v2-sandwich.md` documente une convention inversée (x = colonnes, z = lignes) : elle est **fausse**. `voxel/builder-sandwich.js` signale explicitement l'écart et applique la bonne convention, pour rester compatible avec `wheel-detector`, `stats` et `renderer` sans adaptation.

### Mapping des deux feuilles

**v1 — 3 vues orthogonales** (`voxel/builder.js`, gelée)
- Entrées : `face[z][row]`, `profile[x][row]`, `top[x][z]`
- `row = 0` dans l'image = haut du dessin → `y = DIM_Y - 1 - row`
- Règle d'existence : **union 2-sur-3** — un voxel existe si au moins 2 des 3 vues le confirment
- Couleur : majoritaire parmi les vues confirmantes, égalité → la face l'emporte

**v2 — sandwich** (`voxel/builder-sandwich.js`, **officielle**)
- Entrée : `slices[sliceIndex][row][col]`
- `sliceIndex` → `y` (tranche 0 = dessous, 3 = dessus)
- `col` → `z` (col 0 = gauche)
- `row` → `x` **inversé** : `x = DIM_X - 1 - row` (row 0 = haut de grille = avant = x=7)
- Reconstruction **directe**, sans union : case coloriée = voxel existant

---

## 3. Structure réelle des fichiers

```
/server.js                    Express + Socket.io, port 3000
                              static: /public, /config, /data
                              route: GET /api/map-blocks
/server/
  game-loop.js                Boucle autoritaire 30 Hz. Importe les modules partagés.
  lobby-manager.js            Lobbies 1-5 joueurs, statut, ready
  match-end.js                Détection d'arrivée + victoire collective
  admin-routes.js             GET/POST /admin/blocks  ⚠ contredit la décision produit
  cohesion.js                 ⚠ STUB — 1 ligne, vide

/config/
  gameplay.json               vehicleStats, powers, physics, surfaceGrip,
                              cohesion, map, solo, match
  scan.json                   6 cibles HSL, tolérances, échantillonnage
  layout.json                 vehicleSheet (v1) + vehicleSheetV2 (sandwich) + blockSheet

/data/map-blocks/
  _seed/                      17 fichiers — voir §7
  generated/                  blocs créés en atelier (1 à ce jour)

/public/
  index.html                  Accueil — flux atelier + section Dev/Test
  scan2.html                  ★ Scan officiel (feuille sandwich)
  scan.html                   Scan v1 — gelé, conservé, plus maintenu
  scan-edit.html              Retouche voxel post-scan
  lobby.html                  Lobby multijoueur
  game.html                   Jeu multijoueur
  spectator.html              Vue collective écran/projecteur
  gallery.html                Galerie localStorage
  block-editor.html           Éditeur de blocs (usage animateur·trice)
  test-*.html                 8 pages — bancs d'essai, hors parcours atelier

/public/js/modules/
  scan/      capture · qr-detect · perspective · segmenter · segmenter-v2
             color-reader · calibration · manual-hsl-tuner · debug-view
             symbol-reader  ⚠ mort (scan de blocs abandonné)
  voxel/     builder (v1) · builder-sandwich (v2) · wheel-detector · stats
             renderer · impact (raycast dégâts) · random-vehicle
  block/     builder · renderer · editor · validator
  game/      physics · collision · controls · camera · map-generator · map-loader
             powers · cohesion-visual · minimap · offscreen · particles · skid
             trail · movables · bot · test-blocks-v4 · test-track
             cohesion.js  ⚠ STUB      impact.js  ⚠ STUB
  network/   client · lobby · sync
  storage/   local · gallery

/public/js/pages/             un script d'entrée par page
```

### Modules partagés client ↔ serveur

`game-loop.js` importe directement les modules du client — **pas de duplication de la physique** :

| Module | Ce que le serveur en importe |
|--------|------------------------------|
| `game/physics.js` | `setConfig`, `decompose`, `computeForces`, `detectDrift`, `computeTurnRate`, `applyBounce`, `checkDamage`, `createState` |
| `game/collision.js` | `checkTerrain` |
| `game/map-generator.js` | `setConfig`, `generate`, `getSurfaceGrip`, `dedupePoolById`, `BLOCK_SIZE` |

Contrainte : ces modules doivent rester **du JS pur**, sans `document`, `window` ni Three.js, sinon le serveur casse.

---

## 4. Frontière app atelier / outils dev

Frontière **stricte** (décision produit). Le jeu doit rester avec le moins d'UI possible.

| Parcours atelier | Outils dev (jamais devant les participant·es) |
|---|---|
| `index.html` · `scan2.html` · `scan-edit.html` · `lobby.html` · `game.html` · `spectator.html` · `gallery.html` · `block-editor.html` | `test-solo-v3.html` (banc principal) · `test-jeu-v2-solo.html` · `test-map.html` · `test-game.html` · `test-voxel.html` · `test-block.html` · `test-gallery.html` · `test-libs.html` · `game/bot.js` · `game/test-blocks-v4.js` · `game/test-track.js` · `voxel/random-vehicle.js` |

Les bancs d'essai sont **conservés**, pas supprimés après portage.

Règle de réconciliation quand deux pages divergent : **la page modifiée le plus récemment et proprement fait référence.** Au 16/09/2026, `test-solo-v3.js` (1707 lignes, le plus récent) est en avance sur `game-page.js` (1209 lignes) ; `test-jeu-v2-solo-page.js` (mai) est à considérer comme périmé.

---

## 5. Pipeline de scan

```
[caméra]
  → capture.js            frame ImageData
  → qr-detect.js          4 coins QR
  → perspective.js        homographie → image redressée
  → segmenter-v2.js       4 tranches + patch couleur     (v1 : segmenter.js → 3 vues)
  → calibration.js        lecture du patch → cibles HSL de la session
  → color-reader.js       couleur médiane par case → 6 couleurs ou null
  → builder-sandwich.js   reconstruction directe → grid[x][z][y]   (v1 : builder.js, union 2-sur-3)
  → wheel-detector.js     4 positions de roues
  → stats.js              stats RVB + pouvoirs HSL
  → JSON véhicule → localStorage
```

`debug-view.js` peut intercepter chaque étape. `manual-hsl-tuner.js` permet l'ajustement manuel des cibles. `scan-edit.html` vient après : retouche voxel par voxel, non destructive, puis redirection vers `lobby.html`.

---

## 6. Formats JSON

### Véhicule

```json
{
  "id": "veh_...",
  "playerName": "Sami",
  "createdAt": "2026-09-16T14:23:37Z",
  "grid": "[x][z][y] — 8 × 4 × 4, cellule = { color } | null",
  "wheelPositions": [{ "x": 1, "y": -0.3, "z": 0 }],
  "stats":  { "speed": 8, "grip": 2, "accel": 3 },
  "powers": { "aspiration": 0, "phares": 0, "sillage": 0,
              "shield": 4, "attraction": 0, "heal": 0 },
  "voxelCount": 22
}
```

### Bloc map

```json
{
  "id": "block_seed_virage_g",
  "name": "Virage G",
  "createdAt": "...",
  "atelier": "_seed",
  "exits": ["N", "O"],
  "grid": "8 × 8 — type de cellule ou null"
}
```

Types de cellule : `dur` · `sticky` · `boost` · `ramp` / `ramp_n|s|e|o` · `rampe_bosse` · `bump` · `movable` · `pole`.
Hauteurs et couleurs sont définies dans `TYPES_CELLULE` (dans les pages de jeu), **pas** dans le JSON.

### MapData (produit par `map-generator.js`)

```json
{
  "id": "...", "gridCols": 4, "gridRows": 4, "blockScale": 2,
  "blocks": [{ "blockId": "...", "name": "...", "col": 0, "row": 0,
               "position": [worldX, worldZ], "grid": [] }],
  "startPosition":  { "x": 0, "z": 0, "angle": 0 },
  "finishPosition": { "x": 0, "z": 0 },
  "worldExtent":    { "width": 0, "depth": 0 }
}
```

Le générateur fonctionne en **deux modes** :
- **graph** — blocs avec `exits` : arbre couvrant DFS + reconnexions type Prim pour créer des boucles, puis validation BFS de la connexité
- **legacy** — blocs sans `exits` : placement aléatoire vérifié par `_estJouable()`

`BLOCK_SIZE = 8`. Rotation de grille 90° CW avec rotation des directions intrinsèques des rampes (sinon une rampe garde son orientation d'origine après rotation).

---

## 7. Pool de blocs

17 fichiers dans `_seed/`, en trois familles :

| Famille | Fichiers | `exits` |
|---|---|---|
| Blocs graphe | `block_seed_` × 10 (bosses, carrefour_t, chicane, cubes_mobiles, droite, poteaux, rampe_dir, rond_point, virage_d, virage_g) | oui |
| Départ / arrivée | `blocmap-depart`, `blocmap-arrivee` — 64 cellules vides | N/S/E/O |
| Anciens blocs | `boost-lane`, `couloir-large`, `couloir-piliers`, `ramp`, `sticky-zone` | **non** |

C'est cette cohabitation qui impose le double mode du générateur. `dedupePoolById()` préfère la version avec `exits` en cas de conflit d'id.

**Gouvernance** : l'éditeur exporte un JSON, le dev l'intègre manuellement dans `generated/`. Les participant·es peuvent tester leur bloc en map live, pas le publier.

---

## 8. Communication Socket.io

### Client → serveur

| Événement | Payload |
|---|---|
| `lobby:join` | `{ vehicle, playerName }` |
| `lobby:leave` | `{}` |
| `lobby:ready` | `{ ready }` |
| `game:input` | `{ steering, braking, reversing }` |
| `game:rejoin` | `{ matchId, playerId }` |

### Serveur → client

| Événement | Payload |
|---|---|
| `lobby:update` | état du lobby |
| `lobby:start` | `{ matchId, map, players }` |
| `lobby:error` | `{ message }` |
| `game:state` | voir ci-dessous — **30 Hz** |
| `game:player-arrived` | `{ matchId, playerId, ordre }` |
| `game:victory` | `{ matchId, podium }` — ⚠ le podium ne doit pas être affiché aux joueurs |
| `game:rejoin:ok` / `game:rejoin:error` | reconnexion |

```js
// game:state
{
  matchId,
  players: {
    [playerId]: {
      playerName,
      position: { x, y, z },
      velocity: { x, z },
      angle, speed, drifting, driftAngle, elevation
    }
  },
  cohesion: { value, isFull }
}
```

⚠ `game:end` et `game:event` sont écoutés par `network/client.js` (`onGameEnd`, `onEvent`) mais **aucun serveur ne les émet**.

---

## 9. Répartition client / serveur

| Autoritaire serveur | Client uniquement |
|---|---|
| Position, vélocité, angle, drift | Rendu Three.js, caméra, roll visuel |
| Détection de terrain (`checkTerrain`) et rebonds | **Perte de voxels** (`applyImpactDamage`) |
| Élévation (rampes, plateaux) | Pouvoirs : meshes, effets, absorption bouclier |
| Génération de map | Particules, skid marks, trail |
| Jauge de cohésion | Mini-map, flèches hors-écran |
| Arrivée et victoire | Cubes déplaçables, poteaux cassables |

**Conséquence importante** : la perte de voxels est purement visuelle et locale. Deux joueurs ne voient pas le même état de dégâts. C'est assumé en V1, mais ce n'est pas ce que décrivait `prd-race.md` (qui prévoyait un raycast serveur).

### Calcul de cohésion (dans `game-loop.js`)

```js
maxDist = plus grande distance euclidienne entre deux joueurs
value   = max(0, 1 - maxDist / cohesion.radiusUnits)
isFull  = value >= cohesion.fullThreshold
```

Distance **à vol d'oiseau** : deux joueurs séparés par un mur comptent comme proches. Correction prévue en phase 4 (module coopératif).

---

## 10. Configuration externalisée

Aucune valeur de gameplay ne doit être codée en dur — règle du projet.

| Fichier | Contenu |
|---|---|
| `gameplay.json` | `vehicleStats` · `powers` (6) · `physics` (masse, moteur, grip, drift, gravité, bosses, boost, sticky, cubes, poteaux, marche arrière, distance de rendu) · `surfaceGrip` · `cohesion` · `map` · `solo` · `match` |
| `scan.json` | `hslTargets` (6 couleurs) · `tolerance` · `minSaturation` · `centerSampleRatio` |
| `layout.json` | `PLATEAU_HEIGHT` · `vehicleSheet` (v1) · `vehicleSheetV2` (4 tranches) · `blockSheet` |

Les coordonnées de `vehicleSheetV2` sont dérivées du SVG mais **pas encore calibrées sur une impression réelle** — le fichier le signale lui-même.

Le client lit les configs via `/config/*.json` (servi en statique) ; le serveur les lit sur disque et les injecte dans les modules partagés via `setConfig()`.

---

## 11. Dette technique identifiée

| # | Élément | Action suggérée |
|---|---|---|
| 1 | `server/cohesion.js`, `game/cohesion.js`, `game/impact.js` — stubs d'une ligne | Supprimer, ou implémenter |
| 2 | `scan/symbol-reader.js` — scan de blocs abandonné | Supprimer |
| 3 | `admin-routes.js` — route HTTP non voulue | Retirer ou assumer explicitement |
| 4 | `game:end` / `game:event` — écoutés, jamais émis | Implémenter l'écran de fin, ou retirer les écouteurs |
| 5 | `DAMAGE_THRESHOLD = 8.0` codé en dur dans `game-page.js` (config : `4`) | Lire depuis `gameplay.json` |
| 6 | 5 blocs `_seed` sans `exits` + 2 conventions de nommage | Migrer vers `block_seed_*` avec `exits`, retirer le mode legacy |
| 7 | `.claude/worktrees/elegant-shtern-ef8496` — 12 Mo dupliqués | Supprimer le worktree (`git worktree remove`) |
| 8 | 1 seul commit dans l'historique, ~60 fichiers non versionnés | **Commiter avant tout gros chantier** |
| 9 | `vehicleSheetV2` non calibré sur impression réelle | Calibrer au premier tirage papier |

---

*Architecture v1.0 — document de référence, aligné sur `prd.md` v1.0.*
