/* ENTRETIEN → VIDANGES : prochaine vidange du véhicule, kilométrage, ÉTAT DES VÉHICULES. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { charger, vehicule, db } from './aide.mjs';

const { synchroniserEtats } = await import('../resources/js/core/etatsVehicules.js');

const base = () => charger({
  vehicles: { pool: [vehicule({ id: 'v1', immatNouvelle: 'D45 5081', immatAncienne: '1234 AB 01', kmVidange: 70000 })], mission: [], service: [] },
  vidanges: [],
  etatsVehicules: []
});

test('la vidange la plus récente devient la « Prochaine vidange » du véhicule', async () => {
  const b = await base();
  const x = db.insert('vidanges', { immat: 'D45 5081', date: '2026-10-20', kmActuel: 70100, kmFutur: 75100, kmAncienFutur: 70000 });
  assert.equal(db.reporterVidange(x), true);
  assert.equal(b.vehicles.pool[0].kmVidange, 75100);
  // Une vidange plus ancienne, saisie apres coup, ne change rien.
  const vieille = db.insert('vidanges', { immat: '1234 AB 01', date: '2026-05-02', kmActuel: 65000, kmFutur: 70000 });
  assert.equal(db.reporterVidange(vieille), false);
  assert.equal(b.vehicles.pool[0].kmVidange, 75100);
  // Le compteur releve a la vidange compte comme une lecture.
  assert.equal(db.kmCourant(b.vehicles.pool[0]), 70100);
  // Supprimee : le vehicule reprend la prochaine vidange de la precedente.
  db.oublierVidange(x);
  db.remove('vidanges', x.id);
  assert.equal(b.vehicles.pool[0].kmVidange, 70000);
});

test('ce qui a été fait : la liste de base, puis les travaux ajoutés', async () => {
  await base();
  db.insert('vidanges', { immat: 'D45 5081', date: '2026-10-20', travaux: ['Filtre à huile', 'Filtre à particules'] });
  assert.deepEqual(db.travauxVidangeConnus().slice(-2), ['Filtre à huile', 'Filtre à particules']);
});

test('l’observation après la vidange est signalée dans ÉTAT DES VÉHICULES', async () => {
  const b = await base();
  b.vidanges.push({ id: 'x1', immat: 'D45 5081', date: '2026-10-20', conducteur: 'KOUASSI', observation: 'Fuite d’huile au carter' });
  synchroniserEtats(b);
  const s = b.etatsVehicules.find((e) => e.origine === 'vidange:x1');
  assert.equal(s.probleme, 'Fuite d’huile au carter');
  assert.equal(s.signalePar, 'KOUASSI');
  b.vidanges[0].observation = 'RAS';
  synchroniserEtats(b);
  assert.equal(b.etatsVehicules.length, 0);
});
