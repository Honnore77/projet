/* Vehicules reformes : sortie du parc, retour, synchronisation. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db, charger, vehicule } from './aide.mjs';

const sy = await import('../resources/js/core/synchro.js');

const IMMAT = '1234 AB 01';

test('une base sans sous-rubrique des reformes en recoit une vide', async () => {
  const base = await charger();
  assert.deepEqual(base.vehicles.reforme, []);
});

test('un vehicule reforme sort du parc mais garde sa fiche', async () => {
  await charger({
    vehicles: { pool: [vehicule({ id: 'v1', immatNouvelle: IMMAT, km: 52000, kmVidange: 50000 })], mission: [], service: [] }
  });
  assert.equal(db.voyantsVidange().length, 1);

  const v = db.reformerVehicule('v1', 'pool', {
    dateReforme: '2026-10-15', beneficiaire: 'Lycée technique', kmReforme: 52000, etatReforme: 'Mauvais état', anneeMiseService: 2014
  });
  assert.equal(v.statut, 'Réformé');
  assert.equal(v.origine, 'pool');
  assert.equal(db.DB.vehicles.pool.length, 0);
  assert.equal(db.DB.vehicles.reforme.length, 1);

  // Hors du parc : plus de voyant, plus de vehicule pour une mission...
  assert.equal(db.allVehicles().length, 0);
  assert.equal(db.vehicleByImmat(IMMAT), null);
  assert.equal(db.voyantsVidange().length, 0);
  // ... mais sa fiche se retrouve toujours.
  const fiche = db.vehiculeReformeParImmat(IMMAT);
  assert.equal(fiche._cat, 'reforme');
  assert.equal(fiche.beneficiaire, 'Lycée technique');
});

test('annuler une reforme remet le vehicule dans sa categorie, disponible', async () => {
  await charger({
    vehicles: { pool: [], mission: [], service: [vehicule({ id: 'v1', immatNouvelle: IMMAT })] }
  });
  db.reformerVehicule('v1', 'service', { dateReforme: '2026-10-15' });
  assert.equal(db.remettreEnService('v1'), 'service');
  assert.equal(db.DB.vehicles.reforme.length, 0);
  assert.equal(db.DB.vehicles.service[0].statut, 'Disponible');
  assert.equal(db.DB.vehicles.service[0].dateReforme, '2026-10-15');
});

test('la reforme faite sur un appareil passe sur l’autre a la synchronisation', () => {
  const vide = { pool: [], mission: [], service: [] };
  const base = (vehicles) => ({
    accounts: [], users: [], dotationPool: [], missions: [], maintenance: [], decharges: [], destinataires: [],
    destinationsMission: [], trajets: [], simulations: [], indisponibilites: [],
    vehicles, settings: {}, synchro: { suppressions: [] }
  });
  const pc = base(Object.assign({}, vide, { pool: [{ id: 'v1', immatNouvelle: IMMAT }] }));
  const tel = JSON.parse(JSON.stringify(pc));
  const avant = sy.empreintesDe(tel);
  tel.vehicles = Object.assign({}, vide, { reforme: [Object.assign(tel.vehicles.pool[0], { statut: 'Réformé', origine: 'pool' })] });
  sy.estampiller(tel, avant, '2026-10-15T08:00:00.000Z', 'TEL');
  const { db: fusion } = sy.fusionner(pc, tel, { maintenant: '2026-10-15T09:00:00.000Z', iciGagneEgalite: true });
  assert.equal(fusion.vehicles.pool.length, 0);
  assert.equal(fusion.vehicles.reforme[0].id, 'v1');
});

test('les annees de service vont de la mise en service a l’annee de la reforme', () => {
  assert.equal(db.anneesDeService({ anneeMiseService: 2014, dateReforme: '2026-10-15' }), 12);
  assert.equal(db.anneesDeService({ anneeMiseService: 2014, dateReforme: '' }), null);
  assert.equal(db.anneesDeService({ dateReforme: '2026-10-15' }), null);
});
