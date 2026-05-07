**Pop Vroum — PRD**

Module E — Contrôle & Physique des Véhicules

*v1.0 · Mai 2026 · Collectif Mille Trois Cents*

# **1\. Contexte et périmètre**

Ce PRD détaille le sous-module E03 « Contrôle véhicule » du PRD Pop Vroum v0.2. Il couvre le remplacement du modèle de mouvement scalaire actuel par un modèle vectoriel à vélocité persistante, le système de dérapage émergent style PAKO, et les retours visuels clients associés.

Le modèle actuel calcule la position en appliquant une vitesse scalaire dans la direction de l'angle à chaque frame. Cela produit un pivotement instantané sans glisse. L'objectif est d'introduire un vrai vecteur vélocité indépendant de l'orientation visuelle.

## **1.1 Liens avec le PRD principal**

| ID PRD | Fonctionnalité | Lien |
| :---- | :---- | :---- |
| E03 | Auto-avance \+ pilotage tactile | Remplacé par le nouveau modèle physique |
| EJ01 | Dérapage visible (skid marks) | Dépend du vecteur velocity et de v\_lateral |
| EJ02 | Particules d'impact | Dépend de drifting et v\_speed |
| F02 | 4 symboles de bloc (sticky, boost…) | Surface\_grip — à intégrer en Phase 3 |

# **2\. Objectifs du module**

* Remplacer le mouvement scalaire par un modèle vectoriel (velocity indépendante de angle).

* Drift émergent : le dérapage se déclenche naturellement quand la vitesse latérale dépasse le seuil de grip, sans input dédié.

* Rendre les stats véhicule (speed, grip, accel) physiquement significatives.

* Ajouter le support des surfaces de la map (sticky, boost, dur) via multiplicateur de grip.

* Collisions mur \= rebond élastique brutal (style PAKO).

* VFX client : skid marks orientés sur velocity, particules, roll visuel.

* Réseau : ajouter velocity \+ driftAngle au payload game:state.

# **3\. Modèle physique**

## **3.1 State serveur par véhicule**

Chaque joueur porte 5 propriétés physiques. velocity et angle sont intentionnellement indépendants — c'est la règle d'or du système.

| Propriété | Type | Description |
| :---- | :---- | :---- |
| position | {x, z} | Position monde. Inchangé. |
| velocity | {vx, vz} | NOUVEAU — vecteur vitesse réel du centre de masse. |
| angle | number (rad) | Orientation visuelle. Indépendant de velocity. |
| angularVelocity | number | Vitesse de rotation. Optionnel V1. |
| drifting | boolean | Calculé serveur. Client affiche uniquement. |

## **3.2 Vecteurs de base**

forward \= (cos(angle), sin(angle))

right   \= (-sin(angle), cos(angle))

v\_forward \= dot(velocity, forward)   // vitesse longitudinale

v\_lateral \= dot(velocity, right)     // vitesse latérale — clé du drift

## **3.3 Pipeline de forces par frame**

| Force | Formule | Notes |
| :---- | :---- | :---- |
| F\_engine | forward × throttle × accel\_stat × ENGINE\_BASE | throttle ∈ \[-1, 1\] |
| F\_lateral | \-right × v\_lateral × current\_grip × MASS | current\_grip \= normal ou drift |
| F\_drag | \-velocity × DRAG\_COEFF | Frottement aérodynamique |

Intégration Euler :

acceleration \= (F\_engine \+ F\_lateral \+ F\_drag) / MASS

velocity \+= acceleration \* dt

position \+= velocity \* dt

## **3.4 Constantes (gameplay.json)**

| Constante | Valeur | Rôle |
| :---- | :---- | :---- |
| MASS | 800 | Masse du véhicule (kg) |
| GRIP\_BASE | 12.0 | Coefficient de grip de base |
| DRIFT\_GRIP\_MULTIPLIER | 0.20 | Grip en drift \= 20% du grip normal |
| DRIFT\_THRESHOLD\_FACTOR | 1.2 | Seuil \= grip\_base × 1.2 × (1 \+ v/vmax × 0.3) |
| MIN\_DRIFT\_SPEED | 3.0 m/s | En dessous : pas de drift |
| DRIFT\_ROTATION\_BOOST | 0.8 | Oversteer amplifié en drift |
| DRAG\_COEFF | 1.8 | Frottement aérodynamique |
| VMAX\_GLOBAL | 35.0 m/s | Vitesse max globale (\~126 km/h) |
| TURN\_SPEED | 3.5 rad/s | Vitesse de rotation max |
| ENGINE\_BASE | 2500 | Force moteur de base |
| RESTITUTION | 0.5 | Coefficient de rebond mur (0.4-0.7) |
| ACCEL\_GRIP\_TRANSFER | 0.15 | Réduction grip lors de l'accélération |
| BRAKE\_GRIP\_TRANSFER | 0.20 | Réduction grip lors du freinage |

# **4\. Système de drift émergent**

## **4.1 Déclenchement**

Pas d'input dédié. Le drift se déclenche quand tourner trop fort à grande vitesse dépasse la capacité d'adhérence latérale.

drift\_threshold \= grip\_base × 1.2 × (1 \+ v\_speed/VMAX × 0.3)

is\_drifting     \= (|v\_lateral| \> drift\_threshold) && (v\_speed \> 3.0)

current\_grip    \= is\_drifting ? grip\_base × 0.20 : grip\_base / speed\_factor

*⚠ Le seuil augmente avec la vitesse. À haute vitesse, on peut prendre des virages plus serrés sans déclencher de drift. Comportement contre-intuitif mais meilleur feeling arcade.*

## **4.2 Oversteer en drift**

turn\_rate \= steer × TURN\_SPEED × clamp(|v\_forward| / 5, 0, 1\)

if (is\_drifting): turn\_rate \*= (1 \+ 0.8 × |v\_lateral| / v\_speed)

La rotation est appliquée à angle, jamais à velocity. C'est le décalage angle / velocity qui crée l'effet visuel de dérapage.

## **4.3 Transfert de poids (style Drive Rally)**

| Condition | Effet | Formule |
| :---- | :---- | :---- |
| throttle \> 0.3 && v\_speed \> 5 | Oversteer (arrière glisse) | F\_lateral \*= (1 \- throttle × 0.15) |
| brake \> 0.3 | Understeer (avant glisse) | F\_lateral \*= (1 \- brake × 0.20) |

## **4.4 Surfaces de la map (Phase 3\)**

| Type cellule | surface\_grip | Effet |
| :---- | :---- | :---- |
| dur | 1.0 | Asphalte normal, comportement de référence |
| sticky | 1.8 | Ralentit le drift, difficile de glisser |
| boost | 0.6 | Glisse facilitée \+ boost de vitesse |
| rampe | n/a | Impulsion hors du plan 2D (Phase 3+) |

## **4.5 Collisions mur (rebond PAKO)**

v\_normal \= dot(velocity, wallNormal) × wallNormal

velocity \-= v\_normal × (1 \+ RESTITUTION)

La composante tangentielle est conservée. La voiture ricoche sans freiner sur l'axe parallèle au mur.

# **5\. Mapping stats → physique**

Les stats (speed, grip, accel) issues du scan couleur se traduisent directement en paramètres physiques.

| Stat | Formule physique | Effet gameplay |
| :---- | :---- | :---- |
| speed | vmax \= VMAX × (0.6 \+ speed × 0.4) | Vitesse de pointe. Faible \= lent mais stable. |
| grip | grip\_base \= GRIP\_BASE × grip\_stat | Adhérence. Faible \= drift facile et long. |
| accel | F\_engine \= ENGINE\_BASE × accel\_stat | Force moteur. Élevé \= oversteer violent. |

# **6\. Protocole réseau**

## **6.1 Payload game:state (mis à jour)**

// Nouveau payload par joueur

{

  "playerId": "...",

  "position":   { "x": 12.5, "z": 34.2 },

  "velocity":   { "x": 8.2,  "z": 3.1  },  // NOUVEAU

  "angle":      1.45,

  "speed":      8.76,

  "drifting":   true,

  "driftAngle": 0.35                        // NOUVEAU (optionnel)

}

## **6.2 Fréquence et interpolation**

| Paramètre | Valeur |
| :---- | :---- |
| Émission serveur → client | 20 Hz min, 30 Hz idéal |
| Interpolation client | Linéaire position \+ angle entre deux états reçus |
| Dead reckoning joueur local | Même formule physique \+ buffer inputs |

# **7\. Feedback visuel client**

## **7.1 Skid marks**

* Affichés pour tous les joueurs en drift (pas seulement le joueur local).

* Orientation : direction de velocity, pas angle.

* Intensité : proportionnelle à |v\_lateral|.

  const driftAngle \= Math.atan2(velocity.z, velocity.x)

  if (drifting && |driftAngle| \> 0.2) { skid.emit(pos, driftAngle, speed, |v\_lateral| × 3\) }

## **7.2 Particules**

| Déclencheur | Type | Direction |
| :---- | :---- | :---- |
| drifting && v\_speed \> 5 | Poussière | velocity |
| collision mur en drift | Étincelles | normale du mur |
| drift maintenu \> 2s | Fumée | velocity |

## **7.3 Roll visuel**

const rollAngle \= drifting ? \-steer\_input × 0.3 : 0

group.rotation.z \= THREE.MathUtils.lerp(group.rotation.z, rollAngle, 0.1)

## **7.4 Caméra**

* Léger lag caméra (smooth follow) pour renforcer la sensation de poids.

* Légère rotation selon la vélocité moyenne du groupe (effet "courbe").

# **8\. Critères d'acceptation**

| ID | Critère | Méthode de vérification |
| :---- | :---- | :---- |
| CA-P1 | La voiture glisse latéralement après un virage serré à vitesse \> 10 m/s | Lecture de v\_lateral dans le debug |
| CA-P2 | Un 180° est réalisable en drift sur profil PAKO (grip 3/10) | Test manuel simulateur |
| CA-P3 | velocity et angle peuvent diverger d'au moins 30° | Log serveur pendant drift |
| CA-P4 | Les skid marks suivent la trajectoire réelle, pas le nez du véhicule | Observation visuelle |
| CA-P5 | Profil kart (grip 7/10) drifts peu ; profil PAKO (grip 3/10) drifts en permanence | Tests comparatifs |
| CA-P6 | Rebond mur : la composante tangentielle est conservée (pas d'arrêt brutal) | Test collision à 45° |
| CA-P7 | Latence réseau \< 200ms à 5 joueurs sur réseau local | Network tab DevTools |
| CA-P8 | Surface sticky réduit la durée de drift vs surface dur | Mesure frame par frame |

