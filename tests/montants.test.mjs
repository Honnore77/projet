/* Les montants : arrondi au franc superieur, partout et une seule fois. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db, charger } from './aide.mjs';
import { francSup } from '../resources/js/core/utils.js';

test('francSup arrondit vers le haut, jamais au plus proche', () => {
  assert.equal(francSup(1.01), 2);
  assert.equal(francSup(1.5), 2);
  assert.equal(francSup(1.99), 2);
  assert.equal(francSup(714.5), 715);
  // Un entier ne bouge pas : arrondir deux fois ne doit rien ajouter.
  assert.equal(francSup(1000), 1000);
  assert.equal(francSup(francSup(35725.4)), francSup(35725.4));
});

test('francSup traite le vide et l’illisible comme zero, pas comme NaN', () => {
  assert.equal(francSup(''), 0);
  assert.equal(francSup('abc'), 0);
  assert.equal(francSup(null), 0);
  assert.equal(francSup(undefined), 0);
});

test('le montant d’un ravitaillement est arrondi une fois, a la fin', () => {
  // 33,33 L a 715 F font 23 830,95 F : le franc superieur est 23 831.
  assert.equal(db.ravMontant({ quantite: 33.33, prixL: 715 }), 23831);
  // Arrondir les litres d'abord donnerait 34 x 715 = 24 310 : ce n'est pas
  // la regle. Seul le montant s'arrondit, jamais le volume.
  assert.notEqual(db.ravMontant({ quantite: 33.33, prixL: 715 }), 24310);
});

test('les fiches enregistrees avec des centimes sont reprises au chargement', async () => {
  const base = await charger({
    dotationPool: [{
      id: 'd1', date: '2026-08-01', immat: 'D45 50 1234', quantite: 50,
      prixL: 714.5, montant: 35725.4, soldeAvant: 200000.7, soldeApres: 164275.3
    }],
    missions: [{
      id: 'm1', conducteur: 'X', dateDepart: '2026-06-15',
      montant: 150000.6, dotationCarburant: 50000.2,
      ravitaillements: [{ quantite: 33.33, prixL: 714.5 }]
    }],
    maintenance: [{ id: 'e1', immat: 'D45 50 1234', dateEntree: '2026-07-01',
      interventions: [{ cout: 45000.9 }, { cout: 12500.55 }] }],
    settings: { prixLitreEssence: 874.3, prixLitreDiesel: 714.5 }
  });

  const d = base.dotationPool[0];
  assert.deepEqual(
    { prixL: d.prixL, montant: d.montant, soldeAvant: d.soldeAvant, soldeApres: d.soldeApres },
    { prixL: 715, montant: 35726, soldeAvant: 200001, soldeApres: 164276 }
  );

  const m = base.missions[0];
  assert.equal(m.montant, 150001);
  assert.equal(m.dotationCarburant, 50001);
  assert.equal(m.ravitaillements[0].prixL, 715);

  assert.deepEqual(base.maintenance[0].interventions.map((i) => i.cout), [45001, 12501]);
  assert.equal(base.settings.prixLitreEssence, 875);
  assert.equal(base.settings.prixLitreDiesel, 715);
});

test('les litres gardent leurs decimales : un volume n’est pas un montant', async () => {
  const base = await charger({
    missions: [{ id: 'm1', conducteur: 'X', dateDepart: '2026-06-15',
      ravitaillements: [{ quantite: 33.33, prixL: 714.5 }] }]
  });
  assert.equal(base.missions[0].ravitaillements[0].quantite, 33.33);
});

test('les totaux tombent sur des francs entiers', async () => {
  await charger({
    vehicles: { pool: [{ id: 'v1', immatNouvelle: 'D45 50 1234', km: 10000 }], mission: [], service: [] },
    dotationPool: [{ id: 'd1', immat: 'D45 50 1234', date: '2026-08-01',
      quantite: 33.33, prixL: 714.5, montant: 23830.95 }],
    maintenance: [{ id: 'e1', immat: 'D45 50 1234', dateEntree: '2026-07-01',
      interventions: [{ cout: 45000.9 }, { cout: 12500.55 }] }]
  });
  assert.ok(Number.isInteger(db.fuelCost('D45 50 1234')), 'cout carburant entier');
  assert.ok(Number.isInteger(db.maintenanceCost('D45 50 1234')), 'cout entretien entier');
  assert.equal(db.maintenanceCost('D45 50 1234'), 45001 + 12501);
});

test('un champ laisse vide le reste : zero n’est pas « non renseigne »', async () => {
  const base = await charger({
    dotationPool: [{ id: 'd1', immat: 'D45 50 1234', date: '2026-08-01',
      quantite: 10, prixL: 700, montant: 7000, soldeAvant: '', soldeApres: '' }]
  });
  assert.equal(base.dotationPool[0].soldeAvant, '');
  assert.equal(base.dotationPool[0].soldeApres, '');
});
