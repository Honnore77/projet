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

/* ------------------ Tour de role et indisponibilites ------------------ */

const POOL = [
  { id: 'a', nom: 'KONE', prenoms: 'Ali', statut: 'Actif', poolConducteur: 'Oui' },
  { id: 'b', nom: 'YAO', prenoms: 'Koffi', statut: 'Actif', poolConducteur: 'Oui' },
  { id: 'c', nom: 'DOSSO', prenoms: 'Yaya', statut: 'Actif', poolConducteur: 'Oui' }
];

test('un conducteur indisponible passe en fin de tour de role, le suivant devient prochain', async () => {
  await charger({
    users: POOL,
    // KONE n'est jamais parti : il serait prochain s'il etait la.
    missions: [{ id: 'm1', conducteur: 'YAO Koffi', dateDepart: '2026-09-01' }, { id: 'm2', conducteur: 'DOSSO Yaya', dateDepart: '2026-09-10' }],
    indisponibilites: [{ id: 'i', conducteur: 'KONE Ali', motif: 'En congé', dateDepart: '2026-10-10', dateReprise: '2026-10-20', interimaire: 'X' }]
  });
  const pendant = db.rotationConducteurs('2026-10-13');
  assert.deepEqual(pendant.map((r) => r.nom), ['YAO Koffi', 'DOSSO Yaya', 'KONE Ali']);
  assert.equal(pendant[2].indisponible.motif, 'En congé');
  // Des sa reprise, il retrouve sa place en tete.
  const apres = db.rotationConducteurs('2026-10-20');
  assert.equal(apres[0].nom, 'KONE Ali');
  assert.equal(apres[0].indisponible, null);
});

test('une indisponibilite qui recouvre la mission est reperee, jours de depart et de retour compris', async () => {
  await charger({ indisponibilites: [{ id: 'i', conducteur: 'KONE Ali', dateDepart: '2026-10-10', dateReprise: '2026-10-20' }] });
  assert.ok(db.indisponibiliteSurMission('kone ali', '2026-10-05', '2026-10-10'));
  assert.ok(db.indisponibiliteSurMission('KONE Ali', '2026-10-19', '2026-10-22'));
  // repris le 20 : une mission qui part le 20 ne recouvre rien
  assert.equal(db.indisponibiliteSurMission('KONE Ali', '2026-10-20', '2026-10-22'), null);
  assert.equal(db.indisponibiliteSurMission('KONE Ali', '2026-10-01', '2026-10-09'), null);
});

test('l’export des vehicules contient le n° de chassis', async () => {
  await charger({ vehicles: { pool: [{ id: 'v', immatNouvelle: 'D45 50 1', numeroChassis: 'JTMHV05J604123456' }], mission: [], service: [] } });
  const d = ds.dsVehicles();
  assert.ok(d.columns.some((c) => c.key === 'numeroChassis' && c.label === 'N° de châssis'));
  assert.equal(d.rows[0].numeroChassis, 'JTMHV05J604123456');
});

test('la fiche vehicule en PDF : carte d’identite et historiques, sans aucun montant', async () => {
  const fv = await import('../resources/js/export/ficheVehicule.js');
  await charger();
  const vehicle = { marque: 'TOYOTA', modele: 'HILUX', immatNouvelle: 'D45 50 1', numeroChassis: 'VIN123', energie: 'Diesel', consommation: 9.5, statut: 'Disponible' };
  const infos = fv.infosVehicule(vehicle, 'pool');
  assert.deepEqual(infos.slice(0, 1), [{ libelle: 'N° de châssis', valeur: 'VIN123' }]);
  assert.ok(infos.some((l) => l.libelle === 'Consommation' && l.valeur === '9,5 L/100 km'));
  const bytes = fv.buildFicheVehiculePdf({
    vehicle, cat: 'pool', immat: 'D45 50 1', photo: null,
    dots: [{ date: '2026-10-01', km: 1000, quantite: 40, montant: 36000, station: 'Total Plateau' }],
    missionsCarburant: [],
    missions: [{ ref: 'M-001', conducteur: 'KONE Ali', destination: 'Bouaké', dateDepart: '2026-10-02', dateRetour: '2026-10-03', jours: 2 }],
    maint: [{ dateEntree: '2026-10-05', motif: 'Vidange', interventions: [{ garage: 'Garage X', cout: 25000 }] }]
  });
  const txt = Buffer.from(bytes).toString('latin1');
  for (const m of ['Aucune photo', 'Dotations pool', 'Total Plateau', 'Missions', 'Historique entretien', 'Garage X']) {
    assert.ok(txt.includes(m), m);
  }
  // Ni le montant de la dotation ni le cout du garage ne paraissent. On ne
  // regarde que le texte ecrit sur la page — « (…) Tj » — et non les
  // numeros internes du fichier, qui peuvent contenir n'importe quels
  // chiffres.
  const ecrit = (txt.match(/\((?:[^()\\]|\\.)*\) Tj/g) || []).join(' ').replace(/[\s\xa0 ]/g, '');
  assert.ok(ecrit.includes('TotalPlateau'), 'le texte de la page est bien lu');
  assert.ok(!ecrit.includes('36000'), 'montant de la dotation affiche');
  assert.ok(!ecrit.includes('25000'), 'cout du garage affiche');
});
