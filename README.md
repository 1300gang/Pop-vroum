# Pop Vroum

Jeu coopératif phygital développé pour les ateliers du Collectif Mille Trois Cents.

Les participant·es colorient un véhicule sur une feuille papier (3 vues orthographiques), la scannent via la caméra du device, et le véhicule est reconstruit en 3D (grille de voxels 4×4×8). Jusqu'à 5 joueur·euses traversent ensuite une carte procédurale ensemble.

## Démarrage

```bash
npm install
node server.js
```

Ouvrir `http://localhost:3000` dans le navigateur.

## Stack

- Backend : Node.js 20+ + Express 4 + Socket.io 4
- Frontend : JS vanilla (ES modules), pas de bundler
- 3D : Three.js r150+
- Vision : OpenCV.js 4.x + jsQR 1.4

## Structure

```
/config/          — valeurs externalisées (gameplay, scan, layout)
/data/            — blocs de map JSON
/public/          — frontend statique
/docs/            — documentation du projet
```

Voir `docs/architecture.md` pour la structure détaillée et `docs/stories.md` pour le plan de développement.
