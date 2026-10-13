/* Indisponibilites au pool, et colonne « vehicules attribues » de l'export. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db, charger } from './aide.mjs';

const ds = await import('../resources/js/export/datasets.js');

const {
  MOTIFS_INDISPONIBILITE, dureeIndisponibilite, etatIndisponibilite, conducteursDuPool,
  chevauchementIndisponibilite, indisponibilitesEnCours, renommerAgentDansIndisponibilites
} = db;

test('les trois motifs sont ceux demandes', () => {
  assert.deepEqual(MOTIFS_INDISPONIBILITE, ['En congé', 'Permissionnaire', 'Repos maladie']);
});

test('la duree compte du depart a la veille de la reprise', () => {
  assert.equal(dureeIndisponibilite('2026-10-05', '2026-10-08'), 3);
  assert.equal(dureeIndisponibilite('2026-10-05', ''), null);
});

test('etat : a venir, en cours jusqu’a la veille de la reprise, puis terminee', () => {
  const i = { dateDepart: '2026-10-05', dateReprise: '2026-10-08' };
  assert.equal(etatIndisponibilite(i, '2026-10-04'), 'à venir');
  assert.equal(etatIndisponibilite(i, '2026-10-05'), 'en cours');
  assert.equal(etatIndisponibilite(i, '2026-10-07'), 'en cours');
  assert.equal(etatIndisponibilite(i, '2026-10-08'), 'terminée');
});

test('seuls les conducteurs du pool sont proposes', async () => {
  await charger({
    users: [
      { id: 'a', nom: 'KONE', prenoms: 'Ali', poolConducteur: 'Oui' },
      { id: 'b', nom: 'YAO', prenoms: 'Koffi', poolConducteur: 'Non' },
      { id: 'c', nom: 'DIABATE', prenoms: 'Moussa', poolConducteur: 'Oui' }
    ]
  });
  assert.deepEqual(conducteursDuPool(), ['DIABATE Moussa', 'KONE Ali']);
});

test('deux periodes du meme conducteur ne se recouvrent pas ; reprendre le jour d’un depart est permis', async () => {
  await charger({ indisponibilites: [{ id: 'x', conducteur: 'KONE Ali', dateDepart: '2026-10-05', dateReprise: '2026-10-08' }] });
  assert.ok(chevauchementIndisponibilite('kone ali', '2026-10-07', '2026-10-10'));
  assert.equal(chevauchementIndisponibilite('KONE Ali', '2026-10-08', '2026-10-10'), null);
  assert.equal(chevauchementIndisponibilite('KONE Ali', '2026-10-01', '2026-10-05'), null);
  assert.equal(chevauchementIndisponibilite('AUTRE', '2026-10-06', '2026-10-07'), null);
  // la periode modifiee ne se recouvre pas elle-meme
  assert.equal(chevauchementIndisponibilite('KONE Ali', '2026-10-05', '2026-10-09', 'x'), null);
});

test('les indisponibilites en cours a une date donnee', async () => {
  await charger({
    indisponibilites: [
      { id: 'a', conducteur: 'A', dateDepart: '2026-10-01', dateReprise: '2026-10-20' },
      { id: 'b', conducteur: 'B', dateDepart: '2026-10-15', dateReprise: '2026-10-18' }
    ]
  });
  assert.deepEqual(indisponibilitesEnCours('2026-10-13').map((i) => i.id), ['a']);
});

test('renommer un agent suit sur ses indisponibilites et ses interims', async () => {
  const base = await charger({
    indisponibilites: [{ id: 'a', conducteur: 'KONE Ali', interimaire: 'YAO Koffi' }, { id: 'b', conducteur: 'X', interimaire: 'KONE Ali' }]
  });
  assert.equal(renommerAgentDansIndisponibilites('KONE Ali', 'KONE Aly'), 2);
  assert.equal(base.indisponibilites[0].conducteur, 'KONE Aly');
  assert.equal(base.indisponibilites[1].interimaire, 'KONE Aly');
});

test('le justificatif d’une indisponibilite est une image citee', async () => {
  await charger({ indisponibilites: [{ id: 'a', conducteur: 'A', images: [{ id: 'img-conge' }] }] });
  assert.ok(db.imagesCitees().has('img-conge'));
});

test('l’export des utilisateurs contient les vehicules attribues', async () => {
  const base = await charger({
    users: [{ id: 'a', nom: 'KONE', prenoms: 'Ali' }],
    vehicles: {
      pool: [{ id: 'v', immatNouvelle: 'D45 50 1234', utilisateur: 'KONE Ali' }],
      mission: [],
      service: [{ id: 'w', immatAncienne: '9876 AB 01', utilisateur: 'kone ali' }]
    }
  });
  const d = ds.dsUsers(base.users);
  assert.ok(d.columns.some((c) => c.key === 'vehicules' && /Véhicule\(s\) attribué\(s\)/.test(c.label)));
  assert.equal(d.rows[0].vehicules, 'D45 50 1234 (pool), 9876 AB 01 (service)');
});
