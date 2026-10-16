/* ÉTAT DES VÉHICULES : problemes en cours d'un vehicule, regles du signalement. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { charger, vehicule } from './aide.mjs';

const { problemesEnCours, signalementsDu, refusSignalement, relierRapportMission, rienASignaler } = await import('../resources/js/core/etatsVehicules.js');
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

test('le rapport de mission signale, met à jour puis retire le problème', () => {
  const base = { etatsVehicules: [] };
  const m = { id: 'm1', ref: 'M-004', vehicule: 'd45 50 1234', conducteur: 'DOSSO YAYA', dateDepart: '2026-10-10', dateRetour: '2026-10-12' };
  assert.equal(relierRapportMission(m, 'RAS', base), null);
  assert.equal(relierRapportMission(m, '  ', base), null);
  assert.equal(relierRapportMission(m, 'Phare droit cassé', base), 'cree');
  assert.deepEqual(
    (({ immat, probleme, dateSignalement, signalePar, resolu, missionRef }) => ({ immat, probleme, dateSignalement, signalePar, resolu, missionRef }))(base.etatsVehicules[0]),
    { immat: 'D45 50 1234', probleme: 'Phare droit cassé', dateSignalement: '2026-10-12', signalePar: 'DOSSO YAYA', resolu: 'Non', missionRef: 'M-004' }
  );
  assert.equal(relierRapportMission(m, 'Phare droit cassé', base), null);
  assert.equal(relierRapportMission(m, 'Phare droit et rétroviseur cassés', base), 'modifie');
  assert.equal(base.etatsVehicules.length, 1);
  assert.equal(relierRapportMission(m, 'R.A.S.', base), 'retire');
  assert.equal(base.etatsVehicules.length, 0);
});

test('un problème déjà résolu reste dans l’historique même si le rapport repasse à RAS', () => {
  const base = { etatsVehicules: [] };
  const m = { id: 'm2', vehicule: 'D45 50 1234', dateRetour: '2026-10-12' };
  relierRapportMission(m, 'Pneu crevé', base);
  base.etatsVehicules[0].resolu = 'Oui';
  base.etatsVehicules[0].dateResolution = '2026-10-13';
  assert.equal(relierRapportMission(m, 'RAS', base), null);
  assert.equal(base.etatsVehicules.length, 1);
  assert.equal(rienASignaler('Néant'), true);
  assert.equal(rienASignaler('Rien à signaler'), true);
  assert.equal(rienASignaler('Bruit moteur'), false);
});

test('les signalements suivent la synchronisation', () => {
  assert.ok(COLLECTIONS_SYNCHRO.includes('etatsVehicules'));
});
