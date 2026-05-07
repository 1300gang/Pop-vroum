/**
 * Génère les 4 QR codes de calage pour la feuille véhicule.
 * Usage : node tools/generate-qr.js
 * Sortie : public/assets/sheets/qr-codes/popvroum-vehicle-{tl,tr,bl,br}.png
 */

import QRCode from 'qrcode';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '../public/assets/sheets/qr-codes');

const QR_CODES = [
  { id: 'tl', value: 'popvroum-vehicle-tl', label: 'Vehicle Top-Left'    },
  { id: 'tr', value: 'popvroum-vehicle-tr', label: 'Vehicle Top-Right'   },
  { id: 'bl', value: 'popvroum-vehicle-bl', label: 'Vehicle Bottom-Left' },
  { id: 'br', value: 'popvroum-vehicle-br', label: 'Vehicle Bottom-Right'},
  { id: 'block-tl', value: 'popvroum-block-tl', label: 'Block Top-Left'    },
  { id: 'block-tr', value: 'popvroum-block-tr', label: 'Block Top-Right'   },
  { id: 'block-bl', value: 'popvroum-block-bl', label: 'Block Bottom-Left' },
  { id: 'block-br', value: 'popvroum-block-br', label: 'Block Bottom-Right'},
];

/* Options communes :
   - errorCorrectionLevel H (haute robustesse, tolère ~30% de dommages)
   - 212px ≈ 18mm à 300dpi — lisible à 30-60cm en webcam standard
   - dark #111 (quasi-noir) sur fond blanc
   - margin 1 (marge QR minimale mais suffisante)
*/
const OPTIONS = {
  errorCorrectionLevel: 'H',
  type: 'png',
  width: 212,
  margin: 1,
  color: {
    dark:  '#111111',
    light: '#ffffff',
  },
};

let errors = 0;

for (const { id, value, label } of QR_CODES) {
  const outPath = join(OUT_DIR, `popvroum-vehicle-${id}.png`);
  try {
    const buffer = await QRCode.toBuffer(value, OPTIONS);
    writeFileSync(outPath, buffer);
    console.log(`✓ ${label.padEnd(12)} → ${value}  (${buffer.length} octets)`);
  } catch (err) {
    console.error(`✗ ${label} : ${err.message}`);
    errors++;
  }
}

if (errors === 0) {
  console.log('\nTous les QR codes générés dans public/assets/sheets/qr-codes/');
  console.log('Prochaine étape : intégrer les PNG dans feuille-vehicule-A3.svg (Story 0.2)');
} else {
  process.exit(1);
}
