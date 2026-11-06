/* Jours ouvres : ni samedis, ni dimanches, ni jours feries de Cote d'Ivoire. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db, charger } from './aide.mjs';

const jo = await import('../resources/js/core/joursOuvres.js');

test('Pâques et les feries qui en dependent se calculent', () => {
  assert.equal(jo.paques(2026).toISOString().slice(0, 10), '2026-04-05');
  assert.equal(jo.paques(2027).toISOString().slice(0, 10), '2027-03-28');
  const f = jo.feriesCalcules(2026);
  ['2026-01-01', '2026-05-01', '2026-08-07', '2026-08-15', '2026-11-01', '2026-11-15', '2026-12-25',
    '2026-04-06', '2026-05-14', '2026-05-25'].forEach((d) => assert.ok(f.includes(d), d));
});

test('samedis, dimanches et feries ne comptent pas', () => {
  // Vendredi 6 → lundi 9 novembre 2026 : un seul jour, le vendredi.
  assert.equal(jo.joursOuvres('2026-11-06', '2026-11-09'), 1);
  // Semaine du 30 novembre : cinq jours ; celle du 21 decembre perd Noël.
  assert.equal(jo.joursOuvres('2026-11-30', '2026-12-07'), 5);
  assert.equal(jo.joursOuvres('2026-12-21', '2026-12-28'), 4);
  // Un jour saisi dans RÉGLAGES (fete musulmane) ne compte pas non plus.
  assert.equal(jo.joursOuvres('2026-11-30', '2026-12-07', ['2026-12-02']), 4);
  assert.equal(jo.joursOuvres('2026-11-30', ''), null);
});

test('les dates saisies a la main se lisent en JJ/MM/AAAA ou AAAA-MM-JJ', () => {
  assert.deepEqual(jo.lireJoursFeries('20/03/2026\n2026-05-27 ; 5/6/2026, faux'), ['2026-03-20', '2026-05-27', '2026-06-05']);
});

test('la duree d’une absence au tableau se compte en jours ouvres', async () => {
  await charger({ settings: { joursFeries: ['2026-12-02'] } });
  assert.equal(db.dureeIndisponibilite('2026-11-30', '2026-12-07'), 4);
  // Partir un samedi, reprendre le lundi : zero jour, sans erreur de dates.
  assert.equal(db.dureeIndisponibilite('2026-11-07', '2026-11-09'), 0);
});
