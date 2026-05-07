# PRD v1.1 + Stories — Corrections post-V1

**Projet** : Pop Vroum
**Version** : 1.1 (corrections après premiers tests)
**Date** : 6 mai 2026
**Méthodologie** : BMAD-METHOD
**Document amont** : `prd.md` (v0.2), `stories.md` (v0.1), `phase-6-revisee.md`

---

## Contexte

Retours après les premiers tests de la V1. Ce document liste les corrections et améliorations identifiées, organisées en PRD rapide puis en stories atomiques. Tout ce qui est listé ici passe **avant** la Phase 8 (V1.x différée).

---

## PRD v1.1 — Corrections et améliorations

### Groupe A — Bugs bloquants (P0)

| ID | Problème | Correction |
|----|----------|------------|
| V1-A1 | Véhicule monté à l'envers (axe Y flippé) dans le voxel builder | Inverser l'axe Y lors de la reconstruction union 2-sur-3 |
| V1-A2 | Blocs map pas physiques : pas de collision, pas d'effets | Implémenter collisions + effets par type de symbole |
| V1-A3 | Rampes 3D inversées par rapport à la flèche UI de l'éditeur | Corriger l'orientation du mesh `ramp.glb` ou sa rotation d'instanciation |

### Groupe B — Manques fonctionnels (P0)

| ID | Problème | Correction |
|----|----------|------------|
| V1-B1 | Index sans navigation vers toutes les pages | Revoir index.html avec accès à toutes les pages |
| V1-B2 | Pas de bouton pour quitter la partie | Ajouter bouton quitter dans game.html et test-jeu-v2-solo.html |
| V1-B3 | Scan mode auto sans feedback visuel | Ajouter indicateur visuel au moment de la capture automatique |

### Groupe C — Système de maps (P0)

| ID | Problème | Correction |
|----|----------|------------|
| V1-C1 | Map trop petite (4 blocs entre départ et arrivée) | Refondre le système : quadrillage 8×8 blocmaps, blocs 2× plus grands |
| V1-C2 | Sens de déplacement inversé (droite→gauche au lieu de gauche→droite) | Ajuster la caméra ou le spawn pour un déplacement gauche→droite |
| V1-C3 | Pas de bloc de départ ni d'arrivée dédiés | Créer 2 blocmaps spéciaux : départ (spawn) et arrivée (goal) |

### Groupe D — Gameplay (P1)

| ID | Problème | Correction |
|----|----------|------------|
| V1-D1 | Pouvoir vert incomplet | Phares stabilisants (alliés dans le cône) + flèche clignotante vers l'arrivée, les deux scalent avec la quantité de vert |
| V1-D2 | Impossible de tester les mécaniques multijoueur seul | Faux joueurs (bots stupides attirés par le joueur humain) dans test-jeu-v2-solo.html |
| V1-D3 | Pas de véhicule de test dans game.html | Bouton "Véhicule aléatoire" pour dev |

---

## Stories v1.1

---

### Story V1-A1 — Fix véhicule à l'envers (axe Y)

**Modèle** : Sonnet 4.6
**Dépendances** : `voxel/builder.js` existant
**Contexte** : Le véhicule apparaît flippé verticalement — le dessus du dessin devient le dessous du modèle 3D. Bug de convention Y dans la reconstruction union 2-sur-3.

**Diagnostic probable** :
Dans `voxel/builder.js`, lors du mapping vue de face → coordonnées voxel, la rangée 0 du dessin (haut de la grille sur papier) est mappée à `y=0` (bas du volume 3D) au lieu de `y=3` (haut). Ou inversement selon la convention choisie.

**Correction** :
- Localiser le mapping `(row, col) → (x, y, z)` pour chaque vue dans `builder.js`
- Pour la vue de face : `y = (rows - 1) - row` au lieu de `y = row` (ou l'inverse selon ce qui est en place)
- Vérifier que la vue de profil et la vue de dessus sont cohérentes avec cette convention
- Tester avec un véhicule simple (rangée du bas coloriée → doit apparaître en bas du modèle 3D)

**Fichiers** :
- `/public/js/modules/voxel/builder.js`

**Critères d'acceptation** :
- [ ] La rangée du bas du dessin correspond au bas du véhicule 3D
- [ ] La rangée du haut du dessin correspond au haut du véhicule 3D
- [ ] Les roues restent bien positionnées après le fix (vérifier `wheel-detector.js`)
- [ ] Tester avec les 3 vues : face, profil, dessus

**Notes pour l'IA** : vérifier aussi `wheel-detector.js` qui dépend de la même convention. Si le fix de Y dans builder change la position des voxels, les roues calculées depuis la rangée du bas pourraient aussi se déplacer.

---

### Story V1-A2 — Implémentation des collisions et effets de blocs

**Modèle** : Opus 4.6
**Dépendances** : `game/physics.js`, `block/builder.js`, `game/impact.js`
**Contexte** : Les blocs map sont affichés en 3D mais n'ont aucun effet physique. Les véhicules les traversent sans collision ni effet.

**Spécifications par type de symbole** :

| Symbole | Collision | Effet |
|---------|-----------|-------|
| `hard` | Oui — arrêt + perte de voxels proportionnelle à la vitesse | Aucun effet au sol |
| `ramp` | Non (le véhicule passe dessus) | Boost de vitesse temporaire en sortie de rampe (+30% pendant 1 sec) |
| `sticky` | Non (le véhicule passe dessus) | Réduction de vitesse (-50%) et adhérence forcée tant que le véhicule est dessus |
| `boost` | Non | Boost d'accélération fort (+50% pendant 1.5 sec) |

**Implémentation** :
- Chaque blocmap instancié dans la scène a un **bounding box** calculé à partir de sa grille 8×8
- À chaque frame, pour chaque véhicule, tester l'intersection de sa position avec les bounding boxes actives
- Si collision `hard` : appeler `impact.js` avec le vecteur de collision pour la perte de voxels
- Si sur `ramp`, `sticky` ou `boost` : passer un modificateur de vitesse à `physics.js`

**Architecture recommandée** :
```javascript
// game/collision.js (nouveau module)
export function checkCollisions(vehicles, mapBlocks) {
  // pour chaque véhicule, pour chaque bloc dans un rayon proche
  // retourner { vehicleId, blockType, collisionNormal }[]
}
```

**Fichiers** :
- Nouveau `/public/js/modules/game/collision.js`
- Modifications de `/public/js/modules/game/physics.js` (accepter modificateurs)
- Modifications de `/public/js/modules/game/map-loader.js` (exposer bounding boxes)

**Critères d'acceptation** :
- [ ] Véhicule bloqué par un bloc `hard` avec perte de voxels proportionnelle à la vitesse
- [ ] Véhicule accéléré en sortie de rampe
- [ ] Véhicule ralenti sur `sticky`
- [ ] Véhicule boosté sur `boost`
- [ ] Performance : pas de drop de framerate à 5 véhicules + map complète

---

### Story V1-A3 — Fix orientation des rampes 3D

**Modèle** : Haiku 4.5
**Dépendances** : `block/builder.js`, `block-editor.html`
**Contexte** : Les rampes affichées en 3D sont orientées en miroir par rapport à la flèche de direction indiquée dans l'UI de l'éditeur.

**Correction** :
- Dans `block/builder.js`, lors de l'instanciation d'un mesh `ramp`, ajouter une rotation de `Math.PI` sur l'axe Y (ou Z selon l'orientation actuelle)
- Alternativement, corriger directement le fichier `ramp.glb` si la rotation est ancrée dans le mesh

**Vérification** :
- Ouvrir l'éditeur, placer une rampe avec la flèche pointant à droite
- L'aperçu 3D doit montrer la rampe montant de gauche à droite (pas l'inverse)

**Fichiers** :
- `/public/js/modules/block/builder.js`
- Éventuellement `/public/assets/models/ramp.glb`

**Critères d'acceptation** :
- [ ] La rampe 3D monte dans la direction indiquée par la flèche UI
- [ ] Les 4 orientations possibles de la rampe (N/S/E/O) sont toutes correctes si tu en as plusieurs

---

### Story V1-B1 — Refonte de l'index

**Modèle** : Sonnet 4.6
**Dépendances** : toutes les pages existantes
**Contexte** : L'index actuel ne donne pas accès à toutes les pages du dispositif. En développement et en atelier, l'animateur·trice doit pouvoir atteindre n'importe quelle page.

**Spécifications** :

L'index est organisé en **deux sections** :

**Section 1 — Flux atelier (ordre chronologique)** :
1. Scanner sa voiture → `/scan.html`
2. Rejoindre le lobby → `/lobby.html`
3. Créer un bloc map → `/block-editor.html`
4. Galerie des véhicules → `/gallery.html`

**Section 2 — Dev & test (visible mais distincte visuellement)** :
1. Test solo → `/test-jeu-v2-solo.html`
2. Spectateur → `/spectator.html`
3. Vue debug scan → (si page dédiée)

**Design** :
- Section 1 : grandes cartes visuelles avec nom + courte description
- Section 2 : liste compacte, fond légèrement différent, label "Dev / Test"
- Cohérence avec le design system existant (`shared.css`)

**Fichiers** :
- `/public/index.html`
- `/public/css/shared.css` (si ajout de styles)

**Critères d'acceptation** :
- [ ] Toutes les pages du projet accessibles depuis l'index
- [ ] Distinction visuelle claire entre flux atelier et outils dev
- [ ] Mobile-first : lisible sur tablette

---

### Story V1-B2 — Bouton quitter la partie

**Modèle** : Haiku 4.5
**Dépendances** : `game.html`, `test-jeu-v2-solo.html`, `network/client.js`
**Contexte** : Une fois en partie, il n'y a aucun moyen de revenir à l'index ou au lobby sans fermer le navigateur.

**Spécifications** :
- Bouton discret (icône ×, coin haut-gauche ou haut-droite) présent en permanence pendant la partie
- Clic → modale de confirmation "Quitter la partie ? (la partie continue pour les autres)"
- Confirmation → déconnexion propre Socket.io + redirect vers `index.html`
- Pour les bots (`test-jeu-v2-solo.html`) : quitter supprime simplement la session locale, pas besoin de Socket.io

**Fichiers** :
- `/public/game.html`
- `/public/test-jeu-v2-solo.html`
- `/public/js/pages/game-page.js`
- `/public/js/modules/network/client.js` (événement `game:disconnect`)

**Critères d'acceptation** :
- [ ] Bouton visible en permanence pendant la partie
- [ ] Modale de confirmation avant de quitter
- [ ] Déconnexion propre (les autres joueurs ne crashent pas)
- [ ] Retour vers index.html

---

### Story V1-B3 — Feedback visuel scan mode auto

**Modèle** : Sonnet 4.6
**Dépendances** : `scan/capture.js`, `scan.html`
**Contexte** : En mode auto, la photo est prise silencieusement sans que l'utilisateur sache quand exactement. Cela crée de l'incertitude.

**Spécifications** :
- Au moment exact de la capture automatique :
  - Flash blanc court (overlay plein écran, 150ms, opacity 0→1→0)
  - Son de déclenchement d'appareil photo (court, optionnel si son disponible)
  - Texte "Capture en cours..." pendant le traitement
- Pendant la phase d'attente (caméra active, pas encore de capture) :
  - Indicateur de statut : "Cherche la feuille..." → "Feuille détectée, stabilisation..." → "Capture !"
  - Le passage "Feuille détectée" se déclenche quand les 4 QR sont détectés et stables pendant X frames

**Fichiers** :
- `/public/js/modules/scan/capture.js` (exposer un événement `onCapture`)
- `/public/js/pages/scan-page.js`
- `/public/scan.html`
- `/public/css/scan.css`

**Critères d'acceptation** :
- [ ] Flash visible au moment de la capture
- [ ] Statuts lisibles pendant tout le process
- [ ] L'utilisateur comprend sans instruction quand la capture a lieu

---

### Story V1-C1 — Refonte du système de maps

**Modèle** : Opus 4.6
**Dépendances** : `game/map-generator.js`, `block/builder.js`, pool JSON existant
**Contexte** : La map actuelle est trop petite (4 blocs) et les blocs sont trop petits par rapport aux véhicules. Refonte complète du système.

**Architecture cible** :

```
MAP = quadrillage de 8×8 BLOCMAPS
BLOCMAP = grille de 8×8 BLOCS (éditeur web existant)
BLOC = unité de base (symbole : ramp, sticky, hard, boost)
```

Donc une map complète = 64 × 64 blocs de base.

**Taille des blocs** :
Les blocmaps doivent être **2× plus grands en unités Three.js**. Si un bloc faisait `1 unit` de côté, il fait maintenant `2 units`. Cela ne change pas les données JSON, juste la constante d'échelle lors du rendu.

**Disposition de la map** :

```
[BLOCMAP DÉPART] [8×8 BLOCMAPS tirés aléatoirement du pool] [BLOCMAP ARRIVÉE]
     ↑                                                              ↑
  col 0, row 0-7                                           col 7, row 0-7
  (bord gauche)                                             (bord droit)
```

- Bord **gauche** (colonne 0) : blocmap de départ (tous identiques, spawn des véhicules)
- Bord **droit** (colonne 7) : blocmap d'arrivée (zone goal)
- Colonnes 1-6 : 6×8 = 48 blocmaps tirés aléatoirement du pool

**Algorithme de génération** :
```javascript
function generateMap(blockPool, playerCount) {
  const grid = Array(8).fill(null).map(() => Array(8).fill(null));
  
  // Colonne 0 : départ
  for (let row = 0; row < 8; row++) {
    grid[row][0] = BLOCMAP_DEPART;
  }
  
  // Colonne 7 : arrivée
  for (let row = 0; row < 8; row++) {
    grid[row][7] = BLOCMAP_ARRIVEE;
  }
  
  // Colonnes 1-6 : aléatoire depuis le pool
  for (let col = 1; col < 7; col++) {
    for (let row = 0; row < 8; row++) {
      grid[row][col] = blockPool[Math.floor(Math.random() * blockPool.length)];
    }
  }
  
  return grid;
}
```

**Optimisation mémoire** :
- Ne pas instancier les meshes de toute la map au démarrage
- **Chargement par colonnes** : instancier seulement les 2-3 colonnes de blocmaps autour de la position actuelle des véhicules, libérer les colonnes loin derrière
- Seuil de chargement : colonne actuelle ± 2

**Fichiers** :
- `/public/js/modules/game/map-generator.js` (refonte)
- `/public/js/modules/game/map-loader.js` (chargement dynamique par colonnes)
- `/data/map-blocks/_seed/blocmap-depart.json` (nouveau)
- `/data/map-blocks/_seed/blocmap-arrivee.json` (nouveau)
- `/config/gameplay.json` : ajouter `blockScale: 2` et `mapGridSize: 8`

**Critères d'acceptation** :
- [ ] Map de 8×8 blocmaps générée aléatoirement
- [ ] Blocs 2× plus grands que les véhicules
- [ ] Bord gauche = départ, bord droit = arrivée
- [ ] Chargement dynamique : pas de freeze au démarrage sur une map 64×64
- [ ] Mémoire stable (pas de fuite sur les meshes déchargés)

---

### Story V1-C2 — Sens gauche→droite + spawn

**Modèle** : Sonnet 4.6
**Dépendances** : V1-C1, `game/camera.js`, `game/map-generator.js`
**Contexte** : Actuellement les véhicules spawent et vont de droite à gauche. On veut gauche→droite, naturel pour une lecture occidentale.

**Corrections** :
- Spawn des véhicules : positionner dans le blocmap de départ (bord gauche, col 0)
- Spawn initial orienté vers la droite (rotation 0° ou 90° selon l'axe choisi)
- Caméra orthographique : s'assurer que X positif est à droite à l'écran
- Zone d'arrivée : bord droit (col 7)

**Fichiers** :
- `/public/js/modules/game/map-generator.js`
- `/public/js/modules/game/camera.js`
- `/server/game-loop.js` (position de spawn)

**Critères d'acceptation** :
- [ ] Les véhicules spawnent à gauche et l'arrivée est à droite
- [ ] L'auto-avance part naturellement vers la droite
- [ ] La caméra suit le groupe de gauche à droite

---

### Story V1-C3 — Blocmaps de départ et d'arrivée dédiés

**Modèle** : Sonnet 4.6
**Dépendances** : V1-C1, éditeur de blocs
**Contexte** : Créer deux blocmaps spéciaux : un pour le spawn des véhicules, un pour la zone d'arrivée.

**Blocmap départ** :
- Grande zone ouverte (majoritairement vide ou boost) pour que les véhicules puissent spawner sans se bloquer
- Côté droit du blocmap = ouverture vers la map principale (pas de `hard` sur ce bord)
- Créé via l'éditeur de blocs, sauvegardé dans `/data/map-blocks/_seed/blocmap-depart.json`

**Blocmap arrivée** :
- Grande zone ouverte avec marqueur visuel de la ligne d'arrivée
- Côté gauche du blocmap = ouverture depuis la map (pas de `hard` sur ce bord)
- Zone de détection pour déclencher la victoire quand un véhicule y entre
- Créé via l'éditeur, sauvegardé dans `/data/map-blocks/_seed/blocmap-arrivee.json`

**Fichiers** :
- `/data/map-blocks/_seed/blocmap-depart.json`
- `/data/map-blocks/_seed/blocmap-arrivee.json`
- `/server/match-end.js` (détection entrée dans la zone d'arrivée)

**Critères d'acceptation** :
- [ ] Les véhicules spawent dans la zone de départ sans se chevaucher
- [ ] La zone d'arrivée est visuellement identifiable
- [ ] La victoire se déclenche quand tous les véhicules sont dans la zone d'arrivée

---

### Story V1-D1 — Pouvoir vert : phares stabilisants + flèche vers l'arrivée

**Modèle** : Sonnet 4.6
**Dépendances** : `game/powers.js`, V1-C1
**Contexte** : Le vert cumule deux effets distincts. L'effet sur les alliés (phares, déjà en place ou à implémenter) et un nouvel effet de navigation (flèche vers l'arrivée). Plus il y a de vert, plus les deux effets sont puissants.

**Effet 1 — Phares stabilisants (groupe)** :
- Cône lumineux projeté vers l'avant du véhicule vert
- Les véhicules alliés à l'intérieur du cône gagnent en adhérence (`grip × 1.3`)
- Taille et angle du cône proportionnels à la quantité de vert (`gameplay.json`)
- Cet effet existait déjà en spec PRD v0.2 (E10), s'assurer qu'il est bien implémenté dans `powers.js`

**Effet 2 — Flèche de navigation vers l'arrivée (individuel)** :
- Flèche 3D (couleur verte) flottant au-dessus du véhicule, pointant vers la zone d'arrivée
- **Présente sur tous les véhicules**, même sans voxel vert (guide minimal universel)
- **Clignotement** : fréquence proportionnelle à la quantité de vert du véhicule
  - 0 voxel vert → 1 clignotement toutes les 5 secondes
  - Véhicule entièrement vert → 1 clignotement par seconde
  - Formule : `interval = 5000 - (greenVoxelCount / maxGreenVoxels) * 4000` ms
- Rotation mise à jour à chaque frame pour pointer vers l'arrivée
- Visible depuis la vue ortho top-down (flèche plate, pointant horizontalement)

**Relation entre les deux effets** :
- Les deux effets scalent avec le même compteur `greenVoxelCount`
- Un véhicule avec beaucoup de vert = phares très larges ET flèche qui clignote vite
- Un véhicule sans vert = pas de phares MAIS flèche présente (guide universel garanti)

**Fichiers** :
- `/public/js/modules/game/powers.js` (ajouter effet 2, compléter effet 1 si manquant)
- Mesh flèche : `THREE.ConeGeometry` + `THREE.ArrowHelper` ou custom
- `/config/gameplay.json` : ajouter `greenPhareAngle`, `greenPhareRange`, `greenArrowBlinkBase`, `greenArrowBlinkMin`

**Critères d'acceptation** :
- [ ] Les phares sont visibles et donnent de l'adhérence aux alliés dans le cône
- [ ] La flèche est visible au-dessus de chaque véhicule (y compris sans vert)
- [ ] La flèche pointe vers l'arrivée en temps réel
- [ ] Le clignotement est plus rapide avec plus de vert
- [ ] Sans vert : flèche présente mais lente, pas de phares
- [ ] Avec beaucoup de vert : phares larges ET flèche rapide

**Notes pour l'IA** : les deux effets partagent le même `greenVoxelCount` mais opèrent indépendamment. L'effet 1 agit sur les alliés (détection de proximité dans le cône), l'effet 2 est purement visuel sur le véhicule porteur. Pour la flèche en top-down : utiliser `lookAt` sur le plan XZ uniquement (pas de composante Y dans la direction).

---

### Story V1-D2 — Bots stupides pour test solo

**Modèle** : Sonnet 4.6
**Dépendances** : `test-jeu-v2-solo.html` existant, V1-C1, V1-C2
**Contexte** : Pour tester les mécaniques multijoueur seul, des faux joueurs (bots) complètent le groupe. Ils sont "stupides" mais fonctionnels.

**Comportement des bots** :
- Chaque bot a un **véhicule de test prédéfini** (4 véhicules distincts avec des couleurs variées, définis en JSON dans `/data/test-vehicles/`)
- **Logique** en deux modes :
  - Si la distance au joueur humain > `cohesionRadius × 0.5` : le bot se dirige vers le joueur humain (cohésion d'abord)
  - Sinon : le bot avance vers l'arrivée en ligne droite (pas de pathfinding réel)
- Si un bot est détruit (0 voxels) : il est simplement retiré de la scène, la partie continue
- Les bots respectent les mêmes mécaniques de collision (perte de voxels, effets de blocs)
- Nombre de bots configurable au démarrage de `test-jeu-v2-solo.html` : slider de 0 à 4 bots

**Interface dans test-jeu-v2-solo.html** :
- Ajout d'un écran de démarrage avec :
  - Slider "Nombre de bots" (0-4)
  - Sélecteur de véhicule de test (liste des véhicules prédéfinis)
  - Bouton "Lancer"
- Les bots sont tous locaux (pas de Socket.io pour les bots)

**Fichiers** :
- `/public/test-jeu-v2-solo.html`
- `/public/js/pages/test-solo-page.js`
- Nouveau `/public/js/modules/game/bot.js`
- `/data/test-vehicles/bot-1.json`, `bot-2.json`, `bot-3.json`, `bot-4.json`

**Critères d'acceptation** :
- [ ] 1 à 4 bots présents en partie test
- [ ] Les bots s'approchent du joueur si trop loin
- [ ] Les bots avancent vers l'arrivée sinon
- [ ] Jauge de cohésion réactive aux positions des bots
- [ ] Un bot détruit n'arrête pas la partie

---

### Story V1-D3 — Véhicule aléatoire pour dev

**Modèle** : Haiku 4.5
**Dépendances** : `voxel/builder.js`, `voxel/stats.js`, `test-jeu-v2-solo.html`
**Contexte** : Bouton pour générer un véhicule de test aléatoire sans avoir à scanner une feuille.

**Spécifications** :
- Fonction `generateRandomVehicle(playerName)` dans un utilitaire
- Génère une grille 4×4×8 avec des voxels colorés aléatoirement (densité ~60% pour avoir une forme intéressante)
- Les 6 couleurs sont distribuées selon des probabilités configurables (pour avoir des véhicules viables : pas 100% hard, assez équilibré)
- Calcule les stats et pouvoirs via `voxel/stats.js` existant
- Calcule les positions de roues via `wheel-detector.js` existant
- Retourne un JSON véhicule complet et valide
- Disponible depuis `test-jeu-v2-solo.html` (bouton "Véhicule aléatoire" sur l'écran de démarrage)

**Fichiers** :
- Nouveau `/public/js/modules/voxel/random-vehicle.js`
- Modification de `/public/test-jeu-v2-solo.html`

**Critères d'acceptation** :
- [ ] Génère un JSON véhicule valide
- [ ] Le véhicule s'affiche en 3D sans erreur
- [ ] Les stats sont calculées correctement
- [ ] Chaque appel donne un véhicule différent

---

## Ordre de traitement recommandé

```
V1-A1  (fix Y)              ← en premier, débloque les tests visuels
V1-A3  (fix rampe)          ← rapide, 15 min
V1-B2  (bouton quitter)     ← rapide, 15 min
V1-B1  (index)              ← navigation de base
V1-B3  (scan feedback)      ← améliore l'expérience scan
V1-C1  (refonte maps)       ← gros morceau, débloque C2, C3, D1, D2
V1-C2  (sens G→D)           ← dépend de C1
V1-C3  (blocs départ/arrivée) ← dépend de C1
V1-A2  (collisions blocs)   ← dépend de C1 pour les tests
V1-D1  (flèche verte)       ← dépend de C1 pour la position d'arrivée
V1-D2  (bots)               ← dépend de C1, C2, C3 pour avoir une map jouable
V1-D3  (véhicule aléatoire) ← peut se faire n'importe quand
```

---

## Récapitulatif modèles

| Story | Modèle | Coût estimé |
|-------|--------|------------|
| V1-A1 Fix axe Y | Sonnet 4.6 | ~$1 |
| V1-A2 Collisions blocs | **Opus 4.6** | ~$2 |
| V1-A3 Fix rampes | Haiku 4.5 | ~$0.40 |
| V1-B1 Index | Sonnet 4.6 | ~$1 |
| V1-B2 Bouton quitter | Haiku 4.5 | ~$0.40 |
| V1-B3 Scan feedback | Sonnet 4.6 | ~$1 |
| V1-C1 Refonte maps | **Opus 4.6** | ~$2 |
| V1-C2 Sens G→D | Sonnet 4.6 | ~$1 |
| V1-C3 Blocs départ/arrivée | Sonnet 4.6 | ~$1 |
| V1-D1 Phares + flèche verte | Sonnet 4.6 | ~$1 |
| V1-D2 Bots stupides | Sonnet 4.6 | ~$1 |
| V1-D3 Véhicule aléatoire | Haiku 4.5 | ~$0.40 |
| **Total estimé** | | **~$12** |

---

*Document PRD v1.1 + Stories — version de travail.*
