/* ===================================================================
   Un PC serveur du bureau, dans son propre processus, pour les tests du
   reseau du bureau (reseauBureau.test.mjs) : une vraie base, le vrai
   serveur, la vraie fusion. Il ecrit son port sur la sortie standard.
   =================================================================== */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db, charger } from './aide.mjs';

const require = createRequire(import.meta.url);
const { creerServeurSynchro } = require('../electron/synchro-serveur.cjs');
const { traiterDemandePC } = await import('../resources/js/core/synchroClient.js');

await charger({
  accounts: [{ id: 'c-serveur', login: 'admin', nom: 'Admin serveur', role: 'admin', actif: true }],
  notes: [{ id: 'n-serveur', auteurId: 'c-serveur', visibilite: 'publique', sujet: 'Écrite sur le serveur', date: '2026-10-16T08:00:00Z' }]
});

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'pdu-bureau-'));
let version = Date.now();
const serveur = creerServeurSynchro({
  imagesDir: () => dossier,
  imageFile: (id) => (/^img_[A-Za-z0-9]+$/.test(id) ? path.join(dossier, `${id}.jpg`) : null),
  demanderFusion: async (payload) => {
    const r = await traiterDemandePC(payload);
    version = Date.now();
    return r;
  },
  version: () => version,
  surEtat: () => {},
  nom: 'PC serveur de test'
});

const info = await serveur.demarrerPermanent({ port: 0, code: 'TEST-CODE' });
process.stdout.write(`${JSON.stringify({ port: info.port })}\n`);

// Le test interroge l'etat du serveur par son entree standard.
process.stdin.on('data', (b) => {
  if (String(b).trim() === 'etat') {
    process.stdout.write(`${JSON.stringify({ notes: db.DB.notes.map((n) => n.id).sort(), comptes: db.DB.accounts.map((a) => a.id).sort() })}\n`);
  }
});
