/* VÉHICULES → « Actualiser KM » : le releve a la main et l'origine du kilometrage. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db, charger, vehicule } from './aide.mjs';

const { derniereLectureKm, kmCourant, origineKm } = db;
const { COLLECTIONS_SYNCHRO } = await import('../resources/js/core/synchro.js');
const { dsVehicles } = await import('../resources/js/export/datasets.js');

const v = () => vehicule({ id: 'v1', immatAncienne: 'D45 846', immatNouvelle: 'D45 5082', km: 60000 });

test('une sauvegarde d’avant se charge avec une liste de releves vide, synchronisee', async () => {
  const base = await charger();
  assert.deepEqual(base.relevesKm, []);
  assert.ok(COLLECTIONS_SYNCHRO.includes('relevesKm'));
});

test('le kilometrage actualise devient le kilometrage du vehicule, avec qui et quand', async () => {
  await charger({
    vehicles: { pool: [v()], mission: [], service: [] },
    dotationPool: [{ id: 'd', date: '2026-11-03', immat: 'D45 5082', km: 71000 }],
    relevesKm: [{ id: 'r', immat: 'd45 846', date: '2026-11-06', km: 71250, saisiPar: 'KONE ALI' }]
  });
  const l = derniereLectureKm('D45 5082');
  assert.equal(l.km, 71250);
  assert.equal(kmCourant(db.DB.vehicles.pool[0]), 71250);
  assert.equal(origineKm(l), 'actualisé par KONE ALI le 06/11/2026');
});

test('l’origine dit d’ou vient le chiffre : « carburant du … »', async () => {
  await charger({
    vehicles: { pool: [v()], mission: [], service: [] },
    dotationPool: [{ id: 'd', date: '2026-11-03', immat: 'D45 5082', km: 71000 }]
  });
  assert.equal(origineKm(derniereLectureKm('D45 5082')), 'carburant du 03/11/2026');
  assert.equal(dsVehicles().rows[0].origineKm, 'carburant du 03/11/2026');
  // Sans aucune lecture datee : le chiffre de la fiche, sans origine.
  await charger({ vehicles: { pool: [v()], mission: [], service: [] } });
  assert.equal(origineKm(derniereLectureKm('D45 5082')), '');
});
