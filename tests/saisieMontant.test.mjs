/* La saisie d'un montant : les milliers groupes par trois pendant la frappe. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { grouperMilliers, lireMontant } from '../resources/js/core/utils.js';

test('les chiffres de la partie entiere sont groupes par trois', () => {
  assert.equal(grouperMilliers('3000000'), '3 000 000');
  assert.equal(grouperMilliers('20000'), '20 000');
  assert.equal(grouperMilliers('875'), '875');
  assert.equal(grouperMilliers(1250000), '1 250 000');
  // Une saisie deja groupee, ou mal groupee, se regroupe proprement.
  assert.equal(grouperMilliers('30 00 000'), '3 000 000');
  assert.equal(grouperMilliers('-15000'), '-15 000');
  assert.equal(grouperMilliers('12500,5'), '12 500,5');
  assert.equal(grouperMilliers('12a3'), '123');
  assert.equal(grouperMilliers(''), '');
  assert.equal(grouperMilliers(undefined), '');
});

test('le montant groupe se relit comme un nombre', () => {
  assert.equal(lireMontant('3 000 000'), 3000000);
  // fmt et le navigateur emploient aussi des espaces insecables.
  assert.equal(lireMontant('3 000 000'), 3000000);
  assert.equal(lireMontant('12 500,5'), 12500.5);
  assert.equal(lireMontant('-15 000'), -15000);
  assert.equal(lireMontant(''), '');
  assert.equal(lireMontant('  '), '');
});
