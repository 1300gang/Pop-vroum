# Architecture Document — Pop Vroum

**Projet** : Pop Vroum
**Porteur** : 1k3vrtical / Collectif Mille Trois Cents
**Version** : 0.1
**Date** : 28 avril 2026
**Méthodologie** : BMAD-METHOD — Phase 3 Architecture
**Documents amont** : `brainstorming-session.md`, `prd.md` (v0.2)

---

## 1. Vue d'ensemble

### Topologie

Pop Vroum est une **application web client-serveur** sur réseau local, pensée pour tourner en atelier sans dépendance cloud.

```
┌─────────────────────────────────────────────────────────────┐
│  RÉSEAU LOCAL ATELIER (Wi-Fi salle ou hotspot animateur)    │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ Tablette 1   │  │ Tablette 2   │  │ Tablette 5   │       │
│  │ (scan +      │  │ (scan +      │  │ (scan +      │       │
│  │  pilotage)   │  │  pilotage)   │  │  pilotage)   │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
│         │                 │                 │                │
│         └─────────────────┼─────────────────┘                │
│                           │ Socket.io                        │
│                           ▼                                  │
│                  ┌────────────────┐                          │
│                  │ Serveur Node   │                          │
│                  │ (laptop anim.) │                          │
│                  │  + JSON store  │                          │
│                  └────────┬───────┘                          │
│                           │                                  │
│                           ▼                                  │
│                  ┌────────────────┐                          │
│                  │ Écran/projecteur│                         │
│                  │ (vue collective)│                         │
│                  └────────────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

Le serveur tourne sur un laptop Mac/PC standard. Les tablettes (ou téléphones) se connectent en HTTP/WS via le Wi-Fi local. L'écran collectif est une page web ouverte sur un navigateur connecté au même serveur, en mode "spectateur".

### Choix de stack

| Couche | Choix | Justification |
|--------|-------|---------------|
| Backend | Node.js 20+ + Express 4 + Socket.io 4 | Continuité avec Scan & Race existant, écosystème connu de l'auteur |
| Stockage | Fichiers JSON locaux (`fs/promises`) | Pas de DB pour la V1, suffisant pour l'échelle atelier |
| Frontend | HTML5 + CSS3 + JS vanilla | Continuité avec les projets antérieurs (Masque de Fayçal, Poliade), pas de build step |
| Vision | OpenCV.js 4.x | Robuste pour homographie + lecture couleur HSL, doc abondante |
| QR | jsQR 1.4 | Léger, fiable, intégré côté client |
| 3D | Three.js r150+ | Maîtrisé par l'auteur, écosystème riche |
| Bundler | Aucun | Imports ES modules natifs, fichiers servis statiques |

### Principes architecturaux

1. **Pipeline modulaire** : chaque étape (capture → QR → redressement → segmentation → lecture → reconstruction) est un module autonome avec une entrée et une sortie JSON.
2. **JSON comme format pivot** : tout ce qui peut être sérialisé l'est. Permet de mocker n'importe quelle étape avec un fichier de test.
3. **Mode debug omniprésent** : chaque module expose une vue de debug visuelle activable.
4. **Configuration externalisée** : valeurs de gameplay et paramètres de scan dans des fichiers JSON modifiables sans recompilation.
5. **Séparation client/serveur stricte** : le serveur ne fait que router les états, jamais de logique de jeu lourde. Sauf pour l'autorité sur les positions.

---

## 2. Structure des fichiers

```
/popvroum
├── server.js                      # Express + Socket.io entry point
├── package.json
├── package-lock.json
├── .gitignore
│
├── /config
│   ├── gameplay.json              # Constantes équilibrage (vitesses, portées…)
│   ├── scan.json                  # Tolérances HSL, seuils
│   └── layout.json                # Coordonnées des grilles sur les feuilles
│
├── /data
│   ├── /vehicles                  # JSON véhicules archivés (optionnel V1)
│   └── /map-blocks                # Pool de blocs map JSON
│       ├── _seed                  # Blocs de base livrés avec le projet
│       │   ├── ramp-corner.json
│       │   ├── sticky-cross.json
│       │   └── ...
│       └── /generated             # Blocs créés en atelier (ajout manuel)
│           ├── atelier-2026-04-28.json
│           └── ...
│
├── /public                        # Servi en statique
│   ├── index.html                 # Accueil
│   ├── scan.html                  # Page de scan
│   ├── lobby.html                 # Lobby pré-partie
│   ├── game.html                  # Vue jeu joueur
│   ├── spectator.html             # Vue collective écran principal
│   ├── gallery.html               # Galerie véhicules localStorage
│   │
│   ├── /assets
│   │   ├── /sheets                # PDF des feuilles imprimables
│   │   │   ├── feuille-vehicule-A3.pdf
│   │   │   └── feuille-bloc-A3.pdf
│   │   ├── /models                # Meshes 3D (symboles map)
│   │   │   ├── ramp.glb
│   │   │   ├── sticky.glb
│   │   │   ├── hard.glb
│   │   │   └── boost.glb
│   │   ├── /audio                 # SFX (V2)
│   │   └── /textures
│   │
│   ├── /css
│   │   ├── shared.css             # Variables CSS, design system
│   │   ├── scan.css
│   │   ├── game.css
│   │   └── lobby.css
│   │
│   └── /js
│       ├── /lib                   # Libs externes (opencv.js, jsqr, three.js)
│       │
│       ├── /modules               # Modules métier (un par responsabilité)
│       │   ├── scan/
│       │   │   ├── capture.js     # Accès caméra
│       │   │   ├── qr-detect.js   # Détection 4 QR
│       │   │   ├── perspective.js # Redressement homographie
│       │   │   ├── segmenter.js   # Découpe en grilles
│       │   │   ├── color-reader.js# Lecture HSL par case
│       │   │   ├── symbol-reader.js# Lecture symboles bloc
│       │   │   ├── calibration.js # Calibration via patch
│       │   │   └── debug-view.js  # Affichage debug visuel
│       │   │
│       │   ├── voxel/
│       │   │   ├── builder.js     # Union 2-sur-3 → grille 3D
│       │   │   ├── wheel-detector.js # Placement automatique des 4 roues
│       │   │   ├── stats.js       # Calcul stats RVB et pouvoirs HSL
│       │   │   └── renderer.js    # Three.js rendu voxel + roues
│       │   │
│       │   ├── block/
│       │   │   ├── builder.js     # Symboles 2D → meshes 3D
│       │   │   └── renderer.js    # Three.js rendu bloc
│       │   │
│       │   ├── game/
│       │   │   ├── controls.js    # Tactile + clavier
│       │   │   ├── physics.js     # Auto-avance, virage, dérapage
│       │   │   ├── camera.js      # Vue ortho top-down + zoom adaptatif
│       │   │   ├── powers.js      # Logique des 6 pouvoirs
│       │   │   ├── cohesion.js    # Jauge de cohésion
│       │   │   ├── impact.js      # Détection collision + raycasting voxels
│       │   │   ├── particles.js   # Cubes voxels qui s'envolent
│       │   │   ├── skid.js        # Skid marks
│       │   │   ├── offscreen.js   # Flèches indicateurs hors-écran
│       │   │   └── map-generator.js # Tirage au sort blocs + assemblage
│       │   │
│       │   ├── network/
│       │   │   ├── client.js      # Wrapper Socket.io côté client
│       │   │   ├── lobby.js       # Logique lobby
│       │   │   └── sync.js        # Sync état joueurs
│       │   │
│       │   └── storage/
│       │       ├── local.js       # localStorage helpers
│       │       └── gallery.js     # CRUD galerie véhicules
│       │
│       └── /pages                 # Scripts d'entrée par page
│           ├── index-page.js
│           ├── scan-page.js
│           ├── lobby-page.js
│           ├── game-page.js
│           ├── spectator-page.js
│           └── gallery-page.js
│
└── /tests                         # Tests unitaires (V1.x)
    ├── /fixtures                  # Photos de feuilles pour mock scan
    │   ├── vehicle-clean.jpg
    │   ├── vehicle-tilted.jpg
    │   └── ...
    └── ...
```

---

## 3. Pipeline de scan détaillé

### Vue d'ensemble du pipeline véhicule

```
[Stream caméra]
      │
      ▼
[capture.js] ─→ frame ImageData
      │
      ▼
[qr-detect.js] ─→ { tl, tr, bl, br } 4 coordonnées
      │
      ▼
[perspective.js] ─→ ImageData redressée (taille fixe)
      │
      ▼
[segmenter.js] ─→ { face: ImageData, profile: ImageData, top: ImageData, patch: ImageData }
      │
      ▼
[calibration.js] ─→ { hslTargets: { red: {h, s, l}, green: ..., ... } }
      │
      ▼
[color-reader.js] ─→ { face: 4x4 grid, profile: 8x4 grid, top: 8x4 grid }
      │           (chaque case = couleur classifiée ou null)
      ▼
[voxel/builder.js] ─→ grid: 4x4x8 array { color | null }
      │
      ▼
[voxel/wheel-detector.js] ─→ wheelPositions: [4 x {x, y, z}]
      │
      ▼
[voxel/stats.js] ─→ { stats: { speed, grip, accel }, powers: { aspiration, ... } }
      │
      ▼
[JSON véhicule final]
```

À chaque étape, `debug-view.js` peut intercepter la sortie et l'afficher.

### Mode debug visuel

Page `scan.html` en mode debug (toggle UI) affiche en grille :

| 1. Photo brute | 2. QR détectés en surimpression |
| 3. Image redressée | 4. Patch couleur lu + cibles HSL |
| 5. Vue de face segmentée + couleurs lues | 6. Vue de profil idem |
| 7. Vue de dessus idem | 8. Voxel reconstruit en rotation libre |

Toggle "Slider HUE/SAT" pour ajustement manuel en cas d'échec calibration auto.

### Calibration via patch

Le patch couleur (zone A04) contient 6 carrés imprimés correspondant aux 6 couleurs cibles. Au début du scan :

1. Localisation du patch (coordonnées en dur d'après le layout)
2. Lecture HSL moyen de chaque carré
3. Stockage des 6 valeurs comme cibles de référence pour la session de scan
4. Toute case du véhicule sera classifiée en cherchant la cible HSL la plus proche dans l'espace HSL (distance euclidienne pondérée, plus de poids sur H que sur S et L)

Cela compense automatiquement l'éclairage ambiant et la marque de feutre utilisée.

### Détection des roues — algorithme

```javascript
// Pseudo-code
function detectWheels(faceGrid, profileGrid, topGrid) {
  // 1. Vue de profil : trouver les positions avant-arrière
  const bottomRow = profileGrid[0]; // y=0
  let frontX, backX;

  if (bottomRow.some(c => c !== null)) {
    backX = bottomRow.findIndex(c => c !== null);
    frontX = bottomRow.findLastIndex(c => c !== null);
  } else {
    // Fallback : extrémités du véhicule
    backX = 0;
    frontX = 7;
  }

  // 2. Vue de dessus : pour chaque position avant et arrière, trouver l'écartement
  function getWidthAtX(x) {
    const column = topGrid.map(row => row[x]);
    const filled = column.map((c, i) => c !== null ? i : -1).filter(i => i >= 0);
    if (filled.length === 0) return [0, 3]; // fallback : largeur max
    return [Math.min(...filled), Math.max(...filled)];
  }

  const [backLeft, backRight] = getWidthAtX(backX);
  const [frontLeft, frontRight] = getWidthAtX(frontX);

  // 3. Construire les 4 positions de roues (en coordonnées voxel)
  return [
    { x: backX, y: -0.3, z: backLeft },     // arrière gauche
    { x: backX, y: -0.3, z: backRight },    // arrière droite
    { x: frontX, y: -0.3, z: frontLeft },   // avant gauche
    { x: frontX, y: -0.3, z: frontRight }   // avant droite
  ];
}
```

Les roues sont rendues comme des cylindres aplatis Three.js, légèrement saillants sur les côtés, toujours visibles. Le `y: -0.3` les fait dépasser sous le châssis voxel.

---

## 4. Format JSON pivot

### Véhicule

```json
{
  "id": "veh_2026-04-28_142337_abc",
  "playerName": "Sami",
  "createdAt": "2026-04-28T14:23:37Z",
  "grid": [
    [
      [null, null, null, null, null, null, null, null],
      [null, "red", "red", "red", "red", "red", "red", null],
      [null, "orange", null, null, null, null, "orange", null],
      [null, null, null, null, null, null, null, null]
    ]
  ],
  "wheelPositions": [
    { "x": 1, "y": -0.3, "z": 0 },
    { "x": 1, "y": -0.3, "z": 3 },
    { "x": 6, "y": -0.3, "z": 0 },
    { "x": 6, "y": -0.3, "z": 3 }
  ],
  "stats": {
    "speed": 8,
    "grip": 0,
    "accel": 0
  },
  "powers": {
    "aspiration": 0,
    "shield": 4,
    "attraction": 0,
    "heal": 0
  },
  "voxelCount": 8
}
```

`grid` est indexé `[x][z][y]` ou `[y][z][x]` (à fixer en convention dans le code, documenter dans `voxel/builder.js`).

### Bloc map

```json
{
  "id": "block_2026-04-28_atelier-bordeaux-1",
  "name": "Le passage glissant",
  "createdAt": "2026-04-28T17:00:00Z",
  "atelier": "Atelier Bordeaux 1",
  "grid": [
    ["dur", "dur", null, null, null, null, "dur", "dur"],
    ["dur", null, null, "ramp", "ramp", null, null, "dur"],
    [null, null, "sticky", "sticky", "sticky", "sticky", null, null],
    [null, null, "sticky", "sticky", "sticky", "sticky", null, null],
    [null, null, "sticky", "sticky", "sticky", "sticky", null, null],
    [null, null, "sticky", "sticky", "sticky", "sticky", null, null],
    ["dur", null, null, "boost", "boost", null, null, "dur"],
    ["dur", "dur", null, null, null, null, "dur", "dur"]
  ]
}
```

### État de partie (en mémoire serveur, broadcast Socket.io)

```json
{
  "matchId": "match_xyz",
  "status": "running",
  "startedAt": "2026-04-28T14:30:00Z",
  "map": {
    "blocks": [
      { "blockId": "block_seed_001", "position": [0, 0] },
      { "blockId": "block_atelier-bordeaux-1", "position": [1, 0] },
      ...
    ]
  },
  "players": {
    "veh_xxx": {
      "vehicle": { ... },
      "position": { "x": 0, "y": 0, "z": 5 },
      "rotation": 0.0,
      "velocity": { "x": 2.0, "z": 0 },
      "remainingVoxels": 8,
      "lostVoxels": []
    }
  },
  "cohesion": {
    "value": 0.85,
    "isFull": true
  }
}
```

---

## 5. Communication Socket.io

### Événements client → serveur

| Événement | Payload | Description |
|-----------|---------|-------------|
| `lobby:join` | `{ vehicle: {...} }` | Joueur rejoint le lobby avec son véhicule |
| `lobby:leave` | `{}` | Joueur quitte le lobby |
| `lobby:ready` | `{ ready: true }` | Joueur indique qu'il est prêt |
| `game:input` | `{ steering, braking }` | Inputs de pilotage à 30 Hz |
| `game:disconnect` | `{}` | Joueur quitte la partie |

### Événements serveur → client

| Événement | Payload | Description |
|-----------|---------|-------------|
| `lobby:update` | `{ players: [...] }` | Liste des joueurs en lobby |
| `lobby:start` | `{ matchId, map }` | Lancement de la partie |
| `game:state` | `{ players: {...}, cohesion }` | État partagé broadcast à 30 Hz |
| `game:event` | `{ type, data }` | Événements ponctuels (impact, voxel perdu, pouvoir activé) |
| `game:end` | `{ result: 'victory'|'defeat', vehicles: [...] }` | Fin de partie |

### Autorité serveur

Pour éviter les désync à 5 joueur·euses, le **serveur est autoritaire** sur :
- Position et rotation des véhicules (les inputs clients sont des intentions, le serveur calcule)
- Détection de collisions et perte de voxels
- Application des effets de pouvoirs partagés (aspiration, sillage, etc.)
- Calcul de la jauge de cohésion

Le client fait du **client-side prediction** simple sur son propre véhicule pour éviter le lag perçu, et applique des corrections quand l'état serveur arrive.

À 5 joueur·euses sur un réseau local, la simplicité prime sur l'optimisation. On peut commencer **sans prediction** et voir si la latence est gênante.

---

## 6. Configuration externalisée

### `/config/gameplay.json`

```json
{
  "vehicleStats": {
    "speedPerRedVoxel": 0.5,
    "gripPerGreenVoxel": 0.3,
    "accelPerBlueVoxel": 0.4,
    "baseSpeed": 5.0,
    "baseGrip": 1.0,
    "baseAccel": 2.0
  },
  "powers": {
    "aspiration": {
      "trianglePerOrangeVoxel": 0.5,
      "boostInside": 1.3
    },
    "shield": {
      "sizePerOrangeVoxel": 0.4,
      "absorption": 0.7
    },
    "wake": {
      "lifetimeSec": 7,
      "boostStrength": 1.2
    }
  },
  "cohesion": {
    "radiusUnits": 8,
    "fullThreshold": 0.8,
    "fullBonusMultiplier": 1.15
  },
  "match": {
    "playerCount": [2, 3, 4, 5],
    "obstacleScaleByCount": {
      "2": 0.5,
      "3": 0.7,
      "4": 0.85,
      "5": 1.0
    }
  }
}
```

### `/config/scan.json`

```json
{
  "hslTargets": {
    "red":    { "h": 0,   "s": 0.8, "l": 0.5 },
    "green":  { "h": 120, "s": 0.7, "l": 0.45 },
    "blue":   { "h": 220, "s": 0.8, "l": 0.5 },
    "orange": { "h": 30,  "s": 0.85, "l": 0.55 },
    "violet": { "h": 280, "s": 0.6, "l": 0.45 },
    "pink":   { "h": 340, "s": 0.6, "l": 0.7 }
  },
  "tolerance": {
    "hue": 25,
    "sat": 0.4,
    "light": 0.3
  },
  "minSaturation": 0.2,
  "centerSampleRatio": 0.6
}
```

### `/config/layout.json`

```json
{
  "vehicleSheet": {
    "width": 1200,
    "height": 850,
    "regions": {
      "face":    { "x": 100, "y": 500, "w": 200, "h": 200, "cols": 4, "rows": 4 },
      "profile": { "x": 350, "y": 500, "w": 400, "h": 200, "cols": 8, "rows": 4 },
      "top":     { "x": 350, "y": 250, "w": 400, "h": 200, "cols": 8, "rows": 4 },
      "patch":   { "x": 50,  "y": 750, "w": 600, "h": 60 }
    }
  },
  "blockSheet": {
    "width": 1200,
    "height": 850,
    "regions": {
      "grid": { "x": 200, "y": 100, "w": 800, "h": 600, "cols": 8, "rows": 8 }
    }
  }
}
```

---

## 7. Gestion du pool de blocs

### Lecture au démarrage serveur

```javascript
// server.js (extrait)
import { promises as fs } from 'fs';
import path from 'path';

async function loadBlockPool() {
  const seedDir = './data/map-blocks/_seed';
  const generatedDir = './data/map-blocks/generated';
  const seed = await readJsonsFromDir(seedDir);
  const generated = await readJsonsFromDir(generatedDir);
  return [...seed, ...generated];
}

const blockPool = await loadBlockPool();
console.log(`Pool de ${blockPool.length} blocs chargés`);
```

### Sauvegarde d'un nouveau bloc (atelier)

Pendant la phase 7, le scan du bloc collectif renvoie un JSON. L'animateur·trice peut l'enregistrer via une route admin simple :

```
POST /admin/blocks
Body: { name, atelier, grid }
→ écrit le fichier dans /data/map-blocks/generated/
```

En V1, cette route est protégée par un mot de passe en dur ou une IP localhost. **Pas d'interface graphique d'admin en V1** : l'animateur·trice utilise un bouton de debug ou ouvre directement la route depuis le navigateur.

### Tirage de la map

```javascript
// game/map-generator.js
function generateMap(blockPool, playerCount) {
  const obstacleScale = config.match.obstacleScaleByCount[playerCount];
  const targetLength = Math.floor(10 * obstacleScale);
  const map = [];

  for (let i = 0; i < targetLength; i++) {
    const block = blockPool[Math.floor(Math.random() * blockPool.length)];
    if (isPathable(map, block)) {
      map.push({ blockId: block.id, position: [i, 0] });
    } else {
      i--; // retry
    }
  }
  return map;
}
```

`isPathable` est une fonction simple qui vérifie que le bloc s'aligne avec le précédent (au moins une case d'entrée et de sortie alignées). Algorithme à raffiner après les premiers tests.

---

## 8. Galerie côté client (localStorage)

### API

```javascript
// modules/storage/gallery.js
export const Gallery = {
  list() {
    return Object.keys(localStorage)
      .filter(k => k.startsWith('vehicle:'))
      .map(k => JSON.parse(localStorage.getItem(k)));
  },

  save(vehicle) {
    const key = `vehicle:${vehicle.id}`;
    localStorage.setItem(key, JSON.stringify(vehicle));
  },

  get(id) {
    return JSON.parse(localStorage.getItem(`vehicle:${id}`));
  },

  remove(id) {
    localStorage.removeItem(`vehicle:${id}`);
  },

  count() {
    return this.list().length;
  }
};
```

### Limites

`localStorage` est limité à ~5-10 Mo selon le navigateur. Un véhicule fait ~1-2 Ko en JSON, donc ~2500 véhicules max par device. Largement suffisant pour l'usage atelier.

### Page galerie

`gallery.html` liste les véhicules en grid avec vignette (Three.js mini-canvas par véhicule), nom, date. Tap → modale avec véhicule en grand, rotatif, et bouton supprimer.

---

## 9. Game feel — implémentation

### Skid marks

Liste de quads texturés au sol, ajoutés à chaque frame quand `velocity > seuil && |angularVelocity| > seuil`. Durée de vie 5 sec, fade out via shader simple. Pool de 200 quads recyclés pour éviter la création/destruction d'objets.

### Particules d'impact

Quand un voxel se détache : on instancie 1 cube voxel libre (couleur du voxel perdu), avec une vélocité aléatoire vers le haut + biais du vecteur d'impact. Gravité applicable. Disparaît au sol après 3 sec ou reste visible (selon EJ02 vs E16).

### Screen shake

À l'impact, perturbation de la position de la caméra par un offset 2D décroissant exponentiellement sur 0.3 sec. Magnitude proportionnelle à la vitesse de collision.

### Indicateurs hors-écran

Pour chaque coéquipier·ère : si sa position projetée sort du frustum caméra, dessin d'une flèche 2D sur le bord de l'écran à la position projetée clampée. Couleur = couleur dominante du véhicule.

```javascript
// game/offscreen.js
function drawOffscreenIndicators(ctx, players, camera) {
  for (const p of players) {
    const screenPos = projectToScreen(p.position, camera);
    if (isOnScreen(screenPos, ctx.canvas)) continue;

    const clamped = clampToBorder(screenPos, ctx.canvas);
    const angle = Math.atan2(screenPos.y - center.y, screenPos.x - center.x);
    drawArrow(ctx, clamped, angle, p.dominantColor);
  }
}
```

---

## 10. Plan de développement par phases

Aligné sur le brainstorm + intégrant les nouvelles décisions :

### Phase 0 — Maquette papier (1 semaine)

- Imprimer la feuille véhicule A3 vide avec 3 grilles + 4 QR placeholder + patch + légende
- Imprimer la feuille bloc A3 vide avec grille 8×8 + 4 QR + légende des 4 symboles
- Faire colorier 3-5 personnes du Collectif
- Observer, ajuster la mise en page

**Livrable** : `feuille-vehicule-A3.pdf` et `feuille-bloc-A3.pdf` validés.

### Phase 1 — Pipeline scan véhicule seul (2-3 semaines)

- HTML/JS + OpenCV.js + jsQR
- Modules : capture, qr-detect, perspective, segmenter, color-reader, calibration
- Mode debug visuel à chaque étape
- Sortie : JSON véhicule (sans 3D)

**Livrable** : page `scan.html` qui affiche le pipeline et exporte le JSON véhicule.

### Phase 2 — Reconstruction 3D + roues (1 semaine)

- voxel/builder.js (union 2-sur-3)
- voxel/wheel-detector.js
- voxel/renderer.js (Three.js)
- Page `scan.html` étendue avec écran de validation rotative

**Livrable** : on colorie une feuille, on scanne, on voit son véhicule 3D avec roues qui tourne.

### Phase 3 — Single player + map test (2-3 semaines)

- game/controls.js (tactile + clavier)
- game/physics.js (auto-avance, virage, freinage)
- game/camera.js (ortho top-down, zoom adaptatif)
- game/map-generator.js (avec 2-3 blocs seed manuels)
- game/skid.js (juicy de base)
- Une map de test fixe avec 4 symboles

**Livrable** : on conduit son véhicule en solo sur une map de test.

### Phase 4 — Pouvoirs et perte de voxels (2 semaines)

- game/powers.js (rouge, vert, bleu, orange en P0)
- game/impact.js + raycasting voxels
- game/particles.js
- Effets visuels des pouvoirs (triangle aspiration, phares, sillage, bouclier)

**Livrable** : un véhicule perd des voxels à l'impact, les pouvoirs sont visibles et fonctionnels.

### Phase 5 — Multijoueur + cohésion (3-4 semaines)

- server.js avec Socket.io complet
- network/client.js
- network/lobby.js
- network/sync.js
- game/cohesion.js
- game/offscreen.js
- Tests à 2, 3, 5 joueur·euses

**Livrable** : 5 personnes peuvent rejoindre une partie depuis 5 tablettes du réseau local.

### Phase 6 — Pool de blocs cumulatif + scan bloc (2 semaines)

- block/builder.js (symboles 2D → meshes)
- block/renderer.js
- modules/scan/symbol-reader.js
- Route admin pour ajout de blocs au pool
- Visualisation live du bloc en cours de scan

**Livrable** : un atelier complet peut tourner, le pool s'enrichit.

### Phase 7 — Galerie + polish (1-2 semaines)

- gallery.html
- modules/storage/gallery.js
- Particules, screen shake, feedback activation pouvoirs
- Écran de fin avec photos des véhicules

**Livrable** : V1 prête à être testée en interne au Collectif.

### Phase 8 — Polish son + V1.x

- Module G (audio)
- Pouvoirs P1 (violet, rose)
- Voxels au sol persistants (E16)
- Trace cohésion (EJ06)

---

## 11. Points d'attention pour les sessions code AI

### Recommandations pour les stories

Quand tu découperas en stories pour Phase 4 BMAD, garde ces principes :

1. **Une story = un module ou sous-module fonctionnel testable seul.** Ex : "Implémenter qr-detect.js avec test sur 3 images fixtures" plutôt que "Implémenter le scan".
2. **Toujours commencer par le contrat JSON.** Avant de coder un module, écrire dans la story : "Entrée JSON : { ... }, sortie JSON : { ... }". L'IA peut ensuite respecter strictement.
3. **Mode debug en parallèle, pas après.** Chaque module debug-able dès sa première version.
4. **Fixtures pour scan.** Photos de feuilles dans `/tests/fixtures/` à fournir à l'IA pour qu'elle puisse mocker le pipeline sans webcam.
5. **Configurations externalisées en premier.** Les fichiers `/config/*.json` doivent exister dès le début, l'IA s'y réfère systématiquement.

### Dépendances entre modules à respecter

```
capture → qr-detect → perspective → segmenter → calibration → color-reader → builder → wheel-detector → stats
                                                                          ↓
                                                                        renderer
```

Ne pas commencer le builder avant que color-reader soit stable, etc.

### Découplage strict client/serveur

Le serveur ne charge **jamais** de code Three.js, de DOM, ou de logique de rendu. Tout ce qui est rendu est dans `/public/js`. Tout ce qui est état partagé et calcul autoritaire est dans `server.js` ou des modules importés par lui.

---

## 12. Risques techniques spécifiques

### Risque T1 — OpenCV.js trop lourd au chargement

OpenCV.js fait ~10 Mo. Sur un réseau local Wi-Fi ce n'est pas critique, mais le premier chargement peut prendre 5-10 sec. Mitigation : écran de chargement clair, cache navigateur agressif.

### Risque T2 — Désync Socket.io à 5 joueurs

À 30 Hz × 5 joueurs × état complet, on est à ~150 kB/sec/client. Réseau local OK mais dépendance au Wi-Fi de la salle. Mitigation : dropper à 20 Hz si besoin, n'envoyer que les deltas.

### Risque T3 — Performance Three.js avec beaucoup de voxels au sol

Si E16 (voxels au sol persistants) est implémenté, on peut accumuler des centaines de voxels par partie. Mitigation : merge en geometry instancing après détachement, ou time-out de 30 sec avant disparition.

### Risque T4 — Détection des roues frustrante

Si le coloriage ne donne pas une rangée du bas claire, les roues peuvent être placées de façon inattendue. Mitigation : afficher les roues dans l'écran de validation, permettre re-scan, et offrir éventuellement un mode "ajustement manuel des roues" en V1.x.

### Risque T5 — Caméra ortho qui zoom out trop quand le groupe se disperse

Si la cohésion est mauvaise et le groupe explose, le zoom adaptatif rend tout le monde minuscule. Mitigation : clamp du zoom max, ou switch en mode multi-caméra split-screen au-delà d'un seuil de dispersion (V1.x).

---

## 13. Prochaines étapes BMAD

→ **Phase 4 — Stories** : découpage atomique de chaque phase de développement en tâches codables une par une via session AI. Format proposé : 1 story par module identifié dans la structure de fichiers (donc ~30-40 stories au total pour la V1).

---

*Document Architecture v0.1 — version de travail itérative.*
