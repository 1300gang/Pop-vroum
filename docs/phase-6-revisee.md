# Phase 6 révisée — Éditeur de blocs map web

**Projet** : Pop Vroum
**Version** : 0.2
**Date** : 28 avril 2026
**Méthodologie** : BMAD-METHOD — Phase 4 Stories (révision)
**Document amont** : `stories.md` (v0.1)

---

## Contexte de la révision

OpenCV.js posait des problèmes de poids et d'expérience utilisateur (10 Mo à charger, init asynchrone fragile, taux d'échec en lumière variable). Pour réduire le risque technique et accélérer le développement, **la Phase 6 abandonne le scan de blocs au profit d'un éditeur web simple**.

**Le scan reste utilisé uniquement pour le véhicule** (Phase 1). Pour les blocs map, on bascule sur un éditeur web :
- Palette de symboles à gauche
- Quadrillage 8×8 à droite
- L'utilisateur clique pour placer/retirer un symbole
- Bouton "Exporter JSON"
- Le JSON est ajouté au pool manuellement

### Implications atelier

**Phase 7 atelier reformulée** :
> Le groupe se rassemble autour d'**une feuille papier vierge** (grille 8×8 avec légende des 4 symboles imprimée). Les participants discutent et dessinent leur bloc map collectivement sur le papier — c'est le moment social. Une personne (animateur·trice ou participant volontaire) recopie ensuite le bloc dans l'**éditeur web** ouvert sur tablette/laptop. Le JSON est exporté et envoyé au développeur (par mail, drive, ou tout simplement copié-collé dans le chat) pour intégration manuelle au pool.

Cela garde le moment collectif papier, mais sépare la phase technique (saisie dans l'éditeur) de la phase créative (discussion + dessin papier). Plus robuste et plus pédagogique : la personne qui recopie comprend la structure du bloc en la saisissant.

---

## Impact sur les autres documents

### PRD (à mettre à jour)

Stories supprimées :
- ~~B11 — Détection du type de feuille~~ (plus nécessaire si seul le véhicule est scanné)
- ~~CB01-CB04 — Module reconstruction bloc map par scan~~

Stories simplifiées :
- AB01-AB05 — Feuille bloc devient simplement une **feuille papier de discussion** (pas de QR, pas de patch couleur). Légende des 4 symboles imprimée. Format plus libre, moins technique.

Stories ajoutées :
- **F07 — Éditeur web de blocs map** (nouvelle story P0)

### Architecture (à mettre à jour)

Module supprimé : `/public/js/modules/scan/symbol-reader.js`

Modules ajoutés :
- `/public/block-editor.html`
- `/public/js/pages/block-editor-page.js`
- `/public/js/modules/block/editor.js`
- `/public/css/block-editor.css`

### Stories par modèle (à mettre à jour)

- ~~6.2 symbol-reader → Opus 4.6~~ (supprimée)
- **6.2-bis Éditeur web → Sonnet 4.6** (UI standard, pattern connu)

Économie estimée : ~$1.50 par session Opus évitée + des heures de débuggage en moins.

---

## Phase 6 révisée — Stories

### Story 6.1 — Module block/builder (inchangé)

**Dépendances** : Phase 5 complète
**Contexte** : Convertit la grille de symboles d'un bloc en éléments 3D dans le jeu.

**Contrat I/O** :
- Entrée : `{ grid: 8×8 array de symboles | null }`
- Sortie : `THREE.Group` contenant les meshes

**Spécifications** :
- Pour chaque symbole, instancier le mesh correspondant (.glb dans `/public/assets/models/`)
- Matériaux distincts par symbole
- Comportement physique défini par le type (rampe = inclinaison, dur = collision, collant = friction, accélération = boost)

**Fichiers** :
- `/public/js/modules/block/builder.js`
- `/public/assets/models/ramp.glb`, `sticky.glb`, `hard.glb`, `boost.glb`

**Critères d'acceptation** :
- [ ] Chaque symbole se traduit en mesh 3D au bon endroit
- [ ] Les meshes ont un comportement physique défini

---

### Story 6.2 — Éditeur web de blocs map

**Dépendances** : 6.1
**Contexte** : Interface web pour créer un bloc map en cliquant sur une grille. Remplace le scan papier de la Phase 6 originale.

**Contrat I/O** :
- Entrée : aucune (création depuis zéro ou chargement d'un JSON existant)
- Sortie : JSON bloc téléchargeable conforme au schéma `architecture.md` section 4

**Spécifications fonctionnelles** :

#### Interface
- Layout 2 colonnes :
  - **Gauche** : palette des 4 symboles (rampe, collant, dur, accélération) + outil "gomme" (case vide) + bouton "Tout effacer"
  - **Droite** : grille 8×8 cliquable, chaque case affichant le symbole placé ou vide
- En haut : champ "Nom du bloc" + champ "Atelier d'origine"
- En bas : bouton "Exporter JSON" (téléchargement) + bouton "Aperçu 3D" (toggle d'une vue Three.js)
- Optionnel : bouton "Charger JSON" pour reprendre un bloc existant

#### Interactions
- Clic sur un symbole de la palette → outil sélectionné (mis en surbrillance)
- Clic sur une case de la grille → applique l'outil sélectionné
- Glissement (mouse drag ou touch drag) → applique l'outil sur toutes les cases survolées (pour remplir vite)
- Clic-droit ou outil "gomme" → vide la case
- Aperçu 3D : rendu en temps réel du bloc dans un canvas Three.js, avec rotation libre

#### Export JSON
- Génère un objet conforme au schéma :
```json
{
  "id": "block_<timestamp>_<slug>",
  "name": "<saisi>",
  "createdAt": "<ISO>",
  "atelier": "<saisi>",
  "grid": [[null, "ramp", ...], ...]
}
```
- Téléchargement automatique via `Blob` + lien temporaire
- Nom de fichier : `block-<slug>-<timestamp>.json`

#### Validation
- Vérifie qu'il y a **au moins une case d'entrée et une case de sortie alignées** (au moins une case non-`hard` sur chaque bord opposé) pour assurer que le bloc soit pathable
- Si la validation échoue, affiche un avertissement avant export, mais autorise l'export quand même (à la responsabilité de l'utilisateur)

**Fichiers** :
- `/public/block-editor.html`
- `/public/js/pages/block-editor-page.js`
- `/public/js/modules/block/editor.js`
- `/public/css/block-editor.css`
- Réutilisation de `/public/js/modules/block/builder.js` et `block/renderer.js` pour l'aperçu 3D

**Critères d'acceptation** :
- [ ] Page accessible depuis l'accueil (lien "Créer un bloc map")
- [ ] Création d'un bloc 8×8 par clic
- [ ] Aperçu 3D rotatif synchronisé avec la grille
- [ ] Export JSON valide téléchargeable
- [ ] Chargement d'un JSON existant pour modification (bonus, peut être P1)
- [ ] UI utilisable sur tablette (touch) et desktop (souris)
- [ ] Avertissement si bloc non-pathable

**Notes pour l'IA** :
- UI vanilla JS, pas de framework
- Réutiliser le rendu Three.js existant via `block/builder.js` et `block/renderer.js` (Story 6.1)
- L'aperçu 3D peut tourner dans un coin de l'écran (~ 300×300 px), ne pas prendre trop de place pour ne pas écraser l'éditeur 2D
- Pour le drag : `mousedown` + `mousemove` + `mouseup`, équivalents `touchstart`/`touchmove`/`touchend`. Empêcher le scroll par défaut pendant le drag (`touch-action: none`).

---

### Story 6.3 — Page d'accueil enrichie

**Dépendances** : 6.2
**Contexte** : Ajouter un point d'entrée vers l'éditeur de blocs depuis l'accueil.

**Spécifications** :
- Sur `index.html`, ajouter un bouton ou un lien "Créer un bloc map" qui mène à `/block-editor.html`
- Esthétique cohérente avec le reste du dispositif

**Fichiers** :
- Modification de `/public/index.html`
- Modification de `/public/css/shared.css` si besoin

**Critères d'acceptation** :
- [ ] Le lien est visible et cliquable depuis l'accueil
- [ ] Cohérence visuelle avec le reste du projet

---

### Story 6.4 — Route admin pour ajout de blocs au pool

**Dépendances** : 6.2
**Contexte** : Permet au développeur d'ajouter manuellement un bloc créé via l'éditeur au pool serveur.

**Spécifications** :
- Route `POST /admin/blocks`
- Authentification simple : header `X-Admin-Token` vérifié contre une variable d'environnement ou valeur en dur dans `server.js`
- Body : JSON bloc tel qu'exporté par l'éditeur
- Validation côté serveur :
  - `id` non-vide et non-conflictuel avec un bloc existant
  - `grid` est bien un 8×8
  - Symboles dans la liste autorisée
- Sauvegarde dans `/data/map-blocks/generated/<id>.json`
- Rechargement du pool en mémoire serveur sans redémarrer

**Fichiers** :
- Extension de `/server.js`
- Nouveau `/server/admin-routes.js`

**Critères d'acceptation** :
- [ ] POST avec un JSON valide crée le fichier
- [ ] POST avec ID en conflit retourne 409
- [ ] POST sans token retourne 401
- [ ] Le pool inclut le nouveau bloc immédiatement (sans redémarrage)

**Notes pour l'IA** :
- En V1, on peut même rendre cette route encore plus simple : pas d'auth si elle écoute uniquement sur `localhost`. Dans ce cas, l'animateur·trice doit être sur la même machine que le serveur, ce qui est le cas en atelier.
- Une alternative encore plus simple : pas de route HTTP du tout. Juste une fonctionnalité dans l'éditeur web qui ouvre un dialog avec le JSON, l'utilisateur copie le JSON et le développeur le colle manuellement dans `/data/map-blocks/generated/`. Encore plus minimal, et tu gardes le contrôle éditorial total. À toi de choisir ; je propose la version "route HTTP" mais "copier-coller manuel" est tout aussi valable.

---

### Story 6.5 — Intégration du pool dans la génération de map (inchangé)

**Dépendances** : 6.4
**Contexte** : La map de partie utilise le pool complet (seed + créés via l'éditeur).

**Spécifications** :
- Au démarrage serveur, charger tous les blocs de `/data/map-blocks/_seed/` et `/data/map-blocks/generated/`
- Endpoint `/api/blocks` pour le client
- Le tirage de map utilise le pool complet
- Si un nouveau bloc est ajouté en cours de session via la route admin, il est immédiatement disponible dans la prochaine partie

**Fichiers** :
- Extensions de `/server.js`
- Mise à jour de `/public/js/modules/game/map-generator.js`

**Critères d'acceptation** :
- [ ] Le pool est chargé au démarrage et logué en console
- [ ] Les nouveaux blocs apparaissent dans les parties suivantes

---

## Mises à jour à appliquer

### Dans `prd.md`

Remplacer la table "Module C bis — Reconstruction bloc map" par :

| ID | Fonctionnalité | Description | Priorité |
|----|----------------|-------------|----------|
| F07 | Éditeur web de blocs map | Interface 2D avec palette + grille + aperçu 3D + export JSON. Pas de scan. | P0 |

Supprimer ou alléger la story AB (feuille bloc) :
- AB01 → feuille papier simple, A4 ou A3, grille 8×8 imprimée + légende des 4 symboles. **Pas de QR codes nécessaires.**
- AB02-AB05 → simplifier en conséquence

### Dans `architecture.md`

Section 2 (structure de fichiers) : remplacer
```
│   │   │   ├── symbol-reader.js
```
par
```
│   │   ├── block-editor.html
│   │   └── /js/modules/block/editor.js
```

Section 3 (pipeline scan) : retirer la mention du pipeline bloc map.

Ajouter une nouvelle section "Éditeur de blocs" qui décrit le flux :
```
[utilisateur clique sur la grille]
    ↓
[block/editor.js] ─→ état grille en mémoire
    ↓
[block/builder.js] ─→ aperçu 3D temps réel
    ↓
[bouton Exporter] ─→ JSON téléchargé
    ↓
[ajout manuel au pool]
```

### Dans `stories.md` v0.1

Remplacer la Phase 6 entière par le contenu de ce document.

### Dans `stories-par-modele.md`

| Story | Modèle | Justification |
|-------|--------|---------------|
| 6.1 — Module block/builder | **Sonnet 4.6** | Mapping symboles → meshes. Standard. |
| 6.2 — Éditeur web de blocs map | **Sonnet 4.6** | UI vanilla, pattern grille + palette bien connu. |
| 6.3 — Page d'accueil enrichie | **Haiku 4.5** | Ajout d'un lien. Trivial. |
| 6.4 — Route admin | **Haiku 4.5** | Endpoint Express simple. |
| 6.5 — Intégration pool | **Sonnet 4.6** | Chargement de fichiers + tirage. |

**Plus aucune story Opus dans la Phase 6.** Économie réelle.

---

## Avantages de cette révision

1. **Risque technique fortement réduit** : plus d'OpenCV.js dans la Phase 6, plus de dépendance à la lumière ou aux feutres calibrés pour les blocs.
2. **Phase 6 codable plus rapidement** : éditeur web ~3-4 jours vs symbol-reader OpenCV ~1 semaine + débuggage.
3. **JSON exact garanti** : pas d'approximation de lecture, le JSON sortant correspond exactement à ce que l'utilisateur a placé.
4. **Atelier plus fluide** : le moment papier reste le moment social/discussion, l'éditeur web devient le moment technique propre.
5. **Économie de coûts code AI** : ~$1.50 par story Opus évitée + heures de débuggage en moins.
6. **Toujours aligné avec la vision phygital** : le papier reste central, c'est juste qu'il ne sert plus de **support de scan** pour les blocs (pas de chaîne fragile à scanner). La feuille papier devient un support de discussion et de référence, recopié ensuite dans l'éditeur.

---

## Question à toi

Pour la **Story 6.4 (route admin)**, tu préfères :

**Option A — Route HTTP avec auth simple** : l'animateur·trice peut ajouter un bloc directement depuis l'éditeur via un bouton "Envoyer au serveur". Plus fluide en atelier, mais expose une route admin.

**Option B — Export JSON pur, intégration manuelle par toi** : le JSON est téléchargé sur le device de l'animateur·trice, qui te l'envoie (drive, mail, chat), tu le colles dans `/data/map-blocks/generated/` quand tu le veux. **Tu gardes la modération éditoriale totale.**

L'option B est plus minimale et cohérente avec ton choix actuel ("modération éditoriale humaine en V1"). L'option A est plus pratique si tu veux que les blocs soient immédiatement utilisables le jour de l'atelier.

Si tu ne sais pas, va sur **B** : moins de code, plus de contrôle, et tu peux toujours ajouter A en V1.x si besoin.

---

*Document Phase 6 révisée v0.2.*
