/* STATISTIQUES : repartitions, mois, filtre d'annee, et chaque rubrique. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { charger, vehicule } from './aide.mjs';

const st = await import('../resources/js/core/statistiques.js');
const sansEspace = (s) => String(s).replace(/[\s  ]/g, ' ');

test('une repartition compte, trie et donne la part de chaque valeur', () => {
  const r = st.repartition([{ e: 'Diesel' }, { e: 'Essence' }, { e: 'Diesel' }, { e: '' }], (x) => x.e);
  assert.equal(r.total, 4);
  assert.deepEqual(r.lignes.map((l) => [l.libelle, l.nombre, sansEspace(l.part)]), [
    ['Diesel', 2, '50 %'], ['Essence', 1, '25 %'], ['non renseigné', 1, '25 %']
  ]);
});

test('au-dela de la limite, le reste est regroupe sous « autres »', () => {
  const r = st.repartition(['a', 'a', 'b', 'c', 'd'].map((v) => ({ v })), (x) => x.v, { limite: 2 });
  assert.deepEqual(r.lignes.map((l) => [l.libelle, l.nombre]), [['a', 2], ['b', 1], ['autres', 2]]);
});

test('une annee donnee : ses douze mois, meme vides', () => {
  const m = st.parMois([{ d: '2026-03-10' }, { d: '2026-03-20' }, { d: '2025-03-01' }], (x) => x.d, '2026', { N: () => 1 });
  assert.equal(m.libelles.length, 12);
  assert.equal(m.series[0].valeurs[2], 2);
  assert.equal(m.series[0].valeurs.reduce((a, b) => a + b, 0), 2);
});

test('toutes les annees : chaque mois present, dans l’ordre', () => {
  const m = st.parMois([{ d: '2026-03-10' }, { d: '2025-11-01' }], (x) => x.d, '', { N: () => 1 });
  assert.deepEqual(m.cles, ['2025-11', '2026-03']);
});

test('les missions de l’annee : nombre, jours, compteur, paiement', async () => {
  await charger({
    missions: [
      { id: 'a', conducteur: 'KONE Ali', dateDepart: '2026-02-01', jours: 3, destinations: ['Bouaké'], kmDepart: 1000, kmArrivee: 1800, montant: 30000, paye: true },
      { id: 'b', conducteur: 'KONE Ali', dateDepart: '2026-05-01', jours: 2, destinations: ['Bouaké', 'Korhogo'], montant: 20000, paye: false },
      { id: 'c', conducteur: 'YAO Koffi', dateDepart: '2025-05-01', jours: 9 }
    ]
  });
  const s = st.statsMissions('2026');
  const t = Object.fromEntries(s.tuiles.map((x) => [x.titre, sansEspace(x.valeur)]));
  assert.equal(t.Missions, '2');
  assert.equal(t['Jours de mission'], '5');
  assert.equal(t['Km au compteur'], '800 km');
  assert.equal(t['Non payées'], '1');
  const destinations = s.blocs.find((b) => b.titre === 'Destinations les plus fréquentes');
  assert.deepEqual(destinations.lignes.map((l) => [l[0], l[1]]), [['Bouaké', '2'], ['Korhogo', '1']]);
  // Toutes annees : la mission de 2025 compte aussi.
  assert.equal(st.statsMissions('').tuiles[0].valeur, '3');
});

test('chaque rubrique rend des tuiles et des blocs, meme sans donnees', async () => {
  await charger();
  Object.entries(st.STATISTIQUES).forEach(([cle, def]) => {
    const s = def.calcul('2026');
    assert.ok(s.tuiles.length >= 4, cle);
    assert.ok(Array.isArray(s.blocs) && s.blocs.length, cle);
    s.blocs.forEach((b) => b.lignes.forEach((l) => assert.equal(l.length, b.entetes.length, `${cle} — ${b.titre}`)));
  });
});

test('les couts d’entretien par garage et les durees d’immobilisation', async () => {
  await charger({
    maintenance: [
      { id: 'a', immat: 'X', dateEntree: '2026-01-01', dateRetour: '2026-01-03', interventions: [{ garage: 'G1', cout: 10000 }, { garage: 'G2', cout: 5000 }] },
      { id: 'b', immat: 'X', dateEntree: '2026-02-01', dateRetour: '2026-02-11', interventions: [{ garage: 'G1', cout: 20000 }] }
    ]
  });
  const s = st.statsEntretien('2026');
  const t = Object.fromEntries(s.tuiles.map((x) => [x.titre, sansEspace(x.valeur)]));
  assert.equal(t['Coût total'], '35 000 F');
  assert.equal(t['Durée moyenne'], '6,0 j');
  const parGarage = s.blocs.find((b) => b.titre === 'Coût par garage');
  assert.deepEqual(parGarage.lignes.map((l) => [l[0], sansEspace(l[1])]), [['G1', '30 000 F'], ['G2', '5 000 F']]);
});

test('frequence de sortie : decharges pour le pool, missions pour MISSION', async () => {
  await charger({
    vehicles: { pool: [vehicule({ id: 'p1', immatNouvelle: 'D45 5082', immatAncienne: '1234 AB 01' })], mission: [], service: [] },
    decharges: [
      { id: 'd1', date: '2026-01-07', conducteur: 'DELON CALIXE', immat: 'D45 5082' },
      { id: 'd2', date: '2026-02-03', conducteur: 'DELON CALIXE', immat: '1234 AB 01' },
      { id: 'd3', date: '2026-02-04', conducteur: 'AGBO', immat: 'D45 5082' },
      { id: 'd4', date: '2025-12-30', conducteur: 'AGBO', immat: 'D45 5082' }
    ],
    missions: [
      { id: 'm1', dateDepart: '2026-03-01', conducteur: 'AGBO', vehicule: 'D45 5070' },
      { id: 'm2', dateDepart: '2026-03-09', conducteur: 'AGBO', vehicule: 'D45 5070' }
    ]
  });
  const bloc = (s, debut) => s.blocs.find((b) => b.titre.startsWith(debut));
  const v = st.statsVehicules('2026');
  assert.deepEqual(bloc(v, 'Fréquence de sortie des conducteurs du pool').lignes.map((l) => [l[0], l[1]]), [['DELON CALIXE', '2'], ['AGBO', '1']]);
  // L'ancienne immatriculation compte pour le meme vehicule.
  assert.deepEqual(bloc(v, 'Fréquence de sortie des véhicules du pool').lignes.map((l) => [l[0], l[1]]), [['D45 5082', '3']]);
  assert.equal(bloc(v, 'Fréquence de sortie des véhicules du pool').graphique.type, 'bar');
  assert.equal(st.statsVehicules('').tuiles.find((t) => t.titre === 'Sorties du pool').valeur, '4');
  const m = st.statsMissions('2026');
  assert.deepEqual(bloc(m, 'Fréquence de sortie des conducteurs en mission').lignes.map((l) => [l[0], l[1]]), [['AGBO', '2']]);
  assert.deepEqual(bloc(m, 'Fréquence de sortie des véhicules en mission').lignes.map((l) => [l[0], l[1]]), [['D45 5070', '2']]);
});
