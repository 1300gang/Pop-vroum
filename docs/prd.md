# Product Requirement Document — Pop Vroum

**Projet** : Pop Vroum
**Porteur** : 1k3vrtical / Collectif Mille Trois Cents
**Version** : 0.2 (V1 spec — révisée)
**Date** : 28 avril 2026
**Méthodologie** : BMAD-METHOD — Phase 2 PRD
**Document amont** : `brainstorming-session.md`

**Changelog v0.2** :
- Bloc map repensé : grille 2D plate avec symboles type tiled map (au lieu de voxel 4×4×8)
- Feuille bloc séparée (et non verso de la feuille véhicule), 1 par groupe
- Détection automatique des 4 roues (croisement vue de profil + vue de dessus)
- Contrôles tactiles type PAKO/Mobil Frit, auto-avance
- Game feel juicy explicité (dérapages, particules, screen shake)
- Caméra orthographique + indicateurs hors-écran pour coéquipier·ères
- Référence projets antérieurs corrigée : AR-claude-atelier, Scale

---

## 1. Vision produit

### Vision en une phrase

> Un dispositif d'atelier où un groupe de 5 personnes maximum colorient chacun·e leur véhicule sur une feuille technique, le scannent pour le faire exister en 3D, puis traversent ensemble une map en restant groupé·es — chaque couleur produisant à la fois une caractéristique individuelle et un pouvoir partagé qui n'a de sens qu'avec et pour les autres.

### Énoncé long

Pop Vroum est un dispositif phygital pédagogique du Collectif Mille Trois Cents, qui prolonge la pratique d'atelier participatif via une mécanique de jeu coopérative. Le dispositif articule trois moments : un acte créatif individuel (coloriage du véhicule sur 3 vues), un passage technique partagé (scan, reconstruction 3D, validation), et une traversée coopérative (jeu vidéo où la cohésion du groupe est la mécanique centrale). Il s'inscrit dans une temporalité longue via un pool de blocs map qui s'enrichit à chaque atelier, faisant du jeu une mémoire collective traversable.

---

## 2. Objectifs stratégiques

**Objectif 1 — Tangibilité.** Conserver la primauté du geste manuel comme acte de création. Le numérique prolonge le papier.

**Objectif 2 — Coopération.** Faire de la cohésion du groupe la mécanique centrale. Personne ne gagne seul·e ; personne ne peut être abandonné·e sans conséquence.

**Objectif 3 — Reproductibilité.** Le dispositif doit tourner avec un·e seul·e animateur·trice formé·e, sans le créateur. Cela impose robustesse du scan, clarté des règles, résistance aux conditions matérielles imparfaites.

**Objectif 4 — Cumulativité.** Chaque atelier laisse une trace (blocs map créés, véhicules en galerie). Le projet a du sens à l'échelle d'un programme pluri-annuel.

**Objectif 5 — Vulgarisation par le défaut.** Les imperfections (lecture couleur, daltonisme, débordements) deviennent des occasions de discussion, pas des bugs à masquer.

---

## 3. Personas

### Persona 1 — Le ou la participant·e d'atelier

10 ans à adulte, aucune compétence technique. Vient pour faire. Besoins : comprendre vite quoi dessiner, voir le résultat, jouer rapidement, se reconnaître dans son véhicule. Frustrations à éviter : attentes longues, lectures couleur incompréhensibles, sentiment d'inutilité dans le groupe.

### Persona 2 — L'animateur·trice d'atelier

Membre du Collectif ou intervenant·e formé·e. Maîtrise tablette de base, pas développeur·euse. Besoins : lancement simple, relance rapide d'une partie, visibilité sur la cohésion et les pouvoirs activés pour animer le debrief, ajout manuel d'un bloc map au pool. Frustrations à éviter : débugger un scan en séance, perdre des véhicules en fin de session.

### Persona 3 — Le développeur·euse (toi)

Maîtrise HTML/CSS/JS, MindAR, Three.js, OpenCV.js. Sessions de code AI itératives. Besoins : architecture modulaire, mode debug visuel, JSON comme format pivot, stories atomiques.

---

## 4. User Journey — Atelier type

**Durée totale** : ~1h-1h15 · **Effectif** : 5 max

**Matériel** : 5 feuilles A3 véhicule, 1 feuille A3+ bloc collectif, feutres calibrés (6 couleurs), 1 tablette/téléphone par poste de scan, 1 écran/projecteur pour le jeu collectif.

**Phase 1 — Présentation (10 min)** : règles, démo, langage couleurs/symboles.

**Phase 2 — Premier dessin véhicule (10-15 min)** : chacun·e colorie son véhicule sur les 3 vues.

**Phase 3 — Scan + validation (5 min par participant·e)** : pipeline visible, validation collective de chaque véhicule reconstruit.

**Phase 4 — Lobby + première partie (10 min)** : 5 véhicules en jeu, map tirée au sort, traversée coopérative.

**Phase 5 — Debrief + redessin libre (15-20 min)** : discussion, ajustements possibles des véhicules.

**Phase 6 — Deuxième partie (10 min)** : avec véhicules ajustés.

**Phase 7 — Création collective de bloc (15 min)** : le groupe se rassemble autour d'**une seule feuille bloc** (A3 minimum, posée à plat sur la table). Grille 2D vue de dessus, dessin de symboles à plusieurs feutres, discussion stratégique. Visualisation live du bloc en 3D sur écran annexe. Le bloc final est ajouté au pool **manuellement par le développeur** après l'atelier.

---

## 5. Spécifications fonctionnelles

**Légende** : P0 critique · P1 important · P2 souhaitable

### Module A — Feuille véhicule à colorier

| ID | Fonctionnalité | Description | Priorité |
|----|----------------|-------------|----------|
| A01 | Mise en page A3 paysage | 3 grilles selon standard dessin technique : face en bas-gauche, profil à droite, dessus au-dessus de la face. Schéma explicatif de la projection en haut-gauche. | P0 |
| A02 | Grille voxel 4×4×8 | Face = 4×4, profil = 8×4, dessus = 8×4. Cases ≥ 1.5 cm. | P0 |
| A03 | 4 QR codes de calage | Aux 4 coins. Stylisés graphiquement, cohérents avec AR-claude-atelier et Scale. | P0 |
| A04 | Patch de référence couleur | Zone imprimée avec les 6 couleurs cibles, pour calibrer la lecture HSL. Discrète, en bas. | P0 |
| A05 | Légende des couleurs | Rappel rapide de l'effet de chaque couleur. | P1 |

### Module A bis — Feuille bloc collectif

| ID | Fonctionnalité | Description | Priorité |
|----|----------------|-------------|----------|
| AB01 | Feuille bloc séparée | Format A3 minimum, une seule par groupe, posée à plat au centre de la table. | P0 |
| AB02 | Grille 2D plate (top-down) | Une grille vue de dessus, format tiled map. Proposition 8×8. Cases ≥ 3 cm. | P0 |
| AB03 | 4 QR codes de calage | Esthétique cohérente avec feuille véhicule. | P0 |
| AB04 | Légende imprimée des 4 symboles | Sur la feuille : illustration de rampe, collant, dur, accélération avec leur effet. | P0 |
| AB05 | Zone de signature/nom de groupe | Pour identifier l'atelier d'origine. | P1 |

### Module B — Pipeline de scan

| ID | Fonctionnalité | Description | Priorité |
|----|----------------|-------------|----------|
| B01 | Capture caméra | Web mobile-first. Pas de stockage, traitement live. | P0 |
| B02 | Détection des 4 QR codes | OpenCV.js ou jsQR. Erreur visuelle si < 4 détectés. | P0 |
| B03 | Redressement de perspective | Homographie via les 4 QR. | P0 |
| B04 | Segmentation des grilles | Véhicule : 3 zones. Bloc : 1 zone. Coordonnées en dur d'après mise en page. | P0 |
| B05 | Lecture par case | Couleur HSL médiane (centre de la case, ignore bords). Pour blocs : template matching de symbole. | P0 |
| B06 | Calibration via patch | Lecture du patch A04 et alignement de la grille HSL en début de scan. | P0 |
| B07 | Classification HSL en 6 couleurs | Tolérance large autour de chaque teinte. | P0 |
| B08 | Ajustement manuel HUE/SAT | Slider exposé en mode debug. Vulgarisation daltonisme assumée. | P1 |
| B09 | Mode debug visuel complet | Affiche photo brute, QR détectés, image redressée, grilles segmentées, vue case par case. | P0 |
| B10 | Validation par l'utilisateur | Aperçu 3D + grille lue, boutons "Valider" ou "Re-scanner". | P0 |
| B11 | Détection du type de feuille | Reconnaît automatiquement véhicule vs bloc. | P1 |

### Module C — Reconstruction voxel (véhicule)

| ID | Fonctionnalité | Description | Priorité |
|----|----------------|-------------|----------|
| C01 | Union 2-sur-3 | Voxel instancié si ≥ 2 vues le valident. | P0 |
| C02 | Attribution couleur du voxel | Couleur majoritaire entre vues validantes. Égalité → vue de face prioritaire. | P0 |
| C03 | Détection automatique des 4 roues | **Vue de profil** : positions avant-arrière (premières/dernières cases coloriées de la rangée du bas, ou aux extrémités si rangée vide). **Vue de dessus** : écartement gauche-droite (cases extrêmes en largeur sur les bords avant et arrière). 4 roues placées sous les coins du châssis. Roues stylisées toujours visibles, latéralement saillantes. | P0 |
| C04 | Sortie JSON véhicule | `{ id, playerName, grid, wheelPositions, stats, powers }`. Sérialisable. | P0 |
| C05 | Pas de nettoyage en V1 | Voxels flottants ou formes bizarres conservés. | P0 |
| C06 | Calcul des stats RVB | Comptage voxels par couleur primaire → vitesse (rouge), adhérence (vert), accélération (bleu). | P0 |
| C07 | Calcul des pouvoirs HSL | Comptage voxels par couleur secondaire → bouclier (orange), attraction (violet), soin (rose). | P0 |

### Module C bis — Reconstruction bloc map

| ID | Fonctionnalité | Description | Priorité |
|----|----------------|-------------|----------|
| CB01 | Lecture symboles tiled 2D | Pour chaque case 8×8 : identification d'un des 4 symboles ou aucun. | P0 |
| CB02 | Génération de l'élément 3D | Chaque symbole se traduit en mesh pré-modélisé placé sur la case. | P0 |
| CB03 | Sortie JSON bloc | `{ id, name, createdAt, atelier, grid }`. Stocké en JSON local serveur. | P0 |
| CB04 | Visualisation live | Scan continu pendant le dessin, rendu 3D mis à jour en temps réel sur écran annexe. | P1 |

### Module D — Affichage 3D et galerie

| ID | Fonctionnalité | Description | Priorité |
|----|----------------|-------------|----------|
| D01 | Rendu Three.js du véhicule | Voxels cubes texturés, 4 roues stylisées. Vue rotative libre. | P0 |
| D02 | Écran de validation | Véhicule en rotation libre + récap stats/pouvoirs. | P0 |
| D03 | Galerie des véhicules | Page accessible depuis l'accueil, vignettes des véhicules localStorage. | P1 |
| D04 | Sauvegarde locale auto | JSON par véhicule en localStorage. | P1 |
| D05 | Export GLB | Export pour usage externe (impression 3D). | P2 |
| D06 | Suppression dans la galerie | Libère le localStorage. | P2 |

### Module E — Jeu coopératif

| ID | Fonctionnalité | Description | Priorité |
|----|----------------|-------------|----------|
| E01 | Lobby multijoueur 5 max | Connection Socket.io, lobby fermé après lancement. | P0 |
| E02 | Tirage au sort de la map | Blocs tirés du pool, contraintes de jouabilité (chemin existant). | P0 |
| E03 | Auto-avance + pilotage tactile | Auto-avance à la vitesse du véhicule. Bord droit = tourner droite, bord gauche = tourner gauche, centre bas = freiner/reculer. Équivalents clavier : flèches ou A/D/S. | P0 |
| E04 | Adaptation difficulté selon effectif | Moins de joueur·euses → moins d'obstacles ou map raccourcie. | P1 |
| E05 | Affichage 5 véhicules synchronisé | Position, rotation, état répliqués via Socket.io. | P0 |
| E06 | Caméra orthographique top-down | Vue de dessus ortho ou très légèrement isométrique. Zoom adaptatif selon dispersion. | P0 |
| E07 | Indicateurs hors-écran | Flèche colorée (couleur dominante du véhicule) sur le bord de l'écran pour coéquipier·ères hors champ. | P0 |
| E08 | Jauge de cohésion | Indicateur global, bonus actif si les 5 sont dans un rayon défini. | P0 |
| E09 | Pouvoir Rouge — aspiration | Triangle arrière, taille proportionnelle au rouge. Boost vitesse pour véhicules dans le triangle. | P0 |
| E10 | Pouvoir Vert — phares stabilisants | Faisceau avant. Adhérence augmentée pour véhicules éclairés. | P0 |
| E11 | Pouvoir Bleu — sillage | Trace bleue persistante au sol. Boost accélération pour véhicules qui passent dessus. Durée 5-10 sec. | P0 |
| E12 | Pouvoir Orange — bouclier avant | Bouclier devant, taille proportionnelle. Protège véhicules adjacents des chocs frontaux. | P0 |
| E13 | Pouvoir Violet — attraction | Champ d'attraction qui aide à maintenir la cohésion. | P1 |
| E14 | Pouvoir Rose — bulle de soin | Aura régulière qui réinstancie progressivement les voxels perdus des véhicules adjacents. | P1 |
| E15 | Perte de voxels par impact | Raycasting depuis le point d'impact, retrait des voxels exposés, mise à jour stats/pouvoirs. | P0 |
| E16 | Voxels au sol après chute | Voxels perdus tombent au sol et restent visibles. | P1 |
| E17 | Conditions de fin de partie | Victoire : tous arrivés. Défaite : un véhicule entièrement détruit. | P0 |
| E18 | Écran de fin avec photo des véhicules | Captures finales côte-à-côte pour le debrief. | P1 |

### Module E bis — Game feel juicy

| ID | Fonctionnalité | Description | Priorité |
|----|----------------|-------------|----------|
| EJ01 | Dérapage visible | Skid marks au sol en virage serré. Intensité = vitesse × (1 - adhérence). | P0 |
| EJ02 | Particules d'impact | Petits cubes colorés s'envolent à chaque voxel détaché, avec gravité. | P0 |
| EJ03 | Screen shake | Léger tremblement caméra sur impact significatif. | P1 |
| EJ04 | Feedback d'activation pouvoirs | Flash + son court à chaque activation HSL. | P1 |
| EJ05 | Son moteur dynamique | Hauteur sonore corrélée à la vitesse. | P2 |
| EJ06 | Trace visuelle de la cohésion | Lien lumineux discret entre véhicules quand jauge pleine. | P1 |

### Module F — Map et blocs procéduraux

| ID | Fonctionnalité | Description | Priorité |
|----|----------------|-------------|----------|
| F01 | Pool de blocs JSON local | Stockage fichiers JSON locaux serveur. | P0 |
| F02 | 4 symboles de bloc | Vocabulaire fermé : rampe, collant, dur, accélération. | P0 |
| F03 | Tirage au sort par session | Aléatoire avec contraintes de jouabilité. | P0 |
| F04 | Création de bloc par le groupe | Phase 7, scan, visualisation live. | P1 |
| F05 | Ajout manuel au pool (V1) | Développeur ajoute le bloc au JSON après l'atelier. | P1 |
| F06 | Visualisation live du bloc | Mode debug visuel pendant le scan collectif. | P1 |

### Module G — Audio et feedback (V2)

| ID | Fonctionnalité | Description | Priorité |
|----|----------------|-------------|----------|
| G01 | SFX moteur, impact, pouvoirs | Sons spatialisés type PAKO. | P2 |
| G02 | Musique d'ambiance | Boucle courte phase de course. | P2 |
| G03 | Audio mini-player | Pour les transitions, inspiré Poliade. | P2 |

---

## 6. Critères d'acceptation transversaux

**CA-01 Robustesse du scan** : ≥ 90% de cases lues correctement en éclairage 300 lux+, distance 25-60 cm, feutres calibrés.

**CA-02 Temps de réponse** : scan complet < 5 sec · latence multijoueur < 200 ms à 5 joueur·euses sur réseau local · lancement dispositif < 30 sec.

**CA-03 Lisibilité du jeu** : à 5 joueur·euses, identification de chaque véhicule (couleur dominante + flèche off-screen), jauge de cohésion en permanence visible, pouvoirs actifs lisibles sans menu.

**CA-04 Persistance** : véhicules localStorage persistants entre sessions navigateur, galerie ≥ 50 véhicules sans ralentissement, export GLB ouvrable dans Blender.

**CA-05 Game feel** : pilotage tactile ressenti comme juicy (dérapages, particules, retour visuel), auto-avance non frustrante, vue ortho lisible même en groupe dispersé (zoom adaptatif).

---

## 7. Contraintes techniques

**C1 Stack** : HTML5/CSS3/JS vanilla, Three.js, OpenCV.js ou jsQR, MindAR.js si pertinent. Backend Node.js + Express + Socket.io. Stockage JSON local. Pas de DB, pas de cloud.

**C2 Mobile-first** : scan paysage tablette/téléphone. Jeu sur tablette, écran principal pour projection.

**C3 Sans compte** : pseudo lobby + localStorage.

**C4 Accessibilité couleur** : slider HUE/SAT facile d'accès, calibration patch systématique.

**C5 Modération éditoriale humaine** : développeur seul·e décideur·euse de l'ajout d'un bloc en V1.

---

## 8. Périmètre V1

**Inclus** : tous P0 + P1 retenus (A05, AB05, B08, B11, D03, D04, E04, E13, E14, E16, E18, EJ03, EJ04, EJ06, F04, F05, F06, CB04).

**Reporté V1.x/V2** : tous P2, module G complet, interface admin pool, mode replay, persistance serveur, import/export entre devices.

**Hors périmètre** : PvP, personnalisation hors-grille, scores/classement, comptes, app native, autres langues que français.

---

## 9. Risques

**R1 Scan instable** : *probabilité élevée, impact critique*. Mitigation : phase 0 maquette + phase 1 scan seul en priorité absolue, debug visuel obligatoire, calibration patch.

**R2 Équilibrage gameplay long** : *probabilité élevée, impact moyen*. Mitigation : valeurs externalisées en JSON, playtests réguliers.

**R3 Temps de dessin qui dérape** : *moyenne / moyen*. Mitigation : timer visible, animation à itérer vite.

**R4 Cohésion à 5 complexe** : *moyenne / élevé*. Mitigation : tests par paliers 2 → 3 → 5.

**R5 Feuille bloc difficile à scanner à plusieurs** : *moyenne / moyen*. Mitigation : feuille A3+ , scan asynchrone (après que le groupe a fini).

**R6 Détection des roues incohérente** : *moyenne / faible*. Mitigation : algorithme avec fallbacks, visualisation des roues dans l'écran de validation.

---

## 10. Métriques de succès V1

**M1** Scan ≥ 90% sans plus d'une re-tentative · **M2** Atelier complet ≤ 1h15 · **M3** Lors du debrief, les participant·es citent leurs *rôles dans le groupe* (pas seulement leurs perfs individuelles) · **M4** Pool ≥ 5 blocs après 5 ateliers · **M5** ≥ 1 session menée par un·e animateur·trice autre que le créateur, succès complet.

---

## 11. Prochaines étapes BMAD

→ **Phase 3 — Architecture document** (en cours)
→ **Phase 4 — Stories** : découpage atomique pour sessions code AI.

---

*Document PRD v0.2 — version de travail itérative.*
