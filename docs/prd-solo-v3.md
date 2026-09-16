# PRD — Pop Vroum · MAJ Solo v3 & Outils Dev

**Projet** : Pop Vroum  
**Porteur** : 1k3vrtical / Collectif Mille Trois Cents  
**Version** : 1.0 — Mai 2026  
**Document amont** : `docs/prd.md` v0.2, `Mise au Point MAJ Solo v3` (11/05/2026)  
**Cible matérielle** : Redmi Note 10 (Snapdragon 678, 4 GB RAM, 60 Hz) — 30 FPS minimum stable

---

## 1. Contexte

Ce PRD couvre deux volets complémentaires :

- **Outils dev** : une page de test/équilibrage isolée (`test-solo-v3.html`) pour calibrer véhicules et physique sans passer par le lobby multijoueur.
- **Corrections & évolutions** : bugs visuels/gameplay, nouveaux éléments de map, refonte départ/arrivée, mini-map debug, optimisation rendu.

**Workflow** : implémenter sur `test-solo-v3.html` d'abord, puis porter dans `game.html`. Le chantier "Drift & Game Feel" (physique PAKO avancée) est **hors scope** de cette MAJ.

---

## 2. Périmètre

### IN (cette MAJ)

| ID | Feature |
|---|---|
| SOLO-01 | Page test/équilibrage `test-solo-v3.html` |
| SOLO-02 | Bug fix : roll visuel en drift (mauvais axe) |
| SOLO-03 | Bug fix : recul arrière (seuil de vitesse) |
| SOLO-04 | Nouveaux éléments map : rampe, bosse, cube déplaçable, poteau |
| SOLO-05 | Structure labyrinthe : 1 départ + 1 arrivée sur bord extérieur |
| SOLO-06 | Mini-map debug (in-game + agrandissable) |
| SOLO-07 | Optimisation rendu : distance culling (étendre l'existant) |
| SOLO-08 | Portage test-solo-v3.html → game.html |

### OUT (hors scope)

- Retouche post-scan
- Flèches 3D de localisation des joueurs
- Système de drift avancé (chantier séparé — voir `docs/conception_drift_gamefeel.md`)
- Fog / occlusion
- Physique multijoueur pour les cubes déplaçables (client uniquement en V1)
- InstancedMesh / LOD (V1.x si culling insuffisant)

---

## 3. Décisions structurantes

| Sujet | Décision |
|---|---|
| Arrivée du labyrinthe | Bord extérieur — coin opposé au départ |
| Mini-map | Canvas 2D natif (plus léger pour Redmi) |
| Cube déplaçable | Client uniquement — décor visuel, pas de sync serveur |
| Courbes page test | Canvas 2D natif (pas de Chart.js — pas de nouvelle dépendance) |
| Frustum / distance culling | Déjà en place — étendre `RENDER_DISTANCE`, pas réécrire |
| Voxels destructibles | Visuel client uniquement en V1 — pas de sync serveur |
| InstancedMesh | Hors scope V1 — réévaluer après mesures perf sur cible |

---

## 4. Critères d'acceptation transversaux

**CA-01** — La page test s'ouvre sans `node server.js` (standalone).  
**CA-02** — 30 FPS stables sur Redmi Note 10 avec map 8×8.  
**CA-03** — Le labyrinthe généré a toujours un chemin départ → arrivée (BFS vérifié à la génération).  
**CA-04** — Le roll visuel s'incline dans la direction du dérapage (gauche → penche gauche).  
**CA-05** — La marche arrière s'active à `speed < 0.1` sans attendre l'arrêt complet.  

---

## 5. Ordre d'implémentation

```
Phase 1 — Fondations
  SOLO-01  Page test/équilibrage     ← débloque l'équilibrage continu

Phase 2 — Corrections
  SOLO-02  Bug roll visuel
  SOLO-03  Bug recul arrière

Phase 3 — Map & Builder
  SOLO-04  Nouveaux éléments map
  SOLO-05  Labyrinthe 1 départ / 1 arrivée

Phase 4 — Debug & Perf
  SOLO-06  Mini-map debug
  SOLO-07  Distance culling

Phase 5 — Portage
  SOLO-08  test-solo-v3.html → game.html
```

---

---

# Stories — MAJ Solo v3

> **Convention** : JSON in / JSON out, modules testables sans UI.  
> Commentaires en **français**, identifiants en **anglais**.  
> Lire les fichiers listés dans "Fichiers à lire" **avant** de toucher au code.  
> Toute valeur configurable va dans `/config/gameplay.json`.

---

## SOLO-01 — Page test/équilibrage

**Modèle** : Sonnet 4.6  
**Priorité** : P0 — débloque l'équilibrage à chaque étape du dev  
**Dépendances** : aucune (standalone)  
**Fichiers à lire** : `game-page.js`, `/config/gameplay.json`

### Objectif

Créer `test-solo-v3.html` : outil interne standalone pour tester et calibrer les véhicules et la physique. Pas de Socket.io, pas de lobby. La page utilise les mêmes modules de physique que le jeu principal.

### Interface

**Panneau gauche — curseurs**

| Curseur | Range | Défaut |
|---|---|---|
| Taille map X | 2–8 blocs | 4 |
| Taille map Y | 2–8 blocs | 4 |
| Blocs véhicule | 1–32 | 16 |
| Speed | 0.1–1.0 | 0.5 |
| Grip | 0.1–1.0 | 0.5 |
| Accel | 0.1–1.0 | 0.5 |
| Punitivité | 0.1–3.0 | 1.0 |
| Vitesse min casse | 0–20 m/s | 8.0 |

Champ `poids` : lecture seule, calculé automatiquement (`blocs × MASSE_PAR_BLOC`).

**Profils prédéfinis (boutons)**

```
Équilibré     speed=0.5 grip=0.5 accel=0.5
Drift machine speed=0.7 grip=0.2 accel=0.6
Tank          speed=0.3 grip=0.8 accel=0.3
Fusée         speed=1.0 grip=0.4 accel=1.0
Savonnette    speed=0.5 grip=0.1 accel=0.5
```

**Zone centrale — simulation**

- Piste générée automatiquement (4×4 blocs, seed fixe `42`).
- Contrôles clavier (flèches) ou mode boucle automatique (bouton toggle).
- Rendu Three.js dans un `<canvas>` dédié.

**Panneau droit — graphiques canvas 2D natif**

- Courbe vitesse longitudinale (m/s) — fenêtre glissante 5 secondes.
- Courbe `v_lateral` (dérapage) — fenêtre glissante 5 secondes.
- Jauge de vie : blocs restants / blocs initiaux.

**Résultats de session**

- Temps au tour (si circuit fermé).
- Vitesse moyenne / max.
- Voxels perdus.
- Distance de freinage (mesurée sur ligne droite test).

### Contrat I/O

```js
// test-solo-v3.html importe les mêmes modules que game.js
import { decompose, applyForces } from './public/js/modules/game/physics.js'
import { generateMap }            from './public/js/modules/game/map-generator.js'
import { handleImpact }           from './public/js/modules/game/impact.js'
// Pas de Socket.io — state géré localement
```

### Fichiers

- `test-solo-v3.html` — page standalone racine
- `/public/js/pages/test-solo.js` — entry script

### Critères d'acceptation

- [ ] La page s'ouvre avec `file://` ou `http://localhost` sans erreur console.
- [ ] Modifier un curseur met à jour la simulation en temps réel (< 100 ms).
- [ ] Les courbes canvas 2D se mettent à jour à chaque frame.
- [ ] Les profils prédéfinis chargent instantanément en un clic.
- [ ] Le mode boucle automatique tourne indéfiniment sans crash.
- [ ] Les résultats de session s'affichent après chaque tour.

---

## SOLO-02 — Bug fix : roll visuel en drift

**Modèle** : Haiku 4.5  
**Priorité** : P0  
**Dépendances** : aucune  
**Fichiers à lire** : `game-page.js` — fonction `_boucle()`, initialisation du mesh groupe véhicule

### Problème

Le roll (inclinaison latérale en drift) est appliqué sur le mauvais axe Three.js. Le véhicule s'incline en pitch (avant/arrière) au lieu de rouler latéralement (gauche/droite).

### Diagnostic

```js
// Actuel dans _boucle() — incorrect
entry.group.rotation.x = rollAngle   // ← pitch, mauvais axe

// Correction
entry.group.rotation.z = rollAngle   // ← roll latéral
```

> **Vérification de l'axe** : ajouter temporairement `console.log(entry.group.rotation)` pendant un drift. L'axe qui doit changer est Z dans la convention Three.js standard (roulis). Si le mesh voxel est orienté différemment, adapter.

### Correction

```js
// Dans _boucle(), section rendu véhicule
const rollTarget = state.drifting
  ? -Math.sign(state.v_lateral) * 0.25   // incline dans le sens du dérapage
  : 0

entry.group.rotation.z = THREE.MathUtils.lerp(
  entry.group.rotation.z,
  rollTarget,
  0.12   // retour progressif
)
```

### Fichiers

- `game-page.js` — uniquement la section rotation du groupe dans `_boucle()`

### Critères d'acceptation

- [ ] Dérapage gauche → véhicule penche à gauche.
- [ ] Dérapage droite → véhicule penche à droite.
- [ ] Retour à `rotation.z = 0` progressif quand `drifting = false`.
- [ ] La hitbox physique n'est pas modifiée (visuel uniquement).

---

## SOLO-03 — Bug fix : recul arrière

**Modèle** : Haiku 4.5  
**Priorité** : P0  
**Dépendances** : aucune  
**Fichiers à lire** : `server.js` (game loop, traitement inputs), `/config/gameplay.json`

### Problème

La marche arrière ne s'active qu'à `speed === 0.00`. Le joueur doit attendre l'arrêt complet, ce qui est frustrant.

### Correction

```js
// server.js — traitement de l'input throttle négatif
const REVERSE_THRESHOLD = config.gameplay.REVERSE_SPEED_THRESHOLD // 0.1

if (input.throttle < 0) {
  if (state.speed < REVERSE_THRESHOLD) {
    state.reverseMode = true
  }
  if (state.reverseMode) {
    applyReverseForce(state, input.throttle)
  }
}

// Annuler la marche arrière si ré-accélération vers l'avant
if (input.throttle > 0) {
  state.reverseMode = false
}
```

### Configuration (gameplay.json)

```json
"REVERSE_SPEED_THRESHOLD": 0.1
```

### Fichiers

- `server.js` — logique input marche arrière
- `/config/gameplay.json` — ajouter `REVERSE_SPEED_THRESHOLD`

### Critères d'acceptation

- [ ] La marche arrière s'active à `speed < 0.1` — pas besoin d'attendre `0.00`.
- [ ] En marche arrière, accélérer fait reculer le véhicule.
- [ ] Appuyer sur accélérer vers l'avant annule la marche arrière.
- [ ] `REVERSE_SPEED_THRESHOLD` est dans `gameplay.json`.

---

## SOLO-04 — Nouveaux éléments de map

**Modèle** : Sonnet 4.6  
**Priorité** : P1  
**Dépendances** : SOLO-03  
**Fichiers à lire** : `block-editor.html`, `game-page.js` (`_construireMeshMap`, `TYPES_CELLULE`), format JSON map actuel

### Objectif

Ajouter 4 nouveaux types de cellule dans le format JSON, le builder, et le rendu 3D.

### Nouveaux types

| Type | Clé JSON | Physique | Mesh Three.js |
|---|---|---|---|
| Rampe | `"ramp_n"` `"ramp_s"` `"ramp_e"` `"ramp_o"` | Impulsion Y (si physique hauteur dispo) sinon visuel only | Plan incliné 30° |
| Bosse | `"bump"` | Légère impulsion Y + ralentissement | Demi-sphère basse |
| Cube déplaçable | `"movable"` | Client only : impulsion à la collision | BoxGeometry 1×1×1 |
| Poteau | `"pole"` | Client only : disparaît si `deltaV > seuil` | CylinderGeometry fin |

### Extension `TYPES_CELLULE`

```js
const TYPES_CELLULE = {
  // Types existants conservés
  dur:     { color: 0x888888, height: 1.0, passable: false },
  sticky:  { color: 0x4a9e4a, height: 0.1, passable: true  },
  boost:   { color: 0xf5a623, height: 0.1, passable: true  },
  // Nouveaux
  ramp_n:  { color: 0xaaaaff, height: 0.5, passable: true,  ramp: 'N' },
  ramp_s:  { color: 0xaaaaff, height: 0.5, passable: true,  ramp: 'S' },
  ramp_e:  { color: 0xaaaaff, height: 0.5, passable: true,  ramp: 'E' },
  ramp_o:  { color: 0xaaaaff, height: 0.5, passable: true,  ramp: 'O' },
  bump:    { color: 0xcc8844, height: 0.3, passable: true,  bump: true },
  movable: { color: 0xff6644, height: 1.0, passable: false, movable: true },
  pole:    { color: 0xffffff, height: 2.5, passable: false, pole: true  },
}
```

### Builder (`block-editor.html`)

- Ajouter les 4 types dans la palette (icône + label).
- `ramp_*` : bouton de rotation N/S/E/O dans le panneau propriétés.
- Sauvegarde dans le JSON du bloc avec la clé étendue.

### Configuration (gameplay.json)

```json
"POLE_BREAK_THRESHOLD": 5.0,
"BUMP_IMPULSE": 2.0
```

### Fichiers

- `game-page.js` — étendre `TYPES_CELLULE` et `_construireMeshMap`
- `block-editor.html` — ajouter les types à la palette
- `/config/gameplay.json` — `POLE_BREAK_THRESHOLD`, `BUMP_IMPULSE`

### Critères d'acceptation

- [ ] Les 4 types s'affichent dans la palette du builder.
- [ ] Les 4 types sont sauvegardés dans le JSON du bloc.
- [ ] Les 4 types sont rendus en 3D dans `_construireMeshMap`.
- [ ] Un cube `movable` se déplace visuellement quand percuté (client only).
- [ ] Un poteau `pole` disparaît visuellement si `deltaV > POLE_BREAK_THRESHOLD` (client only).
- [ ] Une bosse `bump` génère une légère impulsion Y.

---

## SOLO-05 — Structure labyrinthe : 1 départ / 1 arrivée

**Modèle** : Sonnet 4.6  
**Priorité** : P0  
**Dépendances** : `map-generator.js` existant (ou RACE-03)  
**Fichiers à lire** : `server.js` (génération map), `game-page.js` (`_construireMeshMap`, `finishPosition`)

### Objectif

Remplacer le système actuel (tout le bord droit = départ, tout le bord gauche = arrivée) par un unique bloc départ et un unique bloc arrivée sur le bord extérieur de la map.

### Placement départ / arrivée

```
Départ  : bloc (0, 0)           — coin haut-gauche
Arrivée : bloc (W-1, H-1)       — coin bas-droite (bord extérieur opposé)
```

La génération garantit un chemin BFS entre les deux (max 10 tentatives avec seeds différents).

### Spawn des joueurs

Tous les joueurs spawnent dans le bloc départ, répartis sur les cellules `null` centrales.

```js
// server.js
function computeSpawnPositions(entryBlock, playerCount) {
  // Retourne playerCount positions {x, z} dans le bloc départ
  // Espacées de SPAWN_SPREAD
}
```

### Condition de victoire

```js
// server.js — game loop
const dist = distance(player.position, mapData.exit.worldCenter)
if (dist < WIN_RADIUS) {
  io.emit('player:win', { playerId, time: Date.now() - raceStart })
}
```

### Rendu (`_construireMeshMap`)

```js
// Remplacer les bandes verticales actuelles par :
// Bloc départ  → sol vert clair  + texte "DÉPART"
// Bloc arrivée → sol doré        + texte "ARRIVÉE"
// Autres blocs du bord → rendu normal
```

### Contrat I/O — MapData étendu

```js
{
  width: 4, height: 4,
  blocks: [...],
  entry: {
    blockCol: 0, blockRow: 0,
    worldCenter: { x, z },
    spawnPositions: [ {x, z}, ... ]   // 1 par joueur (max 5)
  },
  exit: {
    blockCol: 3, blockRow: 3,
    worldCenter: { x, z }
  }
}
```

### Configuration (gameplay.json)

```json
"WIN_RADIUS": 2.0,
"SPAWN_SPREAD": 1.5
```

### Fichiers

- `server.js` — `computeSpawnPositions`, condition de victoire, génération MapData
- `game-page.js` — rendu départ/arrivée dans `_construireMeshMap`
- `/config/gameplay.json` — `WIN_RADIUS`, `SPAWN_SPREAD`

### Critères d'acceptation

- [ ] Un seul bloc départ (vert) et un seul bloc arrivée (doré) visibles.
- [ ] Les joueurs spawnent dans le bloc départ — pas empilés au même point.
- [ ] Un chemin BFS départ → arrivée existe toujours.
- [ ] L'événement `player:win` est émis à l'arrivée avec le temps de course.
- [ ] `WIN_RADIUS` et `SPAWN_SPREAD` dans `gameplay.json`.

---

## SOLO-06 — Mini-map debug

**Modèle** : Haiku 4.5  
**Priorité** : P1  
**Dépendances** : SOLO-05  
**Fichiers à lire** : `game-page.js` (`_map`, boucle rendu), structure `MapData`

### Objectif

Canvas 2D superposé au jeu : mode compact (coin bas-droit) et mode agrandi (modale). Données depuis `_map` déjà disponible côté client.

### Mode compact

- Canvas `160×160 px`, coin bas-droit, opacité `0.85`.
- Chaque bloc = `160 / mapWidth` px.
- Palette : route = `#222`, mur = `#ddd`, départ = `#66ff99`, arrivée = `#ffd700`.
- Joueur local = point bleu `4px`. Autres joueurs = point `dominantColor` `3px`.
- Clic → bascule mode agrandi.

### Mode agrandi

- Modale : `min(window.innerWidth, window.innerHeight) × 0.9`.
- Overlay connectivité : cellules `null` en vert translucide `rgba(100,200,100,0.15)`.
- Marqueur départ : triangle `#66ff99`. Marqueur arrivée : étoile `#ffd700`.
- Pas de chemin optimal affiché.
- Clic hors modale ou `Echap` → retour compact.

### Contrat I/O

```js
// /public/js/modules/game/minimap.js
export function initMinimap(mapData, container) → MinimapInstance
export function updateMinimap(instance, playersState)  → void
// Appelé à chaque frame dans _boucle()
```

### Fichiers

- `/public/js/modules/game/minimap.js` — nouveau module
- `game-page.js` — `initMinimap` à l'init, `updateMinimap` dans `_boucle()`

### Critères d'acceptation

- [ ] Mini-map visible en jeu, coin bas-droit.
- [ ] Positions joueurs mises à jour à chaque frame.
- [ ] Clic → agrandi. Clic hors / `Echap` → compact.
- [ ] Départ et arrivée marqués dans les deux modes.
- [ ] Canvas 2D séparé du rendu Three.js — pas d'impact mesurable sur les FPS.

---

## SOLO-07 — Optimisation rendu : distance culling

**Modèle** : Haiku 4.5  
**Priorité** : P1  
**Dépendances** : aucune (système existant à étendre)  
**Fichiers à lire** : `game-page.js` (culling existant, `_boucle`)

### Objectif

Étendre le culling existant avec une distance de Chebyshev pour ne rendre que les blocs dans un rayon de `RENDER_DISTANCE` autour du joueur local. Cible : 30 FPS stables sur Redmi Note 10, map 8×8.

### Logique

```js
// Dans _boucle() — après mise à jour positions
const playerBlockPos = worldToBlock(localPlayer.position, BLOC_SIZE)

mapBlocks.forEach((blockMesh, blockCoords) => {
  // Distance de Chebyshev : max(|dx|, |dz|)
  // Plus rapide que euclidien, cohérent avec la grille
  const dx = Math.abs(playerBlockPos.col - blockCoords.col)
  const dz = Math.abs(playerBlockPos.row - blockCoords.row)
  blockMesh.visible = Math.max(dx, dz) <= RENDER_DISTANCE
})
```

`RENDER_DISTANCE = 3` → zone `7×7 = 49` blocs max sur 64. Ajustable selon mesures.

### Note sur InstancedMesh

Hors scope V1. Le distance culling seul devrait suffire pour 30 FPS. Réévaluer en V1.x si les mesures sur Redmi montrent que c'est insuffisant.

### Configuration (gameplay.json)

```json
"RENDER_DISTANCE": 3
```

### Fichiers

- `game-page.js` — étendre le culling existant
- `/config/gameplay.json` — `RENDER_DISTANCE`

### Critères d'acceptation

- [ ] Blocs à `distance > RENDER_DISTANCE` absents de la draw call.
- [ ] `renderer.info.render.triangles` réduit vs avant.
- [ ] Pop-in acceptable (brusque si problématique → lerp d'opacité à évaluer).
- [ ] 30 FPS stables sur map 8×8 (mesurer sur cible ou émulateur).
- [ ] `RENDER_DISTANCE` dans `gameplay.json`.

---

## SOLO-08 — Portage test-solo-v3.html → game.html

**Modèle** : Haiku 4.5  
**Priorité** : P2 — après validation de toutes les features sur test-solo  
**Dépendances** : SOLO-01 à SOLO-07 validés  
**Fichiers à lire** : `game.html`, `game-page.js`, `test-solo-v3.html`

### Objectif

Porter les features validées vers `game.html` / `game-page.js`. Vérifier l'absence de régression en mode multijoueur.

### Checklist de portage

- [ ] SOLO-02 (roll) — vérifier pour les véhicules distants aussi.
- [ ] SOLO-03 (recul) — côté serveur, devrait fonctionner sans changement.
- [ ] SOLO-04 (éléments map) — `_construireMeshMap` partagé, normalement déjà porté.
- [ ] SOLO-05 (départ/arrivée) — vérifier spawn multi-joueurs (5 positions).
- [ ] SOLO-06 (mini-map) — vérifier avec `playersState` multi-joueurs.
- [ ] SOLO-07 (culling) — par joueur local, pas de changement attendu.

### Critères d'acceptation

- [ ] Aucune régression lobby / sync Socket.io.
- [ ] Toutes les features actives dans `game.html` sans config supplémentaire.
- [ ] 30 FPS stables en mode 5 joueurs sur map 8×8.

---

## Tableau récapitulatif

| Story | Titre | Modèle | Priorité | Dépendances |
|---|---|---|---|---|
| SOLO-01 | Page test/équilibrage | Sonnet 4.6 | P0 | aucune |
| SOLO-02 | Bug roll visuel | Haiku 4.5 | P0 | aucune |
| SOLO-03 | Bug recul arrière | Haiku 4.5 | P0 | aucune |
| SOLO-04 | Nouveaux éléments map | Sonnet 4.6 | P1 | SOLO-03 |
| SOLO-05 | Labyrinthe départ / arrivée | Sonnet 4.6 | P0 | map-generator.js |
| SOLO-06 | Mini-map debug | Haiku 4.5 | P1 | SOLO-05 |
| SOLO-07 | Distance culling | Haiku 4.5 | P1 | aucune |
| SOLO-08 | Portage → game.html | Haiku 4.5 | P2 | SOLO-01→07 |

---

*Ce fichier est la référence de la MAJ Solo v3. Les valeurs configurables vivent dans `/config/gameplay.json`. Ne jamais hardcoder.*
