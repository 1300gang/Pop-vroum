**Pop Vroum — Stories & Tests**

Module E03 — Contrôle & Physique des Véhicules

*v1.0 · Mai 2026 · Collectif Mille Trois Cents*

# **Récapitulatif des phases**

| Phase | Titre | Stories | Prérequis |
| :---- | :---- | :---- | :---- |
| 1 | Physique de base | E03-S01 à S04 | Aucun |
| 2 | Système de drift | E03-S05 à S07 | Phase 1 |
| 3 | Surfaces \+ collisions | E03-S08 à S09 | Phase 2 |
| 4 | Réseau | E03-S10 | Phase 2 |
| 5 | VFX client | E03-S11 à S14 | Phase 4 |

# **Phase 1 — Physique de base**

## **E03-S01 — Ajout du vecteur velocity au state serveur**

| Champ | Valeur |
| :---- | :---- |
| Fichier | server.js (initialisation du state joueur) |
| Priorité | P0 — bloquant pour toutes les autres stories |
| Dépendances | Aucune |

### **Description**

Ajouter velocity: {x: 0, z: 0} au state initial de chaque joueur lors de sa connexion Socket.io. Migrer la logique de déplacement pour utiliser ce vecteur.

### **Contrat I/O**

Avant : state \= { position, angle, speed, drifting }

Après : state \= { position, velocity: {x, z}, angle, speed, drifting }

### **Critères d'acceptation**

* velocity existe dans le state lors de la connexion du joueur.

* velocity est initialisé à {x: 0, z: 0}.

* Aucun crash à la connexion.

### **Tests unitaires — E03-S01**

| ID | Cas de test | Entrée | Résultat attendu |
| :---- | :---- | :---- | :---- |
| T-S01-1 | Initialisation state | Connexion joueur | state.velocity \=== {x:0, z:0} |
| T-S01-2 | Persistance velocity | 3 frames sans input | velocity inchangé si pas de force |
| T-S01-3 | Indépendance velocity/angle | Rotation angle sans force | velocity ne change pas |

## **E03-S02 — Décomposition velocity en v\_forward / v\_lateral**

| Champ | Valeur |
| :---- | :---- |
| Fichier | public/js/modules/game/physics.js (nouveau) |
| Priorité | P0 |
| Dépendances | E03-S01 |

### **Description**

Créer le module physics.js qui expose les fonctions de décomposition vectorielle. Ce module est la fondation mathématique de tout le système.

### **Contrat I/O**

Input : velocity {x, z}, angle (radians) → Output : { v\_forward, v\_lateral, forward, right }

export function decompose(velocity, angle) {

  const forward \= { x: Math.cos(angle), z: Math.sin(angle) }

  const right   \= { x: \-Math.sin(angle), z: Math.cos(angle) }

  const v\_forward \= velocity.x\*forward.x \+ velocity.z\*forward.z

  const v\_lateral \= velocity.x\*right.x   \+ velocity.z\*right.z

  return { v\_forward, v\_lateral, forward, right }

}

### **Tests unitaires — E03-S02**

| ID | Cas de test | Entrée | Résultat attendu |
| :---- | :---- | :---- | :---- |
| T-S02-1 | Mouvement rectiligne | velocity={x:10, z:0}, angle=0 | v\_forward=10, v\_lateral=0 |
| T-S02-2 | Dérive pure | velocity={x:0, z:5}, angle=0 | v\_forward=0, v\_lateral=5 |
| T-S02-3 | Dérive à 45° | velocity={x:7.07, z:7.07}, angle=0 | v\_forward≈7.07, v\_lateral≈7.07 |
| T-S02-4 | Angle arbitraire | velocity={x:1, z:0}, angle=π/2 | v\_forward≈0, v\_lateral≈-1 |
| T-S02-5 | Vecteurs normalisés | Tout angle | |forward|=1.0, |right|=1.0 |

## **E03-S03 — Pipeline de forces (engine, grip, drag)**

| Champ | Valeur |
| :---- | :---- |
| Fichier | public/js/modules/game/physics.js |
| Priorité | P0 |
| Dépendances | E03-S02 |

### **Description**

Implémenter les trois forces du modèle. F\_engine pousse dans la direction angle. F\_lateral corrige la glisse. F\_drag ralentit.

### **Contrat I/O**

Input : state (velocity, angle), input (throttle, steer), stats (accel, grip), consts → Output : nouvelle velocity

### **Critères d'acceptation**

* Throttle \+1 → accélération dans la direction forward.

* Brake \-1 → décélération.

* Sans input : v\_lateral revient à 0 en \< 1s grâce au grip.

* Vitesse max plafonnée à vmax de la stat.

### **Tests unitaires — E03-S03**

| ID | Cas de test | Entrée | Résultat attendu |
| :---- | :---- | :---- | :---- |
| T-S03-1 | Accélération pure | throttle=1, v=0, angle=0 | velocity.x augmente, velocity.z≈0 |
| T-S03-2 | Freinage | throttle=-0.5, v\_forward=20 | v\_forward diminue |
| T-S03-3 | Correction latérale | v\_lateral=5, grip=12, pas de virage | v\_lateral → 0 en \< 1s |
| T-S03-4 | Drag seul | Tous inputs=0, v\_forward=20 | velocity décroît exponentiellement |
| T-S03-5 | Vitesse max | throttle=1 sur 10s, speed\_stat=0.5 | |velocity| ≤ vmax calculé |

## **E03-S04 — Rotation décorrélée de la vélocité**

| Champ | Valeur |
| :---- | :---- |
| Fichier | server.js (game loop) |
| Priorité | P0 |
| Dépendances | E03-S03 |

### **Description**

La rotation de angle est appliquée séparément de velocity. Tourner change où la voiture regarde, pas immédiatement sa trajectoire.

turn\_rate \= steer × TURN\_SPEED × clamp(|v\_forward| / 5, 0, 1\)

state.angle \+= turn\_rate × dt

### **Tests unitaires — E03-S04**

| ID | Cas de test | Entrée | Résultat attendu |
| :---- | :---- | :---- | :---- |
| T-S04-1 | Rotation à l'arrêt | v\_forward=0, steer=1 | angle ne change pas (turn\_rate=0) |
| T-S04-2 | Rotation en mouvement | v\_forward=10, steer=1 | angle tourne, velocity inchangée |
| T-S04-3 | Indépendance | 5 frames de rotation | velocity \!== direction de angle |

# **Phase 2 — Système de drift**

## **E03-S05 — Détection du drift et bascule de grip**

| Champ | Valeur |
| :---- | :---- |
| Fichier | public/js/modules/game/physics.js |
| Priorité | P0 |
| Dépendances | E03-S02, E03-S03 |

### **Description**

Calculer le seuil de drift selon v\_speed et grip\_stat. Basculer current\_grip entre grip\_normal et grip\_drift quand le seuil est dépassé.

drift\_threshold \= grip\_base × 1.2 × (1 \+ v\_speed/VMAX × 0.3)

is\_drifting     \= |v\_lateral| \> drift\_threshold && v\_speed \> 3.0

current\_grip    \= is\_drifting ? grip\_base × 0.20 : grip\_base / speed\_factor

### **Tests unitaires — E03-S05**

| ID | Cas de test | Entrée | Résultat attendu |
| :---- | :---- | :---- | :---- |
| T-S05-1 | Pas de drift à basse vitesse | v\_speed=2, v\_lateral=10 | is\_drifting=false |
| T-S05-2 | Déclenchement drift | v\_speed=15, v\_lateral=grand | is\_drifting=true |
| T-S05-3 | Grip réduit en drift | is\_drifting=true, grip\_stat=0.5 | current\_grip \= 0.20×grip\_base |
| T-S05-4 | Grip haut \= drift difficile | grip\_stat=0.8, v\_lateral=5, v\_speed=10 | is\_drifting=false |
| T-S05-5 | Grip bas \= drift facile | grip\_stat=0.3, v\_lateral=2, v\_speed=8 | is\_drifting=true |
| T-S05-6 | Seuil augmente avec vitesse | grip\_stat=0.5, v\_speed=5 puis 30 | threshold(30) \> threshold(5) |

## **E03-S06 — Oversteer en drift (DRIFT\_ROTATION\_BOOST)**

| Champ | Valeur |
| :---- | :---- |
| Fichier | public/js/modules/game/physics.js |
| Priorité | P0 |
| Dépendances | E03-S04, E03-S05 |

### **Description**

Quand la voiture est en drift, amplifier le turn\_rate proportionnellement à |v\_lateral|/v\_speed. C'est ce qui permet le 180° caractéristique du style PAKO.

if (is\_drifting): turn\_rate \*= (1 \+ DRIFT\_ROTATION\_BOOST × |v\_lateral|/v\_speed)

### **Tests unitaires — E03-S06**

| ID | Cas de test | Entrée | Résultat attendu |
| :---- | :---- | :---- | :---- |
| T-S06-1 | Turn\_rate amplifié en drift | is\_drifting=true, |v\_lateral|/v\_speed=0.5 | turn\_rate × 1.4 |
| T-S06-2 | Turn\_rate normal hors drift | is\_drifting=false | turn\_rate inchangé |
| T-S06-3 | 180° possible en PAKO | Profil PAKO, virage à fond 2s | angle tourne de ≥ 170° |

## **E03-S07 — Transfert de poids (oversteer / understeer)**

| Champ | Valeur |
| :---- | :---- |
| Fichier | public/js/modules/game/physics.js |
| Priorité | P1 |
| Dépendances | E03-S05 |

### **Description**

Accélérer fort réduit le grip latéral arrière (oversteer). Freiner fort réduit le grip latéral avant (understeer).

### **Tests unitaires — E03-S07**

| ID | Cas de test | Entrée | Résultat attendu |
| :---- | :---- | :---- | :---- |
| T-S07-1 | Oversteer à l'accélération | throttle=0.8, v\_speed=10 | F\_lateral réduit de 12% |
| T-S07-2 | Understeer au freinage | brake=0.5, v\_speed=20 | F\_lateral réduit de 10% |
| T-S07-3 | Pas d'effet à faible vitesse | throttle=0.8, v\_speed=2 | Pas de réduction |

# **Phase 3 — Surfaces et collisions**

## **E03-S08 — Multiplicateur de grip selon surface map**

| Champ | Valeur |
| :---- | :---- |
| Fichier | public/js/modules/game/physics.js \+ map-generator.js |
| Priorité | P1 |
| Dépendances | E03-S05 |

### **Description**

Lire le type de cellule de la map sous la position du véhicule et appliquer le multiplicateur de grip correspondant à F\_lateral.

| Type | surface\_grip | Effet |
| :---- | :---- | :---- |
| dur | 1.0 | Comportement de référence |
| sticky | 1.8 | Très difficile de drifter |
| boost | 0.6 | Facilite le drift \+ vitesse |

### **Tests unitaires — E03-S08**

| ID | Cas de test | Entrée | Résultat attendu |
| :---- | :---- | :---- | :---- |
| T-S08-1 | Surface dur \= référence | Cellule dur, v\_lateral=5, v\_speed=12 | is\_drifting identique au comportement de base |
| T-S08-2 | Sticky bloque le drift | Cellule sticky, v\_lateral=5, v\_speed=12 | is\_drifting=false ou durée \< moitié |
| T-S08-3 | Boost facilite le drift | Cellule boost, v\_lateral=3, v\_speed=10 | is\_drifting=true là où dur ne déclencherait pas |

## **E03-S09 — Rebond élastique sur murs (style PAKO)**

| Champ | Valeur |
| :---- | :---- |
| Fichier | server.js (collision detection) |
| Priorité | P0 |
| Dépendances | E03-S01 |

### **Description**

Quand velocity pousse le véhicule hors des limites ou dans un obstacle, appliquer un rebond sur la normale du mur. La composante tangentielle est conservée.

v\_normal  \= dot(velocity, wallNormal) × wallNormal

velocity \-= v\_normal × (1 \+ RESTITUTION)   // RESTITUTION \= 0.5

### **Tests unitaires — E03-S09**

| ID | Cas de test | Entrée | Résultat attendu |
| :---- | :---- | :---- | :---- |
| T-S09-1 | Rebond perpendiculaire | velocity={x:10, z:0}, mur normal={x:-1, z:0} | velocity.x → \-10×RESTITUTION, velocity.z=0 |
| T-S09-2 | Composante tangentielle conservée | velocity={x:10, z:5}, mur normal={x:-1, z:0} | velocity.z reste ≈5 après rebond |
| T-S09-3 | Rebond à 45° | velocity={x:7, z:7}, mur normal={x:-1, z:0} | velocity.z inchangé, velocity.x inversé |
| T-S09-4 | Pas de pénétration mur | 3 frames après collision | position ne traverse pas le mur |

# **Phase 4 — Réseau**

## **E03-S10 — Mise à jour payload game:state**

| Champ | Valeur |
| :---- | :---- |
| Fichier | server.js (émission Socket.io) \+ public/js/modules/network/sync.js |
| Priorité | P0 |
| Dépendances | E03-S01 |

### **Description**

Ajouter velocity et driftAngle au payload émis par le serveur. Mettre à jour sync.js côté client pour recevoir et stocker ces champs. Implémenter l'interpolation dead reckoning pour le joueur local.

### **Tests unitaires — E03-S10**

| ID | Cas de test | Entrée | Résultat attendu |
| :---- | :---- | :---- | :---- |
| T-S10-1 | velocity dans le payload | Émission game:state | payload.velocity existe et est {x, z} |
| T-S10-2 | driftAngle dans le payload | is\_drifting=true | payload.driftAngle est un nombre |
| T-S10-3 | Interpolation client | 2 états reçus à t0 et t1 | Position interpolée entre les deux sans saut |
| T-S10-4 | Latence \< 200ms | 5 clients connectés réseau local | RTT moyen \< 200ms |

# **Phase 5 — VFX client**

## **E03-S11 — Skid marks orientés sur velocity (tous joueurs)**

| Champ | Valeur |
| :---- | :---- |
| Fichier | public/js/modules/game/skid.js |
| Priorité | P0 (EJ01) |
| Dépendances | E03-S10 |

### **Description**

Modifier skid.js pour orienter les traces selon velocity et non angle. Activer les skid marks pour tous les joueurs (pas seulement le local). Intensité \= |v\_lateral|.

### **Tests unitaires — E03-S11**

| ID | Cas de test | Entrée | Résultat attendu |
| :---- | :---- | :---- | :---- |
| T-S11-1 | Orientation sur velocity | Drift à 45° (angle ≠ velocity) | Les skid marks suivent la trajectoire réelle |
| T-S11-2 | Skids pour joueur distant | Joueur 2 en drift | Skid marks visibles pour joueur 1 |
| T-S11-3 | Intensité proportionnelle | |v\_lateral|=2 vs |v\_lateral|=8 | Traces plus épaisses à 8 |
| T-S11-4 | Pas de skids hors drift | is\_drifting=false | Aucune trace générée |

## **E03-S12 — Particules de poussière (drift)**

| Champ | Valeur |
| :---- | :---- |
| Fichier | public/js/modules/game/particles.js |
| Priorité | P0 (EJ02) |
| Dépendances | E03-S10 |

### **Description**

Émettre des particules de poussière quand drifting=true et v\_speed \> 5\. Direction \= velocity. Ajouter étincelles lors des collisions murales en drift.

### **Tests unitaires — E03-S12**

| ID | Cas de test | Entrée | Résultat attendu |
| :---- | :---- | :---- | :---- |
| T-S12-1 | Émission poussière | drifting=true, v\_speed=8 | Particules émises direction velocity |
| T-S12-2 | Pas de particules trop lentes | drifting=true, v\_speed=2 | Aucune particule |
| T-S12-3 | Étincelles collision | Collision mur en drift | Étincelles émises direction normale mur |

## **E03-S13 — Roll visuel du véhicule en drift**

| Champ | Valeur |
| :---- | :---- |
| Fichier | public/js/modules/voxel/renderer.js |
| Priorité | P1 |
| Dépendances | E03-S10 |

### **Description**

Incliner le mesh du véhicule sur l'axe Z en drift pour renforcer la sensation physique. Interpolation lerp pour un retour progressif.

const rollAngle \= state.drifting ? \-steer\_input × 0.3 : 0

group.rotation.z \= THREE.MathUtils.lerp(group.rotation.z, rollAngle, 0.1)

### **Tests unitaires — E03-S13**

| ID | Cas de test | Entrée | Résultat attendu |
| :---- | :---- | :---- | :---- |
| T-S13-1 | Roll en drift | is\_drifting=true, steer=0.8 | group.rotation.z ≈ \-0.24 (interpolé) |
| T-S13-2 | Retour progressif | Sortie de drift | rotation.z revient à 0 progressivement |
| T-S13-3 | Pas de roll hors drift | is\_drifting=false | rotation.z → 0 |

## **E03-S14 — HUD jauge de drift**

| Champ | Valeur |
| :---- | :---- |
| Fichier | public/js/pages/game.js (HUD overlay) |
| Priorité | P1 (EJ — game feel) |
| Dépendances | E03-S10 |

### **Description**

Ajouter au HUD une jauge de "chaleur de drift" basée sur |v\_lateral| normalisé sur VMAX. S'allume en orange quand is\_drifting=true.

### **Tests unitaires — E03-S14**

| ID | Cas de test | Entrée | Résultat attendu |
| :---- | :---- | :---- | :---- |
| T-S14-1 | Jauge vide au repos | is\_drifting=false | Jauge à 0% |
| T-S14-2 | Jauge proportionnelle | |v\_lateral|=10, VMAX=35 | Jauge ≈ 28% |
| T-S14-3 | Couleur active | is\_drifting=true | Jauge orange/rouge |

# **Plan de test global — Avant implémentation**

## **Niveau 1 — Tests unitaires (node, sans UI)**

Chaque fonction de physics.js doit être testable avec un simple node test.js. JSON in, JSON out. Aucun Three.js, aucun Socket.io requis.

// Exemple test-physics.js

import { decompose } from './public/js/modules/game/physics.js'

const r \= decompose({ x: 10, z: 0 }, 0\)

console.assert(r.v\_forward \=== 10, 'v\_forward doit être 10')

console.assert(r.v\_lateral \=== 0,  'v\_lateral doit être 0')

## **Niveau 2 — Tests d'intégration (simulateur headless)**

Simuler N frames de jeu avec un état initial et des inputs fixes. Vérifier les propriétés de convergence et les seuils.

| Scénario | Inputs | Propriété vérifiée | Tolérance |
| :---- | :---- | :---- | :---- |
| Arrêt naturel | Tous inputs \= 0, v\_init \= {x:20, z:0} | |v| \< 0.5 en moins de 5s | ±0.1s |
| Drift PAKO | grip=0.3, throttle=1, steer=1 plein | is\_drifting=true en \< 0.5s | ±50ms |
| 180° PAKO | grip=0.3, steer=1 maintenu 2s | Variation angle ≥ 150° | ±20° |
| Kart stable | grip=0.7, throttle=0.8, steer=0.5 | is\_drifting reste false | Tolérance 0 |
| Rebond mur | velocity.x=15, contact mur x-normal | velocity.x \< 0 après rebond | Sign check |

## **Niveau 3 — Tests visuels (navigateur \+ mode debug)**

Ces tests nécessitent le rendu Three.js et ne peuvent pas être automatisés facilement. À réaliser manuellement avant le merge.

| Test | Critère visuel | Observateur |
| :---- | :---- | :---- |
| Décalage velocity/angle | La flèche bleue velocity diverge du nez orange du véhicule en drift | Développeur |
| Skid marks trajectory | Les traces suivent le chemin réel, pas l'orientation du véhicule | Développeur |
| Roll visuel | Le véhicule s'incline sur le côté pendant le drift | Développeur |
| Rebond lisible | La collision mur est lisible et non-frustrante | Animateur test |
| 5 joueurs sync | Pas de rubber banding visible à 5 clients réseau local | Animateur test |

## **Niveau 4 — Playtest qualitatif**

À réaliser avec un·e non-développeur·euse avant de valider le module.

* Le drift se déclenche-t-il de façon intuitive sans explication ?

* Un enfant de 10 ans peut-il contrôler le véhicule après 2 minutes ?

* La différence entre les profils de véhicule est-elle perceptible ?

* Les collisions mur sont-elles perçues comme justes ou frustrantes ?

*— Fin du document Stories & Tests —*