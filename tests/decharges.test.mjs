/* DÉCHARGE : references, destinataires tenus a jour, lien vers la carte. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db, charger } from './aide.mjs';

const {
  prochaineRefDecharge, refDechargeEnDouble, nomsDestinataires, destinataireParNom,
  assurerDestinataire, renommerDestinataire, dechargesDuDestinataire, lienCarte
} = db;

test('une sauvegarde d’avant la rubrique se charge avec deux listes vides', async () => {
  const base = await charger();
  assert.deepEqual(base.decharges, []);
  assert.deepEqual(base.destinataires, []);
});

test('la premiere reference est D-001', async () => {
  await charger();
  assert.equal(prochaineRefDecharge(), 'D-001');
});

test('la reference suit le plus grand numero, pas le nombre de decharges', async () => {
  // D-002 a ete supprimee : compter les lignes redonnerait D-003, deja prise.
  await charger({ decharges: [{ id: 'a', ref: 'D-001' }, { id: 'b', ref: 'D-003' }] });
  assert.equal(prochaineRefDecharge(), 'D-004');
});

test('une reference saisie dans un autre format ne bloque pas la suite', async () => {
  await charger({ decharges: [{ id: 'a', ref: 'COURRIER 12' }, { id: 'b', ref: 'd-007' }] });
  assert.equal(prochaineRefDecharge(), 'D-008');
});

test('une reference en double est reperee, sauf sur la decharge elle-meme', async () => {
  await charger({ decharges: [{ id: 'a', ref: 'D-001' }] });
  assert.equal(refDechargeEnDouble('d-001'), true);
  assert.equal(refDechargeEnDouble('D-001', 'a'), false);
  assert.equal(refDechargeEnDouble('D-002'), false);
});

test('un destinataire tape dans une decharge rejoint la liste, une seule fois', async () => {
  const base = await charger({ destinataires: [{ id: 'x', nom: 'Mairie de Cocody' }] });
  assert.equal(assurerDestinataire('mairie de cocody'), null);
  const cree = assurerDestinataire('  Ministère du Budget ');
  assert.equal(cree.nom, 'Ministère du Budget');
  assert.equal(base.destinataires.length, 2);
  assert.deepEqual(nomsDestinataires(), ['Mairie de Cocody', 'Ministère du Budget']);
});

test('la recherche par nom ignore la casse et les accents', async () => {
  await charger({ destinataires: [{ id: 'x', nom: 'Ministère du Budget' }] });
  assert.equal(destinataireParNom('MINISTERE DU BUDGET').id, 'x');
  assert.equal(destinataireParNom(''), null);
});

test('renommer une structure met a jour ses decharges, et elles seules', async () => {
  const base = await charger({
    decharges: [
      { id: 'a', ref: 'D-001', destinataire: 'Mairie de Cocody' },
      { id: 'b', ref: 'D-002', destinataire: 'mairie de cocody' },
      { id: 'c', ref: 'D-003', destinataire: 'Trésor' }
    ]
  });
  assert.equal(renommerDestinataire('Mairie de Cocody', 'Mairie de Cocody (Cabinet)'), 2);
  assert.deepEqual(base.decharges.map((d) => d.destinataire), [
    'Mairie de Cocody (Cabinet)', 'Mairie de Cocody (Cabinet)', 'Trésor'
  ]);
  assert.equal(dechargesDuDestinataire('mairie de cocody (cabinet)').length, 2);
});

test('corriger un accent dans le nom d’une structure se reporte sur ses decharges', async () => {
  const base = await charger({ decharges: [{ id: 'a', destinataire: 'Tresor public' }] });
  assert.equal(renommerDestinataire('Tresor public', 'Trésor public'), 1);
  assert.equal(base.decharges[0].destinataire, 'Trésor public');
});

test('un lien colle depuis Google Maps est garde tel quel', () => {
  assert.equal(lienCarte(' https://maps.app.goo.gl/abc123 '), 'https://maps.app.goo.gl/abc123');
});

test('une adresse devient une recherche Google Maps', () => {
  assert.equal(
    lienCarte('Plateau, Abidjan'),
    'https://www.google.com/maps/search/?api=1&query=Plateau%2C%20Abidjan'
  );
  assert.equal(lienCarte(''), '');
});
