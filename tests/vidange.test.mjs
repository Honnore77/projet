/* Kilometrage courant, echeance de vidange, voyants et immobilisations. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db, charger, vehicule } from './aide.mjs';

const IMMAT = 'D45 50 1234';
const parc = (v) => ({ pool: [v], mission: [], service: [] });

test('le kilometrage courant est le releve le plus recent, d’ou qu’il vienne', async () => {
  await charger({
    vehicles: parc(vehicule({ id: 'v1', immatNouvelle: IMMAT, km: 10000 })),
    dotationPool: [{ id: 'd1', immat: IMMAT, date: '2026-08-01', km: 12500, quantite: 1, prixL: 1 }],
    maintenance: [{ id: 'e1', immat: IMMAT, dateEntree: '2026-08-10', kmEntree: 13000,
      dateRetour: '2026-08-12', kmRetour: 13850, interventions: [] }]
  });
  const lecture = db.derniereLectureKm(IMMAT);
  assert.equal(lecture.km, 13850);
  assert.equal(lecture.source, 'retour du garage');
  assert.equal(db.kmCourant(db.vehicleByImmat(IMMAT)), 13850);
});

test('sans aucun releve, le kilometrage reste celui saisi sur la fiche', async () => {
  await charger({ vehicles: parc(vehicule({ id: 'v1', immatNouvelle: IMMAT, km: 10000 })) });
  assert.equal(db.derniereLectureKm(IMMAT), null);
  assert.equal(db.kmCourant(db.vehicleByImmat(IMMAT)), 10000);
});

test('a date egale, c’est le releve le plus eleve qui compte', async () => {
  // Une sortie de garage se saisit souvent le jour de l'entree : un compteur
  // ne revenant pas en arriere, le plus grand est le plus recent.
  await charger({
    vehicles: parc(vehicule({ id: 'v1', immatNouvelle: IMMAT, km: 1000 })),
    maintenance: [{ id: 'e1', immat: IMMAT, dateEntree: '2026-08-10', kmEntree: 13000,
      dateRetour: '2026-08-10', kmRetour: 13850, interventions: [] }]
  });
  assert.equal(db.derniereLectureKm(IMMAT).km, 13850);
});

test('les paliers du voyant : 1000, 700 et 500 kilometres', () => {
  assert.equal(db.niveauVoyantVidange(1200), null, 'au-dela de 1000, rien');
  assert.equal(db.niveauVoyantVidange(1000), 'jaune', 'a 1000 le voyant s’allume');
  assert.equal(db.niveauVoyantVidange(900), 'jaune');
  assert.equal(db.niveauVoyantVidange(750), 'jaune');
  assert.equal(db.niveauVoyantVidange(701), 'jaune');
  assert.equal(db.niveauVoyantVidange(700), 'jaune', 'jaune jusqu’a 700 inclus');
  assert.equal(db.niveauVoyantVidange(699), 'orange');
  assert.equal(db.niveauVoyantVidange(600), 'orange');
  assert.equal(db.niveauVoyantVidange(500), 'orange', 'orange jusqu’a 500 inclus');
  assert.equal(db.niveauVoyantVidange(499), 'rouge');
  assert.equal(db.niveauVoyantVidange(10), 'rouge');
  assert.equal(db.niveauVoyantVidange(0), 'rouge');
  assert.equal(db.niveauVoyantVidange(-300), 'rouge', 'depassee : rouge jusqu’a la vidange');
  assert.equal(db.niveauVoyantVidange(null), null, 'sans echeance, pas de voyant');
});

test('les trois seuils se reglent dans REGLAGES', async () => {
  await charger({ settings: { seuilVoyantJaune: 2000, seuilVoyantOrange: 1200, seuilVoyantRouge: 300 } });
  assert.deepEqual(db.seuilsVoyantVidange(), { jaune: 2000, orange: 1200, rouge: 300 });
  assert.equal(db.niveauVoyantVidange(2001), null);
  assert.equal(db.niveauVoyantVidange(2000), 'jaune');
  assert.equal(db.niveauVoyantVidange(1200), 'jaune');
  assert.equal(db.niveauVoyantVidange(1199), 'orange');
  assert.equal(db.niveauVoyantVidange(300), 'orange');
  assert.equal(db.niveauVoyantVidange(299), 'rouge');
  // La vidange est « a prevoir » (exports, statistiques) des le jaune.
  await charger({
    settings: { seuilVoyantJaune: 2000, seuilVoyantOrange: 1200, seuilVoyantRouge: 300 },
    vehicles: parc(vehicule({ id: 'v1', immatNouvelle: IMMAT, km: 10000, kmVidange: 11800 }))
  });
  assert.equal(db.etatVidange(db.vehicleByImmat(IMMAT)).statut, 'proche');
});

test('des seuils absents ou dans le desordre reviennent a 1000 / 700 / 500', async () => {
  await charger({ settings: {} });
  assert.deepEqual(db.seuilsVoyantVidange(), { jaune: 1000, orange: 700, rouge: 500 });
  await charger({ settings: { seuilVoyantJaune: 500, seuilVoyantOrange: 700, seuilVoyantRouge: 1000 } });
  assert.deepEqual(db.seuilsVoyantVidange(), { jaune: 1000, orange: 700, rouge: 500 });
});

test('un vehicule sans kilometrage de vidange n’allume aucun voyant', async () => {
  await charger({ vehicles: parc(vehicule({ id: 'v1', immatNouvelle: IMMAT, km: 10000 })) });
  assert.equal(db.etatVidange(db.vehicleByImmat(IMMAT)).statut, 'inconnu');
  assert.deepEqual(db.voyantsVidange(), []);
});

test('les voyants sortent du plus urgent au moins urgent', async () => {
  await charger({
    vehicles: {
      pool: [
        vehicule({ id: 'v1', immatNouvelle: 'D45 50 1111', km: 10000, kmVidange: 10900 }), // 900 jaune
        vehicule({ id: 'v2', immatNouvelle: 'D45 50 2222', km: 10000, kmVidange: 10600 }), // 600 orange
        vehicule({ id: 'v3', immatNouvelle: 'D45 50 3333', km: 10000, kmVidange: 10200 }), // 200 rouge
        vehicule({ id: 'v4', immatNouvelle: 'D45 50 4444', km: 10000, kmVidange: 9700 }),  // -300 rouge
        vehicule({ id: 'v5', immatNouvelle: 'D45 50 5555', km: 10000, kmVidange: 20000 })  // rien
      ],
      mission: [], service: []
    }
  });
  assert.deepEqual(
    db.voyantsVidange().map((x) => [x.immat, x.niveau]),
    [
      ['D45 50 4444', 'rouge'],
      ['D45 50 3333', 'rouge'],
      ['D45 50 2222', 'orange'],
      ['D45 50 1111', 'jaune']
    ]
  );
});

test('le voyant s’eteint quand le kilometrage de vidange est reporte plus loin', async () => {
  const base = await charger({
    vehicles: parc(vehicule({ id: 'v1', immatNouvelle: IMMAT, km: 10000, kmVidange: 10200 }))
  });
  assert.equal(db.voyantsVidange().length, 1);
  base.vehicles.pool[0].kmVidange = 15000;
  assert.deepEqual(db.voyantsVidange(), []);
});

test('le voyant suit le kilometrage releve ailleurs, pas celui de la fiche', async () => {
  await charger({
    vehicles: parc(vehicule({ id: 'v1', immatNouvelle: IMMAT, km: 10000, kmVidange: 11000 })),
    dotationPool: [{ id: 'd1', immat: IMMAT, date: '2026-08-01', km: 10800, quantite: 1, prixL: 1 }]
  });
  // Sur la fiche seule il resterait 1000 km ; le releve ramene a 200.
  assert.equal(db.etatVidange(db.vehicleByImmat(IMMAT)).restant, 200);
  assert.equal(db.voyantsVidange()[0].niveau, 'rouge');
});

test('les immobilises reunissent le garage et le statut, sans doublon', async () => {
  await charger({
    vehicles: {
      pool: [
        vehicule({ id: 'v1', immatNouvelle: 'D45 50 1234', statut: 'Immobilisé' }),
        vehicule({ id: 'v2', immatNouvelle: 'D45 50 9999', statut: 'Disponible' }),
        vehicule({ id: 'v3', immatNouvelle: 'D45 50 7777', statut: 'Disponible' })
      ],
      mission: [], service: []
    },
    maintenance: [
      // Au garage : pas de date de retour.
      { id: 'e1', immat: 'D45 50 1234', dateEntree: '2026-08-01', interventions: [] },
      { id: 'e2', immat: 'D45 50 9999', dateEntree: '2026-08-05', interventions: [] },
      // Sorti : ne doit pas figurer.
      { id: 'e3', immat: 'D45 50 7777', dateEntree: '2026-07-01', dateRetour: '2026-07-03', interventions: [] }
    ]
  });
  const immats = db.vehiculesImmobilises().map((x) => x.immat).sort();
  assert.deepEqual(immats, ['D45 50 1234', 'D45 50 9999']);
  // Le vehicule a la fois au garage et marque « Immobilisé » ne compte qu'une fois.
  assert.equal(db.vehiculesImmobilises().filter((x) => x.immat === 'D45 50 1234').length, 1);
});

test('un vehicule marque « Immobilisé » sans passage au garage figure quand meme', async () => {
  await charger({
    vehicles: parc(vehicule({ id: 'v1', immatNouvelle: IMMAT, statut: 'Immobilisé' }))
  });
  const l = db.vehiculesImmobilises();
  assert.equal(l.length, 1);
  assert.equal(l[0].origine, 'statut');
});

test('le kilometrage d’arrivee du rapport de mission met a jour le kilometrage du vehicule', async () => {
  await charger({
    vehicles: { pool: [], mission: [vehicule({ id: 'v1', immatNouvelle: IMMAT, km: 10000 })], service: [] },
    dotationPool: [{ id: 'd', immat: IMMAT, date: '2026-10-01', km: 12000 }],
    missions: [{ id: 'm', vehicule: IMMAT, dateDepart: '2026-10-05', dateRetour: '2026-10-08', kmDepart: 12100, kmArrivee: 13950 }]
  });
  const v = db.vehicleByImmat(IMMAT);
  assert.equal(db.kmCourant(v), 13950);
  assert.equal(db.derniereLectureKm(IMMAT).source, 'retour de mission');
});

test('sans date de retour, le km d’arrivee compte au jour du depart, apres le km de depart', async () => {
  await charger({
    vehicles: { pool: [], mission: [vehicule({ id: 'v1', immatNouvelle: IMMAT })], service: [] },
    missions: [{ id: 'm', vehicule: IMMAT, dateDepart: '2026-10-05', kmDepart: 12100, kmArrivee: 12900 }]
  });
  assert.equal(db.kmCourant(db.vehicleByImmat(IMMAT)), 12900);
});

test('un releve plus recent ailleurs l’emporte sur une mission plus ancienne', async () => {
  await charger({
    vehicles: { pool: [], mission: [vehicule({ id: 'v1', immatNouvelle: IMMAT })], service: [] },
    missions: [{ id: 'm', vehicule: IMMAT, dateDepart: '2026-09-01', dateRetour: '2026-09-03', kmDepart: 9000, kmArrivee: 9800 }],
    dotationPool: [{ id: 'd', immat: IMMAT, date: '2026-10-01', km: 10200 }]
  });
  assert.equal(db.kmCourant(db.vehicleByImmat(IMMAT)), 10200);
});

test('la carte ALERTES reprend les trois couleurs des voyants', async () => {
  await charger({
    vehicles: {
      pool: [
        vehicule({ id: 'v1', immatNouvelle: 'D45 50 1111', km: 10000, kmVidange: 10900 }), // 900 jaune
        vehicule({ id: 'v2', immatNouvelle: 'D45 50 2222', km: 10000, kmVidange: 10650 }), // 650 orange
        vehicule({ id: 'v3', immatNouvelle: 'D45 50 3333', km: 10000, kmVidange: 10200 }), // 200 rouge
        vehicule({ id: 'v4', immatNouvelle: 'D45 50 4444', km: 10000, kmVidange: 9700 })   // -300 rouge
      ],
      mission: [], service: []
    }
  });
  const lignes = db.computeAlerts().filter((a) => a.icon === '🛢️');
  assert.deepEqual(lignes.map((a) => [a.level, a.title]), [
    ['crit', 'Vidange urgente : 2 véhicules'],
    ['orange', 'Vidange proche : 1 véhicule'],
    ['jaune', 'Vidange à prévoir : 1 véhicule']
  ]);
  assert.match(lignes[0].detail, /D45 50 4444 : -300 km \(dépassée\)/);
  assert.match(lignes[0].detail, /D45 50 3333 : 200 km restants/);
});
