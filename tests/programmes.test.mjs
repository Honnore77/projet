/* PROGRAMMES : missions a venir, et ce qui est prevu au tableau de bord. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db, charger } from './aide.mjs';

const pr = await import('../resources/js/core/programmes.js');
const { COLLECTIONS_SYNCHRO } = await import('../resources/js/core/synchro.js');
const { dsProgrammes, dsAgendaProgrammes } = await import('../resources/js/export/datasets.js');

const JOUR = '2026-11-09';
const prog = (o = {}) => Object.assign({
  id: 'p1', ref: 'PM-001', dateDepart: '2026-11-16', dateRetour: '2026-11-19',
  destinations: ['BOUAKE'], objet: 'Supervision du chantier', conducteur: 'KONE ALI',
  vehicule: 'D45 5082', participants: ['YAO MARC'], missionId: ''
}, o);

test('une sauvegarde d’avant les programmes se charge, et ils se synchronisent', async () => {
  const base = await charger({});
  assert.deepEqual(base.programmes, []);
  assert.ok(COLLECTIONS_SYNCHRO.includes('programmes'));
});

test('a venir, en cours, puis hors du tableau quand passe ou realise', async () => {
  const base = await charger({
    missions: [{ id: 'm1', ref: 'M-010', conducteur: 'KONE ALI', dateDepart: '2026-11-02', dateRetour: '2026-11-04' }],
    programmes: [
      prog(),
      prog({ id: 'p2', ref: 'PM-002', dateDepart: '2026-11-08', dateRetour: '2026-11-10' }),
      prog({ id: 'p3', ref: 'PM-003', dateDepart: '2026-11-01', dateRetour: '2026-11-05' }),
      prog({ id: 'p4', ref: 'PM-004', dateDepart: '2026-11-20', dateRetour: '', missionId: 'm1' })
    ]
  });
  assert.equal(pr.etatProgramme(base.programmes[0], JOUR), 'à venir');
  assert.equal(pr.etatProgramme(base.programmes[1], JOUR), 'en cours');
  assert.equal(pr.etatProgramme(base.programmes[2], JOUR), 'passé');
  assert.equal(pr.etatProgramme(base.programmes[3], JOUR), 'réalisé');
  assert.deepEqual(pr.programmesActifs(JOUR).map((p) => p.ref), ['PM-002', 'PM-001']);
  assert.deepEqual(pr.programmesPasses(JOUR).map((p) => p.ref), ['PM-004', 'PM-003']);
  assert.equal(pr.prochaineRefProgramme(), 'PM-005');
});

test('un programme ne compte ni dans le tour de role ni dans les cumuls', async () => {
  await charger({ programmes: [prog()] });
  assert.equal(db.cumulsJoursConducteurs(db.DB.missions).size || 0, 0);
  assert.equal(db.DB.missions.length, 0);
});

test('conflits : absence, agent ou vehicule deja pris, vehicule au garage', async () => {
  await charger({
    indisponibilites: [{ id: 'i1', conducteur: 'YAO MARC', motif: 'En congé', dateDepart: '2026-11-18', dateReprise: '2026-11-25' }],
    missions: [{ id: 'm1', ref: 'M-011', conducteur: 'KONE ALI', vehicule: 'AA 1', dateDepart: '2026-11-19', dateRetour: '2026-11-20' }],
    maintenance: [{ id: 'g1', immat: 'D45 5082', garage: 'CFAO', dateEntree: '2026-11-15', dateRetour: '' }],
    programmes: [prog()]
  });
  const c = pr.conflitsProgramme(db.DB.programmes[0], db.DB, JOUR);
  assert.equal(c.length, 3, c.join('\n'));
  assert.match(c[0], /YAO MARC est indisponible \(En congé\)/);
  assert.match(c[1], /KONE ALI est déjà sur la mission M-[0-9]+/);
  assert.match(c[2], /D45 5082 est au garage \(CFAO\)/);
  // Le conge commence apres le retour : plus de conflit.
  assert.deepEqual(pr.conflitsProgramme(prog({ participants: [], conducteur: '', vehicule: '', dateRetour: '2026-11-17' }), db.DB, JOUR), []);
});

test('le tableau PROGRAMMES reunit missions programmees, conges et absences', async () => {
  await charger({
    indisponibilites: [
      { id: 'i1', conducteur: 'YAO MARC', motif: 'En congé', dateDepart: '2026-11-12', dateReprise: '2026-11-23' },
      { id: 'i2', conducteur: 'BAMBA', motif: 'Permissionnaire', dateDepart: '2026-11-05', dateReprise: '2026-11-11' },
      { id: 'i3', conducteur: 'OUATTARA', motif: 'En congé', dateDepart: '2026-10-01', dateReprise: '2026-10-15' }
    ],
    programmes: [prog()]
  });
  const l = pr.agendaProgrammes({ programmes: db.DB.programmes, indisponibilites: db.DB.indisponibilites }, JOUR);
  assert.deepEqual(l.map((x) => [x.type, x.agents, x.du, x.au, x.etat]), [
    ['Absence', 'BAMBA', '2026-11-05', '2026-11-10', 'en cours'],
    ['Congé', 'YAO MARC', '2026-11-12', '2026-11-22', 'à venir'],
    ['Mission', 'KONE ALI, YAO MARC', '2026-11-16', '2026-11-19', 'à venir']
  ]);
  // YAO MARC est en conge pendant la mission programmee.
  assert.equal(l[2].conflits.length, 1);
  assert.equal(dsAgendaProgrammes(l).rows.length, 3);
  assert.equal(dsProgrammes(db.DB.programmes).rows[0].destinations, 'BOUAKE');
});

test('les renommages suivent les programmes', async () => {
  const base = await charger({ programmes: [prog()] });
  db.renommerAgentDansLesFiches('YAO MARC', 'YAO Marc-Antoine', base);
  db.renommerImmatriculation('D45 5082', 'D45 5083', base);
  db.renommerDestinationMission('BOUAKE', 'BOUAKÉ', base);
  assert.deepEqual(base.programmes[0].participants, ['YAO Marc-Antoine']);
  assert.equal(base.programmes[0].vehicule, 'D45 5083');
  assert.deepEqual(base.programmes[0].destinations, ['BOUAKÉ']);
});
