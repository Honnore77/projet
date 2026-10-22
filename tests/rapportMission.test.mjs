/* Rapport de mission : frais saisis a la main totalises avec le carburant. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from './aide.mjs';

test('le total du rapport additionne carburant, frais OM, peage et divers', () => {
  const t = db.totauxRapportMission({
    ravitaillements: [{ quantite: 40, prixL: 875 }, { quantite: 20.5, prixL: 875 }],
    fraisOm: 12000, fraisPeage: '3000', depenseDivers: 2500
  });
  assert.equal(t.carburant, 35000 + 17938);
  assert.equal(t.fraisOm, 12000);
  assert.equal(t.fraisPeage, 3000);
  assert.equal(t.depenseDivers, 2500);
  assert.equal(t.total, 35000 + 17938 + 12000 + 3000 + 2500);
});

test('un rapport sans frais saisis a pour total le seul carburant', () => {
  const t = db.totauxRapportMission({ ravitaillements: [{ quantite: 10, prixL: 700 }], fraisOm: '', fraisPeage: undefined });
  assert.equal(t.total, 7000);
  assert.equal(db.totauxRapportMission({}).total, 0);
});

test('un ravitaillement saisi en montant garde ce montant, la quantite en decoule', () => {
  assert.equal(db.quantiteRavitaillement(20000, 875), 22.86);
  assert.equal(db.quantiteRavitaillement(20000, ''), 0);
  const r = { prixL: 875, montant: 20000, quantite: db.quantiteRavitaillement(20000, 875) };
  assert.equal(db.ravMontant(r), 20000);
  // Saisi en litres avant la 4.4.43 : le montant reste quantite x prix.
  assert.equal(db.ravMontant({ quantite: 40, prixL: 875 }), 35000);
  assert.equal(db.totauxRapportMission({ ravitaillements: [r, { quantite: 40, prixL: 875 }] }).carburant, 55000);
});
