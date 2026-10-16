/* ÉTAT DES VÉHICULES : problemes en cours d'un vehicule, regles du signalement. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { charger, vehicule } from './aide.mjs';

const { problemesEnCours, signalementsDu, refusSignalement } = await import('../resources/js/core/etatsVehicules.js');
const { COLLECTIONS_SYNCHRO } = await import('../resources/js/core/synchro.js');

const navara = vehicule({ id: 'v1', immatNouvelle: 'D45 50 1234', immatAncienne: 'D45 0987' });

test('seuls les problèmes non résolus restent dans « État du véhicule »', async () => {
  await charger({
    vehicles: { pool: [navara], mission: [], service: [] },
    etatsVehicules: [
      { id: 's1', immat: 'd45 50 1234', probleme: 'Frein avant', dateSignalement: '2026-10-10', resolu: 'Non' },
      { id: 's2', immat: 'D45 50 1234', probleme: 'Pneu', dateSignalement: '2026-10-12', resolu: 'Oui', dateResolution: '2026-10-13' },
      // L'ancienne plaque designe le meme vehicule.
      { id: 's3', immat: 'D45 0987', probleme: 'Voyant moteur', dateSignalement: '2026-10-14', resolu: 'Non' },
      { id: 's4', immat: 'D45 50 9999', probleme: 'Autre véhicule', dateSignalement: '2026-10-14', resolu: 'Non' }
    ]
  });
  assert.deepEqual(signalementsDu(navara).map((s) => s.id).sort(), ['s1', 's2', 's3']);
  assert.deepEqual(problemesEnCours(navara).map((s) => s.id), ['s3', 's1']);
});

test('un véhicule sans plaque complète n’emprunte pas les problèmes des autres', async () => {
  await charger({ etatsVehicules: [{ id: 's1', immat: 'D45 50', probleme: 'x', resolu: 'Non' }] });
  assert.deepEqual(problemesEnCours(vehicule({ immatNouvelle: 'D45 50 ', immatAncienne: 'D45 ' })), []);
});

test('un problème résolu porte sa date, jamais avant le signalement', () => {
  assert.match(refusSignalement({ resolu: 'Oui', dateSignalement: '2026-10-10' }), /date de résolution/);
  assert.match(refusSignalement({ resolu: 'Oui', dateSignalement: '2026-10-10', dateResolution: '2026-10-09' }), /précéder/);
  assert.equal(refusSignalement({ resolu: 'Oui', dateSignalement: '2026-10-10', dateResolution: '2026-10-10' }), null);
  assert.equal(refusSignalement({ resolu: 'Non', dateSignalement: '2026-10-10' }), null);
});

test('les signalements suivent la synchronisation', () => {
  assert.ok(COLLECTIONS_SYNCHRO.includes('etatsVehicules'));
});
