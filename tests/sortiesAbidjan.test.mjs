/* SORTIES D'ABIDJAN : a part des missions, mais reprises partout ailleurs. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db, charger, vehicule } from './aide.mjs';

const { COLLECTIONS_SYNCHRO } = await import('../resources/js/core/synchro.js');
const { dsSortiesAbidjan } = await import('../resources/js/export/datasets.js');

const {
  prochaineRefSortieAbidjan, refSortieAbidjanEnDouble, cumulsJoursConducteurs, rangsMissionsConducteurs,
  rotationConducteurs, derniereLectureKm, fuelCost, knownDrivers, renommerDestinationMission, parcoursMission
} = db;

const sortie = (o = {}) => Object.assign({
  id: 's1', ref: 'SA-001', date: '2026-11-03', conducteur: 'KONE ALI', vehicule: 'D45 5081',
  destination: 'Yamoussoukro', destinations: ['Yamoussoukro'], kmDepart: 70000, kmArrivee: 70500,
  ravitaillements: [{ date: '2026-11-03', station: 'SHELL', prixL: 875, montant: 17500, quantite: 20 }],
  fraisPeage: 3000
}, o);

test('une sauvegarde d’avant la sous-rubrique se charge avec une liste vide', async () => {
  const base = await charger();
  assert.deepEqual(base.sortiesAbidjan, []);
});

test('la reference suit le plus grand numero SA-', async () => {
  await charger({ sortiesAbidjan: [sortie({ id: 'a', ref: 'SA-001' }), sortie({ id: 'b', ref: 'SA-004' })] });
  assert.equal(prochaineRefSortieAbidjan(), 'SA-005');
  assert.equal(refSortieAbidjanEnDouble('sa-004', 'a'), true);
  assert.equal(refSortieAbidjanEnDouble('SA-004', 'b'), false);
});

test('une sortie ne compte ni dans les jours, ni dans le rang, ni dans le tour de role', async () => {
  const mission = { id: 'm1', ref: 'M-001', conducteur: 'KONE ALI', dateDepart: '2026-11-01', dateRetour: '2026-11-02', jours: 2 };
  await charger({ missions: [mission] });
  const avant = { jours: cumulsJoursConducteurs().get('m1'), rang: rangsMissionsConducteurs().get('m1'), tour: JSON.stringify(rotationConducteurs()) };
  await charger({ missions: [mission], sortiesAbidjan: [sortie(), sortie({ id: 's2', ref: 'SA-002' })] });
  assert.equal(cumulsJoursConducteurs().get('m1'), avant.jours);
  assert.equal(rangsMissionsConducteurs().get('m1'), avant.rang);
  assert.equal(JSON.stringify(rotationConducteurs()), avant.tour);
});

test('le kilometrage, le carburant et les conducteurs suivent la sortie', async () => {
  await charger({
    vehicles: { pool: [vehicule({ immatNouvelle: 'D45 5081', km: 69000 })], mission: [], service: [] },
    sortiesAbidjan: [sortie()]
  });
  assert.equal(derniereLectureKm('D45 5081').km, 70500);
  assert.equal(fuelCost('D45 5081'), 17500);
  assert.ok(knownDrivers().includes('KONE ALI'));
});

test('la sortie se synchronise et suit le renommage de sa destination', async () => {
  assert.ok(COLLECTIONS_SYNCHRO.includes('sortiesAbidjan'));
  const base = await charger({ destinationsMission: [{ id: 'd1', nom: 'Yamoussoukro', distanceKm: 240 }], sortiesAbidjan: [sortie()] });
  assert.equal(parcoursMission(base.sortiesAbidjan[0]).total, 480);
  assert.equal(renommerDestinationMission('Yamoussoukro', 'YAMOUSSOUKRO'), 1);
  assert.equal(base.sortiesAbidjan[0].destination, 'YAMOUSSOUKRO');
  assert.deepEqual(base.sortiesAbidjan[0].destinations, ['YAMOUSSOUKRO']);
});

test('l’export porte le total des depenses', async () => {
  await charger({ sortiesAbidjan: [sortie({ fraisOm: 10000 })] });
  const ds = dsSortiesAbidjan();
  assert.equal(ds.rows[0].total, 17500 + 3000 + 10000);
  assert.equal(ds.rows[0].distance, 500);
});
