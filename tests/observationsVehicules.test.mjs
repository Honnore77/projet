/* ÉTAT DES VÉHICULES reprend les observations de toute l'application ; GARAGES. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { charger, vehicule, agent, db } from './aide.mjs';

const { synchroniserEtats } = await import('../resources/js/core/etatsVehicules.js');

const parOrigine = (base) => Object.fromEntries(base.etatsVehicules.map((s) => [s.origine, s]));

test('chaque observation sur un véhicule devient un signalement relié à sa source', async () => {
  const base = await charger({
    vehicles: { pool: [vehicule({ id: 'v1', immatNouvelle: 'D45 5081', observations: 'Rétroviseur fêlé' })], mission: [], service: [] },
    missions: [{ id: 'm1', ref: 'M-001', vehicule: 'D45 5081', conducteur: 'KOUASSI', dateRetour: '2026-10-12', observations: 'Phare cassé' }],
    dotationPool: [{ id: 'd1', immat: 'D45 663', date: '2026-10-03', conducteur: 'YAO', observations: 'Pneu usé' }],
    maintenance: [{ id: 'e1', immat: 'D45 724', dateEntree: '2026-10-01', motif: 'Freins', signalePar: 'KONAN', dateRetour: '2026-10-05', observationRetour: 'Bruit persiste' }],
    users: [agent({ nom: 'DOSSO', prenoms: 'YAYA', historique: [{ nature: 'Accrochage', circonstances: 'Parking', vehicule: 'D45 5081', date: '2026-09-01' }] })],
    etatsVehicules: []
  });
  synchroniserEtats(base, '2026-10-23');
  const s = parOrigine(base);
  assert.equal(s['mission:m1'].probleme, 'Phare cassé');
  assert.equal(s['mission:m1'].signalePar, 'KOUASSI');
  assert.equal(s['dotation:d1'].probleme, 'Pneu usé');
  assert.equal(s['dotation:d1'].dateSignalement, '2026-10-03');
  // Sorti du garage : le motif d'entree est regle a la date de sortie.
  assert.deepEqual([s['entretien:e1'].resolu, s['entretien:e1'].dateResolution], ['Oui', '2026-10-05']);
  assert.equal(s['retour:e1'].probleme, 'Bruit persiste');
  assert.equal(s['retour:e1'].resolu, 'Non');
  const incident = base.etatsVehicules.find((x) => x.origine.startsWith('incident:'));
  assert.equal(incident.probleme, 'Accrochage — Parking');
  assert.equal(incident.signalePar, 'DOSSO YAYA');
  assert.equal(s['vehicule:v1'].probleme, 'Rétroviseur fêlé');
  assert.equal(s['vehicule:v1'].dateSignalement, '2026-10-23');
  // Une seconde passe ne change rien.
  assert.equal(synchroniserEtats(base, '2026-10-23'), 0);
});

test('la source fait foi : texte modifié, RAS ou fiche supprimée', async () => {
  const base = await charger({
    dotationPool: [{ id: 'd1', immat: 'D45 663', date: '2026-10-03', conducteur: 'YAO', observations: 'Pneu usé' }, { id: 'd2', immat: 'D45 663', date: '2026-10-04', conducteur: 'YAO', observations: 'Vitre' }],
    etatsVehicules: []
  });
  synchroniserEtats(base);
  base.dotationPool[0].observations = 'Pneu avant gauche usé';
  synchroniserEtats(base);
  assert.equal(parOrigine(base)['dotation:d1'].probleme, 'Pneu avant gauche usé');
  base.dotationPool[0].observations = 'RAS';
  // d2 est resolu a la main, puis sa dotation supprimee : il reste.
  parOrigine(base)['dotation:d2'].resolu = 'Oui';
  base.dotationPool.splice(1, 1);
  synchroniserEtats(base);
  assert.deepEqual(base.etatsVehicules.map((x) => x.origine), ['dotation:d2']);
});

test('un ancien signalement de rapport de mission est repris, pas doublé', async () => {
  const base = await charger({
    missions: [{ id: 'm1', ref: 'M-001', vehicule: 'D45 5081', observations: 'Phare cassé' }],
    etatsVehicules: [{ id: 'ancien', missionId: 'm1', missionRef: 'M-001', immat: 'D45 5081', probleme: 'Phare cassé', resolu: 'Non' }]
  });
  synchroniserEtats(base);
  assert.equal(base.etatsVehicules.length, 1);
  assert.equal(base.etatsVehicules[0].id, 'ancien');
  assert.equal(base.etatsVehicules[0].origine, 'mission:m1');
});

test('chaque enregistrement accorde ÉTAT DES VÉHICULES', async () => {
  await charger({ etatsVehicules: [] });
  db.insert('dotationPool', { immat: 'D45 663', date: '2026-10-03', conducteur: 'YAO', observations: 'Essuie-glace' });
  assert.equal(db.DB.etatsVehicules.length, 1);
  assert.equal(db.DB.etatsVehicules[0].probleme, 'Essuie-glace');
});

test('retour du garage : les pannes d’avant l’entrée sont réglées, seule l’observation du retour reste', async () => {
  const base = await charger({
    vehicles: { pool: [vehicule({ id: 'v1', immatNouvelle: 'D45 5081', immatAncienne: '1234 AB 01' })], mission: [], service: [] },
    missions: [{ id: 'm1', ref: 'M-001', vehicule: '1234 AB 01', dateRetour: '2026-09-20', observations: 'Phare cassé' }],
    maintenance: [{ id: 'e1', immat: 'D45 5081', dateEntree: '2026-10-01', motif: 'Freins', dateRetour: '2026-10-05', observationRetour: '' }],
    etatsVehicules: [
      { id: 'main', immat: 'D45 5081', probleme: 'Klaxon', dateSignalement: '2026-09-25', resolu: 'Non' },
      { id: 'apres', immat: 'D45 5081', probleme: 'Rayure', dateSignalement: '2026-10-03', resolu: 'Non' }
    ]
  });
  synchroniserEtats(base);
  const s = parOrigine(base);
  const parId = Object.fromEntries(base.etatsVehicules.map((x) => [x.id, x]));
  // Sans observation au retour : rien d'avant l'entree ne reste en cours.
  assert.deepEqual([s['mission:m1'].resolu, s['mission:m1'].dateResolution, s['mission:m1'].resoluPar], ['Oui', '2026-10-05', 'garage:e1']);
  assert.equal(parId.main.resolu, 'Oui');
  assert.equal(s['entretien:e1'].resoluPar, 'garage:e1');
  // Signale pendant le sejour au garage : pas regle par cette sortie.
  assert.equal(parId.apres.resolu, 'Non');
  // Avec une observation au retour, elle seule est en cours.
  base.maintenance[0].observationRetour = 'Bruit persiste';
  synchroniserEtats(base);
  assert.equal(parOrigine(base)['retour:e1'].resolu, 'Non');
  // Sortie annulee : les pannes reglees par elle se rouvrent.
  base.maintenance[0].dateRetour = '';
  synchroniserEtats(base);
  assert.equal(parOrigine(base)['mission:m1'].resolu, 'Non');
  assert.equal(parId.main.resolu, 'Non');
  assert.equal(synchroniserEtats(base), 0);
});

test('GARAGES : un nom saisi rejoint la liste, un renommage suit partout', async () => {
  const base = await charger({
    maintenance: [
      { id: 'e1', immat: 'D45 724', garage: 'Garage Central', interventions: [{ garage: 'garage central' }] },
      { id: 'e2', immat: 'D45 5081', interventions: [{ garage: 'Garage Central' }, { garage: 'Auto Plus' }] }
    ],
    garages: []
  });
  assert.deepEqual(db.nomsGarages(base), ['Auto Plus', 'Garage Central']);
  assert.ok(db.assurerGarage('Garage Central', base));
  assert.equal(db.assurerGarage('GARAGE CENTRAL', base), null);
  assert.deepEqual(db.vehiculesDuGarage('Garage Central', base), ['D45 5081', 'D45 724']);
  assert.equal(db.renommerGarage('Garage Central', 'Garage Central Treichville', base), 3);
  assert.deepEqual(db.vehiculesDuGarage('garage central treichville', base), ['D45 5081', 'D45 724']);
});
