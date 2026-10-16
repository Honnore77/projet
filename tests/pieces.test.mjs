/* Pieces jointes des notes : formats acceptes, versions, et citation pour la synchronisation. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db, charger } from './aide.mjs';

const { formatDe, refusPiece, modifiable, idsDesPieces, TAILLE_MAX } = await import('../resources/js/core/pieces.js');

test('seuls PDF, Excel et Word (.docx) sont acceptés', () => {
  assert.equal(formatDe('rapport.PDF'), 'pdf');
  assert.equal(formatDe('etat.xlsx'), 'excel');
  assert.equal(formatDe('ancien.xls'), 'excel');
  assert.equal(formatDe('lettre.docx'), 'word');
  assert.equal(formatDe('photo.jpg'), null);
  assert.match(refusPiece('lettre.doc', 100), /\.docx/);
  assert.match(refusPiece('photo.jpg', 100), /PDF, Excel ou Word/);
  assert.match(refusPiece('gros.pdf', TAILLE_MAX + 1), /dépasse/);
  assert.equal(refusPiece('ok.pdf', 100), null);
});

test('Word et Excel (.xlsx) se modifient ; PDF et .xls se lisent seulement', () => {
  assert.equal(modifiable({ type: 'word', nom: 'a.docx' }), true);
  assert.equal(modifiable({ type: 'excel', nom: 'a.xlsx' }), true);
  assert.equal(modifiable({ type: 'excel', nom: 'a.xls' }), false);
  assert.equal(modifiable({ type: 'pdf', nom: 'a.pdf' }), false);
});

test('les pièces des notes, versions comprises, sont citées : synchronisées et gardées au ménage', async () => {
  await charger({
    notes: [{
      id: 'n1', auteurId: 'c1', visibilite: 'publique', sujet: 'Docs',
      pieces: [{ id: 'img_pjA', nom: 'a.docx', type: 'word', versions: [{ id: 'img_pjA0' }] }, { id: 'img_pjB', nom: 'b.pdf', type: 'pdf' }]
    }]
  });
  assert.deepEqual(idsDesPieces(db.DB.notes[0].pieces), ['img_pjA', 'img_pjA0', 'img_pjB']);
  const citees = db.imagesCitees();
  ['img_pjA', 'img_pjA0', 'img_pjB'].forEach((id) => assert.ok(citees.has(id), id));
});
