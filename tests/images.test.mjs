/* Les images citees par les fiches et leurs sous-fiches. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db, charger, agent, vehicule } from './aide.mjs';

test('toutes les rubriques qui portent des images recoivent leur tableau', async () => {
  const base = await charger({
    vehicles: { pool: [vehicule({ id: 'v1', immatNouvelle: 'D45 50 1234' })], mission: [], service: [] },
    users: [agent({ id: 'u1', historique: [{ nature: 'Accident', date: '2026-05-01' }] })],
    maintenance: [{ id: 'e1', immat: 'D45 50 1234', dateEntree: '2026-07-01',
      interventions: [{ garage: 'A', cout: 100 }] }],
    missions: [{ id: 'm1', conducteur: 'X', dateDepart: '2026-06-01' }],
    dotationPool: [{ id: 'd1', immat: 'D45 50 1234', date: '2026-08-01', quantite: 1, prixL: 1 }]
  });
  for (const fiche of db.fichesAImages(base)) {
    assert.ok(Array.isArray(fiche.images), 'tableau images manquant');
  }
});

test('une image citee par une intervention ou un incident n’est pas orpheline', async () => {
  const base = await charger({
    users: [agent({ id: 'u1', historique: [{ nature: 'Accident', images: [{ id: 'img_incident1' }] }] })],
    maintenance: [{ id: 'e1', immat: 'D45 50 1234', dateEntree: '2026-07-01',
      interventions: [{ garage: 'A', cout: 100, images: [{ id: 'img_interv1' }] }] }]
  });
  const citees = db.imagesCitees(base);
  // Sans ces deux-la dans la liste centrale, le menage du demarrage les
  // effacerait et l'archive de sauvegarde les oublierait.
  assert.ok(citees.has('img_incident1'), 'image d’incident tenue pour orpheline');
  assert.ok(citees.has('img_interv1'), 'image d’intervention tenue pour orpheline');
});

test('les images des fiches principales sont citees elles aussi', async () => {
  const base = await charger({
    vehicles: { pool: [vehicule({ id: 'v1', images: [{ id: 'img_veh1' }] })], mission: [], service: [] },
    missions: [{ id: 'm1', conducteur: 'X', dateDepart: '2026-06-01', images: [{ id: 'img_mis1' }] }],
    dotationPool: [{ id: 'd1', immat: 'X', date: '2026-08-01', quantite: 1, prixL: 1, images: [{ id: 'img_dot1' }] }]
  });
  const citees = db.imagesCitees(base);
  ['img_veh1', 'img_mis1', 'img_dot1'].forEach((id) => assert.ok(citees.has(id), `${id} non citee`));
});

test('une base sans image ne cite rien — le menage doit alors s’abstenir', async () => {
  const base = await charger({ vehicles: { pool: [vehicule({ id: 'v1' })], mission: [], service: [] } });
  assert.equal(db.imagesCitees(base).size, 0);
});
