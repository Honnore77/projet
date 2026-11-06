/* COHÉRENCE : toutes les donnees se synchronisent, et un nom, une plaque ou
   une destination qui change suit dans toutes les rubriques. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db, charger, vehicule, agent } from './aide.mjs';

const sy = await import('../resources/js/core/synchro.js');
const { synchroniserEtats } = await import('../resources/js/core/etatsVehicules.js');

const T1 = '2026-11-06T08:00:00.000Z';

test('chaque liste de la base se synchronise, et porte un libelle', () => {
  const vide = db.normalize({});
  const listes = Object.keys(vide).filter((k) => Array.isArray(vide[k]));
  const oubliees = listes.filter((k) => !sy.COLLECTIONS_SYNCHRO.includes(k));
  assert.deepEqual(oubliees, [], `listes hors synchronisation : ${oubliees.join(', ')}`);
  assert.deepEqual(sy.COLLECTIONS_SYNCHRO.filter((k) => !sy.LIBELLES_COLLECTIONS[k]), []);
});

test('une fiche de chaque liste passe d’un PC a l’autre', () => {
  const ici = db.normalize({ synchro: { suppressions: [] } });
  const la = db.normalize({ synchro: { suppressions: [] } });
  sy.COLLECTIONS_SYNCHRO.forEach((c) => { la[c] = [{ id: `x_${c}`, maj: T1, majPar: 'PC2' }]; });
  la.vehicles.pool = [{ id: 'x_veh', immatNouvelle: 'D45 1', maj: T1, majPar: 'PC2' }];
  const { db: fusion } = sy.fusionner(ici, la, { maintenant: T1, iciGagneEgalite: true });
  const manquantes = sy.COLLECTIONS_SYNCHRO.filter((c) => !(fusion[c] || []).some((f) => f.id === `x_${c}`));
  assert.deepEqual(manquantes, [], `non recues : ${manquantes.join(', ')}`);
  assert.ok(fusion.vehicles.pool.some((v) => v.id === 'x_veh'));
});

test('un agent renomme suit partout, compte lie compris', async () => {
  const ancien = 'KONE ALI';
  const nouveau = 'KONÉ ALI SEYDOU';
  const base = await charger({
    accounts: [{ id: 'c1', login: 'admin', role: 'admin', actif: true }, { id: 'c2', login: 'kone', role: 'conducteur', agent: ancien }],
    users: [agent({ id: 'u1', nom: 'KONE', prenoms: 'ALI' })],
    missions: [{ id: 'm', conducteur: ancien, participants: ['YAO', ancien] }],
    sortiesAbidjan: [{ id: 's', conducteur: ancien, participants: [ancien] }],
    dotationPool: [{ id: 'd', conducteur: ancien }],
    decharges: [{ id: 'c', conducteur: ancien, conducteur2: ancien, recuperePar: ancien }],
    vidanges: [{ id: 'v', conducteur: ancien }],
    maintenance: [{ id: 'e', conducteurEntree: ancien, conducteurRetour: ancien, signalePar: ancien }],
    etatsVehicules: [{ id: 'p', signalePar: ancien, signaleA: ancien }],
    relevesKm: [{ id: 'r', saisiPar: ancien }],
    indisponibilites: [{ id: 'i', conducteur: ancien, interimaire: ancien }],
    demandes: [{ id: 'q', agent: ancien, interimaire: ancien }]
  });
  db.renommerAgentDansLesFiches(ancien, nouveau);
  const reste = JSON.stringify(base).includes(`"${ancien}"`);
  assert.equal(reste, false, 'l’ancien nom reste quelque part');
  assert.equal(base.accounts.find((a) => a.id === 'c2').agent, nouveau);
  assert.deepEqual(base.missions[0].participants, ['YAO', nouveau]);
});

test('une immatriculation corrigee suit sur tout l’historique du vehicule', async () => {
  const base = await charger({
    vehicles: { pool: [vehicule({ id: 'v1', immatNouvelle: 'D45 5O82' })], mission: [], service: [] },
    users: [agent({ id: 'u1', historique: [{ id: 'h', vehicule: 'D45 5O82' }] })],
    dotationPool: [{ id: 'd', immat: 'D45 5O82' }], maintenance: [{ id: 'e', immat: 'd45 5o82' }],
    missions: [{ id: 'm', vehicule: 'D45 5O82' }], sortiesAbidjan: [{ id: 's', vehicule: 'D45 5O82' }],
    decharges: [{ id: 'c', immat: 'D45 5O82' }], vidanges: [{ id: 'v', immat: 'D45 5O82' }],
    etatsVehicules: [{ id: 'p', immat: 'D45 5O82' }], relevesKm: [{ id: 'r', immat: 'D45 5O82' }],
    simulations: [{ id: 'x', vehicule: 'D45 5O82' }]
  });
  const n = db.renommerImmatriculation('D45 5O82', 'D45 5082');
  // Dix fiches dans dix rubriques ; la fiche du vehicule, elle, change par
  // son formulaire.
  assert.equal(n, 10);
  const { vehicles, ...autres } = base;
  assert.equal(JSON.stringify(autres).toUpperCase().includes('5O82'), false);
});

test('un garage et une destination renommes suivent dans les vidanges et les simulations', async () => {
  const base = await charger({
    maintenance: [{ id: 'e', garage: 'CFAO' }], vidanges: [{ id: 'v', structure: 'cfao' }],
    destinationsMission: [{ id: 'd', nom: 'Bouake' }], simulations: [{ id: 'x', destinations: ['Yamoussoukro', 'Bouake'] }]
  });
  db.renommerGarage('CFAO', 'CFAO MOTORS');
  db.renommerDestinationMission('Bouake', 'Bouaké');
  assert.equal(base.vidanges[0].structure, 'CFAO MOTORS');
  assert.deepEqual(base.simulations[0].destinations, ['Yamoussoukro', 'Bouaké']);
});

test('le carburant compte pareil partout : pool, missions et sorties d’Abidjan', async () => {
  await charger({
    vehicles: { pool: [vehicule({ id: 'v1', immatNouvelle: 'D45 5082' })], mission: [], service: [] },
    dotationPool: [{ id: 'd', date: '2026-11-01', immat: 'D45 5082', montant: 20000, quantite: 25 }],
    missions: [{ id: 'm', vehicule: 'D45 5082', dateDepart: '2026-11-02', ravitaillements: [{ montant: 15000, prixL: 875, quantite: 17.14 }] }],
    sortiesAbidjan: [{ id: 's', vehicule: 'D45 5082', date: '2026-11-03', ravitaillements: [{ montant: 10000, prixL: 875, quantite: 11.43 }] }]
  });
  // Cout du vehicule (cout par vehicule, tableau de bord) = pool + missions et sorties (CARBURANT, RAPPORTS).
  assert.equal(db.fuelCost('D45 5082'), 45000);
  assert.equal(20000 + db.carburantMissions().montant, 45000);
  assert.equal(db.missionsAvecCarburant().length, 2);
});

test('les observations de chaque rubrique arrivent dans ÉTAT DES VÉHICULES', async () => {
  const base = await charger({
    vehicles: { pool: [vehicule({ id: 'v1', immatNouvelle: 'D45 5082', observations: 'Rétroviseur cassé' })], mission: [], service: [] },
    missions: [{ id: 'm', vehicule: 'D45 5082', dateDepart: '2026-11-01', observations: 'Pneu usé' }],
    sortiesAbidjan: [{ id: 's', vehicule: 'D45 5082', date: '2026-11-02', observations: 'Bruit moteur' }],
    dotationPool: [{ id: 'd', immat: 'D45 5082', date: '2026-11-03', conducteur: 'YAO', observations: 'Voyant allumé' }],
    vidanges: [{ id: 'x', immat: 'D45 5082', date: '2026-11-04', observation: 'Fuite d’huile' }]
  });
  synchroniserEtats(base, '2026-11-06');
  const origines = base.etatsVehicules.map((e) => String(e.origine).split(':')[0]).sort();
  assert.deepEqual(origines, ['dotation', 'mission', 'sortie', 'vehicule', 'vidange']);
});

test('une course a deux conducteurs compte pour chacun dans les statistiques', async () => {
  const st = await import('../resources/js/core/statistiques.js');
  await charger({ decharges: [
    { id: 'a', date: '2026-11-02', conducteur: 'YAO', conducteur2: 'KONE' },
    { id: 'b', date: '2026-11-03', conducteur: 'YAO' }
  ] });
  const bloc = st.statsDecharges('').blocs.find((b) => b.titre === 'Courses par conducteur');
  assert.deepEqual(bloc.lignes.map((l) => [l[0], l[1]]), [['YAO', '2'], ['KONE', '1']]);
});
