// Rendu du panneau « Forme du virage » de la page de test solo.
//
// Dessine la trajectoire du virage, son profil de courbure, et affiche les
// mesures produites par turn-analyzer.js. Outil de réglage du ressenti de
// conduite, jamais présenté aux participant·es.
//
// Couleurs : dégradé bleu → jaune doublé d'une épaisseur croissante. L'axe
// bleu-jaune reste lisible avec les daltonismes rouge-vert les plus courants, et
// l'épaisseur porte la même information pour qui ne distingue pas les teintes.
//
// Contrat I/O :
//   renderTurnPanel(rapport) → void   (rapport = getTurnReport(analyseur))
//   Éléments attendus : #vir-trace et #vir-courbure (canvas), #vir-entree,
//   #vir-r-entree, #vir-r-final, #vir-resserrement, #vir-cercle, #vir-pct,
//   #vir-pct-barre, #vir-accel, #vir-chrono

const BLEU          = [68, 136, 255];
const JAUNE         = [255, 209, 102];
const MARGE         = 14;
const SEGMENTS_MAX  = 400;   // au-delà, on sous-échantillonne le tracé à chaque frame

export function renderTurnPanel(rapport) {
  // Virage en cours : on le dessine pendant qu'il se construit, sans analyse.
  // Sinon : le dernier virage complet, avec son cercle final et ses phases.
  const analyse = rapport.enCours ? null : rapport.dernier;
  const virage  = rapport.enCours ?? rapport.dernier;

  _dessinerTrace(document.getElementById('vir-trace'), virage, analyse);
  _dessinerCourbure(document.getElementById('vir-courbure'), virage, analyse);
  _afficherMesures(rapport);
}

// ---- Trajectoire ----

function _dessinerTrace(cv, virage, analyse) {
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const w = cv.width, h = cv.height;
  ctx.clearRect(0, 0, w, h);

  const pts = virage?.points;
  if (!pts || pts.length < 4) {
    _texteVide(ctx, w, h, 'Tiens un virage à fond…');
    return;
  }

  const loc    = _repereLocal(pts);
  const centre = analyse ? _centreCercleFinal(pts, loc, analyse.rayonFinal) : null;
  const vers   = _cadrage(loc, centre, analyse?.rayonFinal ?? 0, w, h);

  if (centre) {
    const c = vers(centre);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(c.x, c.y, analyse.rayonFinal * vers.echelle, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  let kMax = 1e-3;
  for (const p of pts) if (p.k > kMax) kMax = p.k;

  const pas = Math.max(1, Math.floor(loc.length / SEGMENTS_MAX));
  ctx.lineCap = 'round';
  for (let i = pas; i < loc.length; i += pas) {
    const u = Math.min(1, pts[i].k / kMax);
    const a = vers(loc[i - pas]);
    const b = vers(loc[i]);
    ctx.strokeStyle = _melange(u);
    ctx.lineWidth   = 1 + 3 * u;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // Départ
  const d = vers(loc[0]);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(d.x, d.y, 3.5, 0, Math.PI * 2);
  ctx.fill();

  // Fin de l'entrée
  if (analyse) {
    const iGenou = pts.findIndex(p => p.s >= analyse.entree.distance);
    if (iGenou > 0) {
      const g = vers(loc[iGenou]);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(g.x, g.y, 5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

// Départ à l'origine, cap initial vers le haut : tous les virages se lisent dans
// le même sens, quelle que soit leur orientation sur la map.
function _repereLocal(pts) {
  const p0  = pts[0];
  const ref = pts[Math.min(pts.length - 1, 4)];
  const rot = Math.PI / 2 - Math.atan2(ref.z - p0.z, ref.x - p0.x);
  const c = Math.cos(rot), s = Math.sin(rot);
  return pts.map(p => {
    const dx = p.x - p0.x, dz = p.z - p0.z;
    return { x: dx * c - dz * s, y: dx * s + dz * c };
  });
}

// Le centre du cercle final est sur la normale à la trajectoire en fin de virage,
// du côté vers lequel elle s'enroule : un point pris plus tôt sur l'arc est
// toujours de ce côté-là de la tangente.
function _centreCercleFinal(pts, loc, rayon) {
  const n   = loc.length;
  const fin = loc[n - 1];
  const av  = loc[Math.max(0, n - 4)];
  let tx = fin.x - av.x, ty = fin.y - av.y;
  const tl = Math.hypot(tx, ty) || 1;
  tx /= tl;
  ty /= tl;

  const sTemoin = pts[n - 1].s - 0.8 * rayon;
  let j = n - 1;
  while (j > 0 && pts[j].s > sTemoin) j--;
  const temoin = loc[Math.min(j, Math.max(0, n - 3))];

  let nx = -ty, ny = tx;
  if ((temoin.x - fin.x) * nx + (temoin.y - fin.y) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { x: fin.x + nx * rayon, y: fin.y + ny * rayon };
}

// Échelle unique (pas de déformation) qui fait tenir la trajectoire et le cercle
// final dans le canevas, centrés.
function _cadrage(loc, centre, rayon, w, h) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const inclure = (x, y) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const p of loc) inclure(p.x, p.y);
  if (centre) {
    inclure(centre.x - rayon, centre.y - rayon);
    inclure(centre.x + rayon, centre.y + rayon);
  }

  const lx = Math.max(maxX - minX, 1);
  const ly = Math.max(maxY - minY, 1);
  const echelle = Math.min((w - 2 * MARGE) / lx, (h - 2 * MARGE) / ly);
  const ox = (w - lx * echelle) / 2;
  const oy = (h - ly * echelle) / 2;

  const vers = p => ({ x: ox + (p.x - minX) * echelle, y: h - oy - (p.y - minY) * echelle });
  vers.echelle = echelle;
  return vers;
}

// ---- Profil de courbure ----

// Courbure (1 / rayon) en fonction de la distance parcourue. Une entrée en
// clothoïde se lit comme une pente, l'escargot comme une montée lente, le cercle
// comme un palier.
function _dessinerCourbure(cv, virage, analyse) {
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const w = cv.width, h = cv.height;
  ctx.clearRect(0, 0, w, h);

  const pts = virage?.points;
  if (!pts || pts.length < 2) return;

  const sMax = Math.max(pts[pts.length - 1].s, 1e-3);
  let kMax = 1e-3;
  for (const p of pts) if (p.k > kMax) kMax = p.k;
  kMax *= 1.12;

  const X = s => 4 + (s / sMax) * (w - 8);
  const Y = k => h - 4 - (k / kMax) * (h - 8);

  if (analyse) {
    const xGenou = X(analyse.entree.distance);
    ctx.fillStyle = 'rgba(68, 136, 255, 0.14)';
    ctx.fillRect(4, 0, Math.max(0, xGenou - 4), h);

    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xGenou, 0);
    ctx.lineTo(xGenou, h);
    const yFinal = Y(1 / analyse.rayonFinal);
    ctx.moveTo(4, yFinal);
    ctx.lineTo(w - 4, yFinal);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.strokeStyle = `rgb(${JAUNE.join(', ')})`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(X(p.s), Y(p.k)) : ctx.lineTo(X(p.s), Y(p.k))));
  ctx.stroke();
}

// ---- Mesures ----

function _afficherMesures(rapport) {
  const d = rapport.dernier;
  _texte('vir-entree',       d ? `${d.entree.distance.toFixed(1)} u · ${d.entree.temps.toFixed(2)} s` : '–');
  _texte('vir-r-entree',     d ? `${d.entree.rayon.toFixed(1)} u` : '–');
  _texte('vir-r-final',      d ? `${d.rayonFinal.toFixed(1)} u` : '–');
  _texte('vir-resserrement', d ? _libelleResserrement(d.resserrement) : '–');
  _texte('vir-cercle',       !d ? '–'
                              : d.cercleAtteint === null ? 'tenir plus longtemps'
                              : d.cercleAtteint ? 'oui' : 'non');

  const pct = rapport.vitessePct * 100;
  _texte('vir-pct', `${pct.toFixed(0)} %`);
  const barre = document.getElementById('vir-pct-barre');
  if (barre) barre.style.width = `${Math.max(0, Math.min(100, pct))}%`;

  _texte('vir-accel',  `${rapport.accel >= 0 ? '+' : ''}${rapport.accel.toFixed(1)} u/s²`);
  _texte('vir-chrono', rapport.chrono10a90 !== null ? `${rapport.chrono10a90.toFixed(2)} s` : '–');
}

function _libelleResserrement(r) {
  const facteur = `×${r.toFixed(2)}`;
  if (r < 0.95) return `${facteur} s'ouvre`;
  if (r < 1.10) return `${facteur} stable`;
  return `${facteur} se resserre`;
}

// ---- Utilitaires ----

function _melange(u) {
  const c = BLEU.map((b, i) => Math.round(b + (JAUNE[i] - b) * u));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function _texte(id, valeur) {
  const el = document.getElementById(id);
  if (el) el.textContent = valeur;
}

function _texteVide(ctx, w, h, texte) {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(texte, w / 2, h / 2);
}
