# PRD — Pop Vroum · Pouvoirs (v1.6)

**Projet** : Pop Vroum
**Porteur** : 1k3vrtical / Collectif Mille Trois Cents
**Version** : 1.0 — 20 septembre 2026
**Document amont** : `docs/prd.md` v1.0 (vision, périmètre), `docs/architecture.md` v1.0 (état du code)

> Né d'une session de conception en 50 questions/réponses. Ce document décrit ce que
> doivent devenir les pouvoirs ; `architecture.md` décrit ce qui existe. Les deux ne
> disent pas la même chose, et c'est normal : presque rien n'est branché aujourd'hui.

---

## 1. État réel du code — à lire avant toute chose

> **Mise à jour du 24/09/2026.** Le tableau ci-dessous décrit l'état au 20/09. Depuis,
> les 4 pouvoirs codés sont branchés : `power-effects.js` calcule les effets
> (`computeEffects`) puis les agrège par cible (`foldEffects`) sans muter les stats ;
> `test-v5` et `server/game-loop.js` les appliquent, et `game-loop.js` appelle
> `absorbDamage()`. Restent vrais : violet et rose absents, perte de voxels non
> synchronisée entre clients.

| Constat (20/09) | Détail | Au 24/09 |
|---|---|---|
| `applyEffects()` n'est **jamais appelé** | `powers.update()` calcule et retourne les effets ; les 5 pages qui l'appellent jettent la valeur de retour | Résolu — remplacé par `computeEffects` / `foldEffects` |
| `absorbDamage()` n'est **jamais appelé** | La logique de bouclier dégressif existe mais reste morte | Résolu côté serveur (`game-loop.js`) |
| Violet et rose n'existent pas | `voxel/stats.js` calcule leurs valeurs, `game/powers.js` n'implémente que 4 pouvoirs | Toujours vrai |
| Les effets seraient faux s'ils étaient branchés | `target.stats.speed *= 1.3` mute l'objet stats à chaque frame, sans retour à la valeur de base : l'effet se cumulerait indéfiniment | Résolu — les effets ne mutent plus les stats |
| La perte de voxels n'est pas synchronisée | Purement locale à chaque client — deux joueurs ne voient pas le même état de dégâts | Toujours vrai (phase serveur) |

Ce qui existe et se garde : les visuels des 3 pouvoirs à effet (aspiration, phares,
sillage) et le dôme de bouclier. On construit dessus, on ne repart pas de zéro.

---

## 2. Principes

**P1 — La stat est égoïste, le pouvoir est altruiste.**
Le porteur profite de sa couleur à travers la **caractéristique** de son véhicule,
jamais à travers son propre pouvoir. Le pouvoir ne s'applique qu'aux autres. Ce sont
les coéquipier·ères qui doivent jouer avec ce qu'iels perçoivent du véhicule qui les
accompagne.

**P2 — Double tranchant systématique.**
Chaque pouvoir doit pouvoir nuire, pas seulement être moins utile. Un véhicule trop
rouge pousse les autres dans le mur. Le coût est **automatique et mécanique**, jamais
un choix à activer.

**P3 — Le choix se fait au coloriage.**
Pas d'activation en jeu, pas de bouton, pas de réserve à gérer (seule exception : le
bouclier, qui se détruit). L'arbitrage du/de la participant·e a lieu au moment où iel
colorie sa feuille.

**P4 — Une voiture monochrome ne doit pas être intéressante.**
C'est le propos du jeu. La conversion voxels → puissance suit une courbe saturante,
jamais linéaire (§4).

**P5 — Tout se mesure par rapport au véhicule, jamais à la map.**
Portées, rayons, cohésion : tout dérive du véhicule. La map est un obstacle variable ;
elle peut aller jusqu'à 64×64 blocs sans que les pouvoirs changent d'échelle.

**P6 — Tout s'arrête aux murs.** Aucun pouvoir ne traverse une cloison. La cohésion non plus.

---

## 3. Les six couleurs

Chaque couleur donne **une stat au porteur** et **un pouvoir aux autres**.

| Couleur | Stat (porteur) | Pouvoir (les autres) | État |
|---------|----------------|----------------------|------|
| Rouge | Vitesse | Aspiration — pousse ceux qui suivent | Visuel seul |
| Vert | Adhérence | Phares — stabilisent ceux qu'ils éclairent (+ flèche d'arrivée) | Visuel seul |
| Bleu | Accélération | Sillage — trace au sol qui relance ceux qui la traversent | Visuel seul |
| Orange | **Résistance** — casse moins vite | Bouclier — protège aussi les proches | Dôme visuel seul |
| Violet | **Ancrage** — subit moins les forces extérieures | Attraction — tire les autres vers soi | Inexistant |
| Rose | **Récupération** — retrouve lentement ses voxels | Soin — répare les autres | Inexistant |

Les trois stats en gras sont **nouvelles et à valider** : aujourd'hui `voxel/stats.js`
ne produit que vitesse, adhérence et accélération. Le raisonnement retenu est que
chaque stat est le pendant intime de son pouvoir — l'orange protège, le violet déplace,
le rose répare — mais d'autres associations sont possibles.

---

## 4. Courbe voxels → puissance

Linéaire aujourd'hui (`0,5 × voxels rouges`, etc.), ce qui récompense les voitures
monochromes. On passe à une courbe à seuil et saturation, par couleur :

```
n ≤ seuil          → 0            (le pouvoir ne s'allume pas)
n > seuil          → max × (n - seuil) / (n - seuil + demi)
```

- `seuil` — nombre de voxels en dessous duquel le pouvoir reste éteint
- `demi` — nombre de voxels au-delà du seuil qui donne la moitié de la puissance max
- `max` — asymptote

Même famille que `bandeStat()` déjà utilisé pour les stats physiques, qui sature déjà :
les stats et les pouvoirs auront donc le même comportement. Les trois paramètres sont
réglables par couleur dans le calibrateur (§9).

---

## 5. Les six pouvoirs en détail

### Rouge — Aspiration

- **Forme** : un triangle derrière le véhicule. Le code teste aujourd'hui un demi-disque, ce qui ne correspond pas au visuel — le triangle fait foi.
- **Effet** : pousse les véhicules situés dedans vers l'avant. Une vraie force, pas un multiplicateur de stat : c'est « le petit coup de pouce » pour rattraper celui qui mène.
- **Double tranchant** : un véhicule trop rouge pousse ses coéquipier·ères dans les murs.

### Vert — Phares

- **Forme** : cône avant, 45° de demi-angle.
- **Effet** : rend plus adhérents les véhicules éclairés.
- **Double tranchant** : éclairer quelqu'un devant soi, c'est l'aider à vous distancer.
- **Flèche d'arrivée** : reste attachée au vert — elle donne une direction, et n'est pas séparable du pouvoir. Elle ne s'active qu'au-delà d'un **nombre de verts élevé** (seuil distinct de celui des phares).

### Bleu — Sillage

- **Forme** : traces déposées au sol pendant la course.
- **Effet** : relance l'accélération de qui les traverse.
- **Singularité** : seul pouvoir qui persiste après le passage — c'est ce qui le rend unique, aucun autre ne doit laisser de trace.
- **À corriger** : durée de vie de 7 s beaucoup trop longue (70 unités de traînée à 10 u/s, soit plus de 4 blocmaps). À réduire au calibrage.

### Orange — Bouclier

- **Forme** : dôme autour du véhicule.
- **Effet** : absorbe les chocs **contre les murs et obstacles** (les véhicules ne se percutent pas entre eux). Protège aussi les véhicules présents dans le dôme, **un peu moins que le porteur**.
- **Usure** : se réduit à chaque choc encaissé. Une fois vidé, il est **définitivement perdu** pour la partie — pas de recharge.

### Violet — Attraction

- **Forme** : champ autour du véhicule.
- **Double effet** :
  1. tire physiquement les autres véhicules vers soi — c'est ce qui fait groupe ;
  2. élargit la tolérance de la jauge de cohésion (le groupe supporte d'être plus dispersé).
- **Double tranchant** : déplacer quelqu'un qui ne l'a pas demandé, potentiellement au mauvais moment.

### Rose — Soin

- **Forme** : aura autour du véhicule.
- **Effet** : réinstancie progressivement les voxels perdus des véhicules proches.
- **Règle narrative** : le soin ne répare **pas à l'identique**. On ne revient pas du voyage comme on est parti — un véhicule soigné peut revenir avec des pouvoirs différents de ceux qu'il avait perdus.
- **Voxels rendus = pouvoirs rendus**, avec un **toggle** pour désactiver ce lien pendant les tests. Le rythme de récupération est le garde-fou contre l'abus.
- **Cadrage** : « c'est l'écoute et l'empathie qui soignent, les infirmiers. »

---

## 6. Cohésion

- La cohésion est le **septième levier** du système, et se règle au même endroit que les pouvoirs (slider dédié dans le calibrateur).
- **Le groupe de cohésion est le plus gros groupe.** Quand les joueurs se dispersent en grappes, c'est la plus nombreuse qui fait référence — un·e isolé·e ne fait pas s'effondrer la jauge à lui seul.
- Le rayon se mesure **par rapport au véhicule** (P5) et **s'arrête aux murs** (P6).

---

## 7. Dégâts, usure et soin

- Les pouvoirs **s'affaiblissent visiblement en course** à mesure que les voxels tombent. Aucun avertissement : le/la participant·e le découvre.
- **Prérequis bloquant** : la perte de voxels doit passer côté serveur. Aujourd'hui elle est locale à chaque client, donc bouclier et soin n'ont aucun sens en multijoueur — chacun voit un état de dégâts différent.
- Coût réel de cette bascule : faible. Le serveur reçoit déjà la grille complète du véhicule au `lobby:join`, il ne la conserve simplement pas. Le raycast ne tourne qu'au moment du choc, jamais à chaque tick, et la diffusion se fait par événement (« ces voxels sont tombés »), pas dans le flux 30 Hz.

---

## 8. Autorité et réseau

Les pouvoirs passent **côté serveur**, comme la physique. Aujourd'hui chaque navigateur
calcule les siens, ce qui diverge forcément en multijoueur.

Coût mesuré : négligeable. Détection aspiration/phares ≈ 1 200 tests/s à 5 joueurs ;
sillage ≈ 28 000 tests/s au pire, du même ordre que les 19 000 tests de blocs/s que le
serveur fait déjà. Le travail est de la plomberie, pas du calcul.

Les visuels (dômes, cônes, traces, halos) restent côté client.

---

## 9. Calibrateur de pouvoirs

Une **page de test dédiée**, sur le modèle de l'outil de forme de virage
(`turn-analyzer.js` + `turn-view.js`, touche P).

Doit permettre de régler en direct, et de juger au ressenti :

- la courbe voxels → puissance par couleur (`seuil`, `demi`, `max`), avec la courbe tracée ;
- les portées et formes (triangle d'aspiration, cône des phares, rayons) ;
- la durée de vie du sillage ;
- l'absorption et l'usure du bouclier ;
- la force d'attraction et l'élargissement de tolérance de cohésion ;
- le rythme de récupération du soin, et le toggle « voxels rendus = pouvoirs rendus » ;
- le bonus de cohésion.

---

## 10. Lisibilité

- **Halos autour des véhicules** indiquant quelle couleur agit sur toi en ce moment. C'est la réponse au problème de fond : un pouvoir altruiste (P1) ne se ressent pas, il doit donc se voir.
- **Palette accessible aux daltonismes** : les pouvoirs s'identifient par la couleur, sur la feuille comme à l'écran, et le porteur du projet est daltonien. Une seconde clé de lecture (forme, position) accompagne la couleur.
- **Vocabulaire** : aspiration, phares, sillage, bouclier, attraction, soin — conservé pour l'instant, à retravailler pour l'atelier plus tard.
- La feuille imprimée décrit les effets **sans chiffres** : recalibrer ne force donc jamais à réimprimer.
- Une fiche animateur·trice (qui aide qui, en direct) viendra plus tard.

---

## 11. Périmètre v1.6 et ordre de travail

Les six pouvoirs sont repris **ensemble**, pas un par un. On en garde six.

1. **Calibrateur + courbe voxels → puissance** — débloque tout le reste, puisque le réglage se juge au ressenti avant d'être testé.
2. **Effets réels, en modificateurs temporaires** — un effet s'annule dès qu'on sort de la zone, il ne se cumule jamais (corrige le défaut du §1).
3. **Bascule serveur** des pouvoirs.
4. **Synchronisation de la perte de voxels** — prérequis du bouclier et du soin.
5. **Violet et rose** — les deux pouvoirs manquants.
6. **Halos et lisibilité.**

**Critère de réussite** : le ressenti du porteur du projet d'abord, puis la validation en test.

---

## 12. Points ouverts

- Les trois nouvelles stats (résistance, ancrage, récupération) sont une proposition, à valider ou remplacer.
- Le rayon de cohésion dérive du véhicule : reste à dire **duquel** dans un groupe (le plus gros véhicule, la moyenne, autre).
- Les pouvoirs font désormais que les véhicules **s'influencent physiquement** (aspiration qui pousse, attraction qui tire), alors que `prd.md` pose qu'ils ne se percutent jamais en V1. Les deux règles coexistent, mais il faut l'assumer explicitement.
- Priorité de l'effet quand un pouvoir recouvre une case spéciale (collant, boost) : traité **au cas par cas**, pas de règle générale — seul le sillage a sa règle (le sol l'emporte).
- v1.6 arrive avant ou après le premier atelier réel ? `prd.md` acte un premier atelier **sans** pouvoirs.

---

*PRD Pouvoirs v1.0 — les valeurs numériques vivent dans `/config/gameplay.json`. Ne jamais hardcoder.*
