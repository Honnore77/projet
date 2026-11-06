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

const fi = await import('../resources/js/core/feriesInternet.js');

/** Extrait du calendrier public Google de Cote d'Ivoire (format iCalendar). */
const ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20260320', 'DTEND;VALUE=DATE:20260321', 'DESCRIPTION:Jour férié', 'SUMMARY:Aid-El-Fitr', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20260218', 'DTEND;VALUE=DATE:20260219',
  "DESCRIPTION:Journée d'observance\nPour masquer les journées d'observance\, ", ' accédez à Paramètres', 'SUMMARY:Ramadan', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261116', 'DTEND;VALUE=DATE:20261117', 'DESCRIPTION:Jour férié', 'SUMMARY:Journee Nationale de la Paix observée', 'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

test('le calendrier du pays ne garde que les jours feries : ni observance, ni report du dimanche', () => {
  assert.deepEqual(fi.lireCalendrier(ICS), [
    { date: '2026-03-20', nom: 'Aid-El-Fitr' }
  ]);
});

test('les feries telecharges comptent dans les absences, avec ceux saisis a la main', async () => {
  await charger({ settings: {
    feriesInternet: { pays: 'ci', majLe: '2026-11-06T08:00:00Z', jours: fi.lireCalendrier(ICS) },
    joursFeries: ['2026-03-19']
  } });
  // Semaine du lundi 16 mars 2026 : le jeudi saisi a la main, le vendredi (Aïd el-Fitr) telecharge.
  assert.equal(db.dureeIndisponibilite('2026-03-16', '2026-03-23'), 3);
  // Le dimanche 15 novembre n'est pas reporte : du lundi 9 au retour le
  // lundi 23 novembre 2026, dix jours de conge.
  assert.equal(db.dureeIndisponibilite('2026-11-09', '2026-11-23'), 10);
});

test('une liste deja telechargee avec un jour « observé » ne le compte plus', async () => {
  await charger({ settings: { feriesInternet: { pays: 'ci', majLe: '2026-11-06T08:00:00Z', jours: [
    { date: '2026-11-16', nom: 'Journee Nationale de la Paix observée' }] } } });
  assert.equal(db.dureeIndisponibilite('2026-11-09', '2026-11-23'), 10);
  assert.deepEqual(fi.feriesTelecharges().jours, []);
});
