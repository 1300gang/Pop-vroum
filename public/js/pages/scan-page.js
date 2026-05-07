// Point d'entrée de la page scanner — Stories 1.3 → 2.5
import * as Capture     from '../modules/scan/capture.js';
import * as QrDetect    from '../modules/scan/qr-detect.js';
import * as Perspective from '../modules/scan/perspective.js';
import * as Segmenter   from '../modules/scan/segmenter.js';
import * as Calibration from '../modules/scan/calibration.js';
import * as ColorReader from '../modules/scan/color-reader.js';
import * as HslTuner    from '../modules/scan/manual-hsl-tuner.js';
import * as DebugView   from '../modules/scan/debug-view.js';
import { buildVoxelGrid }                        from '../modules/voxel/builder.js';
import { detectWheels }                          from '../modules/voxel/wheel-detector.js';
import { computeStats }                          from '../modules/voxel/stats.js';
import { buildVehicleGroup, createPreviewScene } from '../modules/voxel/renderer.js';
import * as Gallery                              from '../modules/storage/gallery.js';

const videoEl          = document.getElementById('video-camera');
const msgErreur        = document.getElementById('message-erreur');
const msgChargement    = document.getElementById('message-chargement');
const panneauDebug     = document.getElementById('panneau-debug');
const btnDebug         = document.getElementById('btn-toggle-debug');
const btnCapture       = document.getElementById('btn-capture');
const btnDetectQr      = document.getElementById('btn-detect-qr');
const btnWarp          = document.getElementById('btn-warp');
const btnSegment       = document.getElementById('btn-segment');
const btnCalibrate     = document.getElementById('btn-calibrate');
const btnReadColors    = document.getElementById('btn-read-colors');
const btnBuildVoxel    = document.getElementById('btn-build-voxel');
const debugInfoVoxel   = document.getElementById('debug-info-voxel');
const canvasDebug      = document.getElementById('canvas-debug');
const debugInfoCapture = document.getElementById('debug-info-capture');
const debugInfoQr      = document.getElementById('debug-info-qr');
const debugInfoWarp    = document.getElementById('debug-info-warp');
const debugInfoSegment = document.getElementById('debug-info-segment');
const debugInfoCalibrate = document.getElementById('debug-info-calibrate');
const debugInfoColors  = document.getElementById('debug-info-colors');

let _dernierFrame      = null;
let _derniersCoins     = null; // { type, tl, tr, bl, br } — résultat de la dernière détection QR
let _typeFeuille       = null; // 'vehicle' | 'block' — type de la feuille détectée
let _derniereRedressée = null; // ImageData redressée (sortie de perspective.warp)
let _dernieresZones    = null; // { face, profile, top, patch } — sortie de segmenter
let _ciblesCalibrées   = null; // { red, green, ... } — sortie de calibration
let _ciblesAuto        = null; // sauvegarde des cibles calibrées auto (pour reset tuner)
let _dernieresGrilles  = null; // { face, profile, top } — sortie de color-reader (étape 6)

// --- Mosaïque debug-view (Story 1.11) ---
DebugView.init(document.getElementById('debug-mosaique'));

// --- Panneau tuner HSL (toggle indépendant du panneau debug) ---
const btnToggleTuner = document.getElementById('btn-toggle-tuner');
const tunerContenu   = document.getElementById('tuner-contenu');

btnToggleTuner.addEventListener('click', () => {
  const ouvert = tunerContenu.classList.toggle('cache');
  // cache = fermé, pas cache = ouvert
  btnToggleTuner.textContent = tunerContenu.classList.contains('cache') ? 'Afficher' : 'Masquer';
  // Initialiser le tuner à la première ouverture si pas encore fait
  if (!tunerContenu.classList.contains('cache') && !tunerContenu.hasChildNodes()) {
    _initTuner();
  }
});

// --- Hook debug QR : enregistré une fois, toujours actif ---
QrDetect.onDebugResult(({ trouve, coinsPresents, complet, type, typeMixte, rapportQuad, imageData }) => {
  if (!_dernierFrame) return;
  // Mosaïque : photo brute avec QR en surimpression
  DebugView.updateBrute(_dernierFrame, { trouve, complet, type });
  const frame = _dernierFrame;
  const ctx   = canvasDebug.getContext('2d');
  const lw    = Math.max(2, frame.width / 400);
  const fs    = Math.max(14, frame.width / 60);

  // Lignes de séparation des quadrants
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth   = 1;
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(frame.width / 2, 0);  ctx.lineTo(frame.width / 2, frame.height);
  ctx.moveTo(0, frame.height / 2); ctx.lineTo(frame.width, frame.height / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Contours des QR reconnus
  for (const [id, info] of Object.entries(trouve)) {
    const { topLeftCorner: tl, topRightCorner: tr,
            bottomRightCorner: br, bottomLeftCorner: bl } = info.location;
    ctx.strokeStyle = complet ? '#2ecc71' : '#f5a623';
    ctx.lineWidth   = lw;
    ctx.beginPath();
    ctx.moveTo(tl.x, tl.y); ctx.lineTo(tr.x, tr.y);
    ctx.lineTo(br.x, br.y); ctx.lineTo(bl.x, bl.y);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = complet ? '#2ecc71' : '#f5a623';
    ctx.font      = `bold ${fs}px monospace`;
    ctx.fillText(id.toUpperCase(), info.x + 6, info.y - 6);
  }

  const lignes = rapportQuad.map(q => {
    if (!q.detecte) return `${q.id.toUpperCase()} : rien`;
    if (!q.coin)    return `${q.id.toUpperCase()} : détecté "${q.contenuBrut}" — non reconnu`;
    return `${q.id.toUpperCase()} : ✓ "${q.contenuBrut}"`;
  });

  // Afficher le type de feuille détecté
  let typeLabel = '';
  if (typeMixte) {
    typeLabel = '<br><span style="color:#e74c3c">⚠ Types mélangés — présentez une seule feuille</span>';
  } else if (type && complet) {
    const icone = type === 'vehicle' ? '🚗' : '🧱';
    typeLabel = `<br><span style="color:#2ecc71">${icone} Feuille : ${type === 'vehicle' ? 'véhicule' : 'bloc'}</span>`;
  }

  debugInfoQr.innerHTML = lignes.join('<br>') + typeLabel;
});

// --- Toggle panneau debug (discret, visible par défaut) ---
btnDebug.addEventListener('click', () => {
  const fermé = panneauDebug.classList.toggle('cache');
  btnDebug.textContent = fermé ? '🔧' : '✕ debug';
});
// Texte initial (panneau ouvert)
btnDebug.textContent = '✕ debug';

// --- Bouton 1 : capture ---
btnCapture.addEventListener('click', () => {
  try {
    _dernierFrame  = Capture.captureFrame();
    _derniersCoins = null;
    canvasDebug.width  = _dernierFrame.width;
    canvasDebug.height = _dernierFrame.height;
    canvasDebug.getContext('2d').putImageData(_dernierFrame, 0, 0);
    debugInfoCapture.textContent = `${_dernierFrame.width} × ${_dernierFrame.height} px`;
    debugInfoQr.textContent   = '';
    debugInfoWarp.textContent = '';
    DebugView.updateBrute(_dernierFrame);
  } catch (err) {
    afficherErreur(err.message);
  }
});

// --- Bouton 2 : détection QR ---
btnDetectQr.addEventListener('click', () => {
  if (!_dernierFrame) {
    debugInfoQr.textContent = '⚠ Capture une frame d\'abord.';
    return;
  }
  canvasDebug.getContext('2d').putImageData(_dernierFrame, 0, 0);
  _derniersCoins = QrDetect.detect(_dernierFrame);
  _typeFeuille   = _derniersCoins?.type ?? null;
  const nbDebug  = _derniersCoins ? Object.keys(_derniersCoins).length - 1 : 0;
  _mettreAJourCompteurQr(nbDebug);

  if (_derniersCoins) {
    const icone = _typeFeuille === 'vehicle' ? '🚗' : '🧱';
    debugInfoWarp.textContent = `${icone} Feuille ${_typeFeuille} — prêt pour le redressement.`;
  } else {
    debugInfoWarp.textContent = '⚠ 4 QR nécessaires pour redresser.';
  }
});

// --- Bouton 3 : redressement de perspective ---
btnWarp.addEventListener('click', async () => {
  if (!_dernierFrame || !_derniersCoins) {
    debugInfoWarp.textContent = '⚠ Détecte les 4 QR d\'abord.';
    return;
  }
  debugInfoWarp.textContent = 'Redressement en cours…';
  try {
    _derniereRedressée = await Perspective.warp(_dernierFrame, _derniersCoins);
    canvasDebug.width  = _derniereRedressée.width;
    canvasDebug.height = _derniereRedressée.height;
    canvasDebug.getContext('2d').putImageData(_derniereRedressée, 0, 0);
    debugInfoWarp.textContent = `✓ Redressée : ${_derniereRedressée.width} × ${_derniereRedressée.height} px`;
    debugInfoSegment.textContent = 'Prêt pour la segmentation.';
    DebugView.updateRedressée(_derniereRedressée);
  } catch (err) {
    debugInfoWarp.textContent = '✗ Erreur : ' + err.message;
    console.error('[perspective]', err);
  }
});

// --- Bouton 4 : segmentation ---
btnSegment.addEventListener('click', async () => {
  if (!_derniereRedressée) {
    debugInfoSegment.textContent = '⚠ Redresse la feuille d\'abord.';
    return;
  }
  if (_typeFeuille === 'block') {
    debugInfoSegment.textContent = '🧱 Pipeline bloc — Story 6.x (pas encore implémenté).';
    return;
  }
  debugInfoSegment.textContent = 'Découpe en cours…';
  try {
    _dernieresZones = await Segmenter.segment(_derniereRedressée);
    const zones = _dernieresZones;

    // Affichage debug : dessiner les 4 zones côte-à-côte sur le canvas
    const noms    = Object.keys(zones);
    const padding = 8;

    // Calculer la taille totale nécessaire
    let totalW = padding;
    let maxH   = 0;
    for (const nom of noms) {
      totalW += zones[nom].width + padding;
      maxH = Math.max(maxH, zones[nom].height);
    }
    const labelH = 24; // hauteur pour le label texte
    canvasDebug.width  = totalW;
    canvasDebug.height = maxH + labelH + padding * 2;

    const ctx = canvasDebug.getContext('2d');
    ctx.fillStyle = '#0f0f23';
    ctx.fillRect(0, 0, canvasDebug.width, canvasDebug.height);

    let offsetX = padding;
    for (const nom of noms) {
      const zone = zones[nom];
      // Label
      ctx.fillStyle = '#f5a623';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(nom.toUpperCase(), offsetX, 16);
      // Image de la zone
      ctx.putImageData(zone, offsetX, labelH);
      // Contour
      ctx.strokeStyle = 'rgba(245,166,35,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(offsetX - 1, labelH - 1, zone.width + 2, zone.height + 2);

      offsetX += zone.width + padding;
    }

    const details = noms.map(n => `${n}: ${zones[n].width}×${zones[n].height}`).join(' | ');
    debugInfoSegment.textContent = `✓ ${noms.length} zones — ${details}`;
    // Mosaïque : afficher chaque vue sans grille (couleurs pas encore lues)
    if (zones.patch)   DebugView.updatePatch(zones.patch);
    if (zones.face)    DebugView.updateFace(zones.face);
    if (zones.profile) DebugView.updateProfil(zones.profile);
    if (zones.top)     DebugView.updateDessus(zones.top);
  } catch (err) {
    debugInfoSegment.textContent = '✗ Erreur : ' + err.message;
    console.error('[segmenter]', err);
  }
});

// --- Bouton 5 : calibration ---
btnCalibrate.addEventListener('click', async () => {
  if (!_dernieresZones?.patch) {
    debugInfoCalibrate.textContent = '⚠ Découpe les zones d\'abord.';
    return;
  }
  debugInfoCalibrate.textContent = 'Lecture du patch…';
  try {
    _ciblesCalibrées = await Calibration.calibrate(_dernieresZones.patch);
    _ciblesAuto = _ciblesCalibrées; // sauvegarde pour le reset du tuner
    // Si le tuner est ouvert, le mettre à jour avec les nouvelles cibles
    if (!tunerContenu.classList.contains('cache') && tunerContenu.hasChildNodes()) {
      HslTuner.reset(_ciblesCalibrées);
    }
    // Mosaïque : patch avec indicateurs HSL
    if (_dernieresZones?.patch) DebugView.updatePatch(_dernieresZones.patch, _ciblesCalibrées);

    // Affichage debug : une ligne par couleur avec un carré de couleur + valeurs HSL
    const couleurs = ['red', 'green', 'blue', 'orange', 'violet', 'pink'];
    const lignes = couleurs.map(nom => {
      const c = _ciblesCalibrées[nom];
      return `<span class="debug-color-dot" style="background:hsl(${c.h.toFixed(0)},${(c.s*100).toFixed(0)}%,${(c.l*100).toFixed(0)}%)"></span>`
           + `${nom} : H=${c.h.toFixed(0)}° S=${(c.s*100).toFixed(0)}% L=${(c.l*100).toFixed(0)}%`;
    });
    debugInfoCalibrate.innerHTML = lignes.join('<br>');
  } catch (err) {
    debugInfoCalibrate.textContent = '✗ Erreur : ' + err.message;
    console.error('[calibration]', err);
  }
});

// --- Tuner HSL : initialisation et callback ---
function _initTuner() {
  // Utiliser les cibles calibrées si disponibles, sinon les valeurs par défaut de scan.json
  const ciblesInit = _ciblesCalibrées || _ciblesDefaut();
  HslTuner.init(tunerContenu, ciblesInit, (nouvelles, reset) => {
    if (reset) {
      // Bouton "Réinitialiser" pressé — recharger les cibles auto
      if (_ciblesAuto) {
        HslTuner.reset(_ciblesAuto);
        _ciblesCalibrées = _ciblesAuto;
      }
    } else {
      // Nouveau réglage manuel → mettre à jour les cibles actives
      _ciblesCalibrées = nouvelles;
    }
    // Si les grilles ont déjà été lues, relancer automatiquement la lecture
    if (_dernieresZones) btnReadColors.click();
  });
}

// Cibles par défaut si calibration pas encore faite
async function _ciblesDefaut() {
  const resp = await fetch('/config/scan.json');
  const cfg  = await resp.json();
  return cfg.hslTargets;
}

// --- Bouton 6 : lecture couleurs ---
const COLOR_MAP = {
  red: '#EF4444', green: '#22C55E', blue: '#3B82F6',
  orange: '#F97316', violet: '#A855F7', pink: '#EC4899',
};

btnReadColors.addEventListener('click', async () => {
  if (!_dernieresZones || !_ciblesCalibrées) {
    debugInfoColors.textContent = '⚠ Calibre les couleurs d\'abord.';
    return;
  }
  debugInfoColors.textContent = 'Lecture en cours…';

  try {
    const layout = await fetch('/config/layout.json').then(r => r.json());
    const regions = layout.vehicleSheet.regions;

    const vues = ['face', 'profile', 'top'];
    const resultats = {};

    for (const nom of vues) {
      const zone = _dernieresZones[nom];
      const dims = { cols: regions[nom].cols, rows: regions[nom].rows };
      resultats[nom] = await ColorReader.readGrid(zone, dims, _ciblesCalibrées);
    }

    // Affichage debug : dessiner les 3 grilles colorées côte-à-côte
    const cellSize = 32;
    const padding  = 12;
    const labelH   = 20;

    let totalW = padding;
    for (const nom of vues) {
      totalW += regions[nom].cols * cellSize + padding;
    }
    const maxRows = Math.max(...vues.map(n => regions[n].rows));
    canvasDebug.width  = totalW;
    canvasDebug.height = maxRows * cellSize + labelH + padding;

    const ctx = canvasDebug.getContext('2d');
    ctx.fillStyle = '#0f0f23';
    ctx.fillRect(0, 0, canvasDebug.width, canvasDebug.height);

    let offsetX = padding;
    for (const nom of vues) {
      const grille = resultats[nom];
      const cols = regions[nom].cols;
      const rows = regions[nom].rows;

      // Label
      ctx.fillStyle = '#f5a623';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(nom.toUpperCase(), offsetX, 14);

      // Cases
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const x = offsetX + c * cellSize;
          const y = labelH + r * cellSize;
          const couleur = grille[c][r];

          // Fond coloré ou gris
          ctx.fillStyle = couleur ? COLOR_MAP[couleur] : '#2a2a3a';
          ctx.fillRect(x, y, cellSize - 1, cellSize - 1);

          // Bordure
          ctx.strokeStyle = 'rgba(255,255,255,0.15)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, cellSize - 1, cellSize - 1);

          // Initiale de la couleur
          if (couleur) {
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px monospace';
            ctx.fillText(couleur[0].toUpperCase(), x + 11, y + 20);
          }
        }
      }

      offsetX += cols * cellSize + padding;
    }

    // Mémoriser pour l'étape 7
    _dernieresGrilles = resultats;

    // Mosaïque : vues avec grilles colorées
    const layout2 = await fetch('/config/layout.json').then(r => r.json());
    const r2 = layout2.vehicleSheet.regions;
    if (_dernieresZones.face)
      DebugView.updateFace(_dernieresZones.face, resultats.face, { cols: r2.face.cols, rows: r2.face.rows });
    if (_dernieresZones.profile)
      DebugView.updateProfil(_dernieresZones.profile, resultats.profile, { cols: r2.profile.cols, rows: r2.profile.rows });
    if (_dernieresZones.top)
      DebugView.updateDessus(_dernieresZones.top, resultats.top, { cols: r2.top.cols, rows: r2.top.rows });

    // Résumé texte
    const resume = vues.map(nom => {
      const g = resultats[nom];
      const cols = regions[nom].cols;
      const rows = regions[nom].rows;
      let colored = 0;
      for (let c = 0; c < cols; c++)
        for (let r = 0; r < rows; r++)
          if (g[c][r]) colored++;
      return `${nom}: ${colored}/${cols * rows}`;
    });
    debugInfoColors.textContent = `✓ ${resume.join(' | ')}`;

  } catch (err) {
    debugInfoColors.textContent = '✗ Erreur : ' + err.message;
    console.error('[color-reader]', err);
  }
});

// --- Bouton 7 : voxel & validation debug ---
btnBuildVoxel.addEventListener('click', async () => {
  if (!_dernieresGrilles || !_ciblesCalibrées) {
    debugInfoVoxel.textContent = '⚠ Lis les grilles (étape 6) d\'abord.';
    return;
  }
  debugInfoVoxel.textContent = 'Construction voxel…';
  try {
    const layout  = await fetch('/config/layout.json').then(r => r.json());
    const regions = layout.vehicleSheet.regions;

    const grid   = buildVoxelGrid({ face: _dernieresGrilles.face, profile: _dernieresGrilles.profile, top: _dernieresGrilles.top });
    const wheels = detectWheels({ profileGrid: _dernieresGrilles.profile, topGrid: _dernieresGrilles.top });
    const { stats, powers } = await computeStats(grid);

    // Panneau 8 — stats/pouvoirs
    DebugView.updateValidation(stats, powers);

    // Panneau 7 — rendu 3D miniature
    const voxelCanvas = DebugView.getVoxelCanvas();
    if (voxelCanvas) {
      voxelCanvas.width  = 200;
      voxelCanvas.height = 150;
      const miniScene  = createPreviewScene(voxelCanvas);
      const miniGroupe = buildVehicleGroup({ grid, wheelPositions: wheels, stats, powers });
      miniScene.setGroup(miniGroupe);
      DebugView.activerVoxel();
    }

    // Comptage voxels pour le rapport
    let nbVoxels = 0;
    for (let x = 0; x < 8; x++)
      for (let z = 0; z < 4; z++)
        for (let y = 0; y < 4; y++)
          if (grid[x]?.[z]?.[y]) nbVoxels++;

    debugInfoVoxel.textContent =
      `✓ ${nbVoxels} voxels — vitesse:${stats.speed.toFixed(1)} adhérence:${stats.grip.toFixed(1)} accél:${stats.accel.toFixed(1)}`;
  } catch (err) {
    debugInfoVoxel.textContent = '✗ Erreur : ' + err.message;
    console.error('[voxel]', err);
  }
});

// ============================================================
// Pipeline complet — Story 2.5
// ============================================================

const btnScanComplet = document.getElementById('btn-scan-complet');

// Éléments de l'écran de validation
const ecranValidation  = document.getElementById('ecran-validation');
const canvasValidation = document.getElementById('canvas-validation');
const inputPseudo      = document.getElementById('input-pseudo');
const btnValider       = document.getElementById('btn-valider');
const btnRescanner     = document.getElementById('btn-rescanner');

let _previewScene = null; // THREE scene de validation, réutilisée

/**
 * Étapes 3–7 du pipeline (warp → voxel → validation).
 * Appelé depuis _pipelineComplet et _battreEtScan (mode auto).
 * Pré-requis : _dernierFrame, _derniersCoins et _typeFeuille déjà remplis.
 */
async function _pipelineDepuisWarp() {
  const indiquer = (msg) => { btnScanComplet.textContent = msg; };

  indiquer('Redressement…');
  _derniereRedressée = await Perspective.warp(_dernierFrame, _derniersCoins);

  indiquer('Segmentation…');
  _dernieresZones = await Segmenter.segment(_derniereRedressée);

  indiquer('Calibration…');
  _ciblesCalibrées = await Calibration.calibrate(_dernieresZones.patch);
  _ciblesAuto = _ciblesCalibrées;

  indiquer('Lecture couleurs…');
  const layout  = await fetch('/config/layout.json').then(r => r.json());
  const regions = layout.vehicleSheet.regions;
  const grilles = {};
  for (const nom of ['face', 'profile', 'top']) {
    grilles[nom] = await ColorReader.readGrid(
      _dernieresZones[nom],
      { cols: regions[nom].cols, rows: regions[nom].rows },
      _ciblesCalibrées,
    );
  }

  indiquer('Reconstruction 3D…');
  const grid   = buildVoxelGrid({ face: grilles.face, profile: grilles.profile, top: grilles.top });
  const wheels = detectWheels({ profileGrid: grilles.profile, topGrid: grilles.top });
  const { stats, powers } = await computeStats(grid);

  // Mosaïque debug — panneau 8 : stats/pouvoirs
  DebugView.updateValidation(stats, powers);

  // Mosaïque debug — panneau 7 : rendu 3D miniature
  const voxelCanvas = DebugView.getVoxelCanvas();
  if (voxelCanvas) {
    voxelCanvas.width  = 200;
    voxelCanvas.height = 150;
    const miniScene  = createPreviewScene(voxelCanvas);
    const miniGroupe = buildVehicleGroup({ grid, wheelPositions: wheels, stats, powers });
    miniScene.setGroup(miniGroupe);
    DebugView.activerVoxel();
  }

  await _afficherValidation({ grid, wheelPositions: wheels, stats, powers });
}

/**
 * Lance la chaîne complète capture → voxel → validation.
 */
async function _pipelineComplet() {
  btnScanComplet.disabled = true;
  try {
    btnScanComplet.textContent = 'Capture…';
    _dernierFrame = Capture.captureFrame();

    btnScanComplet.textContent = 'Détection QR…';
    _derniersCoins = QrDetect.detect(_dernierFrame);
    _typeFeuille   = _derniersCoins?.type ?? null;
    const nbQrTrouves = _derniersCoins ? Object.keys(_derniersCoins).length - 1 : 0;
    _mettreAJourCompteurQr(nbQrTrouves);
    if (!_derniersCoins) throw new Error(`${nbQrTrouves}/4 QR codes trouvés — repositionne la feuille et réessaie.`);
    if (_typeFeuille !== 'vehicle') throw new Error('Ce n\'est pas une feuille véhicule.');

    await _pipelineDepuisWarp();
  } catch (err) {
    afficherErreur(err.message);
    console.error('[scan] pipeline complet :', err);
  } finally {
    btnScanComplet.disabled = false;
    btnScanComplet.textContent = 'Scanner';
  }
}

btnScanComplet.addEventListener('click', _pipelineComplet);

// ============================================================
// Mode auto-scan — 135 BPM (≈ 444 ms / beat)
// ============================================================

const BPM           = 135;
const BEAT_MS       = Math.round(60_000 / BPM); // 444 ms
const STABLE_SEUIL  = 3; // beats consécutifs avant déclenchement
const btnAutoScan   = document.getElementById('btn-auto-scan');
const beatRing      = document.getElementById('beat-ring');
const statutAuto    = document.getElementById('statut-auto');
const flashCapture  = document.getElementById('flash-capture');

let _autoInterval    = null;
let _pipelineEnCours = false;
let _stableCount     = 0; // beats consécutifs avec 4 QR détectés

function _mettreAJourStatut(texte) {
  statutAuto.textContent = texte;
}

function _declencherFlash() {
  flashCapture.classList.remove('actif');
  void flashCapture.offsetWidth; // reflow pour relancer l'animation
  flashCapture.classList.add('actif');
}

function _battreEtScan() {
  // Animation de pulse sur l'anneau
  beatRing.classList.remove('pulse');
  void beatRing.offsetWidth;
  beatRing.classList.add('pulse');

  if (_pipelineEnCours) return;

  // Tentative rapide : capture + QR seulement
  let frame;
  try {
    frame = Capture.captureFrame();
  } catch {
    return; // caméra pas prête
  }

  const coins = QrDetect.detect(frame);
  const nbQr  = coins ? Object.keys(coins).length - 1 : 0; // -1 pour la clé 'type'
  _mettreAJourCompteurQr(nbQr);

  beatRing.classList.remove('qr-ok', 'qr-partiel');

  if (coins && coins.type === 'vehicle') {
    beatRing.classList.add('qr-ok');
    _dernierFrame  = frame;
    _derniersCoins = coins;
    _typeFeuille   = coins.type;
    _stableCount++;

    if (_stableCount < STABLE_SEUIL) {
      _mettreAJourStatut(`Feuille détectée, stabilisation… (${_stableCount}/${STABLE_SEUIL})`);
    } else {
      // Seuil atteint — déclenchement
      _stableCount = 0;
      _mettreAJourStatut('Capture !');
      _declencherFlash();
      _pipelineEnCours = true;
      _arreterAutoScan();
      _mettreAJourStatut('Traitement en cours…');
      statutAuto.hidden = false; // rester visible pendant le pipeline
      _pipelineDepuisWarp()
        .catch(err => afficherErreur(err.message))
        .finally(() => {
          _pipelineEnCours = false;
          statutAuto.hidden = true;
        });
    }
  } else {
    _stableCount = 0;
    beatRing.classList.toggle('qr-partiel', nbQr > 0);
    _mettreAJourStatut(nbQr > 0 ? `${nbQr}/4 QR détectés…` : 'Cherche la feuille…');
  }
}

function _demarrerAutoScan() {
  if (_autoInterval) return;
  _stableCount = 0;
  _autoInterval = setInterval(_battreEtScan, BEAT_MS);
  btnAutoScan.classList.add('actif');
  btnAutoScan.textContent = '⏹ Auto';
  beatRing.classList.remove('qr-ok', 'qr-partiel');
  statutAuto.hidden = false;
  _mettreAJourStatut('Cherche la feuille…');
  console.log(`[auto-scan] démarré — ${BPM} BPM / ${BEAT_MS} ms`);
}

function _arreterAutoScan() {
  if (!_autoInterval) return;
  clearInterval(_autoInterval);
  _autoInterval = null;
  _stableCount  = 0;
  btnAutoScan.classList.remove('actif');
  btnAutoScan.textContent = 'Auto';
  beatRing.classList.remove('qr-ok', 'qr-partiel', 'pulse');
  if (!_pipelineEnCours) statutAuto.hidden = true;
  console.log('[auto-scan] arrêté');
}

btnAutoScan.addEventListener('click', () => {
  if (_autoInterval) _arreterAutoScan();
  else               _demarrerAutoScan();
});

/**
 * Affiche l'écran de validation avec le véhicule reconstruit.
 * @param {{ grid, wheelPositions, stats, powers }} vehicule
 */
async function _afficherValidation(vehicule) {
  const config = await fetch('/config/gameplay.json').then(r => r.json());
  const vs = config.vehicleStats;
  const pw = config.powers;

  // Afficher l'overlay AVANT Three.js — sinon clientWidth/clientHeight = 0 (display:none)
  ecranValidation.classList.remove('cache');
  ecranValidation.removeAttribute('aria-hidden');
  void ecranValidation.offsetHeight; // force reflow pour que les dimensions CSS soient disponibles

  // Initialiser la scène 3D maintenant que le canvas a des dimensions réelles
  if (!_previewScene) {
    const wrap = document.getElementById('validation-3d');
    canvasValidation.width  = wrap.clientWidth  || window.innerWidth;
    canvasValidation.height = wrap.clientHeight || Math.round(window.innerHeight * 0.5);
    _previewScene = createPreviewScene(canvasValidation);
  }

  // Déclencher la transition d'entrée
  void ecranValidation.offsetHeight;
  ecranValidation.classList.add('visible');

  // Construire le groupe véhicule avec animation d'entrée
  const groupe = buildVehicleGroup(vehicule);
  groupe.position.y = -8; // démarre sous le cadre
  _previewScene.setGroup(groupe);

  // Animation de montée (environ 60 frames)
  let frame = 0;
  const DUREE = 55;
  const tickMontee = () => {
    if (frame >= DUREE) return;
    frame++;
    const t = frame / DUREE;
    const ease = 1 - Math.pow(1 - t, 3); // ease-out cubique
    groupe.position.y = -8 + 8 * ease;
    requestAnimationFrame(tickMontee);
  };
  requestAnimationFrame(tickMontee);

  // Remplir les barres de stats
  const maxStats = {
    speed: vs.baseSpeed + 128 * vs.speedPerRedVoxel,
    grip:  vs.baseGrip  + 128 * vs.gripPerGreenVoxel,
    accel: vs.baseAccel + 128 * vs.accelPerBlueVoxel,
  };
  _remplirBarre('stat-vitesse',   vehicule.stats.speed, maxStats.speed);
  _remplirBarre('stat-adherence', vehicule.stats.grip,  maxStats.grip);
  _remplirBarre('stat-accel',     vehicule.stats.accel, maxStats.accel);

  // Construire et remplir les jauges de pouvoirs
  const POUVOIRS = [
    { id: 'aspiration', nom: 'Aspiration',  couleur: '#e62020', max: 128 * pw.aspiration.magnitudePerRedVoxel },
    { id: 'phares',     nom: 'Phares',       couleur: '#1fa830', max: 128 * pw.phares.magnitudePerGreenVoxel },
    { id: 'sillage',    nom: 'Sillage',      couleur: '#1a52e0', max: 128 * pw.sillage.magnitudePerBlueVoxel },
    { id: 'shield',     nom: 'Bouclier',     couleur: '#f07418', max: 128 * pw.shield.magnitudePerOrangeVoxel },
    { id: 'attraction', nom: 'Attraction',   couleur: '#7d2dc0', max: 128 * pw.attraction.magnitudePerVioletVoxel },
    { id: 'heal',       nom: 'Soin',         couleur: '#e882b9', max: 128 * pw.heal.magnitudePerPinkVoxel },
  ];
  const liste = document.getElementById('pouvoirs-liste');
  liste.innerHTML = POUVOIRS.map(p => `
    <div class="pouvoir-ligne">
      <span class="pouvoir-dot" style="--couleur:${p.couleur};background:${p.couleur}"></span>
      <span class="pouvoir-nom">${p.nom}</span>
      <div class="pouvoir-barre-wrap">
        <div class="pouvoir-barre" id="pouvoir-${p.id}" style="--couleur:${p.couleur};background:${p.couleur};width:0%"></div>
      </div>
    </div>`).join('');

  // Déclencher les barres de pouvoirs avec un léger délai (après entrée overlay)
  setTimeout(() => {
    for (const p of POUVOIRS) {
      const val = vehicule.powers[p.id] ?? 0;
      const pct = p.max > 0 ? Math.min(100, (val / p.max) * 100) : 0;
      const el  = document.getElementById(`pouvoir-${p.id}`);
      if (el) el.style.width = pct + '%';
    }
  }, 500);

  // Précharger le pseudo depuis localStorage
  const pseudoSauvé = localStorage.getItem('pop-vroum:pseudo');
  if (pseudoSauvé) inputPseudo.value = pseudoSauvé;
  inputPseudo.focus();

  // Stocker le véhicule courant pour la validation
  btnValider._vehicule = vehicule;
}

/** Met à jour la barre d'une stat (valeur normalisée sur max). */
function _remplirBarre(idLigne, valeur, max) {
  const ligne = document.getElementById(idLigne);
  if (!ligne) return;
  const pct = max > 0 ? Math.min(100, (valeur / max) * 100) : 0;
  setTimeout(() => {
    const barre = ligne.querySelector('.stat-barre');
    const label = ligne.querySelector('.stat-val');
    if (barre) barre.style.width = pct + '%';
    if (label) label.textContent = valeur.toFixed(1);
  }, 300);
}

// Bouton "Valider" : sauvegarde en localStorage et redirige vers lobby
btnValider.addEventListener('click', () => {
  const pseudo  = inputPseudo.value.trim() || 'Anonyme';
  const vehicule = btnValider._vehicule;
  if (!vehicule) return;

  localStorage.setItem('pop-vroum:pseudo', pseudo);

  // Sauvegarde dans la galerie (module storage/gallery)
  let id;
  try {
    id = Gallery.save({
      playerName: pseudo,
      grid: vehicule.grid,
      wheelPositions: vehicule.wheelPositions,
      stats: vehicule.stats,
      powers: vehicule.powers,
    });
  } catch (e) {
    console.error('[validation] Erreur galerie :', e.message);
    id = `veh_${Date.now()}`;
  }

  // Clé courante pour le lobby
  const entree = Gallery.get(id) || {
    id, playerName: pseudo,
    grid: vehicule.grid, wheelPositions: vehicule.wheelPositions,
    stats: vehicule.stats, powers: vehicule.powers,
  };
  localStorage.setItem('pop-vroum:vehicule-courant', JSON.stringify(entree));

  console.log('[validation] Véhicule sauvegardé :', id, '— joueur :', pseudo);
  window.location.href = 'lobby.html';
});

// Bouton "Re-scanner" : fermer l'overlay et revenir à la caméra
btnRescanner.addEventListener('click', () => {
  ecranValidation.classList.remove('visible');
  // Attendre la fin de la transition avant de masquer complètement
  ecranValidation.addEventListener('transitionend', () => {
    ecranValidation.classList.add('cache');
    ecranValidation.setAttribute('aria-hidden', 'true');
  }, { once: true });
});

// ============================================================
// --- Démarrage ---
async function demarrer() {
  try {
    await Capture.init(videoEl);
    msgChargement.classList.add('cache');
  } catch (err) {
    msgChargement.classList.add('cache');
    afficherErreur(err.message);
  }
}

// ---- Compteur QR ----
const qrCompteur = document.getElementById('qr-compteur');
let _nbQrDetectes = 0;

function _mettreAJourCompteurQr(nb) {
  _nbQrDetectes = nb;
  qrCompteur.textContent = `${nb} / 4 QR`;
  qrCompteur.classList.toggle('partiel', nb > 0 && nb < 4);
  qrCompteur.classList.toggle('complet', nb === 4);
}

// ---- Erreur — toast auto-dismiss ----
const msgErreurTexte = document.getElementById('message-erreur-texte');
const btnFermerErreur = document.getElementById('btn-fermer-erreur');
let _erreurTimeout = null;

function afficherErreur(msg) {
  console.error('[scan] ' + msg);
  if (msgErreurTexte) msgErreurTexte.textContent = msg;
  msgErreur.classList.add('visible');
  // Auto-dismiss après 5 s
  clearTimeout(_erreurTimeout);
  _erreurTimeout = setTimeout(masquerErreur, 5000);
}

function masquerErreur() {
  msgErreur.classList.remove('visible');
  clearTimeout(_erreurTimeout);
}

btnFermerErreur?.addEventListener('click', masquerErreur);
// Tap sur la zone caméra masque aussi l'erreur
document.getElementById('zone-camera')?.addEventListener('click', (e) => {
  if (msgErreur.classList.contains('visible') && e.target !== btnFermerErreur) {
    masquerErreur();
  }
});

// ---- Sélecteur de caméra ----
const btnSwitchCam = document.getElementById('btn-switch-cam');
let _cameras = [];
let _camIndex = 0;

btnSwitchCam?.addEventListener('click', async () => {
  // Charger la liste au premier clic
  if (_cameras.length === 0) {
    _cameras = await Capture.listCameras();
    // Trouver l'index de la caméra actuelle
    const track = Capture.currentDeviceId?.();
    _camIndex = Math.max(0, _cameras.findIndex(c => c.deviceId === track));
  }
  if (_cameras.length <= 1) {
    afficherErreur('Une seule caméra détectée sur cet appareil.');
    return;
  }
  _camIndex = (_camIndex + 1) % _cameras.length;
  const cam = _cameras[_camIndex];
  btnSwitchCam.textContent = '⏳';
  btnSwitchCam.disabled = true;
  try {
    await Capture.switchCamera(cam.deviceId);
    const label = cam.label.length > 20 ? cam.label.slice(0, 18) + '…' : cam.label;
    console.log('[capture] Basculé vers :', cam.label);
    btnSwitchCam.title = cam.label;
  } catch (err) {
    afficherErreur('Changement de caméra échoué : ' + err.message);
  } finally {
    btnSwitchCam.textContent = '📷';
    btnSwitchCam.disabled = false;
  }
});

demarrer();
