/* Saisie : Maj + F3 comme dans Word, et propositions de mots. */

import test from 'node:test';
import assert from 'node:assert/strict';
import './aide.mjs';

const { changerCasse, motAutour } = await import('../resources/js/ui/majuscule.js');
const { vocabulaire, proposer, accorder, motEnCours, retenirMots } = await import('../resources/js/ui/suggestions.js');

test('Maj + F3 suit l’ordre de Word : minuscules, Chaque Mot, MAJUSCULES', () => {
  assert.equal(changerCasse('shell cap-nord'), 'Shell Cap-Nord');
  assert.equal(changerCasse('Shell Cap-Nord'), 'SHELL CAP-NORD');
  assert.equal(changerCasse('SHELL CAP-NORD'), 'shell cap-nord');
  assert.equal(changerCasse('vidAnge'), 'VIDANGE');
  assert.equal(changerCasse('l’école élevée'), 'L’école Élevée');
  assert.equal(changerCasse('D45 5081'), 'd45 5081');
  assert.equal(changerCasse('12 345'), '12 345');
});

test('sans selection, Maj + F3 prend le mot sous le curseur', () => {
  assert.deepEqual(motAutour('pneu avant-gauche usé', 8), [5, 17]);
  assert.deepEqual(motAutour('pneu usé', 4), [0, 4]);
  assert.deepEqual(motAutour('a  b', 2), [2, 2]);
});

const base = {
  accounts: [{ login: 'secretlogin', password: 'motdepassesecret' }],
  dotationPool: [{ station: 'SHELL CAP-NORD' }, { station: 'SHELL CAP-NORD' }, { station: 'TOTAL RIVIERA' }],
  missions: [{ destination: 'Yamoussoukro', observations: 'Vidange faite à Yamoussoukro', images: [{ nom: 'photographie' }] }],
  settings: { dossierSauvegarde: 'Documents' }
};

test('le vocabulaire vient des saisies, pas des comptes ni des reglages', () => {
  const voc = vocabulaire(base);
  assert.equal(voc.get('shell').mot, 'SHELL');
  assert.equal(voc.get('shell').n, 2);
  assert.equal(voc.get('yamoussoukro').n, 2);
  assert.equal(voc.has('motdepassesecret'), false);
  assert.equal(voc.has('secretlogin'), false);
  assert.equal(voc.has('documents'), false);
  assert.equal(voc.has('photographie'), false);
});

test('les propositions suivent le debut tape, accents et casse mis a part', () => {
  const voc = vocabulaire(base);
  assert.deepEqual(proposer(voc, 'yam'), ['Yamoussoukro']);
  assert.deepEqual(proposer(voc, 'vid'), ['Vidange']);
  assert.deepEqual(proposer(voc, 'v'), []);
  // Le mot deja tape en entier n'est pas repropose.
  assert.deepEqual(proposer(voc, 'shell'), []);
});

test('le mot propose s’ecrit comme on l’a commence', () => {
  assert.equal(accorder('SHE', 'Shell'), 'SHELL');
  assert.equal(accorder('Yam', 'yamoussoukro'), 'Yamoussoukro');
  assert.equal(accorder('yam', 'Yamoussoukro'), 'yamoussoukro');
});

test('le debut de mot est pris juste avant le curseur', () => {
  assert.deepEqual(motEnCours('Pneu avant-gau', 14), { debut: 5, mot: 'avant-gau' });
  assert.deepEqual(motEnCours('Pneu ', 5), { debut: 5, mot: '' });
});

test('les mots que l’on tape le plus passent en tete', () => {
  const voc = vocabulaire({ missions: [{ observations: 'Vidange, Vidange' }], users: [{ nom: 'VIDAL' }] });
  assert.deepEqual(proposer(voc, 'vid'), ['Vidange', 'VIDAL']);
  const usage = {};
  retenirMots(usage, 'VIDAL');
  retenirMots(usage, 'Vidal');
  assert.equal(usage.vidal.n, 2);
  assert.deepEqual(proposer(voc, 'vid', 6, usage), ['Vidal', 'Vidange']);
});

const { preparerDictionnaire, motsDuDictionnaire } = await import('../resources/js/core/dictionnaire.js');
const { createRequire } = await import('node:module');

test('le dictionnaire propose les mots les plus courts d’abord, accents mis a part', () => {
  preparerDictionnaire(['vidangeaient', 'vidange', 'vidanger', 'vie', 'véhicule', 'véhicules', 'vehiculer']);
  assert.deepEqual(motsDuDictionnaire('vid'), ['vidange', 'vidanger', 'vidangeaient']);
  assert.deepEqual(motsDuDictionnaire('vehi', 2), ['véhicule', 'vehiculer']);
  // « vie » a moins de quatre lettres : il n'est pas propose.
  assert.deepEqual(motsDuDictionnaire('vi', 10).includes('vie'), false);
});

test('le dictionnaire passe apres les mots du parc et ceux qu’on utilise', () => {
  const voc = vocabulaire({ missions: [{ observations: 'Vidange' }] });
  assert.deepEqual(proposer(voc, 'vid', 3, {}, ['vidange', 'vidanger', 'vidangeur']), ['Vidange', 'vidanger', 'vidangeur']);
});

test('le vrai dictionnaire francais se charge et repond vite', () => {
  const liste = createRequire(import.meta.url)('an-array-of-french-words');
  assert.ok(liste.length > 300000);
  preparerDictionnaire(liste);
  const t = Date.now();
  const r = motsDuDictionnaire('carbu');
  // Large : la machine peut etre occupee (construction en cours).
  assert.ok(Date.now() - t < 300);
  assert.ok(r.includes('carburant'), r.join(', '));
  assert.ok(motsDuDictionnaire('vehic').includes('véhicule'));
});
