// Routes admin — Story 6.4
//
// Gère le pool de blocs map côté serveur :
//   GET  /admin/blocks        — liste les blocs générés
//   POST /admin/blocks        — ajoute un bloc au pool (depuis l'éditeur web)
//
// Auth : header X-Admin-Token, comparé à la variable d'env ADMIN_TOKEN
// (défaut atelier : 'popvroum-admin-v1').
//
// Rechargement du pool : reloadPool() est appelé après chaque POST réussi pour
// invalider le cache de game-loop.js ; le prochain match verra le nouveau bloc.

import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname }                        from 'path';
import { fileURLToPath }                        from 'url';
import { reloadPool }                           from './game-loop.js';

const __dirname     = dirname(fileURLToPath(import.meta.url));
const DIR_GENERATED = join(__dirname, '..', 'data', 'map-blocks', 'generated');

const TAILLE             = 8;
const SYMBOLES_AUTORISES = new Set(['ramp', 'sticky', 'dur', 'boost']);
// Token par défaut lisible pour l'atelier ; surcharger via env en production.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'popvroum-admin-v1';

// ---- Auth ----

function _tokenValide(req) {
  return req.headers['x-admin-token'] === ADMIN_TOKEN;
}

// ---- Helpers I/O ----

async function _listerFichiers() {
  const fichiers = await readdir(DIR_GENERATED).catch(() => []);
  return fichiers.filter(f => f.endsWith('.json'));
}

async function _idExiste(id) {
  const fichiers = await _listerFichiers();
  return fichiers.includes(`${id}.json`);
}

// ---- Validation du bloc ----

function _validerBloc(bloc) {
  if (!bloc || typeof bloc !== 'object')
    throw Object.assign(new Error('Corps invalide'), { status: 400 });

  if (typeof bloc.id !== 'string' || !bloc.id.trim())
    throw Object.assign(new Error('"id" manquant'), { status: 400 });

  if (!/^[a-zA-Z0-9_-]+$/.test(bloc.id))
    throw Object.assign(new Error('"id" : seuls lettres, chiffres, _ et - sont autorisés'), { status: 400 });

  if (!Array.isArray(bloc.grid))
    throw Object.assign(new Error('"grid" manquant'), { status: 400 });

  if (bloc.grid.length !== TAILLE)
    throw Object.assign(new Error(`"grid" doit avoir ${TAILLE} lignes (reçu : ${bloc.grid.length})`), { status: 400 });

  for (let r = 0; r < TAILLE; r++) {
    const rangee = bloc.grid[r];
    if (!Array.isArray(rangee) || rangee.length !== TAILLE)
      throw Object.assign(new Error(`Rangée ${r} doit avoir ${TAILLE} colonnes`), { status: 400 });

    for (const cell of rangee) {
      if (cell === null) continue;
      // Accepte string simple OU { v, r } (format avec rotation)
      const sym = typeof cell === 'string' ? cell : cell?.v;
      if (sym !== null && sym !== undefined && !SYMBOLES_AUTORISES.has(sym))
        throw Object.assign(new Error(`Symbole invalide en rangée ${r} : "${sym}"`), { status: 400 });
    }
  }
}

// ---- Enregistrement des routes ----

/**
 * Attache les routes admin à l'app Express.
 * @param {import('express').Express} app
 */
export function registerAdminRoutes(app) {

  // GET /admin/blocks — liste les blocs générés (métadonnées seulement)
  app.get('/admin/blocks', async (req, res) => {
    if (!_tokenValide(req)) return res.status(401).json({ error: 'Token invalide' });

    try {
      const fichiers = await _listerFichiers();
      const blocs = await Promise.all(
        fichiers.map(async (f) => {
          try {
            const raw = await readFile(join(DIR_GENERATED, f), 'utf8');
            const b   = JSON.parse(raw);
            return { id: b.id, name: b.name ?? '?', atelier: b.atelier ?? '', createdAt: b.createdAt ?? null };
          } catch {
            return { id: f.replace('.json', ''), name: '(illisible)', atelier: '', createdAt: null };
          }
        })
      );
      res.json({ count: blocs.length, blocks: blocs });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /admin/blocks — ajoute un bloc au pool
  app.post('/admin/blocks', async (req, res) => {
    if (!_tokenValide(req)) return res.status(401).json({ error: 'Token invalide' });

    const bloc = req.body;

    try {
      _validerBloc(bloc);
    } catch (err) {
      return res.status(err.status ?? 400).json({ error: err.message });
    }

    try {
      if (await _idExiste(bloc.id)) {
        return res.status(409).json({ error: `Bloc "${bloc.id}" existe déjà dans le pool` });
      }

      await mkdir(DIR_GENERATED, { recursive: true });

      const chemin = join(DIR_GENERATED, `${bloc.id}.json`);
      await writeFile(chemin, JSON.stringify(bloc, null, 2), 'utf8');
      reloadPool();

      console.log(`[admin] Bloc ajouté au pool : ${bloc.id} ("${bloc.name ?? ''}")`);
      res.status(201).json({ ok: true, id: bloc.id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
