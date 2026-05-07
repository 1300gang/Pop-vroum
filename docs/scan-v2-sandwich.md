# PRD + Stories — Scan v2 "Sandwich"

**Projet** : Pop Vroum
**Version** : scan-v2 (test A/B)
**Date** : 6 mai 2026
**Méthodologie** : BMAD-METHOD
**Document amont** : `prd.md` (v0.2), `stories.md` (v0.1), `prd-v1.1-stories.md`

---

## Contexte

La feuille de scan v1 (3 vues orthogonales : face / profil / dessus) est bien comprise par les designers et les personnes ayant des notions de dessin technique, mais opaque pour les néophites. Retour terrain : le dispositif doit fonctionner pour des publics sans formation visuelle spécifique (enfants, adolescents, adultes non-designers).

**Solution proposée — Le Sandwich** : 4 grilles 4×8 côte à côte sur une feuille A4 paysage, chacune représentant une tranche horizontale du véhicule vue de dessus. Métaphore : "tu dessines ton véhicule comme si tu le découpais en 4 tranches, comme un sandwich".

### Comparatif v1 vs v2

| Dimension | Scan v1 (dessin technique) | Scan v2 (sandwich) |
|-----------|---------------------------|---------------------|
| Modèle mental | Projection orthogonale (face/profil/dessus) | Tranches horizontales empilées |
| Public cible | Designers, personnes avec notions de dessin technique | Tout public, enfants inclus |
| Complexité scan | Union 2-sur-3 (3 vues à croiser) | Direct (1 vue = 1 couche, sans ambiguïté) |
| Contrôle volume | Bonne approximation | Contrôle fin couche par couche (ex : moteur caché sous le capot) |
| Format feuille | A3 paysage recommandé | A4 paysage (accessible, copieur école) |
| Reconstruction | Algorithmique (risque d'ambiguïté) | Déterministe (sans ambiguïté) |
| Robustesse scan | Dépend de la cohérence entre 3 vues | Plus robuste (4 grilles indépendantes) |

### Objectif du test A/B

Comparer la **compréhension intuitive** des deux feuilles auprès d'un public sans notions de dessin technique, selon l'âge et le niveau de familiarité avec la représentation spatiale. Le critère principal : le participant peut-il dessiner un véhicule reconnaissable sans instruction orale ?

---

## PRD — Scan v2 Sandwich

### Feuille physique (scan-v2.pdf)

| ID | Élément | Description |
|----|---------|-------------|
| S2-F01 | Format | A4 paysage. Cases ≥ 1 cm (acceptable pour feutre fin). Prévoir version A3 pour impression école avec photocopieuse. |
| S2-F02 | 4 grilles 4×8 | Disposées côte à côte de gauche à droite. Proportions portrait. Chaque grille représente une tranche horizontale du véhicule. |
| S2-F03 | Labels des tranches | En dessous de chaque grille : "1 - Dessous (roues)" / "2 - Milieu bas" / "3 - Milieu haut" / "4 - Dessus (capot)". Labels courts, lisibles par un enfant. |
| S2-F04 | Indicateur avant/arrière | Sur chaque grille : flèche discrète à gauche "← ARRIÈRE" et à droite "AVANT →" (ou en haut/bas selon orientation retenue). Même orientation sur les 4 grilles. |
| S2-F05 | Schéma explicatif | En haut de la feuille : illustration simple montrant un véhicule "explosé" en 4 tranches avec les numéros correspondants. Style bande dessinée / pictogramme, pas technique. |
| S2-F06 | 4 QR codes de calage | Aux 4 coins de la feuille. Contenus : `popvroum-v2-tl`, `popvroum-v2-tr`, `popvroum-v2-bl`, `popvroum-v2-br`. Distingue cette feuille de la v1 pour la détection automatique du type. |
| S2-F07 | Patch de référence couleur | Identique à la v1 : 6 carrés imprimés pour calibration HSL. Discret, en bas. |
| S2-F08 | Légende des couleurs | Rappel compact des 6 couleurs et de leur effet. Identique à la v1. |

### Page scan2.html

| ID | Fonctionnalité | Description |
|----|----------------|-------------|
| S2-P01 | Page séparée | `/public/scan2.html` autonome, pas de paramètre URL. Pipeline propre pour le test A/B. |
| S2-P02 | Réutilisation des modules | Réutilise les modules existants : `capture.js`, `qr-detect.js`, `perspective.js`, `segmenter.js`, `color-reader.js`, `calibration.js`, `debug-view.js`. Seul `voxel/builder.js` est remplacé par `voxel/builder-sandwich.js`. |
| S2-P03 | Segmentation 4 grilles | Découpe l'image redressée en 4 zones égales côte à côte. Coordonnées dans `layout.json` sous une nouvelle clé `vehicleSheetV2`. |
| S2-P04 | Reconstruction directe | 1 grille = 1 couche Y. Si case (col, row) coloriée en grille N → voxel (x=col, y=N-1, z=row) existe. Pas d'union. Couleur directement celle lue. |
| S2-P05 | Détection des roues | Identique à la v1 : la grille 1 (y=0, dessous) est utilisée pour détecter les positions avant/arrière et l'écartement des roues. C'est la couche la plus proche du sol, donc la plus logique pour les roues. |
| S2-P06 | Sortie JSON identique | Le JSON véhicule produit est au même format que la v1 (`{ id, playerName, grid, wheelPositions, stats, powers }`). Compatible avec le reste du jeu sans modification. |
| S2-P07 | Feedback de capture | Identique à la v1 corrigée (story V1-B3) : flash blanc + statuts textuels. |
| S2-P08 | Mode debug visuel | Adapté : affiche les 4 grilles segmentées côte à côte avec couleurs lues. |
| S2-P09 | Écran de validation | Identique à la v1 : véhicule 3D en rotation libre + stats + boutons Valider / Re-scanner. |
| S2-P10 | Accès depuis l'index | Lien depuis `index.html` en section "Dev / Test" : "Scanner (v2 - sandwich)". |

### Contraintes techniques

- Réutilisation maximale des modules existants — seul le builder change
- Layout v2 ajouté dans `layout.json` sans toucher au layout v1
- QR codes distincts v1/v2 pour permettre la détection automatique du type de feuille (story 1.10 existante)
- Format JSON de sortie identique → aucun impact sur lobby, jeu, galerie

---

## Stories

### Story S2-1 — Feuille scan v2 (SVG + PDF)

**Modèle** : Haiku 4.5
**Dépendances** : Story 0.1 (feuille v1 existante comme référence)
**Contexte** : Créer la feuille physique à imprimer pour le test A/B.

**Spécifications** :
- Format A4 paysage (297 × 210 mm)
- En haut : schéma explicatif du sandwich (véhicule explosé en 4 tranches numérotées). Style simple, pictogramme. Hauteur ~40mm.
- 4 grilles 4 colonnes × 8 lignes, côte à côte :
  - Chaque grille en portrait, largeur ~55mm, hauteur ~120mm
  - Cases ~13mm × 15mm (confortable pour feutre)
  - Espacement entre grilles ~5mm
- Labels sous chaque grille :
  - Grille 1 : "① DESSOUS — roues et châssis"
  - Grille 2 : "② MILIEU BAS — habitacle bas"
  - Grille 3 : "③ MILIEU HAUT — habitacle haut"
  - Grille 4 : "④ DESSUS — capot et toit"
- Indicateur avant/arrière sur chaque grille :
  - Texte "AVANT" avec flèche ↑ en haut de la grille
  - Texte "ARRIÈRE" avec flèche ↓ en bas de la grille
- 4 QR codes aux coins (~15mm), contenus : `popvroum-v2-tl`, `popvroum-v2-tr`, `popvroum-v2-bl`, `popvroum-v2-br`
- Patch couleur bas-gauche (6 carrés 10×10mm alignés) avec label couleurs
- Légende des 6 couleurs et effets : compact, bas-droite

**Fichiers** :
- `/public/assets/sheets/feuille-vehicule-v2-sandwich-A4.svg`
- `/public/assets/sheets/feuille-vehicule-v2-sandwich-A4.pdf`
- `/public/assets/sheets/feuille-vehicule-v2-sandwich-A3.pdf` (version agrandie pour écoles avec gros copieur)

**Critères d'acceptation** :
- [ ] PDF imprimable A4 sans déformation
- [ ] Cases mesurables ≥ 1 cm sur l'impression
- [ ] Schéma explicatif lisible par un enfant de 10 ans sans explication orale
- [ ] Labels et flèches AVANT/ARRIÈRE présents sur les 4 grilles
- [ ] QR codes lisibles à 30-60 cm via webcam standard

**Notes pour l'IA** : Le schéma explicatif est la partie la plus importante. Proposer une vue isométrique très simplifiée d'un véhicule "découpé" en 4 tranches avec des chiffres, style LEGO ou Minecraft. Pas de dessin technique.

---

### Story S2-2 — Layout v2 dans layout.json

**Modèle** : Haiku 4.5
**Dépendances** : S2-1
**Contexte** : Ajouter les coordonnées de segmentation de la feuille v2 dans le fichier de config existant.

**Spécifications** :
Ajouter dans `/config/layout.json` une nouvelle clé `vehicleSheetV2` :

```json
"vehicleSheetV2": {
  "width": 1200,
  "height": 850,
  "slices": [
    { "label": "base",    "y": 0, "x": 80,  "w": 250, "h": 550, "cols": 4, "rows": 8 },
    { "label": "centre1", "y": 1, "x": 345, "w": 250, "h": 550, "cols": 4, "rows": 8 },
    { "label": "centre2", "y": 2, "x": 610, "w": 250, "h": 550, "cols": 4, "rows": 8 },
    { "label": "dessus",  "y": 3, "x": 875, "w": 250, "h": 550, "cols": 4, "rows": 8 }
  ],
  "patch": { "x": 50, "y": 750, "w": 600, "h": 60 }
}
```

Les coordonnées x/w/h sont à ajuster après test avec une vraie impression. Ce sont des valeurs de départ raisonnables.

**Fichiers** :
- `/config/layout.json`

**Critères d'acceptation** :
- [ ] `layout.json` parse sans erreur
- [ ] Les 4 zones couvrent bien les 4 grilles sur une image test de la feuille imprimée et photographiée

---

### Story S2-3 — Module voxel/builder-sandwich.js

**Modèle** : Sonnet 4.6
**Dépendances** : S2-2, `voxel/builder.js` existant (v1) comme référence
**Contexte** : Remplace l'union 2-sur-3 par une reconstruction directe couche par couche. Module plus simple que la v1.

**Contrat I/O** :
- Entrée : `{ slices: [ grille4x8, grille4x8, grille4x8, grille4x8 ] }` (sortie du segmenter v2)
- Sortie : `grid: 4×4×8` array identique au format v1

**Convention de coordonnées** (identique à v1, CRITIQUE) :
- `x ∈ [0, 3]` = gauche-droite (largeur, 4 colonnes)
- `z ∈ [0, 7]` = avant-arrière (longueur, 8 lignes — haut = avant = z=7, bas = arrière = z=0)
- `y ∈ [0, 3]` = bas-haut (hauteur, 4 tranches — tranche 1 = y=0, tranche 4 = y=3)

**Algorithme** :
```javascript
export function buildFromSandwich(slices) {
  // grid[x][z][y] ou grid[y][z][x] selon convention établie dans builder.js v1
  const grid = init4x4x8(null);
  
  slices.forEach((slice, sliceIndex) => {
    // sliceIndex 0 = y=0 (dessous), 3 = y=3 (dessus)
    slice.forEach((row, rowIndex) => {
      // rowIndex 0 = haut de la grille = AVANT = z=7
      const z = 7 - rowIndex;
      row.forEach((color, colIndex) => {
        if (color !== null) {
          const x = colIndex; // colIndex 0 = gauche
          setVoxel(grid, x, sliceIndex, z, color);
        }
      });
    });
  });
  
  return grid;
}
```

**Sortie** : JSON grid au format identique à `builder.js` v1, compatible avec `wheel-detector.js`, `stats.js`, `renderer.js` sans modification.

**Fichiers** :
- `/public/js/modules/voxel/builder-sandwich.js`

**Critères d'acceptation** :
- [ ] Une grille 1 entièrement rouge → 32 voxels rouges à y=0
- [ ] Une grille 4 entièrement bleue → 32 voxels bleus à y=3
- [ ] Case (col=0, row=0) de la grille 2 → voxel (x=0, y=1, z=7)
- [ ] JSON de sortie identique au format v1 (compatible avec le reste du jeu)
- [ ] Convention AVANT (haut grille = z élevé) respectée

**Notes pour l'IA** : Respecter STRICTEMENT la même convention de coordonnées que `builder.js` v1. Lire le module existant avant de coder. Une seule différence logique : pas d'union, juste un mapping direct. Beaucoup plus simple.

---

### Story S2-4 — Page scan2.html

**Modèle** : Sonnet 4.6
**Dépendances** : S2-2, S2-3, `scan.html` existant comme référence
**Contexte** : Page de scan autonome pour la feuille v2. Réutilise au maximum les modules existants.

**Architecture** :
```
[scan2.html]
    ↓
[scan-page-v2.js]  ← nouveau script d'entrée
    ↓ réutilise
[capture.js]       ← identique v1
[qr-detect.js]     ← identique v1
[perspective.js]   ← identique v1
[segmenter-v2.js]  ← nouveau : découpe en 4 grilles verticales
[calibration.js]   ← identique v1
[color-reader.js]  ← identique v1 (appelé 4 fois, une par grille)
[builder-sandwich.js] ← nouveau (S2-3)
[wheel-detector.js]← identique v1
[stats.js]         ← identique v1
[renderer.js]      ← identique v1
[debug-view.js]    ← adapté : affiche 4 panneaux grilles au lieu de 3
```

**Nouveau module `segmenter-v2.js`** :
- Prend l'image redressée + `layout.vehicleSheetV2`
- Retourne `{ slices: [ImageData×4], patch: ImageData }`
- Découpe les 4 grilles + le patch couleur

**Page scan2.html** :
- Identique à `scan.html` v1 en structure et CSS
- Titre/sous-titre adapté : "Scanner votre véhicule — mode sandwich"
- Mode debug : 4 panneaux grilles côte à côte (au lieu de 3 en v1)
- Feedback de capture identique à V1-B3
- Écran de validation identique (véhicule 3D + stats + boutons)
- Lien "Utiliser la feuille v1 à la place" vers `scan.html`

**Fichiers** :
- `/public/scan2.html`
- `/public/js/pages/scan-page-v2.js`
- `/public/js/modules/scan/segmenter-v2.js`
- `/public/css/scan2.css` (ou réutilise `scan.css`)

**Critères d'acceptation** :
- [ ] Page accessible et fonctionnelle sur tablette
- [ ] Pipeline complet : capture → QR → redressement → 4 grilles → reconstruction → 3D
- [ ] Mode debug affiche les 4 grilles avec couleurs lues
- [ ] Véhicule reconstruit visible en 3D dans l'écran de validation
- [ ] JSON de sortie compatible avec lobby + jeu
- [ ] Lien vers scan v1 présent

---

### Story S2-5 — Mise à jour index.html

**Modèle** : Haiku 4.5
**Dépendances** : S2-4
**Contexte** : Rendre scan2.html accessible depuis l'index.

**Spécifications** :
- Dans la section "Dev / Test" de l'index : ajouter un lien "Scanner v2 — Sandwich"
- Distinguer visuellement les deux scanners (label ou badge "NOUVEAU" ou "TEST A/B")
- Sur `scan.html` : ajouter un lien discret vers `scan2.html` ("Essayer la feuille sandwich")
- Sur `scan2.html` : ajouter un lien vers `scan.html` ("Utiliser la feuille classique")

**Fichiers** :
- `/public/index.html`
- `/public/scan.html` (ajout lien discret)
- `/public/scan2.html` (ajout lien discret)

**Critères d'acceptation** :
- [ ] Les deux scanners sont accessibles depuis l'index
- [ ] Les deux scanners ont un lien vers l'autre
- [ ] Labels clairs pour distinguer v1 et v2

---

## Ordre de traitement

```
S2-1  (feuille PDF)          ← en premier, valider physiquement avant de coder
S2-2  (layout.json)          ← ajouter la config, 5 min
S2-3  (builder-sandwich)     ← le cœur, algorithme simple
S2-4  (scan2.html)           ← assemblage des modules
S2-5  (index)                ← 5 min, à faire en dernier
```

**Important** : imprimer la feuille S2-1 et la tester physiquement (scan avec webcam) avant de finaliser les coordonnées de `layout.json` (S2-2). Les coordonnées x/w/h dans le layout dépendent de la mise en page réelle imprimée.

---

## Récapitulatif modèles

| Story | Modèle | Coût estimé |
|-------|--------|------------|
| S2-1 Feuille SVG/PDF | Haiku 4.5 | ~$0.40 |
| S2-2 Layout config | Haiku 4.5 | ~$0.20 |
| S2-3 builder-sandwich | Sonnet 4.6 | ~$1 |
| S2-4 scan2.html | Sonnet 4.6 | ~$1.50 |
| S2-5 Index update | Haiku 4.5 | ~$0.20 |
| **Total estimé** | | **~$3.30** |

Pas d'Opus sur ce batch. La reconstruction sandwich est tellement plus simple que la v1 que Sonnet suffit largement.

---

## Notes pour le test A/B

### Protocole suggéré

1. Imprimer les deux feuilles (v1 et v2 sandwich)
2. Séparer le groupe en deux :
   - Groupe A : feuille v1, aucune instruction orale
   - Groupe B : feuille v2 sandwich, aucune instruction orale
3. Donner 10 minutes pour colorier
4. Observer et noter :
   - "Est-ce que la personne comprend ce qu'on lui demande ?" (0-5)
   - "Est-ce que le véhicule scanné ressemble à ce qui a été dessiné ?" (0-5)
   - Questions posées spontanément par la personne
5. Conserver les deux feuilles + capture du JSON résultant

### Ce qu'on cherche à valider

- **Compréhension sans instruction** : le schéma explicatif du sandwich suffit-il ?
- **Mapping mental avant/arrière** : la convention haut=avant est-elle intuitive ?
- **Résultat scanné vs dessin** : le véhicule 3D ressemble-t-il à l'intention du dessinateur ?
- **Différences selon l'âge** : enfant 8-10 ans / ado / adulte non-designer

### Hypothèse

La v2 devrait mieux performer sur la **compréhension initiale** (moins d'hésitation sur "quoi dessiner"). La v1 devrait mieux performer sur la **richesse du volume** pour les personnes avec des notions de représentation spatiale.

---

*Document scan-v2 sandwich — v0.1, version de travail.*
