# Brainstorming Session — Pop Vroum

**Projet** : Pop Vroum (anciennement Scan & Race)
**Porteur** : 1k3vrtical / Collectif Mille Trois Cents
**Date** : 28 avril 2026
**Méthodologie** : BMAD-METHOD — Phase 1 Brainstorming
**Techniques utilisées** : Role Playing (3 personas) · Five Whys · Analogical Thinking

---

## 1. Contexte du projet

### Point de départ

Le projet existait sous la forme de **Scan & Race**, un jeu de course multijoueur "phygital" où des véhicules sont personnalisés sur papier (UV map à colorier), scannés, puis affrontés en ligne en temps réel. Stack actuelle : Three.js + Socket.io + jsQR + Node/Express.

### Pivot

La session de brainstorming a fait émerger un repositionnement complet :

- **Du PvP vers le PvE coopératif** : les joueur·euses ne s'affrontent plus, iels traversent ensemble une map en restant groupé·es
- **De l'UV map au voxel-scan** : la forme du véhicule n'est plus pré-définie, elle est *fabriquée* par le coloriage de 3 vues orthogonales
- **De la stat individuelle au pouvoir partagé** : chaque couleur produit à la fois un effet sur le véhicule (RVB) et un pouvoir activable pour le groupe (HSL)
- **De la course unique à l'atelier itératif** : le dispositif s'inscrit dans une session d'1h-1h15 avec dessin, jeu, debrief, redessin

### Cadre

Le projet s'inscrit dans la pratique du Collectif Mille Trois Cents (« la pédagogie par le design ») et prolonge la réflexion théorique de l'auteur sur la **délégation ludique** (thèse Beaux-Arts).

---

## 2. Pitch

> Pop Vroum est un atelier-jeu où 5 participant·es coloriaient chacun·e leur véhicule sur une feuille de dessin technique (vue de face, profil, dessus) selon un langage de couleurs et de symboles. Le dessin est scanné via 4 QR codes, redressé, analysé case par case, et reconstruit en véhicule voxel 3D. Les véhicules traversent ensemble une map procédurale en restant groupé·es : chaque couleur donne à la fois une caractéristique individuelle et un pouvoir partagé qui n'a de sens qu'avec et pour les autres.

---

## 3. Role Playing — 3 personas

### Persona 1 — Dev Junior

**Profil** : Développeur·euse front-end avec 1-2 ans d'expérience, à l'aise en HTML/CSS/JS vanilla, débute en computer vision et 3D.

**Ce qui l'inquiète** :
- "Je n'ai jamais utilisé OpenCV.js, est-ce que je vais comprendre la doc ?"
- "Comment je débogue un scan qui rate ? Je vois juste une voiture moche en sortie, sans savoir si c'est la détection des QR, le redressement, l'analyse couleur ou la reconstruction qui a foiré"
- "La grille 4×4×8 c'est combien de cases en tout sur la feuille ? J'ai peur de me planter dans les coordonnées"

**Ce qu'il/elle attend du projet** :
- Un **mode debug visuel** qui montre chaque étape du pipeline de scan (image brute → QR détectés → image redressée → grilles segmentées → couleurs lues case par case)
- Des **fichiers de test** (photos de feuilles déjà coloriées) pour itérer sans avoir à imprimer/scanner à chaque fois
- Une séparation claire entre les modules : `scan.js`, `voxel-builder.js`, `vehicle-stats.js`, `game.js`
- Un README qui explique la chaîne de transformation papier → 3D pas à pas

**Ce qu'il/elle veut éviter** :
- Une stack lourde à installer
- Du code qui mélange détection, jeu et UI dans le même fichier
- Devoir comprendre toute la théorie de la projection orthogonale avant de pouvoir coder

### Persona 2 — Dev Senior

**Profil** : Développeur·euse expérimenté·e, maîtrise Three.js, a déjà fait du temps réel multijoueur, connaît les pièges de la computer vision en lumière non contrôlée.

**Ce qui l'intéresse** :
- L'architecture data-driven (cohérence avec les autres projets de l'auteur : ar.js Poliade refactoré sans switch/case)
- La séparation propre entre le **pipeline de scan** (déterministe, testable unitairement) et le **moteur de jeu** (temps réel, état partagé)
- La gestion de la latence Socket.io quand on a 5 joueurs + une jauge de cohésion qui doit rester synchronisée

**Ses préoccupations techniques** :
- "L'union 2-sur-3 va produire des artefacts. Il faut une passe de nettoyage : retirer les voxels flottants, lisser les arêtes, ou assumer le brut ?"
- "La perte de voxels par exposition à l'impact, c'est un calcul de raycasting au moment de la collision. Ça reste léger à 5 joueurs mais il faut le faire côté serveur pour éviter la triche / désynchro"
- "Le sillage bleu persistant au sol = potentiellement beaucoup d'objets dans la scène. Quelle durée de vie ? Quelle limite par joueur ?"
- "Le pool de blocs map qui s'enrichit à chaque atelier : où sont stockés les blocs créés ? JSON sur le serveur ? Base de données ? Fichiers individuels ?"

**Ses recommandations spontanées** :
- Faire le scan **entièrement côté client** (OpenCV.js) pour ne pas charger le serveur
- Stocker le véhicule reconstruit comme un **JSON sérialisable** (4×4×8 grille de couleurs) plutôt que comme un mesh — beaucoup plus léger à envoyer aux autres clients
- Prévoir un **mode replay** : si on garde le JSON du véhicule + les inputs joueurs, on peut rejouer une partie pour debrief

### Persona 3 — Moldu curieux

**Profil** : Animateur·trice du Collectif, ou habitant·e qui découvre le dispositif en atelier. Aucune compétence technique. Vient pour faire, pas pour comprendre.

**Ce qu'il/elle vit** :
- "J'ai colorié ma voiture, je tends la feuille au scanner... et là il faut que ça marche. Si je vois un message d'erreur en anglais je suis perdu·e"
- "Pourquoi mon orange a été lu comme rouge ? Comment je corrige ?"
- "C'est quoi la différence entre la vue de face et la vue de profil ? Et la vue de dessus, je dessine quoi exactement ?"

**Ce qu'il/elle attend** :
- Un schéma **explicatif imprimé sur la feuille elle-même**, en haut à gauche, qui montre comment les 3 vues se projettent en 3D (référence : dessin technique scolaire)
- Des couleurs de feutre **fournies en atelier**, calibrées pour le scan, pas n'importe quel feutre
- Un retour visuel **pendant le scan** : "ta feuille est bien cadrée", "ta vue de profil est mal éclairée", "ton orange a été détecté"
- Voir son véhicule **en 3D rotative** avant d'entrer en jeu, comme une récompense du dessin

**Ce qui le/la rebute** :
- Devoir lire des règles longues
- Un jeu où on perd à cause d'un autre joueur (cf. pivot vers PvE)
- Devoir attendre 5 minutes que le scan se fasse

**Insight clé** : Le Moldu curieux ne fait pas la différence entre "le scan a raté" et "j'ai mal colorié". Pour lui, c'est le dispositif qui ne marche pas. **Donc le retour visuel doit toujours dire** : "voici ce que j'ai vu, est-ce que c'est ce que tu voulais ?"

---

## 4. Five Whys

### Question initiale : Pourquoi faire un jeu où on colorie une feuille pour fabriquer un véhicule 3D ?

**Why 1** — Pourquoi pas juste un éditeur 3D dans le navigateur ?
> Parce que le geste manuel du coloriage est tangible, accessible sans compétence technique, et fait du dessin un acte social partagé autour d'une table.

**Why 2** — Pourquoi le geste tangible compte-t-il dans ce projet ?
> Parce que Mille Trois Cents fait du design social via des dispositifs phygitaux : le passage du papier au numérique n'est pas un détail technique, c'est *le sujet*. Le geste papier ancre le numérique dans le réel des participant·es.

**Why 3** — Pourquoi un véhicule, plutôt qu'un autre objet ?
> Parce que le véhicule a une avant/arrière, une orientation, une vitesse — c'est une forme qui *agit dans le monde*. Coloriée, elle devient une représentation de soi en mouvement, qu'on doit articuler avec les autres dans une trajectoire commune.

**Why 4** — Pourquoi imposer la coopération plutôt que la compétition ?
> Parce que la course classique reproduit une logique d'individualisme et de gagnant·e. Le pivot coopératif transforme la mécanique de jeu en *exercice d'attention à l'autre* — pour avancer il faut négocier, attendre, protéger. C'est cohérent avec la pédagogie par le design.

**Why 5** — Pourquoi le dispositif doit-il s'enrichir à chaque atelier (blocs map cumulatifs) ?
> Parce que c'est la condition pour que le projet ait du sens à l'échelle d'un programme et pas juste d'une session. Les ateliers passés laissent une trace dans les ateliers futurs. Cela inscrit le dispositif dans une **temporalité collective longue** : ce que tu fais ici sera traversé par d'autres demain.

**Insight final** : Le projet n'est pas "un jeu vidéo qu'on personnalise avec du dessin", c'est **un dispositif de mémoire collective qui utilise le jeu et le dessin comme support de production de traces partagées**.

---

## 5. Analogical Thinking — Trouver des analogies

### Analogie 1 — Le dessin technique scolaire

Les 3 vues (face/profil/dessus) reprennent la convention de la **projection orthogonale** apprise en cours de techno au collège. C'est un cadre culturel partagé (en France au moins), ce qui :
- réduit la barrière d'entrée pour les adolescent·es et adultes scolarisé·es
- rappelle un cadre éducatif rassurant
- justifie le schéma explicatif imprimé sur la feuille (qui devient une *aide-mémoire*, pas une instruction nouvelle)

### Analogie 2 — Le tricot collectif

Quand un groupe tricote ensemble une grande nappe ou un drapeau, chacun·e tricote son carré, mais les carrés s'assemblent. Pop Vroum fonctionne pareil : chacun·e fabrique son véhicule, mais le sens n'apparaît qu'à l'assemblage en partie. Et comme un tricot, **le résultat porte la trace des mains qui l'ont fait** (forme du véhicule, couleurs choisies, voxels perdus en cours de route).

### Analogie 3 — Le Spelunky-style block-based map

Référence assumée par l'auteur. Le système de map procédurale par tirage aléatoire de tiles dans un pool est éprouvé. Spelunky a démontré qu'avec **un vocabulaire de blocs limité** et des règles d'assemblage simples, on génère une infinité de niveaux jouables et lisibles. La transposition au pool collectif (les blocs viennent des ateliers passés) en fait un **Spelunky social**.

### Analogie 4 — La cordée en alpinisme

La mécanique de cohésion = la corde. Elle relie, elle protège, elle ralentit. Quand un·e cordé·e tombe, les autres encaissent. Quand le ou la premier·e de cordée trace, les suivant·es passent plus facilement (cf. sillage bleu). Cette analogie est précieuse parce qu'elle donne **un imaginaire à présenter en début d'atelier** qui clarifie immédiatement la mécanique : "vous êtes une cordée, pas une compétition".

### Analogie 5 — PAKO Car Chase Simulator

Référence game-feel mentionnée par l'auteur. Conduite simple, conséquences immédiates, lisibilité visuelle. C'est le cap esthétique et de jouabilité : **pas de simulation lourde, des sensations claires, un plaisir immédiat de mouvement**. Pop Vroum doit hériter de cette légèreté de pilotage tout en y greffant la couche coopérative.

---

## 6. Insights découverts

### Insight 1 — Le coloriage est un acte de positionnement politique dans le groupe

Quand un·e participant·e choisit ses couleurs, iel décide :
- ce qu'iel sera personnellement (vitesse, adhérence, accélération)
- ce qu'iel offrira au groupe (aspiration, stabilité, sillage, bouclier, attraction, soin)
- où iel mettra ses voxels (à l'avant = exposés mais utiles, à l'arrière = protégés mais en retrait)

C'est une **micro-théorie politique en acte**, accessible par un geste manuel simple.

### Insight 2 — La voiture est une mémoire vivante de la partie

Avec la perte de voxels par impact, le véhicule en fin de course ne ressemble plus à celui du départ. La forme finale **raconte ce qu'on a traversé**. Cela ouvre des possibilités fortes :
- Photos de fin de partie pour le debrief
- Comparaison "ta voiture au départ vs à l'arrivée"
- Question d'atelier : "qu'est-ce que tu as perdu ? qu'est-ce qui t'a permis d'arriver ?"

### Insight 3 — La feuille est le seul outil

Une seule feuille A3 sert à :
- Dessiner son véhicule (3 vues voxel)
- Designer un bloc map (grille avec symboles)

C'est une **économie de matériel** précieuse en atelier, et ça unifie le geste : tout passe par le coloriage de la même grille.

### Insight 4 — Le scan doit être pédagogique, pas magique

Le retour visuel pendant le scan (debug mode) n'est pas qu'un confort dev — c'est **une fenêtre sur le fonctionnement du dispositif** que le ou la participant·e peut comprendre. "Tu vois, là, ta case rouge a été lue comme orange parce qu'elle débordait." Le bug devient une occasion d'apprentissage sur la couleur, la lumière, la précision du geste.

### Insight 5 — La temporalité longue est un atout, pas une contrainte

Le pool de blocs cumulatif demande une infrastructure de stockage et un dispositif de modération éditoriale (qui valide les blocs créés ?). C'est un coût, mais c'est aussi **ce qui transforme le dispositif en projet long**, présentable en dossier DRAC ou en programme pluri-annuel.

---

## 7. Premières recommandations pour le produit

### Recommandation 1 — Architecture en pipeline modulaire

Découper strictement le code en modules indépendants avec contrats clairs entre eux :

```
[feuille photographiée]
    ↓
scan.js          → détecte 4 QR, redresse perspective
    ↓
segmenter.js     → découpe en 3 grilles (face / profil / dessus)
    ↓
color-reader.js  → lit la couleur dominante de chaque case (HSL)
    ↓
voxel-builder.js → reconstruit le volume 4×4×8 par union 2-sur-3
    ↓
vehicle-stats.js → calcule caractéristiques RVB + pouvoirs HSL
    ↓
game.js          → instancie le véhicule en jeu Three.js
```

Chaque module **renvoie un JSON** que le suivant consomme. Avantage : on peut tester chaque module indépendamment avec des fichiers JSON mockés.

### Recommandation 2 — Mode debug visuel obligatoire en V1

Avant même la première partie jouable, la chaîne de scan doit afficher à l'utilisateur :
1. La photo brute
2. Les 4 QR détectés en surimpression
3. L'image redressée
4. Les 3 grilles segmentées avec leur cadre coloré
5. Une vue case par case avec la couleur lue affichée par-dessus
6. Le véhicule 3D reconstruit en rotation libre

Ce mode debug **devient ensuite l'écran de validation pour le ou la participant·e** : "Voici ce que j'ai compris, on valide ?"

### Recommandation 3 — Stockage du véhicule en JSON, pas en mesh

Format proposé :
```json
{
  "id": "veh_abc123",
  "playerName": "Sami",
  "grid": [[[null, "red", "red", null], ...]],
  "stats": { "speed": 12, "grip": 5, "acceleration": 7 },
  "powers": { "aspiration": 3, "shield": 0, "heal": 2 }
}
```

Avantages : léger à transmettre via Socket.io, sérialisable, versionnable, rejouable.

### Recommandation 4 — Phasage de développement strict

**Phase 0 — Maquette papier** (1 semaine)
- Imprimer la feuille A3 avec les 3 grilles + 4 QR placeholder
- Faire colorier 3-5 personnes du Collectif sans instruction
- Observer ce qui se passe, ajuster la mise en page

**Phase 1 — Pipeline scan seul** (2-3 semaines)
- HTML/JS + OpenCV.js
- Affichage debug à chaque étape
- Aucune 3D, aucun jeu
- Sortie : JSON véhicule

**Phase 2 — Reconstruction 3D rotative** (1 semaine)
- Three.js, juste afficher le voxel en rotation libre
- "Le moment magique" — déjà jouable comme dispositif d'atelier autonome

**Phase 3 — Single player + map** (2-3 semaines)
- Conduite, physique simple type PAKO
- Un véhicule, une map de test fixe
- Ramassage des 4 symboles map (rampe, collant, dur, accélération)

**Phase 4 — Pouvoirs et perte de voxels** (2 semaines)
- Implémentation des 6 effets
- Perte de voxels par raycasting impact

**Phase 5 — Multijoueur + cohésion** (3-4 semaines)
- Socket.io, lobby, jauge de cohésion
- Tests à 2, puis 3, puis 5

**Phase 6 — Pool de blocs map cumulatif** (2 semaines)
- Stockage JSON serveur
- Création de blocs en fin d'atelier
- Tirage au sort dans le pool enrichi

### Recommandation 5 — Calibration matérielle de l'atelier

Pour fiabiliser le scan, fournir en atelier :
- Une seule marque/modèle de feutres avec les 6 couleurs cibles
- Un éclairage standard (lampe d'appoint si la salle est sombre)
- Un support fixe pour la feuille (pour éviter les flous de bougé)
- Une tablette ou un téléphone calibré (pas la caméra perso de chacun·e)

Le calibrage matériel n'est pas un échec d'ergonomie, c'est un **engagement esthétique** : c'est l'esthétique des feutres connus, comme dans les ateliers Mille Trois Cents existants.

---

## 8. Questions ouvertes à trancher en phase suivante (PRD)

- **Format du stockage des blocs map cumulatifs** : fichiers JSON locaux ? base SQLite ? service distant ? La réponse dépend de si Pop Vroum tourne en local atelier ou en ligne.
- **Modération des blocs créés** : tout bloc créé entre dans le pool ? Validation par l'animateur·trice ? Vote du groupe ?
- **Gestion de la triche / désynchronisation** : si on scale au-delà de 5 joueur·euses ou au-delà de l'atelier supervisé, comment garantir la cohérence de l'état partagé ?
- **Accessibilité des couleurs** : que se passe-t-il pour un·e participant·e daltonien·ne ? Faut-il un mode alternatif (symboles à la place des couleurs) ?
- **Persistance des véhicules entre sessions** : un·e participant·e qui revient à un atelier suivant retrouve-t-iel son véhicule ? Ou on repart de zéro à chaque fois ?
- **Export du véhicule** : possibilité de récupérer son voxel en .obj/.glb pour impression 3D, comme proposé dans la section Voxel-Scan initiale ?

---

## 9. Prochaines étapes B-MAD

→ **Phase 2 — Product Requirement Document (PRD)** : formaliser les fonctionnalités prioritaires (P0/P1/P2), les critères d'acceptation, le périmètre de la V1.

→ **Phase 3 — Architecture document** : choix techniques détaillés (lib OpenCV.js vs alternative, format de scène Three.js, schéma Socket.io, structure de données serveur).

→ **Phase 4 — Stories** : découpage en tâches atomiques codables une par une via session AI.

---

*Document de brainstorming — base de travail itérative, à enrichir au fil des sessions.*
