/* Copies datees : nommage, retention, et resistance a un dossier absent. */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sauvegardeDatee, listerSauvegardes } = require('../electron/sauvegarde.cjs');

/** Dossier temporaire propre a chaque test. */
function dossierTemporaire() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pdu-sauvegarde-'));
}

const CONTENU = JSON.stringify({ settings: {}, vehicles: { pool: [], mission: [], service: [] } });

test('la copie du jour porte la date dans son nom', () => {
  const d = dossierTemporaire();
  const etat = sauvegardeDatee(CONTENU, d, 30, '2026-09-01');
  assert.equal(etat.fichier, 'pdu-parc-auto-2026-09-01.json');
  assert.equal(etat.erreur, '');
  assert.ok(fs.existsSync(path.join(d, 'pdu-parc-auto-2026-09-01.json')));
  assert.equal(fs.readFileSync(path.join(d, etat.fichier), 'utf8'), CONTENU);
});

test('deux enregistrements le meme jour reecrivent le meme fichier', () => {
  const d = dossierTemporaire();
  sauvegardeDatee('{"v":1}', d, 30, '2026-09-01');
  sauvegardeDatee('{"v":2}', d, 30, '2026-09-01');
  assert.equal(listerSauvegardes(d).length, 1, 'un seul fichier pour la journee');
  assert.equal(fs.readFileSync(path.join(d, 'pdu-parc-auto-2026-09-01.json'), 'utf8'), '{"v":2}');
});

test('la copie de la veille reste intacte — c’est tout l’interet', () => {
  const d = dossierTemporaire();
  sauvegardeDatee('{"jour":"hier"}', d, 30, '2026-08-31');
  sauvegardeDatee('{"jour":"aujourdhui"}', d, 30, '2026-09-01');
  assert.equal(fs.readFileSync(path.join(d, 'pdu-parc-auto-2026-08-31.json'), 'utf8'), '{"jour":"hier"}');
  assert.equal(listerSauvegardes(d).length, 2);
});

test('au-dela du nombre conserve, la plus ancienne disparait', () => {
  const d = dossierTemporaire();
  for (const jour of ['2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01']) {
    sauvegardeDatee(CONTENU, d, 3, jour);
  }
  const restantes = listerSauvegardes(d).map((f) => f.date);
  assert.deepEqual(restantes, ['2026-08-30', '2026-08-31', '2026-09-01'], 'les trois plus recentes');
});

test('un nombre de copies absurde vaut « non renseigne » et retombe sur trente', () => {
  // Zero ne peut pas vouloir dire « garder zero copie » : la sauvegarde
  // s'effacerait elle-meme aussitot ecrite. Meme regle pour un negatif ou
  // un texte — sans quoi deux valeurs fautives donneraient deux resultats.
  for (const absurde of [0, -5, NaN, undefined, 'beaucoup']) {
    const d = dossierTemporaire();
    for (const jour of ['2026-08-30', '2026-08-31', '2026-09-01']) {
      sauvegardeDatee(CONTENU, d, absurde, jour);
    }
    assert.equal(listerSauvegardes(d).length, 3, `retention cassee pour ${String(absurde)}`);
  }
});

test('un nombre decimal est ramene a l’entier inferieur', () => {
  const d = dossierTemporaire();
  for (const jour of ['2026-08-30', '2026-08-31', '2026-09-01']) {
    sauvegardeDatee(CONTENU, d, 2.9, jour);
  }
  assert.equal(listerSauvegardes(d).length, 2);
});

test('sans dossier choisi, rien n’est ecrit et rien n’echoue', () => {
  const etat = sauvegardeDatee(CONTENU, '', 30, '2026-09-01');
  assert.equal(etat.fait, null);
  assert.equal(etat.erreur, '');
  assert.equal(etat.fichier, '');
});

test('un dossier inaccessible remonte l’erreur sans lever', () => {
  // Un chemin dont le parent est un fichier : mkdir ne peut pas aboutir.
  const d = dossierTemporaire();
  const fichier = path.join(d, 'occupe');
  fs.writeFileSync(fichier, 'x');
  const etat = sauvegardeDatee(CONTENU, path.join(fichier, 'sous-dossier'), 30, '2026-09-01');
  assert.equal(etat.fait, null);
  assert.ok(etat.erreur, 'l’erreur doit etre rapportee');
  assert.equal(etat.fichier, '');
});

test('le dossier est cree s’il n’existe pas encore', () => {
  const d = path.join(dossierTemporaire(), 'pas', 'encore', 'la');
  const etat = sauvegardeDatee(CONTENU, d, 30, '2026-09-01');
  assert.equal(etat.erreur, '');
  assert.ok(fs.existsSync(path.join(d, 'pdu-parc-auto-2026-09-01.json')));
});

test('les fichiers etrangers au format ne sont ni listes ni effaces', () => {
  const d = dossierTemporaire();
  fs.writeFileSync(path.join(d, 'notes.txt'), 'a garder');
  fs.writeFileSync(path.join(d, 'pdu-parc-auto.json'), 'pas date');
  for (const jour of ['2026-08-30', '2026-08-31', '2026-09-01']) {
    sauvegardeDatee(CONTENU, d, 1, jour);
  }
  assert.deepEqual(listerSauvegardes(d).map((f) => f.date), ['2026-09-01']);
  assert.ok(fs.existsSync(path.join(d, 'notes.txt')), 'fichier etranger efface');
  assert.ok(fs.existsSync(path.join(d, 'pdu-parc-auto.json')), 'fichier non date efface');
});

test('aucun fichier temporaire ne subsiste apres une copie reussie', () => {
  const d = dossierTemporaire();
  sauvegardeDatee(CONTENU, d, 30, '2026-09-01');
  assert.deepEqual(fs.readdirSync(d).filter((f) => f.endsWith('.tmp')), []);
});

test('lister un dossier qui n’existe pas rend une liste vide', () => {
  assert.deepEqual(listerSauvegardes(path.join(os.tmpdir(), 'nexiste-vraiment-pas-pdu')), []);
  assert.deepEqual(listerSauvegardes(''), []);
});
