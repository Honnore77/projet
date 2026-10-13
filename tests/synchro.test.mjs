/* Synchronisation : datation des fiches, suppressions, fusion, conflits. */

import test from 'node:test';
import assert from 'node:assert/strict';

const sy = await import('../resources/js/core/synchro.js');

const T0 = '2026-10-01T08:00:00.000Z';
const T1 = '2026-10-02T08:00:00.000Z';
const T2 = '2026-10-03T08:00:00.000Z';
const T3 = '2026-10-04T08:00:00.000Z';

/** Une base minimale, completee par ce qu'on lui passe. */
const base = (o = {}) => Object.assign({
  accounts: [], users: [], dotationPool: [], missions: [], maintenance: [], decharges: [], destinataires: [],
  destinationsMission: [], trajets: [], simulations: [], indisponibilites: [],
  vehicles: { pool: [], mission: [], service: [] }, settings: {}, synchro: { suppressions: [] }
}, o);

const clone = (x) => JSON.parse(JSON.stringify(x));

test('une fiche modifiee recoit sa date et son appareil ; une fiche inchangee, rien', () => {
  const db = base({ missions: [{ id: 'm1', ref: 'M-001' }, { id: 'm2', ref: 'M-002' }] });
  const avant = sy.empreintesDe(db);
  db.missions[0].ref = 'M-009';
  sy.estampiller(db, avant, T1, 'PC');
  assert.equal(db.missions[0].maj, T1);
  assert.equal(db.missions[0].majPar, 'PC');
  assert.equal(db.missions[1].maj, undefined);
});

test('les champs de datation ne comptent pas dans l’empreinte', () => {
  assert.equal(sy.empreinte({ id: 'a', x: 1 }), sy.empreinte({ id: 'a', x: 1, maj: T1, majPar: 'PC' }));
});

test('une fiche supprimee laisse une trace', () => {
  const db = base({ users: [{ id: 'u1', nom: 'KONE' }] });
  const avant = sy.empreintesDe(db);
  db.users = [];
  sy.estampiller(db, avant, T1, 'TEL');
  assert.deepEqual(db.synchro.suppressions, [{ c: 'users', id: 'u1', date: T1, par: 'TEL' }]);
});

test('un vehicule change de categorie : il est date, et la fusion le range dans sa nouvelle categorie', () => {
  const pc = base({ vehicles: { pool: [{ id: 'v1', immatNouvelle: 'X' }], mission: [], service: [] } });
  const tel = clone(pc);
  const avant = sy.empreintesDe(tel);
  tel.vehicles = { pool: [], mission: [tel.vehicles.pool[0]], service: [] };
  sy.estampiller(tel, avant, T1, 'TEL');
  const { db } = sy.fusionner(pc, tel, { maintenant: T2, iciGagneEgalite: true });
  assert.equal(db.vehicles.pool.length, 0);
  assert.equal(db.vehicles.mission[0].id, 'v1');
});

test('les ajouts des deux cotes se retrouvent des deux cotes', () => {
  const pc = base({ missions: [{ id: 'a', maj: T1 }] });
  const tel = base({ missions: [{ id: 'b', maj: T1 }] });
  const { db, rapport } = sy.fusionner(pc, tel, { maintenant: T2, iciGagneEgalite: true });
  assert.deepEqual(db.missions.map((m) => m.id), ['a', 'b']);
  assert.equal(rapport.recues, 1);
  assert.equal(rapport.envoyees, 1);
});

test('la version la plus recente l’emporte ; modifiee des deux cotes depuis la derniere synchro, c’est un conflit', () => {
  const pc = base({ users: [{ id: 'u', nom: 'KONE', fonction: 'Chauffeur', maj: T2 }] });
  const tel = base({ users: [{ id: 'u', nom: 'KONE', fonction: 'Conducteur', maj: T3 }] });
  const { db, rapport } = sy.fusionner(pc, tel, { maintenant: T3, derniereSynchro: T1, iciGagneEgalite: true });
  assert.equal(db.users[0].fonction, 'Conducteur');
  assert.equal(rapport.conflits.length, 1);
  assert.equal(rapport.conflits[0].gardee, 'autre');
  // Sans modification de l'autre cote depuis la derniere synchro : pas de conflit.
  const r2 = sy.fusionner(pc, base({ users: [{ id: 'u', nom: 'KONE', maj: T0 }] }), { maintenant: T3, derniereSynchro: T1, iciGagneEgalite: true });
  assert.equal(r2.db.users[0].fonction, 'Chauffeur');
  assert.equal(r2.rapport.conflits.length, 0);
});

test('a date egale, la version du PC l’emporte', () => {
  const pc = base({ missions: [{ id: 'm', ref: 'PC' }] });
  const tel = base({ missions: [{ id: 'm', ref: 'TEL' }] });
  assert.equal(sy.fusionner(pc, tel, { maintenant: T1, iciGagneEgalite: true }).db.missions[0].ref, 'PC');
});

test('une fiche supprimee sur un appareil disparait de l’autre, sauf si elle y a ete modifiee apres', () => {
  const pc = base({ missions: [{ id: 'm', ref: 'M-1', maj: T1 }, { id: 'n', ref: 'N', maj: T3 }] });
  const tel = base({
    missions: [],
    synchro: { suppressions: [{ c: 'missions', id: 'm', date: T2 }, { c: 'missions', id: 'n', date: T2 }] }
  });
  const { db, rapport } = sy.fusionner(pc, tel, { maintenant: T3, iciGagneEgalite: true });
  // m : supprimee apres sa derniere modification -> part ; n : modifiee apres -> reste.
  assert.deepEqual(db.missions.map((m) => m.id), ['n']);
  assert.equal(rapport.supprimees, 1);
  // La trace est gardee, pour la prochaine fois.
  assert.ok(db.synchro.suppressions.some((t) => t.id === 'm'));
});

test('les reglages suivent la version la plus recente, sauf le dossier de sauvegarde du PC', () => {
  const pc = base({ settings: { prixLitreEssence: 875, dossierSauvegarde: 'D:\\SAUV', maj: T1 } });
  const tel = base({ settings: { prixLitreEssence: 905, dossierSauvegarde: '', maj: T2 } });
  const { db } = sy.fusionner(pc, tel, { maintenant: T3, iciGagneEgalite: true });
  assert.equal(db.settings.prixLitreEssence, 905);
  assert.equal(db.settings.dossierSauvegarde, 'D:\\SAUV');
});

test('fusionner dans un sens ou dans l’autre donne les memes fiches', () => {
  const pc = base({ missions: [{ id: 'a', ref: 'A', maj: T1 }, { id: 'c', ref: 'C-pc', maj: T3 }], users: [{ id: 'u', maj: T1 }] });
  const tel = base({ missions: [{ id: 'b', ref: 'B', maj: T2 }, { id: 'c', ref: 'C-tel', maj: T2 }] });
  const x = sy.fusionner(pc, tel, { maintenant: T3, iciGagneEgalite: true }).db;
  const y = sy.fusionner(tel, pc, { maintenant: T3, iciGagneEgalite: false }).db;
  const trier = (l) => l.map((m) => `${m.id}:${m.ref}`).sort();
  assert.deepEqual(trier(x.missions), trier(y.missions));
  assert.deepEqual(trier(x.users), trier(y.users));
});

test('le compte rendu vu de l’autre appareil inverse recues et envoyees', () => {
  const r = { recues: 3, envoyees: 1, supprimees: 0, parCollection: { missions: { recues: 3, envoyees: 1, supprimees: 0 } }, conflits: [{ gardee: 'ici' }] };
  const inv = sy.rapportInverse(r);
  assert.equal(inv.recues, 1);
  assert.equal(inv.envoyees, 3);
  assert.equal(inv.conflits[0].gardee, 'autre');
});

test('le meme vehicule ou le meme agent saisi des deux cotes n’apparait qu’une fois', () => {
  const pc = base({
    vehicles: { pool: [{ id: 'v-pc', immatNouvelle: 'D45 50 1234', marque: 'TOYOTA', maj: T1 }], mission: [], service: [] },
    users: [{ id: 'u-pc', nom: 'KONE', prenoms: 'Ali', maj: T1 }],
    accounts: [{ id: 'c-pc', login: 'admin', maj: T1 }]
  });
  const tel = base({
    vehicles: { pool: [{ id: 'v-tel', immatNouvelle: 'd45 50 1234', marque: 'TOYOTA', couleur: 'BLANCHE', maj: T2 }], mission: [], service: [] },
    users: [{ id: 'u-tel', nom: 'Koné', prenoms: 'ALI', maj: T0 }],
    accounts: [{ id: 'c-tel', login: 'Admin', maj: T0 }]
  });
  const { db } = sy.fusionner(pc, tel, { maintenant: T3, iciGagneEgalite: true });
  assert.equal(db.vehicles.pool.length, 1);
  assert.equal(db.vehicles.pool[0].id, 'v-pc');
  assert.equal(db.vehicles.pool[0].couleur, 'BLANCHE', 'la version la plus recente (telephone) est gardee');
  assert.equal(db.users.length, 1);
  assert.equal(db.accounts.length, 1);
});

test('deux vehicules sans immatriculation ne sont pas confondus', () => {
  const pc = base({ vehicles: { pool: [{ id: 'a', immatNouvelle: 'D45 50 ' }], mission: [], service: [] } });
  const tel = base({ vehicles: { pool: [{ id: 'b', immatNouvelle: 'D45 50 ' }], mission: [], service: [] } });
  assert.equal(sy.fusionner(pc, tel, { maintenant: T3, iciGagneEgalite: true }).db.vehicles.pool.length, 2);
});
