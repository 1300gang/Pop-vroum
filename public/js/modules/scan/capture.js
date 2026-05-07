// Gestion du flux caméra et capture de frames pour le pipeline scan.
// Contrat : init(videoEl) → Promise<void>, captureFrame() → ImageData

let _video = null;
let _canvas = null;
let _ctx = null;
let _stream = null;
let _onDebugFrame = null;
let _deviceId = null; // null = laisser le navigateur choisir (préfère environment)

/**
 * Démarre la caméra et l'attache à l'élément vidéo fourni.
 * @param {HTMLVideoElement} videoEl
 * @returns {Promise<void>}
 */
export async function init(videoEl) {
  _video = videoEl;
  _video.setAttribute('playsinline', '');
  _video.setAttribute('autoplay', '');
  _video.muted = true;

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('getUserMedia non disponible (HTTPS requis hors localhost).');
  }

  console.log('[capture] Demande d\'accès caméra…');

  const videoConstraints = _deviceId
    ? { deviceId: { exact: _deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } };

  _stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints })
    .catch(err => { throw new Error(_messageErreur(err)); });

  console.log('[capture] Flux obtenu, attachement à la vidéo…');
  _video.srcObject = _stream;

  // Lance la lecture (autoplay peut ne pas suffire dans certains navigateurs)
  _video.play().catch(() => {});

  // Polling léger : attend que la vidéo ait des dimensions réelles
  await _attendreVideoActive(8000);

  _canvas = document.createElement('canvas');
  _canvas.width  = _video.videoWidth;
  _canvas.height = _video.videoHeight;
  _ctx = _canvas.getContext('2d', { willReadFrequently: true });

  console.log('[capture] Prêt —', _canvas.width, '×', _canvas.height, 'px');
}

/**
 * Capture la frame courante du flux vidéo.
 * @returns {ImageData}
 */
export function captureFrame() {
  if (!_video || _video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    throw new Error('Caméra non prête — appeler init() avant captureFrame()');
  }
  _ctx.drawImage(_video, 0, 0, _canvas.width, _canvas.height);
  const frame = _ctx.getImageData(0, 0, _canvas.width, _canvas.height);
  if (_onDebugFrame) _onDebugFrame(frame, _canvas);
  return frame;
}

/**
 * Liste les caméras disponibles sur l'appareil.
 * @returns {Promise<Array<{deviceId, label}>>}
 */
export async function listCameras() {
  // getUserMedia doit avoir été appelé avant pour avoir les labels
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter(d => d.kind === 'videoinput')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Caméra ${i + 1}` }));
}

/**
 * Bascule vers une caméra spécifique par son deviceId.
 * @param {string} deviceId
 */
export async function switchCamera(deviceId) {
  stop();
  _deviceId = deviceId;
  await init(_video);
}

/**
 * Arrête tous les tracks du flux et libère la caméra.
 */
export function stop() {
  if (_stream) {
    _stream.getTracks().forEach(t => t.stop());
    _stream = null;
  }
}

/**
 * Hook debug appelé après chaque captureFrame().
 */
export function onDebugFrame(cb) {
  _onDebugFrame = cb;
}

/**
 * Retourne le deviceId de la caméra active (null si non sélectionnée explicitement).
 */
export function currentDeviceId() {
  return _deviceId;
}

// Attend que videoWidth > 0 par requestAnimationFrame (ne bloque pas le thread)
function _attendreVideoActive(delaiMax) {
  return new Promise((resolve, reject) => {
    const debut = Date.now();
    function verifier() {
      if (_video.videoWidth > 0 && _video.videoHeight > 0) {
        resolve();
      } else if (Date.now() - debut > delaiMax) {
        reject(new Error(
          `Délai dépassé (${delaiMax}ms) — la vidéo ne démarre pas `
          + `(readyState=${_video.readyState}, `
          + `dimensions=${_video.videoWidth}×${_video.videoHeight})`
        ));
      } else {
        requestAnimationFrame(verifier);
      }
    }
    verifier();
  });
}

function _messageErreur(err) {
  switch (err.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Accès à la caméra refusé. Autorisez la caméra dans les réglages du navigateur.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'Aucune caméra détectée sur cet appareil.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'La caméra est déjà utilisée par une autre application.';
    case 'OverconstrainedError':
      return 'Les contraintes vidéo demandées ne sont pas supportées par cette caméra.';
    default:
      return `Erreur caméra (${err.name}) : ${err.message}`;
  }
}
