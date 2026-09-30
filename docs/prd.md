# Product Requirement Document — Pop Vroum

**Projet** : Pop Vroum
**Porteur** : 1k3vrtical / Collectif Mille Trois Cents
**Version** : 1.0 — document consolidé, fait foi
**Date** : 16 septembre 2026
**Remplace** : `prd-race.md`, `prd-solo-v3.md`, `prd-v4.md`, `prd-v1.1-stories.md`, `prd_physique_vehicule.md`, `scan-v2-sandwich.md`, `phase-6-revisee.md` (conservés pour l'historique, plus maintenus)

> Ce document est né d'une session d'alignement (60 questions + 10 questions de précision) menée le 16 septembre 2026. Il tranche les contradictions accumulées entre les PRD successifs et décrit **l'état réel du projet**, pas l'état espéré.

---

## 1. Vision

### Pitch (inchangé)

> Pop Vroum est un atelier-jeu où 5 participant·es colorient chacun·e leur véhicule sur une feuille de dessin, selon un langage de couleurs. Le dessin est scanné, reconstruit en véhicule voxel 3D, et les véhicules traversent ensemble une map procédurale en restant groupé·es : chaque couleur donne à la fois une caractéristique individuelle et un pouvoir partagé qui n'a de sens qu'avec et pour les autres.

### Ce qui n'a pas bougé

- **Coopératif, jamais compétitif.** Personne ne gagne seul·e. La victoire se déclenche quand *tous* les joueurs connectés sont arrivés.
- **Le papier d'abord.** Le geste manuel de coloriage reste l'acte de création. Le numérique le prolonge.
- **Dispositif d'atelier, pas jeu de studio.** Robustesse en conditions non contrôlées > polish de gameplay.
- **Cumulativité.** Le pool de blocs map s'enrichit à chaque atelier.

### Ce qui a été recadré le 16/09/2026

- **Le jeu de voiture est la fondation.** « Si cette partie n'est pas juste, alors le reste tombe à l'eau. » Un test de bout en bout a montré que la conduite n'était pas au niveau — c'est ce qui a motivé les 3 vagues de travail physique/map/obstacles.
- **Pas de pédagogie du dessin technique.** « Je ne dois pas me substituer à un cours de dessin technique, je dois rester fun pour raconter des histoires et des jeux. » → la feuille v2 « sandwich » remplace la v1 orthogonale.
- **Pas de classement individuel visible.** Le podium apparu dans le code n'était pas une décision produit.

---

## 2. Séquençage

L'ordre est ferme. Chaque phase débloque la suivante.

| # | Phase | État | Contenu |
|---|-------|------|---------|
| 1 | Scan & reconstruction | **Acquis** | Feuille v2 sandwich, pipeline complet, retouche |
| 2 | Génération de map | **Acquis** | Blocs seed + assemblage graphe + BFS |
| 3 | **Conduite & game feel** | **En cours — priorité absolue** | Calibrage du noyau physique, diagnostic « trop mécanique » |
| 4 | Module coopératif | À venir | Cohésion (dont rayon bloqué par les murs), puis refonte des pouvoirs |
| 5 | Premier atelier réel | À venir | Cible de la V1 |
| 6 | V1.x | Reporté | Pouvoirs finalisés, punchers, vents, bordures verre |
| 7 | Direction artistique | Plus tard | Identité visuelle, une fois la base fonctionnelle solide |

---

## 3. Périmètre V1 — premier atelier réel

Aucune date fixée. Projet personnel sans deadline. Piste de financement DRAC en pause mais pas abandonnée.

### Dans le périmètre

| Domaine | Contenu |
|---------|---------|
| Scan | Feuille v2 sandwich uniquement. Calibration par patch. Retouche `scan-edit.html` en filet de sécurité. |
| Véhicule | Reconstruction voxel 4×4×8, roues auto, stats RVB, aperçu 3D, galerie localStorage. |
| Map | Génération procédurale depuis le pool, 1 bloc départ + 1 bloc arrivée, taille selon effectif, tirage neuf à chaque partie. |
| Conduite | Physique vectorielle, drift émergent sans bouton dédié, rebond mur, rampes/plateaux, perte de voxels à l'impact. |
| Coopératif | Jauge de cohésion. Victoire collective. Flèches hors-écran. Mini-map. |
| Blocs | Éditeur web utilisé par l'**animateur·trice**. Export JSON, intégration manuelle par le dev. |
| Réseau | Wi-Fi local uniquement. Lobby 5 joueurs max, pseudo sans compte. |

### Hors périmètre → V1.x

- Les 6 pouvoirs couleur (dont les 4 déjà partiellement codés) — à reprendre entièrement en phase 4/6
- Punchers et vents (obstacles actifs)
- Bordures de map en verre
- Rayon de cohésion bloqué par les murs
- Bouclier dégressif
- Son, export GLB, mode replay, interface d'admin du pool

### Hors périmètre définitif

PvP, scores/classements visibles, comptes utilisateur, app native, hébergement distant, langues autres que le français.

---

## 4. Décisions structurantes

| Sujet | Décision | Origine |
|---|---|---|
| Classement d'arrivée | Calculé et conservé côté serveur pour un futur écran animateur·trice. **Jamais affiché aux joueurs.** | Q1 |
| Feuille de scan | **v2 sandwich = officielle.** v1 orthogonale gelée : code conservé et accessible, plus maintenue. Un seul pipeline à faire évoluer. | Q7-9, R3 |
| Retouche scan | Filet de sécurité discret, pas un moment pédagogique mis en scène. Le dessin reste l'acte de création. | Q10 |
| Daltonisme | **En attente.** Le porteur est lui-même daltonien et veut des retours croisés (daltoniens / non-daltoniens) avant toute décision sur le slider ou la palette. Ne rien changer d'ici là. | Q11, R4 |
| Sorties du labyrinthe | **Statu quo** : 1 départ, 1 arrivée, chemin garanti par BFS. L'idée de sorties multiples reste ouverte, non planifiée. | R2 |
| Pool de blocs | Export JSON depuis l'éditeur, intégration manuelle par le dev. Pas de publication directe par les participant·es. Test live possible avant publication. | Q13, Q31 |
| Validateur de bloc | Avertit, ne bloque jamais. Le dev relit et corrige. | Q18 |
| Drift | Émergent, sans bouton dédié. **Le moins de boutons possible est un principe, pas une contrainte technique.** | Q20 |
| Obstacles & pouvoirs | Doivent être à **double tranchant** : un bénéfice individuel qui coûte à la cohésion du groupe. Principe directeur de la refonte des 6 pouvoirs. | Q21, R9 |
| Sillage vs surface | Quand une trace de sillage recouvre une case `sticky`/`boost`, **le sol l'emporte**. | Q27 |
| Véhicule vs véhicule | Pas de collision entre véhicules en V1. | Q28 |
| Bots | Outil de dev uniquement. Jamais en atelier. | Q29 |
| Élévations | Richesse visuelle, pas un système tactique à approfondir pour l'instant. | Q32 |
| Matériel d'atelier | Composer avec ce que les gens ont sous la main. Pas de kit calibré imposé. | Q39 |
| Outils dev / app atelier | **Frontière stricte.** Le jeu doit rester avec le moins d'UI possible. Les bancs d'essai sont conservés. | Q43, Q48 |
| Méthode de travail | Itérations larges et exploratoires, plus de découpage en stories atomiques. Signaler les incohérences sans attendre qu'on le demande. | Q57-58 |

---

## 5. Chantier en cours — conduite & game feel

**Format : une seule session longue** (décision R10), pas de découpage en étapes.

### Le problème à résoudre

Le modèle physique est vectoriel et complet (velocity indépendante de l'angle, drift émergent, transfert de poids, rebond élastique). Mais le ressenti reste **« trop mécanique »** face à la référence PAKO : *« leur véhicule a un game feel moins mécanique et emprunte des routes plus naturelles. Je ne sais pas si c'est dû au vecteur qui s'adapte ou autre chose. »*

Le diagnostic de cet écart fait partie du chantier, avant tout ajout de contenu.

### Contenu du chantier

1. **Outil d'édition de véhicule de test** — poser directement les voxels et leurs couleurs pour générer un véhicule de test, sans passer par le scan. Objectif : éprouver la physique sur des véhicules variés (léger/lourd, long/court, rapide/adhérent). Complète `voxel/random-vehicule.js` qui ne fait que de l'aléatoire. *Décision R5 : à faire maintenant, en ouverture du chantier.*
2. **Diagnostic du ressenti mécanique** — identifier ce qui rend la conduite raide : courbes d'accélération, réponse du virage, lag caméra, absence d'inertie visuelle, rebond trop sec.
3. **Calibrage du noyau** via `test-solo-v3.html` : vitesse, grip, seuil de drift, seuil de casse.
4. **Seuil de dommage** — à raffiner une fois les runs propres, pas avant.

### Hors de ce chantier

Bordures en verre (R6), rayon de cohésion mural (R7), bouclier dégressif (R8), punchers, vents.

---

## 6. Vocabulaire de jeu

### Couleurs → stats et pouvoirs

| Couleur | Stat individuelle | Pouvoir partagé | État du pouvoir |
|---------|-------------------|-----------------|-----------------|
| Rouge | Vitesse | Aspiration (triangle arrière) | Codé |
| Vert | Adhérence | Phares stabilisants (+ flèche vers l'arrivée) | Codé |
| Bleu | Accélération | Sillage (trace au sol) | Codé |
| Orange | — | Bouclier frontal | Codé, avec absorption dégressive |
| Violet | — | Attraction (champ de cohésion) | **Calculé mais non implémenté** |
| Rose | — | Soin (régénération de voxels) | **Calculé mais non implémenté** |

Les 6 pouvoirs sont à reprendre en phase 4/6 sous le principe du double tranchant (§4). Le mélange actuel « pouvoir vert + flèche de navigation » sera démêlé à ce moment-là (Q26).

### Types de cellule de map

`null` (sol) · `dur` (plateau, h=0.6) · `sticky` (grip ×1.8) · `boost` (grip ×0.6 + accélération) · `ramp` / `ramp_n|s|e|o` (pente) · `rampe_bosse`, `bump` (saut) · `movable` (cube poussable) · `pole` (poteau cassable)

### Feuilles

| Feuille | Format | Rôle |
|---------|--------|------|
| Véhicule v2 « sandwich » | A4/A3 paysage, 4 grilles 4×8 | **Officielle** — 4 tranches horizontales empilées |
| Véhicule v1 | A3 paysage, 3 vues orthogonales | Gelée, conservée |
| Bloc map | A3, grille 8×8 | Support papier de discussion collective, recopié ensuite dans l'éditeur web |

---

## 7. Incohérences relevées à traiter

Relevées le 16/09/2026 en comparant docs et code. Colonne « Au 24/09 » : état après revue. Le travail se fait en solo (`test-v5`) jusqu'à ce que le jeu soit propre ; les points serveur/multijoueur attendent la phase réseau.

| # | Constat | Impact | Au 24/09 |
|---|---------|--------|----------|
| 1 | `game:end` et `game:event` sont écoutés côté client mais **jamais émis** par le serveur. | Code mort ou fonctionnalité manquante (écran de fin). | Ouvert — phase serveur |
| 2 | `admin-routes.js` implémente la route HTTP `POST /admin/blocks` (option A), alors que la décision est l'export JSON manuel (option B). | Route active non voulue. À retirer ou assumer. | Ouvert — phase serveur |
| 3 | `server/cohesion.js`, `game/cohesion.js`, `game/impact.js` sont des **fichiers d'une ligne** (stubs vides). La cohésion réelle vit dans `game-loop.js`, l'impact dans `voxel/impact.js`. | Fichiers fantômes qui trompent la lecture. | **Résolu** — stubs supprimés le 24/09 ; `game/cohesion.js` est devenu un vrai module |
| 4 | `DAMAGE_THRESHOLD` est codé en dur à `8.0` dans `game-page.js` alors que `gameplay.json` déclare `4`. | Viole la règle « ne jamais hardcoder ». Le calibrage ne prend pas. | Ouvert — phase serveur (`game-page.js` = page multijoueur ; config à `2` désormais). `test-v5` utilise ses propres curseurs de casse |
| 5 | Le bouclier **est déjà dégressif** (`absorbDamage`, `shield.hp`), contrairement à ce qui était supposé. | La décision R8 (« intention future ») est à revoir : c'est déjà là. | Branché côté serveur, voir `prd_pouvoirs.md` §1 |
| 6 | `scan-v2-sandwich.md` documente une convention x/z **inversée** par rapport au code. `builder-sandwich.js` signale l'écart et applique la bonne. | Piège pour toute future session. Le code fait foi (§ architecture). | Ouvert |
| 7 | `index.html` présente encore `scan.html` (v1) comme étape 1 du flux atelier. | Contredit la décision « v2 officielle ». | **Résolu** — l'étape 1 pointe vers `scan2.html`, v1 est rangée dans les outils |
| 8 | Le pool `_seed` mélange 10 blocs `block_seed_*` (avec `exits`) et 5 blocs anciens sans `exits`, plus 2 blocmaps vides. Deux conventions de nommage. | Le générateur fonctionne en double mode pour compenser. | Ouvert |
| 9 | `symbol-reader.js` subsiste alors que le scan de blocs a été abandonné. | Code mort. | **Résolu** — supprimé le 24/09 |
| 10 | `.claude/worktrees/elegant-shtern-ef8496` duplique **12 Mo** du dépôt (branche datée de mai). | Pollue les recherches, double les résultats. | Ouvert — il y a maintenant 2 worktrees, chacun avec des modifs non commitées : à trier à la main |
| 11 | Le dépôt n'a qu'**un seul commit**. Des mois de travail (35 fichiers modifiés, ~27 non suivis) ne sont pas versionnés. | Aucun point de restauration. Risque majeur. | **Résolu** — historique versionné et poussé sur GitHub |

---

## 8. Risques

| Risque | Probabilité / impact | Mitigation |
|---|---|---|
| Travail non versionné perdu | élevée / critique | Commiter avant tout gros chantier |
| Le game feel ne décolle pas malgré le calibrage | moyenne / élevé | Diagnostic avant calibrage ; l'outil de véhicule de test permet d'isoler les variables |
| Accessibilité daltonisme non tranchée | moyenne / moyen | Retours croisés à organiser ; le vocabulaire couleur est au cœur du dispositif |
| Aucun atelier réel mené à ce jour | certaine / élevé | Toute validation reste théorique tant qu'un atelier complet n'a pas tourné |
| Scan jamais testé hors feutres du porteur | moyenne / moyen | Tester d'autres marques avant le premier atelier |
| Divergence entre `game-page.js` et `test-solo-v3.js` | élevée / moyen | Règle : la page la plus récemment modifiée proprement fait référence |

---

## 9. Métriques de succès V1

**M1** — Un atelier complet tourne en ~1h15 avec 5 participant·es.
**M2** — Le scan passe du premier coup dans la majorité des cas, la retouche suffit pour le reste.
**M3** — Au debrief, les participant·es parlent d'**être arrivé·es ensemble**, pas de leur performance.
**M4** — La conduite est jugée agréable par des gens qui ne jouent pas habituellement.
**M5** — Le pool de blocs s'enrichit d'au moins un bloc créé par le groupe.

---

*PRD v1.0 — document de référence. Les valeurs configurables vivent dans `/config/*.json`. Ne jamais hardcoder.*
