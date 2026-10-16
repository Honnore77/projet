/* Réseau du bureau : un serveur, des postes, une seule base. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { db, charger } from './aide.mjs';

const { demarrerPoste, arreterPoste, synchroniserPoste, etatPoste, adresseServeur, testerServeur } =
  await import('../resources/js/core/reseauBureau.js');

/** Lance le PC serveur de test et attend son port. */
function lancerServeur() {
  const p = spawn(process.execPath, [fileURLToPath(new URL('./serveurBureau.mjs', import.meta.url))], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lignes = [];
  const attentes = [];
  let reste = '';
  p.stdout.on('data', (b) => {
    reste += String(b);
    let i;
    while ((i = reste.indexOf('\n')) >= 0) {
      const l = JSON.parse(reste.slice(0, i));
      reste = reste.slice(i + 1);
      if (attentes.length) attentes.shift()(l); else lignes.push(l);
    }
  });
  const prochaine = () => (lignes.length ? Promise.resolve(lignes.shift()) : new Promise((r) => attentes.push(r)));
  return {
    pret: prochaine(),
    etat: () => { p.stdin.write('etat\n'); return prochaine(); },
    arreter: () => p.kill()
  };
}

test('l’adresse du serveur : IP, nom, port facultatif', () => {
  assert.equal(adresseServeur('192.168.1.20'), 'http://192.168.1.20:47800');
  assert.equal(adresseServeur('http://192.168.1.20:5000/'), 'http://192.168.1.20:5000');
  assert.equal(adresseServeur('PC-ACCUEIL', 47801), 'http://PC-ACCUEIL:47801');
  assert.equal(adresseServeur(''), '');
});

test('deux postes, un serveur : une seule base', async (t) => {
  const serveur = lancerServeur();
  t.after(() => { arreterPoste(); serveur.arreter(); });
  const { port } = await serveur.pret;

  // Un mauvais code est refuse, avec un message clair.
  await assert.rejects(testerServeur('127.0.0.1', 'MAUVAIS', port), /code du bureau/i);
  assert.equal(await testerServeur('127.0.0.1', 'test-code', port), 'PC serveur de test');

  // Poste 1 : il a son compte et sa note ; il recoit ceux du serveur.
  await charger({
    accounts: [{ id: 'c-poste1', login: 'agent1', nom: 'Agent 1', role: 'saisie', actif: true }],
    notes: [{ id: 'n-poste1', auteurId: 'c-poste1', visibilite: 'publique', sujet: 'Écrite sur le poste 1', date: '2026-10-16T09:00:00Z' }]
  });
  await demarrerPoste({ serveur: '127.0.0.1', port, code: 'test-code' });
  assert.equal(etatPoste().connecte, true);
  assert.deepEqual(db.DB.notes.map((n) => n.id).sort(), ['n-poste1', 'n-serveur']);
  assert.ok(db.DB.accounts.some((a) => a.id === 'c-serveur'));

  // Le poste 1 ecrit une note de plus : elle part au prochain tour.
  db.DB.notes.push({ id: 'n-poste1-bis', auteurId: 'c-poste1', visibilite: 'publique', sujet: 'Encore', date: '2026-10-16T09:30:00Z' });
  db.persist();
  await synchroniserPoste();
  const surServeur = await serveur.etat();
  assert.deepEqual(surServeur.notes, ['n-poste1', 'n-poste1-bis', 'n-serveur']);
  assert.deepEqual(surServeur.comptes, ['c-poste1', 'c-serveur']);
  arreterPoste();

  // Poste 2, tout neuf : il recoit tout ce que le poste 1 a envoye.
  await charger({ accounts: [{ id: 'c-poste2', login: 'agent2', nom: 'Agent 2', role: 'saisie', actif: true }] });
  await demarrerPoste({ serveur: '127.0.0.1', port, code: 'TEST-CODE' });
  assert.deepEqual(db.DB.notes.map((n) => n.id).sort(), ['n-poste1', 'n-poste1-bis', 'n-serveur']);
  assert.deepEqual(db.DB.accounts.map((a) => a.id).sort(), ['c-poste1', 'c-poste2', 'c-serveur']);

  // Rien de neuf de part et d'autre : pas de nouvel echange complet.
  assert.equal(await synchroniserPoste(), false);
});

test('serveur éteint : le poste continue sur sa copie', async () => {
  await charger({ notes: [{ id: 'n-local', auteurId: 'c1', visibilite: 'publique', sujet: 'Locale' }] });
  await demarrerPoste({ serveur: '127.0.0.1', port: 9, code: 'X' }, { delai: 3000 });
  assert.equal(etatPoste().connecte, false);
  assert.match(etatPoste().erreur, /injoignable/);
  assert.deepEqual(db.DB.notes.map((n) => n.id), ['n-local']);
  arreterPoste();
});
