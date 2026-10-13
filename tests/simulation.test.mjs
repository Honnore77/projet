/* SIMULATION : estimation des frais d'une mission. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db, charger } from './aide.mjs';

const { calculerSimulation, FRAIS_OM_PAR_PARTICIPANT, peagesConnus, derniereConsommation, parcoursDe } = db;

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
    peages: [{ prix: 1500 }, { prix: 1500 }]
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

test('un peage deja saisi est propose avec son dernier prix', async () => {
  await charger({
    simulations: [
      { id: 'a', createdAt: '2026-01-01', peages: [{ libelle: 'Attinguié', prix: 1000 }] },
      { id: 'b', createdAt: '2026-02-01', peages: [{ libelle: 'attinguié', prix: 1500 }, { libelle: 'Singrobo', prix: 2000 }] }
    ]
  });
  assert.deepEqual(peagesConnus().map((p) => [p.libelle, p.prix]), [['attinguié', 1500], ['Singrobo', 2000]]);
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
