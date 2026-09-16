// Point d'entrée de la page scanner v2 "sandwich"
import * as Capture      from '../modules/scan/capture.js';
import * as QrDetect     from '../modules/scan/qr-detect.js';
import * as Perspective  from '../modules/scan/perspective.js';
import * as SegmenterV2  from '../modules/scan/segmenter-v2.js';
import * as Calibration  from '../modules/scan/calibration.js';
import * as ColorReader  from '../modules/scan/color-reader.js';
import * as HslTuner     from '../modules/scan/manual-hsl-tuner.js';
import * as DebugView    from '../modules/scan/debug-view.js';
import { buildFromSandwich }                      from '../modules/voxel/builder-sandwich.js';
import { detectWheels }                           from '../modules/voxel/wheel-detector.js';
import { computeStats }                           from '../modules/voxel/stats.js';
import { buildVehicleGroup, createPreviewScene }  from '../modules/voxel/renderer.js';
import * as Gallery                               from '../modules/storage/gallery.js';

const videoEl            = document.getElementById('video-camera');
const msgErreur          = document.getElementById('message-erreur');
const msgChargement      = document.getElementById('message-chargement');
const panneauDebug       = document.getElementById('panneau-debug');
const btnDebug           = document.getElementById('btn-toggle-debug');
const btnCapture         = document.getElementById('btn-capture');
const btnDetectQr        = document.getElementById('btn-detect-qr');
const btnWarp            = document.getElementById('btn-warp');
const btnSegment         = document.getElementById('btn-segment');
const btnCalibrate       = document.getElementById('btn-calibrate');
const btnReadColors      = document.getElementById('btn-read-colors');
const btnBuildVoxel      = document.getElementById('btn-build-voxel');
const debugInfoVoxel     = document.getElementById('debug-info-voxel');
const canvasDebug        = document.getElementById('canvas-debug');
const debugInfoCapture   = document.getElementById('debug-info-capture');
const debugInfoQr        = document.getElementById('debug-info-qr');
const debugInfoWarp      = document.getElementById('debug-info-warp');
const debugInfoSegment   = document.getElementById('debug-info-segment');
const debugInfoCalibrate = document.getElementById('debug-info-calibrate');
const debugInfoColors    = document.getElementById('debug-info-colors');

let _dernierFrame      = null;
let _derniersCoins     = null;
let _derniereRedressée = null;
let _dernieresSlices   = null; // { slices: ImageData[], patch: ImageData }
let _ciblesCalibrées   = null;
let _ciblesAuto        = null;
let _dernieresGrilles  = null; // Array<Array<Array<string|null>>> (4 tranches)

// --- Mosaïque debug-view ---
DebugView.init(document.getElementById('debug-mosaique'));

// --- Panneau tuner HSL ---
const btnToggleTuner = document.getElementById('btn-toggle-tuner');
const tunerContenu   = document.getElementById('tuner-contenu');

btnToggleTuner.addEventListener('click', () => {
  const ouvert = tunerContenu.classList.toggle('cache');
  btnToggleTuner.textContent = tunerContenu.classList.contains('cache') ? 'Afficher' : 'Masquer';
  if (!tunerContenu.classList.contains('cache') && !tunerContenu.hasChildNodes()) {
    _initTuner();
  }
});

// --- Hook debug QR ---
QrDetect.onDebugResult(({ trouve, complet, type, typeMixte, rapportQuad }) => {
  if (!_dernierFrame) return;
  DebugView.updateBrute(_dernierFrame, { trouve, complet, type });

  const lignes = rapportQuad.map(q => {
    if (!q.detecte) return `${q.id.toUpperCase()} : rien`;
    if (!q.coin)    return `${q.id.toUpperCase()} : "${q.contenuBrut}" — non reconnu`;
    return `${q.id.toUpperCase()} : ✓ "${q.contenuBrut}"`;
  });

  let typeLabel = '';
  if (typeMixte) {
    typeLabel = '<br><span style="color:#e74c3c">⚠ Types mélangés</span>';
  } else if (type === 'v2' && complet) {
    typeLabel = '<br><span style="color:#2ecc71">🥪 Feuille sandwich v2</span>';
  }
  debugInfoQr.innerHTML = lignes.join('<br>') + typeLabel;
});

// --- Toggle panneau debug ---
btnDebug.addEventListener('click', () => {
  const fermé = panneauDebug.classList.toggle('cache');
  btnDebug.textContent = fermé ? '🔧' : '✕ debug';
});
btnDebug.textContent = '✕ debug';

// --- Bouton 1 : capture ---
btnCapture.addEventListener('click', () => {
  try {
    _dernierFrame = Capture.captureFrame();
    _derniersCoins = null;
    canvasDebug.width  = _dernierFrame.width;
    canvasDebug.height = _dernierFrame.height;
    canvasDebug.getContext('2d').putImageData(_dernierFrame, 0, 0);
    debugInfoCapture.textContent = `${_dernierFrame.width} × ${_dernierFrame.height} px`;
    debugInfoQr.textContent = '';
    debugInfoWarp.textContent = '';
    DebugView.updateBrute(_dernierFrame);
  } catch (err) {
    afficherErreur(err.message);
  }
});

// --- Bouton 2 : détection QR ---
btnDetectQr.addEventListener('click', () => {
  if (!_dernierFrame) { debugInfoQr.textContent = '⚠ Capture une frame d\'abord.'; return; }
  canvasDebug.getContext('2d').putImageData(_dernierFrame, 0, 0);
  _derniersCoins = QrDetect.detect(_dernierFrame);
  const nbQr = _derniersCoins ? Object.keys(_derniersCoins).length - 1 : 0;
  _mettreAJourCompteurQr(nbQr);
  debugInfoWarp.textContent = _derniersCoins?.type === 'v2'
    ? '🥪 Feuille v2 — prêt pour le redressement.'
    : '⚠ 4 QR v2 nécessaires.';
});

// --- Bouton 3 : redressement ---
btnWarp.addEventListener('click', async () => {
  if (!_dernierFrame || !_derniersCoins) {
    debugInfoWarp.textContent = '⚠ Détecte les 4 QR d\'abord.'; return;
  }
  debugInfoWarp.textContent = 'Redressement en cours…';
  try {
    _derniereRedressée = await Perspective.warp(_dernierFrame, _derniersCoins, 'vehicleSheetV2');
    canvasDebug.width  = _derniereRedressée.width;
    canvasDebug.height = _derniereRedressée.height;
    canvasDebug.getContext('2d').putImageData(_derniereRedressée, 0, 0);
    debugInfoWarp.textContent = `✓ Redressée : ${_derniereRedressée.width} × ${_derniereRedressée.height} px`;
    DebugView.updateRedressée(_derniereRedressée);
  } catch (err) {
    debugInfoWarp.textContent = '✗ ' + err.message;
  }
});

// --- Bouton 4 : segmentation ---
btnSegment.addEventListener('click', async () => {
  if (!_derniereRedressée) {
    debugInfoSegment.textContent = '⚠ Redresse la feuille d\'abord.'; return;
  }
  debugInfoSegment.textContent = 'Découpe en cours…';
  try {
    _dernieresSlices = await SegmenterV2.segment(_derniereRedressée);

    // Affichage : 4 tranches côte à côte sur le canvas
    _dessinerSlicesDebug(_dernieresSlices.slices);

    DebugView.updatePatch(_dernieresSlices.patch);
    const details = _dernieresSlices.slices.map((s, i) => `S${i+1}:${s.width}×${s.height}`).join(' ');
    debugInfoSegment.textContent = `✓ 4 tranches — ${details}`;
  } catch (err) {
    debugInfoSegment.textContent = '✗ ' + err.message;
    console.error('[segmenter-v2]', err);
  }
});

// --- Bouton 5 : calibration ---
btnCalibrate.addEventListener('click', async () => {
  if (!_dernieresSlices?.patch) {
    debugInfoCalibrate.textContent = '⚠ Découpe les zones d\'abord.'; return;
  }
  debugInfoCalibrate.textContent = 'Lecture du patch…';
  try {
    _ciblesCalibrées = await Calibration.calibrate(_dernieresSlices.patch);
    _ciblesAuto = _ciblesCalibrées;
    if (!tunerContenu.classList.contains('cache') && tunerContenu.hasChildNodes()) {
      HslTuner.reset(_ciblesCalibrées);
    }
    DebugView.updatePatch(_dernieresSlices.patch, _ciblesCalibrées);
    const couleurs = ['red', 'green', 'blue', 'orange', 'violet', 'pink'];
    const lignes = couleurs.map(nom => {
      const c = _ciblesCalibrées[nom];
      return `<span class="debug-color-dot" style="background:hsl(${c.h.toFixed(0)},${(c.s*100).toFixed(0)}%,${(c.l*100).toFixed(0)}%)"></span>`
           + `${nom} : H=${c.h.toFixed(0)}° S=${(c.s*100).toFixed(0)}% L=${(c.l*100).toFixed(0)}%`;
    });
    debugInfoCalibrate.innerHTML = lignes.join('<br>');
  } catch (err) {
    debugInfoCalibrate.textContent = '✗ ' + err.message;
  }
});

// --- Tuner HSL ---
function _initTuner() {
  const ciblesInit = _ciblesCalibrées || _ciblesDefaut();
  HslTuner.init(tunerContenu, ciblesInit, (nouvelles, reset) => {
    if (reset) {
      if (_ciblesAuto) { HslTuner.reset(_ciblesAuto); _ciblesCalibrées = _ciblesAuto; }
    } else {
      _ciblesCalibrées = nouvelles;
    }
    if (_dernieresSlices) btnReadColors.click();
  });
}

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
  if (!_dernieresSlices || !_ciblesCalibrées) {
    debugInfoColors.textContent = '⚠ Calibre les couleurs d\'abord.'; return;
  }
  debugInfoColors.textContent = 'Lecture en cours…';
  try {
    const layout = await fetch('/config/layout.json').then(r => r.json());
    const spec   = layout.vehicleSheetV2;

    const grilles = await Promise.all(
      _dernieresSlices.slices.map((sliceImg, i) => {
        const s = spec.slices[i];
        return ColorReader.readGrid(sliceImg, { cols: s.cols, rows: s.rows }, _ciblesCalibrées);
      })
    );
    _dernieresGrilles = grilles;

    // Affichage debug : 4 grilles colorées côte à côte
    _dessinerGrillesDebug(grilles, spec.slices);

    const labels = ['DESSOUS', 'MILIEU-BAS', 'MILIEU-HAUT', 'DESSUS'];
    const resume = grilles.map((g, i) => {
      const s = spec.slices[i];
      let colored = 0;
      for (let c = 0; c < s.cols; c++) for (let r = 0; r < s.rows; r++) if (g[c][r]) colored++;
      return `${labels[i]}: ${colored}/${s.cols * s.rows}`;
    });
    debugInfoColors.textContent = '✓ ' + resume.join(' | ');
  } catch (err) {
    debugInfoColors.textContent = '✗ ' + err.message;
    console.error('[color-reader v2]', err);
  }
});

// --- Bouton 7 : voxel & validation debug ---
btnBuildVoxel.addEventListener('click', async () => {
  if (!_dernieresGrilles) {
    debugInfoVoxel.textContent = '⚠ Lis les grilles (étape 6) d\'abord.'; return;
  }
  debugInfoVoxel.textContent = 'Construction voxel…';
  try {
    const grid   = buildFromSandwich({ slices: _transposerGrilles(_dernieresGrilles) });
    const wheels = _deriverWheels(grid);
    const { stats, powers } = await computeStats(grid);

    DebugView.updateValidation(stats, powers);

    const voxelCanvas = DebugView.getVoxelCanvas();
    if (voxelCanvas) {
      voxelCanvas.width  = 200;
      voxelCanvas.height = 150;
      const miniScene  = createPreviewScene(voxelCanvas);
      const miniGroupe = buildVehicleGroup({ grid, wheelPositions: wheels, stats, powers });
      miniScene.setGroup(miniGroupe);
      DebugView.activerVoxel();
    }

    let nbVoxels = 0;
    for (let x = 0; x < 8; x++)
      for (let z = 0; z < 4; z++)
        for (let y = 0; y < 4; y++)
          if (grid[x]?.[z]?.[y]) nbVoxels++;

    debugInfoVoxel.textContent =
      `✓ ${nbVoxels} voxels — vitesse:${stats.speed.toFixed(1)} adhérence:${stats.grip.toFixed(1)} accél:${stats.accel.toFixed(1)}`;
  } catch (err) {
    debugInfoVoxel.textContent = '✗ ' + err.message;
    console.error('[voxel v2]', err);
  }
});

// ============================================================
// Pipeline complet
// ============================================================

const btnScanComplet = document.getElementById('btn-scan-complet');
const ecranValidation  = document.getElementById('ecran-validation');
const canvasValidation = document.getElementById('canvas-validation');
const inputPseudo      = document.getElementById('input-pseudo');
const btnValider       = document.getElementById('btn-valider');
const btnRetoucher     = document.getElementById('btn-retoucher');
const btnRescanner     = document.getElementById('btn-rescanner');

let _previewScene = null;

async function _pipelineDepuisWarp() {
  const indiquer = (msg) => { btnScanComplet.textContent = msg; };

  indiquer('Redressement…');
  _derniereRedressée = await Perspective.warp(_dernierFrame, _derniersCoins, 'vehicleSheetV2');

  indiquer('Segmentation…');
  _dernieresSlices = await SegmenterV2.segment(_derniereRedressée);

  indiquer('Calibration…');
  _ciblesCalibrées = await Calibration.calibrate(_dernieresSlices.patch);
  _ciblesAuto = _ciblesCalibrées;

  indiquer('Lecture couleurs…');
  const layout = await fetch('/config/layout.json').then(r => r.json());
  const spec   = layout.vehicleSheetV2;
  const grilles = await Promise.all(
    _dernieresSlices.slices.map((sliceImg, i) => {
      const s = spec.slices[i];
      return ColorReader.readGrid(sliceImg, { cols: s.cols, rows: s.rows }, _ciblesCalibrées);
    })
  );

  indiquer('Reconstruction 3D…');
  const grid   = buildFromSandwich({ slices: _transposerGrilles(grilles) });
  const wheels = _deriverWheels(grid);
  const { stats, powers } = await computeStats(grid);

  DebugView.updateValidation(stats, powers);
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

async function _pipelineComplet() {
  btnScanComplet.disabled = true;
  try {
    btnScanComplet.textContent = 'Capture…';
    _dernierFrame = Capture.captureFrame();

    btnScanComplet.textContent = 'Détection QR…';
    _derniersCoins = QrDetect.detect(_dernierFrame);
    const nbQr = _derniersCoins ? Object.keys(_derniersCoins).length - 1 : 0;
    _mettreAJourCompteurQr(nbQr);
    if (!_derniersCoins) throw new Error(`${nbQr}/4 QR codes trouvés — repositionne la feuille.`);
    if (_derniersCoins.type !== 'v2') throw new Error('Ce n\'est pas une feuille sandwich v2.');

    await _pipelineDepuisWarp();
  } catch (err) {
    afficherErreur(err.message);
    console.error('[scan-v2] pipeline :', err);
  } finally {
    btnScanComplet.disabled = false;
    btnScanComplet.textContent = 'Scanner';
  }
}

btnScanComplet.addEventListener('click', _pipelineComplet);

// ============================================================
// Mode auto-scan — 135 BPM
// ============================================================

const BPM          = 135;
const BEAT_MS      = Math.round(60_000 / BPM);
const STABLE_SEUIL = 3;
const btnAutoScan  = document.getElementById('btn-auto-scan');
const beatRing     = document.getElementById('beat-ring');
const statutAuto   = document.getElementById('statut-auto');
const flashCapture = document.getElementById('flash-capture');

let _autoInterval    = null;
let _pipelineEnCours = false;
let _stableCount     = 0;

function _battreEtScan() {
  beatRing.classList.remove('pulse');
  void beatRing.offsetWidth;
  beatRing.classList.add('pulse');

  if (_pipelineEnCours) return;

  let frame;
  try { frame = Capture.captureFrame(); } catch { return; }

  const coins = QrDetect.detect(frame);
  const nbQr  = coins ? Object.keys(coins).length - 1 : 0;
  _mettreAJourCompteurQr(nbQr);
  beatRing.classList.remove('qr-ok', 'qr-partiel');

  if (coins?.type === 'v2') {
    beatRing.classList.add('qr-ok');
    _dernierFrame = frame; _derniersCoins = coins;
    _stableCount++;

    if (_stableCount < STABLE_SEUIL) {
      statutAuto.textContent = `Feuille détectée, stabilisation… (${_stableCount}/${STABLE_SEUIL})`;
    } else {
      _stableCount = 0;
      statutAuto.textContent = 'Capture !';
      flashCapture.classList.remove('actif');
      void flashCapture.offsetWidth;
      flashCapture.classList.add('actif');
      _pipelineEnCours = true;
      _arreterAutoScan();
      statutAuto.hidden = false;
      statutAuto.textContent = 'Traitement en cours…';
      _pipelineDepuisWarp()
        .catch(err => afficherErreur(err.message))
        .finally(() => { _pipelineEnCours = false; statutAuto.hidden = true; });
    }
  } else {
    _stableCount = 0;
    beatRing.classList.toggle('qr-partiel', nbQr > 0);
    statutAuto.textContent = nbQr > 0 ? `${nbQr}/4 QR détectés…` : 'Cherche la feuille sandwich…';
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
  statutAuto.textContent = 'Cherche la feuille sandwich…';
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
}

btnAutoScan.addEventListener('click', () => {
  if (_autoInterval) _arreterAutoScan(); else _demarrerAutoScan();
});

// ============================================================
// Écran de validation
// ============================================================

async function _afficherValidation(vehicule) {
  const config = await fetch('/config/gameplay.json').then(r => r.json());
  const vs = config.vehicleStats;
  const pw = config.powers;

  ecranValidation.classList.remove('cache');
  ecranValidation.removeAttribute('aria-hidden');
  void ecranValidation.offsetHeight;

  if (!_previewScene) {
    const wrap = document.getElementById('validation-3d');
    canvasValidation.width  = wrap.clientWidth  || window.innerWidth;
    canvasValidation.height = wrap.clientHeight || Math.round(window.innerHeight * 0.5);
    _previewScene = createPreviewScene(canvasValidation);
  }

  void ecranValidation.offsetHeight;
  ecranValidation.classList.add('visible');

  const groupe = buildVehicleGroup(vehicule);
  groupe.position.y = -8;
  _previewScene.setGroup(groupe);

  let frame = 0;
  const DUREE = 55;
  const tickMontee = () => {
    if (frame >= DUREE) return;
    frame++;
    const ease = 1 - Math.pow(1 - frame / DUREE, 3);
    groupe.position.y = -8 + 8 * ease;
    requestAnimationFrame(tickMontee);
  };
  requestAnimationFrame(tickMontee);

  const maxStats = {
    speed: vs.baseSpeed + 128 * vs.speedPerRedVoxel,
    grip:  vs.baseGrip  + 128 * vs.gripPerGreenVoxel,
    accel: vs.baseAccel + 128 * vs.accelPerBlueVoxel,
  };
  _remplirBarre('stat-vitesse',   vehicule.stats.speed, maxStats.speed);
  _remplirBarre('stat-adherence', vehicule.stats.grip,  maxStats.grip);
  _remplirBarre('stat-accel',     vehicule.stats.accel, maxStats.accel);

  const POUVOIRS = [
    { id: 'aspiration', nom: 'Aspiration',  couleur: '#e62020', max: 128 * pw.aspiration.magnitudePerRedVoxel },
    { id: 'phares',     nom: 'Phares',       couleur: '#1fa830', max: 128 * pw.phares.magnitudePerGreenVoxel },
    { id: 'sillage',    nom: 'Sillage',      couleur: '#1a52e0', max: 128 * pw.sillage.magnitudePerBlueVoxel },
    { id: 'shield',     nom: 'Bouclier',     couleur: '#f07418', max: 128 * pw.shield.magnitudePerOrangeVoxel },
    { id: 'attraction', nom: 'Attraction',   couleur: '#7d2dc0', max: 128 * pw.attraction.magnitudePerVioletVoxel },
    { id: 'heal',       nom: 'Soin',         couleur: '#e882b9', max: 128 * pw.heal.magnitudePerPinkVoxel },
  ];
  document.getElementById('pouvoirs-liste').innerHTML = POUVOIRS.map(p => `
    <div class="pouvoir-ligne">
      <span class="pouvoir-dot" style="--couleur:${p.couleur};background:${p.couleur}"></span>
      <span class="pouvoir-nom">${p.nom}</span>
      <div class="pouvoir-barre-wrap">
        <div class="pouvoir-barre" id="pouvoir-${p.id}" style="--couleur:${p.couleur};background:${p.couleur};width:0%"></div>
      </div>
    </div>`).join('');

  setTimeout(() => {
    for (const p of POUVOIRS) {
      const val = vehicule.powers[p.id] ?? 0;
      const pct = p.max > 0 ? Math.min(100, (val / p.max) * 100) : 0;
      const el  = document.getElementById(`pouvoir-${p.id}`);
      if (el) el.style.width = pct + '%';
    }
  }, 500);

  const pseudoSauvé = localStorage.getItem('pop-vroum:pseudo');
  if (pseudoSauvé) inputPseudo.value = pseudoSauvé;
  inputPseudo.focus();
  btnValider._vehicule = vehicule;
}

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

btnValider.addEventListener('click', () => {
  const pseudo  = inputPseudo.value.trim() || 'Anonyme';
  const vehicule = btnValider._vehicule;
  if (!vehicule) return;
  localStorage.setItem('pop-vroum:pseudo', pseudo);
  let id;
  try {
    id = Gallery.save({
      playerName: pseudo, grid: vehicule.grid,
      wheelPositions: vehicule.wheelPositions, stats: vehicule.stats, powers: vehicule.powers,
    });
  } catch (e) {
    id = `veh_${Date.now()}`;
  }
  const entree = Gallery.get(id) || {
    id, playerName: pseudo, grid: vehicule.grid,
    wheelPositions: vehicule.wheelPositions, stats: vehicule.stats, powers: vehicule.powers,
  };
  localStorage.setItem('pop-vroum:vehicule-courant', JSON.stringify(entree));
  window.location.href = 'lobby.html';
});

btnRetoucher?.addEventListener('click', () => {
  const pseudo  = inputPseudo.value.trim() || 'Anonyme';
  const vehicule = btnValider._vehicule;
  if (!vehicule) return;
  localStorage.setItem('pop-vroum:pseudo', pseudo);
  let id;
  try {
    id = Gallery.save({
      playerName: pseudo, grid: vehicule.grid,
      wheelPositions: vehicule.wheelPositions, stats: vehicule.stats, powers: vehicule.powers,
    });
  } catch (e) {
    id = `veh_${Date.now()}`;
  }
  const entree = Gallery.get(id) || {
    id, playerName: pseudo, grid: vehicule.grid,
    wheelPositions: vehicule.wheelPositions, stats: vehicule.stats, powers: vehicule.powers,
  };
  localStorage.setItem('pop-vroum:vehicule-courant', JSON.stringify(entree));
  window.location.href = 'scan-edit.html';
});

btnRescanner.addEventListener('click', () => {
  ecranValidation.classList.remove('visible');
  ecranValidation.addEventListener('transitionend', () => {
    ecranValidation.classList.add('cache');
    ecranValidation.setAttribute('aria-hidden', 'true');
  }, { once: true });
});

// ============================================================
// Utilitaires internes
// ============================================================

/**
 * color-reader retourne grille[col][row], builder-sandwich attend slice[row][col].
 * Cette fonction transpose chaque grille.
 */
function _transposerGrilles(grilles) {
  return grilles.map(grille => {
    const cols = grille.length;
    const rows = grille[0]?.length ?? 0;
    return Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => grille[c][r])
    );
  });
}

/**
 * Dérive profileGrid et topGrid depuis le voxelGrid pour wheel-detector.
 * profileGrid[x][row] : row=0 = haut = y=3, row=3 = bas = y=0
 * topGrid[x][z]
 */
function _deriverWheels(grid) {
  const profileGrid = Array.from({ length: 8 }, (_, x) =>
    Array.from({ length: 4 }, (_, row) => {
      const y = 3 - row; // row 0 = haut = y=3
      for (let z = 0; z < 4; z++) if (grid[x]?.[z]?.[y]) return grid[x][z][y].color;
      return null;
    })
  );
  const topGrid = Array.from({ length: 8 }, (_, x) =>
    Array.from({ length: 4 }, (_, z) => {
      for (let y = 0; y < 4; y++) if (grid[x]?.[z]?.[y]) return grid[x][z][y].color;
      return null;
    })
  );
  return detectWheels({ profileGrid, topGrid });
}

/** Dessine les 4 tranches ImageData côte à côte sur canvas-debug. */
function _dessinerSlicesDebug(slices) {
  const padding = 8;
  const labelH  = 20;
  const labels  = ['① DESSOUS', '② MILIEU BAS', '③ MILIEU HAUT', '④ DESSUS'];
  let totalW = padding;
  let maxH   = 0;
  for (const s of slices) { totalW += s.width + padding; maxH = Math.max(maxH, s.height); }
  canvasDebug.width  = totalW;
  canvasDebug.height = maxH + labelH + padding;
  const ctx = canvasDebug.getContext('2d');
  ctx.fillStyle = '#0f0f23';
  ctx.fillRect(0, 0, canvasDebug.width, canvasDebug.height);
  let ox = padding;
  slices.forEach((s, i) => {
    ctx.fillStyle = '#f5a623';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(labels[i], ox, 14);
    ctx.putImageData(s, ox, labelH);
    ctx.strokeStyle = 'rgba(245,166,35,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox - 1, labelH - 1, s.width + 2, s.height + 2);
    ox += s.width + padding;
  });
}

/** Dessine les 4 grilles colorées côte à côte (après lecture couleurs). */
function _dessinerGrillesDebug(grilles, specSlices) {
  const cellSize = 28;
  const padding  = 10;
  const labelH   = 18;
  const labels   = ['① DESSOUS', '② M.BAS', '③ M.HAUT', '④ DESSUS'];
  const COLORS   = { red:'#EF4444', green:'#22C55E', blue:'#3B82F6', orange:'#F97316', violet:'#A855F7', pink:'#EC4899' };
  let totalW = padding;
  for (const s of specSlices) totalW += s.cols * cellSize + padding;
  const maxRows = Math.max(...specSlices.map(s => s.rows));
  canvasDebug.width  = totalW;
  canvasDebug.height = maxRows * cellSize + labelH + padding;
  const ctx = canvasDebug.getContext('2d');
  ctx.fillStyle = '#0f0f23';
  ctx.fillRect(0, 0, canvasDebug.width, canvasDebug.height);
  let ox = padding;
  grilles.forEach((grille, i) => {
    const { cols, rows } = specSlices[i];
    ctx.fillStyle = '#f5a623';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(labels[i], ox, 13);
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const x = ox + c * cellSize;
        const y = labelH + r * cellSize;
        const couleur = grille[c][r];
        ctx.fillStyle = couleur ? COLORS[couleur] : '#2a2a3a';
        ctx.fillRect(x, y, cellSize - 1, cellSize - 1);
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, cellSize - 1, cellSize - 1);
        if (couleur) {
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 9px monospace';
          ctx.fillText(couleur[0].toUpperCase(), x + 9, y + 17);
        }
      }
    }
    ox += cols * cellSize + padding;
  });
}

// ============================================================
// Démarrage
// ============================================================

const qrCompteur = document.getElementById('qr-compteur');
function _mettreAJourCompteurQr(nb) {
  qrCompteur.textContent = `${nb} / 4 QR`;
  qrCompteur.classList.toggle('partiel', nb > 0 && nb < 4);
  qrCompteur.classList.toggle('complet', nb === 4);
}

const msgErreurTexte  = document.getElementById('message-erreur-texte');
const btnFermerErreur = document.getElementById('btn-fermer-erreur');
let _erreurTimeout = null;

function afficherErreur(msg) {
  console.error('[scan-v2] ' + msg);
  if (msgErreurTexte) msgErreurTexte.textContent = msg;
  msgErreur.classList.add('visible');
  clearTimeout(_erreurTimeout);
  _erreurTimeout = setTimeout(() => msgErreur.classList.remove('visible'), 5000);
}

btnFermerErreur?.addEventListener('click', () => msgErreur.classList.remove('visible'));
document.getElementById('zone-camera')?.addEventListener('click', (e) => {
  if (msgErreur.classList.contains('visible') && e.target !== btnFermerErreur)
    msgErreur.classList.remove('visible');
});

const btnSwitchCam = document.getElementById('btn-switch-cam');
let _cameras = [], _camIndex = 0;
btnSwitchCam?.addEventListener('click', async () => {
  if (_cameras.length === 0) {
    _cameras = await Capture.listCameras();
    const track = Capture.currentDeviceId?.();
    _camIndex = Math.max(0, _cameras.findIndex(c => c.deviceId === track));
  }
  if (_cameras.length <= 1) { afficherErreur('Une seule caméra détectée.'); return; }
  _camIndex = (_camIndex + 1) % _cameras.length;
  btnSwitchCam.textContent = '⏳';
  btnSwitchCam.disabled = true;
  try {
    await Capture.switchCamera(_cameras[_camIndex].deviceId);
  } catch (err) {
    afficherErreur('Changement de caméra échoué : ' + err.message);
  } finally {
    btnSwitchCam.textContent = '📷';
    btnSwitchCam.disabled = false;
  }
});

async function demarrer() {
  try {
    await Capture.init(videoEl);
    msgChargement.classList.add('cache');
  } catch (err) {
    msgChargement.classList.add('cache');
    afficherErreur(err.message);
  }
}

demarrer();
