/* Cle de recuperation : generee par un administrateur, utilisee une fois depuis la connexion. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db, charger } from './aide.mjs';

const { hashPassword } = await import('../resources/js/core/crypto.js');
const auth = await import('../resources/js/core/auth.js');

async function base() {
  await charger({
    accounts: [
      { id: 'a1', login: 'admin', nom: 'Admin', role: 'admin', actif: true, pass: await hashPassword('ancien1') },
      { id: 'a2', login: 'agent', nom: 'Agent', role: 'saisie', actif: true, pass: await hashPassword('ancien2') }
    ]
  });
}

test('seul un administrateur connecté génère la clé ; la base n’en garde que l’empreinte', async () => {
  await base();
  auth.logout();
  await assert.rejects(auth.genererCleRecuperation(), /administrateurs/);
  assert.equal((await auth.login('admin', 'ancien1')).ok, true);
  const cle = await auth.genererCleRecuperation();
  assert.match(cle, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/);
  const k = db.DB.settings.cleRecuperation;
  assert.ok(k.empreinte && k.empreinte.hash);
  assert.ok(!JSON.stringify(k).includes(auth.normaliserCle(cle)));
  assert.equal(auth.etatCleRecuperation().existe, true);
  auth.logout();
});

test('la clé rouvre un compte, une seule fois', async () => {
  await base();
  await auth.login('admin', 'ancien1');
  const cle = await auth.genererCleRecuperation();
  auth.logout();

  assert.match((await auth.recupererAvecCle({ cle: 'AAAA-BBBB-CCCC-DDDD-EEEE', login: 'admin', password: 'neuf123' })).error, /incorrecte/);
  assert.match((await auth.recupererAvecCle({ cle, login: 'personne', password: 'neuf123' })).error, /inconnu/);
  assert.match((await auth.recupererAvecCle({ cle, login: 'admin', password: 'court' })).error, /au moins/);

  // Saisie en minuscules, sans tirets : seuls les caracteres comptent.
  const res = await auth.recupererAvecCle({ cle: cle.toLowerCase().replace(/-/g, ' '), login: 'ADMIN', password: 'neuf123' });
  assert.deepEqual(res, { ok: true, login: 'admin' });
  assert.equal((await auth.login('admin', 'ancien1')).ok, false);
  assert.equal((await auth.login('admin', 'neuf123')).ok, true);
  auth.logout();

  // Deja utilisee : elle ne vaut plus.
  assert.equal(auth.etatCleRecuperation().existe, false);
  assert.equal(auth.etatCleRecuperation().utiliseePour, 'admin');
  assert.match((await auth.recupererAvecCle({ cle, login: 'agent', password: 'neuf456' })).error, /Aucune clé/);
});

test('un administrateur désactivé par erreur est réactivé par la clé', async () => {
  await base();
  await auth.login('admin', 'ancien1');
  const cle = await auth.genererCleRecuperation();
  auth.logout();
  db.DB.accounts[0].actif = false;
  assert.equal((await auth.recupererAvecCle({ cle, login: 'admin', password: 'neuf123' })).ok, true);
  assert.equal(db.DB.accounts[0].actif, true);
});
