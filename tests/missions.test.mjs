/* Missions : references dans l'ordre des departs, jours comptes, tour de role. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db, charger, agent } from './aide.mjs';

const mission = (o) => Object.assign({ conducteur: 'X', ravitaillements: [] }, o);

test('la reference suit la date de depart, la plus ancienne portant M-001', async () => {
  const base = await charger({
    missions: [
      mission({ id: 'a', ref: 'M-001', dateDepart: '2026-06-15' }),
      mission({ id: 'b', ref: 'M-002', dateDepart: '2026-03-10' }),
      mission({ id: 'c', ref: 'M-003', dateDepart: '2026-09-20' })
    ]
  });
  const par = Object.fromEntries(base.missions.map((m) => [m.id, m.ref]));
  assert.deepEqual(par, { a: 'M-002', b: 'M-001', c: 'M-003' });
});

test('une mission ajoutee pour un depart anterieur decale les suivantes', async () => {
  const base = await charger({
    missions: [
      mission({ id: 'a', dateDepart: '2026-06-15' }),
      mission({ id: 'b', dateDepart: '2026-09-20' })
    ]
  });
  base.missions.push(mission({ id: 'c', dateDepart: '2026-01-05' }));
  db.renumeroterMissions();
  const par = Object.fromEntries(base.missions.map((m) => [m.id, m.ref]));
  assert.deepEqual(par, { c: 'M-001', a: 'M-002', b: 'M-003' });
});

test('les missions sans date de depart passent en fin', async () => {
  const base = await charger({
    missions: [
      mission({ id: 'sansDate', dateDepart: '' }),
      mission({ id: 'avecDate', dateDepart: '2026-05-01' })
    ]
  });
  const par = Object.fromEntries(base.missions.map((m) => [m.id, m.ref]));
  assert.equal(par.avecDate, 'M-001');
  assert.equal(par.sansDate, 'M-002');
});

test('le nombre de jours inclut le jour de depart', () => {
  assert.equal(db.joursMission('2026-09-01', '2026-09-01'), 1, 'partir et revenir le meme jour fait un jour');
  assert.equal(db.joursMission('2026-09-01', '2026-09-03'), 3);
  assert.equal(db.joursMission('2026-09-01', ''), null);
});

test('le tour de role ne retient que les conducteurs du pool, actifs', async () => {
  await charger({
    users: [
      agent({ id: 'u1', nom: 'POOL', prenoms: 'ACTIF', poolConducteur: 'Oui', statut: 'Actif' }),
      agent({ id: 'u2', nom: 'HORS', prenoms: 'POOL', poolConducteur: 'Non', statut: 'Actif' }),
      agent({ id: 'u3', nom: 'POOL', prenoms: 'SUSPENDU', poolConducteur: 'Oui', statut: 'Suspendu' })
    ]
  });
  const noms = db.rotationConducteurs().map((x) => x.nom);
  assert.deepEqual(noms, ['POOL ACTIF']);
});

test('sans aucun conducteur du pool, le tour de role est vide plutot que peuple d’office', async () => {
  await charger({
    users: [agent({ id: 'u1', nom: 'A', poolConducteur: 'Non', statut: 'Actif' })]
  });
  assert.deepEqual(db.rotationConducteurs(), []);
});

test('passe en premier celui qui n’est jamais parti, puis la mission la plus ancienne', async () => {
  await charger({
    users: [
      agent({ id: 'u1', nom: 'ANCIEN', prenoms: '', poolConducteur: 'Oui' }),
      agent({ id: 'u2', nom: 'RECENT', prenoms: '', poolConducteur: 'Oui' }),
      agent({ id: 'u3', nom: 'JAMAIS', prenoms: '', poolConducteur: 'Oui' })
    ],
    missions: [
      mission({ id: 'm1', conducteur: 'ANCIEN', dateDepart: '2026-01-10' }),
      mission({ id: 'm2', conducteur: 'RECENT', dateDepart: '2026-08-10' })
    ]
  });
  assert.deepEqual(db.rotationConducteurs().map((x) => x.nom), ['JAMAIS', 'ANCIEN', 'RECENT']);
});

test('« conducteur du pool » note en booleen dans une vieille base est repris', async () => {
  const base = await charger({
    users: [agent({ id: 'u1', poolConducteur: true }), agent({ id: 'u2', poolConducteur: false })]
  });
  assert.equal(base.users[0].poolConducteur, 'Oui');
  assert.equal(base.users[1].poolConducteur, 'Non');
});
