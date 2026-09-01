/* Le champ telephone : trois lignes etiquetees, et rien de perdu en route. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db, charger, agent } from './aide.mjs';

const { lignesTelephone, LIGNES_TELEPHONE } = db;
const MODELE = LIGNES_TELEPHONE.join('\n');

test('les trois etiquettes sont celles attendues', () => {
  assert.deepEqual(LIGNES_TELEPHONE, ['- FLOTTE PDU :', '- Tel Perso 1 :', '- Tel Perso 2 :']);
});

test('un champ vide donne les trois lignes pre-inscrites', () => {
  assert.equal(lignesTelephone(''), MODELE);
  assert.equal(lignesTelephone(undefined), MODELE);
});

test('l’ancienne etiquette « Tel Pers 1 » garde son numero', () => {
  const avant = '- FLOTTE PDU : 07 00 00 01\n- Tel Pers 1 : 05 11 11 11\n- Tel Perso 2 : 01 22 22 22';
  assert.equal(
    lignesTelephone(avant),
    '- FLOTTE PDU : 07 00 00 01\n- Tel Perso 1 : 05 11 11 11\n- Tel Perso 2 : 01 22 22 22'
  );
});

test('un numero seul, sans etiquette, rejoint la flotte', () => {
  assert.equal(lignesTelephone('0707070707'), `- FLOTTE PDU : 0707070707\n${LIGNES_TELEPHONE[1]}\n${LIGNES_TELEPHONE[2]}`);
});

test('une etiquette inconnue est conservee a la suite, pas collee a la flotte', () => {
  const r = lignesTelephone('- Bureau : 20 30 40 50');
  assert.equal(r, `${MODELE}\n- Bureau : 20 30 40 50`);
  // Le piege : « Bureau » ne doit pas finir en numero de la flotte.
  assert.ok(!r.startsWith('- FLOTTE PDU : Bureau'));
});

test('la casse et les espaces ne font pas perdre une ligne', () => {
  assert.equal(
    lignesTelephone('-  flotte pdu :07 00 00 01\n-TEL PERSO 1 : 05 11 11 11'),
    `- FLOTTE PDU : 07 00 00 01\n- Tel Perso 1 : 05 11 11 11\n${LIGNES_TELEPHONE[2]}`
  );
});

test('deux lignes visant la meme etiquette : celle qui porte un numero gagne', () => {
  const abime = '- FLOTTE PDU : 07 00 00 01\n- Tel Perso 1 :\n- Tel Perso 2 :\n- Tel Pers 1 : 05 11 11 11';
  assert.equal(
    lignesTelephone(abime),
    '- FLOTTE PDU : 07 00 00 01\n- Tel Perso 1 : 05 11 11 11\n- Tel Perso 2 :'
  );
});

test('une etiquette recollee derriere un numero est detachee', () => {
  assert.equal(
    lignesTelephone('- FLOTTE PDU : 07 00 00 01 - Tel Pers 1 : 05 11 11 11\n- Tel Perso 2 :'),
    '- FLOTTE PDU : 07 00 00 01\n- Tel Perso 1 : 05 11 11 11\n- Tel Perso 2 :'
  );
});

test('repasser le resultat dans la fonction ne le change plus', () => {
  const cas = ['', '0707070707', '- Bureau : 20 30 40 50',
    '- FLOTTE PDU : 07 00 00 01\n- Tel Pers 1 : 05 11 11 11'];
  for (const c of cas) {
    const une = lignesTelephone(c);
    assert.equal(lignesTelephone(une), une, `pas stable pour ${JSON.stringify(c)}`);
  }
});

test('au chargement, chaque agent recoit ses trois lignes et un champ email', async () => {
  const base = await charger({
    users: [agent({ id: 'u1', telephone: '- Tel Pers 1 : 05 11 11 11' }), agent({ id: 'u2' })]
  });
  for (const u of base.users) {
    assert.ok(u.telephone.includes('- FLOTTE PDU :'));
    assert.ok(u.telephone.includes('- Tel Perso 1 :'));
    assert.ok(u.telephone.includes('- Tel Perso 2 :'));
    assert.ok(!u.telephone.includes('Tel Pers 1 :'), 'ancienne etiquette residuelle');
    assert.equal(typeof u.email, 'string');
  }
  assert.ok(base.users[0].telephone.includes('05 11 11 11'), 'numero perdu');
});
