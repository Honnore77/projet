/* Destinations des missions : liste de depart, distances, coordonnees. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db, charger } from './aide.mjs';

const {
  DESTINATIONS_REFERENCE, ABIDJAN, distanceVolOiseau, coordonneesDe, distanceEstimee,
  nomsDestinationsMission, destinationMissionParNom, assurerDestinationMission,
  renommerDestinationMission, distanceAbidjan, libelleDistance, lienItineraire
} = db;

test('une base sans destinations recoit les villes de reference', async () => {
  const base = await charger();
  assert.equal(base.destinationsMission.length, DESTINATIONS_REFERENCE.length);
  assert.deepEqual(distanceAbidjan('bouake'), { km: 350, estimee: false });
});

test('les destinations deja tapees dans les missions rejoignent la liste, sans doublon', async () => {
  const base = await charger({
    missions: [
      { id: 'a', destination: 'Bouaké' },
      { id: 'b', destination: 'Site de Kossou' },
      { id: 'c', destination: 'site de kossou' }
    ]
  });
  assert.equal(base.destinationsMission.length, DESTINATIONS_REFERENCE.length + 1);
  assert.ok(nomsDestinationsMission().includes('Site de Kossou'));
  // Une destination inconnue n'a pas de distance inventee.
  assert.equal(distanceAbidjan('Site de Kossou'), null);
  assert.equal(libelleDistance('Site de Kossou'), '');
});

test('une liste deja initialisee n’est pas reremplie : une ville retiree ne revient pas', async () => {
  const base = await charger({ destinationsMission: [{ id: 'x', nom: 'Korhogo', distanceKm: 635 }] });
  assert.equal(base.destinationsMission.length, 1);
});

test('la distance a vol d’oiseau Abidjan-Bouake est d’environ 287 km', () => {
  const km = distanceVolOiseau(ABIDJAN, { lat: 7.6939, lng: -5.0303 });
  assert.ok(km > 282 && km < 292, `obtenu ${km}`);
});

test('l’estimation routiere majore la ligne droite et s’arrondit a 5 km', () => {
  const km = distanceEstimee({ lat: 7.6939, lng: -5.0303 });
  assert.equal(km % 5, 0);
  // 287 km en ligne droite, 350 km par la route : l'estimation doit en
  // approcher a une vingtaine de kilometres.
  assert.ok(km >= 330 && km <= 370, `obtenu ${km}`);
});

test('les coordonnees se lisent sous les formes copiees depuis Google Maps', () => {
  assert.deepEqual(coordonneesDe('7.6939, -5.0303'), { lat: 7.6939, lng: -5.0303 });
  assert.deepEqual(coordonneesDe('https://www.google.com/maps/place/Bouak%C3%A9/@7.6939,-5.0303,13z'), { lat: 7.6939, lng: -5.0303 });
  assert.deepEqual(coordonneesDe('https://www.google.com/maps/place/X/data=!3d7.69!4d-5.03'), { lat: 7.69, lng: -5.03 });
  assert.deepEqual(coordonneesDe('https://maps.google.com/?q=7.69,-5.03'), { lat: 7.69, lng: -5.03 });
  assert.deepEqual(coordonneesDe('7,69 ; -5,03'), { lat: 7.69, lng: -5.03 });
  assert.equal(coordonneesDe('https://maps.app.goo.gl/abc'), null);
  assert.equal(coordonneesDe('Quartier Commerce, Bouaké'), null);
});

test('une estimation se signale dans le libelle', async () => {
  await charger({ destinationsMission: [{ id: 'x', nom: 'Village', distanceKm: 455, estimee: true }] });
  assert.equal(libelleDistance('village').replace(/\s/g, ' '), '≈ 455 km');
});

test('renommer une destination met a jour ses missions', async () => {
  const base = await charger({
    destinationsMission: [{ id: 'x', nom: 'Bouake' }],
    missions: [{ id: 'a', destination: 'Bouake' }, { id: 'b', destination: 'Man' }]
  });
  assert.equal(renommerDestinationMission('bouake', 'Bouaké'), 1);
  assert.deepEqual(base.missions.map((m) => m.destination), ['Bouaké', 'Man']);
});

test('une nouvelle destination tapee dans une mission entre dans la liste une fois', async () => {
  await charger({ destinationsMission: [] });
  assert.ok(assurerDestinationMission('  Tiébissou '));
  assert.equal(assurerDestinationMission('tiebissou'), null);
  assert.equal(destinationMissionParNom('TIEBISSOU').nom, 'Tiébissou');
});

test('l’itineraire part d’Abidjan et vise les coordonnees quand on les a', () => {
  const url = lienItineraire({ nom: 'Bouaké', localisation: '', lat: 7.6939, lng: -5.0303 });
  assert.ok(url.startsWith('https://www.google.com/maps/dir/?'));
  const p = new URL(url).searchParams;
  assert.equal(p.get('destination'), '7.6939,-5.0303');
  assert.ok(p.get('origin').startsWith('Abidjan'));
});
