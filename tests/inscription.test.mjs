/* Inscription depuis la page de connexion : le compte attend un administrateur. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db, charger } from './aide.mjs';

const auth = await import('../resources/js/core/auth.js');

test('une inscription attend la validation avant de servir', async () => {
  await charger({
    accounts: [{ id: 'a0', login: 'admin', role: 'admin', actif: true }],
    users: [{ id: 'u1', nom: 'DOSSO', prenoms: 'YAYA', poolConducteur: 'Oui' }]
  });

  assert.equal((await auth.inscrire({ login: 'admin', nom: 'X', password: 'abc123' })).ok, false, 'identifiant déjà pris');
  assert.equal((await auth.inscrire({ login: 'yaya', nom: 'DOSSO YAYA', password: 'court' })).ok, false, 'mot de passe trop faible');
  assert.equal((await auth.inscrire({ login: 'yaya', nom: '', password: 'abc123' })).ok, false, 'nom obligatoire');

  const res = await auth.inscrire({ login: 'yaya', nom: 'Dosso Yaya', password: 'abc123' });
  assert.equal(res.ok, true);
  const acc = db.DB.accounts.find((a) => a.login === 'yaya');
  assert.equal(acc.enAttente, true);
  assert.equal(acc.actif, false);
  assert.equal(acc.agent, 'DOSSO YAYA', 'agent retrouvé d’après le nom');
  assert.equal(auth.inscriptionsEnAttente().length, 1);

  // Une alerte prévient l'administrateur.
  assert.ok(db.computeAlerts().some((a) => /inscription/.test(a.title)));

  const refus = await auth.login('yaya', 'abc123');
  assert.equal(refus.ok, false);
  assert.match(refus.error, /pas encore été validée/);

  assert.equal(auth.updateAccount(acc.id, { role: 'conducteur', agent: 'DOSSO YAYA', actif: true }).ok, true);
  assert.equal(acc.enAttente, false);
  assert.equal(auth.inscriptionsEnAttente().length, 0);

  const ok = await auth.login('yaya', 'abc123');
  assert.equal(ok.ok, true);
  assert.equal(ok.mustChange, false, 'il a choisi son mot de passe');
  assert.equal(auth.currentUser().role, 'conducteur');
  auth.logout();
});
