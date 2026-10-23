/* GRAPHIQUE AU CHOIX : colonnes, regroupement, mesures, filtre d'annee. */

import test from 'node:test';
import assert from 'node:assert/strict';

const gl = await import('../resources/js/core/graphiqueLibre.js');

const ds = {
  columns: [
    { key: 'date', label: 'Date' },
    { key: 'immat', label: 'Immatriculation' },
    { key: 'montant', label: 'Montant' },
    { key: 'jours', label: 'Jours' }
  ],
  rows: [
    { date: '03/08/2026', immat: 'D45 5081', montant: 25000, jours: 2 },
    { date: '10/08/2026', immat: 'D45 5081', montant: 15000, jours: 1 },
    { date: '12/09/2026', immat: 'D45 663', montant: 30000, jours: 2 },
    { date: '05/12/2025', immat: '', montant: 10000, jours: '' }
  ]
};

test('chaque colonne dit si elle regroupe ou se mesure', () => {
  const c = Object.fromEntries(gl.analyserColonnes(ds).map((x) => [x.key, x]));
  assert.equal(c.date.date, true);
  assert.equal(c.immat.chiffree, false);
  assert.equal(c.immat.regroupe, true);
  assert.equal(c.montant.chiffree, true);
  // Peu de valeurs : un nombre peut aussi regrouper.
  assert.equal(c.jours.regroupe, true);
  assert.deepEqual(gl.mesuresPossibles(gl.analyserColonnes(ds)).map((m) => m.value),
    ['nombre', 'somme:montant', 'moyenne:montant', 'somme:jours', 'moyenne:jours']);
});

test('regrouper par categorie : nombre, somme et moyenne, du plus grand au plus petit', () => {
  const immat = { key: 'immat', date: false };
  assert.deepEqual(gl.regrouper(ds.rows, immat, 'nombre'), { libelles: ['D45 5081', 'D45 663', 'non renseigné'], valeurs: [2, 1, 1], total: 4 });
  assert.deepEqual(gl.regrouper(ds.rows, immat, 'somme:montant').valeurs, [40000, 30000, 10000]);
  const moy = gl.regrouper(ds.rows, immat, 'moyenne:montant');
  assert.deepEqual(moy.libelles, ['D45 663', 'D45 5081', 'non renseigné']);
  assert.deepEqual(moy.valeurs, [30000, 20000, 10000]);
  assert.equal(moy.total, null);
});

test('une colonne de date se regroupe par mois, sans trou dans le calendrier', () => {
  const r = gl.regrouper(ds.rows, { key: 'date', date: true }, 'somme:montant');
  // De décembre 2025 à septembre 2026 : dix mois, les vides a zero.
  assert.equal(r.libelles.length, 10);
  assert.deepEqual([r.libelles[0], r.libelles[1], r.libelles.at(-2), r.libelles.at(-1)], ['déc. 2025', 'janv. 2026', 'août 2026', 'sept. 2026']);
  assert.deepEqual([r.valeurs[0], r.valeurs[1], r.valeurs.at(-2), r.valeurs.at(-1)], [10000, 0, 40000, 30000]);
  const an = gl.regrouper(gl.lignesDeLAnnee(ds.rows, 'date', '2026'), { key: 'date', date: true }, 'nombre', { annee: '2026' });
  assert.equal(an.libelles.length, 12);
  assert.deepEqual([an.libelles[7], an.valeurs[7], an.valeurs[8], an.valeurs[0]], ['août', 2, 1, 0]);
});

test('le filtre d’annee lit la premiere annee de la colonne de date', () => {
  assert.equal(gl.lignesDeLAnnee(ds.rows, 'date', '2025').length, 1);
  assert.equal(gl.lignesDeLAnnee([{ p: '30/12/2025 - 02/01/2026' }], 'p', '2025').length, 1);
  assert.equal(gl.lignesDeLAnnee(ds.rows, undefined, '2025').length, 4);
});

test('au-dela de la limite, les plus petites categories passent sous « autres »', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ k: `v${String(i).padStart(2, '0')}` }));
  const r = gl.regrouper(rows, { key: 'k', date: false }, 'nombre');
  assert.equal(r.libelles.length, gl.LIMITE_CATEGORIES);
  assert.equal(r.libelles.at(-1), 'autres');
  assert.equal(r.valeurs.at(-1), 20 - (gl.LIMITE_CATEGORIES - 1));
});
