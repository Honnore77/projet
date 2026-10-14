/* Demandes de conge et d'absence : durees, total, inscription au tableau. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db, charger } from './aide.mjs';

const {
  lendemain, dureeConge, totalAbsence, periodeAuTableau, lignes, etatValidation,
  validationAbsence, decisionPourDemande
} = await import('../resources/js/core/demandes.js');

test('le repos maladie n’est pas soumis à validation', () => {
  assert.equal(validationAbsence({ motif: 'Repos maladie', validee: 'Oui' }), 'non soumis');
  assert.equal(validationAbsence({ motif: 'En congé', validee: 'Oui' }), 'oui');
  assert.equal(validationAbsence({ motif: 'Permissionnaire', validee: 'Non' }), 'non');
  assert.equal(validationAbsence({ motif: 'En congé' }), 'en cours');
});

test('une absence issue d’une demande prend la décision de la demande', () => {
  const demandes = [
    { id: 'd1', type: 'conge', indispoId: 'i1', validee: 'Oui' },
    { id: 'd2', type: 'absence', autorisee: 'NON' }
  ];
  assert.equal(validationAbsence({ id: 'i1', motif: 'En congé', validee: 'Non' }, demandes), 'oui');
  assert.equal(validationAbsence({ id: 'i2', demandeId: 'd2', motif: 'Permissionnaire' }, demandes), 'non');
  assert.deepEqual(decisionPourDemande({ type: 'conge' }, 'Non'), { validee: 'Non' });
  assert.deepEqual(decisionPourDemande({ type: 'absence' }, 'Oui'), { autorisee: 'OUI' });
  assert.deepEqual(decisionPourDemande({ type: 'absence' }, ''), { autorisee: '' });
});

test('la validation : oui, non, ou en cours tant que rien n’est décidé', () => {
  assert.equal(etatValidation({ type: 'conge', validee: 'Oui' }), 'oui');
  assert.equal(etatValidation({ type: 'conge', validee: 'Non' }), 'non');
  assert.equal(etatValidation({ type: 'conge' }), 'en cours');
  assert.equal(etatValidation({ type: 'absence', autorisee: 'OUI' }), 'oui');
  assert.equal(etatValidation({ type: 'absence', autorisee: 'NON' }), 'non');
  assert.equal(etatValidation({ type: 'absence', autorisee: '' }), 'en cours');
  // Le champ de l'autre formulaire ne compte pas.
  assert.equal(etatValidation({ type: 'conge', autorisee: 'OUI' }), 'en cours');
});

test('le lendemain change de mois et d’année', () => {
  assert.equal(lendemain('2026-11-21'), '2026-11-22');
  assert.equal(lendemain('2026-11-30'), '2026-12-01');
  assert.equal(lendemain('2026-12-31'), '2027-01-01');
  assert.equal(lendemain(''), '');
});

test('la durée du congé compte le premier et le dernier jour', () => {
  assert.equal(dureeConge('2026-11-02', '2026-11-21'), '20 jours');
  assert.equal(dureeConge('2026-11-02', '2026-11-02'), '1 jour');
  assert.equal(dureeConge('2026-11-05', '2026-11-02'), '');
  assert.equal(dureeConge('2026-11-05', ''), '');
});

test('une absence du jour se compte en heures, sur plusieurs jours en jours', () => {
  assert.equal(totalAbsence('2026-10-20', '08:00', '2026-10-20', '12:30'), '4 h 30');
  assert.equal(totalAbsence('2026-10-20', '08:00', '', '10:00'), '2 h');
  assert.equal(totalAbsence('2026-10-20', '12:00', '2026-10-20', '08:00'), '');
  assert.equal(totalAbsence('2026-10-20', '', '2026-10-23', ''), '3 jours');
  assert.equal(totalAbsence('2026-10-20', '', '2026-10-21', ''), '1 jour');
  assert.equal(totalAbsence('2026-10-23', '', '2026-10-20', ''), '');
});

test('au tableau, la reprise est le jour du retour au poste', () => {
  assert.deepEqual(periodeAuTableau({ type: 'conge', dateDebut: '2026-11-02', dateFin: '2026-11-21', dateReprise: '2026-11-23' }),
    { dateDepart: '2026-11-02', dateReprise: '2026-11-23' });
  assert.deepEqual(periodeAuTableau({ type: 'conge', dateDebut: '2026-11-02', dateFin: '2026-11-21' }),
    { dateDepart: '2026-11-02', dateReprise: '2026-11-22' });
  // Quelques heures d'absence : la journée compte.
  assert.deepEqual(periodeAuTableau({ type: 'absence', dateDebut: '2026-10-20', dateRetour: '2026-10-20' }),
    { dateDepart: '2026-10-20', dateReprise: '2026-10-21' });
  assert.deepEqual(periodeAuTableau({ type: 'absence', dateDebut: '2026-10-20', dateRetour: '2026-10-23' }),
    { dateDepart: '2026-10-20', dateReprise: '2026-10-23' });
  assert.equal(periodeAuTableau({ type: 'absence' }), null);
});

test('les lignes d’activités perdent puces et lignes vides, dans la limite', () => {
  assert.deepEqual(lignes('- Courses\n\n• Missions\n  Vidange  \nA\nB\nC\nD', 4), ['Courses', 'Missions', 'Vidange', 'A']);
  assert.deepEqual(lignes('', 6), []);
});

test('les demandes suivent le nouveau nom d’un agent, et la base les garde', async () => {
  await charger({
    users: [{ id: 'u1', nom: 'DOSSO', prenoms: 'YAYA' }],
    demandes: [{ id: 'd1', type: 'conge', agent: 'DOSSO YAYA', interimaire: 'KONE Ali' }]
  });
  db.renommerAgentDansIndisponibilites('DOSSO YAYA', 'DOSSO Yaya Ibrahim');
  db.renommerAgentDansIndisponibilites('KONE Ali', 'KONE Ali Junior');
  assert.equal(db.DB.demandes[0].agent, 'DOSSO Yaya Ibrahim');
  assert.equal(db.DB.demandes[0].interimaire, 'KONE Ali Junior');
  assert.deepEqual(db.normalize({}).demandes, []);
});

test('les images d’une demande sont gardées par le ménage et la sauvegarde', async () => {
  await charger({
    demandes: [{ id: 'd1', type: 'absence', agent: 'DOSSO YAYA', images: [{ id: 'img-demande', nom: 'certificat.jpg' }] }]
  });
  assert.ok(db.imagesCitees().has('img-demande'));
});
