# Product Requirement Document — Pop Vroum
## Module RACE — Génération de map, gameplay & outils

**Projet** : Pop Vroum
**Porteur** : 1k3vrtical / Collectif Mille Trois Cents
**Version** : 0.1
**Date** : 11 mai 2026
**Méthodologie** : BMAD-METHOD — Phase 2 PRD
**Document amont** : `prd.md` v0.2, `conception_drift_gamefeel.md`

**Changelog v0.1** :
- Premier PRD dédié au module RACE (séparé du PRD principal)
- Couvre : blocs seed, génération procédurale, plateaux/rampes, perte de voxels, HUD, optimisation, scan retouche, page de test solo

---

## 1. Périmètre de ce document

Ce PRD est un **addendum** au PRD principal v0.2. Il ne redéfinit pas la vision produit ni les personas — il précise les fonctionnalités du module jeu de course identifiées lors de la session de conception du 11 mai 2026.

Les IDs de features suivent la convention `RACE-XX` pour ne pas entrer en conflit avec les modules A–G du PRD principal.

---

## 2. Objectifs du module

**Objectif R1 — Maps jouables immédiatement.** Toute session doit pouvoir démarrer sans que le développeur ait créé une map à la main. L'algorithme procédural + le pool de blocs seed garantissent une map valide à chaque lancement.

**Objectif R2 — Équilibrage continu.** Une page de test solo doit permettre de vérifier le game feel à chaque étape du développement, sans lobby ni participants.

**Objectif R3 — Relief et tactique.** Les plateaux hard et les rampes introduisent une dimension verticale légère (2 niveaux) qui enrichit les stratégies sans complexifier le pipeline de scan.

**Objectif R4 — Conséquences lisibles.** Les chocs ont un coût voxel visible et proportionnel. Les autres joueurs sont toujours localisables via le HUD même hors-écran.

**Objectif R5 — Robustesse atelier.** Sécurisation des inputs réseau (XSS, injection), optimisation du rendu pour des machines modestes, outil de retouche scan pour corriger les imperfections sans re-scanner.

---

## 3. Spécifications fonctionnelles

**Légende** : P0 critique · P1 important · P2 souhaitable

---

### Module RACE-A — Blocs map seed

| ID | Fonctionnalité | Description | Priorité |
|----|----------------|-------------|----------|
| RACE-A01 | Set de blocs seed de base | 6 blocs JSON minimum : ligne droite, virage G, virage D, chicane, carrefour en T, rond-point. Format identique aux blocs existants + métadonnée `exits`. | P0 |
| RACE-A02 | Métadonnée `exits` | Chaque bloc seed déclare ses sorties : `exits: ["N", "S"]`, `["E", "O"]`, etc. Utilisée par l'algo d'assemblage pour connecter les blocs. | P0 |
| RACE-A03 | Rotation globale de bloc | Fonction utilitaire qui prend une grille 8×8 et un angle (0°, 90°, 180°, 270°) et retourne la grille pivotée + les exits pivotées en conséquence. | P0 |
| RACE-A04 | Blocs plateau hard | Variantes des blocs seed avec cellules `dur` surélevées (hauteur y=1) et bordures de transition. Ajout d'un champ `elevation` par cellule dans le JSON. | P1 |
| RACE-A05 | Blocs rampe | 2 types : rampe douce (pente progressive sur 2 cellules) et bosse (saut court sur 1 cellule). S'alignent avec les bords des blocs plateau. | P1 |

**Format JSON de référence étendu :**

```json
{
  "id": "block_seed_virage_g",
  "name": "Virage G",
  "createdAt": "2026-05-11T00:00:00Z",
  "atelier": "_seed",
  "exits": ["S", "O"],
  "grid": [
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, "dur", "dur", "dur", "dur"],
    [null, null, null, null, "dur", null, null, null],
    [null, null, null, null, "dur", null, null, null],
    [null, null, null, null, "dur", null, null, null]
  ]
}
```

---

### Module RACE-B — Génération procédurale

| ID | Fonctionnalité | Description | Priorité |
|----|----------------|-------------|----------|
| RACE-B01 | Détection automatique des exits | Pour les blocs créés en atelier (sans métadonnée `exits`), algo de scan des bords de grille : une cellule non-null sur le bord N/S/E/O = exit probable. Fallback si `exits` absent. | P0 |
| RACE-B02 | Algo d'assemblage de blocs | Place les blocs du pool sur une grille de blocs NxM. Chaque bloc posé doit connecter au moins une de ses exits à un bloc adjacent. Utilise rotation (RACE-A03) pour maximiser la connexité. | P0 |
| RACE-B03 | Garantie de boucles | L'algo crée des chemins multiples avec au moins une boucle. Implémentation recommandée : algorithme de Prim modifié avec reconnexions aléatoires après génération de l'arbre couvrant. | P0 |
| RACE-B04 | Contraintes de jouabilité | La map générée doit avoir : un point de départ accessible, un point d'arrivée accessible, aucun cul-de-sac isolé. Vérification par BFS après génération. | P0 |
| RACE-B05 | Taille de map adaptative | Taille de la grille de blocs selon le nombre de joueurs : 1 joueur = 3×3 blocs, 2-3 joueurs = 4×4, 4-5 joueurs = 5×5. Configurable dans `gameplay.json`. | P1 |
| RACE-B06 | Seed reproductible | La map peut être générée depuis un seed numérique pour rejouer exactement la même map. Utile pour les tests et le débogage. | P1 |

---

### Module RACE-C — Plateaux et rampes (relief 2 niveaux)

| ID | Fonctionnalité | Description | Priorité |
|----|----------------|-------------|----------|
| RACE-C01 | Champ `elevation` dans le JSON de bloc | Chaque cellule de la grille peut avoir une élévation : `0` (sol normal) ou `1` (plateau hard). Rétrocompatible : absence du champ = élévation 0. | P0 |
| RACE-C02 | Rendu Three.js des plateaux | Les cellules `dur` à élévation 1 sont rendues avec une hauteur supplémentaire (ex: +0.5 unité). Bordure de transition visible sur les bords du plateau. | P0 |
| RACE-C03 | Physique des plateaux | Le véhicule ne peut pas monter sur un plateau sans rampe. Collision avec le bord du plateau = rebond (même règle que mur, RACE-D02). | P0 |
| RACE-C04 | Rampe douce (pente) | Cellule de type `rampe_pente` : le véhicule monte progressivement de y=0 à y=1 sur la longueur de la cellule. Vitesse conservée. | P1 |
| RACE-C05 | Rampe bosse (saut) | Cellule de type `rampe_bosse` : impulsion verticale courte. Légère suspension visuelle + particules à l'atterrissage. | P1 |
| RACE-C06 | Alignement rampe/plateau dans l'éditeur | `block-editor.html` étendu avec les nouveaux types de cellules (rampe_pente, rampe_bosse) et un aperçu du profil de hauteur sur le bord du bloc. | P1 |

---

### Module RACE-D — Perte de voxels et collisions

| ID | Fonctionnalité | Description | Priorité |
|----|----------------|-------------|----------|
| RACE-D01 | Seuil de dommage par delta vitesse | Les voxels ne tombent que si le delta vitesse au moment du choc dépasse `DAMAGE_THRESHOLD` (configurable dans `gameplay.json`, valeur initiale suggérée : 8 m/s). En dessous : rebond sans dommage. | P0 |
| RACE-D02 | Raycasting depuis le point d'impact | Au-delà du seuil : raycast depuis le point d'impact dans la grille voxel 4×4×8 dans la direction de la normale du mur. Les N premiers voxels exposés sont retirés (N = f(delta vitesse)). | P0 |
| RACE-D03 | Mise à jour stats après perte | Après retrait de voxels : recalcul des stats (speed, grip, accel) et des pouvoirs actifs. Un véhicule sans voxels d'une couleur perd le pouvoir associé. | P0 |
| RACE-D04 | VFX voxels tombants | Les voxels retirés tombent au sol avec gravité et y restent visibles quelques secondes avant fade-out. Couleur conservée. | P1 |
| RACE-D05 | Murs uniquement | La perte de voxels ne se déclenche que sur les collisions avec les murs/obstacles de la map. Les collisions véhicule-véhicule ne causent pas de dommages (V1). | P0 |

---

### Module RACE-E — HUD et lisibilité

| ID | Fonctionnalité | Description | Priorité |
|----|----------------|-------------|----------|
| RACE-E01 | Flèches hors-écran | Quand un joueur sort du frustum caméra, une flèche apparaît sur le bord de l'écran pointant vers sa position. Couleur = couleur dominante du véhicule. | P0 |
| RACE-E02 | Calcul de position flèche | Projection de la position monde du joueur absent sur le plan de l'écran, clampée au bord. Angle de la flèche = direction vers le joueur depuis le centre de l'écran. | P0 |
| RACE-E03 | Distance indicative | La flèche affiche une distance approximative (en unités de jeu ou en blocs) pour donner une idée de l'éloignement. | P1 |

---

### Module RACE-F — Optimisation et sécurité

| ID | Fonctionnalité | Description | Priorité |
|----|----------------|-------------|----------|
| RACE-F01 | Culling des blocs hors frustum | Les blocs map hors du rayon de vision de la caméra sont retirés de la scène Three.js (`scene.remove`). Remis en scène lors du retour dans le frustum. Vérification par `frustum.containsPoint()` sur le centre de chaque bloc. | P0 |
| RACE-F02 | Sanitisation des pseudos (XSS) | Les pseudos des joueurs sont nettoyés côté serveur avant diffusion via Socket.io : suppression des balises HTML, longueur max 20 caractères, whitelist `[a-zA-Z0-9_\- ]`. | P0 |
| RACE-F03 | Sanitisation des noms de blocs | Les champs texte des blocs créés en atelier (name, note) sont sanitisés avant écriture dans le JSON côté serveur. | P1 |
| RACE-F04 | Rate limiting Socket.io | Limiter la fréquence des événements entrants par client (inputs de jeu : max 60/s, autres événements : max 10/s) pour éviter les abus. | P1 |

---

### Module RACE-G — Retouche scan (outil éditeur véhicule)

| ID | Fonctionnalité | Description | Priorité |
|----|----------------|-------------|----------|
| RACE-G01 | Page retouche `scan-edit.html` | Page dédiée accessible après le scan. Affiche les 4 vues 2D du véhicule (dessous, milieu bas, milieu haut, dessus) sous forme de grilles éditables. | P0 |
| RACE-G02 | 4 vues horizontales du véhicule | Les 4 tranches horizontales de la grille voxel 4×4×8 affichées côte à côte : `y=0` (dessous), `y=1` (milieu bas), `y=2` (milieu haut), `y=3` (dessus). | P0 |
| RACE-G03 | Correction de couleur par clic | Clic sur une cellule = sélecteur des 6 couleurs du vocabulaire + option "vide". Mise à jour en temps réel du rendu 3D adjacent. | P0 |
| RACE-G04 | Ajout de voxels manquants | Les cellules vides (null) cliquables permettent d'ajouter un voxel avec la couleur choisie. | P0 |
| RACE-G05 | Aperçu 3D synchronisé | Le rendu Three.js du véhicule se met à jour en temps réel à chaque modification dans l'éditeur 2D. | P0 |
| RACE-G06 | Base technique | S'appuie sur `scan2.html` pour la structure de données et `block-editor.html` pour le pattern d'éditeur de grille. | P0 |
| RACE-G07 | Validation et retour au flow | Bouton "Valider" enregistre le véhicule retouché en localStorage et redirige vers l'écran de validation existant. | P0 |

---

### Module RACE-H — Page de test solo

| ID | Fonctionnalité | Description | Priorité |
|----|----------------|-------------|----------|
| RACE-H01 | Page standalone `test-solo.html` | Lance une partie solo sans lobby ni Socket.io. Charge un véhicule depuis localStorage (ou génère un véhicule de test par défaut) + génère une map aléatoire. | P0 |
| RACE-H02 | Flag solo dans le jeu principal | Paramètre URL `?solo=1` sur `game.html` : bypass du lobby, connexion Socket.io simulée en local, un seul joueur. | P1 |
| RACE-H03 | Contrôles clavier complets | Flèches ou WASD, + raccourcis de test : `R` = régénère la map, `V` = change de véhicule depuis la galerie localStorage, `D` = toggle debug overlay. | P0 |
| RACE-H04 | Overlay d'équilibrage | Affiche en temps réel : vitesse, v_lateral, is_drifting, voxels restants, fps. Permet de valider chaque étape du développement sans ouvrir les DevTools. | P0 |
| RACE-H05 | Scénarios de test rapides | Boutons de situation : "Vitesse max", "Collision mur", "Drift forcé", "Voxels à 20%". Pour reproduire rapidement les cas limites. | P1 |

---

## 4. Critères d'acceptation transversaux

**CA-R01 Map valide** : toute map générée doit avoir un chemin complet du départ à l'arrivée, vérifié par BFS, avant d'être utilisée. Aucune map cassée ne doit atteindre les joueurs.

**CA-R02 Performance** : le jeu doit maintenir 30 fps minimum sur une tablette de 2020 (iPad 7e génération ou équivalent Android) avec 5 joueurs et une map 4×4 blocs.

**CA-R03 Sécurité** : aucun pseudo joueur ou champ texte de bloc ne doit pouvoir injecter du HTML ou du JS dans l'interface. Vérification : tenter `<script>alert(1)</script>` comme pseudo — doit s'afficher comme texte brut.

**CA-R04 Retouche non-destructive** : l'outil de retouche scan ne modifie pas les données brutes du scan. Le JSON original est conservé ; la retouche produit un JSON dérivé.

**CA-R05 Test solo rapide** : depuis un navigateur vierge, la page `test-solo.html` doit charger et être jouable en moins de 10 secondes.

---

## 5. Contraintes techniques

**CT-R01** : Pas de nouvelles dépendances npm. Tout algo procédural en vanilla JS.

**CT-R02** : Les blocs seed sont des fichiers JSON dans `/data/map-blocks/_seed/`. Ils sont committés dans le dépôt.

**CT-R03** : Le champ `exits` est optionnel dans le JSON pour rester rétrocompatible avec les blocs existants.

**CT-R04** : La sanitisation des pseudos se fait côté serveur (`server.js`), jamais uniquement côté client.

**CT-R05** : Le système de hauteur (élévation 0/1) est une extension du format de grille existant. Une cellule sans champ `elevation` est traitée comme `elevation: 0`.

---

## 6. Risques

**R-R01 Algo procédural génère des maps peu fun** : *probabilité élevée, impact moyen*. Mitigation : page de test solo (RACE-H) pour itérer vite + seed reproductible (RACE-B06) pour fixer les cas problématiques.

**R-R02 Alignement rampes/plateaux visuellement imprécis** : *probabilité moyenne, impact faible*. Mitigation : aperçu profil de hauteur dans l'éditeur (RACE-C06) + ajustement des constantes dans `layout.json`.

**R-R03 Retouche scan introduit des états invalides** : *probabilité faible, impact moyen*. Mitigation : validation du JSON retouché avant enregistrement (structure voxel 4×4×8 vérifiée).

**R-R04 Culling Three.js trop agressif** : *probabilité faible, impact élevé*. Mitigation : marge de sécurité autour du frustum (zone tampon de 1 bloc) + tests visuels sur map 5×5.

---

## 7. Ordre d'implémentation recommandé

1. **RACE-H** (page test solo) — débloque l'équilibrage à chaque étape
2. **RACE-A01–A03** (blocs seed + exits + rotation) — fondation de la génération
3. **RACE-B01–B04** (algo assemblage + boucles + BFS) — maps jouables
4. **RACE-D01–D03** (perte voxels + seuil) — conséquences de choc
5. **RACE-E01–E02** (flèches HUD) — lisibilité multijoueur
6. **RACE-F01–F02** (culling + sécurité XSS) — robustesse
7. **RACE-C01–C05** (plateaux + rampes) — relief
8. **RACE-G01–G07** (retouche scan) — session dédiée nécessaire

---

*Document PRD v0.1 — addendum au PRD Pop Vroum v0.2*
