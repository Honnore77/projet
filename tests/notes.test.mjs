/* NOTES : qui lit quoi, notes non lues, reponses. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db, charger } from './aide.mjs';

const {
  peutLire, notesRecues, notesEnvoyees, notesNonLues, marquerLues, comptesDestinataires,
  peutModifierNote, peutSupprimerNote, destinatairesReponse, reponsesA
} = await import('../resources/js/core/notes.js');
const { COLLECTIONS_SYNCHRO } = await import('../resources/js/core/synchro.js');

const comptes = [
  { id: 'a', login: 'admin', nom: 'Admin', role: 'admin', actif: true },
  { id: 'b', login: 'bob', nom: 'Bob', role: 'conducteur', actif: true },
  { id: 'c', login: 'cleo', nom: 'Cléo', role: 'saisie', actif: true },
  { id: 'd', login: 'dan', nom: 'Dan', role: 'direction', actif: false, enAttente: true }
];
const notes = [
  { id: 'n1', auteurId: 'b', visibilite: 'publique', sujet: 'Pour tous', date: '2026-10-16T08:00:00Z' },
  { id: 'n2', auteurId: 'b', visibilite: 'privee', destinataires: ['c'], sujet: 'Pour Cléo', date: '2026-10-16T09:00:00Z' },
  { id: 'n3', auteurId: 'c', visibilite: 'privee', destinataires: ['b'], sujet: 'Re : Pour Cléo', reponseA: 'n2', date: '2026-10-16T10:00:00Z' }
];

test('une note publique se lit par tous, une note privée par son auteur et ses destinataires', async () => {
  await charger({ accounts: comptes, notes });
  assert.equal(peutLire(notes[0], 'a'), true);
  assert.equal(peutLire(notes[1], 'b'), true);
  assert.equal(peutLire(notes[1], 'c'), true);
  // L'administrateur ne lit pas les notes privées des autres.
  assert.equal(peutLire(notes[1], 'a'), false);
  assert.deepEqual(notesRecues('a').map((n) => n.id), ['n1']);
  assert.deepEqual(notesRecues('c').map((n) => n.id), ['n2', 'n1']);
  assert.deepEqual(notesEnvoyees('b').map((n) => n.id), ['n2', 'n1']);
});

test('les notes lues sont rangées sur le compte et ne comptent plus', async () => {
  await charger({ accounts: comptes, notes });
  assert.deepEqual(notesNonLues('c').map((n) => n.id), ['n2', 'n1']);
  assert.equal(marquerLues(['n1'], 'c'), true);
  assert.equal(marquerLues(['n1'], 'c'), false);
  assert.deepEqual(notesNonLues('c').map((n) => n.id), ['n2']);
  assert.deepEqual(db.DB.accounts.find((x) => x.id === 'c').notesLues, ['n1']);
});

test('on écrit aux comptes actifs et validés, pas à soi-même', async () => {
  await charger({ accounts: comptes, notes });
  assert.deepEqual(comptesDestinataires('b').map((x) => x.id), ['a', 'c']);
});

test('modifier : l’auteur ; supprimer : l’auteur ou un administrateur', () => {
  assert.equal(peutModifierNote(notes[0], { id: 'b', role: 'conducteur' }), true);
  assert.equal(peutModifierNote(notes[0], { id: 'a', role: 'admin' }), false);
  assert.equal(peutSupprimerNote(notes[0], { id: 'a', role: 'admin' }), true);
  assert.equal(peutSupprimerNote(notes[0], { id: 'c', role: 'saisie' }), false);
});

test('répondre à une note privée s’adresse à l’auteur et aux autres destinataires', async () => {
  await charger({ accounts: comptes, notes });
  assert.deepEqual(destinatairesReponse({ auteurId: 'b', visibilite: 'privee', destinataires: ['c', 'a'] }, 'c'), ['b', 'a']);
  assert.deepEqual(destinatairesReponse(notes[0], 'c'), ['b']);
  assert.deepEqual(reponsesA('n2', 'b').map((n) => n.id), ['n3']);
});

test('les notes suivent la synchronisation', () => {
  assert.ok(COLLECTIONS_SYNCHRO.includes('notes'));
});
