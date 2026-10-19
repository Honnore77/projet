/* DOTATION EN CARBURANT POOL : soldes enchaines par carte, nombre de jours, conducteur. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db, charger } from './aide.mjs';

const CARTE = '1405155513';
const prise = (id, date, immat, montant, extra = {}) =>
  Object.assign({ id, date, immat, carte: CARTE, montant, quantite: 1, prixL: montant, conducteur: '' }, extra);

test('le solde avant d’une prise est le solde apres de la precedente sur la carte', async () => {
  await charger({
    dotationPool: [
      // Saisies dans le desordre : c'est la date qui fait l'ordre.
      prise('c', '2026-08-17', 'D45 5083', 25000, { soldeAvant: 1 }),
      prise('a', '2026-08-03', 'D45 5083', 25000, { soldeAvant: 3520683 }),
      prise('b', '2026-08-10', 'D45 5081', 15000, { soldeAvant: 999 })
    ]
  });
  const s = db.suiviDotationPool();
  assert.deepEqual([...s.keys()], ['a', 'b', 'c']);
  assert.equal(s.get('a').soldeAvant, 3520683, 'la premiere prise garde son solde de depart');
  assert.equal(s.get('a').soldeApres, 3495683);
  assert.equal(s.get('b').soldeAvant, 3495683, 'le solde saisi a la main est ignore');
  assert.equal(s.get('b').soldeApres, 3480683);
  assert.equal(s.get('c').soldeAvant, 3480683);
});

test('a date egale, l’ordre de saisie departage', async () => {
  await charger({
    dotationPool: [
      prise('a', '2026-08-03', 'D45 5083', 25000, { soldeAvant: 100000 }),
      prise('b', '2026-08-03', 'D45 5082', 25000)
    ]
  });
  const s = db.suiviDotationPool();
  assert.equal(s.get('b').soldeAvant, 75000);
  assert.equal(s.get('b').soldeApres, 50000);
});

test('un rechargement s’ajoute au solde laisse par la prise precedente', async () => {
  await charger({
    dotationPool: [
      prise('a', '2026-08-03', 'D45 5083', 25000, { soldeAvant: 30000 }),
      prise('b', '2026-08-10', 'D45 5083', 25000, { rechargement: 500000 })
    ]
  });
  const s = db.suiviDotationPool();
  assert.equal(s.get('b').soldeAvant, 505000);
  assert.equal(s.get('b').soldeApres, 480000);
});

test('chaque carte a sa propre suite de soldes', async () => {
  await charger({
    dotationPool: [
      prise('a', '2026-08-03', 'D45 5083', 25000, { soldeAvant: 100000 }),
      prise('b', '2026-08-04', 'D45 5070', 10000, { carte: '9999999999', soldeAvant: 50000 }),
      prise('c', '2026-08-05', 'D45 5083', 25000)
    ]
  });
  const s = db.suiviDotationPool();
  assert.equal(s.get('b').soldeAvant, 50000);
  assert.equal(s.get('c').soldeAvant, 75000);
});

test('le nombre de jours compte depuis la prise precedente du meme vehicule', async () => {
  await charger({
    dotationPool: [
      prise('a', '2026-08-03', 'D45 5083', 1, { soldeAvant: 10 }),
      prise('b', '2026-08-05', 'D45 5081', 1),
      prise('c', '2026-08-10', 'D45 5083', 1),
      prise('d', '2026-08-10', 'D45 5083', 1)
    ]
  });
  const s = db.suiviDotationPool();
  assert.equal(s.get('a').jours, null, 'premiere prise du vehicule');
  assert.equal(s.get('b').jours, null, 'un autre vehicule ne compte pas');
  assert.equal(s.get('c').jours, 7);
  assert.equal(s.get('d').jours, 0);
});

test('solde precedent pour une nouvelle prise ou une prise modifiee', async () => {
  await charger({
    dotationPool: [
      prise('a', '2026-08-03', 'D45 5083', 25000, { soldeAvant: 100000 }),
      prise('b', '2026-08-10', 'D45 5081', 15000),
      prise('c', '2026-08-17', 'D45 5083', 25000)
    ]
  });
  assert.equal(db.soldePrecedentCarte(CARTE, '2026-08-12'), 60000, 'nouvelle prise entre b et c');
  assert.equal(db.soldePrecedentCarte(CARTE, '2026-08-10'), 60000, 'a date egale, apres celles deja saisies');
  assert.equal(db.soldePrecedentCarte(CARTE, '2026-08-10', 'b'), 75000, 'une prise modifiee ne se precede pas');
  assert.equal(db.soldePrecedentCarte(CARTE, '2026-08-01'), null, 'avant la premiere : solde a saisir');
  assert.equal(db.soldePrecedentCarte('1111111111', '2026-08-20'), null, 'carte sans prise');
});

test('au chargement, le conducteur sort des observations et les prises sans carte rejoignent la carte unique', async () => {
  await charger({
    dotationPool: [
      { id: 'a', date: '2026-08-03', immat: 'D45 5083', carte: '', montant: 1, observations: 'DOSSO YAYA' },
      { id: 'b', date: '2026-08-10', immat: 'D45 5086', carte: '00', montant: 1, observations: 'DIARRAS' },
      { id: 'c', date: '2026-08-17', immat: 'D45 5082', carte: CARTE, montant: 1, conducteur: 'KEBE', observations: 'note' }
    ]
  });
  const [a, b, c] = ['a', 'b', 'c'].map((id) => db.DB.dotationPool.find((d) => d.id === id));
  assert.equal(a.conducteur, 'DOSSO YAYA');
  assert.equal(a.observations, '');
  assert.equal(b.conducteur, 'DIARRAS');
  assert.equal(c.conducteur, 'KEBE', 'un conducteur deja saisi reste');
  assert.equal(c.observations, 'note', 'et ses observations aussi');
  assert.equal(a.carte, CARTE);
  assert.equal(b.carte, CARTE);
});

test('avec plusieurs cartes, une prise sans carte reste sans carte', async () => {
  await charger({
    dotationPool: [
      { id: 'a', date: '2026-08-03', immat: 'D45 5083', carte: '', montant: 1 },
      { id: 'b', date: '2026-08-10', immat: 'D45 5086', carte: CARTE, montant: 1 },
      { id: 'c', date: '2026-08-17', immat: 'D45 5082', carte: '2222222222', montant: 1 }
    ]
  });
  assert.equal(db.DB.dotationPool.find((d) => d.id === 'a').carte, '');
});
