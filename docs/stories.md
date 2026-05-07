# Stories — Pop Vroum

**Projet** : Pop Vroum
**Porteur** : 1k3vrtical / Collectif Mille Trois Cents
**Version** : 0.1
**Date** : 28 avril 2026
**Méthodologie** : BMAD-METHOD — Phase 4 Stories
**Documents amont** : `brainstorming-session.md`, `prd.md` (v0.2), `architecture.md` (v0.1)

---

## Mode d'emploi

Chaque story est une **unité atomique codable en une session AI**. Format strict :

- **ID** : `PHASE.NUM` (ex : `1.3` = phase 1, story 3)
- **Titre** : court et orienté action
- **Dépendances** : stories qui doivent être faites avant
- **Contexte** : ce que la story fait dans la chaîne globale
- **Contrat I/O** : entrée et sortie JSON ou interface attendue
- **Fichiers** : à créer ou modifier
- **Critères d'acceptation** : conditions vérifiables
- **Notes pour l'IA** : pièges, conventions, librairies

**Conseil d'usage** : copier-coller la story dans le contexte de la session AI, plus les fichiers de config externalisés (`/config/*.json`) et les modules dont elle dépend.

---

## Phase 0 — Maquette papier

### Story 0.1 — Mise en page feuille véhicule A3

**Dépendances** : aucune
**Contexte** : Créer le fichier source de la feuille à imprimer pour le coloriage des véhicules. C'est le support physique de tout le pipeline.

**Spécifications** :
- Format A3 paysage (420 × 297 mm)
- Vue de face (4×4 cases) en bas-gauche
- Vue de profil (8×4 cases) à droite de la face
- Vue de dessus (8×4 cases) au-dessus de la face
- Schéma explicatif de la projection orthogonale en haut-gauche
- 4 QR codes aux coins (placeholders pour Story 0.2)
- Patch de référence couleur en bas (6 carrés colorés alignés)
- Légende des couleurs : effet de chaque couleur (caractéristique + pouvoir)
- Cases ≥ 1.5 cm de côté

**Fichiers** :
- `/public/assets/sheets/feuille-vehicule-A3.svg` (source éditable)
- `/public/assets/sheets/feuille-vehicule-A3.pdf` (imprimable)

**Critères d'acceptation** :
- [ ] PDF imprimable en A3 sans déformation
- [ ] Cases mesurables au mm près sur l'impression
- [ ] Schéma de projection clair pour un public non-technique
- [ ] Patch couleur visible et utilisable comme référence

**Notes pour l'IA** : utiliser Inkscape ou un outil SVG pour le source. Penser à la dimension d'impression réelle (ne pas faire un SVG de 800px×600px). Le format SVG permettra plus tard d'éditer la légende.

---

### Story 0.2 — Génération des 4 QR codes stylisés

**Dépendances** : 0.1
**Contexte** : Les QR codes servent au calage de perspective lors du scan. Ils doivent être stylisés pour cohérence avec AR-claude-atelier et Scale.

**Spécifications** :
- 4 QR codes uniques contenant des valeurs distinctes (ex: `popvroum-tl`, `popvroum-tr`, `popvroum-bl`, `popvroum-br`)
- Style graphique cohérent avec les autres projets phygitaux de l'auteur
- Taille ~2 cm de côté
- Lisibles à une distance de 30-60 cm via webcam standard
- Intégrés dans les 4 coins du SVG de la feuille

**Fichiers** :
- `/public/assets/sheets/qr-codes/` (4 PNG)
- Mise à jour de `feuille-vehicule-A3.svg`

**Critères d'acceptation** :
- [ ] Les 4 QR sont détectés par jsQR sur une photo prise au téléphone
- [ ] Le contenu de chaque QR identifie son coin (TL/TR/BL/BR)
- [ ] Style graphique compatible avec l'esthétique des autres projets

**Notes pour l'IA** : utiliser une bibliothèque comme `qrcode` (npm) avec niveau de correction H pour robustesse. Pour la stylisation, tu peux jouer sur la couleur des modules (sombre cohérent avec la charte) sans casser la lisibilité.

---

### Story 0.3 — Mise en page feuille bloc map A3

**Dépendances** : 0.2
**Contexte** : Feuille collective dessinée par le groupe pendant la phase 7. Format différent : grille 2D plate avec symboles à dessiner.

**Spécifications** :
- Format A3 paysage minimum (envisager A2 si possible en atelier)
- Grille 8×8 vue de dessus, cases ≥ 3 cm pour permettre dessin à plusieurs
- 4 QR codes aux coins (différents de ceux de la feuille véhicule pour permettre détection du type — Story 1.10)
- Légende imprimée des 4 symboles : rampe, collant, dur, accélération, avec illustration de chaque comportement
- Zone de signature pour nom du groupe / atelier d'origine

**Fichiers** :
- `/public/assets/sheets/feuille-bloc-A3.svg`
- `/public/assets/sheets/feuille-bloc-A3.pdf`

**Critères d'acceptation** :
- [ ] PDF imprimable A3 (ou A2)
- [ ] Cases assez grandes pour permettre 2-3 mains autour
- [ ] Légende des symboles claire et reproductible (les participant·es doivent pouvoir dessiner les symboles à main levée)

**Notes pour l'IA** : les symboles doivent être visuellement très distincts pour faciliter le template matching plus tard. Proposition : rampe = flèche montante, collant = points/hachures, dur = rectangle plein, accélération = double flèche.

---

### Story 0.4 — Test papier en atelier interne

**Dépendances** : 0.1, 0.2, 0.3
**Contexte** : Validation matérielle avant tout développement code. Permet d'ajuster la mise en page avant d'écrire le pipeline.

**Spécifications** :
- Imprimer 5 feuilles véhicule + 1 feuille bloc
- Faire colorier 3-5 personnes du Collectif sans instruction préalable
- Observer : compréhension du schéma de projection, lisibilité des cases, respect des couleurs/symboles
- Documenter les retours

**Fichiers** :
- `/docs/test-papier-2026-XX-XX.md` (notes d'observation)

**Critères d'acceptation** :
- [ ] 3-5 feuilles véhicule colorées par des testeur·euses
- [ ] 1 feuille bloc dessinée collectivement
- [ ] Notes d'observation documentées
- [ ] Mise en page ajustée si nécessaire dans 0.1 et 0.3

**Notes pour l'IA** : cette story n'est pas codable, elle est listée pour mémoire dans le flux BMAD. Le développeur fait ce test physiquement.

---

## Phase 1 — Pipeline scan véhicule

### Story 1.1 — Setup projet + structure de fichiers

**Dépendances** : aucune (peut démarrer en parallèle de Phase 0)
**Contexte** : Mettre en place l'arborescence du projet conforme à l'architecture définie.

**Spécifications** :
- Initialiser `package.json` avec dépendances : `express`, `socket.io`
- Créer la structure de dossiers complète selon `architecture.md` section 2
- Créer `server.js` minimal qui sert `/public` en statique et écoute sur le port 3000
- Créer les fichiers de config vides (`/config/gameplay.json`, `/config/scan.json`, `/config/layout.json`) avec les valeurs proposées dans `architecture.md` section 6
- `.gitignore` pour `node_modules`, fichiers temporaires
- README.md mis à jour pour refléter Pop Vroum (et non plus Scan & Race)

**Fichiers** :
- `/package.json`
- `/server.js`
- `/.gitignore`
- `/README.md`
- Structure de dossiers complète vide
- `/config/gameplay.json`, `/config/scan.json`, `/config/layout.json`

**Critères d'acceptation** :
- [ ] `npm install` fonctionne sans erreur
- [ ] `node server.js` démarre le serveur sur le port 3000
- [ ] La page `/index.html` (vide pour l'instant) est accessible
- [ ] La structure de dossiers est conforme à l'architecture
- [ ] Les configs JSON sont chargées sans erreur de parsing

**Notes pour l'IA** : utiliser ES modules (`"type": "module"` dans package.json). Pas de bundler. Les libs externes (OpenCV.js, jsQR, Three.js) seront ajoutées en Story suivante dans `/public/js/lib/`.

---

### Story 1.2 — Intégration des libs externes

**Dépendances** : 1.1
**Contexte** : Télécharger et intégrer les bibliothèques tierces dans `/public/js/lib/`. Pas de CDN pour fonctionner offline en atelier.

**Spécifications** :
- OpenCV.js 4.x (~10 Mo)
- jsQR 1.4
- Three.js r150+ (build minifié)
- Vérifier la licence de chaque lib et inclure les LICENSE files

**Fichiers** :
- `/public/js/lib/opencv.js`
- `/public/js/lib/jsqr.js`
- `/public/js/lib/three.module.js`
- `/public/js/lib/LICENSES/`

**Critères d'acceptation** :
- [ ] Les libs se chargent sans erreur dans le navigateur
- [ ] Page de test simple `/public/test-libs.html` qui importe les 3 libs et affiche en console les versions
- [ ] Fonctionne offline (aucun appel CDN)

**Notes pour l'IA** : OpenCV.js est lourd et asynchrone à charger. Prévoir un wrapper de promesse pour `cv` global. Three.js peut être importé en module ES, OpenCV et jsQR plus probablement en script global.

---

### Story 1.3 — Module capture caméra

**Dépendances** : 1.2
**Contexte** : Premier module du pipeline scan. Récupère un flux vidéo de la caméra du device.

**Contrat I/O** :
- Entrée : aucune (consomme l'API navigateur)
- Sortie : `() => Promise<ImageData>` — fonction qui retourne une frame ImageData à la demande

**Spécifications** :
- Demande l'autorisation caméra (mobile-first, contrainte vidéo paysage)
- Affiche le flux vidéo dans un `<video>` caché
- Expose une fonction `captureFrame()` qui copie le frame courant dans un canvas et retourne l'ImageData
- Gère les erreurs (caméra refusée, indisponible) avec messages utilisateur

**Fichiers** :
- `/public/js/modules/scan/capture.js`
- `/public/scan.html` (HTML minimal pour tester)
- `/public/js/pages/scan-page.js` (entrée minimale)

**Critères d'acceptation** :
- [ ] La caméra démarre sur tablette/téléphone
- [ ] `captureFrame()` retourne un ImageData valide (largeur > 0, hauteur > 0, pixels non vides)
- [ ] Erreur affichée clairement si caméra refusée
- [ ] Mode debug : un bouton "Capture" affiche la frame capturée

**Notes pour l'IA** : utiliser `getUserMedia({ video: { facingMode: 'environment', ... } })`. Sur tablette, la caméra arrière est préférable. Pas de stockage des images.

---

### Story 1.4 — Module détection des 4 QR codes

**Dépendances** : 1.3
**Contexte** : Localise les 4 marqueurs aux coins de la feuille pour permettre le redressement de perspective.

**Contrat I/O** :
- Entrée : `ImageData`
- Sortie : `{ tl: {x, y}, tr: {x, y}, bl: {x, y}, br: {x, y} } | null` (null si moins de 4 détectés)

**Spécifications** :
- Utilise jsQR pour détecter les QR
- Identifie quel QR correspond à quel coin (via le contenu : `popvroum-tl`, etc.)
- Retourne les coordonnées des centres ou des coins externes des QR
- Si moins de 4 QR détectés, retourne `null` avec un événement debug listant ceux trouvés

**Fichiers** :
- `/public/js/modules/scan/qr-detect.js`

**Critères d'acceptation** :
- [ ] Détecte les 4 QR sur une photo de feuille bien cadrée
- [ ] Retourne null si la feuille est partiellement hors cadre
- [ ] Identifie correctement chaque coin par contenu QR
- [ ] Mode debug : superpose les détections sur l'image source

**Notes pour l'IA** : jsQR ne détecte qu'**un seul QR par image**. Il faut donc faire plusieurs passes en masquant chaque QR détecté avant la suivante, ou découper l'image en 4 quadrants et chercher 1 QR par quadrant (plus rapide et plus robuste pour notre use case où on connaît la disposition).

---

### Story 1.5 — Module redressement de perspective

**Dépendances** : 1.4
**Contexte** : Transforme la feuille photographiée en angle en une vue plate "scan de bureau".

**Contrat I/O** :
- Entrée : `ImageData`, `{ tl, tr, bl, br }`
- Sortie : `ImageData` redressée (taille fixe d'après `layout.json`)

**Spécifications** :
- Utilise OpenCV.js `cv.getPerspectiveTransform` + `cv.warpPerspective`
- Taille de sortie définie dans `layout.json` (`vehicleSheet.width` × `vehicleSheet.height`)
- Préserve les proportions

**Fichiers** :
- `/public/js/modules/scan/perspective.js`

**Critères d'acceptation** :
- [ ] L'image redressée est rectangulaire et droite
- [ ] Les 4 coins de la feuille sont aux 4 coins de l'image de sortie
- [ ] Aucune déformation visible
- [ ] Mode debug : affiche l'image redressée

**Notes pour l'IA** : OpenCV.js requiert une initialisation asynchrone (`onRuntimeInitialized`). Wrapper toutes les opérations dans une promesse `cvReady`. Penser à libérer les `Mat` après usage avec `.delete()` pour éviter les fuites mémoire.

---

### Story 1.6 — Module segmentation en grilles

**Dépendances** : 1.5
**Contexte** : Découpe l'image redressée en zones distinctes (3 grilles + patch).

**Contrat I/O** :
- Entrée : `ImageData` redressée
- Sortie : `{ face: ImageData, profile: ImageData, top: ImageData, patch: ImageData }`

**Spécifications** :
- Coordonnées lues dans `layout.json` (`vehicleSheet.regions`)
- Découpe via `ctx.getImageData(x, y, w, h)` ou OpenCV ROI
- Aucune décision de couleur à ce stade, juste découpe

**Fichiers** :
- `/public/js/modules/scan/segmenter.js`

**Critères d'acceptation** :
- [ ] Les 4 zones sont extraites avec les bonnes dimensions
- [ ] Les zones correspondent visuellement aux 3 grilles + patch de la feuille source
- [ ] Mode debug : affiche les 4 zones côte-à-côte

**Notes pour l'IA** : la qualité du découpage dépend entièrement de la précision du redressement (Story 1.5). Si la segmentation paraît décalée, c'est probablement le redressement qui est imprécis.

---

### Story 1.7 — Module calibration via patch

**Dépendances** : 1.6
**Contexte** : Lit les 6 carrés du patch de référence pour ajuster la classification HSL aux conditions réelles d'éclairage et de feutre.

**Contrat I/O** :
- Entrée : `ImageData` du patch
- Sortie : `{ red: {h, s, l}, green: ..., blue: ..., orange: ..., violet: ..., pink: ... }`

**Spécifications** :
- Découpe le patch en 6 zones égales (1×6)
- Pour chaque zone, calcul de la couleur HSL médiane (médiane sur les pixels centraux pour éviter les bords)
- Retourne un objet avec les 6 couleurs cibles ajustées
- Si une couleur n'est pas détectable (zone vide), fallback sur les valeurs de `scan.json`

**Fichiers** :
- `/public/js/modules/scan/calibration.js`

**Critères d'acceptation** :
- [ ] Les 6 valeurs HSL retournées sont distinctes les unes des autres
- [ ] Sur une photo de patch standard, les valeurs sont proches des cibles théoriques de `scan.json`
- [ ] Sur une photo en lumière chaude (lampe halogène), les valeurs sont décalées en conséquence
- [ ] Mode debug : affiche les 6 valeurs HSL et les compare aux cibles théoriques

**Notes pour l'IA** : utiliser une fonction `rgbToHsl` standard. Conventions : H en degrés [0-360], S et L en [0-1]. Pour la médiane, échantillonner par exemple les 60% centraux de chaque carré du patch.

---

### Story 1.8 — Module lecture couleur par case

**Dépendances** : 1.7
**Contexte** : Pour chaque case d'une grille, détermine si elle est coloriée et avec quelle couleur cible.

**Contrat I/O** :
- Entrée : `ImageData` d'une grille, `{ cols, rows }`, cibles HSL calibrées
- Sortie : `Array<Array<string|null>>` (grille 2D, valeurs : `'red'`, `'green'`, ..., ou `null`)

**Spécifications** :
- Subdivise l'image en `cols × rows` cases
- Pour chaque case, lit la couleur HSL médiane des pixels **centraux** (60% au centre, ignore les bords pour tolérer les débordements de feutre)
- Compare au seuil minimum de saturation (`scan.json.minSaturation`) → si en dessous, case = `null`
- Sinon, calcule la distance HSL pondérée vers chaque cible et retourne la plus proche, si elle est sous la tolérance

**Fichiers** :
- `/public/js/modules/scan/color-reader.js`

**Critères d'acceptation** :
- [ ] Une case blanche (non coloriée) renvoie `null`
- [ ] Une case rouge renvoie `'red'`
- [ ] Une case avec un débordement léger sur les bords renvoie quand même la bonne couleur
- [ ] Mode debug : affiche la grille avec la couleur lue par-dessus chaque case

**Notes pour l'IA** : la distance HSL pondérée doit accorder plus de poids à la teinte (H) qu'à la saturation et la luminosité. Formule proposée : `d = 4*dH + dS + dL`. Pour H, attention au wrap (358° et 2° sont proches).

---

### Story 1.9 — Slider HUE/SAT manuel (debug)

**Dépendances** : 1.8
**Contexte** : Permet à l'utilisateur d'ajuster manuellement la classification couleur si la calibration auto échoue. Outil de vulgarisation du daltonisme.

**Spécifications** :
- Interface utilisateur en mode debug : 6 sliders (un par couleur) avec H, S, L ajustables
- Les valeurs sont initialisées à celles retournées par la calibration auto
- Un changement met à jour la grille de couleurs lues en temps réel
- Bouton "Réinitialiser à la calibration auto"

**Fichiers** :
- `/public/js/modules/scan/manual-hsl-tuner.js`
- Modifications dans `/public/scan.html` et `/public/js/pages/scan-page.js`

**Critères d'acceptation** :
- [ ] Les sliders sont accessibles depuis le mode debug
- [ ] Le déplacement d'un slider met à jour la lecture en moins de 200 ms
- [ ] Un toggle "afficher/masquer" permet de rendre l'outil discret en usage normal
- [ ] Cohérent avec l'esthétique générale du dispositif

**Notes pour l'IA** : penser à exposer cet outil de manière à ce qu'il puisse servir de **support de discussion en atelier** sur la perception des couleurs (vulgarisation du daltonisme). Pas un menu caché.

---

### Story 1.10 — Détection du type de feuille

**Dépendances** : 1.4
**Contexte** : Le scanner doit savoir si la feuille présentée est de type véhicule (3 grilles) ou bloc (1 grille avec symboles).

**Spécifications** :
- Au moment de la détection des QR (Story 1.4), examiner le contenu des QR pour identifier le type
- Convention : QR véhicule = `popvroum-vehicle-tl`, etc. ; QR bloc = `popvroum-block-tl`, etc.
- Retourne le type détecté avec les coordonnées
- Le pipeline aval (segmentation, lecture) s'adapte au type

**Fichiers** :
- Modifications dans `/public/js/modules/scan/qr-detect.js`

**Critères d'acceptation** :
- [ ] Le type de feuille est correctement détecté
- [ ] Si les QR mélangent les types (cas anormal), erreur claire
- [ ] Le scanner bascule automatiquement entre pipeline véhicule et pipeline bloc

**Notes pour l'IA** : il faudra que les Stories 0.2 et 0.3 utilisent les bons contenus dans les QR. Mettre à jour ces stories en conséquence.

---

### Story 1.11 — Mode debug visuel complet

**Dépendances** : 1.3 à 1.8
**Contexte** : Affichage en mosaïque du pipeline complet pour diagnostic et vulgarisation.

**Spécifications** :
- Page `scan.html` propose un mode "Debug" activable
- Affiche en grille 2×4 :
  1. Photo brute (avec QR détectés en surimpression)
  2. Image redressée
  3. Patch couleur lu + cibles HSL
  4. Vue de face segmentée + couleurs lues
  5. Vue de profil idem
  6. Vue de dessus idem
  7. (Story 2.x) Voxel reconstruit
  8. (Story 2.x) Validation
- Mise à jour en temps réel sur chaque nouvelle frame capturée

**Fichiers** :
- `/public/js/modules/scan/debug-view.js`
- Mise à jour de `/public/scan.html`, `/public/css/scan.css`, `/public/js/pages/scan-page.js`

**Critères d'acceptation** :
- [ ] Mode debug toggle-able depuis l'UI
- [ ] Les 6 (puis 8) panneaux s'affichent et se mettent à jour
- [ ] Lisible sur tablette en orientation paysage

**Notes pour l'IA** : ce mode est ce qui rendra le projet débuggable, en atelier comme en dev. Investir dans la lisibilité.

---

## Phase 2 — Reconstruction 3D + roues

### Story 2.1 — Module voxel/builder

**Dépendances** : 1.8
**Contexte** : Reconstruit le volume voxel 4×4×8 par union 2-sur-3 à partir des 3 grilles lues.

**Contrat I/O** :
- Entrée : `{ face: 4×4 grid, profile: 8×4 grid, top: 8×4 grid }`
- Sortie : `grid: 4×4×8` array, chaque case = `{ color: string } | null`

**Spécifications** :
- Convention de coordonnées (à fixer dans le code) : `grid[x][z][y]` avec :
  - x ∈ [0, 7] = avant-arrière (longueur)
  - z ∈ [0, 3] = gauche-droite (largeur)
  - y ∈ [0, 3] = bas-haut (hauteur)
- Pour chaque voxel (x, z, y), regarder les 3 vues :
  - Face (vue x=avant) : la case (z, y) est-elle coloriée ?
  - Profil (vue z=côté) : la case (x, y) est-elle coloriée ?
  - Dessus (vue y=haut) : la case (x, z) est-elle coloriée ?
- Si au moins 2 vues confirment, le voxel existe
- Sa couleur est la couleur majoritaire entre les vues confirmantes (en cas d'égalité, prendre la face)

**Fichiers** :
- `/public/js/modules/voxel/builder.js`

**Critères d'acceptation** :
- [ ] Une grille avec 3 vues entièrement coloriées en rouge produit 4×4×8 = 128 voxels rouges
- [ ] Une grille avec une seule vue coloriée produit 0 voxel
- [ ] Une grille avec 2 vues sur 3 coloriées produit le bon volume d'intersection
- [ ] Mode debug : visualisation 3D rotative du volume produit

**Notes pour l'IA** : documenter clairement la convention de coordonnées dans le module. Un bug d'orientation peut être très long à débugger plus tard.

---

### Story 2.2 — Module voxel/wheel-detector

**Dépendances** : 2.1
**Contexte** : Détecte automatiquement les positions des 4 roues à partir des vues de profil et de dessus.

**Contrat I/O** :
- Entrée : `{ profileGrid: 8×4 array, topGrid: 8×4 array }`
- Sortie : `Array<{ x, y, z }>` 4 positions de roues

**Spécifications** :
- Voir pseudo-code dans `architecture.md` section 3
- Vue de profil détermine x_avant et x_arrière (rangée du bas, fallback : extrémités)
- Vue de dessus détermine, pour chaque x, z_min et z_max (largeur)
- 4 roues placées : (x_arr, -0.3, z_arr_min), (x_arr, -0.3, z_arr_max), (x_av, -0.3, z_av_min), (x_av, -0.3, z_av_max)

**Fichiers** :
- `/public/js/modules/voxel/wheel-detector.js`

**Critères d'acceptation** :
- [ ] Sur un véhicule "rectangulaire classique", les 4 roues sont aux 4 coins
- [ ] Sur un véhicule "fusée" (étroit devant, large derrière), les roues s'écartent à l'arrière
- [ ] Sur un véhicule sans rangée du bas coloriée, les roues vont aux 4 extrémités du volume

**Notes pour l'IA** : tester avec différentes formes pour vérifier la robustesse. Documenter les fallbacks clairement.

---

### Story 2.3 — Module voxel/stats

**Dépendances** : 2.1
**Contexte** : Calcule les caractéristiques RVB et les pouvoirs HSL à partir du décompte de voxels par couleur.

**Contrat I/O** :
- Entrée : `grid: 4×4×8` (sortie de builder.js)
- Sortie : `{ stats: { speed, grip, accel }, powers: { aspiration, shield, attraction, heal } }`

**Spécifications** :
- Compte des voxels par couleur
- Formule linéaire avec valeurs externalisées dans `gameplay.json` :
  - `speed = baseSpeed + (count.red × speedPerRedVoxel)`
  - `grip = baseGrip + (count.green × gripPerGreenVoxel)`
  - `accel = baseAccel + (count.blue × accelPerBlueVoxel)`
  - `aspiration = count.red × ...` (via gameplay.json)
  - etc.
- Tous les paramètres lus dans `gameplay.json`

**Fichiers** :
- `/public/js/modules/voxel/stats.js`

**Critères d'acceptation** :
- [ ] Un véhicule 100% rouge a une vitesse maximale et 0 grip/accel
- [ ] Un véhicule mixte produit des valeurs cohérentes
- [ ] Modifier `gameplay.json` change le résultat sans recompilation

---

### Story 2.4 — Module voxel/renderer

**Dépendances** : 2.2, 2.3
**Contexte** : Rend le véhicule en 3D dans Three.js avec voxels colorés et 4 roues.

**Contrat I/O** :
- Entrée : véhicule JSON complet (grid + wheelPositions + stats + powers)
- Sortie : `THREE.Group` contenant les meshes voxels et roues

**Spécifications** :
- Pour chaque voxel non-null : `THREE.BoxGeometry(1, 1, 1)` à la position (x, y, z), couleur du matériau = couleur du voxel
- Roues : cylindres aplatis (`CylinderGeometry`) en gris foncé, légèrement saillants
- Possibilité d'instanciation pour optimiser à grande échelle (V1.x si nécessaire)
- Origine du groupe au centre du véhicule

**Fichiers** :
- `/public/js/modules/voxel/renderer.js`

**Critères d'acceptation** :
- [ ] Le véhicule s'affiche en 3D rotatif dans un canvas Three.js
- [ ] Les roues sont visibles et bien placées
- [ ] Les couleurs voxels sont fidèles aux couleurs scannées
- [ ] Performance : ≥ 60 fps même sur tablette d'entrée de gamme

**Notes pour l'IA** : utiliser `MeshLambertMaterial` ou `MeshStandardMaterial` selon les besoins d'éclairage. Couleur exacte du voxel : utiliser un mapping `color name → hex` cohérent avec les cibles HSL de `scan.json` mais traduit en RGB pour le rendu.

---

### Story 2.5 — Écran de validation post-scan

**Dépendances** : 2.4
**Contexte** : Après le scan, l'utilisateur voit son véhicule reconstruit et peut valider ou re-scanner.

**Spécifications** :
- Après scan réussi, affichage plein écran du véhicule en rotation libre
- Récap stats (vitesse, adhérence, accélération) et pouvoirs (4 jauges)
- Bouton "Valider" → sauvegarde dans localStorage et redirige vers lobby
- Bouton "Re-scanner" → retour au mode scan
- Champ pseudo (préchargé depuis localStorage si existant)

**Fichiers** :
- `/public/js/pages/scan-page.js` (extension)
- `/public/scan.html` (extension)
- `/public/css/scan.css`

**Critères d'acceptation** :
- [ ] Le véhicule tourne en libre rotation (touch/souris) ou auto-rotation
- [ ] Stats et pouvoirs lisibles
- [ ] Validation sauvegarde en localStorage avec ID unique
- [ ] Pseudo persisté entre sessions

**Notes pour l'IA** : c'est le **moment magique** de l'atelier. Soigner la transition (fondu, son si dispo, animation d'apparition). Le ou la participant·e doit être impressionné·e.

---

## Phase 3 — Single player + map test

### Story 3.1 — Module game/controls

**Dépendances** : 2.5
**Contexte** : Pilotage du véhicule via inputs tactiles (PAKO-style) et clavier.

**Contrat I/O** :
- Entrée : événements DOM
- Sortie : objet réactif `{ steering: -1..1, braking: 0..1 }`

**Spécifications** :
- **Tactile** :
  - Tap maintenu bord droit (1/3 droit de l'écran) → `steering = +1`
  - Tap maintenu bord gauche → `steering = -1`
  - Tap maintenu centre bas → `braking = 1`
  - Pas de tap → `steering = 0`, `braking = 0`
- **Clavier** : Flèche droite ou D → `steering = +1`, gauche ou A → `-1`, bas ou S → `braking = 1`
- État exposé via `getInputs()`

**Fichiers** :
- `/public/js/modules/game/controls.js`

**Critères d'acceptation** :
- [ ] Inputs tactiles réactifs sur tablette
- [ ] Inputs clavier fonctionnels sur desktop
- [ ] Pas de conflit avec d'autres événements DOM (zoom, scroll)

**Notes pour l'IA** : prévenir le pinch-zoom et le scroll par défaut sur la zone de jeu (`touch-action: none`). Penser au multi-touch (tap droit + centre = freiner et tourner).

---

### Story 3.2 — Module game/physics

**Dépendances** : 3.1
**Contexte** : Logique de mouvement du véhicule en auto-avance.

**Contrat I/O** :
- Entrée : véhicule (stats), inputs, deltaTime
- Sortie : nouvelle position et rotation

**Spécifications** :
- Auto-avance constante à `currentSpeed`
- `currentSpeed` augmente avec `accel` jusqu'à `maxSpeed`, freiné par `braking` ou par dérapage
- Rotation : `angularVelocity = steering × turnRate × (grip)`
- Dérapage : si `|angularVelocity|` dépasse un seuil dépendant de `grip`, la voiture glisse latéralement avec frottement réduit
- Inertie réaliste mais légère (PAKO-like)

**Fichiers** :
- `/public/js/modules/game/physics.js`

**Critères d'acceptation** :
- [ ] La voiture avance toute seule
- [ ] Les virages sont serrés ou larges selon le grip
- [ ] Le freinage est sensible
- [ ] Le dérapage est visible mais maîtrisable

**Notes pour l'IA** : pas de moteur physique externe (Cannon.js, Ammo.js). Logique custom simple suffit. Tout en JS pur. Penser aux unités : distance en "voxels" (1 unit = 1 voxel), temps en secondes.

---

### Story 3.3 — Module game/camera

**Dépendances** : 3.2
**Contexte** : Caméra orthographique top-down qui suit le groupe.

**Contrat I/O** :
- Entrée : positions des véhicules, dimensions du canvas
- Sortie : caméra Three.js mise à jour à chaque frame

**Spécifications** :
- Caméra orthographique (ou très légère perspective avec FOV étroit pour donner un soupçon d'isométrie)
- Cible = barycentre des véhicules
- Zoom adaptatif : ajusté pour que tous les véhicules tiennent dans le frustum avec un padding
- Lissage (lerp) du mouvement de caméra

**Fichiers** :
- `/public/js/modules/game/camera.js`

**Critères d'acceptation** :
- [ ] Caméra suit le groupe sans à-coups
- [ ] Zoom out quand le groupe se disperse, zoom in quand il se regroupe
- [ ] Clamp du zoom max pour éviter de tout réduire à des points

**Notes pour l'IA** : utiliser `OrthographicCamera` avec `left/right/top/bottom` calculés selon le bounding box des véhicules. Lerp avec un facteur ~0.05 pour un mouvement doux.

---

### Story 3.4 — Module game/skid (skid marks)

**Dépendances** : 3.2
**Contexte** : Game feel juicy : traces de pneu visibles au sol lors des virages serrés.

**Spécifications** :
- À chaque frame, si `velocity > seuil ET |angularVelocity| > seuil`, instancier 2 quads (un par roue arrière) au sol à la position des roues
- Quads texturés (texture noire avec alpha gradient)
- Durée de vie 5 secondes, fade out via shader ou material transparent
- Pool de 200 quads recyclés

**Fichiers** :
- `/public/js/modules/game/skid.js`
- Texture : `/public/assets/textures/skid.png`

**Critères d'acceptation** :
- [ ] Skid marks apparaissent en virage serré
- [ ] Disparaissent après 5 sec sans saccade
- [ ] Pas de drop de framerate même après 1 minute de drift continu

---

### Story 3.5 — Map de test fixe

**Dépendances** : 3.3
**Contexte** : Avant le pool de blocs, créer une map fixe pour développer le gameplay.

**Spécifications** :
- Map de test simple : couloir avec quelques obstacles, point de départ et zone d'arrivée
- Chargement depuis un JSON statique
- Pas de tirage au sort

**Fichiers** :
- `/data/test-maps/corridor.json`
- `/public/js/modules/game/map-loader.js`

**Critères d'acceptation** :
- [ ] La map se charge au début du jeu
- [ ] Le véhicule peut naviguer du départ à l'arrivée

---

### Story 3.6 — Module game/map-generator

**Dépendances** : 3.5
**Contexte** : Génère la map procédurale à partir du pool de blocs (V1 = blocs seed).

**Contrat I/O** :
- Entrée : pool de blocs, nombre de joueurs
- Sortie : carte assemblée (liste de blocs avec positions)

**Spécifications** :
- Tirage aléatoire de blocs
- Vérification de jouabilité simple : chaque bloc doit avoir au moins une case d'entrée et de sortie
- Longueur de la map proportionnelle au nombre de joueurs (`gameplay.json`)

**Fichiers** :
- `/public/js/modules/game/map-generator.js`

**Critères d'acceptation** :
- [ ] Une map est générée différente à chaque appel
- [ ] Toujours un chemin du départ à l'arrivée
- [ ] Plus de joueurs → map plus longue

---

## Phase 4 — Pouvoirs et perte de voxels

### Story 4.1 — Module game/powers (rouge/vert/bleu/orange)

**Dépendances** : 3.6
**Contexte** : Implémente les 4 pouvoirs P0.

**Spécifications** :
- **Rouge — aspiration** : triangle attaché au véhicule (mesh ou shader), taille proportionnelle au pouvoir, détecte les véhicules à l'intérieur, applique un boost
- **Vert — phares** : cône lumineux avant, détection des véhicules éclairés, augmentation de leur grip
- **Bleu — sillage** : trail au sol persistant, détection de véhicules qui le traversent, boost d'accélération
- **Orange — bouclier** : mesh avant, absorbe les collisions

Tout est paramétré par `gameplay.json`.

**Fichiers** :
- `/public/js/modules/game/powers.js`

**Critères d'acceptation** :
- [ ] Les 4 pouvoirs sont visibles
- [ ] Les effets gameplay s'appliquent correctement
- [ ] Les valeurs sont externalisées

---

### Story 4.2 — Module game/impact

**Dépendances** : 3.6
**Contexte** : Détection des collisions et perte de voxels.

**Spécifications** :
- Détection collision véhicule ↔ obstacle (bloc dur)
- Au point d'impact, raycasting depuis l'extérieur du véhicule pour identifier les voxels exposés
- Retire les N voxels les plus exposés (N proportionnel à la vitesse de collision)
- Met à jour stats et pouvoirs en conséquence
- Émet un événement `voxelLost` avec la liste des voxels perdus

**Fichiers** :
- `/public/js/modules/game/impact.js`

**Critères d'acceptation** :
- [ ] Une collision frontale retire des voxels avant
- [ ] Une collision latérale retire des voxels du côté concerné
- [ ] Les stats baissent en conséquence

---

### Story 4.3 — Module game/particles

**Dépendances** : 4.2
**Contexte** : Particules juicy quand un voxel se détache.

**Spécifications** :
- À chaque événement `voxelLost`, instancier 1 mini-cube voxel libre (couleur du voxel perdu)
- Vélocité initiale aléatoire vers le haut + impulsion latérale
- Gravité applicable
- Disparition au sol après 3 sec ou reste visible (Story 5.x)

**Fichiers** :
- `/public/js/modules/game/particles.js`

**Critères d'acceptation** :
- [ ] Les voxels perdus s'envolent visuellement
- [ ] Pas de drop de framerate

---

## Phase 5 — Multijoueur + cohésion

### Story 5.1 — Setup Socket.io serveur

**Dépendances** : Phase 4 complète
**Contexte** : Backend autoritaire pour la synchronisation à 5 joueurs.

**Spécifications** :
- `server.js` : création du serveur Socket.io
- Gestion des rooms (1 room par lobby/match)
- Événements : `lobby:join`, `lobby:leave`, `lobby:ready`, `lobby:start`, `game:input`, `game:state`, `game:event`, `game:end`
- État autoritaire : positions, collisions, voxels perdus, cohésion calculés serveur

**Fichiers** :
- `/server.js` (extension)
- `/server/lobby-manager.js`
- `/server/game-loop.js`

**Critères d'acceptation** :
- [ ] 2 clients peuvent se connecter au même lobby
- [ ] Le lobby se ferme à 5 joueurs
- [ ] Le serveur calcule l'état à 30 Hz et le broadcast

---

### Story 5.2 — Module network/client

**Dépendances** : 5.1
**Contexte** : Wrapper Socket.io côté client.

**Spécifications** :
- Connexion auto au démarrage
- API : `joinLobby(vehicle)`, `sendInput(inputs)`, `onState(callback)`, `onEvent(callback)`, etc.
- Gestion de la reconnexion

**Fichiers** :
- `/public/js/modules/network/client.js`

**Critères d'acceptation** :
- [ ] Connexion fiable au serveur local
- [ ] Réception et envoi des événements

---

### Story 5.3 — Module network/lobby

**Dépendances** : 5.2
**Contexte** : Logique du lobby pré-partie.

**Spécifications** :
- Page `lobby.html` : affichage des véhicules connectés en 3D
- Bouton "Prêt" pour chaque joueur
- Lancement automatique quand tous prêts
- Pseudo affiché sous chaque véhicule

**Fichiers** :
- `/public/lobby.html`
- `/public/js/pages/lobby-page.js`
- `/public/js/modules/network/lobby.js`

**Critères d'acceptation** :
- [ ] Les véhicules apparaissent dans le lobby au fur et à mesure
- [ ] La partie se lance quand tous sont prêts
- [ ] Tous les clients reçoivent le signal de démarrage

---

### Story 5.4 — Synchronisation des états

**Dépendances** : 5.3
**Contexte** : Réplication temps réel des positions et états des véhicules.

**Spécifications** :
- Client : envoi des inputs à 30 Hz
- Serveur : calcule l'état complet et le broadcast à 30 Hz
- Client : applique l'état reçu (avec ou sans interpolation)

**Fichiers** :
- `/public/js/modules/network/sync.js`
- Extensions de `/server/game-loop.js`

**Critères d'acceptation** :
- [ ] Les véhicules des autres joueurs apparaissent et bougent
- [ ] Latence < 200 ms perçue sur réseau local

---

### Story 5.5 — Module game/cohesion

**Dépendances** : 5.4
**Contexte** : Jauge de cohésion et bonus de groupe.

**Spécifications** :
- Calcul serveur : cohésion = 1 - (dispersion_max / radius_seuil)
- Si cohésion >= 0.8, bonus actif (vitesse, ou autre selon playtest)
- Affichage client : jauge en haut de l'écran, change de couleur si pleine

**Fichiers** :
- `/server/cohesion.js`
- `/public/js/modules/game/cohesion-display.js`

**Critères d'acceptation** :
- [ ] Jauge change quand le groupe se rapproche/disperse
- [ ] Bonus appliqué quand cohésion pleine

---

### Story 5.6 — Module game/offscreen

**Dépendances** : 5.4
**Contexte** : Indicateurs hors-écran pour les coéquipier·ères.

**Spécifications** :
- Pour chaque joueur hors du frustum, dessin d'une flèche au bord de l'écran
- Couleur de la flèche = couleur dominante du véhicule
- Mise à jour à chaque frame

**Fichiers** :
- `/public/js/modules/game/offscreen.js`

**Critères d'acceptation** :
- [ ] Flèches apparaissent quand un joueur sort du cadre
- [ ] Disparaissent quand il revient
- [ ] Couleurs distinctes pour chaque joueur

---

### Story 5.7 — Conditions de fin de partie

**Dépendances** : 5.4
**Contexte** : Détection victoire/défaite et écran de fin.

**Spécifications** :
- Victoire : tous les véhicules dans la zone d'arrivée
- Défaite : un véhicule à 0 voxels
- Écran de fin : photo de chaque véhicule (forme finale érodée), bouton "Rejouer"

**Fichiers** :
- `/server/match-end.js`
- `/public/js/pages/end-page.js`
- `/public/end.html`

**Critères d'acceptation** :
- [ ] La partie se termine correctement dans les 2 cas
- [ ] L'écran de fin s'affiche avec les véhicules finaux

---

## Phase 6 — Pool de blocs cumulatif

### Story 6.1 — Module block/builder (symboles → 3D)

**Dépendances** : Phase 5 complète
**Contexte** : Convertit la grille de symboles d'un bloc en éléments 3D.

**Contrat I/O** :
- Entrée : `{ grid: 8×8 array de symboles | null }`
- Sortie : `THREE.Group` contenant les meshes

**Spécifications** :
- Pour chaque symbole, instancier le mesh correspondant à la position de la case
- Meshes pré-modélisés (.glb dans `/public/assets/models/`)
- Matériaux distincts par symbole

**Fichiers** :
- `/public/js/modules/block/builder.js`
- `/public/assets/models/ramp.glb`, `sticky.glb`, `hard.glb`, `boost.glb`

**Critères d'acceptation** :
- [ ] Chaque symbole se traduit en mesh 3D au bon endroit
- [ ] Les meshes ont un comportement physique défini (coordonné avec game/physics)

---

### Story 6.2 — Module scan/symbol-reader

**Dépendances** : 1.8
**Contexte** : Lecture des symboles dans une grille de feuille bloc.

**Contrat I/O** :
- Entrée : `ImageData` de la grille bloc
- Sortie : `8×8 array` de `'ramp' | 'sticky' | 'hard' | 'boost' | null`

**Spécifications** :
- Pour chaque case, isoler les pixels noirs (le tracé)
- Template matching simple sur 4 modèles préenregistrés
- Retourner le symbole de meilleur score, ou null si aucun n'atteint un seuil

**Fichiers** :
- `/public/js/modules/scan/symbol-reader.js`
- Templates : `/public/assets/templates/symbol-*.png`

**Critères d'acceptation** :
- [ ] Reconnaît les 4 symboles dessinés à la main
- [ ] Tolère des variations modérées (taille, inclinaison)
- [ ] Retourne null pour des dessins libres non reconnus

**Notes pour l'IA** : la robustesse de cette story dépendra des templates fournis. Faire varier les exemples (plusieurs styles de "rampe") en moyenne ou utiliser un descripteur de forme (Hu moments, OpenCV) plutôt qu'un template strict.

---

### Story 6.3 — Pipeline scan bloc complet

**Dépendances** : 6.2
**Contexte** : Page dédiée au scan de la feuille bloc collectif.

**Spécifications** :
- Page `/scan-block.html` (ou route dédiée dans scan.html)
- Pipeline : capture → QR → redressement → segmentation → symbol-reader → builder → renderer
- Mode debug équivalent au scan véhicule
- Visualisation live : scan continu pendant que le groupe dessine, mise à jour 3D en temps réel

**Fichiers** :
- `/public/scan-block.html`
- `/public/js/pages/scan-block-page.js`

**Critères d'acceptation** :
- [ ] Une feuille bloc dessinée est scannée et le bloc 3D est affiché
- [ ] La visualisation se met à jour pendant que de nouveaux symboles sont ajoutés
- [ ] Aspect collectif : l'écran annexe est lisible à plusieurs

---

### Story 6.4 — Route admin pour ajout de blocs au pool

**Dépendances** : 6.3
**Contexte** : Permet au développeur d'ajouter manuellement un bloc au pool après l'atelier.

**Spécifications** :
- Route `POST /admin/blocks`
- Authentification simple (mot de passe en dur dans `server.js` ou IP localhost)
- Body : `{ name, atelier, grid }`
- Sauvegarde dans `/data/map-blocks/generated/<id>.json`

**Fichiers** :
- Extensions de `/server.js`
- `/server/admin-routes.js`

**Critères d'acceptation** :
- [ ] Un POST avec un JSON valide crée le fichier
- [ ] Le pool inclut le nouveau bloc au prochain démarrage du serveur
- [ ] Sécurité minimale : refus si mot de passe incorrect

---

### Story 6.5 — Intégration du pool dans la génération de map

**Dépendances** : 6.4
**Contexte** : La map de partie utilise le pool complet (seed + créés).

**Spécifications** :
- Au démarrage serveur, charger tous les blocs de `/data/map-blocks/_seed/` et `/data/map-blocks/generated/`
- Endpoint `/api/blocks` pour le client
- Le tirage de map utilise le pool complet

**Fichiers** :
- Extensions de `/server.js`
- Mise à jour de `/public/js/modules/game/map-generator.js`

**Critères d'acceptation** :
- [ ] Le pool est chargé au démarrage et logué en console
- [ ] Les nouveaux blocs apparaissent dans les parties suivantes

---

## Phase 7 — Galerie + polish

### Story 7.1 — Module storage/gallery

**Dépendances** : 2.5
**Contexte** : CRUD pour les véhicules en localStorage.

**Spécifications** :
- API : `list()`, `save(vehicle)`, `get(id)`, `remove(id)`, `count()`
- Format clé : `vehicle:<id>`
- Limites localStorage gérées avec message d'erreur clair

**Fichiers** :
- `/public/js/modules/storage/gallery.js`

**Critères d'acceptation** :
- [ ] CRUD fonctionnel
- [ ] Persistance entre sessions navigateur

---

### Story 7.2 — Page galerie

**Dépendances** : 7.1
**Contexte** : Visualiser et gérer les véhicules sauvegardés.

**Spécifications** :
- Page `/gallery.html`
- Grid de vignettes (mini-canvas Three.js par véhicule)
- Tap → modale plein écran avec rotation libre
- Bouton supprimer dans la modale
- Bouton "Nouveau scan" pour retour au scan

**Fichiers** :
- `/public/gallery.html`
- `/public/js/pages/gallery-page.js`
- `/public/css/gallery.css`

**Critères d'acceptation** :
- [ ] La galerie affiche tous les véhicules sauvegardés
- [ ] Affichage fluide même avec 50 véhicules
- [ ] Suppression fonctionnelle

---

### Story 7.3 — Polish game feel : screen shake

**Dépendances** : 4.2
**Contexte** : Tremblement de caméra à l'impact.

**Spécifications** :
- À l'impact, perturbation 2D de la position caméra
- Décroissance exponentielle sur 0.3 sec
- Magnitude proportionnelle à la vitesse de collision

**Fichiers** :
- Extension de `/public/js/modules/game/camera.js`

**Critères d'acceptation** :
- [ ] Shake visible et lisible
- [ ] Pas de mal de mer (durée courte, magnitude raisonnable)

---

### Story 7.4 — Polish : feedback visuel d'activation des pouvoirs

**Dépendances** : 4.1
**Contexte** : Flash + son court quand un pouvoir HSL s'active.

**Spécifications** :
- À chaque entrée dans une zone d'aspiration, contact avec un sillage, etc., flash visuel sur le véhicule concerné
- Son court (V2)

**Fichiers** :
- Extensions de `/public/js/modules/game/powers.js`

**Critères d'acceptation** :
- [ ] Chaque activation est lisible visuellement
- [ ] Pas de spam visuel si plusieurs pouvoirs actifs

---

### Story 7.5 — Polish : trace visuelle de la cohésion

**Dépendances** : 5.5
**Contexte** : Lien lumineux discret entre les véhicules quand la jauge est pleine.

**Spécifications** :
- Lignes lumineuses entre véhicules (ou particules connectives)
- Apparaît quand la cohésion est pleine
- Disparaît progressivement quand elle baisse

**Fichiers** :
- `/public/js/modules/game/cohesion-visual.js`

**Critères d'acceptation** :
- [ ] Effet visible et beau
- [ ] Performance OK à 5 joueurs

---

## Phase 8 — V1.x (différé après V1 testée)

### Story 8.1 — Pouvoirs P1 (violet et rose)

Implémenter `attraction` et `heal` selon spécifications PRD.

### Story 8.2 — Voxels au sol persistants

Stockage des voxels perdus, rendu au sol comme mémoire de partie.

### Story 8.3 — Audio

Module G complet : SFX, musique, son moteur dynamique.

### Story 8.4 — Export GLB

Conversion du JSON véhicule en .glb téléchargeable.

### Story 8.5 — Suppression galerie

Bouton de suppression dans la galerie + confirmation.

### Story 8.6 — Adaptation difficulté selon effectif

Règles fines pour 2/3/4/5 joueurs.

### Story 8.7 — Écran de fin avec photos des véhicules

Captures finales des véhicules érodés pour le debrief.

### Story 8.8 — Zone de signature feuille bloc

Lecture du nom du groupe par OCR ou champ saisi à la main.

---

## Annexes

### Annexe A — Conventions de code

- ES modules natifs (pas de bundler)
- Nommage : camelCase pour fonctions/variables, PascalCase pour classes
- 1 module = 1 fichier = 1 responsabilité
- Imports relatifs avec extension `.js`
- Pas de framework (React, Vue) — vanilla JS
- Three.js importé en module : `import * as THREE from '../lib/three.module.js'`

### Annexe B — Conventions de tests (V1.x)

- Fixtures dans `/tests/fixtures/` pour le scan
- Tests unitaires en JS pur, sans framework lourd
- Chaque module avec entrée/sortie JSON → testable indépendamment

### Annexe C — Ordre recommandé pour les sessions code AI

1. Phases 0 et 1.1 en parallèle (papier + setup projet)
2. Stories 1.2 → 1.11 séquentiellement (pipeline scan)
3. Phase 2 (reconstruction)
4. Phase 3 (single player)
5. Phase 4 (pouvoirs)
6. Phase 5 (multi)
7. Phase 6 (pool)
8. Phase 7 (polish)

À chaque phase, **playtester** avant de passer à la suivante.

### Annexe D — Estimation totale

- Phase 0 : ~1 semaine
- Phase 1 : ~2-3 semaines
- Phase 2 : ~1 semaine
- Phase 3 : ~2-3 semaines
- Phase 4 : ~2 semaines
- Phase 5 : ~3-4 semaines
- Phase 6 : ~2 semaines
- Phase 7 : ~1-2 semaines
- **Total V1 : ~14-18 semaines**

Les durées dépendent du temps disponible et de la complexité réelle découverte en cours de route.

---

*Document Stories v0.1 — version de travail itérative.*
