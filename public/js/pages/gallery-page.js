// Point d'entrée page galerie — Story 7.2
// Affiche les véhicules sauvegardés en localStorage avec mini-rendu Three.js.

import * as Gallery  from '../modules/storage/gallery.js';
import { buildVehicleGroup, createPreviewScene, disposeVehicleGroup } from '../modules/voxel/renderer.js';
import * as THREE from '../lib/three.module.js';

// ---- Éléments DOM ----

const grilleEl         = document.getElementById('grille-galerie');
const etatVideEl       = document.getElementById('etat-vide');
const compteurEl       = document.getElementById('compteur-vehicules');
const modaleEl         = document.getElementById('modale');
const modaleFondEl     = document.getElementById('modale-fond');
const canvasModale     = document.getElementById('canvas-modale');
const btnFermerModale  = document.getElementById('btn-fermer-modale');
const modalePseudoEl   = document.getElementById('modale-pseudo');
const modaleDateEl     = document.getElementById('modale-date');
const modaleStatsEl    = document.getElementById('modale-stats');
const btnJouer         = document.getElementById('btn-jouer');
const btnSupprimer     = document.getElementById('btn-supprimer');
const confirmModale    = document.getElementById('modale-confirmation');
const confirmFond      = document.getElementById('confirmation-fond');
const btnConfirmer     = document.getElementById('btn-confirmer-suppression');
const btnAnnuler       = document.getElementById('btn-annuler-suppression');

// ---- État ----

let _previewScene = null; // Scène animée de la modale
let _vehiculeOuvert = null; // Véhicule affiché dans la modale

// ---- Rendu des vignettes ----

/**
 * Génère un snapshot statique d'un véhicule sur un canvas 2D.
 * Utilise un renderer WebGL offscreen unique pour rendre tous les snapshots.
 */
const _snapshotRenderer = (() => {
  // Renderer partagé en 280×220 (ratio proche des vignettes 140×110 *2)
  const W = 280, H = 220;
  const offCanvas = document.createElement('canvas');
  offCanvas.width  = W;
  offCanvas.height = H;
  const renderer = new THREE.WebGLRenderer({ canvas: offCanvas, antialias: true, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);

  const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
  const CAM_R = 14;
  // Angle légèrement de haut à droite
  const theta = 0.6, phi = 1.0;
  camera.position.set(
    CAM_R * Math.sin(phi) * Math.sin(theta),
    CAM_R * Math.cos(phi),
    CAM_R * Math.sin(phi) * Math.cos(theta),
  );
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(4, 10, 6);
  scene.add(dir);

  return {
    /**
     * Rend le véhicule et copie l'image dans le canvas cible.
     * @param {object} vehicule
     * @param {HTMLCanvasElement} targetCanvas
     */
    snapshot(vehicule, targetCanvas) {
      const group = buildVehicleGroup(vehicule);
      scene.add(group);
      renderer.render(scene, camera);
      scene.remove(group);
      disposeVehicleGroup(group);

      // Copie du rendu vers le canvas de la vignette
      const ctx = targetCanvas.getContext('2d');
      ctx.drawImage(offCanvas, 0, 0, targetCanvas.width, targetCanvas.height);
    },
  };
})();

// ---- Construction des vignettes ----

function _formaterDate(isoString) {
  try {
    return new Date(isoString).toLocaleDateString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
  } catch {
    return '';
  }
}

function _creerVignette(vehicule) {
  const el = document.createElement('div');
  el.className = 'vignette';
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', `Véhicule de ${vehicule.playerName}`);

  const canvas = document.createElement('canvas');
  canvas.width  = 140;
  canvas.height = 110;

  const pseudo = document.createElement('div');
  pseudo.className = 'vignette-pseudo';
  pseudo.textContent = vehicule.playerName || 'Anonyme';

  const date = document.createElement('div');
  date.className = 'vignette-date';
  date.textContent = _formaterDate(vehicule.createdAt);

  el.append(canvas, pseudo, date);

  // Snapshot : rendu dans requestAnimationFrame pour ne pas bloquer le layout
  requestAnimationFrame(() => {
    try {
      _snapshotRenderer.snapshot(vehicule, canvas);
    } catch (e) {
      console.error('[gallery-page] Erreur snapshot :', vehicule.id, e);
    }
  });

  // Ouverture modale au clic ou Enter
  const ouvrir = () => _ouvrirModale(vehicule);
  el.addEventListener('click', ouvrir);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') ouvrir(); });

  el.dataset.id = vehicule.id;
  return el;
}

// ---- Chargement de la galerie ----

function _chargerGalerie() {
  const vehicules = Gallery.list();

  grilleEl.innerHTML = '';

  if (vehicules.length === 0) {
    etatVideEl.classList.remove('cache');
    compteurEl.textContent = '';
    return;
  }

  etatVideEl.classList.add('cache');
  const n = vehicules.length;
  compteurEl.textContent = `${n} véhicule${n > 1 ? 's' : ''}`;

  for (const v of vehicules) {
    grilleEl.appendChild(_creerVignette(v));
  }
}

// ---- Modale ----

function _ouvrirModale(vehicule) {
  _vehiculeOuvert = vehicule;

  // Remplir les infos textuelles
  modalePseudoEl.textContent = vehicule.playerName || 'Anonyme';
  modaleDateEl.textContent   = _formaterDate(vehicule.createdAt);
  modaleStatsEl.innerHTML    = _badgesStats(vehicule.stats);

  // Lancer la scène 3D animée
  _stopPreview();
  canvasModale.width  = canvasModale.offsetWidth  || 400;
  canvasModale.height = canvasModale.offsetHeight || 300;
  _previewScene = createPreviewScene(canvasModale);
  const group = buildVehicleGroup(vehicule);
  _previewScene.setGroup(group);

  modaleEl.classList.remove('cache');
  btnFermerModale.focus();
  document.body.style.overflow = 'hidden';
}

function _fermerModale() {
  modaleEl.classList.add('cache');
  _stopPreview();
  _vehiculeOuvert = null;
  document.body.style.overflow = '';
}

function _stopPreview() {
  if (_previewScene) {
    _previewScene.stop();
    _previewScene = null;
  }
}

function _badgesStats(stats = {}) {
  if (!stats) return '';
  const items = [
    { label: 'Vitesse',    valeur: stats.speed,  couleur: 'var(--couleur-rouge)' },
    { label: 'Adhérence',  valeur: stats.grip,   couleur: 'var(--couleur-vert)'  },
    { label: 'Accél.',     valeur: stats.accel,  couleur: 'var(--couleur-bleu)'  },
  ];
  return items
    .filter(i => i.valeur != null)
    .map(i => `<span class="stat-badge" style="color:${i.couleur}">${i.label} ${Number(i.valeur).toFixed(1)}</span>`)
    .join('');
}

// ---- Suppression ----

function _demanderSuppression() {
  confirmModale.classList.remove('cache');
}

function _annulerSuppression() {
  confirmModale.classList.add('cache');
}

function _confirmerSuppression() {
  if (!_vehiculeOuvert) return;
  const id = _vehiculeOuvert.id;
  const ok = Gallery.remove(id);
  confirmModale.classList.add('cache');
  _fermerModale();

  if (ok) {
    // Retirer la vignette de la grille sans tout recharger
    const vignette = grilleEl.querySelector(`[data-id="${id}"]`);
    if (vignette) vignette.remove();

    const restants = Gallery.count();
    if (restants === 0) {
      etatVideEl.classList.remove('cache');
      compteurEl.textContent = '';
    } else {
      compteurEl.textContent = `${restants} véhicule${restants > 1 ? 's' : ''}`;
    }
  }
}

// ---- Jouer avec le véhicule sélectionné ----

function _jouerAvecVehicule() {
  if (!_vehiculeOuvert) return;

  // Copier le véhicule de la galerie comme véhicule courant
  localStorage.setItem('pop-vroum:vehicule-courant', JSON.stringify(_vehiculeOuvert));

  // Conserver aussi le pseudo du véhicule comme pseudo courant si pas déjà défini
  if (!localStorage.getItem('pop-vroum:pseudo') && _vehiculeOuvert.playerName) {
    localStorage.setItem('pop-vroum:pseudo', _vehiculeOuvert.playerName);
  }

  window.location.href = 'lobby.html';
}

// ---- Événements ----

btnFermerModale.addEventListener('click', _fermerModale);
modaleFondEl.addEventListener('click', _fermerModale);

btnJouer.addEventListener('click', _jouerAvecVehicule);
btnSupprimer.addEventListener('click', _demanderSuppression);
btnAnnuler.addEventListener('click', _annulerSuppression);
btnConfirmer.addEventListener('click', _confirmerSuppression);
confirmFond.addEventListener('click', _annulerSuppression);

// Fermeture clavier (Échap)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!confirmModale.classList.contains('cache')) {
      _annulerSuppression();
    } else if (!modaleEl.classList.contains('cache')) {
      _fermerModale();
    }
  }
});

// ---- Démarrage ----

_chargerGalerie();
