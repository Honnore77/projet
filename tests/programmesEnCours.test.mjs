/* Missions en cours, missions annulees, programme d'entretien, statut
   « En entretien » pose par le garage, KM effectue au garage. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db, charger } from './aide.mjs';

const pr = await import('../resources/js/core/programmes.js');
const pe = await import('../resources/js/core/programmesEntretien.js');
const { synchroniserStatutsGarage } = await import('../resources/js/core/statutGarage.js');
const { COLLECTIONS_SYNCHRO } = await import('../resources/js/core/synchro.js');
const { dsProgrammes, dsProgrammesAnnules, dsProgrammesEntretien, dsMaintenance, kmEffectueAuGarage } =
  await import('../resources/js/export/datasets.js');

const JOUR = '2026-11-11';
const prog = (o = {}) => Object.assign({
  id: 'p1', ref: 'PM-001', dateDepart: '2026-11-16', dateRetour: '2026-11-19',
  destinations: ['BOUAKE'], objet: 'Supervision', conducteur: 'KONE ALI', vehicule: 'D45 5082', participants: [], missionId: ''
}, o);

test('une mission est en cours de son depart a son retour inclus, puis achevee', async () => {
  await charger({
    missions: [
      { id: 'm1', ref: 'M-001', conducteur: 'KONE ALI', dateDepart: '2026-11-09', dateRetour: '2026-11-11', destinations: ['MAN'] },
      { id: 'm2', ref: 'M-002', conducteur: 'BAMBA', dateDepart: '2026-11-05', dateRetour: '2026-11-10' },
      { id: 'm3', ref: 'M-003', conducteur: 'YAO', dateDepart: '2026-11-12', dateRetour: '2026-11-14' },
      { id: 'm4', ref: 'M-004', conducteur: 'OUATTARA', dateDepart: '2026-11-11', dateRetour: '', participants: ['TRAORE'] }
    ],
    programmes: [prog({ missionId: 'm1' })]
  });
  assert.deepEqual(pr.missionsEnCours(JOUR).map((m) => m.id), ['m1', 'm4']);
  assert.equal(pr.missionsEnCours('2026-11-12').map((m) => m.id).join(), 'm3');
  // Le conducteur et les participants sont « en mission ».
  assert.equal(pr.missionEnCoursDe('kone ali', JOUR).id, 'm1');
  assert.equal(pr.missionEnCoursDe('TRAORE', JOUR).id, 'm4');
  assert.equal(pr.missionEnCoursDe('BAMBA', JOUR), null);
  // Le programme realise ne revient pas : c'est sa mission qui est en cours.
  assert.deepEqual(pr.programmesActifs(JOUR), []);
  assert.equal(pr.programmeDeLaMission(db.DB.missions[0]).ref, 'PM-001');
  const l = pr.agendaProgrammes({ missions: db.DB.missions, programmes: db.DB.programmes }, JOUR);
  assert.deepEqual(l.map((x) => [x.type, x.etat, x.du]), [['Mission', 'en cours', '2026-11-09'], ['Mission', 'en cours', '2026-11-11']]);
  assert.match(l[0].detail, /^M-\d+ — MAN — Supervision$/);
  const ds = dsProgrammes([], pr.missionsEnCours(JOUR));
  assert.equal(ds.rows[0].etat, 'en cours (programme PM-001)');
});

test('un programme annule quitte le tableau et rejoint les missions annulees', async () => {
  await charger({
    programmes: [
      prog(),
      prog({ id: 'p2', ref: 'PM-002', annule: true, dateAnnulation: '2026-11-10', motifAnnulation: 'Report du chantier', annulePar: 'DIRECTEUR' })
    ]
  });
  assert.equal(pr.etatProgramme(db.DB.programmes[1], JOUR), 'annulé');
  assert.deepEqual(pr.programmesActifs(JOUR).map((p) => p.ref), ['PM-001']);
  assert.deepEqual(pr.programmesPasses(JOUR), []);
  assert.deepEqual(pr.programmesAnnules().map((p) => p.ref), ['PM-002']);
  // Un programme annule ne cree plus de conflit.
  assert.deepEqual(pr.conflitsProgramme(db.DB.programmes[0], db.DB, JOUR), []);
  const ds = dsProgrammesAnnules(pr.programmesAnnules());
  assert.equal(ds.rows[0].motif, 'Report du chantier');
  assert.equal(ds.rows[0].dateAnnulation, '10/11/2026');
});

test('programme d’entretien : a venir, en retard, en cours au garage, puis realise', async () => {
  const base = await charger({
    maintenance: [
      { id: 'f1', immat: 'D45 5082', dateEntree: '2026-11-10', dateRetour: '' },
      { id: 'f2', immat: 'D45 717', dateEntree: '2026-11-03', dateRetour: '2026-11-05' }
    ],
    missions: [{ id: 'm1', ref: 'M-009', conducteur: 'KONE', vehicule: 'D45 876', dateDepart: '2026-11-17', dateRetour: '2026-11-20' }],
    programmesEntretien: [
      { id: 'e1', ref: 'PE-001', datePrevue: '2026-11-18', immat: 'D45 876', type: 'Vidange', ficheId: '' },
      { id: 'e2', ref: 'PE-002', datePrevue: '2026-11-06', immat: 'D45 663', type: 'Révision', ficheId: '' },
      { id: 'e3', ref: 'PE-003', datePrevue: '2026-11-10', immat: 'D45 5082', ficheId: 'f1' },
      { id: 'e4', ref: 'PE-004', datePrevue: '2026-11-03', immat: 'D45 717', ficheId: 'f2' }
    ]
  });
  assert.ok(COLLECTIONS_SYNCHRO.includes('programmesEntretien'));
  const etat = (i) => pe.etatProgrammeEntretien(base.programmesEntretien[i], JOUR);
  assert.deepEqual([0, 1, 2, 3].map(etat), ['à venir', 'en retard', 'en cours', 'réalisé']);
  assert.deepEqual(pe.programmesEntretienActifs(JOUR).map((e) => e.ref), ['PE-003', 'PE-002', 'PE-001']);
  assert.deepEqual(pe.programmesEntretienRealises(JOUR).map((e) => e.ref), ['PE-004']);
  assert.equal(pe.prochaineRefEntretien(), 'PE-005');
  // Le vehicule est en mission le jour prevu.
  assert.match(pe.conflitsEntretien(base.programmesEntretien[0], base, JOUR)[0], /D45 876 est en mission ce jour-là \(M-\d+, du 17\/11\/2026/);
  // Il figure au TABLEAU DE BORD → PROGRAMMES, ce qui est en cours d'abord.
  const l = pr.agendaProgrammes({ entretiens: base.programmesEntretien }, JOUR);
  assert.deepEqual(l.map((x) => [x.type, x.etat, x.vehicule]), [
    ['Entretien', 'en cours', 'D45 5082'], ['Entretien', 'en retard', 'D45 663'], ['Entretien', 'à venir', 'D45 876']
  ]);
  assert.equal(dsProgrammesEntretien(pe.programmesEntretienActifs(JOUR)).rows.length, 3);
  // Le programme de mission voit l'entretien prevu sur son vehicule.
  const c = pr.conflitsProgramme(prog({ vehicule: 'D45 876', conducteur: '' }), base, JOUR);
  assert.ok(c.some((x) => /programmé à l’entretien le 18\/11\/2026/.test(x)), c.join('\n'));
  db.renommerImmatriculation('D45 663', 'D45 5099', base);
  assert.equal(base.programmesEntretien[1].immat, 'D45 5099');
});

test('pas sorti du garage le jour meme : le vehicule passe « En entretien », puis retrouve son statut', async () => {
  const base = await charger({
    vehicles: {
      pool: [
        { id: 'v1', immatNouvelle: 'D45 5082', statut: 'Disponible' },
        { id: 'v2', immatNouvelle: 'D45 5083', statut: 'Non attribué' },
        { id: 'v3', immatNouvelle: 'D45 5084', statut: 'Disponible' }
      ],
      mission: [], service: []
    },
    maintenance: [
      { id: 'f1', immat: 'D45 5082', dateEntree: '2026-11-10', dateRetour: '' },
      { id: 'f2', immat: 'D45 5083', dateEntree: '2026-11-11', dateRetour: '' },
      { id: 'f3', immat: 'D45 5084', dateEntree: '2026-11-10', dateRetour: '2026-11-10' }
    ]
  });
  const [v1, v2, v3] = base.vehicles.pool;
  synchroniserStatutsGarage(base, JOUR);
  // Entre la veille et pas sorti : en entretien. Entre aujourd'hui : pas encore.
  // Sorti le jour meme : rien ne change.
  assert.deepEqual([v1.statut, v2.statut, v3.statut], ['En entretien', 'Non attribué', 'Disponible']);
  // Le lendemain, le second passe aussi.
  synchroniserStatutsGarage(base, '2026-11-12');
  assert.equal(v2.statut, 'En entretien');
  // Change a la main pendant le sejour : le choix est respecte.
  v1.statut = 'Immobilisé';
  assert.equal(synchroniserStatutsGarage(base, '2026-11-12'), 0);
  assert.equal(v1.statut, 'Immobilisé');
  // Sortis du garage : le second retrouve son statut d'avant.
  base.maintenance[0].dateRetour = '2026-11-12';
  base.maintenance[1].dateRetour = '2026-11-12';
  synchroniserStatutsGarage(base, '2026-11-12');
  assert.deepEqual([v1.statut, v2.statut], ['Immobilisé', 'Non attribué']);
  assert.equal(v2.statutGarageFiche, '');
});

test('KM effectué = Km sortie moins Km entrée, dans le récapitulatif', async () => {
  await charger({});
  assert.equal(kmEffectueAuGarage({ kmEntree: 72000, kmRetour: 72035 }), 35);
  assert.equal(kmEffectueAuGarage({ kmEntree: 72000, kmRetour: '' }), '');
  const ds = dsMaintenance([{ id: 'f', immat: 'D45 1', dateEntree: '2026-11-01', kmEntree: '100', kmRetour: '112', dateRetour: '2026-11-02' }]);
  const i = ds.columns.findIndex((c) => c.key === 'kmEffectue');
  assert.equal(ds.columns[i].label, 'KM effectué');
  assert.equal(ds.columns[i - 1].key, 'kmRetour');
  assert.equal(ds.rows[0].kmEffectue, 12);
});
