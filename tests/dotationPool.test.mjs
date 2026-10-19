/* DOTATION EN CARBURANT POOL : soldes saisis, ecart de continuite par carte, nombre de jours, conducteur. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db, charger } from './aide.mjs';

const CARTE = '1405155513';
const prise = (id, date, immat, montant, extra = {}) =>
  Object.assign({ id, date, immat, carte: CARTE, montant, quantite: 1, prixL: montant, conducteur: '' }, extra);

test('solde apres = solde avant saisi moins le montant ; les prises sont rangees par date', async () => {
  await charger({
    dotationPool: [
      prise('c', '2026-08-17', 'D45 5083', 25000, { soldeAvant: 3480683 }),
      prise('a', '2026-08-03', 'D45 5083', 25000, { soldeAvant: 3520683 }),
      prise('b', '2026-08-10', 'D45 5081', 15000, { soldeAvant: 3495683 })
    ]
  });
  const s = db.suiviDotationPool();
  assert.deepEqual([...s.keys()], ['a', 'b', 'c']);
  assert.equal(s.get('a').soldeApres, 3495683);
  assert.equal(s.get('b').soldeAvant, 3495683, 'le solde avant saisi est garde tel quel');
  assert.equal(s.get('b').soldeApres, 3480683);
});

test('ecart = solde apres du precedent sur la carte moins solde avant de l’actuel', async () => {
  await charger({
    dotationPool: [
      prise('a', '2026-08-03', 'D45 5083', 25000, { soldeAvant: 100000 }),
      prise('b', '2026-08-10', 'D45 5081', 15000, { soldeAvant: 75000 }),
      prise('c', '2026-08-17', 'D45 5083', 25000, { soldeAvant: 40000 }),
      prise('d', '2026-08-20', 'D45 5083', 5000, { soldeAvant: '' })
    ]
  });
  const s = db.suiviDotationPool();
  assert.equal(s.get('a').ecart, '', 'premiere prise de la carte');
  assert.equal(s.get('b').ecart, 0, 'suite continue');
  assert.equal(s.get('c').ecart, 20000, '60 000 laisses, 40 000 trouves : une prise oubliee');
  assert.equal(s.get('d').ecart, '', 'sans solde avant, pas d’ecart');
});

test('un rechargement s’ajoute au solde apres du precedent', async () => {
  await charger({
    dotationPool: [
      prise('a', '2026-08-03', 'D45 5083', 25000, { soldeAvant: 30000 }),
      prise('b', '2026-08-10', 'D45 5083', 25000, { rechargement: 500000, soldeAvant: 505000 })
    ]
  });
  assert.equal(db.suiviDotationPool().get('b').ecart, 0);
});

test('chaque carte a sa propre suite', async () => {
  await charger({
    dotationPool: [
      prise('a', '2026-08-03', 'D45 5083', 25000, { soldeAvant: 100000 }),
      prise('b', '2026-08-04', 'D45 5070', 10000, { carte: '9999999999', soldeAvant: 50000 }),
      prise('c', '2026-08-05', 'D45 5083', 25000, { soldeAvant: 75000 })
    ]
  });
  const s = db.suiviDotationPool();
  assert.equal(s.get('b').ecart, '', 'premiere prise de son autre carte');
  assert.equal(s.get('c').ecart, 0);
});

test('dans une journee, le solde apres le plus bas est la prise la plus recente', async () => {
  await charger({
    dotationPool: [
      prise('a', '2026-08-02', 'D45 5070', 10000, { soldeAvant: 200000 }),
      // Saisies dans le desordre le 03 : les soldes disent l'ordre reel.
      prise('c', '2026-08-03', 'D45 5081', 15000, { soldeAvant: 165000 }),
      prise('b', '2026-08-03', 'D45 5083', 25000, { soldeAvant: 190000 }),
      prise('d', '2026-08-04', 'D45 5086', 25000, { soldeAvant: 150000 })
    ]
  });
  const s = db.suiviDotationPool();
  assert.deepEqual([...s.keys()], ['a', 'b', 'c', 'd']);
  assert.equal(s.get('c').ecart, 0);
  assert.equal(db.soldePrecedentCarte(CARTE, '2026-08-03', 'c'), 165000, 'modifiee : apres b, qui la precede ce jour-la');
  assert.equal(db.soldePrecedentCarte(CARTE, '2026-08-03'), 150000, 'nouvelle : la derniere du jour');
  assert.equal(db.soldePrecedentCarte(CARTE, '2026-08-01'), null, 'avant la premiere');
  assert.equal(db.soldePrecedentCarte('1111111111', '2026-08-20'), null, 'carte sans prise');
});

test('dans une journee ou un solde manque, l’ordre de saisie departage', async () => {
  await charger({
    dotationPool: [
      prise('a', '2026-08-03', 'D45 5083', 25000, { soldeAvant: 10 }),
      prise('b', '2026-08-03', 'D45 5082', 25000, { soldeAvant: '' })
    ]
  });
  assert.deepEqual([...db.suiviDotationPool().keys()], ['a', 'b']);
});

test('le nombre de jours est l’ecart entre les dates des prises du meme vehicule', async () => {
  await charger({
    dotationPool: [
      prise('a', '2026-08-03', 'D45 5083', 1, { soldeAvant: 10 }),
      prise('b', '2026-08-05', 'D45 5081', 1, { soldeAvant: 9 }),
      prise('c', '2026-08-10', 'D45 5083', 1, { soldeAvant: 8 }),
      prise('d', '2026-08-10', 'D45 5083', 1, { soldeAvant: 7 })
    ]
  });
  const s = db.suiviDotationPool();
  assert.equal(s.get('a').jours, null, 'premiere prise du vehicule');
  assert.equal(s.get('b').jours, null, 'un autre vehicule ne compte pas');
  assert.equal(s.get('c').jours, 7, 'du 03 au 10 : 7 jours');
  assert.equal(s.get('d').jours, 0, 'deux prises le meme jour');
});

test('au chargement, le conducteur sort des observations et les prises sans carte rejoignent la carte numerotee', async () => {
  await charger({
    dotationPool: [
      { id: 'a', date: '2026-08-03', immat: 'D45 5083', carte: '', montant: 1, observations: 'DOSSO YAYA' },
      { id: 'b', date: '2026-08-10', immat: 'D45 5086', carte: '00', montant: 1, observations: 'DIARRAS' },
      { id: 'c', date: '2026-08-17', immat: 'D45 5082', carte: CARTE, montant: 1, conducteur: 'KEBE', observations: 'note' },
      { id: 'd', date: '2026-08-18', immat: 'D45 5081', carte: 'AUTRE CARTE', montant: 1 }
    ]
  });
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((id) => db.DB.dotationPool.find((x) => x.id === id));
  assert.equal(a.conducteur, 'DOSSO YAYA');
  assert.equal(a.observations, '');
  assert.equal(b.conducteur, 'DIARRAS');
  assert.equal(c.conducteur, 'KEBE', 'un conducteur deja saisi reste');
  assert.equal(c.observations, 'note', 'et ses observations aussi');
  assert.equal(a.carte, CARTE);
  assert.equal(b.carte, CARTE);
  assert.equal(d.carte, 'AUTRE CARTE', 'une carte nommee reste telle quelle');
});

test('avec plusieurs cartes numerotees, une prise sans carte reste sans carte', async () => {
  await charger({
    dotationPool: [
      { id: 'a', date: '2026-08-03', immat: 'D45 5083', carte: '', montant: 1 },
      { id: 'b', date: '2026-08-10', immat: 'D45 5086', carte: CARTE, montant: 1 },
      { id: 'c', date: '2026-08-17', immat: 'D45 5082', carte: '2222222222', montant: 1 }
    ]
  });
  assert.equal(db.DB.dotationPool.find((d) => d.id === 'a').carte, '');
});
