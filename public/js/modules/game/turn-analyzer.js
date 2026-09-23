// Analyseur de virage — mesure la forme de la trajectoire quand on braque.
//
// Le plaisir de conduite se joue dans la forme du virage : trop rond, la
// voiture est rigide et rate les enchaînements ; trop allongé, c'est une
// savonnette. Ce module transforme cette impression en chiffres.
//
// Un virage tenu traverse trois phases, qu'on règle avec des leviers différents :
//   1. l'entrée    — la courbure monte vite depuis la ligne droite. Sa longueur
//                    dépend de la rampe de volant (steerRampTime). Une entrée
//                    progressive est une clothoïde, la courbe des raccordements
//                    routiers entre une ligne droite et un virage.
//   2. l'escargot  — la courbure continue de monter, lentement, parce que la
//                    voiture perd de la vitesse dans le virage et peut donc
//                    serrer davantage. Dépend de l'adhérence et de la traînée.
//   3. le cercle   — la courbure ne bouge plus.
// Les mesurer ensemble donnait un indice qui dépendait surtout de la durée de
// tenue du virage ; on les sépare en repérant le « genou » de la courbe, là où la
// pente de la courbure retombe.
//
// Grandeurs mesurées sur chaque virage (du moment où l'on braque au moment où
// l'on relâche) :
//   entree.distance / entree.temps — longueur de la phase 1
//   entree.rayon                   — rayon atteint à la fin de l'entrée
//   rayonFinal                     — rayon au moment où l'on relâche
//   resserrement                   — rayon d'entrée / rayon final
//                                    1 : pas d'escargot · > 1 : le virage se
//                                    referme · < 1 : il s'ouvre (savonnette)
//   cercleAtteint                  — la courbure s'est-elle stabilisée ?
//                                    null si le virage est trop bref pour juger
//
// Et en continu : vitesse en % de vmax, accélération longitudinale, chrono
// 10 → 90 % de vmax.
//
// Module pur, sans DOM : testable sous Node.
//
// Contrat I/O :
//   createTurnAnalyzer()                  → analyseur
//   sampleTurn(analyseur, echantillon)    → void
//     echantillon = { dt, x, z, vx, vz, steer, vmax }
//       steer : entrée BRUTE du joueur (son intention), pas le braquage lissé —
//               le virage commence quand on appuie, rampe de volant comprise
//   getTurnReport(analyseur)              → { vitesse, vitessePct, accel,
//                                             chrono10a90, enCours, dernier }

// Paramètres de mesure, pas de gameplay : les changer ne modifie pas le jeu.
const SEUIL_BRAQUAGE = 0.05;   // en deçà, le joueur ne tourne pas
const VITESSE_MIN    = 0.5;    // u/s — en dessous, le cap du déplacement n'a pas de sens
const TAU_COURBURE   = 0.06;   // s — lissage léger du bruit d'une frame à l'autre
const TAU_ACCEL      = 0.15;   // s — l'accélération brute est trop nerveuse pour être lue
const DUREE_MIN      = 0.4;    // s — un coup de volant plus bref n'est pas un virage
const DISTANCE_MIN   = 1.0;    // u
const POINTS_MAX     = 1500;   // ~25 s à 60 fps
const PART_FINALE    = 0.2;    // dernier cinquième de la distance = état en fin de virage
const PAS_LECTURE    = 0.5;    // u — pas de ré-échantillonnage pour lire la pente de la courbure
const SEUIL_GENOU    = 0.35;   // la pente retombe sous 35 % de son pic : l'entrée est finie
const SEUIL_PLATEAU  = 0.05;   // courbure qui varie de moins de 5 % en fin de virage : cercle atteint
const TENUE_JUGEMENT = 1.0;    // s après l'entrée — en deçà, trop court pour dire si le cercle est atteint

export function createTurnAnalyzer() {
  return {
    t: 0,
    vitesse: 0, vitessePct: 0, accel: 0, vPrec: null,
    chronoArme: true, chronoDebut: null, chrono10a90: null,
    capPrec: null, kLisse: 0,
    virage:  null,
    dernier: null,
  };
}

export function sampleTurn(a, { dt, x, z, vx, vz, steer, vmax }) {
  if (!(dt > 0)) return;
  a.t += dt;

  const v = Math.sqrt(vx * vx + vz * vz);
  _mesurerVitesse(a, v, vmax, dt);
  const k = _courbure(a, vx, vz, v, dt);
  _suivreVirage(a, { x, z, v, k, steer, dt });
}

export function getTurnReport(a) {
  return {
    vitesse:     a.vitesse,
    vitessePct:  a.vitessePct,
    accel:       a.accel,
    chrono10a90: a.chrono10a90,
    enCours: a.virage
      ? { sens: a.virage.sens, distance: a.virage.s, points: a.virage.points }
      : null,
    dernier: a.dernier,
  };
}

// ---- Vitesse, accélération, chrono ----

function _mesurerVitesse(a, v, vmax, dt) {
  if (a.vPrec !== null) {
    const brute = (v - a.vPrec) / dt;
    a.accel += (brute - a.accel) * Math.min(1, dt / TAU_ACCEL);
  }
  a.vPrec      = v;
  a.vitesse    = v;
  a.vitessePct = vmax > 0 ? v / vmax : 0;

  // On chronomètre à partir de 10 % et non de l'arrêt : le temps passé immobile
  // avant de démarrer fausserait la mesure.
  if (a.vitessePct < 0.10) {
    a.chronoArme  = true;
    a.chronoDebut = null;
  } else if (a.chronoArme) {
    if (a.chronoDebut === null) a.chronoDebut = a.t;
    if (a.vitessePct >= 0.90) {
      a.chrono10a90 = a.t - a.chronoDebut;
      a.chronoArme  = false;
    }
  }
}

// ---- Courbure de la trajectoire ----

// On suit le cap du vecteur vitesse, pas l'orientation du nez : en glisse les
// deux divergent, et c'est la trajectoire réelle qu'on veut mesurer.
function _courbure(a, vx, vz, v, dt) {
  if (v < VITESSE_MIN) {
    a.capPrec = null;
    return 0;
  }
  const cap = Math.atan2(vz, vx);
  let k = 0;
  if (a.capPrec !== null) {
    let dCap = cap - a.capPrec;
    if (dCap >  Math.PI) dCap -= 2 * Math.PI;
    if (dCap < -Math.PI) dCap += 2 * Math.PI;
    k = dCap / (v * dt);
  }
  a.capPrec = cap;
  return k;
}

// ---- Découpage en virages ----

function _suivreVirage(a, { x, z, v, k, steer, dt }) {
  // Courbure lissée en continu, virage ou non : le point de départ d'un virage
  // doit refléter ce que faisait la voiture juste avant, sinon le saut initial
  // (volant instantané) est invisible et la pente de l'entrée est mal lue.
  const kAvant = a.kLisse;
  a.kLisse += (Math.abs(k) - a.kLisse) * Math.min(1, dt / TAU_COURBURE);

  const braque = Math.abs(steer) > SEUIL_BRAQUAGE;
  const sens   = Math.sign(steer);

  // Relâcher, ou changer de côté sans relâcher : le virage en cours est terminé
  if (a.virage && (!braque || sens !== a.virage.sens)) {
    const rapport = _analyser(a.virage);
    // Un coup de volant trop bref n'écrase pas la dernière vraie mesure
    if (rapport) a.dernier = rapport;
    a.virage = null;
  }
  if (!braque) return;

  if (!a.virage) {
    a.virage = { sens, debut: a.t, s: 0, points: [{ s: 0, t: 0, x, z, k: kAvant, v }] };
  }

  const vir = a.virage;
  vir.s += v * dt;
  if (vir.points.length < POINTS_MAX) {
    vir.points.push({ s: vir.s, t: a.t - vir.debut, x, z, k: a.kLisse, v });
  }
}

function _analyser(vir) {
  const pts = vir.points;
  if (pts.length < 8 || vir.s < DISTANCE_MIN) return null;
  const duree = pts[pts.length - 1].t;
  if (duree < DUREE_MIN) return null;

  const kFinal = _moyenneFinale(pts, vir.s);
  // On a braqué sans vraiment tourner (contre un mur, à l'arrêt)
  if (kFinal < 1e-3) return null;

  const lecture = _reechantillonner(pts, PAS_LECTURE);
  const { indexGenou, variationFinale } = _lirePentes(lecture);
  const genou = lecture[indexGenou];
  const kEntree = Math.max(genou.k, 1e-3);

  return {
    sens:     vir.sens,
    duree,
    distance: vir.s,
    entree: {
      distance: genou.s,
      temps:    genou.t,
      rayon:    1 / kEntree,
    },
    rayonFinal:    1 / kFinal,
    resserrement:  kFinal / kEntree,
    // null = virage trop bref après l'entrée pour trancher
    cercleAtteint: duree - genou.t < TENUE_JUGEMENT
      ? null
      : Math.abs(variationFinale) < SEUIL_PLATEAU,
    vitesseEntree: pts[0].v,
    vitesseSortie: pts[pts.length - 1].v,
    points:        pts,
  };
}

function _moyenneFinale(pts, distance) {
  const sFin = distance * (1 - PART_FINALE);
  let somme = 0, n = 0;
  for (const p of pts) {
    if (p.s >= sFin) { somme += p.k; n++; }
  }
  return n > 0 ? somme / n : 0;
}

// Ré-échantillonne la courbure à pas de distance fixe : la pente se lit mal sur
// des points irrégulièrement espacés (la vitesse change pendant le virage).
function _reechantillonner(pts, pas) {
  const fin = pts[pts.length - 1].s;
  const res = [];
  let j = 0;
  for (let s = 0; s <= fin; s += pas) {
    while (j < pts.length - 2 && pts[j + 1].s < s) j++;
    const p = pts[j], q = pts[j + 1];
    const u = q.s > p.s ? Math.max(0, Math.min(1, (s - p.s) / (q.s - p.s))) : 0;
    res.push({ s, t: p.t + (q.t - p.t) * u, k: p.k + (q.k - p.k) * u });
  }
  return res;
}

// Le genou est le premier point, après le pic de pente, où la courbure cesse de
// monter vite : c'est la fin de l'entrée et le début de l'escargot.
function _lirePentes(lecture) {
  const n = lecture.length;
  if (n < 5) return { indexGenou: n - 1, variationFinale: 1 };

  const pentes = [];
  for (let i = 1; i < n - 1; i++) {
    const ds = lecture[i + 1].s - lecture[i - 1].s;
    pentes.push({ i, p: (lecture[i + 1].k - lecture[i - 1].k) / ds });
  }

  let pic = pentes[0];
  for (const q of pentes) if (q.p > pic.p) pic = q;
  const retombee = pentes.find(q => q.i > pic.i && q.p < SEUIL_GENOU * pic.p);

  // Stabilisation jugée sur la courbure elle-même et non sur le pic de pente :
  // avec un volant instantané, ce pic est énorme et n'importe quel resserrement
  // lent passait pour un cercle déjà atteint.
  const kDebutFin = lecture[Math.floor(n * (1 - PART_FINALE))].k;
  const kFin      = lecture[n - 1].k;

  return {
    indexGenou:      retombee ? retombee.i : n - 1,
    variationFinale: (kFin - kDebutFin) / Math.max(kFin, 1e-3),
  };
}
