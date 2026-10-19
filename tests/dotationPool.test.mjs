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

test('le nombre de jours est l’ecart entre les dates des prises du meme vehicule', async () => {
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
  assert.equal(s.get('c').jours, 7, 'du 03 au 10 : 7 jours');
  assert.equal(s.get('d').jours, 0, 'deux prises le meme jour');
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

test('l’ecart compare le solde releve sur le ticket au solde calcule', async () => {
  await charger({
    dotationPool: [
      prise('a', '2026-08-03', 'D45 5083', 25000, { soldeAvant: 100000, soldeReleve: 75000 }),
      prise('b', '2026-08-10', 'D45 5081', 15000, { soldeReleve: 100000 }),
      prise('c', '2026-08-17', 'D45 5083', 25000, { soldeReleve: '' })
    ]
  });
  const s = db.suiviDotationPool();
  assert.equal(s.get('a').ecart, 0, 'ticket conforme');
  assert.equal(s.get('b').ecart, 40000, 'la carte a 40 000 F de plus que prevu');
  assert.equal(s.get('c').ecart, '', 'sans solde releve, pas d’ecart');
});

test('au chargement, l’ancien solde apres saisi devient le solde releve', async () => {
  await charger({
    dotationPool: [
      { id: 'a', date: '2026-08-03', immat: 'D45 5083', carte: CARTE, montant: 25000, soldeAvant: 3520683, soldeApres: 3495683 },
      { id: 'b', date: '2026-08-10', immat: 'D45 5083', carte: CARTE, montant: 25000, soldeAvant: '', soldeApres: '' }
    ]
  });
  const [a, b] = ['a', 'b'].map((id) => db.DB.dotationPool.find((d) => d.id === id));
  assert.equal(a.soldeReleve, 3495683);
  assert.equal(b.soldeReleve, '');
});

test('dans une journee, le solde releve le plus bas est la prise la plus recente', async () => {
  await charger({
    dotationPool: [
      prise('a', '2026-08-02', 'D45 5070', 10000, { soldeAvant: 200000, soldeReleve: 190000 }),
      // Saisies dans le desordre le 03 : le ticket dit l'ordre reel.
      prise('c', '2026-08-03', 'D45 5081', 15000, { soldeReleve: 150000 }),
      prise('b', '2026-08-03', 'D45 5083', 25000, { soldeReleve: 165000 }),
      prise('d', '2026-08-04', 'D45 5086', 25000, { soldeReleve: 125000 })
    ]
  });
  const s = db.suiviDotationPool();
  assert.deepEqual([...s.keys()], ['a', 'b', 'c', 'd']);
  assert.equal(s.get('b').soldeAvant, 190000);
  assert.equal(s.get('c').soldeApres, 150000);
  assert.equal(db.soldePrecedentCarte(CARTE, '2026-08-03', 'c'), 165000, 'modifiee : apres b, qui la precede ce jour-la');
  assert.equal(db.soldePrecedentCarte(CARTE, '2026-08-03', 'b'), 190000);
  assert.equal(db.soldePrecedentCarte(CARTE, '2026-08-03'), 150000, 'nouvelle : la derniere du jour');
});

test('dans une journee sans solde releve partout, l’ordre de saisie departage', async () => {
  await charger({
    dotationPool: [
      prise('a', '2026-08-03', 'D45 5083', 25000, { soldeAvant: 100000, soldeReleve: 10 }),
      prise('b', '2026-08-03', 'D45 5082', 25000, { soldeReleve: '' })
    ]
  });
  assert.deepEqual([...db.suiviDotationPool().keys()], ['a', 'b']);
});

test('une carte nommee sans numero est une vraie carte, avec sa propre suite', async () => {
  await charger({
    dotationPool: [
      prise('a', '2026-08-03', 'D45 5083', 25000, { soldeAvant: 3000000 }),
      prise('b', '2026-08-24', 'D45 5082', 25000, { carte: 'AUTRE CARTE', soldeAvant: 860430 }),
      prise('c', '2026-08-25', 'D45 5084', 25000, { carte: 'autre carte' }),
      prise('d', '2026-08-26', 'D45 5083', 25000),
      prise('e', '2026-08-27', 'D45 5070', 1000, { carte: '00' })
    ]
  });
  assert.equal(db.DB.dotationPool.find((d) => d.id === 'b').carte, 'AUTRE CARTE', 'pas rattachee a la carte numerotee');
  assert.equal(db.DB.dotationPool.find((d) => d.id === 'e').carte, CARTE, 'une carte nommee n’empeche pas le rattachement');
  const s = db.suiviDotationPool();
  assert.equal(s.get('c').soldeAvant, 835430, 'la casse ne compte pas');
  assert.equal(s.get('d').soldeAvant, 2975000);
});
