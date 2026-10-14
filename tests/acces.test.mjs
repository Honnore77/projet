/* Niveaux d'acces : roles, reglages de l'administrateur, fiches propres. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db, charger } from './aide.mjs';

const acces = await import('../resources/js/core/acces.js');
const {
  reglesDuRole, definirCompte, definirRubrique, voit, voitTout, peutSaisir, peutSupprimer,
  peutValider, peutValiderPour, filtrer, peutModifier, roleActuel
} = acces;

const donnees = () => ({
  users: [
    { id: 'u1', nom: 'DOSSO', prenoms: 'YAYA', poolConducteur: 'Oui' },
    { id: 'u2', nom: 'KONE', prenoms: 'ALI', poolConducteur: 'Oui' }
  ],
  vehicles: { pool: [], mission: [], service: [{ id: 'v1', immatNouvelle: '1234 AB 01', utilisateur: 'DOSSO YAYA' }] },
  missions: [
    { id: 'm1', conducteur: 'DOSSO YAYA', dateDepart: '2026-10-01' },
    { id: 'm2', conducteur: 'KONE ALI', dateDepart: '2026-10-02' }
  ],
  dotationPool: [{ id: 'd1', immat: '1234 AB 01' }, { id: 'd2', immat: '9999 ZZ 01' }],
  demandes: [{ id: 'q1', type: 'conge', agent: 'DOSSO YAYA' }, { id: 'q2', type: 'conge', agent: 'KONE ALI' }]
});

test('les anciens rôles prennent leur équivalent', async () => {
  assert.equal(roleActuel('gestionnaire'), 'chef');
  assert.equal(roleActuel('visiteur'), 'direction');
  assert.equal(roleActuel('inconnu'), 'direction');
  await charger({ accounts: [{ id: 'a1', login: 'g', role: 'gestionnaire' }, { id: 'a2', login: 'v', role: 'visiteur' }] });
  assert.deepEqual(db.DB.accounts.map((a) => a.role), ['chef', 'direction']);
});

test('niveaux par défaut de la proposition retenue', async () => {
  await charger(donnees());
  definirCompte({ role: 'saisie' });
  definirRubrique('MISSION');
  assert.ok(peutSaisir());
  assert.ok(!peutSupprimer(), 'l’agent de saisie ne supprime pas');
  assert.ok(!peutValider());

  definirCompte({ role: 'chef' });
  assert.ok(peutSupprimer('MISSION'));
  assert.ok(peutValider());

  definirCompte({ role: 'direction' });
  assert.ok(voitTout('ENTRETIEN'));
  assert.ok(!peutSaisir('ENTRETIEN'));

  definirCompte({ role: 'conducteur', agent: 'DOSSO YAYA' });
  assert.ok(!voit('ENTRETIEN'));
  assert.ok(!voit('TABLEAU DE BORD'));
  assert.ok(voit('MISSION') && !voitTout('MISSION'));
  assert.ok(!voit('REGLAGES'));
});

test('le conducteur ne voit que ses fiches et ne modifie que les siennes', async () => {
  await charger(donnees());
  definirCompte({ role: 'conducteur', agent: 'DOSSO YAYA' });
  assert.deepEqual(filtrer('MISSION', db.DB.missions).map((m) => m.id), ['m1']);
  assert.deepEqual(filtrer('DOTATION', db.DB.dotationPool).map((d) => d.id), ['d1'], 'les dotations de son véhicule');
  assert.deepEqual(filtrer('UTILISATEURS', db.DB.users).map((u) => u.id), ['u1']);
  assert.deepEqual(filtrer('VEHICULES', db.DB.vehicles.service).map((v) => v.id), ['v1']);
  assert.deepEqual(filtrer('CONGES', db.DB.demandes).map((d) => d.id), ['q1']);
  assert.deepEqual(filtrer('ENTRETIEN', [{ id: 'e1' }]), []);
  assert.ok(peutModifier('MISSION', db.DB.missions[0]), 'il remplit le rapport de sa mission');
  assert.ok(!peutModifier('MISSION', db.DB.missions[1]));
  assert.ok(!peutModifier('VEHICULES', db.DB.vehicles.service[0]), 'son véhicule, en consultation seulement');
});

test('l’administrateur règle les niveaux d’un rôle ; l’administrateur garde tout', async () => {
  await charger(Object.assign(donnees(), {
    settings: { acces: { conducteur: { niveaux: { ENTRETIEN: 'lecture', MISSION: 'n importe quoi' }, valider: true } } }
  }));
  const r = reglesDuRole('conducteur');
  assert.equal(r.niveaux.ENTRETIEN, 'lecture');
  assert.equal(r.niveaux.MISSION, 'siennes', 'un niveau inconnu reprend la valeur par défaut');
  assert.equal(r.valider, true);
  const admin = reglesDuRole('admin');
  assert.ok(Object.values(admin.niveaux).every((n) => ['complet', 'lecture'].includes(n)));
  assert.equal(admin.valider, true);
});

test('personne ne valide sa propre demande', async () => {
  await charger(donnees());
  definirCompte({ role: 'chef', agent: 'KONE ALI' });
  assert.ok(peutValiderPour('DOSSO YAYA'));
  assert.ok(!peutValiderPour('KONE ALI'));
  definirCompte({ role: 'saisie', agent: 'KONE ALI' });
  assert.ok(!peutValiderPour('DOSSO YAYA'), 'sans le droit de valider');
  definirCompte(null);
  assert.ok(!voit('MISSION'), 'sans compte, rien');
});
