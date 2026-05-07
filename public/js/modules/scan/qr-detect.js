// Détection des 4 QR codes de calage sur une frame ImageData.
// Contrat : detect(imageData) → { type, tl, tr, bl, br } | null
//
// Stratégie : jsQR ne détecte qu'un seul QR par appel.
// On découpe l'image en 4 quadrants et on cherche 1 QR dans chacun.
// Format QR : "popvroum-{type}-{coin}" — ex. "popvroum-vehicle-tl"
// Types reconnus : 'vehicle', 'block'
// Si les 4 QR ne sont pas du même type → null + rapport d'erreur.

let _onDebugResult = null;

/**
 * Détecte les 4 QR codes dans une frame et retourne leurs centres + le type de feuille.
 * @param {ImageData} imageData
 * @returns {{ type: 'vehicle'|'block', tl, tr, bl, br } | null}
 *   chaque coin est { x, y }
 */
export function detect(imageData) {
  const { width, height, data } = imageData;
  const mw = Math.floor(width  / 2);
  const mh = Math.floor(height / 2);

  const quadrants = [
    { id: 'tl', ox: 0,  oy: 0,  w: mw,        h: mh          },
    { id: 'tr', ox: mw, oy: 0,  w: width - mw, h: mh          },
    { id: 'bl', ox: 0,  oy: mh, w: mw,         h: height - mh },
    { id: 'br', ox: mw, oy: mh, w: width - mw, h: height - mh },
  ];

  const trouve    = {};   // coins validés (contenu reconnu)
  const rapportQuad = []; // détail brut de chaque quadrant (pour le debug)

  for (const quad of quadrants) {
    const pixels = _extraireQuadrant(data, width, quad);
    // attemptBoth : essaie fond clair ET fond sombre — plus robuste
    const code = jsQR(pixels, quad.w, quad.h, { inversionAttempts: 'attemptBoth' });

    const entree = { id: quad.id, detecte: !!code, contenuBrut: code?.data ?? null, coin: null };

    if (code) {
      const identifie = _identifierCoin(code.data);
      entree.coin = identifie?.coin ?? null;
      entree.type = identifie?.type ?? null;

      if (identifie) {
        const centre = _centreLocation(code.location);
        trouve[identifie.coin] = {
          x:        centre.x + quad.ox,
          y:        centre.y + quad.oy,
          type:     identifie.type,
          contenu:  code.data,
          location: _decalerLocation(code.location, quad.ox, quad.oy),
        };
      }
    }

    rapportQuad.push(entree);
    console.debug(`[qr-detect] quadrant ${quad.id} :`,
      code ? `"${code.data}"${entree.coin ? ` → coin ${entree.coin}` : ' → non reconnu'}` : 'rien');
  }

  const coinsPresents = Object.keys(trouve);
  const complet       = coinsPresents.length === 4;

  // Vérifier la cohérence des types (tous doivent être identiques)
  const typesDetectes = [...new Set(Object.values(trouve).map(c => c.type))];
  const typeMixte     = typesDetectes.length > 1;
  const type          = typesDetectes[0] ?? null;

  if (typeMixte) {
    console.warn('[qr-detect] Types mélangés :', typesDetectes.join(', '),
      '— feuilles différentes présentées simultanément ?');
  }

  if (_onDebugResult) {
    _onDebugResult({ trouve, coinsPresents, complet, type, typeMixte, rapportQuad, imageData });
  }

  if (!complet || typeMixte) return null;

  return {
    type,
    tl: { x: trouve.tl.x, y: trouve.tl.y },
    tr: { x: trouve.tr.x, y: trouve.tr.y },
    bl: { x: trouve.bl.x, y: trouve.bl.y },
    br: { x: trouve.br.x, y: trouve.br.y },
  };
}

/**
 * Enregistre un callback appelé après chaque détection pour debug-view.js.
 * Reçoit { trouve, coinsPresents, complet, rapportQuad, imageData }.
 */
export function onDebugResult(cb) {
  _onDebugResult = cb;
}

// Extrait les pixels RGBA d'un quadrant dans un nouveau Uint8ClampedArray
function _extraireQuadrant(srcData, srcWidth, { ox, oy, w, h }) {
  const dst = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) {
    const srcBase = ((oy + row) * srcWidth + ox) * 4;
    const dstBase = row * w * 4;
    dst.set(srcData.subarray(srcBase, srcBase + w * 4), dstBase);
  }
  return dst;
}

// Retourne { type, coin } depuis le contenu QR "popvroum-{type}-{coin}", ou null
// Types reconnus : 'vehicle', 'block'
// Coins reconnus : 'tl', 'tr', 'bl', 'br'
function _identifierCoin(contenu) {
  const TYPES = ['vehicle', 'block', 'v2'];
  const COINS = ['tl', 'tr', 'bl', 'br'];

  for (const type of TYPES) {
    for (const coin of COINS) {
      if (contenu === `popvroum-${type}-${coin}`) {
        return { type, coin };
      }
    }
  }
  return null;
}

// Centre géométrique des 4 coins de localisation jsQR
function _centreLocation({ topLeftCorner: tl, topRightCorner: tr,
                            bottomLeftCorner: bl, bottomRightCorner: br }) {
  return {
    x: (tl.x + tr.x + bl.x + br.x) / 4,
    y: (tl.y + tr.y + bl.y + br.y) / 4,
  };
}

// Décale toutes les coordonnées de localisation selon l'offset du quadrant
function _decalerLocation({ topLeftCorner, topRightCorner,
                              bottomLeftCorner, bottomRightCorner }, ox, oy) {
  const d = ({ x, y }) => ({ x: x + ox, y: y + oy });
  return {
    topLeftCorner:     d(topLeftCorner),
    topRightCorner:    d(topRightCorner),
    bottomLeftCorner:  d(bottomLeftCorner),
    bottomRightCorner: d(bottomRightCorner),
  };
}
