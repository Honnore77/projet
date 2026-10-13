/* Sauvegarde hebdomadaire : vendredi 18 h 30, rattrapage, une copie par semaine. */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  sauvegardeHebdo, listerHebdo, derniereEcheance, prochaineEcheance, DOSSIER_HEBDO, HEBDO_CONSERVEES
} = require('../electron/sauvegarde.cjs');

const dossier = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pdu-hebdo-'));
const CONTENU = JSON.stringify({ settings: {} });
/** Date locale : annee, mois (1-12), jour, heure, minute. */
const le = (a, m, j, h = 0, mn = 0) => new Date(a, m - 1, j, h, mn);

test('le dossier porte le nom demande', () => {
  assert.equal(DOSSIER_HEBDO, 'SAUVEGADE AUTOMATIQUE HEBDO');
});

test('l’echeance est le vendredi a 18 h 30', () => {
  // Le 16 octobre 2026 est un vendredi.
  assert.deepEqual(derniereEcheance(le(2026, 10, 16, 18, 30)), le(2026, 10, 16, 18, 30));
  assert.deepEqual(derniereEcheance(le(2026, 10, 16, 18, 29)), le(2026, 10, 9, 18, 30));
  assert.deepEqual(derniereEcheance(le(2026, 10, 13, 10, 0)), le(2026, 10, 9, 18, 30));
  assert.deepEqual(prochaineEcheance(le(2026, 10, 13, 10, 0)), le(2026, 10, 16, 18, 30));
  assert.deepEqual(prochaineEcheance(le(2026, 10, 16, 19, 0)), le(2026, 10, 23, 18, 30));
});

test('rien avant 18 h 30 le vendredi, la copie de la semaine a 18 h 30', () => {
  const d = dossier();
  sauvegardeHebdo(CONTENU, d, le(2026, 10, 9, 19, 0)); // semaine precedente
  const avant = sauvegardeHebdo(CONTENU, d, le(2026, 10, 16, 18, 0));
  assert.equal(avant.ecrite, false);
  const a = sauvegardeHebdo(CONTENU, d, le(2026, 10, 16, 18, 30));
  assert.equal(a.ecrite, true);
  assert.equal(a.fichier, 'pdu-parc-auto-hebdo-2026-10-16.json');
  assert.ok(fs.existsSync(path.join(d, DOSSIER_HEBDO, a.fichier)));
});

test('une seule copie par semaine, meme verifiee chaque minute', () => {
  const d = dossier();
  assert.equal(sauvegardeHebdo(CONTENU, d, le(2026, 10, 16, 18, 31)).ecrite, true);
  assert.equal(sauvegardeHebdo(CONTENU, d, le(2026, 10, 16, 18, 32)).ecrite, false);
  assert.equal(sauvegardeHebdo(CONTENU, d, le(2026, 10, 20, 9, 0)).ecrite, false);
  assert.equal(listerHebdo(d).length, 1);
});

test('application fermee le vendredi soir : la copie se fait au lancement suivant', () => {
  const d = dossier();
  const lundi = sauvegardeHebdo(CONTENU, d, le(2026, 10, 19, 8, 0));
  assert.equal(lundi.ecrite, true);
  assert.equal(lundi.fichier, 'pdu-parc-auto-hebdo-2026-10-16.json');
});

test('sans dossier de sauvegarde, rien n’est ecrit', () => {
  const e = sauvegardeHebdo(CONTENU, '', le(2026, 10, 16, 19, 0));
  assert.equal(e.ecrite, false);
  assert.equal(e.dossier, '');
});

test('un an de copies au plus', () => {
  const d = dossier();
  for (let i = 0; i < HEBDO_CONSERVEES + 3; i += 1) {
    sauvegardeHebdo(CONTENU, d, new Date(le(2025, 1, 3, 19, 0).getTime() + i * 7 * 86400000));
  }
  const l = listerHebdo(d);
  assert.equal(l.length, HEBDO_CONSERVEES);
  assert.equal(l[0].date, '2025-01-24');
});
