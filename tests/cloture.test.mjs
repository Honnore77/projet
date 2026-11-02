/* Corrections de l'audit de cloture : couts, arrondi, reglages, compteur, garage. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db, charger, vehicule } from './aide.mjs';

const { francSup } = await import('../resources/js/core/utils.js');
const { dsCoutParVehicule, dsDotationPool, dsAll } = await import('../resources/js/export/datasets.js');
const { statsVehicules } = await import('../resources/js/core/statistiques.js');
const { synchroniserEtats } = await import('../resources/js/core/etatsVehicules.js');

const parc = () => ({ pool: [vehicule({ id: 'v1', immatNouvelle: 'D45 5082', immatAncienne: 'D45 846' })], mission: [], service: [] });

test('le cout d’un vehicule reunit l’ancienne et la nouvelle plaque', async () => {
  await charger({
    vehicles: parc(),
    dotationPool: [{ id: 'a', immat: 'D45 846', montant: 100, date: '2026-01-01' }, { id: 'b', immat: 'D45 5082', montant: 50, date: '2026-02-01' }],
    missions: [{ id: 'm', vehicule: 'D45 846', ravitaillements: [{ montant: 25, quantite: 1, prixL: 25 }] }],
    maintenance: [{ id: 'g', immat: 'D45 846', interventions: [{ cout: 10 }] }]
  });
  assert.equal(db.fuelCost('D45 5082'), 175);
  assert.equal(db.maintenanceCost('D45 5082'), 10);
  const ligne = dsCoutParVehicule().rows[0];
  assert.equal(ligne.total, 185);
  assert.equal(ligne.passagesGarage, 1);
});

test('le carburant hors du parc est signale sous le tableau des couts', async () => {
  await charger({ vehicles: parc(), dotationPool: [{ id: 'a', immat: '00001', montant: 54380, date: '2026-01-01' }] });
  assert.match(dsCoutParVehicule().note, /54.380 F/);
});

test('l’arrondi au franc superieur ne compte pas les miettes de calcul', () => {
  assert.equal(francSup(21.42 * 700), 14994);
  assert.equal(francSup(((55 * 4) / 100) * 700), 1540);
  assert.equal(francSup(14994.01), 14995);
});

test('une ancienne base recoit les reglages par defaut qui lui manquent', () => {
  const n = db.normalize({ settings: { organisation: 'X' } });
  assert.equal(n.settings.organisation, 'X');
  assert.equal(n.settings.seuilImmobilisationJours, 7);
  assert.equal(n.settings.sauvegardesConservees, 30);
});

test('sans km d’arrivee, pas de distance au compteur', () => {
  assert.equal(db.distanceCompteur({ kmDepart: 42589, kmArrivee: '' }), null);
  assert.equal(db.distanceCompteur({ kmDepart: 100, kmArrivee: 350 }), 250);
});

test('les totaux des exports sont arrondis', async () => {
  await charger({ dotationPool: [{ id: 'a', immat: 'X', quantite: 0.1, montant: 1, date: '2026-01-01' }, { id: 'b', immat: 'X', quantite: 0.2, montant: 1, date: '2026-01-02' }] });
  assert.match(dsDotationPool().note, /^Total : 0,3 L/);
});

test('le rapport complet porte aussi les courses, vidanges et garages', async () => {
  await charger();
  const titres = dsAll().map((d) => d.title);
  ['Courses', 'Vidanges', 'Garages', 'Suivi des missions', 'Simulations de mission'].forEach((t) => assert.ok(titres.includes(t), t));
  assert.equal(new Set(titres).size, titres.length);
});

test('une sortie du garage annulee remet le motif en cours', () => {
  const base = { missions: [], users: [], dotationPool: [], vidanges: [], etatsVehicules: [], vehicles: { pool: [], mission: [], service: [] },
    maintenance: [{ id: 'g1', immat: 'D45 1', motif: 'Panne', dateEntree: '2026-10-01', dateRetour: '2026-10-05' }] };
  synchroniserEtats(base);
  assert.equal(base.etatsVehicules[0].resolu, 'Oui');
  base.maintenance[0].dateRetour = '2026-10-06';
  synchroniserEtats(base);
  assert.equal(base.etatsVehicules[0].dateResolution, '2026-10-06');
  base.maintenance[0].dateRetour = '';
  synchroniserEtats(base);
  assert.equal(base.etatsVehicules[0].resolu, 'Non');
  assert.equal(synchroniserEtats(base), 0);
});

test('un vehicule au garage compte dans les statistiques, une seule fois', async () => {
  await charger({ vehicles: parc(), maintenance: [
    { id: 'g1', immat: 'D45 846', dateEntree: '2026-10-01' },
    { id: 'g2', immat: 'D45 5082', dateEntree: '2026-10-02' }
  ] });
  assert.equal(statsVehicules('').tuiles.find((t) => /garage/i.test(t.titre)).valeur, '1');
});
