/* SIMULATION : estimation des frais d'une mission. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db, charger } from './aide.mjs';

const { calculerSimulation, FRAIS_OM_PAR_PARTICIPANT, derniereConsommation, parcoursDe } = db;

test('les frais OM valent 1 000 F par participant', () => {
  assert.equal(FRAIS_OM_PAR_PARTICIPANT, 1000);
  assert.equal(calculerSimulation({ participants: 4 }).fraisOm, 4000);
});

test('estimation = frais OM + peages + (parcours + interne) x consommation / 100 x prix', () => {
  const r = calculerSimulation({
    parcoursKm: 1735,
    interne: [{ km: 20 }, { km: 15 }, { km: 30 }, { km: 0 }],
    consommation: 10,
    prixL: 875,
    participants: 4,
    fraisPeage: 3000
  });
  assert.equal(r.interneKm, 65);
  assert.equal(r.distanceTotale, 1800);
  assert.equal(r.litres, 180);
  assert.equal(r.montantCarburant, 157500);
  assert.equal(r.fraisOm, 4000);
  assert.equal(r.fraisPeage, 3000);
  assert.equal(r.estimation, 4000 + 3000 + 157500);
});

test('le carburant s’arrondit au franc superieur, sur les litres exacts', () => {
  // 333 km a 7,5 L/100 = 24,975 L ; x 815 F = 20 354,6 F -> 20 355 F.
  const r = calculerSimulation({ parcoursKm: 333, consommation: 7.5, prixL: 815 });
  assert.equal(r.litres, 25);
  assert.equal(r.montantCarburant, 20355);
});

test('des champs vides comptent pour zero, sans erreur', () => {
  const r = calculerSimulation({});
  assert.equal(r.estimation, 0);
  assert.equal(r.distanceTotale, 0);
});

test('la simulation compte le meme parcours aller-retour qu’une mission', async () => {
  await charger();
  const p = parcoursDe(['Yamoussoukro', 'Bouaké']);
  // 240 + 110 + retour Bouake -> Abidjan 350
  assert.equal(p.total, 700);
});

test('les frais de peage se saisissent tels quels', () => {
  assert.equal(calculerSimulation({ fraisPeage: 2500 }).fraisPeage, 2500);
  assert.equal(calculerSimulation({ fraisPeage: '' }).fraisPeage, 0);
  assert.equal(calculerSimulation({ fraisPeage: 2500, participants: 2 }).estimation, 2500 + 2000);
});

test('la consommation reprise est celle de la derniere simulation du vehicule', async () => {
  await charger({
    simulations: [
      { id: 'a', createdAt: '2026-01-01', vehicule: 'D45 50 1234', consommation: 9 },
      { id: 'b', createdAt: '2026-03-01', vehicule: 'D45 50 1234', consommation: 11 },
      { id: 'c', createdAt: '2026-04-01', vehicule: 'AUTRE', consommation: 7 }
    ]
  });
  assert.equal(derniereConsommation('d45 50 1234'), 11);
  assert.equal(derniereConsommation('INCONNU'), '');
});

test('les frais OM suivent le montant fixe dans RÉGLAGES', async () => {
  const base = await charger();
  assert.equal(db.fraisOmParParticipant(), 1000);
  base.settings.fraisOmParParticipant = 2500;
  const r = calculerSimulation({ participants: 3 });
  assert.equal(r.fraisOmUnitaire, 2500);
  assert.equal(r.fraisOm, 7500);
});

test('un montant de frais OM vide revient a 1 000 F, zero reste possible', async () => {
  const base = await charger();
  base.settings.fraisOmParParticipant = '';
  assert.equal(db.fraisOmParParticipant(), 1000);
  base.settings.fraisOmParParticipant = 0;
  assert.equal(calculerSimulation({ participants: 3 }).fraisOm, 0);
});

test('le parcours en interne propose = jours sur place x km par jour de RÉGLAGES', async () => {
  const base = await charger();
  // Non regle : rien n'est propose (zero se lirait « aucun deplacement »).
  assert.equal(db.interneEstime(3), '');
  base.settings.parcoursInterneKmParJour = 40;
  assert.equal(db.kmInterneParJour(), 40);
  assert.equal(db.interneEstime(3), 120);
  assert.equal(db.interneEstime(1.5), 60);
  assert.equal(db.interneEstime(''), '');
});

test('la liste des vehicules vient de la rubrique VÉHICULES, sans doublon ni prefixe seul', async () => {
  await charger({
    vehicles: {
      pool: [{ id: 'a', immatNouvelle: 'D45 50 7777', marque: 'TOYOTA', modele: 'HILUX', energie: 'Diesel' }],
      mission: [{ id: 'b', immatNouvelle: 'D45 50 ', marque: 'NISSAN', modele: 'TERRA' }],
      service: [
        { id: 'c', immatNouvelle: 'd45 50 7777', marque: 'X' },
        { id: 'd', immatAncienne: '1234 AB 01', marque: 'FORD', modele: 'RANGER', energie: 'Essence' }
      ]
    },
    // une immatriculation vue seulement dans une dotation n'est pas un vehicule du parc
    dotationPool: [{ id: 'x', immat: 'HORS PARC 1' }]
  });
  assert.deepEqual(db.vehiculesDuParc(), [
    { immat: '1234 AB 01', marqueModele: 'FORD RANGER', energie: 'Essence' },
    { immat: 'D45 50 7777', marqueModele: 'TOYOTA HILUX', energie: 'Diesel' }
  ]);
});

test('la fiche d’une simulation : calcul, parcours avec retour, parcours en interne', async () => {
  const ds = await import('../resources/js/export/datasets.js');
  await charger();
  const [resume, parcours, interne] = ds.dsFicheSimulation({
    dateDepart: '2026-10-12', dateRetour: '2026-10-14', jours: 3,
    destinations: ['Yamoussoukro', 'Bouaké'],
    parcoursKm: 700, interneKm: 50, distanceTotale: 750, parcoursComplet: true,
    interne: [{ nom: 'Yamoussoukro', jours: 1, km: 20 }, { nom: 'Bouaké', jours: 1, km: 30 }],
    vehicule: 'D45 50 1', consommation: 10, prixL: 875, litres: 75, montantCarburant: 65625,
    participants: 2, fraisOm: 2000, fraisOmUnitaire: 1000, fraisPeage: 1500, estimation: 69125
  });
  assert.equal(resume.rows[resume.rows.length - 1].valeur.replace(/\s/g, ' '), '69 125 F');
  // Simulation d'avant l'enregistrement des etapes : elles sont recalculees.
  assert.deepEqual(parcours.rows.map((r) => [r.etape, r.km]), [
    ['Abidjan - Yamoussoukro', 240], ['Yamoussoukro - Bouaké', 110], ['Retour : Bouaké - Abidjan', 350]
  ]);
  assert.deepEqual(interne.rows.map((r) => r.km), [20, 30]);
});
